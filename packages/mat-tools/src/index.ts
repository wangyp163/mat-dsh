import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// 引入 dsh-system-prompt 的 Context 声明合并（仅类型）。
import type {} from '@deepseek-ai/dsh-system-prompt'
// 引入 dsh-jobs 的 Context 合并（ctx.get('jobs')）并注册 watch 的 JobKind。
import type {} from '@deepseek-ai/dsh-jobs'
import { MatClient, createWatchLoop, isTerminal, outputText } from 'mat-core'
import { deriveRemoteHome, isShellStyleWorkdir } from 'mat-core'
import {
  DEFAULT_PRODUCER_POLL_SECONDS,
  SINFO_COMMAND,
  createGaussianProducerHooks,
  parseSbatchSubmission,
  parseSinfoOutput,
  queryJobStatus,
  runGaussianSync,
  createLegacyGaussianWorkflowAdapter,
  createRemoteWorkflowRequest,
  defaultPreJson,
  defaultRunJson,
  sbatchCommand,
  scancelCommand,
} from 'mat-core'
import type { GaussianOptions } from 'mat-core'
import { EfileClient, ShellFileTransferClient, TokenClient } from 'mat-core'
import { createStatusBoard } from 'mat-core'
import type { GaussianProducerResult, RemoteWorkflowAdapter, MatJobStatus, SlurmJobInfo, StatusBoard } from 'mat-core'
import { MatFileServiceImpl } from './file-service.ts'
import { openBudgetGate } from './budget-hook.ts'
import { parseManifestRef, recordWorkdir, snapshotProperties } from './manifest-hook.ts'
import type { SettledFileJob } from './file-service.ts'
import { resolveEfileCredentials } from './efile-env.ts'
import { createWorkdirResolver } from './workdir-resolver.ts'
import type { WorkdirResolver } from './workdir-resolver.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'mat-watch': 'mat-watch'
    'mat-slurm': 'mat-slurm'
  }
}

export const name = 'mat-tools'
export const inject = ['tools', 'systemPrompt']

export interface MatFileService {
  listFiles(clusterId: string, path: string, options?: import('mat-core').ListFilesOptions): Promise<import('mat-core').RemoteFilePage>
  syncFile?(jobId: string, clusterId: string, workdir: string, remotePath: string, conflictPolicy: 'keep-both' | 'overwrite'): Promise<unknown>
  listSyncs?(): unknown[]
  getPreferences?(jobId: string): Promise<{ autoSync: boolean }>
  setPreferences?(jobId: string, value: { autoSync: boolean }): Promise<void>
}

/** sacct Map → 状态板 JSON-safe 投影。 */
function statusSlurm(states: ReadonlyMap<string, SlurmJobInfo>) {
  return [...states.values()].map((info) => ({
    id: info.jobId,
    state: info.state,
    ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
    ...(info.elapsedSeconds !== undefined ? { elapsedSeconds: info.elapsedSeconds } : {}),
  }))
}

/** producer done 的公共结算桥；状态板异常不连坐宿主后台作业。 */
function settleBoard(board: StatusBoard, jobId: string, result: GaussianProducerResult, fileService?: MatFileServiceImpl): void {
  try {
    board.settle(jobId, {
      outcomeStatus: result.status,
      ...(typeof result.properties?.['converged'] === 'boolean' ? { converged: result.properties['converged'] } : {}),
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      ...(result.properties !== undefined ? { properties: result.properties } : {}),
      ...(result.files !== undefined ? { files: result.files } : {}),
      ...(result.plots !== undefined ? { plots: result.plots } : {}),
    })
    const snapshot = board.list().find((entry) => entry.jobId === jobId)
    if (fileService !== undefined && snapshot?.workdir !== undefined) {
      const job: SettledFileJob = {
        jobId, clusterId: snapshot.clusterId, workdir: snapshot.workdir,
        outcomeStatus: result.status, files: result.files,
      }
      void fileService.handleSettledJob(job).catch(() => {})
    }
  } catch {
    // UI 状态通道是旁路，不能影响 JobHooks 的完成语义。
  }
}

let client: MatClient | undefined

