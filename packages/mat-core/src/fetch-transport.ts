/**
 * fetch 版 MCP 传输（与 CurlMcpTransport 同接口，MAT_TRANSPORT=fetch 时启用）。
 *
 * 与 curl 版的关键差异——HTTP 状态码必须显式检查：fetch 不会把 406 等非 2xx
 * 变成进程退出码（M0 backlog 项），本实现把状态码并入错误消息并置空会话促重建。
 * 会话管理/JSON 体与 curl 版一致（initialize → mcp-session-id 头 → tools/call）。
 */

import { parseToolCallResponse } from './curl.ts'

/** fetch 的最小形状（真实 Response 满足；测试注入 fake）。 */
export interface FetchLike {
  (url: string, init?: RequestInit): Promise<{
    status: number
    headers: { get(name: string): string | null }
    text(): Promise<string>
  }>
}

export interface FetchTransportOptions {
  mcpUrl: string
  /** 缺省 globalThis.fetch；注入以离线测试。 */
  fetchImpl?: FetchLike
  /** 重试退避（前两次），秒；缺省 5/15。 */
  delays?: [number, number]
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mat-dsh', version: '0.1.0' },
  },
})

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat
}

/** fetch 版 MCP 会话传输：非 2xx 即抛错（含状态码）并置空会话。 */
export class FetchMcpTransport {
  private readonly mcpUrl: string
  private readonly fetchImpl: FetchLike
  private readonly delays: [number, number]
  private sessionId: string | null = null

  constructor(opts: FetchTransportOptions) {
    this.mcpUrl = opts.mcpUrl
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike)
    this.delays = opts.delays ?? [5, 15]
  }

  invalidate(): void {
    this.sessionId = null
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId
    return h
  }

  /** 单次 initialize 请求；非 2xx/缺会话头即抛。 */
  private async initializeOnce(): Promise<string> {
    const response = await this.fetchImpl(this.mcpUrl, {
      method: 'POST',
      headers: this.headers(),
      body: INITIALIZE_BODY,
      signal: AbortSignal.timeout(30_000),
    })
    if (!(response.status >= 200 && response.status < 300)) {
      throw new Error(`fetch init failed: status ${response.status} ${snippet(await response.text())}`)
    }
    const sid = response.headers.get('mcp-session-id')
    if (!sid) throw new Error('no mcp-session-id in response headers')
    return sid
  }

  /** 3 次退避的会话建立（对齐 curl 版 initSession 的重试节奏）。 */
  async initSession(): Promise<string> {
    if (this.sessionId) return this.sessionId
    let last: Error | undefined
    for (let i = 0; i < 3; i += 1) {
      try {
        this.sessionId = await this.initializeOnce()
        return this.sessionId
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err))
        if (i < 2) await sleep(this.delays[i] ?? 15)
      }
    }
    throw new Error(`MCP session init failed after 3 attempts: ${last?.message ?? last}`, { cause: last })
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutSeconds = 30): Promise<Record<string, unknown>> {
    await this.initSession()
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetchImpl(this.mcpUrl, {
        method: 'POST',
        headers: this.headers(),
        body,
        signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000),
      })
      if (response.status >= 200 && response.status < 300) {
        const text = await response.text()
        if (text.trim() !== '') {
          try {
            return parseToolCallResponse(text)
          } catch (err) {
            this.invalidate() // 有响应但无可解析业务行：会话/网关可疑
            throw err instanceof Error ? err : new Error(String(err))
          }
        }
        // 2xx 空 body：按传输故障退避重试（对齐 curl requireBody 语义）
        this.invalidate()
        if (attempt < 2) {
          await sleep(this.delays[attempt] ?? 15)
          await this.initSession()
          continue
        }
        throw new Error('empty MCP stream (likely network fault)')
      }
      // 非 2xx：状态码显式抛出（fetch 不产生进程退出码），会话失效促重建
      this.invalidate()
      throw new Error(`fetch callTool failed: status ${response.status} ${snippet(await response.text())}`)
    }
    throw new Error('unreachable: callTool retry loop must return or throw')
  }
}
