/**
 * Gaussian 工作流编排（移植自 plugin.py gaussian_calc §659-758）。
 *
 * 同步段 runGaussianSync：prepare（单次调用打包 mkdir/heredoc/三 json/落盘校验，
 * Python 版 6 次往返合并为 1 次）→ pre → run（GAUSSIAN_ENV_SCRIPT）→ sbatch，
 * 返回 slurmJobId。post 段与终态物性解析由 producer 增补（见 watch-loop 钩子）。
 */

import { outputText } from './client.ts'
import type { ExecCommandFn } from './slurm.ts'
import { parseSbatchSubmission } from './slurm.ts'
import { createWatchLoop } from './watch-loop.ts'
import type { SlurmJobInfo } from './job-state.ts'
import type { WatchLoopHooks, WatchOutcome } from './watch-loop.ts'
import { createGaussianMatAdapter } from './workflow-contract.ts'
import type { RemoteWorkflowAdapter, RemoteWorkflowRequest, RemoteWorkflowResult } from './workflow-contract.ts'
import type { PlotEntry } from './status-board.ts'

export const DEFAULT_WORKFLOW_ENV = '$HOME/workspace/demo/env.sh'
export const DEFAULT_G16_ENV = '$HOME/workspace/g16-hy/scripts/env.sh'

/** mat_gaussian producer 的默认轮询封顶（秒）：终态在 job_output 的可见
 *  延迟收紧到 ≤30s（压测 P6：sacct 已 COMPLETED 而 job_output 仍是上一跳
 *  快照的竞态；服务端轮询无模型请求，30s 的 sacct 负担可忽略）。 */
export const DEFAULT_PRODUCER_POLL_SECONDS = 30

/** 透传项（缺省值对齐 plugin.py gaussian_calc）。 */
export function createLegacyGaussianWorkflowAdapter(options: {
  execute: (request: RemoteWorkflowRequest) => Promise<RemoteWorkflowResult>
}): RemoteWorkflowAdapter {
  return createGaussianMatAdapter(options.execute)
}

export interface GaussianOptions {
  preJson?: Record<string, unknown>
  runJson?: Record<string, unknown>
  workflowEnv?: string
  g16Env?: string
  pollSeconds?: number
  maxWaitSeconds?: number
}

