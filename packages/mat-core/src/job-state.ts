/**
 * Slurm 作业状态解析与判定（sacct 批量输出）。
 *
 * 输入契约（与 watch 循环的查询命令一一对应，格式实测见
 * docs/evidence/m1/2026-08-28-slurm-format-probe.md）：
 *   sacct -j <id1>,<id2>,... -P -n -o JobID,State,ExitCode,ElapsedRaw
 *   → "<id>|<State>|<ExitCode>|<ElapsedRaw>"，每作业 3 行（主行 + .batch/.extern 子行），
 *     不存在的 id 静默不出行；PENDING/RUNNING/终态全部实时可见。
 */

/** sacct 可见状态的归一集；UNKNOWN 兜底未知串。 */
export type SlurmJobState =
  | 'PENDING' | 'RUNNING' | 'COMPLETING'
  | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT' | 'NODE_FAIL' | 'OUT_OF_MEMORY'
  | 'UNKNOWN'

/** 单个作业的观测快照。 */
export interface SlurmJobInfo {
  jobId: string
  state: SlurmJobState
  /** 冒号前的进程退出码（"0:0" 的 exit 部分）；解析不出则缺省。 */
  exitCode?: number
  /** ElapsedRaw 原生秒；空值缺省。 */
  elapsedSeconds?: number
  /** sacct WorkDir 列（提交目录，绝对路径）；列缺省或空值时缺省——文件面板据此浏览远端文件。 */
  workdir?: string
  /** sacct Timelimit 列换算秒（[DD-]HH:MM[:SS] / UNLIMITED 缺省）；SCF 停滞预警用。 */
  timelimitSeconds?: number
}

/** sacct Timelimit 串 → 秒:三段 `[DD-]HH:MM:SS`;两段 `[DD-]MM:SS`(slurm 对 <1h 时限的打印形态,如 30:00 = 30min);UNLIMITED/畸形 → undefined。 */
export function parseTimelimitSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const s = raw.trim()
  if (s === '' || /unlimit/i.test(s)) return undefined
  const m = /^(?:(\d+)-)?(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s)
  if (m === null) return undefined
  const days = m[1] !== undefined ? Number(m[1]) : 0
  if (m[4] !== undefined) {
    return days * 86_400 + Number(m[2]) * 3_600 + Number(m[3]) * 60 + Number(m[4])
  }
  return days * 86_400 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * 解析 `sacct -P -n` 批量输出。只取主 id 行（丢弃 `.batch`/`.extern`/数组步骤子行），
 * 畸形行跳过不抛。
 * @param stdout - sacct 原始 stdout（`id|State|ExitCode|ElapsedRaw[,WorkDir]` 行流）。
 * @returns jobId → 观测快照；输出里不存在的 id 不在表中。
 */
export function parseSacctBatch(stdout: string): Map<string, SlurmJobInfo> {
  const result = new Map<string, SlurmJobInfo>()
  for (const line of stdout.split('\n')) {
    const cols = line.split('|')
    if (cols.length < 3) continue
    const [jobId, rawState, rawExit] = cols
    if (!jobId || !/^\d+$/.test(jobId)) continue // 子行（id.batch 等）与非数字 id 一并跳过
    const exitNum = Number(rawExit?.split(':')[0])
    const elapsed = cols[3] !== undefined && cols[3] !== '' ? Number(cols[3]) : undefined
    const workdir = cols[4]?.trim()
    const timelimit = parseTimelimitSeconds(cols[5])
    result.set(jobId, {
      jobId,
      state: classifyState(rawState ?? ''),
      exitCode: Number.isFinite(exitNum) ? exitNum : undefined,
      elapsedSeconds: elapsed !== undefined && Number.isFinite(elapsed) ? elapsed : undefined,
      ...(workdir === '' ? {} : { workdir }),
      ...(timelimit !== undefined ? { timelimitSeconds: timelimit } : {}),
    })
  }
  return result
}

/**
 * 归一 sacct State 串：大小写容错；`CANCELLED`/`CANCELLED+`/`CANCELLED by <uid>`
 * 等变体归 CANCELLED；未知串归 UNKNOWN。
 * @param raw - sacct State 列原值。
 * @returns 归一后的状态。
 */
export function classifyState(raw: string): SlurmJobState {
  const s = raw.trim().toUpperCase()
  if (s === '') return 'UNKNOWN'
  if (s.startsWith('CANCELLED')) return 'CANCELLED'
  const known: readonly SlurmJobState[] = [
    'PENDING', 'RUNNING', 'COMPLETING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY',
  ]
  for (const k of known) {
    if (s === k) return k
  }
  return 'UNKNOWN'
}

/**
 * 是否终态（监控结算依据）：六种之一；PENDING/RUNNING/UNKNOWN 仍在途。
 * @param state - 归一后的状态。
 */
export function isTerminal(state: SlurmJobState): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED'
    || state === 'TIMEOUT' || state === 'NODE_FAIL' || state === 'OUT_OF_MEMORY'
}

/**
 * 自适应轮询间隔（事件感知版，A1 2026-09-30）：档位键是「距最近一次观测到
 * 状态变化（或 watch 启动）的时长」，不是 watch 总时长——转移后回细档捕捉
 * 后续事件（PENDING→RUNNING 后短作业的完成在 ≤10s 内可见），长时间无变化
 * 则单调升档到 300s。首观测（UNKNOWN→X）计为一次变化：保持「已 RUNNING
 * 的短作业开局 10s 档」的既有行为；全 PENDING 批次为此付 60s 细档（约 6 次
 * 轮询，可忽略，还顺带快速捕获秒失败作业）。
 * @param sinceChangeMs - 距最近一次观测到状态变化（或启动）的毫秒数。
 * @returns 下一次轮询的延迟毫秒：10s / 60s / 120s / 300s 四档。
 */
export function nextPollDelayMs(sinceChangeMs: number): number {
  if (sinceChangeMs < 60_000) return 10_000
  if (sinceChangeMs < 600_000) return 60_000
  if (sinceChangeMs < 1_800_000) return 120_000
  return 300_000
}
