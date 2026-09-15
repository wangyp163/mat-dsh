/**
 * 预算闸——batch-subagent spike 工程件 P3（纯逻辑，无 IO 依赖）。
 *
 * 与 exec-gate（串行闸，防并发输出串扰）正交：这里管的是组合级资源预算——
 * 总 sbatch 数、单任务重试次数、估计核时。check 是纯查询不记账；record 在
 * sbatch 真实成功后调用；checkThenRecord 原子用法（工具入口接线形态）。
 * 拒绝一律结构化返回（非抛异常），由调用方转成工具可见的结构化错误。
 */

export interface BudgetDeclaration {
  /** 总 sbatch 上限（首提 + 重试合计）。 */
  maxSbatch: number
  /** 单任务重试上限。 */
  maxRetriesPerTask: number
  /** 总核时估计上限。 */
  maxCoreHours: number
}

export interface SbatchRequest {
  taskId: string
  isRetry: boolean
  estimatedCoreHours: number
}

export type BudgetDecision = { ok: true } | { ok: false; reason: string }

export interface BudgetLedger {
  sbatchCount: number
  retriesByTask: Record<string, number>
  estimatedCoreHours: number
}

export interface BudgetGuard {
  check(request: SbatchRequest): BudgetDecision
  record(request: SbatchRequest): void
  checkThenRecord(request: SbatchRequest): BudgetDecision
  snapshot(): BudgetLedger
}

function validRequest(r: SbatchRequest): boolean {
  return (
    typeof r.taskId === 'string' && r.taskId.length > 0
    && typeof r.isRetry === 'boolean'
    && typeof r.estimatedCoreHours === 'number' && r.estimatedCoreHours >= 0
  )
}

/**
 * 创建预算闸。声明来自 manifest 初始化（"声明计划即预算"：计划外提交被拒，
 * 想扩计划必须人改 manifest 重新声明）。
 */
export function createBudgetGuard(declaration: BudgetDeclaration): BudgetGuard {
  let sbatchCount = 0
  let estimatedCoreHours = 0
  const retriesByTask: Record<string, number> = {}

  function check(r: SbatchRequest): BudgetDecision {
    if (!validRequest(r)) return { ok: false, reason: `invalid budget request: ${JSON.stringify(r)}` }
    if (sbatchCount + 1 > declaration.maxSbatch) {
      return { ok: false, reason: `sbatch budget exhausted (${sbatchCount}/${declaration.maxSbatch}); raise the declared plan to continue` }
    }
    if (r.isRetry && (retriesByTask[r.taskId] ?? 0) >= declaration.maxRetriesPerTask) {
      return { ok: false, reason: `retry cap reached for ${r.taskId} (${retriesByTask[r.taskId] ?? 0}/${declaration.maxRetriesPerTask})` }
    }
    if (estimatedCoreHours + r.estimatedCoreHours > declaration.maxCoreHours) {
      return {
        ok: false,
        reason: `core-hour budget would exceed (${(estimatedCoreHours + r.estimatedCoreHours).toFixed(2)} > ${declaration.maxCoreHours.toFixed(2)})`,
      }
    }
    return { ok: true }
  }

  function record(r: SbatchRequest): void {
    sbatchCount += 1
    estimatedCoreHours += r.estimatedCoreHours
    if (r.isRetry) retriesByTask[r.taskId] = (retriesByTask[r.taskId] ?? 0) + 1
  }

  return {
    check,
    record,
    checkThenRecord(r: SbatchRequest): BudgetDecision {
      const decision = check(r)
      if (decision.ok) record(r)
      return decision
    },
    snapshot(): BudgetLedger {
      return { sbatchCount, estimatedCoreHours, retriesByTask: { ...retriesByTask } }
    },
  }
}

/**
 * 清单驱动的预算闸（工具入口接线形态）：按 manifest 的声明 + 台账回放判定新请求。
 * 语义：未声明预算 = 不受闸（opt-in）；计划外 taskId = 拒绝（声明计划即预算）。
 */
export function checkBudgetAgainstManifest(
  portfolio: { budget?: BudgetDeclaration; ledger?: Array<{ taskId: string; isRetry: boolean; estimatedCoreHours: number }>; tasks: Array<{ taskId: string }> },
  request: SbatchRequest,
): BudgetDecision {
  if (portfolio.budget === undefined) return { ok: true }
  if (!portfolio.tasks.some((t) => t.taskId === request.taskId)) {
    return {
      ok: false,
      reason: `task ${request.taskId} is not in the portfolio plan; plan-external submission refused (raise the declared plan to continue)`,
    }
  }
  const guard = createBudgetGuard(portfolio.budget)
  for (const entry of portfolio.ledger ?? []) {
    guard.record({
      taskId: entry.taskId,
      isRetry: entry.isRetry,
      estimatedCoreHours: entry.estimatedCoreHours,
    })
  }
  return guard.check(request)
}
