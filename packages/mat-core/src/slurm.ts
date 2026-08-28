/**
 * Slurm 原语：sinfo 分区表 / sbatch 提交 / 单作业状态查询 / scancel
 * （移植自 plugin.py §519-577，命令与解析一一对应）。
 *
 * 注意：本集群 squeue 对 RUNNING 作业常返回空（docs/evidence/m1/2026-08-28-slurm-format-probe.md），
 * 单作业状态查询以 sacct 兜底为主路径；squeue→sacct 两段结构与 Python 版保持一致。
 */

import type { ExecResult } from './client'

/** 与 watch-loop 同形的注入式远程执行（通常绑定一个 MatClient 实例）。 */
export type ExecCommandFn = (clusterId: string, command: string, timeoutSeconds?: number) => Promise<ExecResult>

/** 分区观测行。 */
export interface PartitionInfo {
  partition: string
  avail: string
  timelimit: string
  nodes: string
  state: string
}

/** sinfo 五列管道格式（`tail -n +2` 剔除表头）。 */
export const SINFO_COMMAND = "sinfo -o '%P|%a|%l|%D|%t' | tail -n +2"

export function sbatchCommand(workdir: string, script: string): string {
  return `cd "${workdir}" && sbatch ${script}`
}

export function jobStatusCommand(jobId: string): string {
  return `squeue -j ${jobId} -h -o '%T' 2>/dev/null | head -1`
}

export function jobStatusFallbackCommand(jobId: string): string {
  return `sacct -j ${jobId} --noheader -o State%20 2>/dev/null | head -1`
}

export function scancelCommand(jobId: string): string {
  return `scancel ${jobId}`
}

/**
 * 解析 sinfo 五列输出；默认分区名尾部的 `*` 剥离，畸形行（<5 列）跳过不抛。
 */
export function parseSinfoOutput(stdout: string): PartitionInfo[] {
  const partitions: PartitionInfo[] = []
  for (const line of stdout.trim().split('\n')) {
    const cols = line.split('|').map((c) => c.trim())
    if (cols.length < 5) continue
    partitions.push({
      partition: (cols[0] ?? '').replace(/\*+$/, ''),
      avail: cols[1] ?? '',
      timelimit: cols[2] ?? '',
      nodes: cols[3] ?? '',
      state: cols[4] ?? '',
    })
  }
  return partitions
}

/**
 * 解析 sbatch 输出取作业 id（对齐 plugin.py：含 "Submitted batch job" 时取行末 token）；
 * 无标记抛错带原始输出。
 */
export function parseSbatchSubmission(stdout: string): string {
  if (stdout.includes('Submitted batch job')) {
    const tokens = stdout.trim().split(/\s+/)
    return tokens.at(-1) ?? ''
  }
  throw new Error(`sbatch failed: ${stdout.trim()}`)
}

/**
 * 归一单作业状态查询输出：trim 后原样返回（`CANCELLED by <uid>` 等变体的归一
 * 交给 classifyState）；空串表示未观测。
 */
export function parseSingleJobState(stdout: string): string {
  return stdout.trim()
}

/** 取 ExecResult 的 stdout（无论远端成败；stderr 不混入状态判定）。 */
function stdoutOf(r: ExecResult): string {
  return typeof r.data === 'string' ? r.data : (r.data?.stdout ?? '')
}

/**
 * 单作业状态两段查询：squeue 有态即返回，否则 sacct 兜底；两段皆空返回空串。
 */
export async function queryJobStatus(execCommand: ExecCommandFn, clusterId: string, jobId: string): Promise<string> {
  const viaSqueue = parseSingleJobState(stdoutOf(await execCommand(clusterId, jobStatusCommand(jobId))))
  if (viaSqueue !== '') return viaSqueue
  return parseSingleJobState(stdoutOf(await execCommand(clusterId, jobStatusFallbackCommand(jobId))))
}
