import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient } from 'mat-core'
import type { PipelineState, TaskPackage } from 'mat-core'

import { apply, resetMatDbForTests } from '../src/index'

/**
 * R6a 工具面接线：mat_pipeline_start/status/resume 三工具 + 状态外置
 * pipelines/<id>.json + JobKind mat-pipeline 注册;远端全 mock、伪时钟泵进。
 */

interface RegisteredTool {
  name: string
  execute: (args: Record<string, unknown>, exec: { agent?: { id: string } }) => Promise<string>
}

interface DriverLike { done: Promise<{ status: string; detail: string }> }

function makeCtx() {
  const tools = new Map<string, RegisteredTool>()
  const started: Array<{ kind: string; label: string; hooks: unknown }> = []
  const jobs = {
    counter: 0,
    start(input: { kind: string; label: string; run: () => unknown }) {
      jobs.counter += 1
      const hooks = input.run()
      started.push({ kind: input.kind, label: input.label, hooks })
      return `job-${jobs.counter}`
    },
  }
  const ctx = {
    on: () => () => {},
    systemPrompt: { section: (_s: unknown) => {} },
    tools: { register: (t: RegisteredTool) => { tools.set(t.name, t) } },
    get: (key: string) => (key === 'jobs' ? jobs : undefined),
    provide: (_n: string, _v: unknown) => () => {},
  } as never
  return { ctx, tools, started }
}

const DIGEST = 'c'.repeat(64)

function tsIrcPkg(): TaskPackage {
  return {
    schema_version: 'aimater.taskpackage.v1', engine: 'gaussian', status: 'ready', task: 'tsxtb+ts+irc',
    waves: [
      { id: 1, task: 'tsxtb', dependsOn: [], gate: null, preJson: { x: 1 }, runJson: {}, postJson: {}, reusable: false },
      { id: 2, task: 'ts', dependsOn: [1], gate: { converged: true, imaginary_frequency_count: 1 }, preJson: { x: 1 }, runJson: {}, postJson: {}, reusable: false },
      { id: 3, task: 'irc', dependsOn: [2], gate: null, preJson: { x: 1 }, runJson: {}, postJson: {}, reusable: false },
    ],
    questions: [], assumptions: [], estimatedCoreHours: 18, digest: DIGEST, execution: { mode: 'stepwise', instructions: [] },
  }
}

const ok = (data: string) => ({ code: 0, data, message: '' })

