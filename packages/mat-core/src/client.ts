import { CurlMcpTransport } from './transport.ts'
import { FetchMcpTransport } from './fetch-transport.ts'
import type { FetchLike } from './fetch-transport.ts'
import { buildMcpUrl } from './url.ts'

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
   * 并发策略：本实现未做调用串行化。JS 单线程保证 JSON-RPC id 分配不会竞争，
   * 但同一会话上的并发请求在服务端的行为未经验证——M0 仅验证过串行单调用。
   * 需要并发的路径（如 mat_job_watch 的后台轮询）使用独立的 MatClient 实例，
   * 与 mat_exec 的模块级单例隔离。
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
        const payload = await this.transport.callTool('remote_shell_execute', { clusterId, command, timeoutSeconds }, timeoutSeconds)
        return normalizeExec(payload)
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
