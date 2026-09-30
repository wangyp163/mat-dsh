/**
 * Slurm 作业批量监控循环（纯逻辑，无 cordis 依赖；定时器与 execCommand 全注入，可测）。
 *
 * 每 tick 一条批量 `sacct` 查询全部 job_id（sacct 对 PENDING/RUNNING/终态实时可见，
 * 见 docs/evidence/m1/2026-08-28-slurm-format-probe.md），无 LLM 参与；
 * 全部终态 / maxWait 超时 / 连续 5 次传输异常 / cancel 四路结算。
 *
 * 输出契约（对齐宿主 JobHooks 流式语义）：readOutput 返回"距上次读取的变化行"，
 * 结算时把摘要 + 完整终态表压入待读，终态后首读即拿全表。
 */

import type { ExecResult } from './client.ts'
import { isTerminal, nextPollDelayMs, parseSacctBatch } from './job-state.ts'
import type { SlurmJobInfo, SlurmJobState } from './job-state.ts'
import { classifyScfTrend, scfTrendActionable, formatScfTrendLine } from './scf-trend.ts'
import type { ScfTrend, ScfTrendKind, ScfTrendReport } from './scf-trend.ts'

/** watch 结算结果；status 取值与宿主 JobOutcome 三终态一一对应。 */
export interface WatchOutcome {
  status: 'completed' | 'killed' | 'failed'
  detail?: string
}

/** 全部终态时的结算增补（producer 注入点：终态后自动 post、物性行等）。 */
export interface WatchSettleAugment {
  detailSuffix?: string
  extraLines?: string[]
}

/**
 * SCF 收敛采样(高级作业监控,注入式):按采样窗对在途作业批量 tail 日志,
 * 趋势分类(纯函数,见 scf-trend.ts),异常连续两个采样窗确认后才上报——
 * 采样/解析/通知全部 best-effort,失败不影响状态轮询与结算。
 */
export interface ScfSamplingOptions {
  /** 采样窗最小间隔(毫秒),缺省 60s(粗于状态轮询即可)。 */
  intervalMs?: number
  /** 为在途作业 workdir 集合构造批量采样命令(输出须以 `=== <workdir>` 行分段,见 scf-trend.ts)。 */
  buildCommand: (workdirs: string[]) => string
  /** 解析采样输出:workdir → SCF 能量序列。 */
  parse: (output: string) => Map<string, number[]>
  /** 异常确认后的回调(振荡/发散确认、停滞逼近 TimeLimit);抛错被吞。 */
  onTrend?: (reports: ScfTrendReport[]) => void
}

