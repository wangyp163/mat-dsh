import { expect, it } from 'vitest'
import { CurlMcpTransport } from '../src/transport'
import type { CommandRunner } from '../src/curl'

const INIT_HEADERS = 'HTTP/1.1 200 OK\r\nmcp-session-id: sess-1\r\n\r\n'

function sseBody(payload: unknown) {
  const inner = JSON.stringify(payload)
  const mcp = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: inner }] } })
  return `data: ${mcp}\n\n`
}

it('initSession 从响应头提取会话 id，且 initialize 请求体正确', async () => {
  let seenBody = ''
  const run: CommandRunner = async (argv) => {
    const i = argv.indexOf('-d')
    seenBody = argv[i + 1]
    return { rc: 0, stdout: INIT_HEADERS + 'data: {}\n', stderr: '' }
  }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  await expect(t.initSession()).resolves.toBe('sess-1')
  const body = JSON.parse(seenBody)
  expect(body.method).toBe('initialize')
  expect(body.params.protocolVersion).toBe('2024-11-05')
})

it('callTool 携带 Mcp-Session-Id 并返回 HPC 业务 JSON', async () => {
  const seen: string[] = []
  const run: CommandRunner = async (argv) => {
    const h = argv.find((a) => a.startsWith('Mcp-Session-Id: '))
    seen.push(h?.slice('Mcp-Session-Id: '.length) ?? '(none)')
    const d = argv.indexOf('-d')
    seen.push(argv[d + 1])
    if (h === undefined) return { rc: 0, stdout: INIT_HEADERS + 'data: {}\n', stderr: '' }
    return { rc: 0, stdout: sseBody({ code: 0, data: 'compute-01', message: 'success' }), stderr: '' }
  }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  const out = await t.callTool('remote_shell_execute', { clusterId: '11250', command: 'hostname' }, 30)
  expect(out).toEqual({ code: 0, data: 'compute-01', message: 'success' })
  expect(seen[0]).toBe('(none)') // 第一次是 initialize（无会话头）
  const callBody = JSON.parse(seen[3]) // 第二次请求体
  expect(callBody.method).toBe('tools/call')
  expect(callBody.params.name).toBe('remote_shell_execute')
  expect(callBody.params.arguments.clusterId).toBe('11250')
})

it('callTool 失败后 会话失效，下次调用重新 initialize', async () => {
  let calls = 0
  let initCount = 0
  const run: CommandRunner = async (argv) => {
    if (!argv.some((a) => a.startsWith('Mcp-Session-Id: '))) {
      initCount += 1
      return { rc: 0, stdout: INIT_HEADERS + 'data: {}\n', stderr: '' }
    }
    calls += 1
    // 第一次 callTool：curlWithRetry 内部 3 次尝试全部空 body（HTTP 000）→ 抛错并使会话失效
    if (calls <= 3) return { rc: 0, stdout: '', stderr: '' }
    return { rc: 0, stdout: sseBody({ code: 0, data: 'ok', message: 'success' }), stderr: '' }
  }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  await expect(t.callTool('remote_shell_execute', {}, 5)).rejects.toThrow()
  await expect(t.callTool('remote_shell_execute', {}, 5)).resolves.toEqual({ code: 0, data: 'ok', message: 'success' })
  expect(initCount).toBe(2)
  expect(calls).toBe(4)
})

it('initSession 连续失败 3 次后抛错', async () => {
  let calls = 0
  const run: CommandRunner = async () => { calls += 1; return { rc: 0, stdout: '', stderr: '' } }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  await expect(t.initSession()).rejects.toThrow(/session|curl/i)
  expect(calls).toBe(3)
})

it('initSession 失败后错误包含 cause', async () => {
  const run: CommandRunner = async () => { return { rc: 0, stdout: '', stderr: '' } }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  try {
    await t.initSession()
    throw new Error('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    // 验证错误消息包含原始错误（间接证明 cause 存在）
    expect((err as Error).message).toContain('curl failed')
    // 验证错误栈包含原始错误位置（间接证明 cause 链）
    expect((err as Error).stack).toMatch(/curlWithRetry/)
  }
})

it('callTool 失败后错误包含 cause', async () => {
  const run: CommandRunner = async () => { return { rc: 0, stdout: '', stderr: '' } }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  // 先 init
  try { await t.initSession() } catch {}
  try {
    await t.callTool('remote_shell_execute', {}, 5)
    throw new Error('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    // callTool 直接抛出原始错误，所以应该包含 curl 相关信息
    expect((err as Error).message).toContain('curl')
  }
})
