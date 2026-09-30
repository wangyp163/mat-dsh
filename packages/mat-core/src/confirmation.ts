/**
 * 确认闸投影与摘要（D0 P2 / 决策 D2.1）——给用户签字的数字必须投影，不得模型转述。
 *
 * summarizePre 是纯函数：传入**合成默认值之后**的生效 pre.json / run.json，
 * 输出关键参数摘要（方法/基组/电荷多重度/资源/队列/核时估算）；confirmationDigest
 * 对固定键序的规范 JSON 取 sha256——同配置同摘要、改任何关键字段即变。
 * 拒绝形态由调用方（工具层）组织：CONFIRM_REQUIRED + 投影 + digest，
 * 与 budget 的 BUDGET_REJECTED 同款"结构化拒绝、零副作用"语义。
 */

import { createHash } from 'node:crypto'

export interface PreConfirmationSummary {
  method: string
  basis: string
  charge: number | null
  mult: number | null
  ncores: number | null
  memory: string
  partition: string
  nodes: number | null
  ntasksPerNode: number | null
  walltime: string
  slurmMem: string
  estimatedCoreHours: number | null
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** run.json 的 slurm 段 → 估计核时（nodes × ntasks × walltime）；解析失败返回 null。 */
export function estimateCoreHoursFromRunJson(runJson: unknown): number | null {
  const slurm = asRecord(asRecord(runJson)['slurm'])
  const nodes = asNumber(slurm['nodes'])
  const ntasks = asNumber(slurm['ntasks_per_node'])
  const time = asString(slurm['time'])
  if (nodes === null || ntasks === null || time === '') {
    return null
  }
  const parts = time.split(':').map(Number)
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) {
    return null
  }
  const [h, m, s] = parts
  return Math.round(nodes * ntasks * (h + m / 60 + s / 3600) * 100) / 100
}

export function summarizePre(preJson: unknown, runJson: unknown): PreConfirmationSummary {
  const calc = asRecord(asRecord(asRecord(asRecord(preJson)['ase']))['calculator_kwargs'])
  const resources = asRecord(asRecord(preJson)['resources'])
  const slurm = asRecord(asRecord(runJson)['slurm'])
  return {
    method: asString(calc['method']),
    basis: asString(calc['basis']),
    charge: asNumber(calc['charge']),
    mult: asNumber(calc['mult']),
    ncores: asNumber(resources['ncores']),
    memory: asString(resources['memory']),
    partition: asString(slurm['partition']),
    nodes: asNumber(slurm['nodes']),
    ntasksPerNode: asNumber(slurm['ntasks_per_node']),
    walltime: asString(slurm['time']),
    slurmMem: asString(slurm['mem']),
    estimatedCoreHours: estimateCoreHoursFromRunJson(runJson),
  }
}

/** 固定键序规范 JSON → sha256 hex（64 位）。同配置必然同摘要。 */
export function confirmationDigest(summary: PreConfirmationSummary): string {
  const canonical = JSON.stringify({
    method: summary.method,
    basis: summary.basis,
    charge: summary.charge,
    mult: summary.mult,
    ncores: summary.ncores,
    memory: summary.memory,
    partition: summary.partition,
    nodes: summary.nodes,
    ntasks_per_node: summary.ntasksPerNode,
    walltime: summary.walltime,
    slurm_mem: summary.slurmMem,
    estimated_core_hours: summary.estimatedCoreHours,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/** 投影 → 给用户看的确认块（拒绝消息内嵌）。 */
export function formatConfirmationSummary(summary: PreConfirmationSummary, digest: string): string {
  const lines = [
    `method/basis/charge/mult : ${summary.method || '-'} / ${summary.basis || '-'} / ${summary.charge ?? '-'} / ${summary.mult ?? '-'}`,
    `resources                : ${summary.ncores ?? '-'} cores, ${summary.memory || '-'}`,
    `slurm                    : partition=${summary.partition || '-'}, ${summary.nodes ?? '-'} node(s) × ${summary.ntasksPerNode ?? '-'} tasks, walltime=${summary.walltime || '-'}, mem=${summary.slurmMem || '-'}`,
    `estimated core-hours     : ${summary.estimatedCoreHours ?? '-'}`,
    `digest                   : ${digest}`,
  ]
  return lines.join('\n')
}
