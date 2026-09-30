import { describe, expect, it } from 'vitest'
import type { TaskPackage } from '../src/task-package'
import {
  createPipelineState,
  isTerminalPhase,
  onCancelled,
  onDeadLettered,
  onDriverError,
  onNeedsLlm,
  onRetryScheduled,
  onSubmitIntent,
  onWatchExpired,
  onWaveSettledGateFail,
  onWaveSettledPassed,
  onWaveSubmitted,
  pipelineFromJson,
  pipelineToJson,
  reconcileSubmit,
  resumePipeline,
  stalePipeline,
} from '../src/pipeline'

/**
 * R6a pipeline 状态机（纯逻辑）：相位推进、失败环换档、needs_llm 接手面、
 * 死信终态、stale 判定与 JSON 往返。
 * 新增覆盖：提交幂等（submitting 相位 + pendingSubmit）、attempt cap 双重闸、
 * cancelled 终态、history 关键事件永久保留、reconcileSubmit adopt/resubmit。
 */

function pkg(): TaskPackage {
  return {
    schema_version: 'aimater.taskpackage.v1',
    engine: 'gaussian',
    status: 'ready',
    task: 'tsxtb+ts+irc',
    waves: [
      { id: 1, task: 'tsxtb', dependsOn: [], gate: null, preJson: {}, runJson: {}, postJson: {}, reusable: false },
      { id: 2, task: 'ts', dependsOn: [1], gate: { converged: true, imaginary_frequency_count: 1 }, preJson: {}, runJson: {}, postJson: {}, reusable: false },
      { id: 3, task: 'irc', dependsOn: [2], gate: null, preJson: {}, runJson: {}, postJson: {}, reusable: false },
    ],
    questions: [], assumptions: [], estimatedCoreHours: 18,
    digest: 'd'.repeat(64),
    execution: { mode: 'stepwise', instructions: [] },
  }
}

function fresh() {
  return createPipelineState({ pipelineId: 'pl-dddddddddddd', clusterId: '11250', workdir: '/home/u/w', pkg: pkg() })
}

