/**
 * VASP（matstream 引擎）工作流编排（纯逻辑，零 IO）。
 *
 * 执行模型与 gaussian 不同构（ENGINE_BOUNDARY_NOTES.vaspNotes）：任务链数据交接
 * （CONTCAR 传播、WAVECAR/CHGCAR 复用）只在单个 `matstream run` 进程内成立，
 * 故整链在**一个 Slurm 作业内**执行（pre+run+post 全在作业内）。本地编排收敛为两段：
 *   同步段 runVaspSync：prepare（单次调用打包 mkdir/heredoc 结构文件/heredoc 本地
 *   渲染的 slurm.sh/落盘校验）→ sbatch，返回 slurmJobId；
 *   producer：sacct 监控至终态后自动 harvest（只读收割：matstream.json + Task 目录
 *   清单 + OSZICAR/OUTCAR 收敛探针 + 作业日志尾）。
 *
 * 运行时是**家目录自部署双件套**（对齐 gaussian 的 demo + g16-hy 运维模型，
 * 2026-09-24 从 apptainer sif 切换）：
 *   workflow_env `$HOME/workspace/matstream/env.sh`（conda-pack py3.11 + matstream 0.1.3
 *   + spglib + xmltodict，VERSION 自锚）；
 *   vasp_env `$HOME/workspace/vasp-hy/scripts/env.sh`（公共区 5.4.4-iOptCell 拷贝，
 *   SCRIPTDIR 重写 + 预载 mpi/* 卸载循环——作业环境 /etc/profile 自带 mpi/hpcx 会与
 *   intelmpi 冲突，2026-09-24 作业 122895612 实证）；
 *   VASP 经 CALCULATOR_VASP_COMMAND='srun --mpi=pmi2 vasp_std' 由 Slurm 原生启动
 *   （引擎 vasp.py 的 env 覆盖点；np 跟 --ntasks-per-node 走）。
 *
 * 收敛探针是本引擎的必要补偿：matstream 自身无收敛检查（引擎 README TODO），
 * Slurm COMPLETED ≠ 物理收敛——探针行进终态输出，判读协议在 vasp-calc skill。
 */

import { outputText } from './client.ts'
import type { ExecCommandFn } from './slurm.ts'
import { parseSbatchSubmission } from './slurm.ts'
import { createWatchLoop } from './watch-loop.ts'
import type { SlurmJobInfo } from './job-state.ts'
import type { WatchLoopHooks, WatchOutcome } from './watch-loop.ts'
import { createVaspMatAdapter } from './workflow-contract.ts'
import type { RemoteWorkflowAdapter, RemoteWorkflowRequest, RemoteWorkflowResult } from './workflow-contract.ts'
import type { PlotEntry } from './status-board.ts'
import { formatPrescription } from './db.ts'
import type { PrescriptionStep } from './db.ts'
import { createHash } from 'node:crypto'

/** 家目录部署的 matstream workflow 环境（conda-pack py3.11 + matstream CLI）。 */
export const DEFAULT_MATSTREAM_ENV = '$HOME/workspace/matstream/env.sh'
/** 家目录部署的 VASP 环境（5.4.4-iOptCell 拷贝 + module 守卫 + mpi 卸载循环）。 */
export const DEFAULT_VASP_ENV = '$HOME/workspace/vasp-hy/scripts/env.sh'
/**
 * VASP 启动命令（引擎 CALCULATOR_VASP_COMMAND 覆盖点）：Slurm 原生启动，
 * np 跟 --ntasks-per-node 走；2026-09-24 作业 122895612 真实 scf 实证。
 */
export const DEFAULT_CALCULATOR_VASP_COMMAND = 'srun --mpi=pmi2 vasp_std'
/** 部署版本锚（$HOME/workspace/matstream/VERSION；与 env_profile.sh 同步）。 */
export const MATSTREAM_WORKFLOW_VERSION = '0.1.3'

/** 11250 缺省分区（探针 2026-09-23 定 kshcnormal；r1 压测 2026-09-30 实证 Agent0 仍在但 624/640 核饱和，不可作缺省）。 */
export const DEFAULT_VASP_PARTITION = 'kshcnormal'
/** 缺省墙钟：与 producer 缺省 max-wait 对齐；kshcnormal 时限 333 天，24h 安全。 */
export const DEFAULT_VASP_TIME = '24:00:00'
export const DEFAULT_VASP_NODES = 1
export const DEFAULT_VASP_NTASKS_PER_NODE = 32

