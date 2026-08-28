/**
 * Slurm 作业批量监控循环（纯逻辑，无 cordis 依赖；定时器与 execCommand 全注入，可测）。
 *
 * 每 tick 一条批量 `sacct` 查询全部 job_id（sacct 对 PENDING/RUNNING/终态实时可见，
 * 见 docs/evidence/m1/2026-08-28-slurm-format-probe.md），无 LLM 参与；
 * 全部终态 / maxWait 超时 / 连续 5 次传输异常 / cancel 四路结算。
 *
 * 输出契约（对齐宿主 JobHooks 流式语义）：readOutput 返回"距上次读取的变化行"，
 * 结算时把摘要 + 完整终态表压入待读，终态后首读即拿全表。
 */

import type { ExecResult } from './client'
import { isTerminal, nextPollDelayMs, parseSacctBatch } from './job-state'
import type { SlurmJobInfo, SlurmJobState } from './job-state'

/** watch 结算结果；status 取值与宿主 JobOutcome 三终态一一对应。 */
export interface WatchOutcome {
  status: 'completed' | 'killed' | 'failed'
  detail?: string
}

/** createWatchLoop 的注入依赖。 */
export interface WatchLoopOptions {
  clusterId: string
  jobIds: string[]
  /** watch 总时限；到点仍未全部终态则按 max-wait 结算（可再 watch）。 */
  maxWaitMs: number
  /** 远程执行（通常绑定一个专属 MatClient 实例）。 */
  execCommand: (clusterId: string, command: string, timeoutSeconds?: number) => Promise<ExecResult>
  scheduleTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/** 对齐宿主 JobHooks：cancel 同步幂等；done 只 resolve 不 reject；readOutput 增量。 */
export interface WatchLoopHooks {
  cancel(reason?: string): void
  done: Promise<WatchOutcome>
  readOutput(): string
}

/** 终态计数展示顺序（成功在前）。 */
const STATE_ORDER: readonly SlurmJobState[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY']

/** 连续传输异常的放弃阈值（对齐 vasp-matstream wait_job 的 5 次容错）。 */
const MAX_CONSECUTIVE_ERRORS = 5

/**
 * 创建并启动一个批量监控循环（首跳立即执行，随后按自适应间隔 10/60/120/300s）。
 * @param options - 注入依赖与监控参数。
 * @returns 宿主 JobHooks 同形句柄。
 */
export function createWatchLoop(options: WatchLoopOptions): WatchLoopHooks {
  const { clusterId, jobIds, maxWaitMs, execCommand, scheduleTimeout, clearTimeout } = options
  const watched = new Set(jobIds)
  const states = new Map<string, SlurmJobInfo>()
  /** 已写入待读的签名（state|exit|elapsed），用于增量判定。 */
  const reported = new Map<string, string>()
  const pending: string[] = []
  let timer: unknown = undefined
  let settled = false
  let consecutiveErrors = 0
  const startedAt = Date.now()

  for (const id of jobIds) {
    pending.push(formatLine(id, undefined))
    reported.set(id, 'UNKNOWN')
  }

  function formatLine(id: string, info: SlurmJobInfo | undefined): string {
    if (info === undefined) return `${id} UNKNOWN (not observed)`
    const exit = info.exitCode !== undefined ? ` exit=${info.exitCode}` : ''
    const elapsed = info.elapsedSeconds !== undefined ? ` elapsed=${info.elapsedSeconds}s` : ''
    return `${id} ${info.state}${exit}${elapsed}`
  }

  function fullTable(): string[] {
    return jobIds.map((id) => formatLine(id, states.get(id)))
  }

  function summaryLine(): string {
    const counts = new Map<SlurmJobState, number>()
    let settledCount = 0
    for (const id of jobIds) {
      const info = states.get(id)
      if (info === undefined || !isTerminal(info.state)) continue
      settledCount += 1
      counts.set(info.state, (counts.get(info.state) ?? 0) + 1)
    }
    const parts = STATE_ORDER
      .filter((s) => (counts.get(s) ?? 0) > 0)
      .map((s) => `${counts.get(s)} ${s}`)
    return `${settledCount}/${jobIds.length} settled (${parts.join(', ')})`
  }

  function schedule(delayMs: number): void {
    timer = scheduleTimeout(() => { void tick() }, delayMs)
  }

  function settle(outcome: WatchOutcome, flushSummary: boolean): void {
    if (settled) return
    settled = true
    if (timer !== undefined) clearTimeout(timer)
    if (flushSummary) pending.push(summaryLine())
    pending.push(...fullTable())
    resolveDone(outcome)
  }

  let resolveDone: (outcome: WatchOutcome) => void = () => {}
  const done = new Promise<WatchOutcome>((resolve) => { resolveDone = resolve })

  async function tick(): Promise<void> {
    if (settled) return
    const elapsed = Date.now() - startedAt
    if (elapsed >= maxWaitMs) {
      const active = jobIds
        .filter((id) => {
          const info = states.get(id)
          return info === undefined || !isTerminal(info.state)
        })
        .map((id) => `${id} ${states.get(id)?.state ?? 'UNKNOWN'}`)
        .join(', ')
      settle({ status: 'completed', detail: `max-wait exceeded; still active: ${active}` }, true)
      return
    }

    const command = `sacct -j ${jobIds.join(',')} -P -n -o JobID,State,ExitCode,ElapsedRaw`
    try {
      const r = await execCommand(clusterId, command, 30)
      if (r.code === 0) {
        const stdout = typeof r.data === 'string' ? r.data : (r.data?.stdout ?? '')
        for (const info of parseSacctBatch(stdout).values()) {
          if (watched.has(info.jobId)) states.set(info.jobId, info)
        }
      }
      // 远端 rc≠0（code 10020）：本轮无数据，宽限不计数（sacct 偶发/权限抖动）
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors += 1
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const message = err instanceof Error ? err.message : String(err)
        settle({ status: 'failed', detail: `poll failed ${MAX_CONSECUTIVE_ERRORS} consecutive times: ${message}` }, true)
        return
      }
      schedule(nextPollDelayMs(Date.now() - startedAt))
      return
    }

    for (const [id, info] of states) {
      const signature = `${info.state}|${info.exitCode ?? ''}|${info.elapsedSeconds ?? ''}`
      if (reported.get(id) !== signature) {
        reported.set(id, signature)
        pending.push(formatLine(id, info))
      }
    }

    if (jobIds.every((id) => {
      const info = states.get(id)
      return info !== undefined && isTerminal(info.state)
    })) {
      settle({ status: 'completed', detail: summaryLine() }, true)
      return
    }
    schedule(nextPollDelayMs(Date.now() - startedAt))
  }

  schedule(0)

  return {
    cancel(reason) {
      settle({ status: 'killed', detail: reason }, true)
    },
    done,
    readOutput() {
      if (pending.length === 0) return ''
      const text = pending.join('\n')
      pending.length = 0
      return text
    },
  }
}
