/**
 * 单链 pipeline 状态机（审阅表 R6a 一期：流水线让代码开，AI 只站两端和急诊室）。
 *
 * 纯逻辑（零 cordis/IO 依赖）：远端执行、定时器、持久化、通知全部由
 * pipeline-driver 注入；状态外置 pipeline.json（宿主侧 persist 钩子落盘，
 * .part+rename 原子写与 jobs.json 同策略）。
 *
 * 相位生命周期：
 *   planned → submitting → wave_submitted →（结算+门检）→ 下一波 planned … → completed
 *                ↘ FAILED → retrying（处方梯换档重渲染）→ submitting
 *                ↘ 门检不过/无梯进可循 → needs_llm（F2 诊断位，等待会话 resume）
 *                ↘ watch 窗口耗尽（作业仍在集群）→ watch_expired（作业在场、监控不在场，
 *                     唯一出路 resume rewatch 原样重挂——重投=双跑，fail-closed）
 *                ↘ 梯进耗尽/attempt 上限 → dead_lettered（no-workaround 终态）
 *                ↘ 用户取消 → cancelled
 *
 * 提交幂等（关键）：sbatch 有远端副作用，而状态落盘在其后——两者之间崩溃会
 * 留下「集群有作业、状态说没提交」的窗口。故提交前先写 submitting 相位并记
 * pendingSubmit（意图），确认拿到 jobId 后才 onWaveSubmitted（attempt 此刻才 +1）。
 * 崩溃后 pendingSubmit 仍在场，会话必须经 resumePipeline 的 adopt/resubmit 显式
 * 收口——不猜、不重复提交（fail-closed，宁停一次集群核时）。
 *
 * R6b（批量任务池）预留：waves 结构按单链设计，多链并发=外层任务池
 * （pending/running/done + 信号量）——见 pool.ts。
 */

import type { TaskPackage } from './task-package.ts'

export type PipelinePhase =
  | 'planned'
  | 'submitting'
  | 'wave_submitted'
  | 'watch_expired'
  | 'retrying'
  | 'needs_llm'
  | 'dead_lettered'
  | 'completed'
  | 'cancelled'

export interface PipelineWaveState {
  waveId: number
  task: string
  jobId?: string
  /** 本波已提交确认次数（含首次；R3 自动记账同源口径）。 */
  attempt: number
  /** 失败环当前处方档（有序梯 level；决策行/无梯进不设）。 */
  prescriptionLevel?: number
  /** 当前档 route（重渲染时写入 pre.json 的路由键值）。 */
  prescriptionRoute?: string
  /**
   * 当前 job 实例的 watch 窗口耗尽次数（onWatchExpired 递增；onWaveSubmitted 清零）。
   * 跨重启持久：driver 据此实施 autoRewatchLimit 预算，崩溃后恢复不重置。
   */
  watchExpiries?: number
}

/**
 * 提交意图：sbatch 发出前落盘，jobId 确认后清除。在场 = 远端可能已有作业，
 * 本地无法单方面判定——必须经 adopt（接手已知 jobId）或 resubmit（确认无作业）
 * 显式收口。
 */
export interface PipelineSubmitIntent {
  waveId: number
  /** 本次意图对应的第几次尝试（= 确认后将写入的 attempt）。 */
  attempt: number
  at: number
  route?: string
}

export interface PipelineState {
  schema_version: 'mat.pipeline.v1'
  pipelineId: string
  clusterId: string
  /** {work_dir} 根：molecule.xyz/三 JSON/attempts.jsonl/{task}/ 都在其下。 */
  workdir: string
  pkgDigest: string
  task: string
  phase: PipelinePhase
  currentWaveId: number
  waves: PipelineWaveState[]
  maxAttemptsPerWave: number
  history: Array<{ ts: number; event: string; detail?: string; critical?: boolean }>
  /** 未收口的提交意图（崩溃窗口的在场景；见区块头注释）。 */
  pendingSubmit?: PipelineSubmitIntent
  needsLlmReason?: string
  deadLetter?: { reason: string; kbId?: string }
}

