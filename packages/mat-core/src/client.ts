import { CurlMcpTransport } from './transport.ts'
import { FetchMcpTransport } from './fetch-transport.ts'
import type { FetchLike } from './fetch-transport.ts'
import { buildMcpUrl } from './url.ts'
import { withExecGate } from './exec-gate.ts'
import { newGuardToken, verifyGuardedPayload, wrapGuardedCommand } from './exec-guard.ts'

export interface ExecResult {
  code: number
  data: string | { stdout: string; stderr: string; exitCode: number }
  message: string
}

export class MatExecError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MatExecError'
  }
}

export interface MatClientOptions {
  mcpKey: string
  baseUrl?: string
  transport?: { callTool(name: string, args: Record<string, unknown>, timeoutSeconds?: number): Promise<Record<string, unknown>>; invalidate(): void }
  retryDelays?: [number, number]
  /** 传输实现：'curl'（子进程，M0 实证默认）| 'fetch'（原生 fetch + 非 2xx 状态码检查）。缺省看 MAT_TRANSPORT，再缺省 curl。 */
  transportKind?: 'curl' | 'fetch'
  /** fetch 传输注入点（离线测试用）；transportKind 非 fetch 时忽略。 */
  fetchImpl?: FetchLike
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** HPC remote-shell 客户端（M0 范围：execCommand）。 */
export class MatClient {
  private readonly opts: MatClientOptions
  private readonly transport: NonNullable<MatClientOptions['transport']>

  constructor(opts: MatClientOptions) {
    this.opts = opts
    if (!opts.transport) {
      if (!opts.mcpKey || !opts.mcpKey.startsWith('sk-')) {
        // 凭证缺失在首次使用时报清晰错误（构造仍允许，便于早暴露于 UI 提示）
      }
      const kind = opts.transportKind ?? (process.env.MAT_TRANSPORT === 'fetch' ? 'fetch' : 'curl')
      this.transport = kind === 'fetch'
        ? new FetchMcpTransport({ mcpUrl: buildMcpUrl(opts.mcpKey, opts.baseUrl), ...opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {} })
        : new CurlMcpTransport({ mcpUrl: buildMcpUrl(opts.mcpKey, opts.baseUrl) })
    } else {
      this.transport = opts.transport
    }
  }

  /**
   * 三级容错第三级宿主：exec 整体重试 3 次，每次失败后置空会话促重建（对齐 plugin.py exec_command）。
   *
   * 并发策略（2026-09-04 15:19 三会话串扰事故后重写）：服务端 remote-shell 通道
   * 按 (密钥, 集群) 复用 shell、无输出路由隔离，与本侧 MCP 会话无关，因此：
   * 1. 每次调用经 withExecGate 按 (mcpKey, clusterId) 串行——进程内所有实例
   *    （单例/watch/gaussian）+ 跨进程文件锁，见 exec-gate.ts；
   * 2. 每次尝试独立防护标记（exec-guard.ts），响应缺本调用标记即判串扰抛错，
   *    由下方重试换新标记重发——静默拿错数据（sbatch 丢 job id、stat 解析到
   *    他人 ls）变为可检测失败。重试期间释放闸，退避不阻塞其它调用方。
   */
  async execCommand(clusterId: string, command: string, timeoutSeconds = 30): Promise<ExecResult> {
    const key = this.opts.mcpKey || process.env.MAT_MCP_KEY || ''
    if (!key.startsWith('sk-')) {
      throw new MatExecError(
        '[mat] 缺少有效凭证：请设置 MAT_MCP_KEY（sk- 开头，HPC 密钥中心创建的 remote-shell 密钥）',
      )
    }
    const delays = this.opts.retryDelays ?? [5, 15]
    let last: Error | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await withExecGate({ mcpKey: key, clusterId }, async () => {
          const token = newGuardToken()
          const payload = await this.transport.callTool(
            'remote_shell_execute',
            { clusterId, command: wrapGuardedCommand(command, token), timeoutSeconds },
            timeoutSeconds,
          )
          return normalizeExec(verifyGuardedPayload(payload, token))
        })
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err))
        this.transport.invalidate()
        if (attempt < 2) await sleep(delays[attempt] ?? 15)
      }
    }
    throw new MatExecError(`exec_command failed after 3 retries: ${last?.message ?? last}`, { cause: last })
  }
}

function normalizeExec(payload: Record<string, unknown>): ExecResult {
  return {
    code: typeof payload.code === 'number' ? payload.code : Number(payload.code ?? -1),
    data: (payload.data ?? '') as ExecResult['data'],
    message: String(payload.message ?? ''),
  }
}

/** 归一化输出为纯文本（code:0 → stdout；10020 → stdout/stderr/exitCode 拼接）。 */
export function outputText(r: ExecResult): string {
  if (r.code === 0) {
    return typeof r.data === 'string' ? r.data : (r.data?.stdout ?? '')
  }
  if (typeof r.data === 'string') return r.data || r.message
  const d = r.data ?? { stdout: '', stderr: '', exitCode: -1 }
  return `[remote failed exitCode=${d.exitCode}]\nstdout:\n${d.stdout}\nstderr:\n${d.stderr}`
}
