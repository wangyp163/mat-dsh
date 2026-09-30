/**
 * 环境门禁注册表与接线（constraint-decoupling A2/A4/A5，工具层）。
 *
 * 语义：门禁是 per-(host 进程, cluster, engine) + TTL 的运行时数据，不是加载期拓扑。
 * 一次 `mat_env_gate` 通过后登记，全进程内的后续提交在 TTL 内放行——batch 子代理
 * 自动继承主会话门禁，batch-roles 的「门禁第一条继承」从散文纪律变成机制事实。
 *
 * 拒绝形态照既有闸范式（BUDGET_REJECTED / PHASE_GATE_REJECTED）：
 * 抛 ENV_GATE_REJECTED 前缀错误，发生在任何集群调用之前——零集群副作用。
 *
 * 应急开关（对齐 exec-gate 范式）：
 *   MAT_ENV_GATE=off          整闸关闭（登记与拦截都旁路）
 *   MAT_ENV_GATE_MAX_AGE_MS   新鲜度上限，缺省 12h
 */

import { isEnvGateFresh } from 'mat-core'
import type { EnvGateEntry, EnvGateVerdict } from 'mat-core'

/** 缺省新鲜度上限：12 小时（一个工作日内的会话共享一次门禁）。 */
export const DEFAULT_ENV_GATE_MAX_AGE_MS = 12 * 60 * 60 * 1000

/** 支持的引擎（与 mat-core engine.ts 的 EngineId 对齐；abacus 为 documentedOnly）。 */
export type EnvGateEngine = 'gaussian' | 'abacus' | 'vasp'

export interface EnvGateRegistry {
  /** 登记一次通过（覆盖同键旧条目）。 */
  register(clusterId: string, engine: string, verdict: EnvGateVerdict, nowMs?: number): void
  /** 取条目（不判新鲜度）。 */
  get(clusterId: string, engine: string): EnvGateEntry | undefined
  /** 新鲜度判定（含 TTL）。 */
  isFresh(clusterId: string, engine: string, nowMs?: number): boolean
  /** 全部条目（状态呈现/测试用）。 */
  list(): EnvGateEntry[]
  /** 清空（测试用）。 */
  clear(): void
}

function keyOf(clusterId: string, engine: string): string {
  return `${clusterId}::${engine}`
}

/** 整闸开关：MAT_ENV_GATE=off 时门禁不拦截也不登记。 */
export function envGateDisabled(): boolean {
  return (process.env.MAT_ENV_GATE ?? '').toLowerCase() === 'off'
}

/** 新鲜度上限（env 覆盖；非法值回落缺省）。 */
export function envGateMaxAgeMs(): number {
  const raw = process.env.MAT_ENV_GATE_MAX_AGE_MS
  if (raw === undefined) return DEFAULT_ENV_GATE_MAX_AGE_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ENV_GATE_MAX_AGE_MS
  return parsed
}

export function createEnvGateRegistry(): EnvGateRegistry {
  const entries = new Map<string, EnvGateEntry>()
  return {
    register(clusterId, engine, verdict, nowMs = Date.now()): void {
      entries.set(keyOf(clusterId, engine), { clusterId, engine, verdict, registeredAt: nowMs })
    },
    get(clusterId, engine): EnvGateEntry | undefined {
      return entries.get(keyOf(clusterId, engine))
    },
    isFresh(clusterId, engine, nowMs = Date.now()): boolean {
      return isEnvGateFresh(entries.get(keyOf(clusterId, engine)), nowMs, envGateMaxAgeMs())
    },
    list(): EnvGateEntry[] {
      return [...entries.values()]
    },
    clear(): void {
      entries.clear()
    },
  }
}

/**
 * 进程级单例。工具层四入口与 mat_env_gate 共用同一张表——
 * 这正是「子代理继承主会话门禁」的载体：同一 host 进程即同一张表。
 */
let registry: EnvGateRegistry | undefined

export function getEnvGateRegistry(): EnvGateRegistry {
  if (registry === undefined) registry = createEnvGateRegistry()
  return registry
}

/** 测试用重置（与 resetMatDbForTests 同款逃生口）。 */
export function resetEnvGateForTests(): void {
  registry = undefined
}

/**
 * 提交前门禁断言（A4 四入口共用）。
 *
 * 拒绝发生在任何集群调用之前，故调用点必须放在 execute 头部——与 assertPhaseGate
 * 同一位置带。`mat_exec` 不设闸：它是通用通道，且门禁脚本自身经它执行（鸡生蛋）。
 *
 * @param clusterId 目标集群。
 * @param engine 引擎（缺省 gaussian）。
 * @throws ENV_GATE_REJECTED 前缀错误（无门禁 / 门禁过期）。
 */
export function assertEnvGate(clusterId: string, engine: EnvGateEngine = 'gaussian'): void {
  if (envGateDisabled()) return
  const reg = getEnvGateRegistry()
  if (reg.isFresh(clusterId, engine)) return
  const entry = reg.get(clusterId, engine)
  const why = entry === undefined
    ? 'no pass in this host process'
    : `pass expired (registered ${new Date(entry.registeredAt).toISOString()}, max age ${envGateMaxAgeMs()}ms)`
  throw new Error(
    `ENV_GATE_REJECTED: cluster ${clusterId} (${engine}) env gate not fresh (${why}) — run mat_env_gate first`,
  )
}

/**
 * 按引擎组装门禁脚本命令。
 *
 * 脚本常驻远端家目录 `$HOME/workspace/.{engine}-calc/scripts/`，与本机
 * `skills/{engine}-calc/scripts/` 同版。覆盖参数（workflow_root / g16_home）
 * 原样透传给脚本——脚本自身支持位置参数覆盖默认路径。
 */
export function envGateCommand(
  engine: EnvGateEngine,
  workflowRoot?: string,
  g16Home?: string,
): string {
  const script = `$HOME/workspace/.${engine}-calc/scripts/check_environment.sh`
  const args = [workflowRoot, g16Home]
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
    .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
  const suffix = args.length > 0 ? ` ${args.join(' ')}` : ''
  // 脚本不在时给出显式信号，供 parseEnvGateStdout 走 seed-needed 分支。
  return `[ -f "${script}" ] || { echo SCRIPT_NOT_FOUND; exit 0; }; bash "${script}"${suffix}`
}
