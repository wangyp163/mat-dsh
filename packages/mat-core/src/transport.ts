import { buildCurlArgs, curlWithRetry, defaultRunner, extractSessionId, parseToolCallResponse } from './curl.ts'
import type { CommandRunner } from './curl.ts'

export interface TransportOptions {
  mcpUrl: string
  run?: CommandRunner
  delays?: [number, number, number]
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 三级容错第二级载体：MCP 会话（建立/复用/失效重建）。 */
export class CurlMcpTransport {
  private readonly mcpUrl: string
  private readonly run: CommandRunner
  private readonly delays: [number, number, number]
  private sessionId: string | null = null

  constructor(opts: TransportOptions) {
    this.mcpUrl = opts.mcpUrl
    this.run = opts.run ?? defaultRunner
    this.delays = opts.delays ?? [5, 15, 30]
  }

  invalidate(): void {
    this.sessionId = null
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId
    // 会话层：init 自带 3 次退避（对齐 _mcp_init_retry）
    let last: Error | undefined
    for (let i = 0; i < 3; i += 1) {
      try {
        return (this.sessionId = await this.initSession())
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err))
        if (i < 2) await sleep(this.delays[i] ?? 30)
      }
    }
    {
      throw new Error(`MCP session init failed after 3 attempts: ${last?.message ?? last}`, { cause: last })
    }
  }

  async initSession(): Promise<string> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mat-dsh', version: '0.1.0' },
      },
    })
    const result = await curlWithRetry(
      this.run,
      buildCurlArgs({ url: this.mcpUrl, body, maxTimeSec: 30 }),
      { delays: this.delays, requireBody: true },
    )
    const sid = extractSessionId(result.stdout)
    if (!sid) throw new Error('no mcp-session-id in response headers')
    return sid
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutSeconds = 30): Promise<Record<string, unknown>> {
    const sessionId = await this.ensureSession()
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    try {
      const result = await curlWithRetry(
        this.run,
        buildCurlArgs({ url: this.mcpUrl, body, maxTimeSec: timeoutSeconds + 10, sessionId }),
        { delays: this.delays, requireBody: true },
      )
      return parseToolCallResponse(result.stdout)
    } catch (err) {
      this.invalidate() // 会话可疑，置空促上层重建
      if (err instanceof Error) {
        throw err
      }
      throw new Error(String(err), { cause: err })
    }
  }
}