/** createWatchLoop 的注入依赖。 */
export interface WatchLoopOptions {
  clusterId: string
  jobIds: string[]
  /** watch 总时限；到点仍未全部终态则按 max-wait 结算（可再 watch）。 */
  maxWaitMs: number
  /** 轮询间隔上限（毫秒）：自适应档位超出时压到此值；缺省不封顶。 */
  maxPollMs?: number
  /** 轮询抖动比(0-0.5):批量场景防 N 个 watch 同相轮询/同期到期;缺省不抖动。 */
  jitterRatio?: number
  /**
   * 全部作业终态时、最终结算前触发（仅此路径；max-wait/传输异常/cancel 不触发）。
   * 抛错不炸结算：吞入 extraLines 诊断行，watch 仍按 completed 结算。
   */
  onAllSettled?: (states: ReadonlyMap<string, SlurmJobInfo>) => Promise<WatchSettleAugment>
  /**
   * 每个成功轮询回合后触发（结算回合也触发，含终态；传输异常轮不触发）。
   * 第二参为最近一次采样的 SCF 趋势(未注入 scfSampling 时为空表)。
   * 抛错被吞：监控/结算不受影响（状态板喂料点，板故障不连坐 watch）。
   */
  onTick?: (states: ReadonlyMap<string, SlurmJobInfo>, scfTrends: ReadonlyMap<string, ScfTrend>) => void
  /** SCF 收敛采样(可选);注入后异常确认经 onTrend 上抛、趋势行进增量输出。 */
  scfSampling?: ScfSamplingOptions
  /** 远程执行（通常绑定一个专属 MatClient 实例）。 */
  execCommand: (clusterId: string, command: string, timeoutSeconds?: number) => Promise<ExecResult>
  scheduleTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

/** 对齐宿主 JobHooks：cancel 同步幂等；done 只 resolve 不 reject；readOutput 增量。 */
export interface WatchLoopHooks {
  cancel(reason?: string): void
  done: Promise<WatchOutcome>
  readOutput(): string
}

/** 终态计数展示顺序（成功在前）。 */
const STATE_ORDER: readonly SlurmJobState[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY']

/** 连续传输异常的放弃阈值（对齐 vasp-matstream wait_job 的 5 次容错）。 */
const MAX_CONSECUTIVE_ERRORS = 5

/**
 * 创建并启动一个批量监控循环（首跳立即执行，随后按事件感知自适应间隔
 * 10/60/120/300s——状态转移回拨细档，见 job-state.nextPollDelayMs）。
 * @param options - 注入依赖与监控参数。
 * @returns 宿主 JobHooks 同形句柄。
 */
export function createWatchLoop(options: WatchLoopOptions): WatchLoopHooks {
  const { clusterId, jobIds, maxWaitMs, execCommand, scheduleTimeout, clearTimeout } = options
  const watched = new Set(jobIds)
  const states = new Map<string, SlurmJobInfo>()
  /** 已写入待读的签名（state|exit|elapsed），用于增量判定。 */
  const reported = new Map<string, string>()
  const pending: string[] = []
  let timer: unknown = undefined
  let settled = false
  let consecutiveErrors = 0
  const startedAt = Date.now()
  /** 最近一次观测到状态变化（首观测/转移/终态翻转）的时刻——A1 档位键。 */
  let lastChangeAt = startedAt
  /** SCF 采样状态:每作业的确认/去抖账目 + 最近趋势(onTick 第二参)。 */
  let lastSampleAt = startedAt
  const scfSeen = new Map<string, { prevKind: ScfTrendKind; confirmed: ScfTrendKind | undefined; reportedKind: ScfTrendKind | undefined }>()
  const lastTrends = new Map<string, ScfTrend>()

  for (const id of jobIds) {
    pending.push(formatLine(id, undefined))
    reported.set(id, 'UNKNOWN')
  }

  function formatLine(id: string, info: SlurmJobInfo | undefined): string {
    if (info === undefined) return `${id} UNKNOWN (not observed)`
    const exit = info.exitCode !== undefined ? ` exit=${info.exitCode}` : ''
    const elapsed = info.elapsedSeconds !== undefined ? ` elapsed=${info.elapsedSeconds}s` : ''
    return `${id} ${info.state}${exit}${elapsed}`
  }

  function fullTable(): string[] {
    return jobIds.map((id) => formatLine(id, states.get(id)))
  }

  function summaryLine(): string {
    const counts = new Map<SlurmJobState, number>()
    let settledCount = 0
    for (const id of jobIds) {
      const info = states.get(id)
      if (info === undefined || !isTerminal(info.state)) continue
      settledCount += 1
      counts.set(info.state, (counts.get(info.state) ?? 0) + 1)
    }
    const parts = STATE_ORDER
      .filter((s) => (counts.get(s) ?? 0) > 0)
      .map((s) => `${counts.get(s)} ${s}`)
    return `${settledCount}/${jobIds.length} settled (${parts.join(', ')})`
  }

  function schedule(delayMs: number): void {
    // 抖动仅用于批量场景去同步(N 个 watch 同相轮询);单 watch 缺省不抖。
    const jittered = options.jitterRatio !== undefined && delayMs > 0
      ? delayMs * (1 - options.jitterRatio + 2 * options.jitterRatio * Math.random())
      : delayMs
    timer = scheduleTimeout(() => { void tick() }, Math.max(0, jittered))
  }

  /**
   * 下一跳延迟（A1+A2）：自适应档位以「距最近状态变化」为键，可被 maxPollMs
   * 封顶，且不得越过 watch 总时限——否则 tick 顶部的超时判定最多迟到一档。
   */
  function nextDelay(): number {
    const adaptive = nextPollDelayMs(Date.now() - lastChangeAt)
    const capped = options.maxPollMs !== undefined ? Math.min(adaptive, options.maxPollMs) : adaptive
    const remaining = maxWaitMs - (Date.now() - startedAt)
    return Math.min(capped, Math.max(0, remaining))
  }

  /**
   * SCF 收敛采样回合（旁路观测，best-effort）：
   *   1. 采样窗到点且存在 RUNNING/COMPLETING 作业 → 一条批量 tail；
   *   2. 逐作业分类；异常（oscillating/diverging/stalled）须连续两个采样窗
   *      同类才确认（DIIS 建子空间的头几轮天然振荡，单窗不下重判）；
   *   3. 确认且值得唤醒（scfTrendActionable：振荡/发散确认即报，停滞仅当
   *      逼近 TimeLimit）→ 趋势行进增量输出 + onTrend 上抛；同 kind 去抖，
   *      转 converging 后复位（再次异常可再报）。
   */
  async function sampleScf(): Promise<void> {
    const sampling = options.scfSampling
    if (sampling === undefined) return
    lastSampleAt = Date.now()
    const targets = [...states.entries()]
      .filter(([, info]) => (info.state === 'RUNNING' || info.state === 'COMPLETING') && info.workdir !== undefined)
      .map(([jobId, info]) => ({ jobId, workdir: info.workdir! }))
    if (targets.length === 0) return
    let energiesByWorkdir: Map<string, number[]>
    try {
      const r = await execCommand(clusterId, sampling.buildCommand([...new Set(targets.map((t) => t.workdir))]), 30)
      // rc≠0(10020)宽限:glob 兜底路径无匹配时 for 循环退出码非零,但已命中的
      // tail 输出仍在 stdout——与 sacct 轮询的宽限同款语义,按 stdout 解析;
      // 空/解析不出只是 insufficient,不算采样失败(r4 真机定位:此分支曾把
      // 100 条完好能量样本整个丢弃,四轮回归零告警的最终根因)。
      energiesByWorkdir = sampling.parse(typeof r.data === 'string' ? r.data : (r.data?.stdout ?? ''))
    } catch {
      return // 传输级失败不连坐监控:下一窗重试
    }
    const reports: ScfTrendReport[] = []
    for (const { jobId, workdir } of targets) {
      const energies = energiesByWorkdir.get(workdir) ?? []
      const trend = classifyScfTrend(energies)
      lastTrends.set(jobId, trend)
      const seen = scfSeen.get(jobId) ?? { prevKind: 'insufficient' as ScfTrendKind, confirmed: undefined, reportedKind: undefined }
      const anomaly = trend.kind === 'oscillating' || trend.kind === 'diverging' || trend.kind === 'stalled'
      if (anomaly && seen.prevKind === trend.kind) seen.confirmed = trend.kind
      else if (!anomaly) seen.confirmed = undefined
      seen.prevKind = trend.kind
      const info = states.get(jobId)
      const report: ScfTrendReport = {
        jobId, workdir, trend,
        recentDeltas: recentDeltasOf(energies),
        ...(info?.elapsedSeconds !== undefined ? { elapsedSeconds: info.elapsedSeconds } : {}),
        ...(info?.timelimitSeconds !== undefined ? { timelimitSeconds: info.timelimitSeconds } : {}),
      }
      if (seen.confirmed !== undefined && seen.reportedKind !== trend.kind && scfTrendActionable(report)) {
        seen.reportedKind = trend.kind
        pending.push(formatScfTrendLine(report))
        reports.push(report)
      } else if (trend.kind === 'converging') {
        seen.reportedKind = undefined // 恢复后去抖复位:再次异常可再报
      }
      scfSeen.set(jobId, seen)
    }
    if (reports.length > 0) {
      try {
        sampling.onTrend?.(reports)
      } catch {
        // 通知通道故障不连坐监控
      }
    }
  }

  function recentDeltasOf(energies: number[]): number[] {
    const out: number[] = []
    for (let i = Math.max(1, energies.length - 4); i < energies.length; i += 1) {
      out.push(energies[i]! - energies[i - 1]!)
    }
    return out
  }

  function settle(outcome: WatchOutcome, flushSummary: boolean, extraLines: readonly string[] = []): void {
    if (settled) return
    settled = true
    if (timer !== undefined) clearTimeout(timer)
    if (flushSummary) pending.push(summaryLine())
    pending.push(...extraLines)
    pending.push(...fullTable())
    resolveDone(outcome)
  }

  let resolveDone: (outcome: WatchOutcome) => void = () => {}
  const done = new Promise<WatchOutcome>((resolve) => { resolveDone = resolve })

  async function tick(): Promise<void> {
    if (settled) return
    const elapsed = Date.now() - startedAt
    if (elapsed >= maxWaitMs) {
      const active = jobIds
        .filter((id) => {
          const info = states.get(id)
          return info === undefined || !isTerminal(info.state)
        })
        .map((id) => `${id} ${states.get(id)?.state ?? 'UNKNOWN'}`)
        .join(', ')
      settle({ status: 'completed', detail: `max-wait exceeded; still active: ${active}` }, true)
      return
    }

    // WorkDir/Timelimit 列随批量 sacct 一次取回（零额外往返）：watch 作业的远端
    // 工作目录权威来源（文件面板与 SCF 采样路径都靠它；sbatch 手动提交的作业
    // 只有这里知道 workdir）；Timelimit 供停滞逼近时限的预警判定。
    const command = `sacct -j ${jobIds.join(',')} -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir,Timelimit`
    try {
      const r = await execCommand(clusterId, command, 30)
      if (r.code === 0) {
        const stdout = typeof r.data === 'string' ? r.data : (r.data?.stdout ?? '')
        for (const info of parseSacctBatch(stdout).values()) {
          if (!watched.has(info.jobId)) continue
          // A1：状态串变化（首观测/转移/终态翻转）回拨档位时钟；exit/elapsed
          // 的例行变化不算（否则 RUNNING 作业每轮都重置，档位永不升档）。
          const prev = states.get(info.jobId)
          if (prev === undefined || prev.state !== info.state) lastChangeAt = Date.now()
          states.set(info.jobId, info)
        }
      }
      // 远端 rc≠0（code 10020）：本轮无数据，宽限不计数（sacct 偶发/权限抖动）
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors += 1
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const message = err instanceof Error ? err.message : String(err)
        settle({ status: 'failed', detail: `poll failed ${MAX_CONSECUTIVE_ERRORS} consecutive times: ${message}` }, true)
        return
      }
      schedule(nextDelay())
      return
    }

    for (const [id, info] of states) {
      const signature = `${info.state}|${info.exitCode ?? ''}|${info.elapsedSeconds ?? ''}`
      if (reported.get(id) !== signature) {
        reported.set(id, signature)
        pending.push(formatLine(id, info))
      }
    }

    if (options.onTick !== undefined) {
      try {
        options.onTick(states, lastTrends)
      } catch {
        // 吞掉：状态板喂料失败不连坐监控（契约：onTick 抛错不影响结算）
      }
    }

    if (jobIds.every((id) => {
      const info = states.get(id)
      return info !== undefined && isTerminal(info.state)
    })) {
      if (options.onAllSettled === undefined) {
        settle({ status: 'completed', detail: summaryLine() }, true)
        return
      }
      let augment: WatchSettleAugment = {}
      try {
        augment = (await options.onAllSettled(states)) ?? {}
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        augment = { extraLines: [`on-all-settled hook failed: ${message}`] }
      }
      if (settled) return // 钩子执行期间被 cancel 等先行结算，增补丢弃
      settle(
        {
          status: 'completed',
          detail: augment.detailSuffix !== undefined ? `${summaryLine()}${augment.detailSuffix}` : summaryLine(),
        },
        true,
        augment.extraLines ?? [],
      )
      return
    }
    // SCF 采样(旁路):采样窗到点才跑,不改变状态轮询节奏
    if (options.scfSampling !== undefined && Date.now() - lastSampleAt >= (options.scfSampling.intervalMs ?? 60_000)) {
      await sampleScf()
    }
    schedule(nextDelay())
  }

  schedule(0)

  return {
    cancel(reason) {
      settle({ status: 'killed', detail: reason }, true)
    },
    done,
    readOutput() {
      if (pending.length === 0) return ''
      const text = pending.join('\n')
      pending.length = 0
      return text
    },
  }
}
