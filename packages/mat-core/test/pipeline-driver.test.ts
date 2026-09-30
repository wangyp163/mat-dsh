import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecResult } from '../src/client'
import { createPipelineState, onSubmitIntent, onWaveSubmitted, onWatchExpired, resumePipeline } from '../src/pipeline'
import type { PipelineState } from '../src/pipeline'
import { createPipelineDriverHooks, selectWaveStepDir } from '../src/pipeline-driver'
import type { PipelineDriverInput, PipelineDiagnoseHit } from '../src/pipeline-driver'
import type { TaskPackage } from '../src/task-package'

/**
 * R6a pipeline driver（注入式集成）:三波链全绿 / ts 虚频=0 → needs_llm /
 * 处方梯自动换档重试 / 梯尽死信。execCommand 全 mock,定时器伪时钟泵进。
 */

const WORKDIR = '/home/u/w'

function pkg(): TaskPackage {
  return {
    schema_version: 'aimater.taskpackage.v1',
    engine: 'gaussian',
    status: 'ready',
    task: 'tsxtb+ts+irc',
    waves: [
      { id: 1, task: 'tsxtb', dependsOn: [], gate: null, preJson: { x: 1 }, runJson: {}, postJson: {}, reusable: false },
      { id: 2, task: 'ts', dependsOn: [1], gate: { converged: true, imaginary_frequency_count: 1 }, preJson: { x: 1 }, runJson: {}, postJson: {}, reusable: false },
      { id: 3, task: 'irc', dependsOn: [2], gate: null, preJson: { x: 1 }, runJson: {}, postJson: {}, reusable: false },
    ],
    questions: [], assumptions: [], estimatedCoreHours: 18,
    digest: 'e'.repeat(64),
    execution: { mode: 'stepwise', instructions: [] },
  }
}

const LADDER_HIT: PipelineDiagnoseHit = {
  id: 'irc-l123-divergence',
  path: 'skills/gaussian-calc/references/errors/irc-l123-divergence.md',
  prescription: [
    { level: 1, route: 'irc(CalcFC,MaxPoints=50,StepSize=5)', when: '第一档' },
    { level: 2, route: 'irc(CalcAll,MaxPoints=50,StepSize=5)', when: '重算 Hessian' },
  ],
}

interface Mock {
  /** 每波 post 输出的 properties(按波序) */
  postProperties: Array<Record<string, unknown> | null>
  /** 每波终态(null=COMPLETED;字符串=FAILED 等终态) */
  waveStates: Array<string | null>
  diagnoseHits: PipelineDiagnoseHit[]
  /** true=sacct 永远回 RUNNING(作业不结束),用于验证 watch 超时是暂停而非失败 */
  neverSettles?: boolean
  /** 第一波作业在前 N 次轮询内一直 RUNNING,第 N 次起按 waveStates 结算(用于超时后续看) */
  settleAfterPolls?: number
}

function ok(data: string): ExecResult {
  return { code: 0, data, message: '' }
}