// 不含 task 路由键（opt/freq/td/...）：路由身份由 -t task 决定（压测 2026-09-01 P4：默认模板的 opt/freq 把 -t tddft 污染成三合一）。
// 显式 pre_json 里的路由键，三段事实：
//   1) workflow 1.3.1+（mat-aitool 943a5b1）：calculator.py 剥离「异 task」路由键（_COMPUTATION_ROUTE_KEYS 减去 task 自身
//      route，大小写不敏感），只有 task 自身的路由键保持 JSON 权威（选项级精调；大小写变体胜出且不重复注入）；
//   2) <1.3.1 的已部署集群没有这层剥离，异 task 键照常参与 route 合成并掩蔽 task 路由（irc 被 opt 掩蔽即此 case）；
//   3) TS 侧不感知远端部署版本，故显式 pre_json 一律不要携带路由键——路由身份必须由 -t task 决定。
export function defaultPreJson(): Record<string, unknown> {
  return {
    schema_version: 'gaussian_workflow.pre.v1',
    resources: { ncores: 32, memory: '64GB' },
    generator: { dialect: 'ase' },
    ase: {
      calculator_kwargs: {
        method: 'B3LYP', basis: '6-31G(d)', charge: 0, mult: 1,
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

export function postPhaseCommand(workdir: string, task: string, workflowEnv: string): string {
  return `cd "${workdir}" && source ${workflowEnv} && ` +
    `gaussian-workflow -t ${task} -p post -i molecule.xyz -w "${workdir}" --json post.json`
}

/** 失败诊断：任务目录 job.log 尾行（无日志时兜底占位）。 */
export function logTailCommand(workdir: string, task: string, lines = 50): string {
  return `tail -n ${lines} "${workdir}/${task}/job.log" 2>/dev/null || echo '(no job.log found)'`
}

export interface GaussianPostParseResult {
  properties: Record<string, unknown>
  files: string[]
  plots: PlotEntry[]
}

/**
 * 解析 post 输出：取首个以 `{` 开头且可 JSON.parse 的行的 properties/files/plots
 * （对齐 plugin.py §751-758，非法 JSON 行继续找）；无 JSON 行抛错带输出尾部。
 * 首个可解析行 `status` 为非 "ok"（error 结果行）时抛错带其 error 消息——error
 * 壳不得被当成功透传（demo 压测 D4）；status 缺省维持旧 result 行兼容。
 * plots 缺省为空数组——兼容未带绘图通道的旧版 gaussian-workflow 部署。
 */
export function parsePostOutput(stdout: string): GaussianPostParseResult {
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const data = JSON.parse(line) as { status?: string; error?: unknown; properties?: Record<string, unknown>; files?: string[]; plots?: PlotEntry[] }
      if (data.status !== undefined && data.status !== 'ok') {
        throw new Error(`post phase failed (${String(data.status)}): ${tail(String(data.error ?? line))}`)
      }
      return { properties: data.properties ?? {}, files: data.files ?? [], plots: data.plots ?? [] }
    } catch (error) {
      if (error instanceof SyntaxError) {
        // 首个可解析行语义：非法 JSON 行继续找
        continue
      }
      throw error
    }
  }
  throw new Error(`post output has no JSON result line: ${tail(stdout)}`)
}

/** detail 摘要：能量/收敛/虚频计数（有则列，无则仅任务名）。 */
function propertiesSummary(task: string, properties: Record<string, unknown>): string {
  const parts: string[] = []
  const energy = properties['energy']
  if (typeof energy === 'number') parts.push(`E=${energy}`)
  const converged = properties['converged']
  if (typeof converged === 'boolean') parts.push(`converged=${converged}`)
  const imag = properties['imaginary_frequency_count']
  if (typeof imag === 'number') parts.push(`imag=${imag}`)
  return `; ${task}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`
}

export interface GaussianProducerResult extends WatchOutcome {
  properties?: Record<string, unknown>
  files?: string[]
  plots?: PlotEntry[]
}

export interface GaussianProducerInput {
  /** producer 专属远程执行（独立 MatClient，与同步段/前台隔离）。 */
  execCommand: ExecCommandFn
  clusterId: string
  task: string
  workdir: string
  slurmJobId: string
  workflowEnv?: string
  pollSeconds?: number
  maxWaitSeconds?: number
  /** 每个成功 sacct 回合后触发，用于实时状态板。 */
  onTick?: (states: ReadonlyMap<string, SlurmJobInfo>) => void
  /** producer 结算后触发；post 成功时携带结构化物性与文件。 */
  onResult?: (result: GaussianProducerResult) => void
}

/**
 * gaussian 后台 producer（宿主 JobHooks 同形）：sacct 监控至终态后自动执行
 * post 段并解析物性——COMPLETED → properties/files 进终态首读；
 * 非 COMPLETED → 跳过 post，log_tail 诊断；post 失败不判作业失败，标注即可。
 * max-wait/传输异常路径不触发 post（对齐 watch-loop onAllSettled 语义）。
 */
export function createGaussianProducerHooks(input: GaussianProducerInput): WatchLoopHooks {
  const { execCommand, clusterId, task, workdir, slurmJobId } = input
  const workflowEnv = input.workflowEnv ?? DEFAULT_WORKFLOW_ENV

  async function fetchLogTail(): Promise<string> {
    try {
      const r = await execCommand(clusterId, logTailCommand(workdir, task), 30)
      return outputText(r).trim()
    } catch {
      return '' // 诊断性请求失败不影响主结算
    }
  }

  let resultProperties: Record<string, unknown> | undefined
  let resultFiles: string[] | undefined
  let resultPlots: PlotEntry[] | undefined
  const loop = createWatchLoop({
    clusterId,
    jobIds: [slurmJobId],
    maxWaitMs: (input.maxWaitSeconds ?? 1_800) * 1_000,
    ...(input.pollSeconds !== undefined ? { maxPollMs: Math.max(10, input.pollSeconds) * 1_000 } : {}),
    execCommand,
    scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    ...(input.onTick !== undefined ? { onTick: input.onTick } : {}),
    onAllSettled: async (states) => {
      const state = states.get(slurmJobId)?.state ?? 'UNKNOWN'
      if (state !== 'COMPLETED') {
        // Diagnostic post (stress r10 D22): a FAILED job's structured
        // diagnostics live in the workflow's post phase — e.g. tsxtb's
        // convergence trace CSV and the kb:<id> knowledge reference. The old
        // skip-post gate (D4) predates structured diagnostics and left the
        // agent to awk the raw log. Run post once, best-effort: the job's
        // terminal state stays authoritative, and the post error message is
        // surfaced verbatim as the diagnostic payload.
        let diagnostic: string[] = []
        try {
          const r = await execCommand(clusterId, postPhaseCommand(workdir, task, workflowEnv), 60)
          const line = outputText(r).split('\n').find((l) => l.startsWith('{'))
          if (line !== undefined) {
            const data = JSON.parse(line) as { status?: string; error?: unknown }
            if (data.status === 'error') {
              diagnostic = [`diagnostic_post: ${String(data.error ?? '(no message)')}`]
            }
          }
        } catch {
          // best-effort only — a broken diagnostic post never fails the job
        }
        const logTail = await fetchLogTail()
        return {
          detailSuffix: `; ${task} ${state}, diagnostic post attached`,
          extraLines: ['slurm_state: ' + state, ...diagnostic, ...(logTail !== '' ? [`log_tail: ${logTail}`] : [])],
        }
      }
      try {
        const r = await execCommand(clusterId, postPhaseCommand(workdir, task, workflowEnv), 60)
        const { properties, files, plots } = parsePostOutput(outputText(r))
        resultProperties = properties
        resultFiles = files
        resultPlots = plots
        return {
          detailSuffix: propertiesSummary(task, properties),
          extraLines: [
            'slurm_state: COMPLETED',
            `properties: ${JSON.stringify(properties)}`,
            ...(files.length > 0 ? [`files: ${files.join(', ')}`] : []),
            ...(plots.length > 0 ? [`plots: ${JSON.stringify(plots)}`] : []),
          ],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const logTail = await fetchLogTail()
        return {
          detailSuffix: `; ${task} COMPLETED but post failed`,
          extraLines: [
            'slurm_state: COMPLETED',
            `post failed: ${message}`,
            ...(logTail !== '' ? [`log_tail: ${logTail}`] : []),
          ],
        }
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