function getClient(): MatClient {
  if (!client) {
    const mcpKey = process.env.MAT_MCP_KEY ?? ''
    client = new MatClient({ mcpKey, baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
  }
  return client
}

/** 每次 watch 一个专属实例：与 mat_exec 的模块级单例隔离（并发策略见 mat-core client.ts）。 */
function newWatchClient(): MatClient {
  return new MatClient({
    mcpKey: process.env.MAT_MCP_KEY ?? '',
    baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
  })
}

/** efile 客户端按集群缓存（token + efile 地址一次取定；失败不缓存，下次重建重试）。 */
const efileClients = new Map<string, Promise<EfileClient>>()

function getEfileClient(clusterId: string): Promise<EfileClient> {
  const cached = efileClients.get(clusterId)
  if (cached !== undefined) return cached
  const pending = (async () => {
    // 凭证门在前：缺谁点名谁（MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER）
    const tokenClient = new TokenClient(resolveEfileCredentials(process.env))
    const info = await tokenClient.getClusterInfo(clusterId)
    return new EfileClient({ token: info.token, efileUrl: info.efileUrl })
  })().catch((err: unknown) => {
    efileClients.delete(clusterId)
    throw err
  })
  efileClients.set(clusterId, pending)
  return pending
}

function canFallBackToRemoteShell(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith('efile file transfer requires ')
    || /cluster .* (?:returned an empty token|has no efile endpoint)/.test(message)
}

function getShellFileClient(): ShellFileTransferClient {
  return new ShellFileTransferClient({ execClient: getClient() })
}

let workdirResolver: WorkdirResolver | undefined

/**
 * workdir 解析器（懒建）：producer 路径推导（零往返）→ 内存 → 磁盘缓存
 * （`<MAT_FILE_ROOT>/remote-homes.json`，跨重启）→ 远端 exec（成功逐级回填）。
 */
function getWorkdirResolver(): WorkdirResolver {
  if (workdirResolver === undefined) {
    workdirResolver = createWorkdirResolver({
      cachePath: join(localWorkspaceRoot(), 'remote-homes.json'),
      execHome: async (clusterId) => outputText(await getClient().execCommand(clusterId, 'printf %s "$HOME"', 30)).trim(),
    })
  }
  return workdirResolver
}

function createMatFileService(): MatFileServiceImpl {
  const localRoot = process.env.MAT_FILE_ROOT || `${process.env.DSH_HOME || process.cwd()}/mat-files`
  const service = new MatFileServiceImpl({
    localRoot,
    resolveWorkdir: (clusterId, workdir, hints) => getWorkdirResolver().resolve(clusterId, workdir, hints),
    transferFor: (clusterId) => {
      const shell = getShellFileClient()
      return {
        async downloadFile(remotePath: string, localPath: string) {
          try { return await (await getEfileClient(clusterId)).downloadFile(remotePath, localPath) } catch (error) {
            if (!canFallBackToRemoteShell(error)) throw error
            return shell.downloadFile(clusterId, remotePath, localPath)
          }
        },
        /** 预取预算判定用；efile 无独立 stat，走 shell（失败由预取旁路静默吞掉）。 */
        async statFile(remotePath: string) { return shell.statFile(clusterId, remotePath) },
      }
    },
  })
  service.listFiles = async (clusterId, path, options) => {
    const resolvedPath = isShellStyleWorkdir(path)
      ? path.replace(/^\$HOME(?=\/|$)/, await getWorkdirResolver().home(clusterId))
      : path
    try {
      return await (await getEfileClient(clusterId)).listFiles(resolvedPath, options)
    } catch (error) {
      if (!canFallBackToRemoteShell(error)) throw error
      return getShellFileClient().listFiles(clusterId, resolvedPath, options)
    }
  }
  return service
}

/** mat_gaussian 的 options 透传（工具面 snake_case → 库面 camelCase）。 */
function gaussianOptions(raw: unknown): GaussianOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  return {
    ...isPlainObject(o.pre_json) ? { preJson: o.pre_json } : {},
    ...isPlainObject(o.run_json) ? { runJson: o.run_json } : {},
    ...typeof o.workflow_env === 'string' ? { workflowEnv: o.workflow_env } : {},
    ...typeof o.g16_env === 'string' ? { g16Env: o.g16_env } : {},
    ...typeof o.poll_seconds === 'number' ? { pollSeconds: o.poll_seconds } : {},
    ...typeof o.max_wait_seconds === 'number' ? { maxWaitSeconds: o.max_wait_seconds } : {},
  }
}

function localWorkspaceRoot(): string {
  return process.env.MAT_FILE_ROOT || `${process.env.DSH_HOME || process.cwd()}/mat-files`
}

function reserveLocalWorkspace(clusterId: string, jobId: string): string {
  const path = join(localWorkspaceRoot(), clusterId, jobId)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}

function statusStorePath(): string {
  return join(localWorkspaceRoot(), 'jobs.json')
}

function loadPersistedJobs(path: string): MatJobStatus[] {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { jobs?: unknown }
    if (!Array.isArray(value.jobs)) return []
    let migrated = false
    const jobs = (value.jobs as MatJobStatus[]).map((job) => {
      if (job.localWorkspace !== undefined) return job
      migrated = true
      return { ...job, localWorkspace: reserveLocalWorkspace(job.clusterId, job.jobId) }
    })
    if (migrated) persistJobs(path, jobs)
    return jobs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    return []
  }
}

