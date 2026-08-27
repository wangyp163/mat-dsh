import { expect, it } from 'vitest'
import { MatClient, outputText } from '../src/client'

function fakeTransport(script: Array<{ ok: boolean; payload?: unknown }>) {
  let i = 0
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      const step = script[Math.min(i++, script.length - 1)]
      if (!step.ok) throw new Error('network down')
      return step.payload as Record<string, unknown>
    },
    invalidate: () => {},
  }
}

it('code:0 且 data 为字符串 → outputText 取 stdout 文本', async () => {
  const t = fakeTransport([{ ok: true, payload: { code: 0, data: 'cn01\n', message: 'success' } }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never })
  const r = await c.execCommand('11250', 'hostname', 30)
  expect(r).toEqual({ code: 0, data: 'cn01\n', message: 'success' })
  expect(outputText(r)).toBe('cn01\n')
  expect(t.calls[0].args).toEqual({ clusterId: '11250', command: 'hostname', timeoutSeconds: 30 })
})

it('code:10020 → data 为 dict，outputText 拼接 stdout/stderr/exitCode', async () => {
  const t = fakeTransport([{
    ok: true,
    payload: { code: 10020, data: { stdout: '', stderr: 'sbatch: error', exitCode: 1 }, message: 'remote shell command failed' },
  }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never })
  const r = await c.execCommand('11250', 'sbatch x', 30)
  expect(outputText(r)).toContain('sbatch: error')
  expect(outputText(r)).toContain('exitCode=1')
})

it('前两次网络故障、第三次成功 → 整体成功（会话重建重试）', async () => {
  const t = fakeTransport([
    { ok: false }, { ok: false },
    { ok: true, payload: { code: 0, data: 'host', message: 'success' } },
  ])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never, retryDelays: [0, 0] })
  await expect(c.execCommand('11250', 'hostname', 30)).resolves.toMatchObject({ code: 0, data: 'host' })
})

it('三次皆失败 → 抛 MatExecError 且信息含末次错误', async () => {
  const t = fakeTransport([{ ok: false }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never, retryDelays: [0, 0] })
  await expect(c.execCommand('11250', 'hostname', 30)).rejects.toThrow(/exec_command failed after 3 retries: network down/)
})

it('未提供 mcp_key → 构造/调用时报凭证错误', async () => {
  const c = new MatClient({ mcpKey: '' })
  await expect(c.execCommand('11250', 'hostname', 30)).rejects.toThrow(/MAT_MCP_KEY/)
})
