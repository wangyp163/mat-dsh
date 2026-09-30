import { describe, expect, it } from 'vitest'
import {
  admissibleChains,
  createPoolState,
  onChainAdmitted,
  onChainMarked,
  onChainRequeued,
  onChainSettled,
  onPoolReattach,
  poolDrained,
  poolFromJson,
  poolHasLiveChains,
  poolSummary,
  poolToJson,
} from '../src/pool'

/**
 * R6b 任务池纯逻辑：信号量 admission、回填、halted/终态转移守卫、
 * stale reattach、drain 判定与 JSON 往返。
 */

function fresh(chains = 3, cap = 2) {
  return createPoolState({
    poolId: 'pool-x',
    clusterId: '11250',
    chains: Array.from({ length: chains }, (_, i) => ({
      workdir: `/w/${String.fromCharCode(65 + i)}`,
      pkgDigest: 'd'.repeat(64),
    })),
    maxConcurrent: cap,
  })
}

describe('pool 状态机', () => {
  it('创建:链 id 按池命名空间分配,全 pending', () => {
    const s = fresh(3)
    expect(s.chains.map((c) => c.pipelineId)).toEqual(['pool-x-c1', 'pool-x-c2', 'pool-x-c3'])
    expect(s.chains.every((c) => c.phase === 'pending')).toBe(true)
    expect(s.maxConcurrent).toBe(2)
  })

  it('信号量:cap 内放行,满了不放;结算后回填空位', () => {
    let s = fresh(3, 2)
    expect(admissibleChains(s)).toEqual(['pool-x-c1', 'pool-x-c2'])
    s = onChainAdmitted(s, 'pool-x-c1')
    s = onChainAdmitted(s, 'pool-x-c2')
    expect(admissibleChains(s)).toEqual([])
    s = onChainSettled(s, 'pool-x-c1', { status: 'completed', detail: 'all 3 waves passed' })
    expect(admissibleChains(s)).toEqual(['pool-x-c3'])
    expect(s.chains[0]!.phase).toBe('done')
    expect(s.chains[0]!.outcome?.status).toBe('completed')
  })

  it('halted 不阻塞回填;needs_llm 映射 halted、dead_lettered 保留', () => {
    let s = fresh(2, 1)
    s = onChainAdmitted(s, 'pool-x-c1')
    s = onChainSettled(s, 'pool-x-c1', { status: 'needs_llm', detail: 'gate failed' })
    expect(s.chains[0]!.phase).toBe('halted')
    expect(admissibleChains(s)).toEqual(['pool-x-c2'])
    s = onChainAdmitted(s, 'pool-x-c2')
    s = onChainSettled(s, 'pool-x-c2', { status: 'dead_lettered', detail: 'ladder-exhausted' })
    expect(s.chains[1]!.phase).toBe('dead_lettered')
    expect(poolDrained(s)).toBe(true)
    expect(poolSummary(s)).toBe('halted=1 dead_lettered=1')
  })

  it('requeue/mark 守卫:仅 halted 可;终态不可逆', () => {
    let s = fresh(2, 2)
    s = onChainAdmitted(s, 'pool-x-c1')
    expect(() => onChainRequeued(s, 'pool-x-c1')).toThrow(/requires halted/)
    s = onChainSettled(s, 'pool-x-c1', { status: 'needs_llm', detail: 'x' })
    s = onChainRequeued(s, 'pool-x-c1')
    expect(s.chains[0]!.phase).toBe('pending')
    s = onChainAdmitted(s, 'pool-x-c1')
    s = onChainSettled(s, 'pool-x-c1', { status: 'needs_llm', detail: 'y' })
    s = onChainMarked(s, 'pool-x-c1', 'dead_lettered', { status: 'dead_lettered', detail: 'no-kb-entry' })
    expect(() => onChainRequeued(s, 'pool-x-c1')).toThrow(/requires halted/)
    expect(() => onChainAdmitted(s, 'pool-x-c1')).toThrow(/requires pending/)
    expect(() => onChainSettled(s, 'pool-x-c1', { status: 'completed', detail: '' })).toThrow(/requires running/)
  })

  it('reattach:running 全回 pending;无 stale 幂等', () => {
    let s = fresh(3, 3)
    s = onChainAdmitted(s, 'pool-x-c1')
    s = onChainAdmitted(s, 'pool-x-c2')
    expect(poolHasLiveChains(s)).toBe(true)
    const r = onPoolReattach(s)
    expect(r.chains.filter((c) => c.phase === 'pending')).toHaveLength(3)
    expect(poolHasLiveChains(r)).toBe(false)
    expect(onPoolReattach(r)).toBe(r)
  })

  it('drain:pending/running 清零才算收口', () => {
    let s = fresh(2, 2)
    expect(poolDrained(s)).toBe(false)
    s = onChainAdmitted(s, 'pool-x-c1')
    s = onChainSettled(s, 'pool-x-c1', { status: 'completed', detail: '' })
    expect(poolDrained(s)).toBe(false) // c2 仍 pending
    s = onChainAdmitted(s, 'pool-x-c2')
    s = onChainSettled(s, 'pool-x-c2', { status: 'completed', detail: '' })
    expect(poolDrained(s)).toBe(true)
  })

  it('重复 pipelineId 拒绝;JSON 往返;坏 payload 拒绝', () => {
    expect(() => createPoolState({
      poolId: 'p', clusterId: 'c',
      chains: [
        { pipelineId: 'same', workdir: '/a', pkgDigest: 'd' },
        { pipelineId: 'same', workdir: '/b', pkgDigest: 'd' },
      ],
    })).toThrow(/duplicate/)
    const s = fresh(2, 1)
    expect(poolFromJson(poolToJson(s))).toEqual(s)
    expect(() => poolFromJson('{"schema_version":"x"}')).toThrow(/schema_version/)
    expect(() => poolFromJson(JSON.stringify({ ...s, chains: [] }))).toThrow(/non-empty/)
    expect(() => poolFromJson(JSON.stringify({ ...s, maxConcurrent: undefined }))).toThrow(/maxConcurrent/)
  })

  it('B5 装载校验:手改 JSON 的 phase typo 与非法 maxConcurrent 拒绝', () => {
    const s = fresh(2, 1)
    // phase typo(如 'haulted')会静默破坏 admission 不变式——admissibleChains
    // 只数 'running'、回填只挑 'pending',未知相位让池状态机悄悄失真
    const typo = { ...s, chains: [{ ...s.chains[0]!, phase: 'haulted' as never }] }
    expect(() => poolFromJson(poolToJson(typo))).toThrow(/unknown phase 'haulted'/)
    expect(() => poolFromJson(poolToJson({ ...s, maxConcurrent: 0 }))).toThrow(/integer >= 1/)
    expect(() => poolFromJson(poolToJson({ ...s, maxConcurrent: 1.5 }))).toThrow(/integer >= 1/)
  })
})
