import { describe, expect, it, vi } from 'vitest'
import { FetchMcpTransport } from '../src/fetch-transport'

/** 构造 fetch 的最小 Response 形状。 */
function res(status: number, body: string, sessionId?: string) {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'mcp-session-id' ? sessionId ?? null : null) },
    text: () => Promise.resolve(body),
  }
}

/** SSE 包装：remote_shell_execute 的业务 JSON 塞进 MCP content[0].text。 */
const sse = (business: unknown) =>
  `data: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(business) }] } })}\n\n`

describe('FetchMcpTransport', () => {
  it('initSession 成功 → 从响应头取 mcp-session-id，POST initialize', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return res(200, 'ok', 'sid-1')
    })
    const t = new FetchMcpTransport({ mcpUrl: 'https://api/v1', fetchImpl, delays: [0, 0] })
    await expect(t.initSession()).resolves.toBe('sid-1')
    expect(calls[0]?.url).toBe('https://api/v1')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.stringify(calls[0]?.init?.headers)).toContain('text/event-stream')
    expect(String(calls[0]?.init?.body)).toContain('initialize')
  })

  it('initSession 非 2xx → 抛错含状态码与 body 片段（3 次退避后放弃）', async () => {
    const fetchImpl = vi.fn(async () => res(500, 'gateway boom'))
    const t = new FetchMcpTransport({ mcpUrl: 'https://api/v1', fetchImpl, delays: [0, 0] })
    await expect(t.initSession()).rejects.toThrow(/status 500.*gateway boom/)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('callTool 成功 → 复用会话头，解析 SSE 业务 JSON', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init!.body)
      if (body.includes('initialize')) return res(200, 'ok', 'sid-9')
      return res(200, sse({ code: 0, data: 'host', message: 'success' }))
    })
    const t = new FetchMcpTransport({ mcpUrl: 'https://api/v1', fetchImpl, delays: [0, 0] })
    const payload = await t.callTool('remote_shell_execute', { clusterId: '11250' }, 30)
    expect(payload).toEqual({ code: 0, data: 'host', message: 'success' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const callInit = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1]
    expect(JSON.stringify(callInit.headers)).toContain('sid-9')
    expect(String(callInit.body)).toContain('tools/call')
    expect(String(callInit.body)).toContain('remote_shell_execute')
  })

  it('callTool 406 → 抛错含 406，会话失效促重建（下次调用重新 initialize）', async () => {
    let callCount = 0
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      callCount += 1
      if (String(init!.body).includes('initialize')) return res(200, 'ok', `sid-${callCount}`)
      if (callCount === 2) return res(406, 'Not Acceptable') // 第一次 tools/call 即 406
      return res(200, sse({ code: 0, data: 'ok', message: 'success' }))
    })
    const t = new FetchMcpTransport({ mcpUrl: 'https://api/v1', fetchImpl, delays: [0, 0] })
    await expect(t.callTool('remote_shell_execute', {}, 30)).rejects.toThrow(/status 406.*Not Acceptable/)
    // 会话已失效：第二次 callTool 触发第二次 initialize
    const payload = await t.callTool('remote_shell_execute', {}, 30)
    expect(payload).toEqual({ code: 0, data: 'ok', message: 'success' })
    const initCalls = fetchImpl.mock.calls.filter((c) => String((c as unknown as [string, RequestInit])[1].body).includes('initialize'))
    expect(initCalls).toHaveLength(2)
  })

  it('网络异常 → init 3 次退避后放弃，错误含末次原因', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down') })
    const t = new FetchMcpTransport({ mcpUrl: 'https://api/v1', fetchImpl, delays: [0, 0] })
    await expect(t.callTool('remote_shell_execute', {}, 30)).rejects.toThrow(/init failed after 3 attempts.*network down/)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('callTool 2xx 空 body → 按传输故障重试，第三次成功', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (String(init!.body).includes('initialize')) return res(200, 'ok', 'sid-a')
      const calls = fetchImpl.mock.calls.filter((c) => !String((c as unknown as [string, RequestInit])[1].body).includes('initialize'))
      if (calls.length < 3) return res(200, '')
      return res(200, sse({ code: 0, data: 'ok', message: 'success' }))
    })
    const t = new FetchMcpTransport({ mcpUrl: 'https://api/v1', fetchImpl, delays: [0, 0] })
    const payload = await t.callTool('remote_shell_execute', {}, 30)
    expect(payload).toEqual({ code: 0, data: 'ok', message: 'success' })
  })
})
