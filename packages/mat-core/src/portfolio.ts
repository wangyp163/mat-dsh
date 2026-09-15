/**
 * 批量任务清单（manifest）——batch-subagent spike 工程件 P1（纯逻辑，无 IO 依赖）。
 *
 * 主 agent 只持有一张外置清单：taskId → 相位/jobId/结构化裁决；上下文经济学要求
 * 组合状态不活在会话里，落盘为 JSON、每轮读增量。相位只进不退（retry 走显式
 * resetForRetry 记账），增量行语义对齐 watch-loop readOutput（"距上次读取的变化"）。
 */

import type { BudgetDeclaration } from './budget.ts'

/** 任务相位（生命周期顺序）。 */
export type PortfolioPhase =
  | 'pending'
  | 'prepared'
  | 'submitted'
  | 'settled'
  | 'diagnosed'
  | 'interpreted'
  | 'final'

const PHASE_ORDER: readonly PortfolioPhase[] = [
  'pending',
  'prepared',
  'submitted',
  'settled',
  'diagnosed',
  'interpreted',
  'final',
]

/** 清单里的一个任务。verdict 是 P2 契约产物（最后一次结构化裁决）。 */
export interface PortfolioTask {
  taskId: string
  system: string
  kind: 'valid' | 'injected'
  /** 注入失败的透明说明（kind=injected 必填）。 */
  injectedNote?: string
  phase: PortfolioPhase
  jobId?: string
  attempts: number
  verdict?: Record<string, unknown>
  note?: string
  updatedAt: string
}

export interface Portfolio {
  portfolioId: string
  createdAt: string
  /** 声明计划即预算：Phase C 预算闸的数据源（缺省未声明=不受预算闸管辖）。 */
  budget?: BudgetDeclaration
  /** 提交台账（append-only）：预算闸回放数据源，工具侧 sbatch 成功后自动追加。 */
  ledger?: SubmissionLedgerEntry[]
  tasks: PortfolioTask[]
}

/** 一次真实 sbatch 的台账记录（预算闸按此回放判定后续提交）。 */
export interface SubmissionLedgerEntry {
  taskId: string
  jobId?: string
  isRetry: boolean
  estimatedCoreHours: number
  at: string
}

export interface PortfolioTaskSpec {
  taskId: string
  system: string
  kind: 'valid' | 'injected'
  injectedNote?: string
}

function now(): string {
  return new Date().toISOString()
}

/** 校验任务规格：taskId 唯一非空；injected 必须带说明（透明纪律）。 */
function validateSpecs(specs: readonly PortfolioTaskSpec[]): void {
  const seen = new Set<string>()
  for (const s of specs) {
    if (typeof s.taskId !== 'string' || s.taskId.length === 0) throw new Error('portfolio: taskId must be non-empty')
    if (seen.has(s.taskId)) throw new Error(`portfolio: duplicate taskId ${s.taskId}`)
    seen.add(s.taskId)
    if (s.kind === 'injected' && (s.injectedNote === undefined || s.injectedNote.length === 0)) {
      throw new Error(`portfolio: injected task ${s.taskId} requires injectedNote`)
    }
  }
}

/** 建清单：全部任务 pending、attempts=0。 */
export function createPortfolio(spec: {
  portfolioId: string
  budget?: BudgetDeclaration
  tasks: readonly PortfolioTaskSpec[]
}): Portfolio {
  validateSpecs(spec.tasks)
  const ts = now()
  return {
    portfolioId: spec.portfolioId,
    createdAt: ts,
    ...(spec.budget !== undefined ? { budget: spec.budget } : {}),
    tasks: spec.tasks.map((t) => ({
      ...t,
      phase: 'pending' as const,
      attempts: 0,
      updatedAt: ts,
    })),
  }
}

function findTask(p: Portfolio, taskId: string): PortfolioTask {
  const t = p.tasks.find((x) => x.taskId === taskId)
  if (t === undefined) throw new Error(`portfolio: unknown taskId ${taskId}`)
  return t
}

/** 任务可更新字段（相位外的可选覆盖）。 */
export interface PortfolioTaskPatch {
  phase?: PortfolioPhase
  jobId?: string
  verdict?: Record<string, unknown>
  note?: string
  system?: string
}

