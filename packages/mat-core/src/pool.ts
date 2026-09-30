/**
 * 批量任务池状态机（审阅表 R6b：批量 fan-out 与 shepherd 替换）。
 *
 * D1 插件 A 语义：任务池 = pending/running/halted/终态 的链数组 + 并发上限
 * （信号量）+ 回填（链结算后空位立即补 pending）。纯逻辑零 IO：持久化
 * （pools/<poolId>.json）与每链 pipeline.json 由宿主钩子负责。
 *
 * 链级相位沿用单链 pipeline 的富终态：done（completed）/ dead_lettered /
 * halted（needs_llm——诊断权在会话，池不等待，回填继续跑别的链）。
 * 多驱动防双跑：resume 仅在无 running 链时放行（工具层守卫），池驱动自身
 * 只驱动自己 admit 的链并在无 running 且无 pending 时收口。
 */

export type PoolChainPhase = 'pending' | 'running' | 'done' | 'halted' | 'dead_lettered' | 'cancelled'

/** poolFromJson 的 phase 合法值（手改 pools/<id>.json 的 typo 会静默破坏 admission 不变式）。 */
const POOL_CHAIN_PHASES = new Set<PoolChainPhase>(['pending', 'running', 'done', 'halted', 'dead_lettered', 'cancelled'])

export interface PoolChainSpec {
  /** 链的 pipelineId（pipeline.json 键，池分配 `${poolId}-c<N>`）。 */
  pipelineId: string
  workdir: string
  pkgDigest: string
  /** 可选预算闸身份（工具原始形状——submitGate 直连 assertPhaseGate/openBudgetGate）。 */
  taskRef?: { portfolio_file: string; task_id: string }
}

export interface PoolChainEntry extends PoolChainSpec {
  phase: PoolChainPhase
  /** 结算信息（done/halted/dead_lettered 时有）。 */
  outcome?: { status: string; detail: string }
}

export interface PoolState {
  schema_version: 'mat.pool.v1'
  poolId: string
  clusterId: string
  maxConcurrent: number
  chains: PoolChainEntry[]
  history: Array<{ ts: number; event: string; detail?: string }>
}

export function createPoolState(input: {
  poolId: string
  clusterId: string
  chains: Array<Omit<PoolChainSpec, 'pipelineId'> & { pipelineId?: string }>
  maxConcurrent?: number
}): PoolState {
  const chains: PoolChainEntry[] = input.chains.map((c, i) => ({
    pipelineId: c.pipelineId ?? `${input.poolId}-c${i + 1}`,
    workdir: c.workdir,
    pkgDigest: c.pkgDigest,
    ...(c.taskRef !== undefined ? { taskRef: c.taskRef } : {}),
    phase: 'pending',
  }))
  const ids = new Set(chains.map((c) => c.pipelineId))
  if (ids.size !== chains.length) {
    throw new Error('pool: duplicate chain pipelineId')
  }
  return {
    schema_version: 'mat.pool.v1',
    poolId: input.poolId,
    clusterId: input.clusterId,
    maxConcurrent: Math.max(1, input.maxConcurrent ?? 2),
    chains,
    history: [{ ts: Date.now(), event: 'created', detail: `${chains.length} chains, cap ${Math.max(1, input.maxConcurrent ?? 2)}` }],
  }
}

function next(s: PoolState, event: string, detail: string, patch: Partial<PoolState>): PoolState {
  return {
    ...s,
    ...patch,
    history: [...s.history, { ts: Date.now(), event, detail }].slice(-200),
  }
}

function chainOf(s: PoolState, pipelineId: string): PoolChainEntry {
  const c = s.chains.find((x) => x.pipelineId === pipelineId)
  if (c === undefined) throw new Error(`pool: unknown chain ${pipelineId}`)
  return c
}

/** 信号量：当前可补位的 pending 链（running 计数 < maxConcurrent 才放行）。 */
export function admissibleChains(s: PoolState): string[] {
  const running = s.chains.filter((c) => c.phase === 'running').length
  const slots = s.maxConcurrent - running
  if (slots <= 0) return []
  return s.chains.filter((c) => c.phase === 'pending').slice(0, slots).map((c) => c.pipelineId)
}

export function onChainAdmitted(s: PoolState, pipelineId: string): PoolState {
  const c = chainOf(s, pipelineId)
  if (c.phase !== 'pending') throw new Error(`pool: admit requires pending (chain ${pipelineId} is ${c.phase})`)
  return next(s, 'chain_admitted', `${pipelineId} (${c.workdir})`, {
    chains: s.chains.map((x) => x.pipelineId === pipelineId ? { ...x, phase: 'running' as const } : x),
  })
}

