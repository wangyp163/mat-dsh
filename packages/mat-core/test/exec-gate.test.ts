import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { execGateKey, withExecGate } from '../src/exec-gate'

let lockDir: string

beforeEach(async () => {
  lockDir = await mkdtemp(join(tmpdir(), 'mat-gate-test-'))
})

afterEach(async () => {
  await rm(lockDir, { recursive: true, force: true }).catch(() => {})
})

const SCOPE_A = { mcpKey: 'sk-key-a', clusterId: '11250' }
const SCOPE_B = { mcpKey: 'sk-key-a', clusterId: '11251' }
// beforeEach 每测换新目录：必须用时取值（模块级常量会捕获到赋值前的 undefined）
const fast = () => ({ lockDir, staleMs: 60_000, pollMs: 5, acquireTimeoutMs: 2_000, touchIntervalMs: 1_000 })

it('execGateKey：密钥参与哈希（不落明文）、集群不同则键不同', () => {
  const key = execGateKey(SCOPE_A)
  expect(key).toMatch(/^[0-9a-f]{32}$/)
  expect(key).not.toContain('sk-key-a')
  expect(execGateKey(SCOPE_B)).not.toBe(key)
  expect(execGateKey({ mcpKey: 'sk-key-b', clusterId: '11250' })).not.toBe(key)
})

it('同 (密钥, 集群) 并发调用串行执行（无交错）', async () => {
  const events: string[] = []
  const job = async (name: string, holdMs: number) => withExecGate(SCOPE_A, async () => {
    events.push(`start:${name}`)
    await new Promise((resolve) => setTimeout(resolve, holdMs))
    events.push(`end:${name}`)
  }, fast())
  await Promise.all([job('one', 30), job('two', 5), job('three', 1)])
  // 每段 start 后必须紧跟同段 end，段间不交错
  expect(events).toEqual([
    'start:one', 'end:one',
    'start:two', 'end:two',
    'start:three', 'end:three',
  ])
})

it('不同 (密钥, 集群) 不互斥（可并行）', async () => {
  let held = 0
  let maxHeld = 0
  const job = (scope: typeof SCOPE_A) => withExecGate(scope, async () => {
    held += 1
    maxHeld = Math.max(maxHeld, held)
    await new Promise((resolve) => setTimeout(resolve, 25))
    held -= 1
  }, fast())
  await Promise.all([job(SCOPE_A), job(SCOPE_B)])
  expect(maxHeld).toBe(2)
})

it('不同 MatClient 实例共用同一把闸（模块级注册表）', async () => {
  const events: string[] = []
  const first = withExecGate(SCOPE_A, async () => {
    events.push('one:start')
    await new Promise((resolve) => setTimeout(resolve, 30))
    events.push('one:end')
  }, fast())
  await new Promise((resolve) => setTimeout(resolve, 5))
  await withExecGate(SCOPE_A, async () => { events.push('two:run') }, fast())
  await first
  expect(events).toEqual(['one:start', 'one:end', 'two:run'])
})

it('fn 抛错也释放闸（后续调用不死锁）', async () => {
  const first = withExecGate(SCOPE_A, async () => { throw new Error('boom') }, fast())
  await expect(first).rejects.toThrow('boom')
  await expect(withExecGate(SCOPE_A, async () => 'ok', fast())).resolves.toBe('ok')
})

it('外部进程持有的锁文件在 staleMs 后被抢占', async () => {
  // 模拟另一进程的存活锁：手工创建 + 新鲜 mtime → 本侧等待直至 fail-open 放行
  const key = execGateKey(SCOPE_A)
  const fastTimeout = { ...fast(), acquireTimeoutMs: 60 }
  await writeFile(join(lockDir, `${key}.lock`), '999999 0\n')
  const startedAt = Date.now()
  await withExecGate(SCOPE_A, async () => 'proceed-anyway', fastTimeout)
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(60)
  // 模拟崩溃残留：mtime 过期 → 立即抢占删除
  const past = new Date(Date.now() - 120_000)
  await writeFile(join(lockDir, `${key}.lock`), '999999 0\n', { flag: 'w' })
  const { utimes } = await import('node:fs/promises')
  await utimes(join(lockDir, `${key}.lock`), past, past)
  const release = await withExecGate(SCOPE_A, async () => undefined, { ...fast(), acquireTimeoutMs: 2_000 })
  expect(release).toBeUndefined()
})

it('持锁期间锁文件存在、释放后删除', async () => {
  const key = execGateKey(SCOPE_A)
  const lockPath = join(lockDir, `${key}.lock`)
  let seenDuringHold = false
  await withExecGate(SCOPE_A, async () => {
    seenDuringHold = await readFile(lockPath, 'utf8').then(() => true, () => false)
  }, fast())
  expect(seenDuringHold).toBe(true)
  const existsAfter = await readFile(lockPath, 'utf8').then(() => true, () => false)
  expect(existsAfter).toBe(false)
})

it('MAT_EXEC_GATE=off → 整闸旁路（并行放行）', async () => {
  const previous = process.env.MAT_EXEC_GATE
  process.env.MAT_EXEC_GATE = 'off'
  try {
    let held = 0
    let maxHeld = 0
    const job = () => withExecGate(SCOPE_A, async () => {
      held += 1
      maxHeld = Math.max(maxHeld, held)
      await new Promise((resolve) => setTimeout(resolve, 20))
      held -= 1
    }, fast())
    await Promise.all([job(), job()])
    expect(maxHeld).toBe(2)
  } finally {
    if (previous === undefined) delete process.env.MAT_EXEC_GATE
    else process.env.MAT_EXEC_GATE = previous
  }
})