/**
 * 推进任务；相位只能沿 PHASE_ORDER 前进（相等幂等），倒退抛错——
 * 重试语义走 resetForRetry（attempts 记账），不允许静默回卷。
 */
export function updateTask(p: Portfolio, taskId: string, patch: PortfolioTaskPatch): PortfolioTask {
  const t = findTask(p, taskId)
  if (patch.phase !== undefined) {
    const from = PHASE_ORDER.indexOf(t.phase)
    const to = PHASE_ORDER.indexOf(patch.phase)
    if (to < from) throw new Error(`portfolio: phase regression ${t.phase} -> ${patch.phase} for ${taskId}`)
  }
  const next: PortfolioTask = { ...t, ...patch, updatedAt: now() }
  p.tasks = p.tasks.map((x) => (x.taskId === taskId ? next : x))
  return next
}

/** 重试重置：attempts+1、相位回 prepared、清 jobId（唯一合法的相位回退点）。 */
export function resetForRetry(p: Portfolio, taskId: string): PortfolioTask {
  const t = findTask(p, taskId)
  const next: PortfolioTask = {
    ...t,
    attempts: t.attempts + 1,
    phase: 'prepared',
    jobId: undefined,
    updatedAt: now(),
  }
  p.tasks = p.tasks.map((x) => (x.taskId === taskId ? next : x))
  return next
}

/** 追加一条提交台账（append-only；工具侧 sbatch 成功后调用）。 */
export function appendSubmission(p: Portfolio, entry: Omit<SubmissionLedgerEntry, 'at'> & { at?: string }): void {
  if (p.ledger === undefined) p.ledger = []
  p.ledger.push({ ...entry, at: entry.at ?? now() })
}

/** 序列化/反序列化；fromJson 严格校验防手改清单静默污染。 */
export function portfolioToJson(p: Portfolio): string {
  return `${JSON.stringify(p, null, 2)}\n`
}

export function portfolioFromJson(text: string): Portfolio {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('portfolio: invalid JSON')
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('portfolio: payload must be an object')
  const r = raw as Record<string, unknown>
  if (typeof r.portfolioId !== 'string') throw new Error('portfolio: missing portfolioId')
  if (!Array.isArray(r.tasks) || r.tasks.length === 0) throw new Error('portfolio: missing tasks')
  for (const t of r.tasks) {
    if (typeof t !== 'object' || t === null) throw new Error('portfolio: task must be an object')
    const task = t as Record<string, unknown>
    if (typeof task.taskId !== 'string' || typeof task.phase !== 'string') {
      throw new Error('portfolio: task missing taskId/phase')
    }
    if (!PHASE_ORDER.includes(task.phase as PortfolioPhase)) {
      throw new Error(`portfolio: unknown phase ${String(task.phase)}`)
    }
  }
  return raw as Portfolio
}

/** 变化行渲染：taskId + 相位/jobId/attempts/verdict 摘要。 */
function taskDiffLine(before: PortfolioTask | undefined, after: PortfolioTask): string | null {
  if (before === undefined) return `${after.taskId} +${after.phase}`
  const changes: string[] = []
  if (before.phase !== after.phase) changes.push(`phase ${before.phase}->${after.phase}`)
  if (before.jobId !== after.jobId) changes.push(`job ${before.jobId ?? '-'}->${after.jobId ?? '-'}`)
  if (before.attempts !== after.attempts) changes.push(`attempts ${before.attempts}->${after.attempts}`)
  if (JSON.stringify(before.verdict) !== JSON.stringify(after.verdict) && after.verdict !== undefined) {
    changes.push(`verdict ${JSON.stringify(after.verdict)}`)
  }
  if (before.note !== after.note && after.note !== undefined) changes.push(`note ${after.note}`)
  if (changes.length === 0) return null
  return `${after.taskId} ${changes.join(', ')}`
}

/** 增量行：只报变化的任务（语义对齐 watch-loop readOutput）。 */
export function diffPortfolio(before: Portfolio, after: Portfolio): string[] {
  const beforeById = new Map(before.tasks.map((t) => [t.taskId, t]))
  const lines: string[] = []
  for (const t of after.tasks) {
    const line = taskDiffLine(beforeById.get(t.taskId), t)
    if (line !== null) lines.push(line)
  }
  return lines
}
