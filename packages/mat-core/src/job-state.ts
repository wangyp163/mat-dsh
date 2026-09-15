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
  | 'PENDING' | 'RUNNING'
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
    result.set(jobId, {
      jobId,
      state: classifyState(rawState ?? ''),
      exitCode: Number.isFinite(exitNum) ? exitNum : undefined,
      elapsedSeconds: elapsed !== undefined && Number.isFinite(elapsed) ? elapsed : undefined,
      ...(workdir === '' ? {} : { workdir }),
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
    'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY',
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
 * 自适应轮询间隔（对齐 vasp-matstream 实践）：开局密、后期疏，
 * 兼顾短作业快速收敛与长作业低开销。
 * @param elapsedMs - watch 已经过时长。
 * @returns 下一次轮询的延迟毫秒：10s / 60s / 120s / 300s 四档。
 */
export function nextPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 10_000
  if (elapsedMs < 600_000) return 60_000
  if (elapsedMs < 1_800_000) return 120_000
  return 300_000
}
