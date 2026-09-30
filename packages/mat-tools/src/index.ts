import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
// mat-db 驱动（D0 P1 复用飞轮）：node:sqlite 为 Node ≥22.13 内置（实验性告警属预期），
// 打开失败一律旁路——结果记忆缺位绝不影响计算主链。
import { DatabaseSync } from 'node:sqlite'
// 引入 dsh-system-prompt 的 Context 声明合并（仅类型）。
import type {} from '@deepseek-ai/dsh-system-prompt'
// 引入 dsh-jobs 的 Context 合并（ctx.get('jobs')）并注册 watch 的 JobKind。
import type {} from '@deepseek-ai/dsh-jobs'
// 会话文件归档（按会话分档）：引入 dsh-session 的 Events/Session 类型合并，
// 供 ctx.on('session/event') 订阅 write/mat_download 等工具调用记账。
import type {} from '@deepseek-ai/dsh-session'
// R2 跃迁通知：PENDING→RUNNING 时经 owner.followup 推会话通知（与完成通知同款通道）。
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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
  DEFAULT_GAUSSIAN_PARTITION,
  defaultRunJson,
  sbatchCommand,
  scancelCommand,
} from 'mat-core'
import type { GaussianOptions } from 'mat-core'
import {
  DEFAULT_VASP_NTASKS_PER_NODE,
  DEFAULT_VASP_NODES,
  DEFAULT_VASP_PARTITION,
  DEFAULT_VASP_POLL_SECONDS,
  DEFAULT_VASP_TIME,
  VASP_MODES,
  VASP_PRESETS,
  createLegacyVaspWorkflowAdapter,
  createVaspProducerHooks,
  formatVaspConfirmationSummary,
  parseVaspWalltimeHours,
  runVaspSync,
  summarizeVaspPre,
  validateVaspChain,
  vaspConfirmationDigest,
  vaspStructureFilename,
} from 'mat-core'
import type { VaspOptions } from 'mat-core'
import { EfileClient, ShellFileTransferClient, TokenClient } from 'mat-core'
import { createStatusBoard } from 'mat-core'
import { createMatDb, fromCalcflowResult } from 'mat-core'
// R9b：反应能学对账（纯逻辑在 mat-core，工具层只做取数与呈现）
import { computeReactionEnergy, formatReactionEnergy } from 'mat-core'
import type { SpeciesEnergies } from 'mat-core'
import {
  confirmationDigest,
  estimateCoreHoursFromRunJson,
  formatConfirmationSummary,
  summarizePre,
} from 'mat-core'
import { compileTaskPackage, formatTaskPackage, isStepwiseTask } from 'mat-core'
import { formatEnvGateSummary, envGateSchemaFor, parseEnvGateStdout } from 'mat-core'
import {
  createPipelineDriverHooks,
  createPipelineState,
  createPoolDriverHooks,
  createPoolState,
  globScfTailCommand,
  isTerminalPhase,
  onChainMarked,
  onChainRequeued,
  onPoolReattach,
  parseScfSamples,
  pipelineFromJson,
  pipelineToJson,
  poolFromJson,
  poolHasLiveChains,
  poolToJson,
  poolSummary,
  resumePipeline,
  stalePipeline,
} from 'mat-core'
import type { PipelineDriverHooks, PipelineSubmitGate, PoolState } from 'mat-core'
import type { JobHooks } from '@deepseek-ai/dsh-jobs'
import type { CalcflowResultV1, Goal, PlanningDeps, MatDb, SqliteConnection, TaskPackage } from 'mat-core'
import type { GaussianProducerResult, RemoteWorkflowAdapter, MatJobStatus, SlurmJobInfo, StatusBoard } from 'mat-core'
import { MatFileServiceImpl } from './file-service.ts'
import { openBudgetGate, parseBudgetTaskRef } from './budget-hook.ts'
import { assertPhaseGate } from './phase-gate.ts'
import { appendAttemptsLineCommand, parseAttemptsLedgerRef } from './attempts-ledger.ts'
import { assertWaveGate } from './wave-gate.ts'
import { loadPersistedPackage } from './wave-gate.ts'
import { parseManifestRef, recordWorkdir, snapshotProperties } from './manifest-hook.ts'
import {
  assertEnvGate,
  envGateCommand,
  envGateDisabled,
  envGateMaxAgeMs,
  getEnvGateRegistry,
} from './env-gate-registry.ts'
import type { EnvGateEngine } from './env-gate-registry.ts'
import type { SettledFileJob } from './file-service.ts'
import { resolveEfileCredentials } from './efile-env.ts'
import { createWorkdirResolver } from './workdir-resolver.ts'
import type { WorkdirResolver } from './workdir-resolver.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'mat-watch': 'mat-watch'
    'mat-slurm': 'mat-slurm'
    'mat-pipeline': 'mat-pipeline'
    'mat-pool': 'mat-pool'
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

/**
 * R2 排队可见性：sacct 观察态 → 板卡相位。全 PENDING → queued（排队中）；
 * 任一 RUNNING/COMPLETING → running；无从判断 → undefined（保持现相位）。
 */
function deriveQueuePhase(states: ReadonlyMap<string, SlurmJobInfo>): 'queued' | 'running' | undefined {
  const list = [...states.values()]
  if (list.length === 0) return undefined
  const active = list.some((i) => i.state === 'RUNNING' || i.state === 'COMPLETING')
  if (active) return 'running'
  if (list.every((i) => i.state === 'PENDING')) return 'queued'
  return undefined
}

/** unknown → string（参数面宽松取值）。 */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
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

/** mat_vasp 的 options 透传（工具面 snake_case → 库面 camelCase）。 */
function vaspOptions(raw: unknown): VaspOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    ...typeof o.workflow_env === 'string' ? { workflowEnv: o.workflow_env } : {},
    ...typeof o.vasp_env === 'string' ? { vaspEnv: o.vasp_env } : {},
    ...typeof o.calculator_vasp_command === 'string' ? { vaspCommand: o.calculator_vasp_command } : {},
    ...typeof o.nodes === 'number' ? { nodes: o.nodes } : {},
    ...typeof o.ntasks_per_node === 'number' ? { ntasksPerNode: o.ntasks_per_node } : {},
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

// R4：mat_task_build 的编译产物按 digest 键落盘——sbatch 波间门的门条件数据源
//（门条件来自 planning 物化，不经 LLM 转述；与 jobs.json 同策略不设 GC，幂等覆盖）。
function taskPackagesDir(): string {
  return join(localWorkspaceRoot(), 'task-packages')
}

function persistTaskPackage(pkg: TaskPackage): void {
  const path = join(taskPackagesDir(), `${pkg.digest}.json`)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.part`
  writeFileSync(temporary, JSON.stringify(pkg), { mode: 0o600 })
  renameSync(temporary, path)
}

// R6a：pipeline 状态外置（pipelines/<pipelineId>.json，.part+rename 原子写）
function pipelinesDir(): string {
  return join(localWorkspaceRoot(), 'pipelines')
}

function pipelinePath(pipelineId: string): string {
  return join(pipelinesDir(), `${pipelineId}.json`)
}

function persistPipeline(state: Parameters<typeof pipelineToJson>[0]): void {
  const path = pipelinePath(state.pipelineId)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.part`
  writeFileSync(temporary, pipelineToJson(state), { mode: 0o600 })
  renameSync(temporary, path)
}

function readPipeline(pipelineId: string): ReturnType<typeof pipelineFromJson> {
  return pipelineFromJson(readFileSync(pipelinePath(pipelineId), 'utf8'))
}

/**
 * 同一 workdir 上的在跑链（workdir 唯一性闸）。同一 workdir 上两条链会：
 *   1) 处方换档时相互覆写 pre.json（整体覆写语义，不是合并）；
 *   2) 共享同一个 result.json，门检读到对方的 properties。
 * 故拒绝并发，而非警告。读取失败的 pipeline 文件跳过（不阻断新链启动）。
 */
function findLivePipelineOnWorkdir(
  dir: string,
  workdir: string,
  excludeId: string,
): { pipelineId: string; phase: string; task: string } | undefined {
  if (!existsSync(dir)) return undefined
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    const id = entry.slice(0, -'.json'.length)
    if (id === excludeId) continue
    try {
      const state = pipelineFromJson(readFileSync(join(dir, entry), 'utf8'))
      if (state.workdir.replace(/\/+$/, '') !== workdir) continue
      if (isTerminalPhase(state.phase)) continue
      return { pipelineId: state.pipelineId, phase: state.phase, task: state.task }
    } catch {
      // 损坏或半写的状态文件不阻断启动判断
    }
  }
  return undefined
}

function renderPipelineStatus(state: ReturnType<typeof pipelineFromJson>): string {
  const lines = [
    `${state.pipelineId} ${state.phase} wave ${state.currentWaveId}/${state.waves[state.waves.length - 1]!.waveId}` +
      ` (${state.task}) @${state.clusterId} ${state.workdir}`,
    ...state.waves.map((w) =>
      `  wave ${w.waveId} ${w.task} attempt=${w.attempt}${w.jobId !== undefined ? ` job=${w.jobId}` : ''}` +
      `${w.prescriptionLevel !== undefined ? ` L${w.prescriptionLevel}=${w.prescriptionRoute ?? '-'}` : ''}` +
      `${w.watchExpiries !== undefined ? ` watchExpiries=${w.watchExpiries}` : ''}`),
  ]
  if (state.pendingSubmit !== undefined) {
    const i = state.pendingSubmit
    lines.push(
      `UNRESOLVED SUBMIT: wave ${i.waveId} attempt ${i.attempt} intent at ${new Date(i.at).toISOString()}` +
      `${i.route !== undefined ? ` (route ${i.route})` : ''} — a remote job MAY exist.`,
      '  Reconcile explicitly: mat_pipeline_resume action=adopt job_id=<id> (a job is on the cluster) or ' +
      'action=resubmit (confirmed no job). Do NOT start a duplicate chain.',
    )
  }
  if (state.needsLlmReason !== undefined) lines.push(`needs_llm: ${state.needsLlmReason}`)
  if (state.deadLetter !== undefined) lines.push(`dead_letter: ${state.deadLetter.reason}`)
  if (state.phase === 'cancelled') lines.push('cancelled by user — any job still queued/running was scancel-ed best-effort; verify with squeue/sacct')
  if (stalePipeline(state)) {
    lines.push(state.phase === 'submitting'
      ? 'stale: submitting without a confirmed jobId — resume with action=adopt or action=resubmit'
      : state.phase === 'watch_expired'
        ? 'watch window elapsed, the job is STILL on the cluster (queued or running) — resume with action=rewatch ' +
          'to re-attach monitoring to the same job; do NOT resubmit (double-book)'
        : 'stale: wave_submitted without a live watcher — resume with action=rewatch')
  }
  for (const h of state.history.slice(-5)) lines.push(`  ${h.event}${h.detail !== undefined ? `: ${h.detail}` : ''}`)
  return lines.join('\n')
}

/** driver 句柄 → 宿主 JobHooks：rich 终态映射到 completed/killed/failed。 */
function pipelineJobHooks(driver: PipelineDriverHooks): JobHooks {
  return {
    cancel: () => driver.cancel(),
    done: driver.done.then((outcome) => ({
      status: outcome.status === 'completed' ? 'completed' as const
        : outcome.status === 'cancelled' ? 'killed' as const
          : 'failed' as const,
      detail: outcome.detail,
    })),
    readOutput: () => driver.readOutput(),
  }
}

function pipelineNotify(agent: { followup?: (m: never) => void } | undefined): (message: string) => void {
  return (message) => {
    agent?.followup?.(createUserMessage({
      content: [{ type: 'text', text: `background pipeline update: ${message}` }],
      source: {
        kind: 'plugin', plugin: 'mat-tools', form: 'notice',
        summary: message.slice(0, 160),
      },
    }) as never)
  }
}

/** driver 句柄 → 宿主 JobHooks：rich 终态映射到 completed/killed/failed（pool 同款）。 */
function poolJobHooks(driver: { cancel(): void; done: Promise<{ status: string; detail: string }>; readOutput(): string }): JobHooks {
  return {
    cancel: () => driver.cancel(),
    done: driver.done.then((outcome) => ({
      status: outcome.status === 'completed' ? 'completed' as const
        : outcome.status === 'cancelled' ? 'killed' as const
          : 'failed' as const,
      detail: outcome.detail,
    })),
    readOutput: () => driver.readOutput(),
  }
}

// R6b：池状态外置（pools/<poolId>.json）
function poolsDir(): string {
  return join(localWorkspaceRoot(), 'pools')
}

function poolPathOf(poolId: string): string {
  return join(poolsDir(), `${poolId}.json`)
}

