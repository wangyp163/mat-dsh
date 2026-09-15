import { describe, expect, it } from 'vitest'
import {
  createPortfolio,
  updateTask,
  resetForRetry,
  portfolioToJson,
  portfolioFromJson,
  diffPortfolio,
} from '../src/portfolio'

/** 最小清单：8 正常 + 2 注入，模拟 spike 场景。 */
function makeSpikePortfolio() {
  return createPortfolio({
    portfolioId: 'batch-subagent-spike',
    tasks: [
      { taskId: 'V1', system: 'H2O', kind: 'valid' },
      { taskId: 'V2', system: 'CH4', kind: 'valid' },
      { taskId: 'F1', system: 'broken-geometry', kind: 'injected', injectedNote: 'near-coincident atoms' },
    ],
  })
}

describe('createPortfolio', () => {
  it('初始化全部任务为 pending、attempts=0、带时间戳', () => {
    const p = makeSpikePortfolio()
    expect(p.portfolioId).toBe('batch-subagent-spike')
    expect(p.tasks).toHaveLength(3)
    for (const t of p.tasks) {
      expect(t.phase).toBe('pending')
      expect(t.attempts).toBe(0)
      expect(t.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('taskId 重复即拒绝（清单是键，重复会破坏增量语义）', () => {
    expect(() =>
      createPortfolio({
        portfolioId: 'x',
        tasks: [
          { taskId: 'V1', system: 'H2O', kind: 'valid' },
          { taskId: 'V1', system: 'H2O', kind: 'valid' },
        ],
      }),
    ).toThrow(/duplicate/i)
  })

  it('injected 任务必须带 injectedNote（透明纪律的前置）', () => {
    expect(() =>
      createPortfolio({
        portfolioId: 'x',
        tasks: [{ taskId: 'F1', system: 'x', kind: 'injected' as const }],
      }),
    ).toThrow(/injectedNote/)
  })
})

describe('updateTask（相位只进不退）', () => {
  it('pending → prepared → submitted 正常推进并盖时间戳', () => {
    const p = makeSpikePortfolio()
    const t1 = updateTask(p, 'V1', { phase: 'prepared' })
    const t2 = updateTask(p, 'V1', { phase: 'submitted', jobId: '12345' })
    expect(t1.phase).toBe('prepared')
    expect(t2.phase).toBe('submitted')
    expect(t2.jobId).toBe('12345')
    expect(t2.updatedAt >= t1.updatedAt).toBe(true)
  })

  it('相位倒退即拒绝（settled → prepared）', () => {
    const p = makeSpikePortfolio()
    updateTask(p, 'V1', { phase: 'prepared' })
    updateTask(p, 'V1', { phase: 'submitted' })
    updateTask(p, 'V1', { phase: 'settled' })
    expect(() => updateTask(p, 'V1', { phase: 'prepared' })).toThrow(/phase/)
  })

  it('未知 taskId 拒绝', () => {
    const p = makeSpikePortfolio()
    expect(() => updateTask(p, 'NOPE', { phase: 'prepared' })).toThrow(/NOPE/)
  })

  it('verdict 记录为结构化对象（最后一次裁决覆盖）', () => {
    const p = makeSpikePortfolio()
    updateTask(p, 'F1', { phase: 'settled', verdict: { schema: 'mat.triage-verdict.v1', failureClass: 'input' } })
    const t = p.tasks.find((x) => x.taskId === 'F1')
    expect(t?.verdict).toMatchObject({ failureClass: 'input' })
  })
})

describe('resetForRetry', () => {
  it('attempts+1、相位回 prepared、清 jobId', () => {
    const p = makeSpikePortfolio()
    updateTask(p, 'F1', { phase: 'submitted', jobId: '999' })
    updateTask(p, 'F1', { phase: 'settled' })
    resetForRetry(p, 'F1')
    const t = p.tasks.find((x) => x.taskId === 'F1')
    expect(t?.attempts).toBe(1)
    expect(t?.phase).toBe('prepared')
    expect(t?.jobId).toBeUndefined()
  })
})

describe('json 往返', () => {
  it('toJson → fromJson 逐字段一致', () => {
    const p = makeSpikePortfolio()
    updateTask(p, 'V1', { phase: 'interpreted', verdict: { converged: true } })
    const round = portfolioFromJson(portfolioToJson(p))
    expect(round).toEqual(p)
  })

  it('预算声明随清单往返（声明计划即预算——Phase C 预算闸的数据源）', () => {
    const p = createPortfolio({
      portfolioId: 'spike',
      budget: { maxSbatch: 12, maxRetriesPerTask: 1, maxCoreHours: 5 },
      tasks: [{ taskId: 'V1', system: 'H2O', kind: 'valid' }],
    })
    const round = portfolioFromJson(portfolioToJson(p))
    expect(round.budget).toEqual({ maxSbatch: 12, maxRetriesPerTask: 1, maxCoreHours: 5 })
  })

  it('fromJson 拒绝坏 JSON 与缺字段载荷（防手改清单静默污染）', () => {
    expect(() => portfolioFromJson('not json')).toThrow()
    expect(() => portfolioFromJson('{"portfolioId":"x"}')).toThrow(/tasks/)
  })
})

describe('diffPortfolio（增量行语义，对齐 watch-loop readOutput）', () => {
  it('只报变化的任务行：taskId + 变了什么', () => {
    const before = makeSpikePortfolio()
    const after = makeSpikePortfolio()
    updateTask(after, 'V1', { phase: 'submitted', jobId: '123' })
    updateTask(after, 'F1', { phase: 'prepared' })
    const lines = diffPortfolio(before, after)
    expect(lines.some((l) => l.includes('V1') && l.includes('submitted') && l.includes('123'))).toBe(true)
    expect(lines.some((l) => l.includes('F1') && l.includes('prepared'))).toBe(true)
    expect(lines.every((l) => !l.includes('V2'))).toBe(true)
  })

  it('无变化返回空数组', () => {
    expect(diffPortfolio(makeSpikePortfolio(), makeSpikePortfolio())).toEqual([])
  })
})