/** matstream 任务注册表（引擎 v0.1.3 task/__init__.py 的 __all__）。 */
export const VASP_TASKS = [
  'relax', 'scf', 'band', 'relaxdftu', 'scfdftu', 'banddftu',
  'unfold', 'phonon', 'magmom', 'born', 'pdos', 'spincharge',
] as const
export type VaspTask = (typeof VASP_TASKS)[number]

/** 精度档（INCAR 关键参数投影见 vasp-calc skill 的 preset 表）。 */
export const VASP_PRESETS = ['veryfast', 'fast', 'medium', 'slow', 'veryslow'] as const
export type VaspPreset = (typeof VASP_PRESETS)[number]

/** 自旋模式（nospin/spin/soc；MAGMOM 启发式在引擎内）。 */
export const VASP_MODES = ['nospin', 'spin', 'soc'] as const
export type VaspMode = (typeof VASP_MODES)[number]

/**
 * 自洽任务集（headline energy 取数范围）：band/pdos/unfold 读 WAVECAR/CHGCAR
 * 非自洽（ICHARG=11），其 TOTEN 不是体系总能量；phonon 是超胞位移族不取。
 */
export const VASP_SELF_CONSISTENT_TASKS = ['relax', 'scf', 'relaxdftu', 'scfdftu', 'magmom', 'spincharge', 'born'] as const

/** relax 族（离子弛豫，OSZICAR accuracy 标记语义成立）。 */
export const VASP_RELAX_FAMILY_TASKS = ['relax', 'relaxdftu'] as const

/** 长链作业的缺省轮询封顶（秒）——比 gaussian 的 30s 放宽：24h 链的可见性 2 分钟足够。 */
export const DEFAULT_VASP_POLL_SECONDS = 120
/** producer 缺省总时限 = 缺省墙钟（到点可再 watch，作业本身继续）。 */
export const DEFAULT_VASP_MAX_WAIT_SECONDS = 86_400

/** 收割脚本的分节锚（命令与解析器的公开契约）。 */
const HARVEST_SECTIONS = ['--- matstream.json ---', '--- task_dirs ---', '--- probes ---', '--- job_log_tail ---'] as const

/**
 * 任务链校验：`;` 分隔、逐项 trim/lowercase、任务名查表；非法即抛
 * INVALID_VASP_CHAIN 前缀错误（发生在任何集群调用之前，零副作用）。
 */
export function validateVaspChain(tasks: string): string[] {
  const items = tasks.split(';').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)
  if (items.length === 0) {
    throw new Error('INVALID_VASP_CHAIN: empty task chain')
  }
  const unknown = items.filter((t) => !(VASP_TASKS as readonly string[]).includes(t))
  if (unknown.length > 0) {
    throw new Error(
      `INVALID_VASP_CHAIN: unknown task(s) [${unknown.join(', ')}] — known tasks: ${VASP_TASKS.join(', ')}`,
    )
  }
  return items
}

export type VaspStructureFormat = 'poscar' | 'cif' | 'xyz'

/**
 * 结构文件名：ASE 按文件名嗅探格式——POSCAR 前缀命中 vasp 格式，扩展名命中 cif/xyz。
 * matstream io.read 直接走 ASE，检索到的 CIF 无需本地转换。
 */
export function vaspStructureFilename(format: VaspStructureFormat): string {
  if (format === 'poscar') return 'POSCAR'
  if (format === 'cif') return 'structure.cif'
  return 'structure.xyz'
}

export interface VaspSlurmRenderInput {
  tasks: string
  preset: string
  mode: string
  partition: string
  time: string
  nodes: number
  ntasksPerNode: number
  workflowEnv: string
  vaspEnv: string
  vaspCommand: string
  structureFilename: string
}

/**
 * 本地渲染 slurm.sh（真源；skill templates/ 下是同款参考件）。
 *
 * 关键点（2026-09-24 家目录部署实证，作业 122895517/122895612）：
 *   - `source /etc/profile` 保留（module 体系依赖它；作业内有效，登录沙箱非交互
 *     shell 无 module——那是门禁的探测边界，不是执行面问题）；
 *   - vasp_env 先于 workflow_env（vasp-hy 的 env.sh 自带 mpi/* 卸载循环，处理作业
 *     环境预载 mpi/hpcx 与 intelmpi 的冲突）；
 *   - VASP 经 CALCULATOR_VASP_COMMAND 走 srun（引擎 env 覆盖点），np 跟 ntasks；
 *   - cd "$SLURM_SUBMIT_DIR" 在 matstream 前（Task.* 落提交目录）。
 */
