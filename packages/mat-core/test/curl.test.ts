import { expect, it } from 'vitest'
import { buildCurlArgs, extractSessionId, parseToolCallResponse, curlWithRetry } from '../src/curl'
import type { CommandRunner } from '../src/curl'

it('buildCurlArgs: 含全部不变量参数', () => {
  const args = buildCurlArgs({ url: 'https://x/mcp', body: '{"a":1}', maxTimeSec: 30 })
  expect(args).toEqual([
    'curl', '-k', '-s', '--noproxy', '*',
    '-H', 'Content-Type: application/json',
    '-H', 'Accept: application/json, text/event-stream',
    '-D', '-',
    '-d', '{"a":1}',
    '--max-time', '30',
    'https://x/mcp',
  ])
})

it('buildCurlArgs: 带 session 时插入 Mcp-Session-Id 头（单元素 "Name: value" 形式）', () => {
  const args = buildCurlArgs({ url: 'https://x/mcp', body: '{}', maxTimeSec: 40, sessionId: 'sid-1' })
  expect(args).toContain('Mcp-Session-Id: sid-1')
})

it('extractSessionId: 小写头名可提取', () => {
  const headers = 'HTTP/1.1 200 OK\r\nmcp-session-id: abc-123\r\ncontent-type: text/event-stream\r\n\r\n'
  expect(extractSessionId(headers)).toBe('abc-123')
})

it('extractSessionId: 驼峰头名也可提取（大小写不敏感）', () => {
  const headers = 'HTTP/1.1 200 OK\r\nMcp-Session-Id: XYZ9\r\n\r\n'
  expect(extractSessionId(headers)).toBe('XYZ9')
})

it('extractSessionId: 无头返回 null', () => {
  expect(extractSessionId('HTTP/1.1 200 OK\r\n\r\n')).toBeNull()
})

it('parseToolCallResponse: SSE data 行 → HPC 业务 JSON', () => {
  const inner = JSON.stringify({ code: 0, data: 'compute-01', message: 'success' })
  const mcp = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: inner }] } })
  const body = `event: message\ndata: ${mcp}\n\n`
  expect(parseToolCallResponse(body)).toEqual({ code: 0, data: 'compute-01', message: 'success' })
})

it('parseToolCallResponse: 忽略非 data 行与坏 JSON', () => {
  const body = ': ping\ndata: not-json\ndata: ' + JSON.stringify({
    jsonrpc: '2.0', id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify({ code: 0, data: 'x', message: 'success' }) }] },
  }) + '\n'
  expect(parseToolCallResponse(body)).toEqual({ code: 0, data: 'x', message: 'success' })
})

it('parseToolCallResponse: 空流抛错（网络故障信号）', () => {
  expect(() => parseToolCallResponse('')).toThrow(/empty MCP stream/)
})

it('curl 非 2xx HTTP 状态（如 406）→ 按 rc≠0 处理，与 Python 原版一致', async () => {
  // Python 原版只检查 returncode != 0，不直接检查 HTTP 状态码
  // curl 在 HTTP 错误时通常返回非零退出码，会被重试逻辑捕获
  const run: CommandRunner = async (argv) => {
    return {
      rc: 22,  // curl 返回 22 表示 HTTP 错误（如 406）
      stdout: '<html>406 Not Acceptable</html>',
      stderr: 'HTTP/1.1 406 Not Acceptable\r\n',
    }
  }
  await expect(curlWithRetry(
    run,
    buildCurlArgs({ url: 'https://mcp-gateway.example.internal/api/mcp/test/test/mcp', body: '{}', maxTimeSec: 30, sessionId: 'sess-1' }),
    { delays: [0, 0, 0], requireBody: true },
  )).rejects.toThrow(/curl failed: rc=22/)
})
