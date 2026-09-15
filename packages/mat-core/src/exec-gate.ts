/**
 * remote_shell_execute 串行闸（2026-09-04 15:19 三并发会话输出串扰修复）。
 *
 * 事故定性：HPC 远端 shell 通道对同一 (mcpKey, clusterId) 的并发命令无输出
 * 路由隔离——S3 的 sbatch 返回了 S1 目录的 stat/ls 输出、S1 的下载解析到 S3
 * 目录的列表、S2 的 stderr 混入 S1 的 find 报错。服务端按 (密钥, 集群) 复用
 * shell 会话，与本侧 MCP 会话 id 无关，因此本侧所有 MatClient 实例（单例、
 * watch 专属、gaussian 同步段/producer）必须共用同一把闸。
 *
 * 两层闸：
 * 1. 进程内 FIFO 链（Map<key, Promise>）——同进程所有实例串行；
 * 2. 跨进程文件锁（O_CREAT|O_EXCL，tmpdir 下 mat-exec-locks）——多个 dsh
 *    进程共用同一密钥时仍串行。持锁期间周期 touch 保活；进程崩溃后按 mtime
 *    过期抢占（默认 90s）。文件锁任何异常（目录不可写、等待超时）一律
 *    fail-open 放行——可用性优先，正确性兜底交给 exec-guard 的标记校验。
 *
 * 环境开关：MAT_EXEC_GATE=off 关闭整闸（调试用）；MAT_EXEC_FILE_LOCK=off
 * 只留进程内链；MAT_EXEC_LOCK_DIR 自定义锁目录。
 */

import { createHash } from 'node:crypto'
import { mkdir, open, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ExecGateScope {
  mcpKey: string
  clusterId: string
}

export interface ExecGateOptions {
  /** 文件锁目录（缺省 $MAT_EXEC_LOCK_DIR 或 tmpdir/mat-exec-locks）。 */
  lockDir?: string
  /** 持有者 mtime 超过该毫秒数视为崩溃残留，可抢占（缺省 90s）。 */
  staleMs?: number
  /** 抢占失败后的轮询间隔毫秒（缺省 75ms，附加随机抖动）。 */
  pollMs?: number
  /** 文件锁等待预算毫秒，超时 fail-open（缺省 300s）。 */
  acquireTimeoutMs?: number
  /** 持锁期间的 mtime 保活间隔毫秒（缺省 15s）。 */
  touchIntervalMs?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 闸键：密钥参与哈希，避免密钥明文进文件名/日志。 */
export function execGateKey(scope: ExecGateScope): string {
  return createHash('sha256').update(`${scope.mcpKey}|${scope.clusterId}`).digest('hex').slice(0, 32)
}

/** 进程内闸链：key → 上一持有者释放信号（只 resolve 不 reject）。 */
const localChains = new Map<string, Promise<void>>()

const noopRelease: () => Promise<void> = async () => {}

/**
 * 文件锁获取；返回释放函数。任何非预期文件系统异常、等待超时都返回
 * fail-open 语义的提示（此处直接放行由调用方继续执行），不阻塞业务。
 */
async function acquireFileLock(
  key: string,
  opts: ExecGateOptions = {},
): Promise<() => Promise<void>> {
  const lockDir = opts.lockDir ?? process.env.MAT_EXEC_LOCK_DIR ?? join(tmpdir(), 'mat-exec-locks')
  const staleMs = opts.staleMs ?? 90_000
  const pollMs = opts.pollMs ?? 75
  const acquireTimeoutMs = opts.acquireTimeoutMs ?? 300_000
  const touchIntervalMs = opts.touchIntervalMs ?? 15_000
  const lockPath = join(lockDir, `${key}.lock`)
  const deadline = Date.now() + acquireTimeoutMs
  try {
    await mkdir(lockDir, { recursive: true })
  } catch {
    return noopRelease
  }
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        await handle.write(`${process.pid} ${Date.now()}\n`)
      } finally {
        await handle.close()
      }
      // 保活：mtime 周期刷新，崩溃进程的锁在 staleMs 后可被抢占
      const touch = setInterval(() => {
        void utimes(lockPath, new Date(), new Date()).catch(() => {})
      }, touchIntervalMs)
      touch.unref()
      return async () => {
        clearInterval(touch)
        await rm(lockPath, { force: true }).catch(() => {})
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return noopRelease
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > staleMs) {
          await rm(lockPath, { force: true }).catch(() => {})
          continue // 立即重试抢占（wx 保证只有一个抢占者胜出）
        }
      } catch {
        // 锁文件在 open 失败与 stat 之间消失：退避后重试
      }
      if (Date.now() > deadline) return noopRelease // fail-open，正确性由 exec-guard 兜底
      await sleep(pollMs + Math.floor(Math.random() * pollMs))
    }
  }
}

/**
 * 按 (mcpKey, clusterId) 串行执行 fn：先排进程内 FIFO 链，再取跨进程文件锁。
 * 不同 (密钥, 集群) 之间不互斥；fn 抛错也必须释放（finally 双保险）。
 */
export async function withExecGate<T>(scope: ExecGateScope, fn: () => Promise<T>, opts: ExecGateOptions = {}): Promise<T> {
  if (process.env.MAT_EXEC_GATE === 'off') return fn()
  const key = execGateKey(scope)
  const previous = localChains.get(key) ?? Promise.resolve()
  let releaseLocal: () => void = () => {}
  const held = new Promise<void>((resolve) => { releaseLocal = resolve })
  localChains.set(key, previous.then(() => held))
  await previous
  const useFileLock = process.env.MAT_EXEC_FILE_LOCK !== 'off'
  try {
    if (!useFileLock) return await fn()
    const releaseFile = await acquireFileLock(key, opts)
    try {
      return await fn()
    } finally {
      await releaseFile()
    }
  } finally {
    releaseLocal()
  }
}
