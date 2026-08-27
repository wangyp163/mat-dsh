import { CurlMcpTransport } from './transport'
import { buildMcpUrl } from './url'

export interface ExecResult {
  code: number
  data: string | { stdout: string; stderr: string; exitCode: number }
  message: string
}

export class MatExecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatExecError'
  }
}

export interface MatClientOptions {
  mcpKey: string
  baseUrl?: string
  transport?: { callTool(name: string, args: Record<string, unknown>, timeoutSeconds?: number): Promise<Record<string, unknown>>; invalidate(): void }
  retryDelays?: [number, number]
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** HPC remote-shell 客户端（M0 范围：execCommand）。 */
export class MatClient {
  private readonly transport: NonNullable<MatClientOptions['transport']>

  constructor(private readonly opts: MatClientOptions) {
    if (!opts.transport) {
      if (!opts.mcpKey || !opts.mcpKey.startsWith('sk-')) {
        // 凭证缺失在首次使用时报清晰错误（构造仍允许，便于早暴露于 UI 提示）
      }
      this.transport = new CurlMcpTransport({ mcpUrl: buildMcpUrl(opts.mcpKey, opts.baseUrl) })
    } else {
      this.transport = opts.transport
    }
  }

  /** 三级容错第三级宿主：exec 整体重试 3 次，每次失败后置空会话促重建（对齐 plugin.py exec_command）。 */
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
    throw new MatExecError(`exec_command failed after 3 retries: ${last?.message ?? last}`)
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