function makeExec(knobs: Mock) {
  const commands: string[] = []
  let submitCount = 0
  const polls = new Map<string, number>()
  const exec = async (_clusterId: string, command: string): Promise<ExecResult> => {
    commands.push(command)
    if (command.includes('-p run')) return ok('rendered')
    if (command.includes('-p pre')) return ok('')
    if (command.startsWith('echo ')) return ok('')
    if (command.startsWith('printf ')) return ok('')
    if (command.includes('find ')) {
      submitCount += 1
      const task = submitCount === 1 ? 'tsxtb' : submitCount === 2 ? 'ts' : 'irc'
      return ok(`${WORKDIR}/tsxtb+ts+irc/0${submitCount}-${task}/slurm.sh`)
    }
    if (command.includes('sbatch')) return ok(`Submitted batch job ${800 + submitCount}`)
    if (command.includes('sacct')) {
      const jobId = String(800 + Math.max(submitCount, 1))
      const n = (polls.get(jobId) ?? 0) + 1
      polls.set(jobId, n)
      // 作业永不结束（排队/长算）——watch 会走 max-wait 结算路径
      if (knobs.neverSettles === true) return ok(`${jobId}|RUNNING|0:0|30|${WORKDIR}`)
      // 第一波的前 N-1 次轮询持续 RUNNING(跨 driver/续看共享计数,模拟长排队后终态)
      if (knobs.settleAfterPolls !== undefined && submitCount <= 1 && n < knobs.settleAfterPolls) {
        return ok(`${jobId}|RUNNING|0:0|30|${WORKDIR}`)
      }
      const waveIdx = Math.min(submitCount, knobs.waveStates.length) - 1
      const terminal = knobs.waveStates[waveIdx] ?? null
      const state = n === 1 && terminal === null ? 'RUNNING' : (terminal ?? 'COMPLETED')
      return ok(`${jobId}|${state}|0:0|30|${WORKDIR}`)
    }
    if (command.includes('-p post')) {
      const waveIdx = Math.min(submitCount, knobs.postProperties.length) - 1
      const props = knobs.postProperties[waveIdx]
      if (props === null || props === undefined) {
        return ok('[post] parsing\n{"status": "error", "error": "post failed"}')
      }
      return ok(`[post] parsing\n${JSON.stringify({ status: 'ok', phase: 'post', properties: props })}`)
    }
    if (command.includes('tail -n')) return ok('Error termination request processed by link 9999')
    throw new Error(`unexpected command: ${command.slice(0, 100)}`)
  }
  return { exec, commands }
}

function makeDriver(knobs: Mock, extra: Partial<PipelineDriverInput> = {}) {
  const { exec, commands } = makeExec(knobs)
  const persistStates: PipelineState[] = []
  const deadLetters: Array<{ jobId: string; reason: string; kbId?: string }> = []
  const notifications: string[] = []
  const state = createPipelineState({ pipelineId: 'pl-test', clusterId: '11250', workdir: WORKDIR, pkg: pkg() })
  const driver = createPipelineDriverHooks({
    state,
    pkg: pkg(),
    execCommand: exec,
    maxWaitSeconds: 300,
    ...(knobs.diagnoseHits.length > 0 ? { diagnose: () => knobs.diagnoseHits } : {}),
    persist: (s) => persistStates.push(s),
    markDeadLetter: (jobId, reason, kbId) => deadLetters.push({ jobId, reason, ...(kbId !== undefined ? { kbId } : {}) }),
    notify: (m) => notifications.push(m),
    ...extra,
  })
  return { driver, exec, commands, persistStates, deadLetters, notifications }
}

async function pump(done: Promise<unknown>, max = 200): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const finished = await Promise.race([done.then(() => true), vi.advanceTimersByTimeAsync(10_000).then(() => false)])
    if (finished) return
  }
  throw new Error('pump exhausted')
}

/** pump 到 done 并取结算(新用例统一入口)。 */
async function outcomeOf(driver: { done: Promise<{ status: string; detail: string }> }) {
  await pump(driver.done)
  return driver.done
}