export function renderVaspSlurmScript(input: VaspSlurmRenderInput): string {
  const jobName = `ms-${input.tasks.split(';').map((t) => t.trim()).filter(Boolean).join('-')}`.slice(0, 24)
  const chain = input.tasks.split(';').map((t) => t.trim().toLowerCase()).filter(Boolean).join(';')
  return [
    '#!/bin/bash',
    `#SBATCH -J ${jobName}`,
    `#SBATCH -N ${input.nodes}`,
    `#SBATCH --ntasks-per-node=${input.ntasksPerNode}`,
    `#SBATCH -p ${input.partition}`,
    `#SBATCH --time=${input.time}`,
    '#SBATCH --output=ms-job.out',
    'source /etc/profile',
    'ulimit -l unlimited',
    `source ${input.vaspEnv}`,
    `source ${input.workflowEnv}`,
    `export CALCULATOR_VASP_COMMAND='${input.vaspCommand}'`,
    'cd "$SLURM_SUBMIT_DIR"',
    // 引擎 stdout JSON 也进 ms-job.out（双保险：matstream.json 是权威）。
    `matstream run -c vasp -t '${chain}' -f ${input.structureFilename} -p ${input.preset} -m ${input.mode}`,
    '',
  ].join('\n')
}

export interface VaspPrepareInput {
  workdir: string
  structure: string
  structureFilename: string
  slurmScript: string
}

/**
 * prepare 单命令：mkdir + 双 heredoc（结构文件 + slurm.sh，quoted 定界符防展开）
 * + 落盘校验 + PREP_READY 标记——镜像 gaussian prepareInputsCommand 的单往返压缩。
 * 两个 heredoc 体按操作符出现顺序跟在首逻辑行之后（POSIX shell 语义）。
 */
export function prepareVaspInputsCommand(input: VaspPrepareInput): string {
  const { workdir, structure, structureFilename, slurmScript } = input
  const structureBody = structure.endsWith('\n') ? structure : `${structure}\n`
  const slurmBody = slurmScript.endsWith('\n') ? slurmScript : `${slurmScript}\n`
  const head =
    `mkdir -p "${workdir}" && cat > "${workdir}/${structureFilename}" << 'XEOF' ` +
    `&& cat > "${workdir}/slurm.sh" << 'SEOF' ` +
    `&& for f in ${structureFilename} slurm.sh; do [ -s "${workdir}/$f" ] || echo "MISSING:$f"; done && echo PREP_READY`
  return `${head}\n${structureBody}XEOF\n${slurmBody}SEOF`
}

export function submitVaspSbatchCommand(workdir: string): string {
  return `cd "${workdir}" && sbatch slurm.sh`
}

/**
 * 终态只读收割命令：matstream.json（权威结果 JSON）+ Task 目录清单 + 收敛探针
 * （OSZICAR accuracy 标记计数 / 尾行、OUTCAR TOTEN 尾行）+ 作业日志尾。
 * 分节锚（HARVEST_SECTIONS）是命令与 parseVaspHarvestOutput 的公开契约。
 */
export function harvestVaspCommand(workdir: string, jobLogLines = 30): string {
  return [
    `cd "${workdir}" || exit 1`,
    `echo '--- matstream.json ---'`,
    `head -c 65536 matstream.json 2>/dev/null || echo '(no matstream.json)'`,
    `echo '--- task_dirs ---'`,
    `ls -d Task.* 2>/dev/null || echo '(none)'`,
    `echo '--- probes ---'`,
    `for d in Task.*; do`,
    `  [ -d "$d" ] || continue`,
    `  echo "probe: $d"`,
    `  if [ -f "$d/OSZICAR" ]; then`,
    `    tail -n 2 "$d/OSZICAR"`,
    `    printf 'accuracy_marker_count: '`,
    `    grep -c 'reached required accuracy' "$d/OSZICAR" || true`,
    `  else`,
    `    echo 'no OSZICAR'`,
    `  fi`,
    `  if [ -f "$d/OUTCAR" ]; then`,
    `    grep 'TOTEN' "$d/OUTCAR" | tail -n 1`,
    `  fi`,
    `done`,
    `echo '--- job_log_tail ---'`,
    `tail -n ${jobLogLines} ms-job.out 2>/dev/null || echo '(no ms-job.out)'`,
  ].join('\n')
}