function persistPoolState(state: PoolState): void {
  const path = poolPathOf(state.poolId)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.part`
  writeFileSync(temporary, poolToJson(state), { mode: 0o600 })
  renameSync(temporary, path)
}

function readPool(poolId: string): PoolState {
  return poolFromJson(readFileSync(poolPathOf(poolId), 'utf8'))
}

function renderPoolStatus(state: PoolState): string {
  const lines = [
    `${state.poolId} cap=${state.maxConcurrent} @${state.clusterId} — ${poolSummary(state)}`,
    ...state.chains.map((c) => {
      let chainPhase = ''
      try {
        const p = readPipeline(c.pipelineId)
        chainPhase = ` [wave ${p.currentWaveId}/${p.waves[p.waves.length - 1]!.waveId} ${p.phase}]`
      } catch { /* 链状态文件尚未生成(未 admit)属正常 */ }
      return `  ${c.pipelineId} ${c.phase}${chainPhase} ${c.workdir}` +
        (c.outcome !== undefined ? `\n    outcome: ${c.outcome.status} — ${c.outcome.detail.slice(0, 140)}` : '')
    }),
  ]
  if (poolHasLiveChains(state)) lines.push('live chains running — resume is refused until they settle')
  else if (state.chains.some((c) => c.phase === 'running')) lines.push('stale running chains (no live driver assumed) — resume with action=reattach')
  if (state.chains.some((c) => c.phase === 'halted')) {
    // 区分两类 halted（B0）：watch 窗口耗尽（作业仍在场,机械 rewatch 即可）vs
    // 真诊断位（门检失败/无梯进——需要 gaussian-calc 诊断后 retry/dead_letter）。
    const rewatchable = state.chains.filter((c) => {
      if (c.phase !== 'halted') return false
      try {
        return readPipeline(c.pipelineId).phase === 'watch_expired'
      } catch {
        return false
      }
    })
    const diagnosed = state.chains.filter((c) => c.phase === 'halted').length - rewatchable.length
    lines.push(
      `halted chains await action (${rewatchable.length} watch_expired → action=rewatch, no resubmit; ` +
      `${diagnosed} needs diagnosis → gaussian-calc then retry/dead_letter) — mat_pool_resume with chain+action`,
    )
  }
  for (const h of state.history.slice(-5)) lines.push(`  ${h.event}${h.detail !== undefined ? `: ${h.detail}` : ''}`)
  return lines.join('\n')
}

/**
 * R6b 提交闸工厂：链 task_ref → 相位闸 + 预算闸（check 时开闸、record 时记账；
 * check 抛错即零集群副作用——与 mat_sbatch 手工路径同一条纪律通道）。
 */
function makePoolSubmitGate(rawTaskRef: unknown): PipelineSubmitGate | undefined {
  const ref = parseBudgetTaskRef(rawTaskRef)
  if (ref === undefined) return undefined
  let handle: ReturnType<typeof openBudgetGate> = undefined
  return {
    check() {
      assertPhaseGate(rawTaskRef)
      handle = openBudgetGate(rawTaskRef)
    },
    record(jobId: string) {
      handle?.record(jobId)
      handle = undefined
    },
  }
}

// ---------------------------------------------------------------------------
// mat-db（D0 P1：跨会话结果记忆）——<MAT_FILE_ROOT>/mat.db，与 kb-sync 同位。
// producer 结算自动入库（runs 恒记台账；results 仅在有物性时记），工具面 mat_db_query。
// 库任何故障一律旁路：打开失败返回 undefined，写入失败吞掉——绝不影响计算主链。
// ---------------------------------------------------------------------------

let matDbCache: MatDb | undefined

function openMatDb(): MatDb | undefined {
  if (matDbCache !== undefined) {
    return matDbCache
  }
  try {
    const conn = new DatabaseSync(join(localWorkspaceRoot(), 'mat.db')) as unknown as SqliteConnection
    const db = createMatDb(conn)
    db.migrate()
    matDbCache = db
    return db
  } catch {
    return undefined
  }
}

/** 测试隔离用：清掉模块级连接缓存（换 MAT_FILE_ROOT 后重新打开）。 */
export function resetMatDbForTests(): void {
  matDbCache = undefined
}

/** producer 结算 → mat-db 入库（失败旁路）。导出供接线测试。 */
export function recordProducerOutcomeToDb(
  db: MatDb | undefined,
  outcome: GaussianProducerResult,
  identity: { task: string; workdir: string; jobId: string; preset?: string; coreHours?: number | null },
): void {
  if (db === undefined) {
    return
  }
  try {
    const parsed: CalcflowResultV1 = {
      task: identity.task,
      workdir: identity.workdir,
      execution: { status: outcome.status },
      properties: outcome.properties as CalcflowResultV1['properties'],
    }
    const { run, result } = fromCalcflowResult(parsed, {
      jobId: identity.jobId,
      preset: identity.preset ?? '',
      coreHours: identity.coreHours ?? null,
    })
    db.recordRun(run)
    if (outcome.properties !== undefined) {
      db.recordResult(result) // 失败/诊断路无物性——只记台账不记结果
    }
  } catch {
    // 入库旁路：不影响结算
  }
}

/** run.json 的 slurm 段 → 估计核时（实现住 mat-core/confirmation.ts，此处仅透出）。 */
export function estimateCoreHours(runJson: unknown): number | null {
  return estimateCoreHoursFromRunJson(runJson)
}

/** 查询结果 → 紧凑文本行（工具输出契约：string）。导出供接线测试。 */
export function formatDbResultLines(
  rows: Array<{ ts: number; task: string; energy: number | null; converged: boolean | null; imaginaryFrequencyCount: number | null; artifactsPath: string | null }>,
): string {
  return rows
    .map((r) => {
      const when = new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ')
      const energy = r.energy === null ? '-' : r.energy.toFixed(6)
      const conv = r.converged === null ? '-' : String(r.converged)
      const imag = r.imaginaryFrequencyCount === null ? '-' : String(r.imaginaryFrequencyCount)
      return `${when} | ${r.task} | E=${energy} | converged=${conv} | imag_freqs=${imag}${r.artifactsPath ? ` | ${r.artifactsPath}` : ''}`
    })
    .join('\n')
}

/** KB 命中 → 紧凑文本行。导出供接线测试。 */
export function formatDbKbLines(entries: Array<{ id: string; task: string[]; path: string }>): string {
  return entries
    .map((e) => `kb:${e.id} | task: ${e.task.join(',') || '-'} | ${e.path}`)
    .join('\n')
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
  // 会话文件归档（按会话分档）：订阅宿主 session 事件流——write/edit/mat_download
  // 的 tool/call 即记账（session.id 即 SessionId，与状态板 ownerSession 同一身份体系）。
  // tool/call 的 arguments 是模型输出的 JSON 字符串；相对 file_path 按会话 cwd 解析
  // （与宿主 fs 后端对 workspace 的解析一致）。bash 内部命令不产生 tool/call 参数，v1 不归档。
  const TOOL_FILE_ARGS: Record<string, string> = { write: 'file_path', edit: 'file_path', mat_download: 'local_path' }
  ctx.on('session/event', (session, event) => {
    try {
      if (event.type !== 'tool/call') return
      const argKey = TOOL_FILE_ARGS[event.data.name]
      if (argKey === undefined) return
      const cwd = session.header.cwd
      if (cwd === undefined || !cwd.startsWith('/')) return
      const args = JSON.parse(event.data.arguments) as Record<string, unknown>
      const raw = typeof args[argKey] === 'string' ? (args[argKey] as string).trim() : ''
      if (raw === '') return
      const absolute = raw.startsWith('/') ? raw : `${cwd.replace(/\/$/, '')}/${raw}`
      void fileService.recordSessionFile(session.id, cwd, absolute)
    } catch { /* 归档是增益：任何失败不影响事件流与工具执行 */ }
  })
  // 环境门禁注册表（constraint-decoupling A2）：per-(host 进程, cluster, engine) + TTL。
  // 与 mat.status / mat.files 同款服务形态；四个提交入口与 mat_env_gate 共用同一张表，
  // 这正是「batch 子代理继承主会话门禁」的载体。
  ctx.provide('mat.envGate', getEnvGateRegistry())

  // 环境门禁引导段（constraint-decoupling A4 的 prompt 侧配套）：闸只能拒绝，
  // 不能教模型该先做什么——没有这一段，新接的闸只会产生一串看不懂的拒绝。
  ctx.systemPrompt.section({
    name: 'tool:mat-env-gate',
    order: 100,
    text:
      'FIRST COMMAND on any HPC cluster: call mat_env_gate(cluster_id) before any submission tool. ' +
      'The environment gate is mechanically enforced — mat_sbatch, mat_gaussian, mat_vasp, mat_pipeline_start and ' +
      'mat_pool_start all refuse with ENV_GATE_REJECTED (zero cluster side effects) until a gate pass is on record ' +
      'for that (cluster, engine). This holds even when the conversation already carries prior-turn artifacts, old ' +
      'result files or file references: the gate still comes first, and no pre-gate probing is warranted. ' +
      'One pass covers the whole host process for 12 hours, so batch sub-agents inherit the parent session gate ' +
      'automatically and must not re-run it per task. The gate is a black box: judge only its single-line JSON ' +
      'verdict and never read the script, run --help, or probe the task registry with python to reconstruct its ' +
      'checks (a bare calcflow registry import always returns an empty list and will make you misjudge the ' +
      'deployment). On ENV_GATE_SEED_NEEDED the script is absent or an older generation — follow the heredoc seed ' +
      'step in the {engine}-calc skill (gaussian-calc / vasp-calc / abacus-calc), then re-run the gate. On a failing verdict, report the errors as given and ' +
      'stop: do not search for fallbacks, guess substitute tasks, or submit anyway. ' +
      'Any newer_version notice is a non-blocking freshness warning — pass it to the user verbatim.',
  })

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
      'A submitted job may sit PENDING in the partition queue for minutes before it starts — ' +
      'silence after submission usually means queueing, not failure; the mat status panel shows ' +
      'queued/running states per job, and for long queues an in-session "started running" note may arrive ' +
      'before the final completion notice. ' +
      'For Gaussian 16 calculations, load the gaussian-calc skill first (skill tool) and follow ' +
      'its environment gate and workflow instead of searching the cluster for software yourself. ' +
      'When all calculation options are already known, prefer the one-shot mat_gaussian tool: ' +
      'it prepares inputs, runs pre/run, submits, and a background producer runs the post phase ' +
      'automatically at terminal state — properties arrive via job_output after the completion notice. ' +
      'Move files between this machine and a cluster with mat_upload/mat_download. ' +
      'They prefer the efile API with MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER and fall back ' +
      'to the authorized remote-shell channel when that cluster has no OpenAPI file token.',
  })

  // VASP 引导段：与 gaussian 同款的"先 skill 后一站式"引导。执行形态差异
  // （作业内整链）与"COMPLETED ≠ 物理收敛"的判读红线必须常驻提示。
  ctx.systemPrompt.section({
    name: 'tool:mat-vasp',
    order: 105,
    text:
      'For VASP / first-principles periodic calculations (relax, scf, band, pdos, DFT+U, spin-orbit, phonon...), ' +
      'load the vasp-calc skill first (skill tool) — task-chain semantics, precision presets, spin modes, and ' +
      'result interpretation live there. When the chain and options are known, prefer the one-stop mat_vasp tool: ' +
      'it writes the structure file and slurm script, submits, and the whole task chain (pre+run+post) runs INSIDE ' +
      'the Slurm job through the home-deployed matstream workflow env — there is no login-node phase. ' +
      'A background producer polls sacct server-side and harvests per-task energies, relax convergence, files and ' +
      'plot images at terminal state via job_output. HARD RULE: Slurm COMPLETED does not mean the physics converged — ' +
      'always check the converged flag and probe lines before reporting a successful calculation, and follow the ' +
      'vasp-calc interpretation protocol when a task did not converge. Retrieve crystal structures from OPTIMADE ' +
      'databases with the mcp__optimade__* tools when the user asks by formula or database id; downloaded CIF content ' +
      'can be passed to mat_vasp directly via structure_format=cif.',
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

  // mat-db 引导段（D0 P1 复用飞轮）：跨会话结果记忆优先查库，不重算、不翻目录。
  ctx.systemPrompt.section({
    name: 'tool:mat-db',
    order: 102,
    text:
      'A local cross-session results memory (mat.db) is kept under MAT_FILE_ROOT: ' +
      'every mat_gaussian settlement automatically records its structured properties there. ' +
      'Before proposing a new calculation for a structure that may have been computed before ' +
      '(questions like "算过 X 吗 / 之前用什么参数收敛的 / 上次的能量是多少"), ' +
      'query mat_db_query with the structure label (the remote workdir basename) first — ' +
      'an exact hit answers the question without spending cluster time. ' +
      'A miss is not an error: it just means no recorded history, proceed normally. ' +
      'mat_db_query with kb_error also matches raw error text against the gaussian-calc ' +
      'knowledge-base signature index when the skill references are not loaded.',
  })

  // task 构建器引导段（D0 P3 工具接线）：参数模板 + 最小流程描述 → goal → 编译 → 确认 → 执行。
  ctx.systemPrompt.section({
    name: 'tool:mat-task-build',
    order: 103,
    text:
      'When the user wants to QUICKLY BUILD a Gaussian calculation from a minimal description plus a parameter ' +
      'template (参数模板 + 计算流程最小描述, e.g. "用这套参数帮我把这个结构 opt 然后 freq" / "搭一个过渡态+IRC 的 task"), ' +
      'load the task-builder skill (skill tool) first: it turns the request into a goal.json and calls the ' +
      'local deterministic compiler mat_task_build, which returns either blocking clarification questions, ' +
      'or a compiled task package (waves + per-wave pre/run/post.json + parameter summary + digest + execution ' +
      'runbook). mat_task_build is local-only with zero cluster side effects — confirm the parameter summary ' +
      'with the user (blocking), then execute per the runbook. The package tells you which channel it belongs to: ' +
      "execution.mode is 'one-stop' (submit mat_gaussian directly with confirmed_digest, same digest source as " +
      "its confirmation gate) or 'stepwise' (a multi-wave chain). You do not need to work this out from the wave " +
      'count — the compiler already decided, and both tools refuse the wrong channel with WRONG_CHANNEL before any ' +
      'cluster call. For full-protocol interactive Gaussian work, ' +
      'the gaussian-calc skill remains the reference path; task-builder composes on top of the same tools.',
  })

  // pipeline 引导段（审阅表 R6a）：多波链交给代码循环，LLM 只站两端和急诊室。
  ctx.systemPrompt.section({
    name: 'tool:mat-pipeline',
    order: 104,
    text:
      'A compiled stepwise chain is DRIVEN BY CODE BY DEFAULT: after mat_task_build and the runbook steps up to ' +
      'pre, call mat_pipeline_start(pkg_digest, cluster_id, workdir). It drives run→sbatch→watch→post→inter-wave ' +
      'gate per wave, retries failures automatically via the structured kb prescription ladder, dead-letters on ' +
      'ladder exhaustion, and wakes the session only for ambiguous diagnoses (needs_llm) or completion. ' +
      'Resume a halted pipeline with mat_pipeline_resume (retry with the route you concluded / dead_letter / ' +
      'rewatch a stale in-flight wave); mat_pipeline_status reads the externalized state anytime. ' +
      'Drive waves by hand ONLY when the user needs to inspect or approve something between waves — that is the ' +
      'single reason to prefer it, and it is a choice about intent, not about chain length. The manual path is ' +
      'strictly less mechanized: you must pass wave_gate on every mat_sbatch (the tool refuses with GATE_FAILED ' +
      'before submitting when an earlier wave did not settle or pass its gate) and attempts_ledger for ledger ' +
      'bookkeeping, and the prescription ladder, dead-letter and needs_llm wake-up are all on you. ' +
      'Which channel a package belongs to is not your call: one-stop packages are refused here with WRONG_CHANNEL.',
  })

  // pool 引导段（审阅表 R6b）：批量任务池——shepherd fan-out 的代码化替代。
  ctx.systemPrompt.section({
    name: 'tool:mat-pool',
    order: 105,
    text:
      'For BATCHES of multi-wave chains (e.g. 20 reactions each tsxtb+ts+irc), use the batch pool instead of fanning ' +
      'out shepherds: mat_pool_start(cluster_id, chains=[{pkg_digest, workdir, task_ref?}], max_concurrent) admits ' +
      'chains up to the cap and backfills as they settle — per-chain machinery (gates, attempts ledger, prescription ' +
      'ladder, dead-letter) is the single-chain pipeline. Pass task_ref per chain so every wave submission goes through ' +
      'the phase gate and the budget gate (PHASE_GATE_REJECTED / BUDGET_REJECTED before any cluster side effect). ' +
      'Halted chains (needs_llm) do not block the pool: diagnose per gaussian-calc, then mat_pool_resume with ' +
      'action=retry (route) / dead_letter (reason). A chain halted because its watch window elapsed while the job is ' +
      'still queued/running (watch_expired) is NOT a diagnosis — resume it with action=rewatch (same job, no resubmit); ' +
      'watch windows also auto re-arm up to auto_rewatch_limit (default 2) before parking. After a host restart use ' +
      'action=reattach for stale running chains (it also restarts a pool drained with unstarted pending chains, e.g. ' +
      'after admission was halted by a gate rejection). ' +
      'The batch-orchestrator skill remains the manager protocol on top (manifest phases, prep/interpret workers); ' +
      'the pool replaces only the Phase C chain-driving fan-out.',
  })

  ctx.tools.register(defineTool({
    name: 'mat_env_gate',
    description:
      'Run the environment gate check on an HPC cluster for a given engine (default: gaussian; ' +
      "'vasp' for VASP/matstream, 'abacus' for ABACUS). " +
      'This MUST be called and must pass before any cluster submission (mat_sbatch, mat_gaussian, ' +
      'mat_vasp, mat_pipeline_start, mat_pool_start). The gate is zero-side-effect: gaussian checks ' +
      'workflow CLI version, protocol, g16 runtime, and task registry; vasp checks the home-deployed matstream env ' +
      '(version + task registry via python import), vasp_std presence, and sbatch. The result is cached per (host process, cluster, engine) ' +
      'with a 12h TTL so batch sub-agents inherit the parent session gate automatically. ' +
      'On pass: returns a summary line plus any newer_version warning. ' +
      'On fail: reports errors from the gate JSON verbatim — do not retry submission; fix the reported issues first. ' +
      'On seed-needed: the gate script is absent or an older generation — follow the heredoc seed step in the ' +
      "corresponding {engine}-calc skill.",
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      engine: {
        type: 'string',
        description: "Engine to gate (default 'gaussian'; 'vasp' for VASP/matstream; 'abacus' for ABACUS)",
      },
      workflow_root: {
        type: 'string',
        description: 'Override default workflow root path on the cluster (passed to check_environment.sh as $1)',
      },
      g16_home: {
        type: 'string',
        description: 'Override default g16 env script path on the cluster (passed to check_environment.sh as $2)',
      },
      timeout_seconds: {
        type: 'number',
        description: 'Remote timeout in seconds (default 180 — cold-start can take ~1 min)',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const engine = (args.engine ?? 'gaussian') as EnvGateEngine
      const timeout = args.timeout_seconds ?? 180
      const command = envGateCommand(engine, args.workflow_root, args.g16_home)
      const raw = await getClient().execCommand(args.cluster_id, command, timeout)
      const stdout = outputText(raw)
      const result = parseEnvGateStdout(stdout, envGateSchemaFor(engine))

      const warnLines = result.warnings.length > 0
        ? '\nWARNINGS (report to user verbatim):\n' + result.warnings.map((w) => `  ${w}`).join('\n')
        : ''

      if (result.status === 'pass') {
        if (!envGateDisabled()) {
          getEnvGateRegistry().register(args.cluster_id, engine, result.verdict!)
        }
        const ttlH = Math.round(envGateMaxAgeMs() / 3_600_000)
        return (
          formatEnvGateSummary(result.verdict!, engine) +
          ` (cached ${ttlH}h, cluster=${args.cluster_id})` +
          warnLines
        )
      }

      if (result.status === 'seed-needed') {
        return (
          `ENV_GATE_SEED_NEEDED: ${result.reason ?? 'gate script absent or old generation'}\n` +
          'Follow the heredoc seed step in the gaussian-calc skill to refresh the script, then re-run mat_env_gate.' +
          warnLines
        )
      }

      // fail — report errors verbatim; do not enter cache
      return (
        `ENV_GATE_REJECTED: ${result.reason ?? 'gate check failed'}\n` +
        'Fix the reported issues before submitting any jobs.' +
        warnLines
      )
    },
  }))

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
      attempts_ledger: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional attempts ledger auto-bookkeeping: {file, task, step, attempt?}. Present = after a ' +
          "successful submit, the tool itself appends the submitted line to the remote ledger file " +
          '(shapes: {"event":"submitted","task":...,"step":...,"attempt":N,"jobid":...}); a failed append never fails ' +
          'the submission. Recommended for multi-wave chains instead of manual echo.',
      },
      wave_gate: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional inter-wave gate (multi-wave chains, e.g. tsxtb+ts+irc): {pkg_digest, wave_id}. ' +
          'Present = before submitting, the tool loads the persisted task package (from mat_task_build) and checks ' +
          'the remote result.json: every earlier wave must be settled and must pass its gate (ts: converged AND ' +
          'exactly 1 imaginary frequency). Refusal throws GATE_FAILED with zero cluster side effects. ' +
          'workdir must be {work_dir}/{task}/{step directory} so result.json is found.',
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
      assertEnvGate(args.cluster_id)
      assertPhaseGate(args.task_ref)
      const budgetGate = openBudgetGate(args.task_ref)
      const ledger = parseAttemptsLedgerRef(args.attempts_ledger)
      await assertWaveGate(getClient(), taskPackagesDir(), args.cluster_id, args.workdir, args.wave_gate)
      const r = await getClient().execCommand(args.cluster_id, sbatchCommand(args.workdir, args.filename))
      const jobId = parseSbatchSubmission(outputText(r))
      budgetGate?.record(jobId)
      if (ledger !== undefined) {
        // R3：记账旁路——追加失败只告警，不连坐已成功的提交
        try {
          const la = await getClient().execCommand(args.cluster_id, appendAttemptsLineCommand(ledger, jobId))
          const code = (la as { code?: number }).code
          if (code !== undefined && code !== 0) {
            console.error(`[attempts-ledger] append exited ${code}: ${ledger.file}`)
          }
        } catch (error) {
          console.error(`[attempts-ledger] append failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
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
      scf_monitor: {
        type: 'boolean',
        description: 'Opt-in SCF convergence monitoring (default false): samples job.log SCF energies every ~60s (workdir from sacct, ' +
          'glob best-effort for non-workflow jobs), classifies the trend (converging/stalled/oscillating/diverging) and wakes the ' +
          'session only when an anomaly is CONFIRMED across two sample windows (oscillation/divergence, or a stall approaching the ' +
          'TimeLimit). Trend lines are visible in job_output as scf_trend: lines.',
      },
      scf_sample_seconds: {
        type: 'number',
        description: 'SCF sampling window in seconds (min 5; default 60). Lower it (e.g. 10-15) for SHORT-LIVED jobs: ' +
          'an anomaly needs two consecutive windows to confirm, so with the default 60s a job that settles within ~2 min can ' +
          'never alert (r4: oscillation fixtures wall-clock ≤9s proved this mechanically).',
      },
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
                    ...(deriveQueuePhase(new Map([[jobId, info]])) !== undefined
                      ? { phase: deriveQueuePhase(new Map([[jobId, info]]))! }
                      : {}),
                  })
                }
              } catch { /* 状态板旁路故障不影响监控 */ }
            },
            execCommand: (clusterId, command, timeoutSeconds) => watchClient.execCommand(clusterId, command, timeoutSeconds),
            scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
            clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
            // SCF 收敛监控(opt-in):通用作业无 task 布局约定,glob 尽力而为
            ...(args.scf_monitor === true ? {
              scfSampling: {
                ...(typeof args.scf_sample_seconds === 'number'
                  ? { intervalMs: Math.max(5, args.scf_sample_seconds) * 1_000 }
                  : {}),
                buildCommand: (workdirs: string[]) => globScfTailCommand(workdirs),
                parse: parseScfSamples,
                onTrend: (reports) => {
                  for (const r of reports) {
                    pipelineNotify(exec.agent)(`scf trend alert: job ${r.jobId} ${r.trend.kind} — ${r.trend.summary} (${r.workdir})`)
                  }
                },
              },
            } : {}),
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
      'Defaults: B3LYP/6-31G(d), 32 cores / 64GB, kshcnormal partition. Use this for single-shot calculations with ' +
      'known options; use the gaussian-calc skill flow for interactive or step-by-step work.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      task: { type: 'string', required: true, description: "Gaussian task type, e.g. 'opt', 'freq', 'opt+freq'" },
      structure: { type: 'string', required: true, description: 'XYZ structure string (atom count line, comment line, then one atom per line)' },
      workdir: { type: 'string', required: true, description: 'Absolute remote working directory (created if absent)' },
      partition: { type: 'string', description: 'Slurm partition (default kshcnormal). Billing-relevant — follow the user\'s explicit instruction.' },
      options: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional passthrough: pre_json, run_json (full phase configs overriding defaults), ' +
          'workflow_env, g16_env (env script paths), poll_seconds (poll cap, min 10, default 30), max_wait_seconds (default 1800), ' +
          "confirmation_gate ('off' disables the digest confirmation gate — emergency/rollback use only)",
      },
      task_ref: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional budget gate: {portfolio_file, task_id}. Present = submission checked against the ' +
          "portfolio's declared budget (sbatch/retry/core-hour caps; core-hour estimate from pre_json.resources.ncores); " +
          'refusal returns BUDGET_REJECTED without submitting, and a successful submit is recorded in the portfolio ' +
          'ledger automatically. Omit for standalone use.',
      },
      confirmed_digest: {
        type: 'string',
        description: 'Confirmation gate: sha256 digest of the effective parameter summary. The first call without ' +
          'it (or with a stale one) returns CONFIRM_REQUIRED plus the exact summary and digest, with NO cluster side ' +
          'effects. Present that summary to the user verbatim, and after explicit approval re-call with this field ' +
          "set to the returned digest. Set options.confirmation_gate='off' only when the user has already approved " +
          'this exact configuration earlier in the conversation.',
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
      // 通道闸（反向）：多波链走一站式必然失败在 sbatch 那一步——prepare/pre/run
      // 已经产生远端副作用（文件落盘、各波 step 目录渲染），而 slurm.sh 在
      // 01-<task>/ 子目录里，`cd {workdir}/{task} && sbatch slurm.sh` 那层没有。
      // 与其让它跑到那一步失败（副作用已发生、错误还是裸 sbatch 报错），在任何
      // 远端调用之前按 task DSL 查表拒绝——判据是 planning 的注册表，不需要编译
      // 产物，故模型跳过 mat_task_build 直调一站式同样拦得住。
      if (isStepwiseTask(args.task.trim())) {
        throw new Error(
          `WRONG_CHANNEL: ${args.task.trim()} is a stepwise (multi-wave) task — one-stop cannot submit it ` +
          '(each wave has its own step directory and inter-wave gate). Compile it with mat_task_build, then ' +
          'drive it with mat_pipeline_start (code-driven, recommended) or wave-by-wave per the runbook.',
        )
      }
      const options = gaussianOptions(args.options)
      assertEnvGate(args.cluster_id)
      assertPhaseGate(args.task_ref)
      const budgetGate = openBudgetGate(args.task_ref, options.preJson)
      const manifestRef = parseManifestRef(args.task_ref)
      const runSlurm = options.runJson?.['slurm']
      const runPartition = typeof runSlurm === 'object' && runSlurm !== null
        ? (runSlurm as Record<string, unknown>)['partition']
        : undefined
      // run_json 完整覆盖默认 run 配置；若提供它，实际 partition 也必须从其中投影。
      const partition = options.runJson !== undefined
        ? (typeof runPartition === 'string' && runPartition !== '' ? runPartition : undefined)
        : (args.partition !== undefined && args.partition !== '' ? args.partition : DEFAULT_GAUSSIAN_PARTITION)
      // 确认闸（D0 P2 / D2.1）：投影 → 比对 digest → 不匹配结构化拒绝且零集群副作用。
      // 降级开关 options.confirmation_gate='off'（应急回滚用）。
      const confirmationGate = asString(((args.options ?? {}) as Record<string, unknown>)['confirmation_gate']).trim()
      if (confirmationGate !== 'off') {
        const effectivePre = options.preJson ?? defaultPreJson()
        const effectiveRun = options.runJson ?? defaultRunJson(partition)
        const summary = summarizePre(effectivePre, effectiveRun)
        const digest = confirmationDigest(summary)
        if (String(args.confirmed_digest ?? '').trim() !== digest) {
          return [
            'CONFIRM_REQUIRED — no cluster side effects have occurred.',
            'Present the parameter summary below to the user VERBATIM (numbers must come from this projection, never re-typed), ' +
              'then after explicit approval re-call mat_gaussian with the same arguments plus confirmed_digest.',
            formatConfirmationSummary(summary, digest),
          ].join('\n')
        }
      }
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
      // R2 跃迁通知状态（本提交闭包私有）
      const queueNotice: { startedAt?: number; evaluated: boolean } = { evaluated: false }
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
            phase: 'queued', // R2：提交即入队——首次轮询前诚实显示"排队中"
          })
          return createGaussianProducerHooks({
          execCommand: (clusterId, command, timeoutSeconds) => producerClient.execCommand(clusterId, command, timeoutSeconds),
          clusterId: args.cluster_id,
          task: args.task.trim(),
          workdir: args.workdir.trim(),
          slurmJobId,
          // D0 P4 失败环：agent 侧签名索引（mat-db kb 表；库缺位/故障自动旁路=退回 grep 协议）
          diagnose: (errorText) => openMatDb()?.kbLookupByError(errorText) ?? [],
          ...options.workflowEnv !== undefined ? { workflowEnv: options.workflowEnv } : {},
          pollSeconds: options.pollSeconds ?? DEFAULT_PRODUCER_POLL_SECONDS,
          ...options.maxWaitSeconds !== undefined ? { maxWaitSeconds: options.maxWaitSeconds } : {},
          onTick: (states) => {
            try {
              const queuePhase = deriveQueuePhase(states)
              statusBoard.upsert(statusKey, {
                kind: 'mat-slurm', label: `gaussian ${args.task.trim()} @${args.cluster_id} #${slurmJobId}`,
                clusterId: args.cluster_id, ownerSession: exec.agent?.id,
                task: args.task.trim(), workdir: args.workdir.trim(),
                localWorkspace: reserveLocalWorkspace(args.cluster_id, slurmJobId), partition, slurm: statusSlurm(states),
                ...(queuePhase !== undefined ? { phase: queuePhase } : {}),
              })
            } catch { /* 状态板旁路故障不影响 producer */ }
            // R2 跃迁通知：PENDING→RUNNING 且排队 ≥60s → followup 推一条"已开始运行
            // （此前排队 Ns）"，消除长排队期的静默歧义；只推一次，短排队不打扰。
            try {
              const info = states.get(slurmJobId)
              if (info !== undefined && queueNotice.startedAt === undefined && info.state === 'PENDING') {
                queueNotice.startedAt = Date.now()
              }
              // 只在【首个 RUNNING 观察拍】评估一次阈值：长运行作业不得因运行时长
              // 跨过 60s 而误报"排队 60s"（评估即关闭，无论是否达到阈值）。
              if (
                info !== undefined
                && queueNotice.startedAt !== undefined
                && !queueNotice.evaluated
                && (info.state === 'RUNNING' || info.state === 'COMPLETING')
              ) {
                queueNotice.evaluated = true
                const queuedSeconds = Math.round((Date.now() - queueNotice.startedAt) / 1000)
                if (queuedSeconds >= 60) {
                  exec.agent?.followup(createUserMessage({
                    content: [{
                      type: 'text',
                      text: `background job update: gaussian ${args.task.trim()} slurm ${slurmJobId} started running on ${args.cluster_id} after ~${queuedSeconds}s in queue (PENDING → RUNNING). The completion notice still arrives separately at terminal state — no action needed, this is a queue-progress note only.`,
                    }],
                    source: {
                      kind: 'plugin',
                      plugin: 'mat-tools',
                      form: 'notice',
                      summary: `gaussian ${args.task.trim()} slurm ${slurmJobId} started running after ~${queuedSeconds}s in queue`,
                    },
                  }))
                }
              }
            } catch { /* 通知旁路：绝不影响 producer 主链 */ }
          },
          onResult: (result) => {
            settleBoard(statusBoard, statusKey, result, fileService)
            if (manifestRef !== undefined) snapshotProperties(manifestRef, result)
            // D0 P1 复用飞轮：结算自动入 mat-db（旁路故障不影响结算）
            recordProducerOutcomeToDb(openMatDb(), result, {
              task: args.task.trim(),
              workdir: args.workdir.trim(),
              jobId: slurmJobId,
              coreHours: estimateCoreHours(options.runJson ?? defaultRunJson(partition)),
            })
          },
          })
        },
      })
      return [
        `gaussian ${args.task.trim()} submitted on ${args.cluster_id}: slurm job ${slurmJobId} (workdir: ${args.workdir.trim()}).`,
        `background job ${id} registered — the post phase runs automatically at terminal state;`,
        'a completion notice will arrive in-session, then read properties/files with job_output.',
      ].join(' ')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_vasp',
    description:
      'One-stop VASP workflow on an HPC cluster: writes the structure file and a locally rendered slurm.sh, ' +
      'submits via sbatch, and returns immediately with the slurm job id and a background job id. The whole task ' +
      'chain (e.g. relax;scf;band) executes INSIDE the job through the home-deployed matstream env — input generation ' +
      '(INCAR/KPOINTS/POSCAR/POTCAR), the VASP runs, and post-processing all happen in-job; there is no login-node ' +
      'phase. The background producer polls sacct server-side (no model requests) and automatically harvests at ' +
      'terminal state — per-task energies (energy_per_task_eV), relax convergence, task_dirs, files and plot images ' +
      'are read with job_output after the in-session completion notice. HARD RULE: Slurm COMPLETED does NOT mean ' +
      'the physics converged — check the converged flag and probe lines (accuracy_marker_count / OSZICAR tails) ' +
      'before reporting success. Defaults: medium preset, nospin mode, kshcnormal partition, 1 node × 32 tasks, ' +
      '24h walltime. Load the vasp-calc skill for task-chain semantics, presets, and interpretation.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      tasks: {
        type: 'string', required: true,
        description: "Semicolon task chain, e.g. 'relax;scf;band'. Known tasks: relax, scf, band, relaxdftu, scfdftu, " +
          'banddftu, unfold, phonon, magmom, born, pdos, spincharge (semantics in the vasp-calc skill)',
      },
      structure: {
        type: 'string', required: true,
        description: 'Structure file content — POSCAR (VASP 5) preferred; ASE-readable cif/xyz accepted via structure_format',
      },
      structure_format: {
        type: 'string',
        description: "Structure format: 'poscar' (default), 'cif', or 'xyz' — selects the filename written on the cluster",
      },
      workdir: { type: 'string', required: true, description: 'Absolute remote working directory (created if absent)' },
      preset: { type: 'string', description: 'Precision preset: veryfast | fast | medium (default) | slow | veryslow' },
      mode: { type: 'string', description: 'Spin mode: nospin (default) | spin | soc' },
      partition: {
        type: 'string',
        description: "Slurm partition (default kshcnormal on cluster 11250). Billing-relevant — follow the user's explicit instruction.",
      },
      time: { type: 'string', description: "Walltime 'HH:MM:SS' or 'D-HH:MM:SS' (default 24:00:00; chain scale decides)" },
      options: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional passthrough: workflow_env, vasp_env (home deployment env script overrides), ' +
          'calculator_vasp_command (VASP launcher, default srun --mpi=pmi2 vasp_std), nodes, ' +
          'ntasks_per_node (defaults 1 × 32), poll_seconds (poll cap, min 10, default 120), max_wait_seconds (default 86400), ' +
          "confirmation_gate ('off' disables the digest confirmation gate — emergency/rollback use only)",
      },
      task_ref: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional budget gate: {portfolio_file, task_id} — same semantics as mat_gaussian ' +
          '(core-hour estimate derived from nodes × ntasks × walltime). Omit for standalone use.',
      },
      confirmed_digest: {
        type: 'string',
        description: 'Confirmation gate: sha256 digest of the effective parameter summary — same two-phase protocol ' +
          'as mat_gaussian (first call without it returns CONFIRM_REQUIRED plus the projection and digest, with NO ' +
          'cluster side effects; after explicit user approval re-call with the digest).',
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
      if (!args.tasks.trim() || !args.structure.trim() || !args.workdir.trim()) {
        throw new Error('tasks, structure and workdir must be non-empty')
      }
      // 链校验在任何闸/集群调用之前（fail-closed，零副作用）。
      const chain = validateVaspChain(args.tasks.trim())
      const tasks = chain.join(';')
      const formatRaw = asString(args.structure_format).trim().toLowerCase() || 'poscar'
      if (!['poscar', 'cif', 'xyz'].includes(formatRaw)) {
        throw new Error(`INVALID_VASP_STRUCTURE_FORMAT: '${formatRaw}' — use poscar | cif | xyz`)
      }
      const format = formatRaw as 'poscar' | 'cif' | 'xyz'
      const preset = asString(args.preset).trim().toLowerCase() || 'medium'
      if (!(VASP_PRESETS as readonly string[]).includes(preset)) {
        throw new Error(`INVALID_VASP_PRESET: '${preset}' — use ${VASP_PRESETS.join(' | ')}`)
      }
      const mode = asString(args.mode).trim().toLowerCase() || 'nospin'
      if (!(VASP_MODES as readonly string[]).includes(mode)) {
        throw new Error(`INVALID_VASP_MODE: '${mode}' — use ${VASP_MODES.join(' | ')}`)
      }
      const partition = asString(args.partition).trim() || DEFAULT_VASP_PARTITION
      const time = asString(args.time).trim() || DEFAULT_VASP_TIME
      if (parseVaspWalltimeHours(time) === null) {
        throw new Error(`INVALID_VASP_TIME: '${time}' — use HH:MM:SS or D-HH:MM:SS`)
      }
      const options = vaspOptions(args.options)
      assertEnvGate(args.cluster_id, 'vasp')
      assertPhaseGate(args.task_ref)
      const nodes = options.nodes ?? DEFAULT_VASP_NODES
      const ntasksPerNode = options.ntasksPerNode ?? DEFAULT_VASP_NTASKS_PER_NODE
      // 确认闸投影（D0 P2 / D2.1 同款）：投影 → 比对 digest → 不匹配结构化拒绝且零集群副作用。
      const summary = summarizeVaspPre({ tasks, preset, mode, partition, nodes, ntasksPerNode, time })
      const digest = vaspConfirmationDigest(summary)
      // 预算闸：vasp 无 pre_json，核时按 walltime 推导覆盖分钟级启发式。
      const budgetGate = summary.estimatedCoreHours !== null
        ? openBudgetGate(args.task_ref, undefined, { estimatedCoreHours: summary.estimatedCoreHours })
        : openBudgetGate(args.task_ref, { resources: { ncores: nodes * ntasksPerNode } })
      const manifestRef = parseManifestRef(args.task_ref)
      const confirmationGate = asString(((args.options ?? {}) as Record<string, unknown>)['confirmation_gate']).trim()
      if (confirmationGate !== 'off') {
        if (String(args.confirmed_digest ?? '').trim() !== digest) {
          return [
            'CONFIRM_REQUIRED — no cluster side effects have occurred.',
            'Present the parameter summary below to the user VERBATIM (numbers must come from this projection, never re-typed), ' +
              'then after explicit approval re-call mat_vasp with the same arguments plus confirmed_digest.',
            formatVaspConfirmationSummary(summary, digest),
          ].join('\n')
        }
      }
      // 同步段：独立客户端（prepare/sbatch 两段往返——整链在作业内执行，无登录节点阶段）
      const syncClient = newWatchClient()
      const adapter: RemoteWorkflowAdapter = createLegacyVaspWorkflowAdapter({
        execute: async (request) => {
          const structure = request.inputs['structure']
          if (typeof structure !== 'string') throw new Error('VASP workflow request requires structure input')
          const result = await runVaspSync({
            execCommand: (clusterId, command, timeoutSeconds) => syncClient.execCommand(clusterId, command, timeoutSeconds),
            clusterId: request.clusterId,
            tasks: String(request.inputs['tasks'] ?? tasks),
            structure,
            structureFilename: String(request.inputs['structure_filename'] ?? vaspStructureFilename(format)),
            workdir: request.workdir,
            partition,
            ...(time !== DEFAULT_VASP_TIME ? { time } : {}),
            preset,
            mode,
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
          tasks, structure: args.structure,
          structure_filename: vaspStructureFilename(format),
          preset, mode,
        },
        requestedOutputs: ['properties', 'artifact_manifest'],
      })
      const { executionId: slurmJobId } = await adapter.run(request)
      budgetGate?.record(slurmJobId)
      if (manifestRef !== undefined) recordWorkdir(manifestRef, args.workdir.trim())
      // producer：再一个独立客户端（终态后自动收割，与同步段/前台隔离）
      const producerClient = newWatchClient()
      const statusKey = `${args.cluster_id}:${slurmJobId}`
      // R2 跃迁通知状态（本提交闭包私有）
      const queueNotice: { startedAt?: number; evaluated: boolean } = { evaluated: false }
      const id = jobs.start({
        kind: 'mat-slurm',
        label: `vasp ${tasks} @${args.cluster_id} #${slurmJobId}`,
        outputLimitBytes: 8_192,
        ...exec.agent ? { owner: exec.agent } : {},
        run: () => {
          statusBoard.upsert(statusKey, {
            kind: 'mat-slurm', label: `vasp ${tasks} @${args.cluster_id} #${slurmJobId}`,
            clusterId: args.cluster_id, ownerSession: exec.agent?.id,
            task: tasks, workdir: args.workdir.trim(),
            localWorkspace: reserveLocalWorkspace(args.cluster_id, slurmJobId), partition,
            phase: 'queued',
          })
          return createVaspProducerHooks({
          execCommand: (clusterId, command, timeoutSeconds) => producerClient.execCommand(clusterId, command, timeoutSeconds),
          clusterId: args.cluster_id,
          tasks,
          workdir: args.workdir.trim(),
          slurmJobId,
          diagnose: (errorText) => openMatDb()?.kbLookupByError(errorText) ?? [],
          pollSeconds: options.pollSeconds ?? DEFAULT_VASP_POLL_SECONDS,
          ...options.maxWaitSeconds !== undefined ? { maxWaitSeconds: options.maxWaitSeconds } : {},
          onTick: (states) => {
            try {
              const queuePhase = deriveQueuePhase(states)
              statusBoard.upsert(statusKey, {
                kind: 'mat-slurm', label: `vasp ${tasks} @${args.cluster_id} #${slurmJobId}`,
                clusterId: args.cluster_id, ownerSession: exec.agent?.id,
                task: tasks, workdir: args.workdir.trim(),
                localWorkspace: reserveLocalWorkspace(args.cluster_id, slurmJobId), partition, slurm: statusSlurm(states),
                ...(queuePhase !== undefined ? { phase: queuePhase } : {}),
              })
            } catch { /* 状态板旁路故障不影响 producer */ }
            try {
              const info = states.get(slurmJobId)
              if (info !== undefined && queueNotice.startedAt === undefined && info.state === 'PENDING') {
                queueNotice.startedAt = Date.now()
              }
              if (
                info !== undefined
                && queueNotice.startedAt !== undefined
                && !queueNotice.evaluated
                && (info.state === 'RUNNING' || info.state === 'COMPLETING')
              ) {
                queueNotice.evaluated = true
                const queuedSeconds = Math.round((Date.now() - queueNotice.startedAt) / 1000)
                if (queuedSeconds >= 60) {
                  exec.agent?.followup(createUserMessage({
                    content: [{
                      type: 'text',
                      text: `background job update: vasp ${tasks} slurm ${slurmJobId} started running on ${args.cluster_id} after ~${queuedSeconds}s in queue (PENDING → RUNNING). The completion notice still arrives separately at terminal state — no action needed, this is a queue-progress note only.`,
                    }],
                    source: {
                      kind: 'plugin',
                      plugin: 'mat-tools',
                      form: 'notice',
                      summary: `vasp ${tasks} slurm ${slurmJobId} started running after ~${queuedSeconds}s in queue`,
                    },
                  }))
                }
              }
            } catch { /* 通知旁路：绝不影响 producer 主链 */ }
          },
          onResult: (result) => {
            settleBoard(statusBoard, statusKey, result, fileService)
            if (manifestRef !== undefined) snapshotProperties(manifestRef, result)
            recordProducerOutcomeToDb(openMatDb(), result, {
              task: tasks,
              workdir: args.workdir.trim(),
              jobId: slurmJobId,
              preset,
              coreHours: summary.estimatedCoreHours,
            })
          },
          })
        },
      })
      return [
        `vasp ${tasks} submitted on ${args.cluster_id}: slurm job ${slurmJobId} (workdir: ${args.workdir.trim()}).`,
        `background job ${id} registered — the chain runs in-job; the producer harvests results automatically at terminal state;`,
        'a completion notice will arrive in-session, then read energies/convergence/files with job_output ' +
        '(Slurm COMPLETED does NOT imply physical convergence — check the converged flag).',
      ].join(' ')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_db_query',
    description:
      'Query the local cross-session results memory (mat.db; auto-recorded from every mat_gaussian settlement). ' +
      'Two modes: (a) past results — pass structure (remote workdir basename, e.g. "h2o-m2-probe") with optional ' +
      'task filter (e.g. "opt", "opt+freq", "ts+irc") and limit; (b) knowledge-base lookup — pass kb_error with raw ' +
      'error text to match gaussian-calc KB signature entries (returns kb:<id> + references path). ' +
      'Local-only: no cluster access, no side effects.',
    parameters: {
      structure: { type: 'string', description: 'Structure label = remote workdir basename to look up' },
      task: { type: 'string', description: 'Optional task filter, e.g. opt / opt+freq / ts+irc' },
      kb_error: { type: 'string', description: 'Raw error text for KB signature lookup (disables results mode)' },
      limit: { type: 'string', description: 'Max rows for results mode (default 10)' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const db = openMatDb()
      if (db === undefined) {
        return 'mat-db unavailable (open failed) — results memory disabled; continue without it.'
      }
      const kbError = String(args.kb_error ?? '').trim()
      if (kbError !== '') {
        const hits = db.kbLookupByError(kbError)
        return hits.length > 0
          ? `KB signature hits (${hits.length}):\n${formatDbKbLines(hits)}\nRead the entry file for the prescription ladder.`
          : 'No KB entry matched the error text. Fall back to the references/ grep protocol (INDEX.md).'
      }
      const structure = String(args.structure ?? '').trim()
      if (structure === '') {
        return 'Provide structure (workdir basename) for results mode, or kb_error for knowledge-base lookup.'
      }
      const task = String(args.task ?? '').trim()
      const parsedLimit = Number.parseInt(String(args.limit ?? ''), 10)
      const rows = db.queryPastResults({
        structure,
        ...(task !== '' ? { task } : {}),
        ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
      })
      return rows.length > 0
        ? `Recorded results for "${structure}"${task !== '' ? ` task=${task}` : ''} (${rows.length}, newest first):\n${formatDbResultLines(rows)}`
        : `No recorded results for "${structure}"${task !== '' ? ` task=${task}` : ''} — no history in mat.db; proceed with a new calculation.`
    },
  }))

  // R9b：反应能学对账——把「算完之后的科学结论」从模型的字符串拼接里取出
  ctx.tools.register(defineTool({
    name: 'mat_reaction_energy',
    description:
      'Compute reaction energetics (activation barrier ΔG‡, reaction energy ΔG, reverse barrier) from results ' +
      'already recorded in mat.db — do NOT do this arithmetic yourself. Pass the structure labels (remote workdir ' +
      'basenames) of the reactant, the transition state and/or the product. The tool picks the highest energy basis ' +
      'available for ALL species consistently (Gibbs free energy > enthalpy > electronic), converts Hartree to ' +
      'kcal/mol, and returns the raw Hartree values for audit. It also warns when: thermochemistry is missing (so the ' +
      'number is NOT a free-energy barrier), a species is unconverged, or the TS lies below an end point (mismatched ' +
      'species or not a real saddle). Report every warning to the user verbatim. Local-only, no cluster access.',
    parameters: {
      reactant: { type: 'string', description: 'Structure label of the reactant (required for any relative energy)' },
      ts: { type: 'string', description: 'Structure label of the transition state (for the activation barrier)' },
      product: { type: 'string', description: 'Structure label of the product (for the reaction energy)' },
      task: { type: 'string', description: 'Optional task filter when a label has several results, e.g. opt+freq' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const db = openMatDb()
      if (db === undefined) {
        return 'mat-db unavailable (open failed) — cannot compute reaction energetics without recorded results.'
      }
      const task = String(args.task ?? '').trim()
      /** 取该 label 最新一条（可选 task 过滤）的能量投影。 */
      const load = (rawLabel: unknown): SpeciesEnergies | undefined => {
        const label = String(rawLabel ?? '').trim()
        if (label === '') return undefined
        const rows = db.queryPastResults({ structure: label, ...(task !== '' ? { task } : {}), limit: 1 })
        const row = rows[0]
        if (row === undefined) {
          return {
            label, energyHartree: null, sumElectronicFreeEnergyHartree: null,
            sumElectronicEnthalpyHartree: null, converged: null,
          }
        }
        return {
          label,
          energyHartree: row.energy,
          sumElectronicFreeEnergyHartree: row.sumElectronicFreeEnergy,
          sumElectronicEnthalpyHartree: row.sumElectronicEnthalpy,
          converged: row.converged,
        }
      }
      const reactant = load(args.reactant)
      const ts = load(args.ts)
      const product = load(args.product)
      if (reactant === undefined && ts === undefined && product === undefined) {
        return 'Provide at least one of reactant / ts / product (structure labels = remote workdir basenames).'
      }
      const missing = [reactant, ts, product]
        .filter((s): s is SpeciesEnergies => s !== undefined)
        .filter((s) => s.energyHartree === null && s.sumElectronicFreeEnergyHartree === null)
        .map((s) => s.label)
      const result = computeReactionEnergy({
        ...(reactant !== undefined ? { reactant } : {}),
        ...(ts !== undefined ? { ts } : {}),
        ...(product !== undefined ? { product } : {}),
      })
      const header = [
        `species: reactant=${reactant?.label ?? '—'} ts=${ts?.label ?? '—'} product=${product?.label ?? '—'}` +
          `${task !== '' ? ` (task=${task})` : ''}`,
        ...(missing.length > 0
          ? [`NO RECORDED RESULTS for: ${missing.join(', ')} — run the calculation (or check the label spelling) first.`]
          : []),
        '',
      ]
      return [...header, formatReactionEnergy(result)].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_db_dead_letter',
    description:
      'Mark a recorded run as dead-lettered in the local results memory (mat.db): the failure-loop terminal for ' +
      'unknown errors (no KB entry) or exhausted prescription ladders — no-workaround principle, do NOT keep ' +
      'resubmitting. Call after the diagnosis concludes that retrying is futile; the record keeps the reason and ' +
      'kb reference for the human report. Local-only, no cluster access.',
    parameters: {
      job_id: { type: 'string', required: true, description: 'Slurm job id of the failed run (as recorded at settlement)' },
      reason: { type: 'string', required: true, description: 'Why retrying is futile, e.g. "no-kb-entry" or "ladder-exhausted: kb:ts-step-limit"' },
      kb_id: { type: 'string', description: 'Optional kb entry id if the dead letter relates to a known KB diagnosis' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const db = openMatDb()
      if (db === undefined) {
        return 'mat-db unavailable (open failed) — dead-letter bookkeeping disabled; report the reason to the user directly.'
      }
      const r = db.markDeadLetter(
        String(args.job_id ?? '').trim(),
        String(args.reason ?? '').trim(),
        String(args.kb_id ?? '').trim() || undefined,
      )
      if (!r.ok) {
        return `DEAD_LETTER_REJECTED: ${r.reason}`
      }
      return `dead-lettered job ${String(args.job_id).trim()} (reason: ${String(args.reason).trim()}) — recorded in mat.db; stop resubmitting and report to the user.`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_task_build',
    description:
      'Compile a structured goal (aimater.goal.v1) into an executable Gaussian task package ' +
      '(aimater.taskpackage.v1): wave DAG with per-wave pre.json/run.json/post.json, a projected parameter ' +
      'summary with digest, and an execution runbook (one-stop via mat_gaussian, or stepwise multi-wave chain). ' +
      'Local deterministic compiler — no LLM, no cluster side effects. Returns NEEDS_CLARIFICATION with blocking ' +
      'questions (missing structure/partition/odd-electron mult), INVALID_GOAL with fix hints, or TASK_PACKAGE_READY ' +
      'with the summary to confirm verbatim and the runbook to execute after user approval. Past converged results ' +
      'in mat.db are consulted automatically (reuse flywheel).',
    parameters: {
      goal_json: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description:
          'goal object (aimater.goal.v1): {schema_version:"aimater.goal.v1", structure:{label,xyz,source}, ' +
          'intent:{want:[...13 intent verbs]}, method:{method,basis,route_kwargs}, charge, mult, accuracy, ' +
          'resources:{partition,max_core_hours,ncores,memory,walltime}, context}. Route keys in route_kwargs are ' +
          'only allowed inside the task own route set (opt/freq/opt+freq/tddft/irc/polar).',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const goal = args.goal_json as unknown as Goal
      const db = openMatDb()
      const deps: PlanningDeps = db === undefined ? {} : {
        past: (label, task) => db.queryPastResults({ structure: label, task })
          .map((r) => ({ task: r.task, converged: r.converged, energy: r.energy, artifactsPath: r.artifactsPath })),
      }
      const result = compileTaskPackage(goal, deps)
      // R4：ready 的编译产物按 digest 落盘，供 mat_sbatch 波间门读取（幂等覆盖）
      if (result.pkg !== undefined && result.pkg.digest !== '') {
        try {
          persistTaskPackage(result.pkg)
        } catch (error) {
          console.error(`[task-packages] persist failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return formatTaskPackage(result, goal.resources?.max_core_hours)
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

  // ------------------------------------------------------------------
  // pipeline（审阅表 R6a 一期）：多波链的代码循环（插件 A pipeline 单链形态）
  // ------------------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'mat_pipeline_start',
    description:
      'Start a code-driven pipeline that runs a compiled multi-wave chain (e.g. tsxtb+ts+irc) end-to-end: per wave ' +
      'run→sbatch→watch→post→inter-wave gate, automatic attempts bookkeeping, R5 prescription ladder driving retries, ' +
      'dead-letter on ladder exhaustion, and needs_llm halt (waking the session) for ambiguous failures or gate misses — ' +
      'the only LLM diagnosis seat in the loop. PREREQUISITES: mat_task_build ran for this digest (runbook steps 1-4 ' +
      'done: user confirmation, inputs on remote, pre phase executed). One-stop single-wave tasks should use mat_gaussian instead.',
    parameters: {
      pkg_digest: {
        type: 'string', required: true,
        description: 'Task package digest from mat_task_build (waves + gates are read from it, never re-typed)',
      },
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      workdir: { type: 'string', required: true, description: 'Absolute {work_dir} root on the cluster (molecule.xyz / three JSONs already there)' },
      max_wait_seconds: {
        type: 'number',
        description: 'Per-wave watch window in seconds (default 1800). This is how long the driver WATCHES, not a ' +
          'job time limit: when it elapses the chain parks at watch_expired with the job still running on the cluster, ' +
          'and you resume with action=rewatch (same job, never resubmit). Raise it for busy partitions where queueing ' +
          'alone can exceed 30 min.',
      },
      scf_trend: {
        type: 'boolean',
        description: 'SCF convergence monitoring per wave job (default TRUE): samples SCF energies every ~60s, wakes the ' +
          'session only on CONFIRMED anomalies (oscillation/divergence, or a stall approaching the TimeLimit). Set false to disable.',
      },
      scf_sample_seconds: {
        type: 'number',
        description: 'SCF sampling window in seconds (min 5; default 60). Lower it (e.g. 10-15) when waves are short-lived: ' +
          'anomaly confirmation needs two consecutive windows.',
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
      const pkg = loadPersistedPackage(taskPackagesDir(), args.pkg_digest.trim())
      // 通道闸（正向）：execution.mode 是通道归属的权威（compileTaskPackage 按
      // isStepwiseTask 算出），波数是它的同源佐证。两者都查——它们是同一事实的
      // 两种表示，不一致即产物损坏（手搓 fixture、旧版编译产物），此时宁可拒绝
      // 也不猜哪个为准：一条只有一波却声称 stepwise 的链进了 driver，会以
      // 「单波跑完即完成」静默通过，看起来成功而实际根本没执行这条链。
      const modeSaysStepwise = pkg.execution.mode === 'stepwise'
      const wavesSayStepwise = pkg.waves.length >= 2
      if (!modeSaysStepwise || !wavesSayStepwise) {
        const disagree = modeSaysStepwise !== wavesSayStepwise
        throw new Error(
          `WRONG_CHANNEL: ${pkg.task} is not a drivable stepwise chain ` +
          `(execution.mode=${pkg.execution.mode}, ${pkg.waves.length} wave(s)) — ` +
          (disagree
            ? 'and those two disagree, so the package is inconsistent: recompile it with mat_task_build ' +
              'rather than trusting either side. '
            : '') +
          'pipeline drives stepwise multi-wave chains only; submit one-stop packages with mat_gaussian instead.',
        )
      }
      assertEnvGate(args.cluster_id)
      const workdir = args.workdir.trim().replace(/\/+$/, '')
      // pipelineId 必须同时含 digest 与 workdir 指纹。
      //
      // digest 只投影「参数摘要」（method/basis/charge/mult/资源/slurm），结构坐标
      // 完全不参与——批量场景下 10 个不同反应若共用同一套泛函基组与资源档（常态），
      // 10 个 digest 逐位相同。若 id 只取 digest 前 12 位，第二条链会撞上
      // 「already exists」而无法启动，而它们本是完全不同的计算。
      // workdir 是每条链事实上的身份（molecule.xyz / 三 JSON / result.json 都在其下），
      // 故取 workdir 指纹入 id。
      const pipelineId = `pl-${args.pkg_digest.trim().slice(0, 12)}-${createHash('sha256').update(workdir).digest('hex').slice(0, 8)}`
      const path = pipelinePath(pipelineId)
      if (existsSync(path)) {
        const existing = readPipeline(pipelineId)
        if (!isTerminalPhase(existing.phase)) {
          throw new Error(`pipeline ${pipelineId} already exists in phase ${existing.phase} — use mat_pipeline_resume (rewatch/adopt/resubmit) instead of starting a duplicate`)
        }
        throw new Error(`pipeline ${pipelineId} already finished (${existing.phase}) — start a fresh chain only with a newly compiled digest`)
      }
      // workdir 唯一性：同一 workdir 上并发两条链会相互覆写 pre.json（处方换档
      // 是整体覆写），且两条链的 result.json 会互相污染门检。拒绝而非警告。
      const clash = findLivePipelineOnWorkdir(pipelinesDir(), workdir, pipelineId)
      if (clash !== undefined) {
        throw new Error(
          `WORKDIR_BUSY: ${workdir} is already used by live pipeline ${clash.pipelineId} (phase ${clash.phase}, ${clash.task}) — ` +
          'two chains on one workdir would overwrite each other\'s pre.json and result.json. Use a separate workdir per chain.',
        )
      }
      const state = createPipelineState({
        pipelineId, clusterId: args.cluster_id, workdir, pkg,
      })
      persistPipeline(state)
      const driverClient = newWatchClient()
      const agent = exec.agent
      jobs.start({
        kind: 'mat-pipeline',
        label: `pipeline ${pkg.task} @${args.cluster_id}`,
        ...agent !== undefined ? { owner: agent } : {},
        run: () => pipelineJobHooks(createPipelineDriverHooks({
          state, pkg,
          execCommand: (clusterId, command, timeoutSeconds) => driverClient.execCommand(clusterId, command, timeoutSeconds),
          ...(typeof args.max_wait_seconds === 'number' ? { maxWaitSeconds: args.max_wait_seconds } : {}),
          // SCF 收敛监控默认开(纯观测,异常确认才唤醒;scf_trend=false 关闭)
          scfTrend: args.scf_trend === false ? undefined
            : (typeof args.scf_sample_seconds === 'number'
              ? { intervalMs: Math.max(5, args.scf_sample_seconds) * 1_000 }
              : true),
          diagnose: (errorText) => openMatDb()?.kbLookupByError(errorText) ?? [],
          markDeadLetter: (jobId, reason, kbId) => {
            openMatDb()?.markDeadLetter(jobId, reason, kbId)
          },
          persist: persistPipeline,
          // 门检数据源与 mat_sbatch 工具层同源：直读远端 result.json，
          // 不再依赖 producer 内存 properties（消除双轨不一致）。
          readResultJson: async () => JSON.parse(outputText(await driverClient.execCommand(
            state.clusterId, `cat "${state.workdir}/result.json"`, 30,
          ))),
          // R8b：IRC 方向门的数据源（irc_profile CSV 是权威绘图数据）
          readCsvFile: async (path: string) => outputText(await driverClient.execCommand(
            state.clusterId, `cat "${path}"`, 30,
          )),
          notify: pipelineNotify(agent),
        })),
      })
      return [
        `pipeline ${pipelineId} started: ${pkg.task} ${pkg.waves.length} waves @${args.cluster_id} (${args.workdir.trim()})`,
        'The loop is now code-driven (submit→watch→post→gate per wave; prescription ladder auto-retry; dead-letter on exhaustion).',
        'You will be woken on completion / needs_llm / dead_letter. Track anytime with mat_pipeline_status.',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_pipeline_status',
    description:
      'Read the externalized state (pipelines/<id>.json) of a pipeline started with mat_pipeline_start: phase, ' +
      'per-wave attempts/jobs/prescription rungs, needs_llm reason, dead-letter reason, recent history. Local-only.',
    parameters: {
      pipeline_id: { type: 'string', required: true, description: 'Pipeline id returned by mat_pipeline_start (pl-<digest12>)' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const state = readPipeline(args.pipeline_id.trim())
      return renderPipelineStatus(state)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_pipeline_resume',
    description:
      'Resume a halted or stale pipeline. Actions: ' +
      "'retry' (needs_llm: after LLM diagnosis, with the route you concluded — pre.json route key gets overwritten and the wave re-renders; " +
      'refused once attempt reaches maxAttemptsPerWave, use dead_letter then), ' +
      "'dead_letter' (needs_llm: diagnosis says retrying is futile; recorded with your reason and into the dead-letter DB), " +
      "'rewatch' (wave_submitted or watch_expired: reattach monitoring to the in-flight job, same job id, NO resubmission — " +
      'covers chains parked because the watch window elapsed while the job was still queued/running), ' +
      "'adopt' (submitting / UNRESOLVED SUBMIT: you checked the cluster (squeue/sacct) and a job from that submit intent exists — hand over its job_id), " +
      "'resubmit' (submitting / UNRESOLVED SUBMIT: you confirmed no such job exists — clear the intent and go back to planned/retrying).",
    parameters: {
      pipeline_id: { type: 'string', required: true, description: 'Pipeline id returned by mat_pipeline_start' },
      action: { type: 'string', required: true, description: 'One of: retry | dead_letter | rewatch | adopt | resubmit' },
      route: { type: 'string', description: 'For action=retry: the full route string to apply, e.g. irc(CalcFC,Steep,MaxPoints=50,StepSize=5)' },
      reason: { type: 'string', description: 'For action=dead_letter (and optional retry/resubmit detail): why' },
      job_id: { type: 'string', description: 'For action=adopt: the Slurm job id you found on the cluster for the pending submit intent' },
      max_wait_seconds: {
        type: 'number',
        description: 'Per-wave watch window in seconds (default 1800). Raise it when the chain paused because the ' +
          'watch window elapsed while the job was still queued — otherwise rewatch will time out the same way.',
      },
      scf_trend: {
        type: 'boolean',
        description: 'SCF convergence monitoring for the resumed driver (default TRUE).',
      },
      scf_sample_seconds: {
        type: 'number',
        description: 'SCF sampling window in seconds (min 5; default 60).',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const jobs = ctx.get('jobs')
      const action = args.action.trim()
      let state = readPipeline(args.pipeline_id.trim())
      if (isTerminalPhase(state.phase)) {
        throw new Error(`pipeline ${state.pipelineId} is terminal (${state.phase}) — nothing to resume`)
      }
      const override =
        action === 'retry'
          ? (() => {
              if (args.route === undefined || args.route.trim() === '') {
                throw new Error('action=retry requires route (the diagnosis-concluded route string)')
              }
              return { action: 'retry' as const, route: args.route.trim(), ...(args.reason !== undefined ? { detail: args.reason } : {}) }
            })()
          : action === 'dead_letter'
            ? (() => {
                if (args.reason === undefined || args.reason.trim() === '') {
                  throw new Error('action=dead_letter requires reason')
                }
                return { action: 'dead_letter' as const, reason: args.reason.trim() }
              })()
            : action === 'adopt'
              ? (() => {
                  if (args.job_id === undefined || args.job_id.trim() === '') {
                    throw new Error('action=adopt requires job_id (the cluster job you verified for the pending submit intent)')
                  }
                  return { action: 'adopt' as const, jobId: args.job_id.trim(), ...(args.reason !== undefined ? { detail: args.reason } : {}) }
                })()
              : action === 'resubmit'
                ? { action: 'resubmit' as const, ...(args.reason !== undefined ? { detail: args.reason } : {}) }
                : action === 'rewatch'
                  ? { action: 'rewatch' as const }
                  : (() => {
                      throw new Error(`unknown action '${action}' — expected retry | dead_letter | rewatch | adopt | resubmit`)
                    })()
      state = resumePipeline(state, override)
      persistPipeline(state)
      if (isTerminalPhase(state.phase)) {
        // 死信落库（driver 不在场，resume 面补记；库缺位旁路）
        const jobId = state.waves.find((w) => w.waveId === state.currentWaveId)?.jobId
        if (jobId !== undefined) openMatDb()?.markDeadLetter(jobId, state.deadLetter?.reason ?? 'dead-lettered at resume')
        return `pipeline ${state.pipelineId} dead-lettered (${state.deadLetter?.reason}) — stop resubmitting and report to the user.`
      }
      if (jobs === undefined) {
        throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
      }
      const pkg = loadPersistedPackage(taskPackagesDir(), state.pkgDigest)
      const driverClient = newWatchClient()
      const agent = exec.agent
      jobs.start({
        kind: 'mat-pipeline',
        label: `pipeline ${pkg.task} @${state.clusterId} (resume ${action})`,
        ...agent !== undefined ? { owner: agent } : {},
        run: () => pipelineJobHooks(createPipelineDriverHooks({
          state, pkg,
          execCommand: (clusterId, command, timeoutSeconds) => driverClient.execCommand(clusterId, command, timeoutSeconds),
          ...(typeof args.max_wait_seconds === 'number' ? { maxWaitSeconds: args.max_wait_seconds } : {}),
          scfTrend: args.scf_trend === false ? undefined
            : (typeof args.scf_sample_seconds === 'number'
              ? { intervalMs: Math.max(5, args.scf_sample_seconds) * 1_000 }
              : true),
          diagnose: (errorText) => openMatDb()?.kbLookupByError(errorText) ?? [],
          markDeadLetter: (jobId2, reason, kbId) => {
            openMatDb()?.markDeadLetter(jobId2, reason, kbId)
          },
          persist: persistPipeline,
          // 门检数据源与 mat_sbatch 工具层同源：直读远端 result.json，
          // 不再依赖 producer 内存 properties（消除双轨不一致）。
          readResultJson: async () => JSON.parse(outputText(await driverClient.execCommand(
            state.clusterId, `cat "${state.workdir}/result.json"`, 30,
          ))),
          // R8b：IRC 方向门的数据源（irc_profile CSV 是权威绘图数据）
          readCsvFile: async (path: string) => outputText(await driverClient.execCommand(
            state.clusterId, `cat "${path}"`, 30,
          )),
          notify: pipelineNotify(agent),
        })),
      })
      return `pipeline ${state.pipelineId} resumed (${action}) — phase ${state.phase}.\n${renderPipelineStatus(state)}`
    },
  }))

  // ------------------------------------------------------------------
  // pool（审阅表 R6b）：批量任务池——N 条链 + 并发上限 + 回填，shepherd 的替代通道
  // ------------------------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'mat_pool_start',
    description:
      'Start a batch pool of multi-wave chains (e.g. N reactions each tsxtb+ts+irc): admits chains up to a ' +
      'concurrency cap, backfills as they settle (done / halted / dead-lettered), and wakes the session per chain ' +
      'outcome and at pool drain. Per-chain machinery is the single-chain pipeline (gates, attempts ledger, ' +
      'prescription ladder, dead-letter). PREREQ per chain: mat_task_build ran for the digest and runbook steps ' +
      'up to pre are done. Pass task_ref per chain ({portfolio_file, task_id}) to enforce the phase gate and the ' +
      'budget gate on every wave submission (recommended — batch discipline).',
    parameters: {
      pool_id: { type: 'string', description: 'Optional pool id (default pool-<timestamp36>)' },
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250' },
      chains: {
        type: 'array', required: true,
        items: { type: 'object', additionalProperties: true },
        description: 'Array of {pkg_digest, workdir, task_ref?} — one entry per chain; workdir is the absolute {work_dir} root',
      },
      max_concurrent: {
        type: 'number',
        description: 'Concurrency cap (default 2). Note that all remote commands for one (credential, cluster) are ' +
          'serialized by the exec gate, so raising this does not scale throughput linearly — chains spend most of ' +
          'their time polling sacct rather than issuing commands, which is where the real parallelism comes from.',
      },
      max_wait_seconds: {
        type: 'number',
        description: 'Per-wave watch window in seconds (default 14400 = 4h for pools; single-chain pipelines use ' +
          '1800). How long a chain WATCHES a wave, not a job time limit: when it elapses the chain parks in ' +
          'watch_expired with its job still queued/running — monitoring is re-attached with action=rewatch ' +
          '(auto re-armed up to auto_rewatch_limit times first). Never resubmit a watched job.',
      },
      auto_rewatch_limit: {
        type: 'number',
        description: 'Auto re-arm budget per wave when a watch window elapses (default 2): the driver re-attaches ' +
          'monitoring to the SAME job this many times before parking the chain for the session. 0 = park on first ' +
          'expiry. The budget persists across restarts (watchExpiries on the wave).',
      },
      poll_seconds: {
        type: 'number',
        description: 'Optional cap on the per-chain poll interval in seconds (min 10; default event-aware adaptive 10-300s).',
      },
      scf_trend: {
        type: 'boolean',
        description: 'SCF convergence monitoring per chain (default TRUE): samples each wave job\'s SCF energies every ~60s, ' +
          'classifies the trend, and wakes the session only on CONFIRMED anomalies (oscillation/divergence, or a stall ' +
          'approaching the TimeLimit) — early warning that a wave will burn its walltime for nothing. Set false to disable.',
      },
      scf_sample_seconds: {
        type: 'number',
        description: 'SCF sampling window in seconds (min 5; default 60). Lower it when wave jobs are short-lived.',
      },
      notify_on: {
        type: 'string',
        description: "Per-chain wake policy (default 'actionable'): only needs_llm/dead_lettered chain outcomes wake the " +
          "session; completed chains stay silent until the pool drain summary (progress is always readable via " +
          "mat_pool_status). Set 'all' to be woken per chain outcome like before.",
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
      const rawChains = Array.isArray(args.chains) ? args.chains : []
      if (rawChains.length === 0) throw new Error('chains must be a non-empty array of {pkg_digest, workdir}')
      assertEnvGate(args.cluster_id)
      const specs: Array<{ workdir: string; pkgDigest: string; taskRef?: { portfolio_file: string; task_id: string } }> = []
      for (const raw of rawChains) {
        const o = raw as Record<string, unknown>
        const workdir = typeof o.workdir === 'string' ? o.workdir.trim() : ''
        const pkgDigest = typeof o.pkg_digest === 'string' ? o.pkg_digest.trim() : ''
        if (workdir === '' || pkgDigest === '') throw new Error('each chain requires non-empty pkg_digest and workdir')
        // 提前校验编译产物与 task_ref 形状（快失败，零集群副作用）
        const chainPkg = loadPersistedPackage(taskPackagesDir(), pkgDigest)
        // 通道闸：池的每条链都由单链 pipeline 驱动，故同一判据同一口径（mode ∧ 波数）
        if (chainPkg.execution.mode !== 'stepwise' || chainPkg.waves.length < 2) {
          throw new Error(
            `WRONG_CHANNEL: chain ${pkgDigest.slice(0, 12)} (${chainPkg.task}) is not a drivable stepwise chain ` +
            `(execution.mode=${chainPkg.execution.mode}, ${chainPkg.waves.length} wave(s)) — ` +
            'the pool drives stepwise multi-wave chains only; submit single-wave tasks with mat_gaussian.',
          )
        }
        if (o.task_ref !== undefined) {
          if (parseBudgetTaskRef(o.task_ref) === undefined) {
            throw new Error('chain task_ref must be {portfolio_file, task_id}')
          }
          specs.push({ workdir, pkgDigest, taskRef: o.task_ref as { portfolio_file: string; task_id: string } })
        } else {
          specs.push({ workdir, pkgDigest })
        }
      }
      // workdir 唯一性（与 mat_pipeline_start 同款硬约束，此前池侧完全缺失）。
      // 同一 workdir 上并发两条链必然互相污染：处方换档是 pre.json 整体覆写，
      // 且两条链共享同一个 result.json——门检会读到对方的收敛数据，产出「看起来
      // 通过、实际是别人结果」的静默错误。批量场景 workdir 是手写/粘贴出来的，
      // 填重一个字母就中招，故必须在提交前查。两类冲突都查：
      //   ① 批内互撞（本次 chains 数组里重复）；
      //   ② 撞在场活链（别的 pipeline/pool 正占用该 workdir）。
      const seenWorkdirs = new Map<string, number>()
      for (const [i, s] of specs.entries()) {
        const normalized = s.workdir.replace(/\/+$/, '')
        const prior = seenWorkdirs.get(normalized)
        if (prior !== undefined) {
          throw new Error(
            `WORKDIR_BUSY: chains #${prior + 1} and #${i + 1} share workdir ${normalized} — ` +
            'two chains on one workdir overwrite each other\'s pre.json and share one result.json, ' +
            'so the inter-wave gate would read the other chain\'s data. Give every chain its own workdir.',
          )
        }
        seenWorkdirs.set(normalized, i)
        const clash = findLivePipelineOnWorkdir(pipelinesDir(), normalized, '')
        if (clash !== undefined) {
          throw new Error(
            `WORKDIR_BUSY: chain #${i + 1} workdir ${normalized} is already used by live pipeline ` +
            `${clash.pipelineId} (phase ${clash.phase}, ${clash.task}) — pick a separate workdir per chain.`,
          )
        }
      }
      const poolId = args.pool_id !== undefined && args.pool_id.trim() !== '' ? args.pool_id.trim() : `pool-${Date.now().toString(36)}`
      if (existsSync(poolPathOf(poolId))) {
        throw new Error(`pool ${poolId} already exists — use mat_pool_status / mat_pool_resume instead of starting a duplicate`)
      }
      const pool = createPoolState({
        poolId,
        clusterId: args.cluster_id,
        chains: specs,
        ...(typeof args.max_concurrent === 'number' ? { maxConcurrent: args.max_concurrent } : {}),
      })
      for (const c of pool.chains) {
        if (existsSync(pipelinePath(c.pipelineId))) {
          throw new Error(`chain state file ${pipelinePath(c.pipelineId)} already exists — pool chain ids are namespaced; refusing to mix stale states`)
        }
      }
      persistPoolState(pool)
      const agent = exec.agent
      const submitGates = new Map<string, PipelineSubmitGate | undefined>()
      for (const c of pool.chains) {
        if (c.taskRef !== undefined) submitGates.set(c.pipelineId, makePoolSubmitGate(c.taskRef))
      }
      const driverClient = newWatchClient()
      jobs.start({
        kind: 'mat-pool',
        label: `pool ${poolId}: ${pool.chains.length} chains @${args.cluster_id}`,
        ...agent !== undefined ? { owner: agent } : {},
        run: () => poolJobHooks(createPoolDriverHooks({
          pool,
          pkgOf: (digest) => loadPersistedPackage(taskPackagesDir(), digest),
          stateOf: (pipelineId) => {
            const entry = pool.chains.find((c) => c.pipelineId === pipelineId)!
            return createPipelineState({
              pipelineId, clusterId: pool.clusterId, workdir: entry.workdir,
              pkg: loadPersistedPackage(taskPackagesDir(), entry.pkgDigest),
            })
          },
          execCommand: (clusterId, command, timeoutSeconds) => driverClient.execCommand(clusterId, command, timeoutSeconds),
          // B1:池语义默认——4h 窗口 + 2 次自动续看(忙分区排队常态,机械续看不该烧 LLM 轮次)
          maxWaitSeconds: typeof args.max_wait_seconds === 'number' ? args.max_wait_seconds : 14_400,
          autoRewatchLimit: typeof args.auto_rewatch_limit === 'number' ? Math.max(0, Math.floor(args.auto_rewatch_limit)) : 2,
          ...(typeof args.poll_seconds === 'number' ? { pollSeconds: args.poll_seconds } : {}),
          // B3/jitter/SCF:降噪默认 actionable;链同相去同步;SCF 收敛监控默认开
          notifyOn: args.notify_on === 'all' ? 'all' : 'actionable',
          pollJitter: 0.1,
          scfTrend: args.scf_trend === false ? undefined
            : (typeof args.scf_sample_seconds === 'number'
              ? { intervalMs: Math.max(5, args.scf_sample_seconds) * 1_000 }
              : true),
          diagnose: (errorText) => openMatDb()?.kbLookupByError(errorText) ?? [],
          markDeadLetter: (jobId, reason, kbId) => {
            openMatDb()?.markDeadLetter(jobId, reason, kbId)
          },
          chainPersist: persistPipeline,
          poolPersist: persistPoolState,
          notify: pipelineNotify(agent),
          submitGateOf: (pipelineId) => submitGates.get(pipelineId),
        })),
      })
      return [
        `pool ${poolId} started: ${pool.chains.length} chains, cap ${pool.maxConcurrent} @${args.cluster_id}`,
        submitGates.size > 0
          ? `${submitGates.size}/${pool.chains.length} chains budget-gated (phase gate + BUDGET_REJECTED enforced per wave submission).`
          : 'WARNING: no chain carries task_ref — wave submissions bypass the phase/budget gates. Recommended for batch runs.',
        args.notify_on === 'all'
          ? 'You will be woken per chain outcome and at pool drain; track anytime with mat_pool_status.'
          : 'Wake policy: actionable only (needs_llm/dead_lettered chain outcomes + confirmed SCF anomalies + pool drain); ' +
            'completed chains stay silent — track them with mat_pool_status.',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_pool_status',
    description:
      'Read the externalized pool state (pools/<id>.json): per-chain phase (joined with each chain pipeline wave/phase), ' +
      'outcomes, stale/halted hints, recent history. Local-only.',
    parameters: {
      pool_id: { type: 'string', required: true, description: 'Pool id returned by mat_pool_start' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return renderPoolStatus(readPool(args.pool_id.trim()))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mat_pool_resume',
    description:
      'Resume a drained/stale pool. Actions: ' +
      "'retry' (chain must be halted; after gaussian-calc diagnosis, with the concluded route — the chain re-renders " +
      'and is requeued under the cap), ' +
      "'dead_letter' (chain must be halted; diagnosis says retrying is futile — terminal), " +
      "'rewatch' (chain must be halted in watch_expired — its watch window elapsed while the job is STILL queued or " +
      'running on the cluster; re-attaches monitoring to the SAME job id, no re-render, no resubmission), ' +
      "'reattach' (host restarted while chains were running — stale running chains return to pending and drivers " +
      'resume from each chain pipeline.json; also restarts a pool that drained with unstarted pending chains, e.g. ' +
      'after admission was halted by a budget-gate rejection). ' +
      'retry/dead_letter are refused while live chains are still running.',
    parameters: {
      pool_id: { type: 'string', required: true, description: 'Pool id returned by mat_pool_start' },
      action: { type: 'string', required: true, description: 'One of: retry | dead_letter | rewatch | reattach' },
      chain: { type: 'string', description: 'Pipeline id of the chain (for retry/dead_letter/rewatch), e.g. <poolId>-c2' },
      route: { type: 'string', description: 'For action=retry: the full route string to apply' },
      reason: { type: 'string', description: 'For action=dead_letter: why retrying is futile' },
      max_wait_seconds: {
        type: 'number',
        description: 'Per-wave watch window in seconds for the restarted driver (default 14400, the pool default). ' +
          'Raise it when chains parked because the watch window elapsed while jobs were still queued.',
      },
      auto_rewatch_limit: {
        type: 'number',
        description: 'Auto re-arm budget per wave for the restarted driver (default 2, the pool default).',
      },
      poll_seconds: { type: 'number', description: 'Optional cap on the per-chain poll interval in seconds (min 10).' },
      scf_trend: { type: 'boolean', description: 'SCF convergence monitoring for resumed chains (default TRUE, the pool default).' },
      scf_sample_seconds: { type: 'number', description: 'SCF sampling window in seconds (min 5; default 60).' },
      notify_on: {
        type: 'string',
        description: "Per-chain wake policy for the restarted driver (default 'actionable'; 'all' wakes per chain outcome).",
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const jobs = ctx.get('jobs')
      const action = args.action.trim()
      if (action !== 'retry' && action !== 'dead_letter' && action !== 'rewatch' && action !== 'reattach') {
        throw new Error(`unknown action '${action}' — expected retry | dead_letter | rewatch | reattach`)
      }
      let pool = readPool(args.pool_id.trim())
      if (action === 'reattach') {
        pool = onPoolReattach(pool)
        persistPoolState(pool)
      } else {
        if (poolHasLiveChains(pool)) {
          throw new Error(`pool ${pool.poolId} still has live running chains — wait for them to settle before ${action}`)
        }
        const chainId = args.chain !== undefined ? args.chain.trim() : ''
        if (chainId === '') throw new Error(`action=${action} requires chain (pipeline id)`)
        const entry = pool.chains.find((c) => c.pipelineId === chainId)
        if (entry === undefined) throw new Error(`chain ${chainId} not in pool ${pool.poolId}`)
        if (entry.phase !== 'halted') throw new Error(`chain ${chainId} is ${entry.phase} — retry/dead_letter require halted`)
        let chainState = readPipeline(chainId)
        if (action === 'retry') {
          if (args.route === undefined || args.route.trim() === '') throw new Error('action=retry requires route')
          chainState = resumePipeline(chainState, { action: 'retry', route: args.route.trim() })
          persistPipeline(chainState)
          pool = onChainRequeued(pool, chainId)
          persistPoolState(pool)
        } else if (action === 'rewatch') {
          // watch_expired 链的机械恢复（B0）：重挂同一 jobId 的监控——resumePipeline
          // 只接受 wave_submitted/watch_expired 相位,其余 halted（门检失败/无梯进）
          // 在此被拒,不会把真诊断位错挂成监控。
          chainState = resumePipeline(chainState, { action: 'rewatch' })
          persistPipeline(chainState)
          pool = onChainRequeued(pool, chainId)
          persistPoolState(pool)
        } else {
          if (args.reason === undefined || args.reason.trim() === '') throw new Error('action=dead_letter requires reason')
          chainState = resumePipeline(chainState, { action: 'dead_letter', reason: args.reason.trim() })
          persistPipeline(chainState)
          pool = onChainMarked(pool, chainId, 'dead_lettered', { status: 'dead_lettered', detail: args.reason.trim() })
          persistPoolState(pool)
          const jobId = chainState.waves.find((w) => w.waveId === chainState.currentWaveId)?.jobId
          if (jobId !== undefined) openMatDb()?.markDeadLetter(jobId, args.reason.trim())
          if (!pool.chains.some((c) => c.phase === 'pending')) {
            return `pool ${pool.poolId}: chain ${chainId} dead-lettered (${args.reason.trim()}) — no pending chains left.\n${renderPoolStatus(pool)}`
          }
        }
      }
      if (!pool.chains.some((c) => c.phase === 'pending')) {
        return `pool ${pool.poolId}: nothing to drive (no pending chains).\n${renderPoolStatus(pool)}`
      }
      if (jobs === undefined) {
        throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
      }
      const agent = exec.agent
      const submitGates = new Map<string, PipelineSubmitGate | undefined>()
      for (const c of pool.chains) {
        if (c.taskRef !== undefined) submitGates.set(c.pipelineId, makePoolSubmitGate(c.taskRef))
      }
      const driverClient = newWatchClient()
      const resumedPool = pool
      jobs.start({
        kind: 'mat-pool',
        label: `pool ${resumedPool.poolId} (resume ${action})`,
        ...agent !== undefined ? { owner: agent } : {},
        run: () => poolJobHooks(createPoolDriverHooks({
          pool: resumedPool,
          pkgOf: (digest) => loadPersistedPackage(taskPackagesDir(), digest),
          stateOf: (pipelineId) => readPipeline(pipelineId),
          execCommand: (clusterId, command, timeoutSeconds) => driverClient.execCommand(clusterId, command, timeoutSeconds),
          // 与 mat_pool_start 同款池默认（B1）：4h 窗口 + 2 次自动续看
          maxWaitSeconds: typeof args.max_wait_seconds === 'number' ? args.max_wait_seconds : 14_400,
          autoRewatchLimit: typeof args.auto_rewatch_limit === 'number' ? Math.max(0, Math.floor(args.auto_rewatch_limit)) : 2,
          ...(typeof args.poll_seconds === 'number' ? { pollSeconds: args.poll_seconds } : {}),
          notifyOn: args.notify_on === 'all' ? 'all' : 'actionable',
          pollJitter: 0.1,
          scfTrend: args.scf_trend === false ? undefined
            : (typeof args.scf_sample_seconds === 'number'
              ? { intervalMs: Math.max(5, args.scf_sample_seconds) * 1_000 }
              : true),
          diagnose: (errorText) => openMatDb()?.kbLookupByError(errorText) ?? [],
          markDeadLetter: (jobId, reason, kbId) => {
            openMatDb()?.markDeadLetter(jobId, reason, kbId)
          },
          chainPersist: persistPipeline,
          poolPersist: persistPoolState,
          notify: pipelineNotify(agent),
          submitGateOf: (pipelineId) => submitGates.get(pipelineId),
        })),
      })
      return `pool ${resumedPool.poolId} resumed (${action}) — ${poolSummary(resumedPool)}.\n${renderPoolStatus(resumedPool)}`
    },
  }))
}
