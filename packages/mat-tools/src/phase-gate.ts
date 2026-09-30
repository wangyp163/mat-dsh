/**
 * 提交工具的相位闸（审阅表 R2：制备阶段不准碰集群）。
 *
 * 语义：与预算闸同参数激活（task_ref = {portfolio_file, task_id}）——
 * 清单里还存在 phase === 'pending' 的任务 = Phase B（制备）未收口，
 * 任何集群提交在发出前拒绝，抛 PHASE_GATE_REJECTED 前缀错误（零集群副作用）。
 * pending 清零即 Phase B/C 边界放行；prepared 任务可提交（Phase C 正常）；
 * resetForRetry 回 prepared 不受影响。读不到清单时旁路不阻塞——
 * 同参数下预算闸（budget-hook）会先兜住不可加载的 manifest。
 */

import { readFileSync } from 'node:fs'
import { portfolioFromJson } from 'mat-core'

import { parseBudgetTaskRef } from './budget-hook.ts'

export function assertPhaseGate(rawTaskRef: unknown): void {
  const ref = parseBudgetTaskRef(rawTaskRef)
  if (ref === undefined) return
  let manifest
  try {
    manifest = portfolioFromJson(readFileSync(ref.portfolioFile, 'utf8'))
  } catch {
    return
  }
  const pending = manifest.tasks.filter((t) => t.phase === 'pending')
  if (pending.length === 0) return
  const selfPending = pending.some((t) => t.taskId === ref.taskId)
  throw new Error(
    `PHASE_GATE_REJECTED: manifest still in preparation (${pending.length} pending` +
      `${selfPending ? `, including ${ref.taskId} itself` : ''}); ` +
      'Phase B is zero-cluster — complete the prep fan-out before any submission',
  )
}