/** 单任务目录的收敛探针投影。 */
export interface VaspTaskProbe {
  taskDir: string
  /** OSZICAR `reached required accuracy` 计数（≥1 = 离子收敛；缺省 undefined = 无 OSZICAR）。 */
  accuracyMarkerCount?: number
  /** OUTCAR 末行 TOTEN 的能量值（eV，without entropy）。 */
  energy?: number
  /** OSZICAR 尾行原文（诊断用，≤2 行）。 */
  oszicarTail: string[]
}

/** 收割解析结果（matstream.json + 探针的结构化投影）。 */
export interface VaspHarvestResult {
  /** matstream.json 在场且可解析。 */
  hasResultJson: boolean
  /** 引擎报告的错误（error 键；error 壳不得当成功透传）。 */
  engineError?: string
  /** 引擎累积的 context 散文（中文，含各任务 CBM/VBM 等）。 */
  context?: string
  files: string[]
  images: string[]
  slurmPath?: string
  taskDirs: string[]
  probes: VaspTaskProbe[]
  jobLogTail: string
}

interface MatstreamResultJson {
  context?: unknown
  files?: unknown
  image?: unknown
  slurm_path?: unknown
  error?: unknown
}

/** TOTEN 行 → 能量值（`energy  without entropy=   -12.34 ...` 取首个浮点）。 */
function parseTotenEnergy(line: string): number | undefined {
  const match = line.match(/energy\s+without entropy=\s*(-?\d+(?:\.\d+)?)/)
  return match !== null ? Number(match[1]) : undefined
}

/** Task 目录名数值排序键（Task.10.* 必须排在 Task.2.* 之后）。 */
function taskDirIndex(dir: string): number {
  const match = dir.match(/^Task\.(\d+)\./)
  return match !== null ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

/** Task 目录名 → 基任务名（`Task.2.Scf` → `scf`；无索引形态 `Task.Scf` → `scf`）。 */
function baseTaskOf(dir: string): string {
  const stripped = dir.replace(/^Task\.(?:\d+\.)?/, '')
  return stripped.toLowerCase()
}

function sectionOf(stdout: string, anchor: string): string {
  const lines = stdout.split('\n')
  const start = lines.findIndex((l) => l.trim() === anchor)
  if (start === -1) return ''
  const end = HARVEST_SECTIONS.findIndex((a) => a === anchor)
  const nextAnchor = end >= 0 && end + 1 < HARVEST_SECTIONS.length ? HARVEST_SECTIONS[end + 1] : undefined
  const stop = nextAnchor !== undefined
    ? lines.findIndex((l, i) => i > start && l.trim() === nextAnchor)
    : -1
  const slice = stop === -1 ? lines.slice(start + 1) : lines.slice(start + 1, stop)
  return slice.join('\n')
}

/**
 * 解析收割输出：按分节锚切分；matstream.json 按块整体 JSON.parse（文件为 indent-4
 * 多行形态；回退 stdout 单行契约）；探针块逐任务归并。解析失败不抛——收割是
 * 诊断性读取，残缺时字段缺省、原文仍进 job_log_tail 通道。
 */
export function parseVaspHarvestOutput(stdout: string): VaspHarvestResult {
  const result: VaspHarvestResult = { hasResultJson: false, files: [], images: [], taskDirs: [], probes: [], jobLogTail: '' }

  const jsonBlock = sectionOf(stdout, '--- matstream.json ---').trim()
  if (jsonBlock !== '' && !jsonBlock.startsWith('(no matstream.json)')) {
    let parsed: MatstreamResultJson | undefined
    try {
      parsed = JSON.parse(jsonBlock) as MatstreamResultJson
    } catch {
      const line = jsonBlock.split('\n').find((l) => l.trim().startsWith('{'))
      if (line !== undefined) {
        try { parsed = JSON.parse(line.trim()) as MatstreamResultJson } catch { parsed = undefined }
      }
    }
    if (parsed !== undefined) {
      result.hasResultJson = true
      if (typeof parsed.error === 'string') result.engineError = parsed.error
      if (typeof parsed.context === 'string') result.context = parsed.context
      if (Array.isArray(parsed.files)) result.files = parsed.files.filter((f): f is string => typeof f === 'string')
      if (Array.isArray(parsed.image)) result.images = parsed.image.filter((f): f is string => typeof f === 'string')
      if (typeof parsed.slurm_path === 'string') result.slurmPath = parsed.slurm_path
    }
  }

  result.taskDirs = sectionOf(stdout, '--- task_dirs ---')
    .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('Task.'))

  const probeBlock = sectionOf(stdout, '--- probes ---')
  let current: VaspTaskProbe | undefined
  for (const line of probeBlock.split('\n')) {
    const probeMatch = line.match(/^probe:\s+(Task\.\S+)/)
    if (probeMatch !== null) {
      if (current !== undefined) result.probes.push(current)
      current = { taskDir: probeMatch[1]!, oszicarTail: [] }
      continue
    }
    if (current === undefined) continue
    const countMatch = line.match(/^accuracy_marker_count:\s*(\d+)/)
    if (countMatch !== null) {
      current.accuracyMarkerCount = Number(countMatch[1])
      continue
    }
    if (line.includes('energy') && line.includes('entropy=')) {
      const energy = parseTotenEnergy(line)
      if (energy !== undefined) current.energy = energy
      continue
    }
    if (line.trim() !== '' && current.oszicarTail.length < 2 && !line.startsWith('no OSZICAR')) {
      current.oszicarTail.push(line.trim())
    }
  }
  if (current !== undefined) result.probes.push(current)
  result.probes.sort((a, b) => taskDirIndex(a.taskDir) - taskDirIndex(b.taskDir))

  result.jobLogTail = sectionOf(stdout, '--- job_log_tail ---').trim()

  return result
}

