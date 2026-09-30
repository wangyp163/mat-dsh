import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatClient, createPortfolio, portfolioToJson, updateTask } from 'mat-core'
import type { PoolState, TaskPackage } from 'mat-core'

import { apply, resetMatDbForTests } from '../src/index'

/**
 * R6b 工具面接线：mat_pool_start/status/resume 三工具 + pools/<id>.json 状态外置 +
 * 每链 pipeline.json + submitGate 的相位/预算闸通道。远端全 mock、伪时钟泵进。
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

const DIGEST = 'a1'.repeat(32)

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

interface ChainScript {
  waveStates: Array<string | null>
  postProps: Array<Record<string, unknown> | null>
  /** 第一波作业在前 N 次轮询内一直 RUNNING(模拟长排队),第 N 次起正常结算 */
  settleAfterPolls?: number
  /** 该链 job.log 的 SCF 能量序列(SCF 收敛采样 mock;缺省采样输出无 SCF 行) */
  scfLog?: number[]
}

function green(): ChainScript {
  return {
    waveStates: [null, null, null],
    postProps: [
      { 'tsxtb.energy': -76.4 },
      { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
      { 'irc.irc_point_count': 30 },
    ],
  }
}

function stubCluster(scripts: Record<string, ChainScript>): string[] {
  const events: string[] = []
  const workdirs = Object.keys(scripts)
  const per = new Map<string, { submits: number; polls: Map<string, number> }>()
  for (const w of workdirs) per.set(w, { submits: 0, polls: new Map() })
  vi.spyOn(MatClient.prototype, 'execCommand').mockImplementation((async (_c: string, command: string) => {
    const sacctMatch = /sacct -j (\d+)/.exec(command)
    const w = sacctMatch !== null
      ? workdirs[Math.floor((Number(sacctMatch[1]) - 900) / 10)] ?? ''
      : workdirs.find((x) => command.includes(x))
    if (w === undefined || w === '') throw new Error(`unexpected command: ${command.slice(0, 90)}`)
    const st = per.get(w)!
    const knobs = scripts[w]!
    const chainIdx = workdirs.indexOf(w)
    if (command.includes('-p run')) return ok('rendered')
    if (command.includes('-p pre') || command.startsWith('echo ') || command.startsWith('printf ')) return ok('')
    if (command.includes('find ')) {
      st.submits += 1
      const task = st.submits === 1 ? 'tsxtb' : st.submits === 2 ? 'ts' : 'irc'
      return ok(`${w}/tsxtb+ts+irc/0${st.submits}-${task}/slurm.sh`)
    }
    if (command.includes('sbatch')) {
      events.push(`sbatch:${w}`)
      return ok(`Submitted batch job ${900 + chainIdx * 10 + st.submits}`)
    }
    if (command.includes('sacct')) {
      const jobId = String(900 + chainIdx * 10 + Math.max(st.submits, 1))
      const n = (st.polls.get(jobId) ?? 0) + 1
      st.polls.set(jobId, n)
      // 第一波长排队(跨 driver/续看共享计数):前 N-1 次轮询持续 RUNNING
      if (knobs.settleAfterPolls !== undefined && st.submits === 1 && n < knobs.settleAfterPolls) {
        return ok(`${jobId}|RUNNING|0:0|30|${w}`)
      }
      const waveIdx = Math.min(st.submits, knobs.waveStates.length) - 1
      const terminal = knobs.waveStates[waveIdx] ?? null
      const state = n === 1 && terminal === null ? 'RUNNING' : (terminal ?? 'COMPLETED')
      return ok(`${jobId}|${state}|0:0|30|${w}`)
    }
    if (command.includes('-p post')) {
      events.push(`post:${w}`)
      const waveIdx = Math.min(st.submits, knobs.postProps.length) - 1
      const props = knobs.postProps[waveIdx]
      if (props === null || props === undefined) return ok('[post]\n{"status": "error", "error": "boom"}')
      return ok(`[post]\n${JSON.stringify({ status: 'ok', phase: 'post', properties: props })}`)
    }
    // SCF 收敛采样命令(for d in ... === 段分段):按 scfLog 出 SCF Done 行
    if (command.startsWith('for d in')) {
      if (knobs.scfLog === undefined || knobs.scfLog.length === 0) return ok(`=== ${w}`)
      const lines = knobs.scfLog.map((e, i) => ` SCF Done:  E(RB3LYP) =  ${e}  A.U. after  ${i + 2} cycles`).join('\n')
      return ok(`=== ${w}\n${lines}`)
    }
    if (command.includes('tail -n')) return ok('Error termination request processed by link 9999')
    throw new Error(`unexpected command: ${command.slice(0, 90)}`)
  }) as never)
  return events
}

async function seedPkg(testRoot: string): Promise<void> {
  const dir = join(testRoot, 'task-packages')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${DIGEST}.json`), JSON.stringify(tsIrcPkg()))
}

async function seedManifest(testRoot: string, prepared: boolean): Promise<string> {
  const p = createPortfolio({
    portfolioId: 'pool-gate-test',
    tasks: [
      { taskId: 'T1', system: 'A', kind: 'valid' },
      { taskId: 'T2', system: 'B', kind: 'valid' },
    ],
  })
  if (prepared) {
    updateTask(p, 'T1', { phase: 'prepared' })
    updateTask(p, 'T2', { phase: 'prepared' })
  }
  const file = join(testRoot, 'manifest.json')
  await writeFile(file, portfolioToJson(p))
  return file
}

async function pump(hooks: DriverLike, max = 400): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const fin = await Promise.race([hooks.done.then(() => true), vi.advanceTimersByTimeAsync(10_000).then(() => false)])
    if (fin) return
  }
  throw new Error('pump exhausted')
}

describe('mat_pool 工具接线', () => {
  let testRoot: string
  beforeEach(async () => {
    testRoot = await mkdtemp('/tmp/mat-pool-hook-')
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

  it('① 注册三工具 + 引导段', () => {
    const { ctx, tools } = makeCtx()
    apply(ctx)
    expect(tools.has('mat_pool_start')).toBe(true)
    expect(tools.has('mat_pool_status')).toBe(true)
    expect(tools.has('mat_pool_resume')).toBe(true)
  })

  it('② 两链 cap=1 串行回填:pool.json done=2,链状态 completed,时序正确', async () => {
    await seedPkg(testRoot)
    const events = stubCluster({ '/w/A': green(), '/w/B': green() })
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    const out = await tools.get('mat_pool_start')!.execute({
      pool_id: 'pool-t',
      cluster_id: '11250',
      chains: [
        { pkg_digest: DIGEST, workdir: '/w/A' },
        { pkg_digest: DIGEST, workdir: '/w/B' },
      ],
      max_concurrent: 1,
    }, {} as never)
    expect(out).toContain('WARNING: no chain carries task_ref')
    expect(started[0]!.kind).toBe('mat-pool')
    // 启动即 admit 1 条(cap=1)——此刻 retry/dead_letter 应被拒(live chains)
    await expect(tools.get('mat_pool_resume')!.execute({
      pool_id: 'pool-t', action: 'retry', chain: 'pool-t-c2', route: 'x',
    }, {} as never)).rejects.toThrow(/live running chains/)
    await pump(started[0]!.hooks as DriverLike)
    const pool = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-t.json'), 'utf8')) as PoolState
    expect(pool.chains.every((c) => c.phase === 'done')).toBe(true)
    for (const id of ['pool-t-c1', 'pool-t-c2']) {
      const chain = JSON.parse(readFileSync(join(testRoot, 'pipelines', `${id}.json`), 'utf8'))
      expect(chain.phase).toBe('completed')
    }
    // 回填时序:B 的首个 sbatch 晚于 A 的首个 post
    expect(events.indexOf('sbatch:/w/B')).toBeGreaterThan(events.findIndex((e) => e === 'post:/w/A'))
    const status = await tools.get('mat_pool_status')!.execute({ pool_id: 'pool-t' }, {} as never)
    expect(status).toContain('done=2')
  })

  it('③ halted 链:resume retry 带 route 重跑完成;resume 拒绝缺 route', async () => {
    await seedPkg(testRoot)
    // B 链 ts 波首次 FAILED(无处方命中)→ halted;resume retry 后第 3 次提交起走完三波
    const scripts: Record<string, ChainScript> = {
      '/w/A': green(),
      '/w/B': {
        waveStates: [null, 'FAILED', null, null],
        postProps: [
          { 'tsxtb.energy': -76.4 },
          null,
          { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
          { 'irc.irc_point_count': 30 },
        ],
      },
    }
    stubCluster(scripts)
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    await tools.get('mat_pool_start')!.execute({
      pool_id: 'pool-h',
      cluster_id: '11250',
      chains: [
        { pkg_digest: DIGEST, workdir: '/w/A' },
        { pkg_digest: DIGEST, workdir: '/w/B' },
      ],
      max_concurrent: 2,
    }, {} as never)
    await pump(started[0]!.hooks as DriverLike)
    let pool = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-h.json'), 'utf8')) as PoolState
    expect(pool.chains.map((c) => c.phase).sort()).toEqual(['done', 'halted'])
    // retry 缺 route 拒
    await expect(tools.get('mat_pool_resume')!.execute({
      pool_id: 'pool-h', action: 'retry', chain: 'pool-h-c2',
    }, {} as never)).rejects.toThrow(/requires route/)
    // retry 带 route:链 pipeline 转 retrying、池 requeue、新驱动启动并跑完
    const out = await tools.get('mat_pool_resume')!.execute({
      pool_id: 'pool-h', action: 'retry', chain: 'pool-h-c2',
      route: 'opt=(TS,CalcFC,NoEigenTest) freq',
    }, {} as never)
    expect(out).toContain('resumed (retry)')
    expect(started.length).toBe(2) // 第二个驱动 job 已启动
    await pump(started[1]!.hooks as DriverLike)
    pool = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-h.json'), 'utf8')) as PoolState
    expect(pool.chains.every((c) => c.phase === 'done')).toBe(true)
  })

  it('④ dead_letter:halted → 终态,无 pending 不再起驱动', async () => {
    await seedPkg(testRoot)
    stubCluster({
      '/w/A': green(),
      '/w/B': { waveStates: [null, 'FAILED'], postProps: [{ 'tsxtb.energy': -76.4 }, null] },
    })
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    await tools.get('mat_pool_start')!.execute({
      pool_id: 'pool-d',
      cluster_id: '11250',
      chains: [
        { pkg_digest: DIGEST, workdir: '/w/A' },
        { pkg_digest: DIGEST, workdir: '/w/B' },
      ],
      max_concurrent: 2,
    }, {} as never)
    await pump(started[0]!.hooks as DriverLike)
    const out = await tools.get('mat_pool_resume')!.execute({
      pool_id: 'pool-d', action: 'dead_letter', chain: 'pool-d-c2', reason: 'no-kb-entry',
    }, {} as never)
    expect(out).toContain('dead-lettered')
    expect(started.length).toBe(1) // 无 pending,未起新驱动
    const pool = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-d.json'), 'utf8')) as PoolState
    expect(pool.chains.map((c) => c.phase).sort()).toEqual(['dead_lettered', 'done'])
    // 终态链不可再动
    await expect(tools.get('mat_pool_resume')!.execute({
      pool_id: 'pool-d', action: 'retry', chain: 'pool-d-c2', route: 'x',
    }, {} as never)).rejects.toThrow(/require halted/)
  })

  it('⑤ task_ref 相位闸:manifest 存 pending 时链 halted、零 sbatch;全 prepared 放行', async () => {
    await seedPkg(testRoot)
    const manifestPending = await seedManifest(testRoot, false)
    const events = stubCluster({ '/w/A': green() })
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    await tools.get('mat_pool_start')!.execute({
      pool_id: 'pool-g',
      cluster_id: '11250',
      chains: [{ pkg_digest: DIGEST, workdir: '/w/A', task_ref: { portfolio_file: manifestPending, task_id: 'T1' } }],
      max_concurrent: 1,
    }, {} as never)
    await pump(started[0]!.hooks as DriverLike)
    const pool = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-g.json'), 'utf8')) as PoolState
    expect(pool.chains[0]!.phase).toBe('halted')
    expect(pool.chains[0]!.outcome?.detail).toMatch(/PHASE_GATE_REJECTED/)
    expect(events.filter((e) => e.startsWith('sbatch:'))).toHaveLength(0)
    // 全 prepared:放行至完成。新 workdir 因为 /w/A 仍被第一个池的活链占用。
    const manifestPrepared = await seedManifest(testRoot, true)
    const events2 = stubCluster({ '/w/B': green() })
    const { ctx: ctx2, tools: tools2, started: started2 } = makeCtx()
    apply(ctx2)
    await tools2.get('mat_pool_start')!.execute({
      pool_id: 'pool-g2',
      cluster_id: '11250',
      chains: [{ pkg_digest: DIGEST, workdir: '/w/B', task_ref: { portfolio_file: manifestPrepared, task_id: 'T1' } }],
      max_concurrent: 1,
    }, {} as never)
    await pump(started2[0]!.hooks as DriverLike)
    const pool2 = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-g2.json'), 'utf8')) as PoolState
    expect(pool2.chains[0]!.phase).toBe('done')
    expect(events2.filter((e) => e === 'sbatch:/w/B')).toHaveLength(3)
  })

  it('⑥ B0 watch_expired 链:pool_resume action=rewatch 重挂同一作业跑完,零重投;status 区分两类 halted', async () => {
    await seedPkg(testRoot)
    const events = stubCluster({
      '/w/A': green(),
      // B 首波长排队:60s 窗口内(约 6 轮)不结算 → 窗口耗尽;auto_rewatch_limit=0 → 首次到期即停
      '/w/B': { waveStates: [null, null, null], postProps: green().postProps, settleAfterPolls: 10 },
    })
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    await tools.get('mat_pool_start')!.execute({
      pool_id: 'pool-w',
      cluster_id: '11250',
      chains: [
        { pkg_digest: DIGEST, workdir: '/w/A' },
        { pkg_digest: DIGEST, workdir: '/w/B' },
      ],
      max_concurrent: 2,
      max_wait_seconds: 60,
      auto_rewatch_limit: 0,
    }, {} as never)
    await pump(started[0]!.hooks as DriverLike)
    let pool = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-w.json'), 'utf8')) as PoolState
    expect(pool.chains.map((c) => c.phase).sort()).toEqual(['done', 'halted'])
    const chainB = JSON.parse(readFileSync(join(testRoot, 'pipelines', 'pool-w-c2.json'), 'utf8'))
    expect(chainB.phase).toBe('watch_expired')
    expect(chainB.waves[0].jobId).toBe('911') // jobId 在场,rewatch 靠它接手
    // status 提示区分:watch_expired 是机械 rewatch,不是诊断位
    const status1 = await tools.get('mat_pool_status')!.execute({ pool_id: 'pool-w' }, {} as never)
    expect(status1).toContain('watch_expired → action=rewatch')
    // rewatch:同一 jobId 重挂监控,B 续跑完三波
    const out = await tools.get('mat_pool_resume')!.execute({
      pool_id: 'pool-w', action: 'rewatch', chain: 'pool-w-c2', max_wait_seconds: 60,
    }, {} as never)
    expect(out).toContain('resumed (rewatch)')
    expect(started.length).toBe(2)
    await pump(started[1]!.hooks as DriverLike)
    pool = JSON.parse(readFileSync(join(testRoot, 'pools', 'pool-w.json'), 'utf8')) as PoolState
    expect(pool.chains.every((c) => c.phase === 'done')).toBe(true)
    // B 恰好 3 次 sbatch(三波各一次):首波没有因窗口耗尽被重投(双跑红线)
    expect(events.filter((e) => e === 'sbatch:/w/B')).toHaveLength(3)
    // 对真诊断位(needs_llm)的 halted 链,rewatch 被拒——不把门检失败错挂成监控
    const badScript: Record<string, ChainScript> = {
      '/w/C': { waveStates: [null, 'FAILED'], postProps: [{ 'tsxtb.energy': -76.4 }, null] },
    }
    stubCluster(badScript)
    const { ctx: ctx2, tools: tools2, started: started2 } = makeCtx()
    apply(ctx2)
    await tools2.get('mat_pool_start')!.execute({
      pool_id: 'pool-n', cluster_id: '11250',
      chains: [{ pkg_digest: DIGEST, workdir: '/w/C' }],
      max_concurrent: 1, max_wait_seconds: 60,
    }, {} as never)
    await pump(started2[0]!.hooks as DriverLike)
    const status2 = await tools2.get('mat_pool_status')!.execute({ pool_id: 'pool-n' }, {} as never)
    expect(status2).toContain('1 needs diagnosis')
    await expect(tools2.get('mat_pool_resume')!.execute({
      pool_id: 'pool-n', action: 'rewatch', chain: 'pool-n-c1',
    }, {} as never)).rejects.toThrow(/rewatch only applies/)
  })

  it('⑦ SCF 收敛监控:振荡两窗确认 → followup 唤醒带曲线摘要;watch 窗口耗尽正常停链', async () => {
    await seedPkg(testRoot)
    stubCluster({
      // 首波作业长算不结算 + SCF 等幅振荡(±1e-3 Ha):第 2 个采样窗确认 → 唤醒
      '/w/A': {
        waveStates: [null, null, null],
        postProps: green().postProps,
        settleAfterPolls: 1_000,
        scfLog: [-76.300, -76.299, -76.301, -76.299, -76.301, -76.299, -76.301, -76.299],
      },
    })
    const { ctx, tools, started } = makeCtx()
    apply(ctx)
    const followups: string[] = []
    const agentExec = {
      agent: {
        id: 'sess-scf',
        followup: (m: unknown) => { followups.push(JSON.stringify(m)) },
      },
    } as never
    await tools.get('mat_pool_start')!.execute({
      pool_id: 'pool-s', cluster_id: '11250',
      chains: [{ pkg_digest: DIGEST, workdir: '/w/A' }],
      max_concurrent: 1,
      max_wait_seconds: 200, // ~3 个 60s 采样窗后到期
      auto_rewatch_limit: 0,
    }, agentExec)
    await pump(started[0]!.hooks as DriverLike)
    // 振荡确认唤醒:带 kind/job/曲线摘要
    const scfAlert = followups.find((f) => f.includes('scf oscillating'))
    expect(scfAlert).toBeDefined()
    expect(scfAlert).toContain('wave job 901')
    // 窗口耗尽照常停链(watch_expired,通知 'still active')
    expect(followups.some((f) => f.includes('still active after the watch window'))).toBe(true)
    const chain = JSON.parse(readFileSync(join(testRoot, 'pipelines', 'pool-s-c1.json'), 'utf8'))
    expect(chain.phase).toBe('watch_expired')
  })
})