describe('pipeline 状态机', () => {
  it('创建:planned、三波、attempt 全 0', () => {
    const s = fresh()
    expect(s.phase).toBe('planned')
    expect(s.currentWaveId).toBe(1)
    expect(s.waves.map((w) => w.task)).toEqual(['tsxtb', 'ts', 'irc'])
    expect(s.waves.every((w) => w.attempt === 0)).toBe(true)
  })

  it('提交→结算过门→逐波推进→末波 completed', () => {
    let s = onWaveSubmitted(fresh(), 1, '700')
    expect(s.phase).toBe('wave_submitted')
    expect(s.waves[0]!.attempt).toBe(1)
    s = onWaveSettledPassed(s, 1)
    expect(s.phase).toBe('planned')
    expect(s.currentWaveId).toBe(2)
    s = onWaveSubmitted(s, 2, '701')
    s = onWaveSettledPassed(s, 2)
    expect(s.currentWaveId).toBe(3)
    s = onWaveSubmitted(s, 3, '702')
    s = onWaveSettledPassed(s, 3)
    expect(s.phase).toBe('completed')
    expect(isTerminalPhase(s.phase)).toBe(true)
  })

  it('门检不过 → needs_llm 带原因(gate_failed 关键事件)', () => {
    let s = onWaveSubmitted(fresh(), 1, '700')
    s = onWaveSettledPassed(s, 1)
    s = onWaveSubmitted(s, 2, '701')
    s = onWaveSettledGateFail(s, 2, 'imaginary_frequency_count=0, gate requires 1（0 虚频=极小点）')
    expect(s.phase).toBe('needs_llm')
    expect(s.needsLlmReason).toMatch(/极小点/)
    // gate_failed 是关键事件，应出现在 history
    expect(s.history.some((h) => h.event === 'gate_failed')).toBe(true)
  })

  it('失败环换档:retrying 携带级号与 route;attempt 不清零', () => {
    let s = onWaveSubmitted(fresh(), 1, '700')
    s = onWaveSettledPassed(s, 1)
    s = onWaveSubmitted(s, 2, '701')
    s = onRetryScheduled(s, 2, 1, 'irc(CalcFC,MaxPoints=50,StepSize=5)')
    expect(s.phase).toBe('retrying')
    expect(s.waves[1]!.prescriptionLevel).toBe(1)
    expect(s.waves[1]!.prescriptionRoute).toBe('irc(CalcFC,MaxPoints=50,StepSize=5)')
    expect(s.waves[1]!.attempt).toBe(1)
    s = onWaveSubmitted(s, 2, '703')
    expect(s.waves[1]!.attempt).toBe(2)
    expect(s.waves[1]!.prescriptionLevel).toBe(1) // 档位保留
  })

  it('死信终态 + resume 面:retry/dead_letter/rewatch 的合法性', () => {
    let s = onWaveSubmitted(fresh(), 1, '700')
    expect(() => resumePipeline(s, { action: 'retry', route: 'x' })).toThrow(/needs_llm/)
    s = onNeedsLlm(s, '决策表命中,需要人工选行')
    s = resumePipeline(s, { action: 'retry', route: 'opt=(CalcFC,MaxPoints=50)' })
    expect(s.phase).toBe('retrying')
    s = onNeedsLlm(s, 'again')
    s = resumePipeline(s, { action: 'dead_letter', reason: 'no-kb-entry' })
    expect(s.phase).toBe('dead_lettered')
    expect(s.deadLetter?.reason).toBe('no-kb-entry')
    expect(isTerminalPhase(s.phase)).toBe(true)
    const s2 = onWaveSubmitted(fresh(), 1, '700')
    expect(resumePipeline(s2, { action: 'rewatch' }).phase).toBe('wave_submitted')
    expect(() => resumePipeline(fresh(), { action: 'rewatch' })).toThrow(/wave_submitted/)
  })

  it('B0 watch_expired:rewatch 是唯一出路;retry/dead_letter 拒绝;watchExpiries 记账与新作业清零', () => {
    let s = onWatchExpired(onWaveSubmitted(fresh(), 1, '700'), 1, 'watch window elapsed')
    expect(s.phase).toBe('watch_expired')
    expect(s.waves[0]!.jobId).toBe('700') // jobId 保留——rewatch 靠它接手
    expect(s.waves[0]!.watchExpiries).toBe(1)
    expect(s.waves[0]!.attempt).toBe(1) // 到期不是提交,attempt 不动
    expect(stalePipeline(s)).toBe(true)
    expect(isTerminalPhase(s.phase)).toBe(false)
    // fail-closed:作业可能在场,重提=双跑——retry/dead_letter 都拒绝
    expect(() => resumePipeline(s, { action: 'retry', route: 'x' })).toThrow(/needs_llm/)
    expect(() => resumePipeline(s, { action: 'dead_letter', reason: 'x' })).toThrow(/needs_llm/)
    // rewatch 放行,回到 wave_submitted;再次到期计数累加(预算跨续看持久)
    s = onWatchExpired(resumePipeline(s, { action: 'rewatch' }), 1, 'again')
    expect(s.phase).toBe('watch_expired')
    expect(s.waves[0]!.watchExpiries).toBe(2)
    // 新作业实例清零计数(换档重投后是新的 watch 预算)
    s = onWaveSubmitted(resumePipeline(s, { action: 'rewatch' }), 1, '701')
    expect(s.phase).toBe('wave_submitted')
    expect(s.waves[0]!.watchExpiries).toBeUndefined()
  })

  it('onDeadLettered 保留 kbId;stale = wave_submitted 或 submitting 或 pendingSubmit 在场', () => {
    const s = onDeadLettered(fresh(), 'ladder-exhausted: kb:irc-l123-divergence', 'irc-l123-divergence')
    expect(s.deadLetter).toEqual({ reason: 'ladder-exhausted: kb:irc-l123-divergence', kbId: 'irc-l123-divergence' })
    expect(stalePipeline(onWaveSubmitted(fresh(), 1, '700'))).toBe(true)
    expect(stalePipeline(fresh())).toBe(false)
    // submitting 也是 stale
    expect(stalePipeline(onSubmitIntent(fresh(), 1))).toBe(true)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // P1 新增：提交幂等（submitting + pendingSubmit）
  // ─────────────────────────────────────────────────────────────────────────

  it('onSubmitIntent → phase=submitting, pendingSubmit 在场,attempt 未增', () => {
    const s = onSubmitIntent(fresh(), 1)
    expect(s.phase).toBe('submitting')
    expect(s.pendingSubmit).toBeDefined()
    expect(s.pendingSubmit!.waveId).toBe(1)
    expect(s.pendingSubmit!.attempt).toBe(1)   // 预告下一次 attempt
    expect(s.waves[0]!.attempt).toBe(0)        // 确认前不增
    expect(s.history.some((h) => h.event === 'submit_intent')).toBe(true)
  })

  it('onWaveSubmitted 清除 pendingSubmit，attempt +1', () => {
    let s = onSubmitIntent(fresh(), 1)
    s = onWaveSubmitted(s, 1, '700')
    expect(s.pendingSubmit).toBeUndefined()
    expect(s.phase).toBe('wave_submitted')
    expect(s.waves[0]!.attempt).toBe(1)
  })

  it('reconcileSubmit adopt:接手 jobId → wave_submitted, attempt +1', () => {
    let s = onSubmitIntent(fresh(), 1)
    s = reconcileSubmit(s, { kind: 'adopt', jobId: '999' })
    expect(s.phase).toBe('wave_submitted')
    expect(s.waves[0]!.jobId).toBe('999')
    expect(s.waves[0]!.attempt).toBe(1)
    expect(s.pendingSubmit).toBeUndefined()
  })

  it('reconcileSubmit resubmit:清意图 → planned(无处方) 或 retrying(有处方)', () => {
    const s0 = onSubmitIntent(fresh(), 1)
    const back = reconcileSubmit(s0, { kind: 'resubmit', note: 'confirmed no job' })
    expect(back.phase).toBe('planned')
    expect(back.pendingSubmit).toBeUndefined()

    // 有处方时回 retrying
    let sR = onRetryScheduled(fresh(), 1, 1, 'opt=(CalcFC)')
    sR = onSubmitIntent(sR, 1, 'opt=(CalcFC)')
    const backR = reconcileSubmit(sR, { kind: 'resubmit' })
    expect(backR.phase).toBe('retrying')
  })

  it('reconcileSubmit 无 pendingSubmit 时抛错', () => {
    expect(() => reconcileSubmit(fresh(), { kind: 'adopt', jobId: 'x' })).toThrow(/no pending submit/)
    expect(() => reconcileSubmit(onWaveSubmitted(fresh(), 1, '700'), { kind: 'resubmit' })).toThrow(/no pending submit/)
  })

  it('resumePipeline adopt/resubmit 需要 pendingSubmit', () => {
    // needs_llm 但无 pendingSubmit → 拒绝 adopt
    const s = onNeedsLlm(fresh(), 'x')
    expect(() => resumePipeline(s, { action: 'adopt', jobId: 'x' })).toThrow(/pending submit/)
    // submitting 有 pendingSubmit → adopt 成功
    const s2 = onSubmitIntent(fresh(), 1)
    const after = resumePipeline(s2, { action: 'adopt', jobId: '888' })
    expect(after.phase).toBe('wave_submitted')
    expect(after.waves[0]!.jobId).toBe('888')
  })

  it('pipelineFromJson 校验 pendingSubmit 一致性', () => {
    // 正常：pendingSubmit.attempt = wave.attempt + 1
    const s = onSubmitIntent(fresh(), 1)
    expect(pipelineFromJson(pipelineToJson(s))).toMatchObject({ phase: 'submitting' })

    // 损坏：attempt 不一致
    const broken = JSON.parse(pipelineToJson(s)) as ReturnType<typeof pipelineFromJson>
    broken.pendingSubmit!.attempt = 99
    expect(() => pipelineFromJson(JSON.stringify(broken))).toThrow(/inconsistent/)

    // 损坏：waveId 不存在
    const broken2 = JSON.parse(pipelineToJson(s)) as ReturnType<typeof pipelineFromJson>
    broken2.pendingSubmit!.waveId = 999
    expect(() => pipelineFromJson(JSON.stringify(broken2))).toThrow(/unknown wave/)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // P1 新增：attempt cap 对 LLM resume 路径的双重闸
  // ─────────────────────────────────────────────────────────────────────────

  it('resumePipeline retry:attempt 达上限时拒绝,不允许绕过', () => {
    // maxAttemptsPerWave=2，手动打满
    let s = createPipelineState({ pipelineId: 'pl-cap', clusterId: '11250', workdir: '/w', pkg: pkg(), maxAttemptsPerWave: 2 })
    s = onWaveSubmitted(s, 1, '700')
    s = onWaveSubmitted(s, 1, '701') // attempt = 2（内部函数允许重复提交做测试）
    s = onNeedsLlm(s, 'failed')
    expect(() => resumePipeline(s, { action: 'retry', route: 'x' })).toThrow(/attempt-cap/)
    // 同一 wave attempt=1 时不拒绝
    let s2 = createPipelineState({ pipelineId: 'pl-cap2', clusterId: '11250', workdir: '/w', pkg: pkg(), maxAttemptsPerWave: 2 })
    s2 = onWaveSubmitted(s2, 1, '700') // attempt=1
    s2 = onNeedsLlm(s2, 'failed')
    expect(() => resumePipeline(s2, { action: 'retry', route: 'opt=(CalcFC)' })).not.toThrow()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // P3 新增：cancelled 终态 + history 关键事件永久保留
  // ─────────────────────────────────────────────────────────────────────────

  it('onCancelled → phase=cancelled, isTerminalPhase=true, jobId 提示在 history detail', () => {
    let s = onWaveSubmitted(fresh(), 1, '700')
    s = onCancelled(s, 'cancelled by user')
    expect(s.phase).toBe('cancelled')
    expect(isTerminalPhase(s.phase)).toBe(true)
    expect(s.history.some((h) => h.event === 'cancelled')).toBe(true)
    // detail 含 scancel 提示
    const h = s.history.find((h) => h.event === 'cancelled')!
    expect(h.detail).toMatch(/scancel/)
  })

  it('onDriverError:needsLlmReason 包含 pendingSubmit 孤儿作业警告', () => {
    const s0 = onSubmitIntent(fresh(), 1)
    const s = onDriverError(s0, 'network timeout')
    expect(s.phase).toBe('needs_llm')
    expect(s.needsLlmReason).toMatch(/UNRESOLVED SUBMIT/)
    expect(s.needsLlmReason).toMatch(/reconcile/)
    expect(s.history.some((h) => h.event === 'driver_error')).toBe(true)
  })

  it('history 关键事件在大量常规事件后仍然保留', () => {
    let s = fresh()
    // created 是关键事件（在初始 history 里）
    expect(s.history.some((h) => h.event === 'created' && h.critical === true)).toBe(true)

    // 用 onNeedsLlm 产生大量常规历史把滚动窗口塞满
    for (let i = 0; i < 120; i++) {
      s = { ...s, history: [...s.history, { ts: Date.now() + i, event: 'wave_advanced', detail: `iter ${i}` }] }
    }

    // 触发 gate_failed（关键事件）
    s = onWaveSubmitted(s, 1, '700')
    s = onWaveSettledGateFail(s, 1, 'converged=false')

    // 经过剪枝（对 next 的调用内部发生）：关键事件仍在
    expect(s.history.some((h) => h.event === 'created')).toBe(true)
    expect(s.history.some((h) => h.event === 'gate_failed')).toBe(true)
    // 常规事件被截断到 ROUTINE_LIMIT=100 条
    const routine = s.history.filter((h) => h.critical !== true)
    expect(routine.length).toBeLessThanOrEqual(100)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 已有：JSON 往返与坏输入拒绝
  // ─────────────────────────────────────────────────────────────────────────

  it('JSON 往返;坏 schema / 缺字段 / 空 waves 拒绝', () => {
    const s = fresh()
    expect(pipelineFromJson(pipelineToJson(s))).toEqual(s)
    expect(() => pipelineFromJson('{"schema_version":"x"}')).toThrow(/schema_version/)
    expect(() => pipelineFromJson(JSON.stringify({ ...s, waves: [] }))).toThrow(/non-empty/)
    expect(() => pipelineFromJson(JSON.stringify({ ...s, pipelineId: undefined }))).toThrow(/pipelineId/)
  })
})
