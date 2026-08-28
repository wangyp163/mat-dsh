import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MatClient } from 'mat-core'
import type { StatusBoard } from 'mat-core'
import { apply } from '../src/index'

/**
 * producer → 状态板接线集成测试：fake ctx/jobs + MatClient.execCommand 原型桩，
 * 驱动 mat_job_watch / mat_gaussian 工具走完 upsert（monitoring）与 settle。
 */

const XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

const POST_OK_OUTPUT = [
  '[post] parsing job.log',
  '{"status": "ok", "phase": "post", "properties": {"energy": -76.408954, "converged": true, "frequencies_cm-1": [1713.13, 3727.17, 3849.10], "imaginary_frequency_count": 0}, "files": ["g16_optimized.xyz", "job.log"]}',
  '[post] done',
].join('\n')

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { agent?: { id: string } }) => Promise<string>
}

/** fake ctx：捕获 systemPrompt/tools/provide；jobs.start 立即调 run() 并登记 hooks。 */
function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  const provided = new Map<string, unknown>()
  const jobs = {
    counter: 0,
    start(input: { kind: string; label: string; run: () => unknown }) {
      jobs.counter += 1
      const id = `${input.kind}-${jobs.counter}`
      queueMicrotask(() => { void input.run() })
      return id
    },
  }
  const ctx = {
    systemPrompt: { section: (_s: unknown) => {} },
    tools: {
      register: (t: RegisteredTool) => { tools.set(t.name, t) },
    },
    get: (key: string) => (key === 'jobs' ? jobs : undefined),
    provide: (name: string, value: unknown) => {
      provided.set(name, value)
      return () => { provided.delete(name) }
    },
  } as unknown as Context
  return { ctx, tools, provided }
}

/** 按命令特征分发预置输出的 execCommand 原型桩。 */
function stubExec(script: Array<{ match: (cmd: string) => boolean; out: string }>): void {
  const pending = [...script]
  vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation(async (_c, command) => {
    const index = pending.findIndex((s) => s.match(command))
    if (index >= 0) {
      const [step] = pending.splice(index, 1)
      return { code: 0, data: step.out, message: '' }
    }
    throw new Error(`unexpected command: ${command.slice(0, 90)}`)
  })
}

describe('mat.status 板接线（watch/gaussian producer 喂料）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apply(makeCtx().ctx) // 先注册一遍拿 provide 语义？——不：每用例自建 ctx，见下
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

  it('apply 提供 mat.status 板服务', () => {
    const { ctx, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard | undefined
    expect(board).toBeDefined()
    expect(typeof board!.list).toBe('function')
  })

  it('mat_job_watch：onTick → 板 monitoring 条目（identity + slurm 投影 + ownerSession）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('sacct -j 100'), out: '100|RUNNING|0:0|15\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute(
      { cluster_id: '11250', job_ids: ['100'] },
      { agent: { id: 'sess-a' } },
    )
    await advance(0)
    expect(board.list()).toEqual([{
      jobId: 'mat-watch-1',
      kind: 'mat-watch',
      label: '11250 ×1 jobs',
      clusterId: '11250',
      ownerSession: 'sess-a',
      startedAt: expect.any(Number),
      updatedAt: expect.any(Number),
      phase: 'monitoring',
      slurm: [{ id: '100', state: 'RUNNING', exitCode: 0, elapsedSeconds: 15 }],
    }])
  })

  it('mat_job_watch：结算 → 板 settled 条目（outcomeStatus/detail）', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('sacct -j 100'), out: '100|COMPLETED|0:0|26\n' },
    ])
    const watch = tools.get('mat_job_watch')!
    await watch.execute({ cluster_id: '11250', job_ids: ['100'] }, { agent: { id: 'sess-a' } })
    await advance(0)
    const [entry] = board.list()
    expect(entry.phase).toBe('settled')
    expect(entry.outcomeStatus).toBe('completed')
    expect(entry.detail).toContain('1/1 settled (1 COMPLETED)')
    expect(entry.settledAt).toEqual(expect.any(Number))
  })

  it('mat_gaussian：monitoring 含 task/workdir；结算含 properties/files', async () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx)
    const board = provided.get('mat.status') as StatusBoard
    stubExec([
      { match: (c) => c.includes('PREP_READY') || c.includes('mkdir -p'), out: 'PREP_READY\n' },
      { match: (c) => c.includes('-p pre'), out: '{"status": "ok", "phase": "pre"}\n' },
      { match: (c) => c.includes('-p run'), out: '{"status": "ok", "phase": "run"}\n' },
      { match: (c) => c.includes('sbatch slurm.sh'), out: 'Submitted batch job 700\n' },
      { match: (c) => c.includes('sacct -j 700'), out: '700|RUNNING|0:0|15\n' },
      { match: (c) => c.includes('sacct -j 700'), out: '700|COMPLETED|0:0|30\n' },
      { match: (c) => c.includes('-p post'), out: POST_OK_OUTPUT },
    ])
    const gaussian = tools.get('mat_gaussian')!
    const submit = await gaussian.execute(
      { cluster_id: '11250', task: 'opt+freq', structure: XYZ, workdir: '/home/u/w' },
      { agent: { id: 'sess-a' } },
    )
    expect(submit).toContain('slurm job 700')
    await advance(0)
    const [monitoring] = board.list()
    expect(monitoring).toMatchObject({
      jobId: 'mat-slurm-1',
      kind: 'mat-slurm',
      label: 'gaussian opt+freq @11250 #700',
      clusterId: '11250',
      ownerSession: 'sess-a',
      phase: 'monitoring',
      task: 'opt+freq',
      workdir: '/home/u/w',
      slurm: [{ id: '700', state: 'RUNNING', exitCode: 0, elapsedSeconds: 15 }],
    })
    await advance(10_000)
    const [settled] = board.list()
    expect(settled.phase).toBe('settled')
    expect(settled.outcomeStatus).toBe('completed')
    expect(settled.properties).toMatchObject({ energy: -76.408954, converged: true, imaginary_frequency_count: 0 })
    expect(settled.files).toEqual(['g16_optimized.xyz', 'job.log'])
  })
})