/** 收割 → 模型可见物性（键名见 engine.ts VASP_PROPERTY_KEYS）。 */
export function vaspPropertiesOf(harvest: VaspHarvestResult): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const energyPerTask: Record<string, number> = {}
  for (const probe of harvest.probes) {
    if (probe.energy !== undefined) energyPerTask[probe.taskDir] = probe.energy
  }
  if (Object.keys(energyPerTask).length > 0) {
    properties['energy_per_task_eV'] = energyPerTask
  }
  // headline energy：末位自洽任务的能量；无自洽任务时取末位任何能量（判读归 skill）。
  const selfConsistent = harvest.probes
    .filter((p) => (VASP_SELF_CONSISTENT_TASKS as readonly string[]).includes(baseTaskOf(p.taskDir)) && p.energy !== undefined)
  const fallback = harvest.probes.filter((p) => p.energy !== undefined)
  const headline = selfConsistent.at(-1) ?? fallback.at(-1)
  if (headline?.energy !== undefined) {
    properties['energy'] = headline.energy
  }
  // converged：relax 族全部达到离子收敛才 true；任一未达即 false；无 relax 族缺省。
  const relaxProbes = harvest.probes
    .filter((p) => (VASP_RELAX_FAMILY_TASKS as readonly string[]).includes(baseTaskOf(p.taskDir)) && p.accuracyMarkerCount !== undefined)
  if (relaxProbes.length > 0) {
    properties['converged'] = relaxProbes.every((p) => (p.accuracyMarkerCount ?? 0) > 0)
  }
  return properties
}

/** VASP options 面（工具层 snake_case 映射后）。 */
export interface VaspOptions {
  workflowEnv?: string
  vaspEnv?: string
  vaspCommand?: string
  nodes?: number
  ntasksPerNode?: number
  pollSeconds?: number
  maxWaitSeconds?: number
}

export interface VaspSyncInput {
  execCommand: ExecCommandFn
  clusterId: string
  tasks: string
  structure: string
  structureFilename: string
  workdir: string
  partition?: string
  time?: string
  preset?: string
  mode?: string
  options?: VaspOptions
}

export interface VaspSyncResult {
  slurmJobId: string
}

/** 输出尾行（错误信息携带，便于诊断）。 */
function tail(text: string, lines = 5): string {
  return text.trim().split('\n').slice(-lines).join('\n')
}

/**
 * 同步段：prepare（落盘校验）→ sbatch；任一环节失败快速抛错带输出尾部。
 * @returns `{slurmJobId}` —— 调用方随即注册后台监控（producer）。
 */
