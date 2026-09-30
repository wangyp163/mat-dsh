/**
 * pool driver（审阅表 R6b）：批量任务池的并发控制器。
 *
 * 语义量：N 条链共用一个并发上限（信号量=admission 控制）；链结算
 * （done/halted/dead_lettered/cancelled）即回填 pending 链；halted 链不阻塞
 * 池（诊断权在会话，F2 座位），收口条件 = 无 pending 且无 running。
 * 每链复用单链 pipeline driver（含门检/记账/处方梯/死信/needs_llm 全套），
 * 池只在链之上做 admission 与结算记账。submitGate 逐链注入（预算/相位闸——
 * 批量纪律的硬通道）。
 *
 * 注入纪律同 watch-loop：execCommand/诊断/死信/持久化/通知/状态装载全注入。
 */

import type { ExecCommandFn } from './slurm.ts'
import type { TaskPackage } from './task-package.ts'
import type { PrescriptionStep } from './db.ts'
import { createPipelineDriverHooks } from './pipeline-driver.ts'
import type { PipelineDriverOutcome, PipelineDiagnoseHit, PipelineSubmitGate } from './pipeline-driver.ts'
import type { PipelineState } from './pipeline.ts'
import type { PoolState } from './pool.ts'
import { admissibleChains, onChainAdmitted, onChainSettled, poolSummary } from './pool.ts'

export interface PoolDriverInput {
  pool: PoolState
  /** digest → 编译产物（宿主从 task-packages/ 加载）。 */
  pkgOf: (digest: string) => TaskPackage
  /** 链状态装载（宿主：pipelines/<id>.json 存在则续跑,否则按池条目新建）。 */
  stateOf: (pipelineId: string) => PipelineState
  execCommand: ExecCommandFn
  workflowEnv?: string
  g16Env?: string
  pollSeconds?: number
  maxWaitSeconds?: number
  /** 每链 watch 窗口耗尽自动续看预算（透传 pipeline driver；见其字段注释）。 */
  autoRewatchLimit?: number
  /** 轮询抖动比(0-0.5,透传链驱动):防 N 条链同相轮询/同期到期。 */
  pollJitter?: number
  /** SCF 收敛采样(透传链驱动):true=缺省 60s 采样窗,异常确认才唤醒。 */
  scfTrend?: boolean | { intervalMs?: number }
  /**
   * 逐链通知策略(B3):'all'=每链结算都通知(旧行为);'actionable'=只有
   * 需要会话动作的结算(needs_llm/dead_lettered)即时通知,completed 链静默,
   * 汇总见收口通知(进度随时 mat_pool_status 可查)。缺省 'all'。
   */
  notifyOn?: 'all' | 'actionable'
  diagnose?: (errorText: string) => PipelineDiagnoseHit[]
  markDeadLetter?: (jobId: string, reason: string, kbId?: string) => void
  /** 每链 pipeline.json 持久化。 */
  chainPersist?: (state: PipelineState) => void
  /** 池状态持久化（pools/<id>.json）。 */
  poolPersist?: (pool: PoolState) => void
  notify?: (message: string) => void
  /** 每链提交闸（链条目 taskRef → 宿主 openBudgetGate/assertPhaseGate）。 */
  submitGateOf?: (pipelineId: string) => PipelineSubmitGate | undefined
}

export interface PoolDriverHooks {
  cancel(): void
  done: Promise<{ status: 'completed' | 'cancelled'; detail: string }>
  readOutput(): string
}

export type PoolDriverOutcome = Awaited<PoolDriverHooks['done']>

