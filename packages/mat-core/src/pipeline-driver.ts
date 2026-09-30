/**
 * pipeline driver（审阅表 R6a 一期）：单条多波链的代码循环。
 *
 * 对 createGaussianProducerHooks 再套一层波推进状态机：
 * 每波 run 渲染 → sbatch（含 attempts 自动记账）→ producer 监控至终态 →
 * 自身门检 → 过门进下一波；FAILED 走失败环：diagnose 取 R5 结构化处方，
 * 有序梯自动换档重渲染重提交，梯尽/attempt 上限 → 死信；决策行/无梯进/
 * 门检不过 → needs_llm 停链（F2 是 LLM 在流水线上唯一的诊断座位）。
 *
 * 提交幂等保证（关键）：
 *   1. sbatch 前先 commit(onSubmitIntent)，宿主持久化后才发出 sbatch。
 *   2. sbatch 返回 jobId 后 commit(onWaveSubmitted)，pendingSubmit 清零。
 *   3. 任何崩溃留下 submitting 相位 + pendingSubmit，由 resume adopt/resubmit 收口。
 *
 * attempt cap 双重闸：自动梯进路径（driver 内）与 LLM 手动 resume 路径
 * （resumePipeline 内）均检查 attempt >= maxAttemptsPerWave。
 *
 * cancel 语义：cancelled = true 后等当前 watchWave 自然返回，随即以
 * scancelCommand 发出 scancel（best-effort），状态推入 cancelled 终态。
 *
 * 与 watch-loop 同款注入纪律：execCommand/诊断/死信/持久化/通知全注入，
 * 本模块不知道 session 为何物。宿主（mat-tools）把它装进 jobs.start 的
 * run() 返回 WatchLoopHooks 同形句柄，完成经 onJobDone→followup 唤醒会话。
 */

import { outputText } from './client.ts'
import type { ExecResult } from './client.ts'
import type { ExecCommandFn } from './slurm.ts'
import { parseSbatchSubmission, sbatchCommand, scancelCommand } from './slurm.ts'
import {
  DEFAULT_G16_ENV,
  DEFAULT_WORKFLOW_ENV,
  createGaussianProducerHooks,
  diagnosticTextOf,
  prePhaseCommand,
  runPhaseCommand,
} from './gaussian.ts'
import type { PrescriptionStep } from './db.ts'
import type { TaskPackage } from './task-package.ts'
import { checkIrcDirectionGate, checkSettledWave } from './wave-gate.ts'
import type { PipelineState } from './pipeline.ts'
import {
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
} from './pipeline.ts'

export interface PipelineDiagnoseHit {
  id: string
  path: string
  prescription?: PrescriptionStep[]
}

/**
 * 提交闸（R6b 批量纪律通道）：check 在 sbatch 发出前调用，拒绝即抛错
 * （BUDGET_REJECTED / PHASE_GATE_REJECTED 等，零集群副作用）；record 在
 * 提交成功拿到 jobId 后记账。单链场景可不传；批量任务池必须传
 * （每链的 task_ref 由池条目携带）。
 */
export interface PipelineSubmitGate {
  check(info: { workdir: string; waveId: number; retryRoute?: string }): void
  record(jobId: string): void
}

