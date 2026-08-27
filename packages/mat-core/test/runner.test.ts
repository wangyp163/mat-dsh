import { expect, it, vi } from 'vitest'
import { curlWithRetry, defaultRunner, type CommandResult } from '../src/curl'

vi.mock('node:child_process', () => ({
  execFile: ((_cmd: string, _argv: string[], _opts: unknown, cb: (err: Error) => void) => {
    const err = new Error('spawn curl ENOENT') as Error & { code?: unknown }
    err.code = 'ENOENT'
    cb(err)
  }) as unknown as typeof import('node:child_process').execFile,
}))

function seq(results: CommandResult[]) {
  let i = 0
  return async (): Promise<CommandResult> => results[Math.min(i++, results.length - 1)]
}

it('rc=0 且有 body: 直接成功', async () => {
  const r = await curlWithRetry(seq([{ rc: 0, stdout: 'ok', stderr: '' }]), ['curl'], { delays: [0, 0, 0] })
  expect(r.stdout).toBe('ok')
})

it('HTTP 000: rc=0 但 body 空 → 重试后成功', async () => {
  let calls = 0
  const run = async () => {
    calls += 1
    return calls === 1 ? { rc: 0, stdout: '', stderr: '' } : { rc: 0, stdout: 'data', stderr: '' }
  }
  const r = await curlWithRetry(run, ['curl'], { delays: [0, 0, 0], requireBody: true })
  expect(r.stdout).toBe('data')
  expect(calls).toBe(2)
})

it('rc!=0 → 重试；3 次皆失败 → 抛错并带诊断信息', async () => {
  let calls = 0
  const run = async () => { calls += 1; return { rc: 7, stdout: '', stderr: 'boom' } }
  await expect(
    curlWithRetry(run, ['curl', '--max-time', '30', 'u'], { delays: [0, 0, 0], requireBody: true }),
  ).rejects.toThrow(/curl failed: rc=7 body_len=0/)
  expect(calls).toBe(3)
})

it('requireBody=false 时 rc=0 空 body 不触发重试', async () => {
  let calls = 0
  const run = async () => { calls += 1; return { rc: 0, stdout: '', stderr: 'h' } }
  await curlWithRetry(run, ['curl'], { delays: [0, 0, 0] })
  expect(calls).toBe(1)
})

it('defaultRunner: ENOENT（code 为字符串）时 rc 仍为数字且诊断含 ENOENT', async () => {
  const r = await defaultRunner(['curl'])
  expect(typeof r.rc).toBe('number')
  expect(r.rc).not.toBe(0)
  expect(r.stderr).toContain('ENOENT')
})