describe('createPipelineDriverHooks', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('三波全绿:completed,attempts 记账与门检推进', async () => {
    const knobs: Mock = {
      postProperties: [
        { 'tsxtb.energy': -76.4 },
        { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
        { 'irc.irc_point_count': 30 },
      ],
      waveStates: [null, null, null],
      diagnoseHits: [],
    }
    const { driver, commands, persistStates, notifications } = makeDriver(knobs)
    const outcome = await (async () => {
      const p = pump(driver.done)
      const r = await driver.done
      await p
      return r
    })()
    expect(outcome.status).toBe('completed')
    const final = persistStates[persistStates.length - 1]!
    expect(final.phase).toBe('completed')
    // 每波一条 attempts 行
    expect(commands.filter((c) => c.startsWith('printf '))).toHaveLength(3)
    expect(commands.filter((c) => c.includes('sbatch'))).toHaveLength(3)
    expect(notifications.some((n) => n.includes('chain completed'))).toBe(true)
  })

  it('ts 虚频=0:门检不过 → needs_llm 停链,不开 irc', async () => {
    const knobs: Mock = {
      postProperties: [
        { 'tsxtb.energy': -76.4 },
        { 'ts.converged': true, 'ts.imaginary_frequency_count': 0 },
      ],
      waveStates: [null, null],
      diagnoseHits: [],
    }
    const { driver, commands, persistStates, notifications } = makeDriver(knobs)
    await pump(driver.done)
    const outcome = await driver.done
    expect(outcome.status).toBe('needs_llm')
    expect(outcome.detail).toMatch(/imaginary_frequency_count=0/)
    const final = persistStates[persistStates.length - 1]!
    expect(final.phase).toBe('needs_llm')
    // 只提交了两波(tsxtb+ts),irc 未开
    expect(commands.filter((c) => c.includes('sbatch'))).toHaveLength(2)
    expect(notifications.some((n) => n.includes('gate failed'))).toBe(true)
  })

  it('FAILED+处方梯:自动换档重渲染(pre.json 覆写)→过门推进', async () => {
    const knobs: Mock = {
      // wave2(ts) 首次 FAILED,重试档 1 后过门
      waveStates: [null, 'FAILED', null, null],
      postProperties: [
        { 'tsxtb.energy': -76.4 },
        null,
        { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
        { 'irc.irc_point_count': 30 },
      ],
      diagnoseHits: [LADDER_HIT],
    }
    const { driver, commands, persistStates } = makeDriver(knobs)
    await pump(driver.done)
    const outcome = await driver.done
    expect(outcome.status).toBe('completed')
    const final = persistStates[persistStates.length - 1]!
    expect(final.phase).toBe('completed')
    const tsWave = final.waves.find((w) => w.task === 'ts')!
    expect(tsWave.attempt).toBe(2)
    expect(tsWave.prescriptionLevel).toBe(1)
    expect(tsWave.prescriptionRoute).toBe('irc(CalcFC,MaxPoints=50,StepSize=5)')
    // pre.json 覆写 + pre 重跑发生过
    expect(commands.some((c) => c.startsWith('echo ') && c.includes('"irc":"irc(CalcFC,MaxPoints=50,StepSize=5)"'))).toBe(true)
    expect(commands.some((c) => c.includes('-p pre'))).toBe(true)
  })

  it('梯尽:dead_lettered + markDeadLetter(ladder-exhausted)', async () => {
    const knobs: Mock = {
      waveStates: ['FAILED', 'FAILED', 'FAILED'],
      postProperties: [null, null, null],
      diagnoseHits: [LADDER_HIT], // 只有 2 级
    }
    const { driver, deadLetters, persistStates } = makeDriver(knobs)
    await pump(driver.done)
    const outcome = await driver.done
    expect(outcome.status).toBe('dead_lettered')
    expect(outcome.detail).toBe('ladder-exhausted: kb:irc-l123-divergence')
    expect(deadLetters).toHaveLength(1)
    expect(deadLetters[0]!.reason).toBe('ladder-exhausted: kb:irc-l123-divergence')
    expect(persistStates[persistStates.length - 1]!.phase).toBe('dead_lettered')
  })

  it('FAILED 无梯进(决策行):needs_llm 不自动重试', async () => {
    const knobs: Mock = {
      waveStates: [null, 'FAILED'],
      postProperties: [{ 'tsxtb.energy': -76.4 }, null],
      diagnoseHits: [{ id: 'ts-step-limit', path: 'p', prescription: [{ match: '震荡', route: 'calcall' }] }],
    }
    const { driver, commands } = makeDriver(knobs)
    await pump(driver.done)
    const outcome = await driver.done
    expect(outcome.status).toBe('needs_llm')
    expect(outcome.detail).toMatch(/no ordered ladder/)
    expect(outcome.detail).toMatch(/attempt 1/) // R-5:失败环消息带尝试序号
    // 未自动重渲染(无 pre.json 覆写)
    expect(commands.some((c) => c.startsWith('echo ') && c.includes('pre.json'))).toBe(false)
  })

  it('悬挂提交在场:driver 立即转 needs_llm 拒绝重投(防双跑)', async () => {
    const knobs: Mock = {
      postProperties: [{ 'tsxtb.energy': -76.4 }],
      waveStates: [null],
      diagnoseHits: [],
    }
    // 注入已带 pendingSubmit 的 state：模拟 sbatch 发出后进程崩溃、重起 driver
    const { driver, commands, notifications } = makeDriver(knobs, {
      state: onSubmitIntent(
        createPipelineState({ pipelineId: 'pl-test', clusterId: '11250', workdir: WORKDIR, pkg: pkg() }),
        1,
      ),
    })
    await pump(driver.done)
    const outcome = await driver.done
    expect(outcome.status).toBe('needs_llm')
    expect(outcome.detail).toMatch(/unresolved submit intent/)
    expect(outcome.detail).toMatch(/adopt/)
    // 关键:一次 sbatch 都没有发出
    expect(commands.filter((c) => c.includes('sbatch'))).toHaveLength(0)
    expect(notifications.some((n) => n.includes('unresolved submit intent'))).toBe(true)
  })

  it('watch 窗口耗尽:停在 watch_expired(非 needs_llm),不进失败环、不重投、不耗 attempt', async () => {
    // 坑 2（2026-09-23 核查）：watch-loop 的 max-wait 以 status='completed' 结算
    // 但不触发 onAllSettled（无 post、无 slurm_state 行）。driver 旧代码把它兜成
    // UNKNOWN 送进失败环——一个仍在集群上正常排队/计算的作业被判失败，10 条链
    // 共用队列时几乎必然触发。正确语义是暂停：作业还在，我们只是不再等。
    // B0（2026-09-30）：暂停相位从 needs_llm 改为 watch_expired——needs_llm 下
    // resumePipeline 的 rewatch 会拒(只收 wave_submitted),恢复路径断裂,池层
    // 只剩会双跑的 retry。watch_expired 只放行 rewatch,fail-closed。
    const knobs: Mock = {
      postProperties: [{ 'tsxtb.energy': -76.4 }],
      waveStates: [null],
      diagnoseHits: [LADDER_HIT], // 即便有可用处方梯,也不该被当失败去换档
      neverSettles: true,
    }
    const { driver, commands, persistStates, notifications } = makeDriver(knobs, { maxWaitSeconds: 60 })
    const outcome = await (async () => {
      const p = pump(driver.done)
      const r = await driver.done
      await p
      return r
    })()

    expect(outcome.status).toBe('needs_llm')
    // 措辞必须明说「不是失败」并指向 rewatch,否则模型会去重投
    expect(outcome.detail).toMatch(/still active after the watch window/)
    expect(outcome.detail).toMatch(/expiry #1/) // R-5:重复事件带序号,防误读为重放
    expect(outcome.detail).toMatch(/NOT a failure/)
    expect(outcome.detail).toMatch(/rewatch/)
    expect(outcome.detail).toMatch(/do NOT resubmit/)

    const final = persistStates[persistStates.length - 1]!
    expect(final.phase).toBe('watch_expired')
    // 第一波的 jobId 仍在状态里(rewatch 要靠它接手),watchExpiries 记账
    const wave1 = final.waves.find((w) => w.waveId === 1)!
    expect(wave1.jobId).toBe('801')
    expect(wave1.watchExpiries).toBe(1)
    // 只提交过一次:没有因「失败」而换档重投
    expect(commands.filter((c) => c.includes('sbatch'))).toHaveLength(1)
    expect(wave1.attempt).toBe(1)
    // 没有走处方梯(prescriptionLevel 未被设置)
    expect(wave1.prescriptionLevel).toBeUndefined()
    expect(notifications.some((n) => n.includes('still active'))).toBe(true)
  })

  it('B0 验收:超时停链 → resume rewatch → 原样重挂同一 jobId,零新 sbatch,链走完', async () => {
    // 恢复路径闭环:watch_expired → resumePipeline(rewatch) → 新 driver 接手。
    // 关键断言:第一波不被重提交(双跑红线),监控续上后链正常推进到 completed。
    const knobs: Mock = {
      postProperties: [
        { 'tsxtb.energy': -76.4 },
        { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
        { 'irc.irc_point_count': 30 },
      ],
      waveStates: [null, null, null],
      diagnoseHits: [],
      settleAfterPolls: 8, // 首窗 60s/10s 档约 6-7 轮耗尽,第 8 轮起(续看窗内)结算
    }
    const { driver, exec, commands, persistStates } = makeDriver(knobs, { maxWaitSeconds: 60 })
    await pump(driver.done)
    const parked = persistStates[persistStates.length - 1]!
    expect(parked.phase).toBe('watch_expired')

    const resumed = resumePipeline(parked, { action: 'rewatch' })
    expect(resumed.phase).toBe('wave_submitted')
    expect(resumed.waves.find((w) => w.waveId === 1)!.watchExpiries).toBe(1) // 预算计数保留

    // 第二个 driver 从 resume 状态接手——共用同一 exec mock,轮询计数延续
    const persist2: PipelineState[] = []
    const driver2 = createPipelineDriverHooks({
      state: resumed,
      pkg: pkg(),
      execCommand: exec,
      maxWaitSeconds: 60,
      persist: (s) => persist2.push(s),
      notify: () => {},
    })
    await pump(driver2.done)
    const outcome = await driver2.done
    expect(outcome.status).toBe('completed')
    expect(persist2[persist2.length - 1]!.phase).toBe('completed')
    // 三波各恰好一次 sbatch:第一波没有因超时被重投
    expect(commands.filter((c) => c.includes('sbatch'))).toHaveLength(3)
  })

  it('B1 自动续看:窗口耗尽在预算内原样重挂(limit=2 → 两次到期自动续,不惊动 LLM)', async () => {
    const knobs: Mock = {
      postProperties: [
        { 'tsxtb.energy': -76.4 },
        { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
        { 'irc.irc_point_count': 30 },
      ],
      waveStates: [null, null, null],
      diagnoseHits: [],
      settleAfterPolls: 13, // 前两窗(各约 6 轮)耗尽,第三窗内结算
    }
    const { driver, commands, persistStates, notifications } = makeDriver(knobs, {
      maxWaitSeconds: 60,
      autoRewatchLimit: 2,
    })
    const outcome = await outcomeOf(driver)
    expect(outcome.status).toBe('completed') // 全程零 needs_llm
    const final = persistStates[persistStates.length - 1]!
    expect(final.phase).toBe('completed')
    const wave1 = final.waves.find((w) => w.waveId === 1)!
    expect(wave1.watchExpiries).toBe(2) // 两次到期都自动续了
    expect(commands.filter((c) => c.includes('sbatch'))).toHaveLength(3) // 零重投
    expect(notifications.some((n) => n.includes('still active'))).toBe(false) // 未惊动 LLM
  })

  it('B1 预算耗尽:第 limit+1 次到期停给 LLM(watch_expired),不重投', async () => {
    const knobs: Mock = {
      postProperties: [{ 'tsxtb.energy': -76.4 }],
      waveStates: [null],
      diagnoseHits: [],
      neverSettles: true,
    }
    const { driver, commands, persistStates } = makeDriver(knobs, {
      maxWaitSeconds: 60,
      autoRewatchLimit: 1,
    })
    const outcome = await outcomeOf(driver)
    expect(outcome.status).toBe('needs_llm')
    expect(outcome.detail).toMatch(/expiry #2 of a 2-window budget/) // R-5:预算口径进消息
    const final = persistStates[persistStates.length - 1]!
    expect(final.phase).toBe('watch_expired')
    expect(final.waves.find((w) => w.waveId === 1)!.watchExpiries).toBe(2) // 第 1 次自动续,第 2 次停
    expect(commands.filter((c) => c.includes('sbatch'))).toHaveLength(1)
  })

  it('B0 崩溃恢复:driver 直接从 watch_expired 状态启动 → 重挂现有 jobId,零 sbatch', async () => {
    // 宿主重启/池 reattach 后,链状态已是 watch_expired(jobId 在场):driver
    // 不得重提交,应直接接手监控。
    const knobs: Mock = {
      postProperties: [{ 'tsxtb.energy': -76.4 }],
      waveStates: [null],
      diagnoseHits: [],
      neverSettles: true,
    }
    const base = createPipelineState({ pipelineId: 'pl-test', clusterId: '11250', workdir: WORKDIR, pkg: pkg() })
    const expired = onWatchExpired(onWaveSubmitted(base, 1, '801'), 1, 'window elapsed in a previous life')
    const { exec, commands: execCommands } = makeExec(knobs)
    const driver = createPipelineDriverHooks({
      state: expired,
      pkg: pkg(),
      execCommand: exec,
      maxWaitSeconds: 60,
      persist: () => {},
      notify: () => {},
    })
    const outcome = await outcomeOf(driver)
    expect(outcome.status).toBe('needs_llm') // 首个窗口耗尽(无自动续看预算),停给 LLM
    // 关键:一次 sbatch 都没有——watch_expired 启动 = 纯接手监控
    expect(execCommands.filter((c) => c.includes('sbatch'))).toHaveLength(0)
    expect(outcome.detail).toMatch(/job 801 still active/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// selectWaveStepDir：替代旧 `tail -1` 字典序猜测的显式选择规则
// ─────────────────────────────────────────────────────────────────────────────

describe('selectWaveStepDir', () => {
  it('task 名命中:取该 task 的 step 目录', () => {
    const scripts = ['/w/tsxtb+ts+irc/01-tsxtb/slurm.sh', '/w/tsxtb+ts+irc/02-ts/slurm.sh']
    expect(selectWaveStepDir(scripts, 'ts', 2)).toBe('/w/tsxtb+ts+irc/02-ts')
  })

  it('关键回归:tsxtb 波不会被 ts 的目录截获(前缀不等于边界匹配)', () => {
    const scripts = ['/w/tsxtb+ts+irc/01-tsxtb/slurm.sh', '/w/tsxtb+ts+irc/02-ts/slurm.sh']
    // 旧 tail -1 在此会错选 02-ts;边界匹配保证 tsxtb 选到自己
    expect(selectWaveStepDir(scripts, 'tsxtb', 1)).toBe('/w/tsxtb+ts+irc/01-tsxtb')
  })

  it('多个同 task 命中(重渲染):取字典序最大者', () => {
    const scripts = ['/w/t/02-ts/slurm.sh', '/w/t/02-ts-retry/slurm.sh']
    expect(selectWaveStepDir(scripts, 'ts', 2)).toBe('/w/t/02-ts-retry')
  })

  it('无 task 命中时 fallback 字典序最大(不静默失败)', () => {
    const scripts = ['/w/t/01-tsxtb/slurm.sh', '/w/t/99-unknown/slurm.sh']
    expect(selectWaveStepDir(scripts, 'irc', 3)).toBe('/w/t/99-unknown')
  })

  it('task 匹配不区分大小写', () => {
    const scripts = ['/w/t/01-TSXTB/slurm.sh', '/w/t/02-TS/slurm.sh']
    expect(selectWaveStepDir(scripts, 'ts', 2)).toBe('/w/t/02-TS')
  })
})