/** 全绿链路 mock:render/find/sbatch/sacct/post/result.json 全部顺从。 */
function stubGreenCluster(): void {
  let submitCount = 0
  const polls = new Map<string, number>()
  const props: Array<Record<string, unknown>> = [
    { 'tsxtb.energy': -76.4 },
    { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
    { 'irc.irc_point_count': 30 },
  ]
  // result.json 是门检的数据源（与 mat_sbatch 工具层同源）：按真实
  // workflow 语义累积已结算波的 properties。
  const settledProps: Record<string, unknown> = {}
  vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation((async (_c: string, command: string) => {
    if (command.includes('-p run')) return ok('rendered')
    if (command.includes('-p pre')) return ok('')
    if (command.startsWith('echo ')) return ok('')
    if (command.startsWith('printf ')) return ok('')
    if (command.includes('result.json')) return ok(JSON.stringify({ properties: { ...settledProps } }))
    if (command.includes('find ')) {
      submitCount += 1
      const task = submitCount === 1 ? 'tsxtb' : submitCount === 2 ? 'ts' : 'irc'
      return ok(`/home/u/w/tsxtb+ts+irc/0${submitCount}-${task}/slurm.sh`)
    }
    if (command.includes('sbatch')) return ok(`Submitted batch job ${900 + submitCount}`)
    if (command.includes('sacct')) {
      const jobId = String(900 + Math.max(submitCount, 1))
      const n = (polls.get(jobId) ?? 0) + 1
      polls.set(jobId, n)
      return ok(n === 1 ? `${jobId}|RUNNING|0:0|0|/home/u/w` : `${jobId}|COMPLETED|0:0|30|/home/u/w`)
    }
    if (command.includes('-p post')) {
      const p = props[Math.min(submitCount, props.length) - 1]!
      Object.assign(settledProps, p) // post 落盘 = result.json 可见
      return ok(`[post]\n${JSON.stringify({ status: 'ok', phase: 'post', properties: p })}`)
    }
    if (command.includes('tail -n')) return ok('logtail')
    throw new Error(`unexpected: ${command.slice(0, 90)}`)
  }) as never)
}

async function seedPkg(testRoot: string): Promise<void> {
  const dir = join(testRoot, 'task-packages')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${DIGEST}.json`), JSON.stringify(tsIrcPkg()))
}

async function pump(hooks: DriverLike, max = 200): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const fin = await Promise.race([hooks.done.then(() => true), vi.advanceTimersByTimeAsync(10_000).then(() => false)])
    if (fin) return
  }
  throw new Error('pump exhausted')
}

describe('mat_pipeline 工具接线', () => {
  let testRoot: string
  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-pipeline-hook-')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    // 环境门禁与本用例正交（本文件测的是别的闸）——整闸关闭，免得每例先跑一遍门禁
    vi.stubEnv('MAT_ENV_GATE', 'off')
    vi.useFakeTimers()
    resetMatDbForTests()
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetMatDbForTests()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('① 注册三工具与 mat-pipeline JobKind', () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    expect(tools.has('mat_pipeline_start')).toBe(true)
    expect(tools.has('mat_pipeline_status')).toBe(true)
    expect(tools.has('mat_pipeline_resume')).toBe(true)
  })

  it('② start → 全链代码化跑完:pipeline.json completed、重复 start 被拒', async () => {
    await seedPkg(testRoot)
    stubGreenCluster()
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_pipeline_start')!.execute({
      pkg_digest: DIGEST, cluster_id: '11250', workdir: '/home/u/w',
    }, {} as never)
    expect(out).toContain('pipeline pl-cccccccccccc-fad0978a started')
    expect(started[0]!.kind).toBe('mat-pipeline')
    const file = join(testRoot, 'pipelines', 'pl-cccccccccccc-fad0978a.json')
    expect(existsSync(file)).toBe(true)
    await pump(started[0]!.hooks as DriverLike)
    const final = JSON.parse(readFileSync(file, 'utf8')) as PipelineState
    expect(final.phase).toBe('completed')
    expect(final.waves.every((w) => w.attempt === 1)).toBe(true)
    // 重复 start 拒绝(终态)
    await expect(tools.get('mat_pipeline_start')!.execute({
      pkg_digest: DIGEST, cluster_id: '11250', workdir: '/home/u/w',
    }, {} as never)).rejects.toThrow(/already finished/)
    // status
    const status = await tools.get('mat_pipeline_status')!.execute({ pipeline_id: 'pl-cccccccccccc-fad0978a' }, {} as never)
    expect(status).toContain('completed')
  })

  it('③ needs_llm 停链后 resume:retry 带 route 重启、dead_letter 终结', async () => {
    await seedPkg(testRoot)
    // wave2(ts) 恒 FAILED 且无处方命中 → needs_llm
    let submitCount = 0
    const polls = new Map<string, number>()
    vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation((async (_c: string, command: string) => {
      if (command.includes('-p run')) return ok('rendered')
      if (command.includes('-p pre')) return ok('')
      if (command.startsWith('echo ')) return ok('')
      if (command.startsWith('printf ')) return ok('')
      if (command.includes('find ')) {
        submitCount += 1
        const task = submitCount === 1 ? 'tsxtb' : 'ts'
        return ok(`/home/u/w/tsxtb+ts+irc/0${submitCount}-${task}/slurm.sh`)
      }
      if (command.includes('sbatch')) return ok(`Submitted batch job ${950 + submitCount}`)
      if (command.includes('sacct')) {
        const jobId = String(950 + Math.max(submitCount, 1))
        const n = (polls.get(jobId) ?? 0) + 1
        polls.set(jobId, n)
        const failed = submitCount >= 2
        return ok(n === 1 && !failed ? `${jobId}|RUNNING|0:0|0|/home/u/w` : `${jobId}|${failed ? 'FAILED' : 'COMPLETED'}|1:0|30|/home/u/w`)
      }
      if (command.includes('-p post')) {
        if (submitCount >= 2) return ok('[post]\n{"status": "error", "error": "boom"}')
        return ok(`[post]\n${JSON.stringify({ status: 'ok', phase: 'post', properties: { 'tsxtb.energy': -76.4 } })}`)
      }
      if (command.includes('tail -n')) return ok('Error termination request processed by link 9999')
      throw new Error(`unexpected: ${command.slice(0, 90)}`)
    }) as never)
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    await tools.get('mat_pipeline_start')!.execute({
      pkg_digest: DIGEST, cluster_id: '11250', workdir: '/home/u/w',
    }, {} as never)
    await pump(started[0]!.hooks as DriverLike)
    const file = join(testRoot, 'pipelines', 'pl-cccccccccccc-fad0978a.json')
    let state = JSON.parse(readFileSync(file, 'utf8')) as PipelineState
    expect(state.phase).toBe('needs_llm')
    // resume retry 缺 route 拒绝
    await expect(tools.get('mat_pipeline_resume')!.execute({
      pipeline_id: 'pl-cccccccccccc-fad0978a', action: 'retry',
    }, {} as never)).rejects.toThrow(/requires route/)
    // resume dead_letter → 终态 + 状态面
    const out = await tools.get('mat_pipeline_resume')!.execute({
      pipeline_id: 'pl-cccccccccccc-fad0978a', action: 'dead_letter', reason: 'no-kb-entry',
    }, {} as never)
    expect(out).toContain('dead-lettered')
    state = JSON.parse(readFileSync(file, 'utf8')) as PipelineState
    expect(state.phase).toBe('dead_lettered')
    // 终态后 resume 拒绝
    await expect(tools.get('mat_pipeline_resume')!.execute({
      pipeline_id: 'pl-cccccccccccc-fad0978a', action: 'rewatch',
    }, {} as never)).rejects.toThrow(/terminal/)
  })

  it('④ 单波 pkg 拒绝启动(走 one-stop)', async () => {
    const dir = join(testRoot, 'task-packages')
    await mkdir(dir, { recursive: true })
    const one = tsIrcPkg()
    one.task = 'opt'
    one.waves = [one.waves[0]!]
    one.digest = 'f'.repeat(64)
    await writeFile(join(dir, `${one.digest}.json`), JSON.stringify(one))
    const { ctx, tools } = makeCtx()
    apply(ctx)
    await expect(tools.get('mat_pipeline_start')!.execute({
      pkg_digest: one.digest, cluster_id: '11250', workdir: '/home/u/w',
    }, {} as never)).rejects.toThrow(/one-stop/)
  })
})