/**
 * history 保留策略：常规事件滚动窗口，关键事件永久保留。
 * pipeline.json 是 last-write-wins 快照（非事件溯源日志），一旦截断即永久丢失，
 * 故不得让审计关键事件（终态/停链/提交收口）被常规噪声挤掉。
 */
const HISTORY_ROUTINE_LIMIT = 100

/** 关键事件：全链审计与核时对账的依据，永不参与截断。 */
const CRITICAL_EVENTS = new Set([
  'created',
  'completed',
  'dead_lettered',
  'cancelled',
  'needs_llm',
  'gate_failed',
  'watch_expired',
  'submit_intent',
  'submit_adopted',
  'submit_resubmitted',
  'resume_retry',
  'resume_rewatch',
  'driver_error',
])

function pruneHistory(
  history: Array<{ ts: number; event: string; detail?: string; critical?: boolean }>,
): Array<{ ts: number; event: string; detail?: string; critical?: boolean }> {
  const critical = history.filter((h) => h.critical === true)
  const routine = history.filter((h) => h.critical !== true)
  const kept = routine.slice(-HISTORY_ROUTINE_LIMIT)
  if (kept.length === routine.length && critical.length + kept.length === history.length) return history
  // 按原始顺序归并（critical 与 routine 交错还原）
  const keptSet = new Set([...critical, ...kept])
  return history.filter((h) => keptSet.has(h))
}

export function createPipelineState(input: {
  pipelineId: string
  clusterId: string
  workdir: string
  pkg: TaskPackage
  maxAttemptsPerWave?: number
}): PipelineState {
  return {
    schema_version: 'mat.pipeline.v1',
    pipelineId: input.pipelineId,
    clusterId: input.clusterId,
    workdir: input.workdir,
    pkgDigest: input.pkg.digest,
    task: input.pkg.task,
    phase: 'planned',
    currentWaveId: input.pkg.waves[0]?.id ?? 1,
    waves: input.pkg.waves.map((w) => ({ waveId: w.id, task: w.task, attempt: 0 })),
    maxAttemptsPerWave: input.maxAttemptsPerWave ?? 4,
    history: [{ ts: Date.now(), event: 'created', detail: `${input.pkg.task} ${input.pkg.waves.length} waves`, critical: true }],
  }
}

function waveOf(s: PipelineState, waveId: number): PipelineWaveState {
  const w = s.waves.find((x) => x.waveId === waveId)
  if (w === undefined) throw new Error(`pipeline: unknown wave ${waveId}`)
  return w
}

function next(s: PipelineState, event: string, detail?: string, patch: Partial<PipelineState> = {}): PipelineState {
  const entry = {
    ts: Date.now(), event,
    ...(detail !== undefined ? { detail } : {}),
    ...(CRITICAL_EVENTS.has(event) ? { critical: true } : {}),
  }
  return {
    ...s,
    ...patch,
    history: pruneHistory([...s.history, entry]),
  }
}

// ---------------------------------------------------------------------------
// 提交幂等：意图 → 确认 → 收口
// ---------------------------------------------------------------------------

/**
 * 提交前落盘意图（相位 submitting）。调用方必须已把此状态持久化，
 * 之后才允许发出 sbatch。
 */
export function onSubmitIntent(s: PipelineState, waveId: number, route?: string): PipelineState {
  const w = waveOf(s, waveId)
  const intent: PipelineSubmitIntent = {
    waveId,
    attempt: w.attempt + 1,
    at: Date.now(),
    ...(route !== undefined ? { route } : {}),
  }
  return next(s, 'submit_intent', `wave ${waveId} (${w.task}) attempt=${intent.attempt} sbatch pending`, {
    phase: 'submitting', currentWaveId: waveId, pendingSubmit: intent,
  })
}

/** 在场未收口的提交意图；undefined = 无悬挂提交。 */
export function submitIntentOf(s: PipelineState): PipelineSubmitIntent | undefined {
  return s.pendingSubmit
}

