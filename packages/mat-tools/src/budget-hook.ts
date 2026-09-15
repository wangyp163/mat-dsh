/**
 * 提交工具的预算闸接线（batch-subagent spike 工程件 P3 的工具面）。
 *
 * 语义：调用方传 task_ref = {portfolio_file, task_id} 即激活闸——
 * - 过闸检查（openBudgetGate）：清单外任务拒绝；台账回放后超 sbatch/重试/核时预算拒绝。
 *   拒绝抛 BUDGET_REJECTED 前缀错误（工具面 isError，未发生 sbatch）。
 * - 成功记账（gate.record(jobId)）：sbatch 真实成功后追加台账并原子写回清单。
 * 不传 task_ref = 不受闸（现有单作业用法零影响）。
 * 重试身份从清单派生：task.attempts > 0 即重试（resetForRetry 是唯一加 attempts 的路径）。
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import {
  appendSubmission,
  checkBudgetAgainstManifest,
  portfolioFromJson,
  portfolioToJson,
} from 'mat-core'

export interface BudgetTaskRef {
  portfolioFile: string
  taskId: string
}

/** 工具面 task_ref 参数解析：{portfolio_file, task_id} 两键缺一不可；undefined = 不受闸。 */
export function parseBudgetTaskRef(raw: unknown): BudgetTaskRef | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('task_ref must be an object {portfolio_file, task_id}')
  }
  const o = raw as Record<string, unknown>
  if (typeof o.portfolio_file !== 'string' || o.portfolio_file.length === 0
    || typeof o.task_id !== 'string' || o.task_id.length === 0) {
    throw new Error('task_ref requires non-empty portfolio_file and task_id')
  }
  return { portfolioFile: o.portfolio_file, taskId: o.task_id }
}

/** 核时估算：ncores × 3.75 分钟（分钟级小作业的经验档）；缺省按 32 核。 */
export function estimateCoreHours(ncores: number | undefined): number {
  return Math.round((ncores ?? 32) * 0.0625 * 1000) / 1000
}

function readPortfolioNcores(preJson: unknown): number | undefined {
  if (typeof preJson !== 'object' || preJson === null) return undefined
  const resources = (preJson as Record<string, unknown>)['resources']
  if (typeof resources !== 'object' || resources === null) return undefined
  const ncores = (resources as Record<string, unknown>)['ncores']
  return typeof ncores === 'number' ? ncores : undefined
}

export interface BudgetGateHandle {
  record(jobId: string): void
}

/**
 * 打开预算闸：拒绝即抛错（无副作用）；通过则返回记账句柄。
 * @param rawTaskRef 工具参数 task_ref（undefined = 不受闸，返回 undefined）。
 * @param preJson mat_gaussian 的 options.pre_json（核时估算读 resources.ncores）。
 */
export function openBudgetGate(rawTaskRef: unknown, preJson?: unknown): BudgetGateHandle | undefined {
  const ref = parseBudgetTaskRef(rawTaskRef)
  if (ref === undefined) return undefined
  let manifest
  try {
    manifest = portfolioFromJson(readFileSync(ref.portfolioFile, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`BUDGET_REJECTED: cannot load portfolio ${ref.portfolioFile} (${message})`)
  }
  const task = manifest.tasks.find((t) => t.taskId === ref.taskId)
  if (task === undefined) {
    throw new Error(
      `BUDGET_REJECTED: task ${ref.taskId} is not in portfolio ${manifest.portfolioId} — plan-external submission refused`,
    )
  }
  const decision = checkBudgetAgainstManifest(manifest, {
    taskId: ref.taskId,
    isRetry: task.attempts > 0,
    estimatedCoreHours: estimateCoreHours(readPortfolioNcores(preJson)),
  })
  if (!decision.ok) {
    throw new Error(`BUDGET_REJECTED: ${decision.reason}`)
  }
  return {
    record(jobId: string): void {
      appendSubmission(manifest, {
        taskId: ref.taskId,
        jobId,
        isRetry: task.attempts > 0,
        estimatedCoreHours: estimateCoreHours(readPortfolioNcores(preJson)),
      })
      const temporary = `${ref.portfolioFile}.part`
      writeFileSync(temporary, portfolioToJson(manifest))
      renameSync(temporary, ref.portfolioFile)
    },
  }
}