export interface PipelineDriverInput {
  state: PipelineState
  pkg: TaskPackage
  execCommand: ExecCommandFn
  workflowEnv?: string
  g16Env?: string
  pollSeconds?: number
  maxWaitSeconds?: number
  /** 轮询抖动比(0-0.5);池场景防 N 条链同相轮询/同期到期。 */
  pollJitter?: number
  /** SCF 收敛采样(高级作业监控,透传 producer):true=缺省 60s 采样窗。 */
  scfTrend?: boolean | { intervalMs?: number }
  /**
   * 通知策略(B3/R-2):'all'=完成也通知(单链默认——完成唤醒是会话的主交付);
   * 'actionable'=池驱动的链只报需要动作的事件(needs_llm/dead_letter/门检失败/
   * SCF 异常),链完成交池的收口通知汇总(池内逐链完成唤醒是降噪对象)。
   */
  notifyOn?: 'all' | 'actionable'
  /**
   * watch 窗口耗尽时的自动续看预算（B1）：到期次数 ≤ 此值时 driver 直接原样
   * 重挂监控（零重投风险，纯机械动作），超出才停给 LLM。语义 = 首次到期后的
   * 自动续臂次数（0 = 首次到期即停，单链默认行为）。预算口径是 wave 上的
   * watchExpiries 计数——持久化，崩溃恢复/rewatch 续跑不重置。
   */
  autoRewatchLimit?: number
  /** 失败环签名索引（producer 的 diagnose 同款）。 */
  diagnose?: (errorText: string) => PipelineDiagnoseHit[]
  /** 死信落库（mat_db_dead_letter 的库面）。 */
  markDeadLetter?: (jobId: string, reason: string, kbId?: string) => void
  /**
   * 状态外置持久化钩子（pipeline.json 原子写由宿主负责）。
   * 提交幂等保证依赖此钩子在 sbatch 前被调用并落盘——宿主必须在 persist()
   * 返回后再执行后续 sbatch（driver 在 onSubmitIntent 后立即调 persist，
   * 确认持久化完成才发出 sbatch）。
   */
  persist?: (state: PipelineState) => void
  /** 会话通知（needs_llm/终态时唤配 owner）。 */
  notify?: (message: string) => void
  /** 提交闸（预算/相位——批量任务池必配）。 */
  submitGate?: PipelineSubmitGate
  /**
   * 门检数据源（可选，强烈建议注入）：读远端 {workdir}/result.json 原文。
   *
   * 不注入时 driver 退回用 producer 内存里的 properties——但那条路径与
   * mat_sbatch 工具层的 checkWaveGate（读 result.json）数据源不同，
   * 一旦 post 部分失败（内存有 properties、result.json 未完整写入），
   * 手动 stepwise 与自动 pipeline 两条路径会得出不同门检结论。
   * 注入后两者同源，消除该双轨不一致。
   */
  readResultJson?: () => Promise<unknown>
  /**
   * 图谱 CSV 读取（R8b，IRC 方向门需要）。未注入时方向门放行——
   * 老接线没有这个能力，不能因此拒绝一个本来合格的波。
   */
  readCsvFile?: (path: string) => Promise<string>
}

export interface PipelineDriverHooks {
  cancel(): void
  done: Promise<{ status: 'completed' | 'dead_lettered' | 'needs_llm' | 'cancelled'; detail: string; code?: string }>
  readOutput(): string
}

export type PipelineDriverOutcome = Awaited<PipelineDriverHooks['done']>

/** 结构化拒绝前缀（B2）：submitGate 抛错携带的零副作用拒绝码，池据此短路收口。 */
const GATE_REJECTED_PREFIX = /^(BUDGET_REJECTED|PHASE_GATE_REJECTED)/

/** 处方 route 的路由键：取 route 串首标识符（irc(...)/opt=TS ... → irc/opt）。 */
export function routeKeyOf(route: string): string {
  const m = /^([A-Za-z0-9_+]+)/.exec(route.trim())
  if (m === null) throw new Error(`pipeline: cannot derive route key from '${route}'`)
  return m[1]!
}

/**
 * 从 find 返回的 slurm.sh 路径列表中定位当前波应提交的 step 目录。
 *
 * 选择规则（显式约定，替代旧 tail -1 字典序猜测）：
 *   - 从列表中找包含 wave task 名称的目录，如 `02-ts/slurm.sh` 匹配 task=ts；
 *   - 多个命中时取字典序最大者（run 重渲染后最新一个）；
 *   - 无命中则 fallback 字典序最大者，但记录警告供调用方 push 到日志；
 *   - 两种情况都在确认 scripts 非空后才到达。
 *
 * 若依赖命名约定让你不安，在集成测试里断言此函数对已知的 find 输出的行为。
 */