export function onWaveSubmitted(s: PipelineState, waveId: number, jobId: string): PipelineState {
  const w = waveOf(s, waveId)
  const waves = s.waves.map((x) => {
    if (x.waveId !== waveId) return x
    const { watchExpiries: _expired, ...rest } = x
    return { ...rest, jobId, attempt: x.attempt + 1, prescriptionLevel: w.prescriptionLevel, prescriptionRoute: w.prescriptionRoute }
  })
  const cleared = { ...s, pendingSubmit: undefined }
  const { pendingSubmit: _drop, ...rest } = cleared
  return next(rest as PipelineState, 'wave_submitted', `wave ${waveId} (${w.task}) job=${jobId} attempt=${w.attempt + 1}`, {
    waves, phase: 'wave_submitted', currentWaveId: waveId,
  })
}

/**
 * 意图收口：adopt = 集群上确有本次意图的作业（接手其 jobId 转为 wave_submitted）；
 * resubmit = 已确认无作业（清意图，按 prescriptionRoute 决定回 planned 还是 retrying）。
 * 两条路径都只在 pendingSubmit 在场时合法。
 */
export function reconcileSubmit(
  s: PipelineState,
  resolution: { kind: 'adopt'; jobId: string } | { kind: 'resubmit'; note?: string },
): PipelineState {
  const intent = s.pendingSubmit
  if (intent === undefined) {
    throw new Error(`pipeline: no pending submit to reconcile (phase=${s.phase})`)
  }
  if (resolution.kind === 'adopt') {
    const adopted = next(s, 'submit_adopted', `wave ${intent.waveId} intent adopted as job=${resolution.jobId}`, {
      pendingSubmit: undefined,
      phase: 'wave_submitted',
      currentWaveId: intent.waveId,
    })
    return onWaveSubmitted({ ...adopted, pendingSubmit: undefined }, intent.waveId, resolution.jobId)
  }
  const w = waveOf(s, intent.waveId)
  const back: PipelinePhase = w.prescriptionRoute !== undefined || w.prescriptionLevel !== undefined ? 'retrying' : 'planned'
  return next(s, 'submit_resubmitted', resolution.note ?? `wave ${intent.waveId} intent cleared (no remote job)`, {
    pendingSubmit: undefined,
    phase: back,
    currentWaveId: intent.waveId,
  })
}

// ---------------------------------------------------------------------------
// 波推进
// ---------------------------------------------------------------------------

/** 结算+门检通过：末波 → completed，否则推进到下一波 planned。 */
export function onWaveSettledPassed(s: PipelineState, waveId: number): PipelineState {
  const ordered = [...s.waves].sort((a, b) => a.waveId - b.waveId)
  const idx = ordered.findIndex((w) => w.waveId === waveId)
  const upcoming = ordered.slice(idx + 1).find((w) => w !== undefined)
  if (upcoming === undefined) {
    return next(s, 'completed', `wave ${waveId} passed the gate; chain complete`, { phase: 'completed' })
  }
  return next(s, 'wave_advanced', `wave ${waveId} passed the gate; next wave ${upcoming.waveId} (${upcoming.task})`, {
    phase: 'planned', currentWaveId: upcoming.waveId,
  })
}

/** 结算完成但门检不过（如 ts 虚频=0）：方法学问题，转 LLM 诊断位。 */
export function onWaveSettledGateFail(s: PipelineState, waveId: number, reason: string): PipelineState {
  return next(s, 'gate_failed', `wave ${waveId} gate failed: ${reason}`, {
    phase: 'needs_llm', needsLlmReason: reason,
  })
}

/** 处方梯换档：下一级 route 就绪，重渲染重提交（pre.json 路由键覆写）。 */
export function onRetryScheduled(s: PipelineState, waveId: number, level: number, route: string): PipelineState {
  const waves = s.waves.map((x) => x.waveId === waveId
    ? { ...x, prescriptionLevel: level, prescriptionRoute: route }
    : x)
  return next(s, 'retry_scheduled', `wave ${waveId} L${level}: ${route}`, { waves, phase: 'retrying', currentWaveId: waveId })
}

export function onNeedsLlm(s: PipelineState, reason: string): PipelineState {
  return next(s, 'needs_llm', reason, { phase: 'needs_llm', needsLlmReason: reason })
}