export function onChainSettled(s: PoolState, pipelineId: string, outcome: { status: string; detail: string }): PoolState {
  const c = chainOf(s, pipelineId)
  if (c.phase !== 'running') throw new Error(`pool: settle requires running (chain ${pipelineId} is ${c.phase})`)
  const phase: PoolChainPhase =
    outcome.status === 'completed' ? 'done'
      : outcome.status === 'needs_llm' ? 'halted'
        : outcome.status === 'dead_lettered' ? 'dead_lettered'
          : outcome.status === 'cancelled' ? 'cancelled'
            : 'halted'
  return next(s, 'chain_settled', `${pipelineId} ${phase}: ${outcome.detail.slice(0, 120)}`, {
    chains: s.chains.map((x) => x.pipelineId === pipelineId
      ? { ...x, phase, outcome: { status: outcome.status, detail: outcome.detail } }
      : x),
  })
}

/** halted 链诊断后重新入池（pending,回填重跑）;dead_lettered/done 终态不可逆。 */
export function onChainRequeued(s: PoolState, pipelineId: string): PoolState {
  const c = chainOf(s, pipelineId)
  if (c.phase !== 'halted') throw new Error(`pool: requeue requires halted (chain ${pipelineId} is ${c.phase})`)
  return next(s, 'chain_requeued', pipelineId, {
    chains: s.chains.map((x) => x.pipelineId === pipelineId ? { ...x, phase: 'pending' as const } : x),
  })
}

/** halted 链诊断为不可重试 → 直落终态（dead_lettered/cancelled,不可逆）。 */
export function onChainMarked(
  s: PoolState,
  pipelineId: string,
  phase: 'dead_lettered' | 'cancelled',
  outcome: { status: string; detail: string },
): PoolState {
  const c = chainOf(s, pipelineId)
  if (c.phase !== 'halted') throw new Error(`pool: mark requires halted (chain ${pipelineId} is ${c.phase})`)
  return next(s, 'chain_marked', `${pipelineId} ${phase}: ${outcome.detail.slice(0, 120)}`, {
    chains: s.chains.map((x) => x.pipelineId === pipelineId
      ? { ...x, phase, outcome: { status: outcome.status, detail: outcome.detail } }
      : x),
  })
}

/** stale 接手：宿主重启后 running 链的驱动不在场——回 pending 由新驱动按各自 pipeline.json 续跑。 */
export function onPoolReattach(s: PoolState): PoolState {
  const stale = s.chains.filter((c) => c.phase === 'running')
  if (stale.length === 0) return s
  return next(s, 'pool_reattached', `${stale.length} stale running -> pending`, {
    chains: s.chains.map((x) => x.phase === 'running' ? { ...x, phase: 'pending' as const } : x),
  })
}

export function poolHasLiveChains(s: PoolState): boolean {
  return s.chains.some((c) => c.phase === 'running')
}

/** 池收口：无 pending 且无 running（halted/终态留给人）。 */
export function poolDrained(s: PoolState): boolean {
  return !s.chains.some((c) => c.phase === 'pending' || c.phase === 'running')
}

export function poolSummary(s: PoolState): string {
  const counts = new Map<PoolChainPhase, number>()
  for (const c of s.chains) counts.set(c.phase, (counts.get(c.phase) ?? 0) + 1)
  return [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(' ')
}

export function poolToJson(s: PoolState): string {
  return `${JSON.stringify(s, null, 2)}\n`
}

export function poolFromJson(text: string): PoolState {
  const parsed = JSON.parse(text) as PoolState
  if (parsed.schema_version !== 'mat.pool.v1') {
    throw new Error(`pool: unknown schema_version ${String(parsed.schema_version)}`)
  }
  if (!Array.isArray(parsed.chains) || parsed.chains.length === 0) {
    throw new Error('pool: chains must be a non-empty array')
  }
  for (const key of ['poolId', 'clusterId', 'maxConcurrent'] as const) {
    if (parsed[key] === undefined || parsed[key] === null) {
      throw new Error(`pool: missing field ${key}`)
    }
  }
  if (!Number.isInteger(parsed.maxConcurrent) || parsed.maxConcurrent < 1) {
    throw new Error(`pool: maxConcurrent must be an integer >= 1 (got ${String(parsed.maxConcurrent)})`)
  }
  for (const c of parsed.chains) {
    if (typeof c.pipelineId !== 'string' || typeof c.workdir !== 'string' || typeof c.pkgDigest !== 'string') {
      throw new Error(`pool: chain entry missing pipelineId/workdir/pkgDigest`)
    }
    if (!POOL_CHAIN_PHASES.has(c.phase)) {
      throw new Error(`pool: chain ${c.pipelineId} has unknown phase '${String(c.phase)}' (expected one of ${[...POOL_CHAIN_PHASES].join('/')})`)
    }
  }
  return parsed
}