export function selectWaveStepDir(scripts: string[], waveTask: string, waveId: number): string {
  const taskPattern = new RegExp(`[/\\-_]${waveTask}(?:[/\\-_]|$)`, 'i')
  const matching = scripts.filter((s) => taskPattern.test(s))
  const chosen = matching.length > 0
    ? matching[matching.length - 1]!
    : scripts[scripts.length - 1]!
  return chosen.replace(/\/slurm\.sh$/, '')
}

function ladderOf(hit: PipelineDiagnoseHit): PrescriptionStep[] | undefined {
  const p = hit.prescription
  if (p === undefined || p.length === 0) return undefined
  return p.every((s) => typeof s.level === 'number') ? p : undefined
}

export function createPipelineDriverHooks(input: PipelineDriverInput): PipelineDriverHooks {
  const { pkg, execCommand } = input
  const workflowEnv = input.workflowEnv ?? DEFAULT_WORKFLOW_ENV
  const g16Env = input.g16Env ?? DEFAULT_G16_ENV
  const clusterId = input.state.clusterId
  const log: string[] = [`pipeline ${input.state.pipelineId}: ${pkg.task} ${pkg.waves.length} waves @${clusterId}`]
  let cancelled = false
  let cancelCurrent: (() => void) | undefined
  // jobId 本轮提交后记录，用于 cancel 时 scancel（best-effort）
  let lastSubmittedJobId: string | undefined

  const push = (line: string): void => {
    log.push(line)
    if (log.length > 400) log.splice(0, log.length - 400)
  }

  async function exec(command: string, timeoutSeconds = 60): Promise<ExecResult> {
    return execCommand(clusterId, command, timeoutSeconds)
  }

  /**
   * 提交当前波（幂等两步）：
   *   1. onSubmitIntent → commit（先落盘意图，崩溃后可识别悬挂窗口）
   *   2. sbatch 成功 → onWaveSubmitted → commit（清除意图，记 jobId 与 attempt）
   *
   * commit 由外层循环传入，使意图状态在 sbatch 抛错时也留在外层 state 里——
   * 否则 catch 分支会用「无意图」的状态覆盖磁盘，恰好抹掉幂等保护要保留的记录。
   *
   * retrying 档位下先做 pre.json 路由覆写 + pre 重跑（KB 纪律：整体覆写）。
   */
  async function submitWave(
    state: PipelineState,
    waveId: number,
    retryRoute: string | undefined,
    commit: (s: PipelineState) => void,
  ): Promise<{ state: PipelineState; jobId: string }> {
    const wave = pkg.waves.find((w) => w.id === waveId)
    if (wave === undefined) throw new Error(`pipeline: wave ${waveId} not in package`)
    // 提交闸前置（B2，2026-09-30）：check 在任何渲染 exec 之前——预算/相位拒绝
    // 是本地判定、零集群副作用，没道理先付 pre/run 渲染往返再被拒。批量池场景
    // 预算耗尽时，此前每条链都白渲染一次再停链。
    input.submitGate?.check({ workdir: input.state.workdir, waveId, retryRoute })
    if (retryRoute !== undefined) {
      // 处方换档：pre.json 路由键整体覆写
      const patched = { ...wave.preJson, [routeKeyOf(retryRoute)]: retryRoute }
      const safe = JSON.stringify(patched).replace(/'/g, `'\\''`)
      await exec(`echo '${safe}' > "${input.state.workdir}/pre.json"`)
      await exec(prePhaseCommand(input.state.workdir, pkg.task, workflowEnv))
      push(`wave ${waveId}: pre.json patched (${retryRoute}) + pre re-run`)
    }
    await exec(runPhaseCommand(input.state.workdir, pkg.task, workflowEnv, g16Env), 120)

    // run 渲染后定位本波 slurm.sh。此前用 `tail -1`（字典序最后）——一个未声明
    // 的命名约定：一旦 workflow 改了 step 目录命名，会静默提交错误的 step。
    // 改为显式断言：选中的 step 目录必须归属当前波的 task（如波 ts → 02-ts/）。
    const findResult = await exec(
      `find "${input.state.workdir}/${pkg.task}" -maxdepth 2 -name slurm.sh | sort`,
    )
    const scripts = outputText(findResult).trim().split('\n').filter((l) => l.length > 0)
    if (scripts.length === 0) {
      throw new Error(`pipeline: run rendered no slurm.sh under ${input.state.workdir}/${pkg.task}`)
    }
    const stepDir = selectWaveStepDir(scripts, wave.task, waveId)

    // ── 幂等第 1 步：先落意图（经 commit 进入外层 state），再发 sbatch ──
    const waveState = state.waves.find((w) => w.waveId === waveId)!
    const stateWithIntent = onSubmitIntent(state, waveId, retryRoute)
    commit(stateWithIntent)
    state = stateWithIntent

    const r = await exec(sbatchCommand(stepDir, 'slurm.sh'))
    const jobId = parseSbatchSubmission(outputText(r))
    lastSubmittedJobId = jobId

    input.submitGate?.record(jobId)

    // R3 同款自动记账（driver 侧唯一台账写点）
    const attemptNow = waveState.attempt + 1
    const line = JSON.stringify({
      event: 'submitted', task: pkg.task,
      step: stepDir.split('/').pop() ?? '',
      attempt: attemptNow, jobid: jobId,
    }).replace(/'/g, `'\\''`)
    try {
      await exec(`printf '%s\\n' '${line}' >> "${input.state.workdir}/attempts.jsonl"`)
    } catch {
      push('attempts-ledger append failed (bypassed)')
    }

    // ── 幂等第 2 步：确认 jobId，清除意图 ──
    const stateSubmitted = onWaveSubmitted(stateWithIntent, waveId, jobId)
    return { state: stateSubmitted, jobId }
  }

  /**
   * 监控当前波至终态；返回 producer 输出与（COMPLETED 时）post 物性。
   *
   * `timedOut` 区分「作业真的结束了」与「我们不再等了」——watch-loop 的
   * max-wait 路径以 status='completed' 结算（见 watch-loop.ts 的 settle），
   * 但那条路径不触发 onAllSettled，故既没跑 post 也没有 slurm_state 行。
   * 若把它当普通失败处理，会把一个仍在集群上正常排队/计算的作业判成失败——
   * 排队久的批量场景几乎必然踩到。故单独标记，由调用方走暂停语义。
   */
  async function watchWave(jobId: string): Promise<{ outcomeStatus: string; output: string; properties?: Record<string, unknown>; timedOut: boolean }> {
    let properties: Record<string, unknown> | undefined
    const producer = createGaussianProducerHooks({
      execCommand,
      clusterId,
      task: pkg.task,
      workdir: input.state.workdir,
      slurmJobId: jobId,
      workflowEnv,
      ...(input.pollSeconds !== undefined ? { pollSeconds: input.pollSeconds } : {}),
      ...(input.pollJitter !== undefined ? { pollJitter: input.pollJitter } : {}),
      ...(input.maxWaitSeconds !== undefined ? { maxWaitSeconds: input.maxWaitSeconds } : {}),
      ...(input.scfTrend !== undefined ? { scfTrend: input.scfTrend } : {}),
      // SCF 趋势异常确认 → 会话通知(池场景经池的 notify 包装自动带 [chainId] 前缀)
      onScfTrend: (reports) => {
        for (const r of reports) {
          input.notify?.(`pipeline ${input.state.pipelineId}: scf ${r.trend.kind} on wave job ${r.jobId} (cycle ${r.trend.cycles}) — ${r.trend.summary}`)
        }
      },
      ...(input.diagnose !== undefined
        ? { diagnose: (t: string) => input.diagnose?.(t) ?? [] }
        : {}),
      onResult: (result) => {
        if (result.properties !== undefined) properties = result.properties
      },
    })
    cancelCurrent = () => producer.cancel()
    const outcome = await producer.done
    const output = producer.readOutput()
    const stateMatch = output.match(/^slurm_state: (\S+)$/m)
    // max-wait 是「不再等了」而非终态：watch-loop 以 completed 结算但不跑
    // onAllSettled，故无 slurm_state 行。凭 detail 前缀识别（与 watch-loop 的
    // settle 文案同源；改那边的文案必须同步这里）。
    const timedOut = stateMatch === null && (outcome.detail ?? '').startsWith('max-wait exceeded')
    return {
      outcomeStatus: stateMatch !== null ? stateMatch[1]! : outcome.status === 'completed' ? 'UNKNOWN' : outcome.status,
      output,
      properties,
      timedOut,
    }
  }

  const done = (async (): Promise<PipelineDriverOutcome> => {
    let state = input.state
    const commit = (s: PipelineState): void => {
      state = s
      input.persist?.(s)
    }
    try {
      // 悬挂提交在场时 driver 绝不自行推进：远端可能已有作业，重提=双跑。
      // 收口权在会话（mat_pipeline_resume adopt/resubmit），fail-closed。
      if (state.pendingSubmit !== undefined) {
        const i = state.pendingSubmit
        const reason =
          `unresolved submit intent on wave ${i.waveId} (attempt ${i.attempt}, at ${new Date(i.at).toISOString()}) — ` +
          'a remote job may already exist; refusing to submit again. Verify with squeue/sacct, then ' +
          'mat_pipeline_resume action=adopt job_id=<id> or action=resubmit'
        commit(onNeedsLlm(state, reason))
        input.notify?.(`pipeline ${state.pipelineId}: ${reason}`)
        return { status: 'needs_llm', detail: reason }
      }
      while (!cancelled) {
        const waveState = state.waves.find((w) => w.waveId === state.currentWaveId)
        if (waveState === undefined) throw new Error(`pipeline: unknown current wave ${state.currentWaveId}`)
        const wave = pkg.waves.find((w) => w.id === waveState.waveId)!

        if (state.phase === 'planned' || state.phase === 'retrying') {
          const retryRoute = state.phase === 'retrying' ? waveState.prescriptionRoute : undefined
          const { state: submitted, jobId } = await submitWave(state, waveState.waveId, retryRoute, commit)
          commit(submitted)
          push(`wave ${wave.id} (${wave.task}) submitted job=${jobId} attempt=${submitted.waves.find((w) => w.waveId === wave.id)!.attempt}`)
        }

        if (cancelled) break

        const jobId = state.waves.find((w) => w.waveId === state.currentWaveId)!.jobId
        if (jobId === undefined) throw new Error(`pipeline: wave ${state.currentWaveId} has no jobId`)

        const settled = await watchWave(jobId)
        push(settled.output)

        if (cancelled) break

        const ws = state.waves.find((w) => w.waveId === state.currentWaveId)!
        // 等待超时 ≠ 作业失败：作业仍在集群上（排队或计算中），我们只是不再等。
        // 绝不能进失败环——那会把一个正常运行的作业判成失败、耗掉一次 attempt，
        // 甚至触发处方换档去重投一个同名作业。转 watch_expired（作业在场、监控
        // 不在场）；autoRewatchLimit 预算内直接原样重挂（纯机械、零重投风险），
        // 超预算才停给 LLM，由 resume rewatch 接手。
        if (settled.timedOut) {
          // R-5 可区分性:同一波的多次到期消息带序号——rewatch 周期会产生同前缀
          // 通知(同一 jobId),不带序号时 agent/人会误读为"通知重放"(r1 压测实证:
          // agent 主动声明忽略"重放",实为第 2 次真实到期)。
          const priorExpiries = state.waves.find((w) => w.waveId === waveState.waveId)!.watchExpiries ?? 0
          const expiryNote = `, expiry #${priorExpiries + 1}` +
            (input.autoRewatchLimit !== undefined ? ` of a ${input.autoRewatchLimit + 1}-window budget` : '')
          const reason =
            `wave ${wave.id} (${wave.task}) job ${jobId} still active after the watch window ` +
            `(${input.maxWaitSeconds ?? 1_800}s${expiryNote}) — NOT a failure: the job is still queued or running on the cluster. ` +
            'Re-attach monitoring with action=rewatch (mat_pipeline_resume for a standalone chain, ' +
            'mat_pool_resume action=rewatch chain=<id> for a pool chain) — ' +
            'do NOT resubmit, that would double-book core hours.'
          commit(onWatchExpired(state, waveState.waveId, reason))
          const expiries = state.waves.find((w) => w.waveId === state.currentWaveId)!.watchExpiries ?? 0
          if (input.autoRewatchLimit !== undefined && expiries <= input.autoRewatchLimit) {
            push(`wave ${wave.id} watch window elapsed (expiry #${expiries}) — auto re-arming monitoring (limit ${input.autoRewatchLimit}), no resubmit`)
            continue
          }
          input.notify?.(`pipeline ${state.pipelineId}: ${reason}`)
          return { status: 'needs_llm', detail: reason }
        }
        if (settled.outcomeStatus !== 'COMPLETED') {
          // 失败环：结构化处方梯自动换档；决策行/无梯进 → needs_llm（F2 座位）
          // 诊断文本经 diagnosticTextOf 提取（producer 契约行），避免把整段
          // 监控日志送进签名匹配稀释命中率。
          const hits = input.diagnose !== undefined ? input.diagnose(diagnosticTextOf(settled.output)) : []
          const ladderHit = hits.map((h) => ({ h, ladder: ladderOf(h) })).find((x) => x.ladder !== undefined)
          const cap = state.maxAttemptsPerWave
          if (ladderHit !== undefined && ladderHit.ladder !== undefined) {
            const nextLevel = (ws.prescriptionLevel ?? 0) + 1
            const rung = ladderHit.ladder.find((s) => s.level === nextLevel)
            if (rung === undefined || ws.attempt >= cap) {
              const reason = ws.attempt >= cap
                ? `attempt-cap ${cap} reached on wave ${wave.id}`
                : `ladder-exhausted: kb:${ladderHit.h.id}`
              commit(onDeadLettered(state, reason, ladderHit.h.id))
              input.markDeadLetter?.(jobId, reason, ladderHit.h.id)
              input.notify?.(`pipeline ${state.pipelineId}: wave ${wave.id} (${wave.task}) ${reason} — dead-lettered, report to user`)
              return { status: 'dead_lettered', detail: reason }
            }
            commit(onRetryScheduled(state, waveState.waveId, nextLevel, rung.route))
            push(`wave ${wave.id} FAILED → prescription L${nextLevel} (${rung.route})`)
            continue
          }
          const reason = hits.length > 0
            ? `wave ${wave.id} (${wave.task}) failed (attempt ${ws.attempt}); kb hits carry no ordered ladder (decision table or none): ${hits.map((h) => `kb:${h.id}`).join(', ')} — LLM diagnosis required`
            : `wave ${wave.id} (${wave.task}) failed (attempt ${ws.attempt}) with no kb signature hit — LLM diagnosis required`
          commit(onNeedsLlm(state, reason))
          input.notify?.(`pipeline ${state.pipelineId}: ${reason} (mat_pipeline_resume after diagnosis)`)
          return { status: 'needs_llm', detail: reason }
        }

        // COMPLETED：自身门检（ts 波 = converged 且虚频恰 1）
        // 数据源优先 result.json 原文（与 mat_sbatch 工具层的 checkWaveGate 同源）；
        // 未注入 readResultJson 时退回 producer 内存 properties（双轨风险见字段注释）。
        let gateInput: unknown = { properties: settled.properties ?? {} }
        if (input.readResultJson !== undefined) {
          try {
            gateInput = await input.readResultJson()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            // 门检数据源不可读 = 结算证据缺失，不得放行（fail-closed）
            const reason = `wave ${wave.id} (${wave.task}) COMPLETED but result.json unreadable (${message.slice(0, 160)}) — gate evidence missing, refusing to advance`
            commit(onWaveSettledGateFail(state, waveState.waveId, reason))
            input.notify?.(`pipeline ${state.pipelineId}: ${reason} (mat_pipeline_resume after diagnosis)`)
            return { status: 'needs_llm', detail: reason }
          }
        }
        const gate = checkSettledWave(wave, gateInput)
        if (!gate.ok) {
          commit(onWaveSettledGateFail(state, waveState.waveId, gate.reason))
          input.notify?.(`pipeline ${state.pipelineId}: wave ${wave.id} (${wave.task}) gate failed — ${gate.reason} (mat_pipeline_resume after diagnosis)`)
          return { status: 'needs_llm', detail: gate.reason }
        }

        // R8b：IRC 方向门（读 irc_profile CSV 判两分支是否从 TS 单调下坡）。
        // 与同步门分开是因为它要做 IO；未开启或未注入读取能力时直接放行。
        const dirGate = await checkIrcDirectionGate(wave, gateInput, input.readCsvFile)
        if (!dirGate.ok) {
          commit(onWaveSettledGateFail(state, waveState.waveId, dirGate.reason))
          input.notify?.(`pipeline ${state.pipelineId}: wave ${wave.id} (${wave.task}) IRC direction gate failed — ${dirGate.reason} (mat_pipeline_resume after diagnosis)`)
          return { status: 'needs_llm', detail: dirGate.reason }
        }

        const isLast = wave.id === [...pkg.waves].sort((a, b) => b.id - a.id)[0]!.id
        commit(onWaveSettledPassed(state, waveState.waveId))
        if (isLast) {
          // R-2:池内链的完成唤醒是 B3 降噪对象——'actionable' 模式下交池的
          // 收口通知汇总;单链(缺省 'all')保持完成唤醒(那是会话的主交付)。
          if ((input.notifyOn ?? 'all') === 'all') {
            input.notify?.(`pipeline ${state.pipelineId}: chain completed (${pkg.task}) — read result.json properties/plots and report`)
          }
          return { status: 'completed', detail: `all ${pkg.waves.length} waves passed` }
        }
        push(`wave ${wave.id} (${wave.task}) passed the gate`)
      }

      // ── cancel 收口 ──
      const liveJob = lastSubmittedJobId ?? state.waves.find((w) => w.waveId === state.currentWaveId)?.jobId
      if (liveJob !== undefined) {
        try {
          await exec(scancelCommand(liveJob), 15)
          push(`scancel sent for job ${liveJob}`)
        } catch {
          push(`scancel failed for job ${liveJob} (best-effort, may still be running)`)
        }
      }
      commit(onCancelled(state, 'cancelled by user'))
      return { status: 'cancelled', detail: 'cancelled by user' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      commit(onDriverError(state, message))
      input.notify?.(`pipeline ${state.pipelineId}: driver error — ${message}`)
      // 结构化拒绝（BUDGET_REJECTED/PHASE_GATE_REJECTED）带 code 上抛：池据此
      // 停止 admit 并快速收口，而不是把 N 条链逐条撞墙成 N 个 halted。
      return {
        status: 'needs_llm',
        detail: message,
        ...(GATE_REJECTED_PREFIX.test(message) ? { code: 'gate_rejected' as const } : {}),
      }
    }
  })()

  return {
    cancel(): void {
      cancelled = true
      cancelCurrent?.()
    },
    done,
    readOutput(): string {
      return log.join('\n')
    },
  }
}
