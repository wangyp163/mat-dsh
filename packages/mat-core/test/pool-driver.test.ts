import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecResult } from '../src/client'
import { createPoolState } from '../src/pool'
import type { PoolState } from '../src/pool'
import { createPipelineState } from '../src/pipeline'
import type { PipelineState } from '../src/pipeline'
import { createPoolDriverHooks } from '../src/pool-driver'
import type { PipelineSubmitGate } from '../src/pipeline-driver'
import type { TaskPackage } from '../src/task-package'

/**
 * R6b pool driver（注入式集成）：
 * ① cap=2 时第三链的首个 sbatch 必须晚于前两链之一的结算（回填语义）；
 * ② halted 链不阻塞池；③ submitGate 拒绝 = 零集群副作用 + 该链 halted。
 */

function pkg(): TaskPackage {
  return {
    schema_version: 'aimater.taskpackage.v1', engine: 'gaussian', status: 'ready', task: 'tsxtb+ts+irc',
    waves: [
      { id: 1, task: 'tsxtb', dependsOn: [], gate: null, preJson: {}, runJson: {}, postJson: {}, reusable: false },
      { id: 2, task: 'ts', dependsOn: [1], gate: { converged: true, imaginary_frequency_count: 1 }, preJson: {}, runJson: {}, postJson: {}, reusable: false },
      { id: 3, task: 'irc', dependsOn: [2], gate: null, preJson: {}, runJson: {}, postJson: {}, reusable: false },
    ],
    questions: [], assumptions: [], estimatedCoreHours: 1, digest: 'd'.repeat(64), execution: { mode: 'stepwise', instructions: [] },
  }
}

const ok = (data: string): ExecResult => ({ code: 0, data, message: '' })

interface ChainKnobs {
  /** 每波终态(null=COMPLETED) */
  waveStates: Array<string | null>
  /** 每波 post properties(null=错误 post) */
  postProps: Array<Record<string, unknown> | null>
}

function greenKnobs(): ChainKnobs {
  return {
    waveStates: [null, null, null],
    postProps: [
      { 'tsxtb.energy': -76.4 },
      { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
      { 'irc.irc_point_count': 30 },
    ],
  }
}

interface Harness {
  driver: ReturnType<typeof createPoolDriverHooks>
  events: string[]
  pools: PoolState[]
  chains: Map<string, PipelineState[]>
}

function makeHarness(
  chainKnobs: Record<string, ChainKnobs>,
  cap: number,
  gates?: Map<string, PipelineSubmitGate>,
  notifyOn?: 'all' | 'actionable',
): Harness & { notifications: string[] } {
  const events: string[] = []
  const pools: PoolState[] = []
  const chains = new Map<string, PipelineState[]>()
  const notifications: string[] = []
  const workdirs = Object.keys(chainKnobs)
  // jobId 编码:900 + 链序*10 + 提交序——sacct 命令串不含 workdir,须按 jobId 反解链
  const chainOfWorkdir = (w: string): number => workdirs.indexOf(w)
  const workdirOfJob = (jobId: string): string => workdirs[Math.floor((Number(jobId) - 900) / 10)] ?? ''
  const workdirOf = (command: string): string | undefined => workdirs.find((w) => command.includes(w))
  const perChain = new Map<string, { submits: number; polls: Map<string, number> }>()
  for (const w of workdirs) perChain.set(w, { submits: 0, polls: new Map() })

  const exec = async (_clusterId: string, command: string): Promise<ExecResult> => {
    const sacctMatch = /sacct -j (\d+)/.exec(command)
    const w = sacctMatch !== null ? workdirOfJob(sacctMatch[1]!) : workdirOf(command)
    if (w === undefined || w === '') throw new Error(`unexpected command (no chain): ${command.slice(0, 90)}`)
    const st = perChain.get(w)!
    const knobs = chainKnobs[w]!
    if (command.includes('-p run')) return ok('rendered')
    if (command.includes('-p pre')) return ok('')
    if (command.startsWith('echo ')) return ok('')
    if (command.startsWith('printf ')) return ok('')
    if (command.includes('find ')) {
      st.submits += 1
      const task = st.submits === 1 ? 'tsxtb' : st.submits === 2 ? 'ts' : 'irc'
      return ok(`${w}/tsxtb+ts+irc/0${st.submits}-${task}/slurm.sh`)
    }
    if (command.includes('sbatch')) {
      events.push(`sbatch:${w}`)
      return ok(`Submitted batch job ${900 + chainOfWorkdir(w) * 10 + st.submits}`)
    }
    if (command.includes('sacct')) {
      const jobId = String(900 + chainOfWorkdir(w) * 10 + Math.max(st.submits, 1))
      const n = (st.polls.get(jobId) ?? 0) + 1
      st.polls.set(jobId, n)
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
    if (command.includes('tail -n')) return ok('Error termination request processed by link 9999')
    throw new Error(`unexpected command: ${command.slice(0, 90)}`)
  }

  const pool = createPoolState({
    poolId: 'pool-t',
    clusterId: '11250',
    chains: Object.keys(chainKnobs).map((w) => ({ workdir: w, pkgDigest: pkg().digest })),
    maxConcurrent: cap,
  })
  const driver = createPoolDriverHooks({
    pool,
    pkgOf: () => pkg(),
    stateOf: (pipelineId) => {
      const idx = Number(pipelineId.split('-c')[1]) - 1
      const workdir = Object.keys(chainKnobs)[idx]!
      const s = createPipelineState({ pipelineId, clusterId: '11250', workdir, pkg: pkg() })
      chains.set(pipelineId, [...(chains.get(pipelineId) ?? []), s])
      return s
    },
    execCommand: exec,
    maxWaitSeconds: 300,
    poolPersist: (p) => pools.push(p),
    chainPersist: (c) => chains.set(c.pipelineId, [...(chains.get(c.pipelineId) ?? []).slice(-1), c]),
    notify: (m: string) => { notifications.push(m) },
    ...(notifyOn !== undefined ? { notifyOn } : {}),
    ...(gates !== undefined ? { submitGateOf: (id) => gates.get(id) } : {}),
  })
  return { driver, events, pools, chains, notifications }
}

async function pump(done: Promise<unknown>, max = 400): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const fin = await Promise.race([done.then(() => true), vi.advanceTimersByTimeAsync(10_000).then(() => false)])
    if (fin) return
  }
  throw new Error('pump exhausted')
}

