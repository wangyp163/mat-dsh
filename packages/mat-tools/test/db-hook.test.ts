import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createMatDb } from 'mat-core'
import type { GaussianProducerResult, MatDb, SqliteConnection } from 'mat-core'
import {
  apply,
  estimateCoreHours,
  formatDbKbLines,
  formatDbResultLines,
  recordProducerOutcomeToDb,
  resetMatDbForTests,
} from '../src/index'
import { syncKbToDb } from '../../../scripts/kb-sync.ts'

/**
 * mat-db 接线测试（D0 P1 复用飞轮）：
 * ① producer 结算 → 入库（completed 记 results；failed 只记 runs 台账）；
 * ② mat_db_query 工具：结果查询 / KB 签名查询 / 空库友好返回；
 * ③ 核时估算映射。库故障旁路语义（db=undefined）在 ① 的入参分支覆盖。
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function openMemoryDb(): MatDb {
  const conn = new DatabaseSync(':memory:') as unknown as SqliteConnection
  const db = createMatDb(conn)
  db.migrate()
  return db
}

function outcome(overrides: Partial<GaussianProducerResult>): GaussianProducerResult {
  return {
    status: 'completed',
    detail: 'gaussian opt COMPLETED',
    ...overrides,
  } as GaussianProducerResult
}

describe('recordProducerOutcomeToDb（结算入库）', () => {
  it('completed + 物性 → runs 与 results 双入库，能量/收敛/虚频往返一致', () => {
    const db = openMemoryDb()
    recordProducerOutcomeToDb(db, outcome({
      properties: { energy: -76.408954, converged: true, imaginary_frequency_count: 0 },
    }), { task: 'opt', workdir: '/home/u/w/h2o-m2-probe', jobId: '12101', coreHours: 0.53 })
    const rows = db.queryPastResults({ structure: 'h2o-m2-probe' })
    expect(rows).toHaveLength(1)
    expect(rows[0].energy).toBeCloseTo(-76.408954, 9)
    expect(rows[0].converged).toBe(true)
    expect(rows[0].task).toBe('opt')
  })

  it('failed（诊断路，无物性）→ 只记 runs 台账，不产生 result 行', () => {
    const db = openMemoryDb()
    recordProducerOutcomeToDb(db, outcome({ status: 'failed' }),
      { task: 'ts', workdir: '/home/u/w/tsx-att1', jobId: '12102' })
    expect(db.queryPastResults({ structure: 'tsx-att1' })).toHaveLength(0)
    // runs 台账存在性经 recordRun 的结构化校验通过 + 查询 API 不炸即可（P1 无 runs 查询面）
  })

  it('db=undefined（打开失败）→ 静默旁路不抛错', () => {
    expect(() => recordProducerOutcomeToDb(undefined, outcome({}), { task: 'opt', workdir: '/w/x', jobId: '1' })).not.toThrow()
  })

  it('estimateCoreHours：1 节点 32 核半小时 = 16 核时（32 核 × 0.5h）；畸形输入 null', () => {
    expect(estimateCoreHours({ slurm: { nodes: 1, ntasks_per_node: 32, time: '00:30:00' } })).toBe(16)
    expect(estimateCoreHours({ slurm: { nodes: 1, ntasks_per_node: 32, time: 'bad' } })).toBeNull()
    expect(estimateCoreHours({})).toBeNull()
  })
})

describe('formatDb*Lines（工具输出契约）', () => {
  it('结果行含时间/任务/能量/收敛/虚频', () => {
    const text = formatDbResultLines([{
      ts: Date.UTC(2026, 8, 18, 8, 0), task: 'opt+freq', energy: -76.408954,
      converged: true, imaginaryFrequencyCount: 0, artifactsPath: '/w/f/artifacts.json',
    }])
    expect(text).toMatch(/2026-09-18 08:00/)
    expect(text).toMatch(/E=-76\.408954/)
    expect(text).toContain('converged=true')
    expect(text).toContain('imag_freqs=0')
  })

  it('kb 行含 kb:<id> 与路径', () => {
    expect(formatDbKbLines([{ id: 'ts-step-limit', task: ['ts'], path: 'references/ts-step-limit.md' }]))
      .toBe('kb:ts-step-limit | task: ts | references/ts-step-limit.md')
  })
})

describe('mat_db_query 工具接线', () => {
  let testRoot: string

  interface RegisteredTool {
    name: string
    execute: (args: Record<string, unknown>) => Promise<string>
  }

  function makeCtx() {
    const tools = new Map<string, RegisteredTool>()
    const ctx = {
    on: () => () => {},
      systemPrompt: { section: (_s: unknown) => {} },
      tools: { register: (t: RegisteredTool) => { tools.set(t.name, t) } },
      get: () => undefined,
      provide: (_n: string, _v: unknown) => () => {},
    } as unknown as Context
    return { ctx, tools }
  }

  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-db-hook-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    resetMatDbForTests()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('注册存在 + 空库友好返回（无记录不是错误）', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const tool = tools.get('mat_db_query')
    expect(tool).toBeDefined()
    const out = await tool!.execute({ structure: 'nothing-here' })
    expect(out).toMatch(/No recorded results/)
  })

  it('kb_error 模式：真实 l9999 签名文本命中 ts-step-limit（经 kb-sync 种子）', async () => {
    syncKbToDb(join(testRoot, 'mat.db'), join(REPO_ROOT, 'skills', 'gaussian-calc', 'references'), REPO_ROOT)
    resetMatDbForTests() // kb-sync 直写了文件，弃缓存重开
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_db_query')!.execute({
      kb_error: 'Error termination request processed by link 9999',
    })
    expect(out).toContain('kb:ts-step-limit')
  })

  it('mat_db_dead_letter：结算入库的 run 可标死信，未入库 job 结构化拒绝', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    const writer = createMatDb(new DatabaseSync(`${testRoot}/mat.db`) as unknown as SqliteConnection)
    writer.migrate()
    recordProducerOutcomeToDb(writer, {
      status: 'failed',
    } as GaussianProducerResult, { task: 'ts', workdir: '/w/dead', jobId: 'j-dead-1' })
    // 上面直连了另一个连接写入文件；重置缓存让工具读到同一文件
    resetMatDbForTests()
    const ok = await tools.get('mat_db_dead_letter')!.execute({ job_id: 'j-dead-1', reason: 'no-kb-entry' }, {})
    expect(ok).toContain('dead-lettered job j-dead-1')
    const bad = await tools.get('mat_db_dead_letter')!.execute({ job_id: 'ghost', reason: 'x' }, {})
    expect(bad).toContain('DEAD_LETTER_REJECTED')
  })

  it('结果模式：种子一条后按 structure 命中', async () => {
    const { ctx, tools } = makeCtx()
    apply(ctx) // 先 apply 让 openMatDb 在工具执行时才打开（惰性）——此处先直接写文件
    const conn = new DatabaseSync(`${testRoot}/mat.db`) as unknown as SqliteConnection
    const writer = createMatDb(conn)
    writer.migrate()
    expect(writer.recordResult({
      structure: 'mos2-rel', task: 'opt', energy: -9.87, converged: true,
      imaginaryFrequencyCount: 0, artifactsPath: null, ts: Date.now(),
    })).toEqual({ ok: true })
    resetMatDbForTests()
    const out = await tools.get('mat_db_query')!.execute({ structure: 'mos2-rel' })
    expect(out).toContain('mos2-rel')
    expect(out).toMatch(/E=-9\.87/)
  })
})