/**
 * watch 窗口耗尽而作业仍在集群（排队或计算中）：转 watch_expired——作业在场、
 * 监控不在场。这不是失败：作业可能正常，只是超出了本地 watch 窗口。
 *
 * 关键不变式（B0，2026-09-30）：watch_expired 的唯一出路是 resume rewatch
 * 原样重挂监控（jobId 不变）；retry/dead_letter 都不适用——此时无法排除
 * 作业仍在排队/运行，重渲染重提交=对活作业双跑（double-book core hours）。
 * 真失败了让 rewatch 挂上监控后由失败环按正规流程处置。
 * attempt 不动（没发生提交），watchExpiries 递增（autoRewatchLimit 预算口径，
 * 崩溃恢复后不重置）。
 */
export function onWatchExpired(s: PipelineState, waveId: number, reason: string): PipelineState {
  const w = waveOf(s, waveId)
  const expiries = (w.watchExpiries ?? 0) + 1
  const waves = s.waves.map((x) => x.waveId === waveId ? { ...x, watchExpiries: expiries } : x)
  return next(s, 'watch_expired', `wave ${waveId} (${w.task}) expiry #${expiries}: ${reason}`, {
    phase: 'watch_expired', currentWaveId: waveId, waves,
  })
}

export function onDriverError(s: PipelineState, message: string): PipelineState {
  const orphan = s.pendingSubmit === undefined
    ? ''
    : ` [UNRESOLVED SUBMIT: wave ${s.pendingSubmit.waveId} attempt ${s.pendingSubmit.attempt} at ${new Date(s.pendingSubmit.at).toISOString()} — a remote job may exist; reconcile with mat_pipeline_resume adopt/resubmit]`
  return next(s, 'driver_error', `${message}${orphan}`, {
    phase: 'needs_llm',
    needsLlmReason: `${message}${orphan}`,
  })
}

export function onDeadLettered(s: PipelineState, reason: string, kbId?: string): PipelineState {
  return next(s, 'dead_lettered', reason, {
    phase: 'dead_lettered', pendingSubmit: undefined,
    deadLetter: { reason, ...(kbId !== undefined ? { kbId } : {}) },
  })
}

/** 用户取消：终态可见。场上的 pendingSubmit 保留，提示可能存在孤儿作业。 */
export function onCancelled(s: PipelineState, note?: string): PipelineState {
  const w = s.waves.find((x) => x.waveId === s.currentWaveId)
  const live = w?.jobId !== undefined ? ` job=${w.jobId} (scancel it if still queued/running)` : ''
  return next(s, 'cancelled', `${note ?? 'cancelled by user'}${live}`, { phase: 'cancelled' })
}

export type PipelineResumeOverride =
  | { action: 'retry'; route: string; detail?: string }
  | { action: 'dead_letter'; reason: string }
  | { action: 'rewatch' }
  /** 收口悬挂提交：adopt 接手已知 jobId，resubmit 确认集群无作业后重提。 */
  | { action: 'adopt'; jobId: string; detail?: string }
  | { action: 'resubmit'; detail?: string }

/**
 * 会话侧续跑（needs_llm / stale / 悬挂提交的接手面）：
 * - retry：LLM 诊断结论给出的 route（决策行选行/方法学处置）→ retrying；
 * - dead_letter：诊断结论为不可重试 → 终态（配合 mat_db_dead_letter）；
 * - rewatch：wave_submitted 但监控不在场（会话中断/watch 窗口耗尽）→ 原样接手
 *   重挂监控（jobId 不变，绝不重投）；
 * - adopt：submitting/stale 且确认远端有作业 → 接手该 jobId；
 * - resubmit：submitting/stale 且确认远端无作业 → 清意图重提。
 * attempt 上限在此同样设闸（与 driver 自动梯进同一口径）。
 */