describe('createPoolDriverHooks', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('三链 cap=2:回填语义(第三链首个 sbatch 晚于任一前链结算)+ 全 done', async () => {
    const h = makeHarness({ '/w/A': greenKnobs(), '/w/B': greenKnobs(), '/w/C': greenKnobs() }, 2)
    await pump(h.driver.done)
    const outcome = await h.driver.done
    expect(outcome.status).toBe('completed')
    const final = h.pools[h.pools.length - 1]!
    expect(final.chains.every((c) => c.phase === 'done')).toBe(true)
    // 并发上限:第一个 C 的 sbatch 必须出现在 A 或 B 的首个 post(结算)之后
    const firstC = h.events.findIndex((e) => e === 'sbatch:/w/C')
    const firstSettle = h.events.findIndex((e) => e.startsWith('post:/w/') )
    expect(firstC).toBeGreaterThan(firstSettle)
    // 每链恰好 3 次 sbatch + 3 次 post
    for (const w of ['/w/A', '/w/B', '/w/C']) {
      expect(h.events.filter((e) => e === `sbatch:${w}`)).toHaveLength(3)
      expect(h.events.filter((e) => e === `post:${w}`)).toHaveLength(3)
    }
  })

  it('halted 链不阻塞池:其余链照常 done,池收口带 halted', async () => {
    const haltKnobs: ChainKnobs = {
      waveStates: [null, 'FAILED'],
      postProps: [{ 'tsxtb.energy': -76.4 }, null],
    }
    const h = makeHarness({ '/w/A': greenKnobs(), '/w/B': haltKnobs, '/w/C': greenKnobs() }, 3)
    await pump(h.driver.done)
    const outcome = await h.driver.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toContain('halted=1')
    expect(outcome.detail).toContain('done=2')
    const final = h.pools[h.pools.length - 1]!
    expect(final.chains.find((c) => c.pipelineId.includes('-c2'))!.phase).toBe('halted')
    // B 链没有第三次提交(halted 停在 wave2)
    expect(h.events.filter((e) => e === 'sbatch:/w/B')).toHaveLength(2)
  })

  it('submitGate 拒绝(BUDGET_REJECTED):该链零 sbatch、halted,池继续', async () => {
    const gates = new Map<string, PipelineSubmitGate>()
    gates.set('pool-t-c2', {
      check: () => { throw new Error('BUDGET_REJECTED: core-hour cap exceeded for task T2') },
      record: () => {},
    })
    const h = makeHarness({ '/w/A': greenKnobs(), '/w/B': greenKnobs(), '/w/C': greenKnobs() }, 3, gates)
    await pump(h.driver.done)
    const outcome = await h.driver.done
    expect(outcome.detail).toContain('halted=1')
    expect(outcome.detail).toContain('done=2')
    expect(h.events.filter((e) => e === 'sbatch:/w/B')).toHaveLength(0)
    const final = h.pools[h.pools.length - 1]!
    const halted = final.chains.find((c) => c.pipelineId.includes('-c2'))!
    expect(halted.phase).toBe('halted')
    expect(halted.outcome?.detail).toMatch(/BUDGET_REJECTED/)
  })

  it('B2 闸拒绝短路:首条 gate_rejected 结算即停 admit,未启动链留 pending 零副作用', async () => {
    // cap=2 三链:c1/c2 先进,c2 的提交闸首检即拒(预算耗尽)→ 池不再 admit c3。
    // c3 留 pending(修好闸后 reattach 一键重启),c1 照常跑完——闸拒绝不连坐
    // 在场链,也不把 N 条链逐条撞成 N 个 halted。
    const gates = new Map<string, PipelineSubmitGate>()
    gates.set('pool-t-c2', {
      check: () => { throw new Error('BUDGET_REJECTED: core-hour cap exceeded for task T2') },
      record: () => {},
    })
    const h = makeHarness({ '/w/A': greenKnobs(), '/w/B': greenKnobs(), '/w/C': greenKnobs() }, 2, gates)
    await pump(h.driver.done)
    const outcome = await h.driver.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toContain('admission halted')
    expect(outcome.detail).toContain('1 chain(s) unstarted')
    expect(outcome.detail).toMatch(/BUDGET_REJECTED/)
    expect(outcome.detail).toContain('reattach')
    const final = h.pools[h.pools.length - 1]!
    const phases = new Map(final.chains.map((c) => [c.pipelineId, c.phase]))
    expect(phases.get('pool-t-c1')).toBe('done')
    expect(phases.get('pool-t-c2')).toBe('halted')
    expect(phases.get('pool-t-c3')).toBe('pending')
    expect(h.events.filter((e) => e === 'sbatch:/w/C')).toHaveLength(0)
    // c2 零 sbatch
    expect(h.events.filter((e) => e === 'sbatch:/w/B')).toHaveLength(0)
  })

  it('B3 notify_on=actionable:completed 链零逐链唤醒,收口通知带汇总;all 保持旧行为', async () => {
    const quiet = makeHarness({ '/w/A': greenKnobs(), '/w/B': greenKnobs() }, 2, undefined, 'actionable')
    await pump(quiet.driver.done)
    // R-2:池层与链内 pipeline 层的逐链 completed 通知都为零
    expect(quiet.notifications.filter((n) => n.includes('chain pool-t-c'))).toHaveLength(0)
    expect(quiet.notifications.filter((n) => n.includes('chain completed'))).toHaveLength(0)
    expect(quiet.notifications.some((n) => n.includes('drained') && n.includes('done=2'))).toBe(true)

    const loud = makeHarness({ '/w/A': greenKnobs(), '/w/B': greenKnobs() }, 2, undefined, 'all')
    await pump(loud.driver.done)
    expect(loud.notifications.filter((n) => n.includes('chain pool-t-c') && n.includes('completed'))).toHaveLength(2)
    // 'all' 模式链内 pipeline 层的完成通知也在(旧行为)
    expect(loud.notifications.filter((n) => n.includes('chain completed'))).toHaveLength(2)

    // actionable 模式下 needs_llm 仍即时通知(有动作要坐)
    const haltKnobs: ChainKnobs = { waveStates: [null, 'FAILED'], postProps: [{ 'tsxtb.energy': -76.4 }, null] }
    const alerting = makeHarness({ '/w/A': greenKnobs(), '/w/B': haltKnobs }, 2, undefined, 'actionable')
    await pump(alerting.driver.done)
    expect(alerting.notifications.some((n) => n.includes('chain pool-t-c2 needs_llm'))).toBe(true)
  })

  it('submitGate check→record 成对:每次 sbatch 前检查、后记账', async () => {
    const checked: number[] = []
    const recorded: string[] = []
    const gates = new Map<string, PipelineSubmitGate>()
    gates.set('pool-t-c1', {
      check: () => { checked.push(checked.length) },
      record: (jobId) => { recorded.push(jobId) },
    })
    const h = makeHarness({ '/w/A': greenKnobs() }, 1, gates)
    await pump(h.driver.done)
    expect(checked).toHaveLength(3)
    expect(recorded).toHaveLength(3)
  })
})
