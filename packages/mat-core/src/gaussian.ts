/**
 * Gaussian 工作流编排（移植自 plugin.py gaussian_calc §659-758）。
 *
 * 同步段 runGaussianSync：prepare（单次调用打包 mkdir/heredoc/三 json/落盘校验，
 * Python 版 6 次往返合并为 1 次）→ pre → run（GAUSSIAN_ENV_SCRIPT）→ sbatch，
 * 返回 slurmJobId。post 段与终态物性解析由 producer 增补（见 watch-loop 钩子）。
 */

import { outputText } from './client'
import type { ExecCommandFn } from './slurm'
import { parseSbatchSubmission } from './slurm'

export const DEFAULT_WORKFLOW_ENV = '$HOME/workspace/demo/env.sh'
export const DEFAULT_G16_ENV = '$HOME/workspace/g16-hy/scripts/env.sh'

/** 透传项（缺省值对齐 plugin.py gaussian_calc）。 */
export interface GaussianOptions {
  preJson?: Record<string, unknown>
  runJson?: Record<string, unknown>
  workflowEnv?: string
  g16Env?: string
  pollSeconds?: number
  maxWaitSeconds?: number
}

export function defaultPreJson(): Record<string, unknown> {
  return {
    schema_version: 'gaussian_workflow.pre.v1',
    resources: { ncores: 32, memory: '64GB' },
    generator: { dialect: 'ase' },
    ase: {
      calculator_kwargs: {
        method: 'B3LYP', basis: '6-31G(d)', charge: 0, mult: 1,
        opt: ['Tight', 'CalcFC'], freq: 'HPModes',
      },
    },
    output: { input_file: 'job.gjf' },
  }
}

export function defaultRunJson(partition?: string): Record<string, unknown> {
  return {
    slurm: {
      partition: partition ?? 'Agent0',
      nodes: 1, ntasks_per_node: 32, time: '00:30:00', mem: '64GB',
    },
  }
}

/**
 * prepare 单命令：整链 &&（mkdir 失败即断），heredoc 体置于命令行之后。
 * heredoc 定界符前的 && 属于首逻辑行；体尾换行兜底防 XEOF 粘连。
 */
export function prepareInputsCommand(
  workdir: string,
  structure: string,
  preJson: Record<string, unknown>,
  runJson: Record<string, unknown>,
): string {
  const body = structure.endsWith('\n') ? structure : `${structure}\n`
  const head = `mkdir -p "${workdir}" && cat > "${workdir}/molecule.xyz" << 'XEOF'`
  const tail = [
    `echo '${JSON.stringify(preJson)}' > "${workdir}/pre.json"`,
    `echo '${JSON.stringify(runJson)}' > "${workdir}/run.json"`,
    `echo '{}' > "${workdir}/post.json"`,
    `for f in pre.json run.json post.json molecule.xyz; do [ -s "${workdir}/$f" ] || echo "MISSING:$f"; done`,
    'echo PREP_READY',
  ].join(' && ')
  return `${head} && ${tail}\n${body}XEOF`
}

export function prePhaseCommand(workdir: string, task: string, workflowEnv: string): string {
  return `cd "${workdir}" && source ${workflowEnv} && ` +
    `gaussian-workflow -t ${task} -p pre -i molecule.xyz -w "${workdir}" --json pre.json`
}

export function runPhaseCommand(workdir: string, task: string, workflowEnv: string, g16Env: string): string {
  return `cd "${workdir}" && export GAUSSIAN_ENV_SCRIPT=${g16Env} && source ${workflowEnv} && ` +
    `gaussian-workflow -t ${task} -p run -i molecule.xyz -w "${workdir}" --json run.json`
}

export function submitSbatchCommand(workdir: string, task: string): string {
  return `cd "${workdir}/${task}" && sbatch slurm.sh`
}

export interface GaussianSyncInput {
  execCommand: ExecCommandFn
  clusterId: string
  task: string
  structure: string
  workdir: string
  partition?: string
  options?: GaussianOptions
}

export interface GaussianSyncResult {
  slurmJobId: string
}

/** 输出尾行（错误信息携带，便于诊断）。 */
function tail(text: string, lines = 5): string {
  return text.trim().split('\n').slice(-lines).join('\n')
}

/**
 * 同步段：prepare（落盘校验）→ pre → run → sbatch；任一环节失败快速抛错带输出尾部。
 * @returns `{slurmJobId}` —— 调用方随即注册后台监控（producer）。
 */
export async function runGaussianSync(input: GaussianSyncInput): Promise<GaussianSyncResult> {
  const { execCommand, clusterId, task, structure, workdir } = input
  const options = input.options ?? {}
  const workflowEnv = options.workflowEnv ?? DEFAULT_WORKFLOW_ENV
  const g16Env = options.g16Env ?? DEFAULT_G16_ENV
  const preJson = options.preJson ?? defaultPreJson()
  const runJson = options.runJson ?? defaultRunJson(input.partition)

  const prep = outputText(await execCommand(clusterId, prepareInputsCommand(workdir, structure, preJson, runJson), 60))
  const missing = prep.split('\n').filter((line) => line.startsWith('MISSING:'))
  if (missing.length > 0) throw new Error(`input files not written: ${missing.join(', ')}`)
  if (!prep.includes('PREP_READY')) throw new Error(`prepare failed: ${tail(prep)}`)

  const pre = outputText(await execCommand(clusterId, prePhaseCommand(workdir, task, workflowEnv), 60))
  if (!pre.includes('"status": "ok"')) throw new Error(`gaussian pre phase failed: ${tail(pre)}`)

  const run = outputText(await execCommand(clusterId, runPhaseCommand(workdir, task, workflowEnv, g16Env), 60))
  if (!run.includes('"status": "ok"')) throw new Error(`gaussian run phase failed: ${tail(run)}`)

  const sbatch = outputText(await execCommand(clusterId, submitSbatchCommand(workdir, task), 30))
  return { slurmJobId: parseSbatchSubmission(sbatch) }
}