export async function runVaspSync(input: VaspSyncInput): Promise<VaspSyncResult> {
  const { execCommand, clusterId, tasks, structure, structureFilename, workdir } = input
  const options = input.options ?? {}
  const slurmScript = renderVaspSlurmScript({
    tasks,
    preset: input.preset ?? 'medium',
    mode: input.mode ?? 'nospin',
    partition: input.partition ?? DEFAULT_VASP_PARTITION,
    time: input.time ?? DEFAULT_VASP_TIME,
    nodes: options.nodes ?? DEFAULT_VASP_NODES,
    ntasksPerNode: options.ntasksPerNode ?? DEFAULT_VASP_NTASKS_PER_NODE,
    workflowEnv: options.workflowEnv ?? DEFAULT_MATSTREAM_ENV,
    vaspEnv: options.vaspEnv ?? DEFAULT_VASP_ENV,
    vaspCommand: options.vaspCommand ?? DEFAULT_CALCULATOR_VASP_COMMAND,
    structureFilename,
  })

  const prep = outputText(await execCommand(clusterId, prepareVaspInputsCommand({ workdir, structure, structureFilename, slurmScript }), 60))
  const missing = prep.split('\n').filter((line) => line.startsWith('MISSING:'))
  if (missing.length > 0) throw new Error(`input files not written: ${missing.join(', ')}`)
  if (!prep.includes('PREP_READY')) throw new Error(`prepare failed: ${tail(prep)}`)

  const sbatch = outputText(await execCommand(clusterId, submitVaspSbatchCommand(workdir), 30))
  return { slurmJobId: parseSbatchSubmission(sbatch) }
}

/** producer 非 COMPLETED 结算输出里的诊断载荷行前缀（对齐 gaussian 的跨模块契约风格）。 */
export const VASP_DIAGNOSTIC_LINE_PREFIXES = ['engine_error: ', 'log_tail: '] as const

/** 从 producer 终态输出提取诊断文本（KB 签名索引匹配用；无命中回退整段）。 */
export function vaspDiagnosticTextOf(producerOutput: string): string {
  const lines = producerOutput.split('\n')
  const payload = lines.filter((l) => VASP_DIAGNOSTIC_LINE_PREFIXES.some((p) => l.startsWith(p)))
  return payload.length > 0 ? payload.join('\n') : producerOutput
}

export interface VaspProducerResult extends WatchOutcome {
  properties?: Record<string, unknown>
  files?: string[]
  plots?: PlotEntry[]
}

export interface VaspProducerInput {
  /** producer 专属远程执行（独立 MatClient，与同步段/前台隔离）。 */
  execCommand: ExecCommandFn
  clusterId: string
  tasks: string
  workdir: string
  slurmJobId: string
  pollSeconds?: number
  maxWaitSeconds?: number
  /** 每个成功 sacct 回合后触发，用于实时状态板。 */
  onTick?: (states: ReadonlyMap<string, SlurmJobInfo>) => void
  /** producer 结算后触发；收割成功时携带结构化物性与文件。 */
  onResult?: (result: VaspProducerResult) => void
  /** 失败环 agent 侧签名索引（同 gaussian producer 契约；故障一律旁路）。 */
  diagnose?: (errorText: string) => Array<{ id: string; path: string; prescription?: PrescriptionStep[] }>
}

/** detail 摘要：headline 能量 + relax 收敛（有则列，无则仅任务链）。 */
function vaspPropertiesSummary(tasks: string, properties: Record<string, unknown>): string {
  const parts: string[] = []
  const energy = properties['energy']
  if (typeof energy === 'number') parts.push(`E=${energy}`)
  const converged = properties['converged']
  if (typeof converged === 'boolean') parts.push(`relax_converged=${converged}`)
  return `; ${tasks}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`
}

/**
 * vasp 后台 producer（宿主 JobHooks 同形）：sacct 监控至终态后自动收割——
 * COMPLETED/非 COMPLETED 都收割（收割是只读文件收集，失败路径的诊断价值更高）；
 * 引擎 error 壳（作业 COMPLETED 但 matstream.json 带 error 的防御分支）不判作业
 * 失败，结构化标注。max-wait/传输异常路径不收割（对齐 watch-loop onAllSettled 语义）。
 */