export function createPoolDriverHooks(input: PoolDriverInput): PoolDriverHooks {
  const log: string[] = [`pool ${input.pool.poolId}: ${input.pool.chains.length} chains, cap ${input.pool.maxConcurrent} @${input.pool.clusterId}`]
  let cancelled = false
  const cancels: Array<() => void> = []
  const outcomes = new Map<string, PipelineDriverOutcome>()

  const push = (line: string): void => {
    log.push(line)
    if (log.length > 600) log.splice(0, log.length - 600)
  }

  const done = (async (): Promise<PoolDriverOutcome> => {
    let pool = input.pool
    const commit = (s: PoolState): void => {
      pool = s
      input.poolPersist?.(s)
    }
    const inflight = new Map<string, Promise<void>>()
    /** 结构化闸拒绝（B2）：首条 gate_rejected 结算即停止 admit，未启动链留 pending。 */
    let gateHaltedReason: string | undefined

    function launchChain(pipelineId: string): void {
      commit(onChainAdmitted(pool, pipelineId))
      const entry = pool.chains.find((c) => c.pipelineId === pipelineId)!
      const pkg = input.pkgOf(entry.pkgDigest)
      const state = input.stateOf(pipelineId)
      push(`chain ${pipelineId} admitted (${entry.workdir}, state=${state.phase})`)
      const p = (async () => {
        try {
          const driver = createPipelineDriverHooks({
            state,
            pkg,
            execCommand: input.execCommand,
            ...(input.workflowEnv !== undefined ? { workflowEnv: input.workflowEnv } : {}),
            ...(input.g16Env !== undefined ? { g16Env: input.g16Env } : {}),
            ...(input.pollSeconds !== undefined ? { pollSeconds: input.pollSeconds } : {}),
            ...(input.maxWaitSeconds !== undefined ? { maxWaitSeconds: input.maxWaitSeconds } : {}),
            ...(input.autoRewatchLimit !== undefined ? { autoRewatchLimit: input.autoRewatchLimit } : {}),
            ...(input.pollJitter !== undefined ? { pollJitter: input.pollJitter } : {}),
            ...(input.scfTrend !== undefined ? { scfTrend: input.scfTrend } : {}),
            ...(input.notifyOn !== undefined ? { notifyOn: input.notifyOn } : {}),
            ...(input.diagnose !== undefined ? { diagnose: input.diagnose } : {}),
            ...(input.markDeadLetter !== undefined ? { markDeadLetter: input.markDeadLetter } : {}),
            ...(input.chainPersist !== undefined ? { persist: input.chainPersist } : {}),
            notify: (m) => input.notify?.(`[${pipelineId}] ${m}`),
            ...(input.submitGateOf !== undefined
              ? { submitGate: input.submitGateOf(pipelineId) }
              : {}),
          })
          cancels.push(() => driver.cancel())
          const outcome = await driver.done
          outcomes.set(pipelineId, outcome)
          if (outcome.code === 'gate_rejected' && gateHaltedReason === undefined) {
            gateHaltedReason = outcome.detail
          }
          commit(onChainSettled(pool, pipelineId, outcome))
          push(`chain ${pipelineId} settled ${outcome.status}: ${outcome.detail.slice(0, 140)}`)
          // B3:completed 链无可执行动作(进度随 mat_pool_status 可查),
          // 'actionable' 模式下不逐链唤醒——汇总在收口通知里。
          if ((input.notifyOn ?? 'all') === 'all' || outcome.status !== 'completed') {
            input.notify?.(`pool ${pool.poolId}: chain ${pipelineId} ${outcome.status} — ${poolSummary(pool)}`)
          }
        } catch (error) {
          // 单链驱动自身已捕获内部错误；此处兜底防池被单链异常击穿
          const message = error instanceof Error ? error.message : String(error)
          commit(onChainSettled(pool, pipelineId, { status: 'driver-error', detail: message }))
          push(`chain ${pipelineId} driver error: ${message}`)
        } finally {
          inflight.delete(pipelineId)
        }
      })()
      inflight.set(pipelineId, p)
    }

    while (!cancelled) {
      // B2：闸拒绝后不再 admit——预算耗尽时每条新链都会在同一道闸上撞墙，
      // 未启动的链留在 pending（零集群副作用），修好闸后 reattach 一键重启。
      if (gateHaltedReason === undefined) {
        for (const pipelineId of admissibleChains(pool)) {
          if (cancelled) break
          launchChain(pipelineId)
        }
      }
      if (inflight.size === 0) break
      await Promise.race([...inflight.values()])
    }
    if (inflight.size > 0) {
      await Promise.all([...inflight.values()])
    }
    const unstarted = pool.chains.filter((c) => c.phase === 'pending').length
    const detail = gateHaltedReason !== undefined && unstarted > 0
      ? `pool ${pool.poolId} admission halted after a gate rejection: ${poolSummary(pool)}, ${unstarted} chain(s) unstarted ` +
        `(${gateHaltedReason.slice(0, 160)}) — resolve the gate (budget/phase) then mat_pool_resume action=reattach`
      : `pool ${pool.poolId} drained: ${poolSummary(pool)}`
    push(detail)
    input.notify?.(detail + (pool.chains.some((c) => c.phase === 'halted') ? ' (halted chains await mat_pool_resume)' : ''))
    return { status: cancelled ? 'cancelled' : 'completed', detail }
  })()

  return {
    cancel(): void {
      cancelled = true
      for (const c of cancels) c()
    },
    done,
    readOutput(): string {
      return log.join('\n')
    },
  }
}
