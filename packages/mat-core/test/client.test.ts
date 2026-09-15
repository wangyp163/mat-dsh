import { expect, it, vi } from 'vitest'
import { MatClient, outputText } from '../src/client'
import { GUARD_END_PREFIX, GUARD_START_PREFIX } from '../src/exec-guard'

/**
 * 模拟真实服务端的 fake transport：命令已由 execCommand 打上防护标记包裹，
 * 回包时按本次 token 把标记嵌回 stdout（成功）/ stdout+stderr（失败信封），
 * execCommand 端再校验剥离——完整往返覆盖 wrap → verify → strip。
 */
function fakeTransport(script: Array<{ ok: boolean; payload?: unknown; foreign?: boolean }>) {
  let i = 0
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      const step = script[Math.min(i++, script.length - 1)]
      if (!step.ok) throw new Error('network down')
      const payload = step.payload as Record<string, unknown>
      if (step.foreign) return payload // 串扰：他人输出原样返回（无本调用标记）
      const token = /SCNXS:([0-9a-f]+)/.exec(String(args.command ?? ''))?.[1]
      if (token === undefined) throw new Error('fake transport: command not guard-wrapped')
      const code = Number(payload.code ?? -1)
      const data = payload.data
      if (code === 0 && typeof data === 'string') {
        return { ...payload, data: `\n${GUARD_START_PREFIX}${token}\n${data}` }
      }
      if (code === 0 && typeof data === 'object' && data !== null && typeof (data as Record<string, unknown>).stdout === 'string') {
        return { ...payload, data: { ...(data as Record<string, unknown>), stdout: `\n${GUARD_START_PREFIX}${token}\n${(data as Record<string, unknown>).stdout}` } }
      }
      if (code !== 0 && typeof data === 'object' && data !== null) {
        const envelope = { ...(data as Record<string, unknown>) }
        if (typeof envelope.stdout === 'string') envelope.stdout = `\n${GUARD_START_PREFIX}${token}\n${envelope.stdout}`
        if (typeof envelope.stderr === 'string') envelope.stderr = `${envelope.stderr}\n${GUARD_END_PREFIX}${token} rc=${envelope.exitCode}\n`
        return { ...payload, data: envelope }
      }
      return payload
    },
    invalidate: () => {},
  }
}

it('code:0 且 data 为字符串 → 输出经标记校验剥离，与原命令输出一致', async () => {
  const t = fakeTransport([{ ok: true, payload: { code: 0, data: 'cn01\n', message: 'success' } }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t })
  const r = await c.execCommand('11250', 'hostname', 30)
  expect(r).toEqual({ code: 0, data: 'cn01\n', message: 'success' })
  expect(outputText(r)).toBe('cn01\n')
  // 发出的命令带防护包裹（标记 + 原命令 + rc 透传尾句）
  const command = String((t.calls[0].args as Record<string, unknown>).command)
  expect(command).toContain('hostname')
  expect(command).toContain(GUARD_START_PREFIX)
  expect(command.split('\n').at(-1)).toBe('test "$__scnx_rc" -eq 0')
  expect(t.calls[0].args).toMatchObject({ clusterId: '11250', timeoutSeconds: 30 })
})

it('code:10020 → 失败信封剥标记，exitCode 保留精确值（127 不被压成 1）', async () => {
  const t = fakeTransport([{
    ok: true,
    payload: { code: 10020, data: { stdout: '', stderr: 'sbatch: error', exitCode: 127 }, message: 'remote shell command failed' },
  }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t })
  const r = await c.execCommand('11250', 'sbatch x', 30)
  expect(outputText(r)).toContain('sbatch: error')
  expect(outputText(r)).toContain('exitCode=127')
})

it('前两次网络故障、第三次成功 → 整体成功（会话重建重试）', async () => {
  const t = fakeTransport([
    { ok: false }, { ok: false },
    { ok: true, payload: { code: 0, data: 'host', message: 'success' } },
  ])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t, retryDelays: [0, 0] })
  await expect(c.execCommand('11250', 'hostname', 30)).resolves.toMatchObject({ code: 0, data: 'host' })
})

it('前两次串扰（他人输出）、第三次成功 → 拦截后重试换标记，最终拿到本调用输出', async () => {
  const t = fakeTransport([
    { ok: true, foreign: true, payload: { code: 0, data: 'molecule.xyz 309 2026-09-04 15:19:04 …', message: 'success' } },
    { ok: true, foreign: true, payload: { code: 0, data: 'job.out job.log structure.xyz', message: 'success' } },
    { ok: true, payload: { code: 0, data: 'Submitted batch job 4800001', message: 'success' } },
  ])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t, retryDelays: [0, 0] })
  const r = await c.execCommand('11250', 'sbatch slurm.sh', 30)
  expect(outputText(r)).toBe('Submitted batch job 4800001')
  // 每次尝试独立 token：三次命令的标记互不相同
  const tokens = t.calls.map((call) => /SCNXS:([0-9a-f]+)/.exec(String((call.args as Record<string, unknown>).command))?.[1])
  expect(new Set(tokens).size).toBe(3)
})