export function createVaspProducerHooks(input: VaspProducerInput): WatchLoopHooks {
  const { execCommand, clusterId, tasks, workdir, slurmJobId } = input

  let resultProperties: Record<string, unknown> | undefined
  let resultFiles: string[] | undefined
  let resultPlots: PlotEntry[] | undefined
  const loop = createWatchLoop({
    clusterId,
    jobIds: [slurmJobId],
    maxWaitMs: (input.maxWaitSeconds ?? DEFAULT_VASP_MAX_WAIT_SECONDS) * 1_000,
    ...(input.pollSeconds !== undefined ? { maxPollMs: Math.max(10, input.pollSeconds) * 1_000 } : {}),
    execCommand,
    scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    ...(input.onTick !== undefined ? { onTick: input.onTick } : {}),
    onAllSettled: async (states) => {
      const state = states.get(slurmJobId)?.state ?? 'UNKNOWN'
      let harvest: VaspHarvestResult | undefined
      try {
        const r = await execCommand(clusterId, harvestVaspCommand(workdir), 60)
        harvest = parseVaspHarvestOutput(outputText(r))
      } catch {
        harvest = undefined // 收割是诊断性读取，失败不判作业失败
      }
      const properties = harvest !== undefined ? vaspPropertiesOf(harvest) : {}
      const diagnostic: string[] = []
      if (harvest?.engineError !== undefined) diagnostic.push(`engine_error: ${harvest.engineError}`)
      if (harvest !== undefined && harvest.jobLogTail !== '') diagnostic.push(`log_tail: ${harvest.jobLogTail.split('\n').slice(-20).join('\n')}`)

      let kbHints: string[] = []
      if (state !== 'COMPLETED' && input.diagnose !== undefined && diagnostic.length > 0) {
        try {
          const diagText = diagnostic.join('\n')
          const mentioned = new Set([...diagText.matchAll(/kb:([a-z0-9-]+)/g)].map((m) => m[1]!))
          kbHints = input.diagnose(diagText)
            .filter((h) => !mentioned.has(h.id))
            .slice(0, 3)
            .map((h) => h.prescription !== undefined && h.prescription.length > 0
              ? `kb_hint: kb:${h.id} — ${h.path} (${formatPrescription(h.prescription)}; one submit per rung; exhausted => dead-letter 'ladder-exhausted: kb:${h.id}')`
              : `kb_hint: kb:${h.id} — ${h.path} (agent-side signature index; read entry for prescription ladder)`)
        } catch {
          kbHints = []
        }
      }

      if (state === 'COMPLETED' && harvest?.engineError === undefined) {
        resultProperties = properties
        resultFiles = harvest?.files ?? []
        resultPlots = (harvest?.images ?? []).map((image) => ({ kind: 'image', image, data: '' }))
        const energyLines = Object.entries((properties['energy_per_task_eV'] as Record<string, number>) ?? {})
          .map(([dir, e]) => `${dir}: ${e}`)
        return {
          detailSuffix: vaspPropertiesSummary(tasks, properties),
          extraLines: [
            'slurm_state: COMPLETED',
            ...(harvest !== undefined && harvest.context !== undefined
              ? [`context_tail: ${harvest.context.slice(-800)}`]
              : []),
            ...(energyLines.length > 0 ? ['energy_per_task_eV: ' + JSON.stringify(properties['energy_per_task_eV'])] : []),
            ...(typeof properties['converged'] === 'boolean' ? [`converged: ${properties['converged']}`] : []),
            ...(harvest !== undefined && harvest.taskDirs.length > 0 ? [`task_dirs: ${harvest.taskDirs.join(', ')}`] : []),
            ...(resultFiles.length > 0 ? [`files: ${resultFiles.join(', ')}`] : []),
            ...(resultPlots.length > 0 ? [`plots: ${JSON.stringify(resultPlots)}`] : []),
          ],
        }
      }
      if (state === 'COMPLETED') {
        return {
          detailSuffix: `; ${tasks} COMPLETED but engine reported error`,
          extraLines: ['slurm_state: COMPLETED', ...diagnostic],
        }
      }
      return {
        detailSuffix: `; ${tasks} ${state}, harvest attached`,
        extraLines: ['slurm_state: ' + state, ...diagnostic, ...kbHints],
      }
    },
  })
  if (input.onResult !== undefined) {
    void loop.done.then((outcome) => {
      input.onResult?.({
        ...outcome,
        properties: resultProperties,
        files: resultFiles,
        plots: resultPlots,
      })
    })
  }
  return loop
}