export function resumePipeline(s: PipelineState, override: PipelineResumeOverride): PipelineState {
  if (override.action === 'rewatch') {
    if (s.phase !== 'wave_submitted' && s.phase !== 'watch_expired') {
      throw new Error(`pipeline: rewatch only applies to wave_submitted/watch_expired (phase=${s.phase})`)
    }
    return next(s, 'resume_rewatch', `wave ${s.currentWaveId} job=${waveOf(s, s.currentWaveId).jobId ?? '-'}`, {
      phase: 'wave_submitted',
    })
  }
  if (override.action === 'adopt' || override.action === 'resubmit') {
    if (s.pendingSubmit === undefined) {
      throw new Error(
        `pipeline: ${override.action} requires an unresolved pending submit (phase=${s.phase}) — ` +
        'nothing to reconcile; a plain retry/rewatch is what you want',
      )
    }
    return reconcileSubmit(s, override.action === 'adopt'
      ? { kind: 'adopt', jobId: override.jobId }
      : { kind: 'resubmit', ...(override.detail !== undefined ? { note: override.detail } : {}) })
  }
  if (s.phase !== 'needs_llm') {
    throw new Error(`pipeline: resume ${override.action} only applies to needs_llm (phase=${s.phase})`)
  }
  if (override.action === 'dead_letter') {
    return onDeadLettered(s, override.reason)
  }
  // attempt 上限：LLM 手动续跑不得绕过（此前仅自动梯进路径受限，cap 形同虚设）
  const w = waveOf(s, s.currentWaveId)
  if (w.attempt >= s.maxAttemptsPerWave) {
    throw new Error(
      `pipeline: attempt-cap ${s.maxAttemptsPerWave} reached on wave ${s.currentWaveId} (${w.task}) — ` +
      'retry refused; resume with action=dead_letter after diagnosis, or start a fresh chain with a new digest',
    )
  }
  const waves = s.waves.map((x) => x.waveId === s.currentWaveId
    ? { ...x, prescriptionRoute: override.route }
    : x)
  return next(s, 'resume_retry', override.detail ?? `wave ${s.currentWaveId}: ${override.route}`, {
    waves, phase: 'retrying',
  })
}

/** 终态相位（不可再推进）。 */
export function isTerminalPhase(phase: PipelinePhase): boolean {
  return phase === 'completed' || phase === 'dead_lettered' || phase === 'cancelled'
}

/**
 * stale = 需要人手/会话接手的在场状态：
 * - wave_submitted：作业在场与否本地无从判定，由 resume rewatch 接手；
 * - watch_expired：watch 窗口耗尽而作业仍在集群，由 resume rewatch 原样重挂；
 * - submitting：提交意图未收口（崩溃窗口），由 resume adopt/resubmit 接手。
 */
export function stalePipeline(s: PipelineState): boolean {
  return s.phase === 'wave_submitted' || s.phase === 'watch_expired' || s.phase === 'submitting' || s.pendingSubmit !== undefined
}

export function pipelineToJson(s: PipelineState): string {
  return `${JSON.stringify(s, null, 2)}\n`
}

export function pipelineFromJson(text: string): PipelineState {
  const parsed = JSON.parse(text) as PipelineState
  if (parsed.schema_version !== 'mat.pipeline.v1') {
    throw new Error(`pipeline: unknown schema_version ${String(parsed.schema_version)}`)
  }
  if (!Array.isArray(parsed.waves) || parsed.waves.length === 0) {
    throw new Error('pipeline: waves must be a non-empty array')
  }
  for (const key of ['pipelineId', 'clusterId', 'workdir', 'pkgDigest', 'task', 'phase', 'currentWaveId'] as const) {
    if (parsed[key] === undefined || parsed[key] === null) {
      throw new Error(`pipeline: missing field ${key}`)
    }
  }
  if (parsed.pendingSubmit !== undefined) {
    const i = parsed.pendingSubmit
    if (typeof i.waveId !== 'number' || typeof i.attempt !== 'number' || typeof i.at !== 'number') {
      throw new Error('pipeline: pendingSubmit malformed (waveId/attempt/at required)')
    }
    if (parsed.waves.every((w) => w.waveId !== i.waveId)) {
      throw new Error(`pipeline: pendingSubmit names unknown wave ${i.waveId}`)
    }
    if (i.attempt !== (parsed.waves.find((w) => w.waveId === i.waveId)!.attempt + 1)) {
      throw new Error(
        `pipeline: pendingSubmit attempt ${i.attempt} inconsistent with wave attempt ` +
        `${parsed.waves.find((w) => w.waveId === i.waveId)!.attempt} — refusing to guess the ledger state`,
      )
    }
  }
  return parsed
}