it('持续串扰 → 3 次后抛 MatExecError，信息指明 crosstalk 并留证他人输出', async () => {
  const t = fakeTransport([
    { ok: true, foreign: true, payload: { code: 0, data: 'molecule.xyz 309 2026-09-04 15:19:04 pre.json run.json', message: 'success' } },
  ])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t, retryDelays: [0, 0] })
  await expect(c.execCommand('11250', 'sbatch slurm.sh', 30))
    .rejects.toThrow(/exec_command failed after 3 retries: remote-shell output crosstalk.*molecule\.xyz/)
})

it('三次皆失败 → 抛 MatExecError 且信息含末次错误', async () => {
  const t = fakeTransport([{ ok: false }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t, retryDelays: [0, 0] })
  await expect(c.execCommand('11250', 'hostname', 30)).rejects.toThrow(/exec_command failed after 3 retries: network down/)
})

it('三次皆失败 → MatExecError.cause 保留末次原始错误', async () => {
  const t = fakeTransport([{ ok: false }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t, retryDelays: [0, 0] })
  try {
    await c.execCommand('11250', 'hostname', 30)
    throw new Error('should have thrown')
  } catch (err) {
    expect(err).toBeInstanceOf(Error)
    const error = err as Error
    expect(error.cause).toBeInstanceOf(Error)
    expect(error.cause).toHaveProperty('message', 'network down')
  }
})

it('未提供 mcp_key → 构造/调用时报凭证错误', async () => {
  vi.stubEnv('MAT_MCP_KEY', '')
  try {
    const c = new MatClient({ mcpKey: '' })
    await expect(c.execCommand('11250', 'hostname', 30)).rejects.toThrow(/MAT_MCP_KEY/)
  } finally {
    vi.unstubAllEnvs()
  }
})

it('transportKind fetch → 走 FetchMcpTransport（注入 fetchImpl 离线验证）', async () => {
  const sseOf = (business: unknown) => `data: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(business) }] } })}\n\n`
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    if (String(init!.body).includes('initialize')) {
      return { status: 200, headers: { get: () => 'sid-f' }, text: () => Promise.resolve('') }
    }
    // 服务端语义：按命令内的 token 回带标记
    const token = /SCNXS:([0-9a-f]+)/.exec(String(init!.body))?.[1] ?? 'none'
    return {
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve(sseOf({ code: 0, data: `\n${GUARD_START_PREFIX}${token}\ncn01`, message: 'success' })),
    }
  })
  const c = new MatClient({ mcpKey: 'sk-K', transportKind: 'fetch', fetchImpl })
  await expect(c.execCommand('11250', 'hostname', 30)).resolves.toMatchObject({ code: 0, data: 'cn01' })
  expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2)
})

it('显式 transport 优先于 transportKind（注入即胜出）', async () => {
  const t = fakeTransport([{ ok: true, payload: { code: 0, data: 'host', message: 'success' } }])
  const c = new MatClient({ mcpKey: 'sk-K', transportKind: 'fetch', transport: t })
  await expect(c.execCommand('11250', 'hostname', 30)).resolves.toMatchObject({ code: 0, data: 'host' })
})

it('同 (密钥, 集群) 的并发 execCommand 串行执行——多会话共用单例/多实例均不交叉（事故 2026-09-04 回归）', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const t = {
    calls: [] as Array<Record<string, unknown>>,
    async callTool(name: string, args: Record<string, unknown>) {
      t.calls.push({ name, args })
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 15))
      inFlight -= 1
      const token = /SCNXS:([0-9a-f]+)/.exec(String(args.command ?? ''))?.[1]
      return { code: 0, data: `\n${GUARD_START_PREFIX}${token}\nok-${t.calls.length}`, message: 'success' }
    },
    invalidate: () => {},
  }
  // 模拟事故形态：单例（mat_exec）与专属实例（watch/gaussian）并发打同一集群
  const shared = new MatClient({ mcpKey: 'sk-K', transport: t })
  const dedicated = new MatClient({ mcpKey: 'sk-K', transport: t })
  const results = await Promise.all([
    shared.execCommand('11250', 'sbatch slurm.sh'),
    dedicated.execCommand('11250', 'stat -c %s x'),
    shared.execCommand('11250', 'sacct -j 1'),
    dedicated.execCommand('11250', 'ls'),
  ])
  expect(maxInFlight).toBe(1)
  expect(results.every((r) => outputText(r).startsWith('ok-'))).toBe(true)
})