// ---------------------------------------------------------------------------
// 确认闸投影（镜像 confirmation.ts 的纪律：给用户签字的数字必须投影，不得模型转述）
// ---------------------------------------------------------------------------

export interface VaspConfirmationSummary {
  tasks: string
  preset: string
  mode: string
  partition: string
  nodes: number | null
  ntasksPerNode: number | null
  walltime: string
  estimatedCoreHours: number | null
  /** 部署版本锚（matstream VERSION；与 env_profile.sh 同步）。 */
  workflowVersion: string
}

/** `HH:MM:SS` 或 `D-HH:MM:SS` → 小时；非法返回 null。 */
export function parseVaspWalltimeHours(time: string): number | null {
  const dayMatch = time.match(/^(\d+)-(\d+):(\d{2})(?::(\d{2}))?$/)
  if (dayMatch !== null) {
    const [, d, h, m, s] = dayMatch
    return Number(d) * 24 + Number(h) + Number(m) / 60 + Number(s ?? 0) / 3600
  }
  const plainMatch = time.match(/^(\d+):(\d{2})(?::(\d{2}))?$/)
  if (plainMatch !== null) {
    const [, h, m, s] = plainMatch
    return Number(h) + Number(m) / 60 + Number(s ?? 0) / 3600
  }
  return null
}

export function estimateVaspCoreHours(nodes: number | null, ntasksPerNode: number | null, time: string): number | null {
  const hours = parseVaspWalltimeHours(time)
  if (nodes === null || ntasksPerNode === null || hours === null) return null
  return Math.round(nodes * ntasksPerNode * hours * 100) / 100
}

export function summarizeVaspPre(input: {
  tasks: string
  preset: string
  mode: string
  partition: string
  nodes?: number
  ntasksPerNode?: number
  time?: string
  workflowVersion?: string
}): VaspConfirmationSummary {
  const nodes = input.nodes ?? DEFAULT_VASP_NODES
  const ntasksPerNode = input.ntasksPerNode ?? DEFAULT_VASP_NTASKS_PER_NODE
  const walltime = input.time ?? DEFAULT_VASP_TIME
  return {
    tasks: input.tasks,
    preset: input.preset,
    mode: input.mode,
    partition: input.partition,
    nodes,
    ntasksPerNode,
    walltime,
    estimatedCoreHours: estimateVaspCoreHours(nodes, ntasksPerNode, walltime),
    workflowVersion: input.workflowVersion ?? MATSTREAM_WORKFLOW_VERSION,
  }
}

/** 固定键序规范 JSON → sha256 hex（同配置必然同摘要）。 */
export function vaspConfirmationDigest(summary: VaspConfirmationSummary): string {
  const canonical = JSON.stringify({
    tasks: summary.tasks,
    preset: summary.preset,
    mode: summary.mode,
    partition: summary.partition,
    nodes: summary.nodes,
    ntasks_per_node: summary.ntasksPerNode,
    walltime: summary.walltime,
    estimated_core_hours: summary.estimatedCoreHours,
    workflow_version: summary.workflowVersion,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/** 投影 → 给用户看的确认块（拒绝消息内嵌）。 */
export function formatVaspConfirmationSummary(summary: VaspConfirmationSummary, digest: string): string {
  const lines = [
    `tasks/preset/mode        : ${summary.tasks} / ${summary.preset} / ${summary.mode}`,
    `slurm                    : partition=${summary.partition}, ${summary.nodes ?? '-'} node(s) × ${summary.ntasksPerNode ?? '-'} tasks, walltime=${summary.walltime}`,
    `estimated core-hours     : ${summary.estimatedCoreHours ?? '-'}`,
    `engine anchor            : matstream ${summary.workflowVersion} ($HOME/workspace/matstream) + vasp-hy`,
    `digest                   : ${digest}`,
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 兼容 facade（对齐 gaussian.ts 的 legacy adapter 形态）
// ---------------------------------------------------------------------------

/** 透传项（缺省值对齐本模块常量）。 */
export function createLegacyVaspWorkflowAdapter(options: {
  execute: (request: RemoteWorkflowRequest) => Promise<RemoteWorkflowResult>
}): RemoteWorkflowAdapter {
  return createVaspMatAdapter(options.execute)
}