function persistJobs(path: string, jobs: MatJobStatus[]): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.part`
  writeFileSync(temporary, JSON.stringify({ jobs }), { mode: 0o600 })
  renameSync(temporary, path)
}

export function apply(ctx: Context): void {
  const jobsPath = statusStorePath()
  const statusBoard = createStatusBoard({
    initialEntries: loadPersistedJobs(jobsPath),
    onChange: (jobs) => persistJobs(jobsPath, jobs),
    // settled 保留上限：核心默认 20 会把最旧的作业（连同其目录键）静默裁掉，
    // 而 onChange 写的是裁剪后快照——持久层跟着丢，磁盘目录成不可达孤儿。
    // 按 ~18 作业/日的压测速率取 500（≈27 天窗口）；monitoring 永不裁剪。
    maxSettled: 500,
  })
  ctx.provide('mat.status', statusBoard)
  const fileService = createMatFileService()
  ctx.provide('mat.files', fileService)

  // 工具引导段（宿主约定：tool guidance 槽位 100–199）——让模型第一时间知道
  // HPC 计算套件的存在、适用场景与 Slurm 工作流，而不是只靠工具 schema 自行发现。
  ctx.systemPrompt.section({
    name: 'tool:mat-exec',
    order: 100,
    text:
      'HPC HPC clusters are directly reachable through the mat_exec tool. ' +
      'For any request about HPC clusters, Slurm jobs, or remote scientific computing, ' +
      'call mat_exec instead of answering from memory or claiming you cannot access remote machines. ' +
      'Pass the cluster id from the conversation (example: "11250", HPC East-1 Kunshan) ' +
      'and one shell command; it runs on the cluster login node and returns stdout, ' +
      'or stdout/stderr/exitCode when the command fails. ' +
      'Long-running compute (Gaussian, VASP, and similar) must run through Slurm: ' +
      'inspect partitions with mat_partitions, write input files via mat_exec, ' +
      'submit with mat_sbatch, spot-check states with mat_job_status, ' +
      'and cancel jobs with mat_cancel — never run the compute synchronously. ' +
      'After submitting Slurm jobs, register ALL job ids in one mat_job_watch call for ' +
      'asynchronous batch monitoring instead of polling squeue/sacct yourself; ' +
      'you will receive an in-session completion notice, then read the per-job final table with job_output. ' +
      'For Gaussian 16 calculations, load the gaussian-calc skill first (skill tool) and follow ' +
      'its environment gate and workflow instead of searching the cluster for software yourself. ' +
      'When all calculation options are already known, prefer the one-shot mat_gaussian tool: ' +
      'it prepares inputs, runs pre/run, submits, and a background producer runs the post phase ' +
      'automatically at terminal state — properties arrive via job_output after the completion notice. ' +
      'Move files between this machine and a cluster with mat_upload/mat_download. ' +
      'They prefer the efile API with MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER and fall back ' +
      'to the authorized remote-shell channel when that cluster has no OpenAPI file token.',
  })

  // 压测编排引导段（SOP 固化第 1 层：常驻触发）——触发词、计划确认闸与收口红线
  // 随系统提示常驻，用户说"压测"时模型无需先读 SOP 即可拿到三条内核。
  ctx.systemPrompt.section({
    name: 'tool:mat-stress',
    order: 101,
    text:
      'When the user asks to stress-test, regression-test, or validate the demo Gaussian workflow end to end ' +
      '(压测、回归、端到端验证、链路验证、plots 验证、稳定性测试), load the gaussian-demo-stress skill (skill tool) ' +
      'first and follow it: decompose the goal into a case matrix (original-style prompts, new/appended sessions, ' +
      'one-shot or stepwise chain, unique workdir, expected route and plots with quantifiable assertions), ' +
      'and wait for explicit user confirmation of the plan (先出计划、经用户确认后再投放) before creating sessions or submitting real jobs. ' +
      'Before finalizing the stress report, close the round: run the local session-debug L0 light scan ' +
      '(scripts/session-debug.ts anomalies <session.jsonl.zstd> --json, zero tokens) over EVERY session of the round ' +
      'and record the summary table (session-debug 摘要表) in the report — a stress report without the session-debug summary table is not closed. ' +
      'Run ordinary single Gaussian calculations through the gaussian-calc skill instead; do not load the stress skill for them.',
  })

  ctx.tools.register(defineTool({
    name: 'mat_exec',
    description:
      'Execute a shell command on a remote HPC HPC cluster via remote-shell. ' +
      'Returns stdout, or stdout/stderr/exitCode when the remote command fails. ' +
      'Use for cluster inspection (sinfo, squeue, ls) and lightweight commands; ' +
      'long-running compute must go through Slurm submission, not this tool.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250 (华东一区【昆山】)' },
      command: { type: 'string', required: true, description: 'Shell command to run on the cluster login node' },
      timeout_seconds: { type: 'number', description: 'Remote timeout in seconds (default 30)' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await getClient().execCommand(
        args.cluster_id,
        args.command,
        args.timeout_seconds ?? 30,
      )
      return outputText(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_partitions',
    description:
      'List Slurm partitions on an HPC cluster (name, availability, time limit, node count, state). ' +
      'Use to pick a partition before submitting work; partition choice affects billing — ' +
      'follow the user\'s explicit partition instruction and never pick one on your own.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const r = await getClient().execCommand(args.cluster_id, SINFO_COMMAND)
      const partitions = parseSinfoOutput(outputText(r))
      const header = 'partition|avail|timelimit|nodes|state'
      return [header, ...partitions.map((p) =>
        [p.partition, p.avail, p.timelimit, p.nodes, p.state].join('|'))].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_sbatch',
    description:
      'Submit a Slurm job script with sbatch in a workdir on an HPC cluster; returns the Slurm job id. ' +
      'After submitting, register the job id with mat_job_watch (or rely on mat_gaussian) ' +
      'instead of polling squeue/sacct yourself.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      workdir: { type: 'string', required: true, description: 'Absolute working directory containing the script' },
      filename: { type: 'string', required: true, description: 'Job script filename (relative to workdir), e.g. slurm.sh' },
      task_ref: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional budget gate: {portfolio_file, task_id}. Present = submission checked against the ' +
          "portfolio's declared budget (sbatch/retry/core-hour caps); refusal returns BUDGET_REJECTED without submitting, " +
          'and a successful submit is recorded in the portfolio ledger automatically. Omit for standalone use.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      if (!args.workdir.trim() || !args.filename.trim()) {
        throw new Error('workdir and filename must be non-empty')
      }
      const budgetGate = openBudgetGate(args.task_ref)
      const r = await getClient().execCommand(args.cluster_id, sbatchCommand(args.workdir, args.filename))
      const jobId = parseSbatchSubmission(outputText(r))
      budgetGate?.record(jobId)
      return `submitted batch job ${jobId} on ${args.cluster_id} (workdir: ${args.workdir})`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_job_status',
    description:
      'Query the current state of ONE Slurm job (squeue, falling back to sacct for finished/queued-out jobs). ' +
      'Prefer mat_job_watch for waiting on jobs — this tool is for spot checks only.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      job_id: { type: 'string', required: true, description: 'Numeric Slurm job id' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const jobId = args.job_id.trim()
      if (!/^\d+$/.test(jobId)) {
        throw new Error('job_id must be numeric (no array/task suffixes)')
      }
      const client = getClient()
      const state = await queryJobStatus(
        (clusterId, command, timeoutSeconds) => client.execCommand(clusterId, command, timeoutSeconds),
        args.cluster_id,
        jobId,
      )
      return `job ${jobId} on ${args.cluster_id}: ${state === '' ? 'UNKNOWN (not observed by squeue/sacct)' : state}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_cancel',
    description:
      'Cancel a Slurm job on an HPC cluster with scancel (this cancels the job itself, ' +
      'unlike job_kill which only stops monitoring).',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      job_id: { type: 'string', required: true, description: 'Numeric Slurm job id' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const jobId = args.job_id.trim()
      if (!/^\d+$/.test(jobId)) {
        throw new Error('job_id must be numeric (no array/task suffixes)')
      }
      const r = await getClient().execCommand(args.cluster_id, scancelCommand(jobId))
      const out = outputText(r).trim()
      return `scancel ${jobId} on ${args.cluster_id} issued${out === '' ? '' : `: ${out}`}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_job_watch',
    description:
      'Batch-watch Slurm jobs on an HPC cluster asynchronously as a background job. ' +
      'Register every submitted job id in ONE call; the harness polls sacct server-side ' +
      '(adaptive 10-300s interval, one batched command per tick, no model requests) and ' +
      'sends an in-session notice when all jobs reach terminal states. ' +
      'Read the per-job final table with job_output after the notice. ' +
      'job_kill cancels the monitoring only — scancel the jobs themselves via mat_exec if needed.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id the jobs were submitted to, e.g. 11250' },
      job_ids: {
        type: 'array', required: true, items: { type: 'string' },
        description: 'Slurm job ids to watch (digits only, no array/task suffixes)',
      },
      poll_seconds: { type: 'number', description: 'Optional cap on the poll interval in seconds (min 10; default adaptive 10-300s)' },
      max_wait_seconds: { type: 'number', description: 'Total watch budget in seconds (default 86400); exceeding settles with still-active ids — just watch again' },
      label: {
        type: 'string',
        description: 'Optional context prefix for board labels so stepwise watches read like one-stop jobs: ' +
          'e.g. "gaussian irc @11250" — per-job labels become "<label> #<jobid>" ' +
          '(matching mat_gaussian\'s "gaussian <task> @<cluster> #<jobid>"). Default: bare job id.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const jobs = ctx.get('jobs')
      if (jobs === undefined) {
        throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
      }
      const jobIds = [...new Set(args.job_ids.map((id) => id.trim()).filter((id) => /^\d+$/.test(id)))]
      if (jobIds.length === 0) {
        throw new Error('job_ids must contain at least one numeric Slurm job id')
      }
      const pollSeconds = args.poll_seconds !== undefined ? Math.max(10, args.poll_seconds) : undefined
      const maxWaitMs = (args.max_wait_seconds ?? 86_400) * 1_000
      // 每次 watch 独立客户端：后台轮询与前台 mat_exec 会话互不干扰。
      const watchClient = newWatchClient()
      const labelPrefix = args.label !== undefined && args.label.trim() !== '' ? args.label.trim() : undefined
      const id = jobs.start({
        kind: 'mat-watch',
        label: labelPrefix !== undefined ? `${labelPrefix} ×${jobIds.length} jobs` : `${args.cluster_id} ×${jobIds.length} jobs`,
        outputLimitBytes: 4_096,
        ...exec.agent ? { owner: exec.agent } : {},
        run: () => {
          // 一卡一 Slurm 作业：板键 = cluster:jobId（确定性，重复 watch 同键幂等合并，
          // 不随宿主任务计数增殖）；label = 纯作业号（下拉即 job-id，可直接解析）。
          // 键不依赖宿主任务 id，run() 内没有对它的闭包引用——旧实现引用了
          // start() 同步窗口内尚未赋值的 id，每次调用必 TDZ。
          const statusKeyOf = (jobId: string): string => `${args.cluster_id}:${jobId}`
          const jobLabel = (jobId: string): string => labelPrefix !== undefined ? `${labelPrefix} #${jobId}` : jobId
          for (const jobId of jobIds) {
            statusBoard.upsert(statusKeyOf(jobId), {
              kind: 'mat-watch', label: jobLabel(jobId),
              clusterId: args.cluster_id, ownerSession: exec.agent?.id,
              localWorkspace: reserveLocalWorkspace(args.cluster_id, jobId),
            })
          }
          let lastStates = new Map<string, SlurmJobInfo>()
          const loop = createWatchLoop({
            clusterId: args.cluster_id,
            jobIds,
            maxWaitMs,
            ...(pollSeconds !== undefined ? { maxPollMs: pollSeconds * 1_000 } : {}),
            onTick: (states) => {
              try {
                lastStates = new Map(states)
                for (const [jobId, info] of states) {
                  statusBoard.upsert(statusKeyOf(jobId), {
                    kind: 'mat-watch', label: jobLabel(jobId),
                    clusterId: args.cluster_id, ownerSession: exec.agent?.id,
                    localWorkspace: reserveLocalWorkspace(args.cluster_id, jobId),
                    // sacct WorkDir：watch 作业的文件面板入口（无 workdir 时面板只能看到空本地目录）。
                    ...(info.workdir === undefined ? {} : { workdir: info.workdir }),
                    slurm: statusSlurm(new Map([[jobId, info]])),
                  })
                }
              } catch { /* 状态板旁路故障不影响监控 */ }
            },
            execCommand: (clusterId, command, timeoutSeconds) => watchClient.execCommand(clusterId, command, timeoutSeconds),
            scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
            clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
          })
          void loop.done.then(() => {
            // 逐卡结算：只 settle 已终态的作业；max-wait/传输中断时未终态的卡保持
            // monitoring（作业仍在远端跑，再 watch 同键续接，不产生新卡片）。
            for (const [jobId, info] of lastStates) {
              if (!isTerminal(info.state)) continue
              try {
                statusBoard.settle(statusKeyOf(jobId), {
                  outcomeStatus: info.state === 'COMPLETED' ? 'completed' : info.state === 'CANCELLED' ? 'killed' : 'failed',
                  detail: `${info.state}${info.exitCode !== undefined ? ` (exit ${info.exitCode})` : ''}`,
                })
              } catch { /* 状态板旁路故障不影响结算 */ }
            }
          })
          return loop
        },
      })
      return [
        `watching ${jobIds.length} Slurm job(s) on ${args.cluster_id}: ${jobIds.join(', ')}`,
        `background job ${id} registered; completion notice will arrive in-session.`,
        `Read incremental status with job_output; cancel monitoring with job_kill (the jobs themselves keep running).`,
      ].join(' ')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_gaussian',
    description:
      'One-stop Gaussian workflow on an HPC cluster: writes inputs (molecule.xyz / pre.json / run.json / post.json), ' +
      'runs the pre and run phases, submits via sbatch, and returns immediately with the slurm job id and a ' +
      'background job id. The background producer polls sacct server-side (no model requests) and automatically ' +
      'runs the post phase at terminal state — final properties (energy, converged, frequencies_cm-1, ' +
      'imaginary_frequency_count), files, and plot artifacts (plots: chart PNG + CSV paths) are read with ' +
      'job_output after the in-session completion notice. ' +
      'Defaults: B3LYP/6-31G(d), 32 cores / 64GB, Agent0 partition. Use this for single-shot calculations with ' +
      'known options; use the gaussian-calc skill flow for interactive or step-by-step work.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      task: { type: 'string', required: true, description: "Gaussian task type, e.g. 'opt', 'freq', 'opt+freq'" },
      structure: { type: 'string', required: true, description: 'XYZ structure string (atom count line, comment line, then one atom per line)' },
      workdir: { type: 'string', required: true, description: 'Absolute remote working directory (created if absent)' },
      partition: { type: 'string', description: 'Slurm partition (default Agent0). Billing-relevant — follow the user\'s explicit instruction.' },
      options: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional passthrough: pre_json, run_json (full phase configs overriding defaults), ' +
          'workflow_env, g16_env (env script paths), poll_seconds (poll cap, min 10, default 30), max_wait_seconds (default 1800)',
      },
      task_ref: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional budget gate: {portfolio_file, task_id}. Present = submission checked against the ' +
          "portfolio's declared budget (sbatch/retry/core-hour caps; core-hour estimate from pre_json.resources.ncores); " +
          'refusal returns BUDGET_REJECTED without submitting, and a successful submit is recorded in the portfolio ' +
          'ledger automatically. Omit for standalone use.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const jobs = ctx.get('jobs')
      if (jobs === undefined) {
        throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
      }
      if (!args.task.trim() || !args.structure.trim() || !args.workdir.trim()) {
        throw new Error('task, structure and workdir must be non-empty')
      }
      const options = gaussianOptions(args.options)
      const budgetGate = openBudgetGate(args.task_ref, options.preJson)
      const manifestRef = parseManifestRef(args.task_ref)
      const runSlurm = options.runJson?.['slurm']
      const runPartition = typeof runSlurm === 'object' && runSlurm !== null
        ? (runSlurm as Record<string, unknown>)['partition']
        : undefined
      // run_json 完整覆盖默认 run 配置；若提供它，实际 partition 也必须从其中投影。
      const partition = options.runJson !== undefined
        ? (typeof runPartition === 'string' && runPartition !== '' ? runPartition : undefined)
        : (args.partition !== undefined && args.partition !== '' ? args.partition : 'Agent0')
      // 同步段：独立客户端（prepare/pre/run/sbatch 四段往返）
      const syncClient = newWatchClient()
      const adapter: RemoteWorkflowAdapter = createLegacyGaussianWorkflowAdapter({
        execute: async (request) => {
          const structure = request.inputs['structure']
          if (typeof structure !== 'string') throw new Error('Gaussian workflow request requires structure input')
          const result = await runGaussianSync({
            execCommand: (clusterId, command, timeoutSeconds) => syncClient.execCommand(clusterId, command, timeoutSeconds),
            clusterId: request.clusterId,
            task: String(request.inputs['task'] ?? args.task.trim()),
            structure,
            workdir: request.workdir,
            partition,
            options,
          })
          return { executionId: result.slurmJobId, workdir: request.workdir }
        },
      })
      const request = createRemoteWorkflowRequest({
        workflow: adapter.workflow,
        clusterId: args.cluster_id,
        workdir: args.workdir.trim(),
        inputs: {
          task: args.task.trim(), structure: args.structure,
          'pre.json': options.preJson ?? defaultPreJson(),
          'run.json': options.runJson ?? defaultRunJson(partition),
          'post.json': {},
        },
        requestedOutputs: ['properties', 'artifact_manifest'],
      })
      const { executionId: slurmJobId } = await adapter.run(request)
      budgetGate?.record(slurmJobId)
      if (manifestRef !== undefined) recordWorkdir(manifestRef, args.workdir.trim())
      // producer：再一个独立客户端（终态后自动 post，与同步段/前台隔离）
      const producerClient = newWatchClient()
      // 同 watch：板键 = cluster:slurmJobId，workspace 直接落在真实作业号目录。
      const statusKey = `${args.cluster_id}:${slurmJobId}`
      const id = jobs.start({
        kind: 'mat-slurm',
        label: `gaussian ${args.task.trim()} @${args.cluster_id} #${slurmJobId}`,
        outputLimitBytes: 8_192,
        ...exec.agent ? { owner: exec.agent } : {},
        run: () => {
          statusBoard.upsert(statusKey, {
            kind: 'mat-slurm', label: `gaussian ${args.task.trim()} @${args.cluster_id} #${slurmJobId}`,
            clusterId: args.cluster_id, ownerSession: exec.agent?.id,
            task: args.task.trim(), workdir: args.workdir.trim(),
            localWorkspace: reserveLocalWorkspace(args.cluster_id, slurmJobId), partition,
          })
          return createGaussianProducerHooks({
          execCommand: (clusterId, command, timeoutSeconds) => producerClient.execCommand(clusterId, command, timeoutSeconds),
          clusterId: args.cluster_id,
          task: args.task.trim(),
          workdir: args.workdir.trim(),
          slurmJobId,
          ...options.workflowEnv !== undefined ? { workflowEnv: options.workflowEnv } : {},
          pollSeconds: options.pollSeconds ?? DEFAULT_PRODUCER_POLL_SECONDS,
          ...options.maxWaitSeconds !== undefined ? { maxWaitSeconds: options.maxWaitSeconds } : {},
          onTick: (states) => {
            try {
              statusBoard.upsert(statusKey, {
                kind: 'mat-slurm', label: `gaussian ${args.task.trim()} @${args.cluster_id} #${slurmJobId}`,
                clusterId: args.cluster_id, ownerSession: exec.agent?.id,
                task: args.task.trim(), workdir: args.workdir.trim(),
                localWorkspace: reserveLocalWorkspace(args.cluster_id, slurmJobId), partition, slurm: statusSlurm(states),
              })
            } catch { /* 状态板旁路故障不影响 producer */ }
          },
          onResult: (result) => {
            settleBoard(statusBoard, statusKey, result, fileService)
            if (manifestRef !== undefined) snapshotProperties(manifestRef, result)
          },
          })
        },
      })
      return [
        `gaussian ${args.task.trim()} submitted on ${args.cluster_id}: slurm job ${slurmJobId} (workdir: ${args.workdir.trim()}).`,
        `background job ${id} registered — the post phase runs automatically at terminal state;`,
        `a completion notice will arrive in-session, then read properties/files with job_output.`,
      ].join(' ')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_upload',
    description:
      'Upload a local file to an HPC cluster (efile API preferred, remote-shell fallback; overwrites by default). ' +
      'Use for sending structure/input files to the cluster shared filesystem. efile uses ' +
      'MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER; fallback uses MAT_MCP_KEY.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      local_path: { type: 'string', required: true, description: 'Absolute local file path to upload' },
      remote_path: { type: 'string', required: true, description: 'Absolute destination path on the cluster shared filesystem' },
      cover: { type: 'string', description: "Overwrite policy: 'cover' (default) or 'skip'" },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      if (!args.local_path.trim() || !args.remote_path.trim()) {
        throw new Error('local_path and remote_path must be non-empty absolute paths')
      }
      const cover = args.cover !== undefined && args.cover.trim() !== '' ? args.cover.trim() : 'cover'
      if (cover !== 'cover' && cover !== 'skip') {
        throw new Error(`cover must be 'cover' or 'skip', got '${cover}'`)
      }
      try {
        const client = await getEfileClient(args.cluster_id)
        const r = await client.uploadFile(args.local_path.trim(), args.remote_path.trim(), cover)
        return `uploaded ${args.local_path.trim()} → ${args.cluster_id}:${r.path} (cover=${cover})`
      } catch (error) {
        if (!canFallBackToRemoteShell(error)) throw error
        if (cover === 'skip') {
          throw new Error("cover='skip' requires the efile API, but this cluster has no authorized efile token")
        }
        const r = await getShellFileClient().uploadFile(args.cluster_id, args.local_path.trim(), args.remote_path.trim())
        return `uploaded via remote-shell fallback ${args.local_path.trim()} → ${args.cluster_id}:${r.path} (${r.bytes} bytes)`
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_download',
    description:
      'Download a file from an HPC cluster to a local path (efile API preferred, remote-shell fallback). ' +
      'Use for fetching result artifacts (optimized structures, logs) from the cluster shared filesystem. ' +
      'efile uses MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER; fallback uses MAT_MCP_KEY.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      remote_path: { type: 'string', required: true, description: 'Absolute file path on the cluster shared filesystem' },
      local_path: { type: 'string', required: true, description: 'Absolute local destination path (parent directory must exist)' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      if (!args.remote_path.trim() || !args.local_path.trim()) {
        throw new Error('remote_path and local_path must be non-empty absolute paths')
      }
      try {
        const client = await getEfileClient(args.cluster_id)
        const r = await client.downloadFile(args.remote_path.trim(), args.local_path.trim())
        return `downloaded ${args.cluster_id}:${args.remote_path.trim()} → ${r.path} (${r.bytes} bytes)`
      } catch (error) {
        if (!canFallBackToRemoteShell(error)) throw error
        const r = await getShellFileClient().downloadFile(args.cluster_id, args.remote_path.trim(), args.local_path.trim())
        return `downloaded via remote-shell fallback ${args.cluster_id}:${args.remote_path.trim()} → ${r.path} (${r.bytes} bytes)`
      }
    },
  }))
}
