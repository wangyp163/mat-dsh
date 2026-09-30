/**
 * mat_sbatch 的波间门闸接线（审阅表 R4）。
 *
 * 语义：调用方传 wave_gate = {pkg_digest, wave_id} 即激活——提交前读本地
 * 持久化的 task package（mat_task_build 落盘，门条件来自 planning 物化，
 * 不经 LLM 转述）与远端 result.json，前序波未结算或未过门即抛
 * GATE_FAILED 前缀错误（零集群副作用）。首波无前置门直接放行；
 * 不传 wave_gate = 不受闸（存量用法零影响）。
 */

import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { checkWaveGate, outputText } from 'mat-core'
import type { MatClient, TaskPackage } from 'mat-core'

export interface WaveGateRef {
  pkgDigest: string
  waveId: number
}

/** 工具面 wave_gate 参数解析；undefined = 不受闸。 */
export function parseWaveGateRef(raw: unknown): WaveGateRef | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('wave_gate must be an object {pkg_digest, wave_id}')
  }
  const o = raw as Record<string, unknown>
  if (typeof o.pkg_digest !== 'string' || o.pkg_digest.length === 0) {
    throw new Error('wave_gate requires non-empty pkg_digest (from mat_task_build)')
  }
  if (typeof o.wave_id !== 'number' || !Number.isInteger(o.wave_id) || o.wave_id < 1) {
    throw new Error('wave_gate requires positive integer wave_id')
  }
  return { pkgDigest: o.pkg_digest, waveId: o.wave_id }
}

function loadPersistedPackageOrThrow(path: string, digest: string): TaskPackage {
  let pkg: TaskPackage
  try {
    pkg = JSON.parse(readFileSync(path, 'utf8')) as TaskPackage
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `GATE_FAILED: cannot load task package for digest ${digest} (${message}) — ` +
      're-run mat_task_build with the same goal to persist it, then retry with that digest',
    )
  }
  if (pkg.waves === undefined || !Array.isArray(pkg.waves) || typeof pkg.task !== 'string') {
    throw new Error(`GATE_FAILED: persisted task package ${path} is malformed (missing task/waves)`)
  }
  return pkg
}

/** 加载 mat_task_build 落盘的编译产物（sbatch 波间门与 pipeline 共用）。 */
export function loadPersistedPackage(packagesRoot: string, digest: string): TaskPackage {
  return loadPersistedPackageOrThrow(join(packagesRoot, `${digest}.json`), digest)
}

/**
 * 提交前门检：workdir 须形如 {work_dir}/{pkg.task}/{step 目录}（两级上推读 result.json）。
 * @param packagesRoot 本地 task-packages 目录（localWorkspaceRoot()/task-packages）。
 */
export async function assertWaveGate(
  client: MatClient,
  packagesRoot: string,
  clusterId: string,
  workdir: string,
  raw: unknown,
): Promise<void> {
  const ref = parseWaveGateRef(raw)
  if (ref === undefined) return
  const pkg = loadPersistedPackage(packagesRoot, ref.pkgDigest)
  if (pkg.waves.every((w) => w.id !== ref.waveId)) {
    throw new Error(
      `GATE_FAILED: wave ${ref.waveId} not in task package ${pkg.task} ` +
      `(waves: ${pkg.waves.map((w) => w.id).join(',')})`,
    )
  }
  if (!pkg.waves.some((w) => w.id < ref.waveId)) return // 首波无前置门
  const normalized = workdir.replace(/\/+$/, '')
  const taskDir = basename(dirname(normalized))
  if (taskDir !== pkg.task) {
    throw new Error(
      `wave_gate workdir mismatch: expected {work_dir}/${pkg.task}/<step 目录>, got parent '${taskDir}' — refusing to check the wrong result.json`,
    )
  }
  const root = dirname(dirname(normalized))
  let result: unknown
  try {
    const r = await client.execCommand(clusterId, `cat ${root}/result.json`)
    result = JSON.parse(outputText(r))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `GATE_FAILED: cannot read ${root}/result.json (${message.slice(0, 160)}) — ` +
      `previous wave settlement unknown, refusing to submit wave ${ref.waveId}`,
    )
  }
  const decision = checkWaveGate(pkg, ref.waveId, result)
  if (!decision.ok) {
    throw new Error(`GATE_FAILED: ${decision.reason}`)
  }
}
