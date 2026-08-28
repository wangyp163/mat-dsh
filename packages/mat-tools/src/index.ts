import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// 引入 dsh-system-prompt 的 Context 声明合并（仅类型）。
import type {} from '@deepseek-ai/dsh-system-prompt'
// 引入 dsh-jobs 的 Context 合并（ctx.get('jobs')）并注册 watch 的 JobKind。
import type {} from '@deepseek-ai/dsh-jobs'
import { MatClient, createWatchLoop, outputText } from 'mat-core'
import {
  SINFO_COMMAND,
  createGaussianProducerHooks,
  parseSbatchSubmission,
  parseSinfoOutput,
  queryJobStatus,
  runGaussianSync,
  sbatchCommand,
  scancelCommand,
} from 'mat-core'
import type { GaussianOptions } from 'mat-core'
import { EfileClient, TokenClient } from 'mat-core'
import { createStatusBoard } from 'mat-core'
import type { GaussianProducerResult, SlurmJobInfo, StatusBoard } from 'mat-core'
import { resolveEfileCredentials } from './efile-env'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'mat-watch': 'mat-watch'
    'mat-slurm': 'mat-slurm'
  }
}

export const name = 'mat-tools'
export const inject = ['tools', 'systemPrompt']

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
function settleBoard(board: StatusBoard, jobId: string, result: GaussianProducerResult): void {
  try {
    board.settle(jobId, {
      outcomeStatus: result.status,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      ...(result.properties !== undefined ? { properties: result.properties } : {}),
      ...(result.files !== undefined ? { files: result.files } : {}),
    })
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

export function apply(ctx: Context): void {
  const statusBoard = createStatusBoard()
  ctx.provide('mat.status', statusBoard)

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
      'Move files between this machine and a cluster with mat_upload/mat_download ' +
      '(efile API, needs MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER credentials).',
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
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      if (!args.workdir.trim() || !args.filename.trim()) {
        throw new Error('workdir and filename must be non-empty')
      }
      const r = await getClient().execCommand(args.cluster_id, sbatchCommand(args.workdir, args.filename))
      const jobId = parseSbatchSubmission(outputText(r))
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
      const id = jobs.start({
        kind: 'mat-watch',
        label: `${args.cluster_id} ×${jobIds.length} jobs`,
        outputLimitBytes: 4_096,
        ...exec.agent ? { owner: exec.agent } : {},
        run: () => {
          const loop = createWatchLoop({
            clusterId: args.cluster_id,
            jobIds,
            maxWaitMs,
            ...(pollSeconds !== undefined ? { maxPollMs: pollSeconds * 1_000 } : {}),
            onTick: (states) => {
              try {
                statusBoard.upsert(id, {
                  kind: 'mat-watch', label: `${args.cluster_id} ×${jobIds.length} jobs`,
                  clusterId: args.cluster_id, ownerSession: exec.agent?.id,
                  slurm: statusSlurm(states),
                })
              } catch { /* 状态板旁路故障不影响监控 */ }
            },
            execCommand: (clusterId, command, timeoutSeconds) => watchClient.execCommand(clusterId, command, timeoutSeconds),
            scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
            clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
          })
          void loop.done.then((result) => settleBoard(statusBoard, id, result))
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
      'imaginary_frequency_count) and files are read with job_output after the in-session completion notice. ' +
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
          'workflow_env, g16_env (env script paths), poll_seconds (poll cap, min 10), max_wait_seconds (default 1800)',
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
      // 同步段：独立客户端（prepare/pre/run/sbatch 四段往返）
      const syncClient = newWatchClient()
      const { slurmJobId } = await runGaussianSync({
        execCommand: (clusterId, command, timeoutSeconds) => syncClient.execCommand(clusterId, command, timeoutSeconds),
        clusterId: args.cluster_id,
        task: args.task.trim(),
        structure: args.structure,
        workdir: args.workdir.trim(),
        ...(args.partition !== undefined && args.partition !== '' ? { partition: args.partition } : {}),
        options,
      })
      // producer：再一个独立客户端（终态后自动 post，与同步段/前台隔离）
      const producerClient = newWatchClient()
      const id = jobs.start({
        kind: 'mat-slurm',
        label: `gaussian ${args.task.trim()} @${args.cluster_id} #${slurmJobId}`,
        outputLimitBytes: 8_192,
        ...exec.agent ? { owner: exec.agent } : {},
        run: () => createGaussianProducerHooks({
          execCommand: (clusterId, command, timeoutSeconds) => producerClient.execCommand(clusterId, command, timeoutSeconds),
          clusterId: args.cluster_id,
          task: args.task.trim(),
          workdir: args.workdir.trim(),
          slurmJobId,
          ...options.workflowEnv !== undefined ? { workflowEnv: options.workflowEnv } : {},
          ...options.pollSeconds !== undefined ? { pollSeconds: options.pollSeconds } : {},
          ...options.maxWaitSeconds !== undefined ? { maxWaitSeconds: options.maxWaitSeconds } : {},
          onTick: (states) => {
            try {
              statusBoard.upsert(id, {
                kind: 'mat-slurm', label: `gaussian ${args.task.trim()} @${args.cluster_id} #${slurmJobId}`,
                clusterId: args.cluster_id, ownerSession: exec.agent?.id,
                task: args.task.trim(), workdir: args.workdir.trim(), slurm: statusSlurm(states),
              })
            } catch { /* 状态板旁路故障不影响 producer */ }
          },
          onResult: (result) => settleBoard(statusBoard, id, result),
        }),
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
      'Upload a local file to an HPC cluster via the efile API (multipart, overwrites by default). ' +
      'Use for sending structure/input files to the cluster shared filesystem; requires ' +
      'MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER credentials in the harness environment.',
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
      const client = await getEfileClient(args.cluster_id)
      const r = await client.uploadFile(args.local_path.trim(), args.remote_path.trim(), cover)
      return `uploaded ${args.local_path.trim()} → ${args.cluster_id}:${r.path} (cover=${cover})`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_download',
    description:
      'Download a file from an HPC cluster via the efile API to a local path. ' +
      'Use for fetching result artifacts (optimized structures, logs) from the cluster shared filesystem; ' +
      'requires MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER credentials in the harness environment.',
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
      const client = await getEfileClient(args.cluster_id)
      const r = await client.downloadFile(args.remote_path.trim(), args.local_path.trim())
      return `downloaded ${args.cluster_id}:${args.remote_path.trim()} → ${r.path} (${r.bytes} bytes)`
    },
  }))
}
