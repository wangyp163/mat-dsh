import { describe, expect, it } from 'vitest'
import { resolveEstimateNcores, reconcileLedger } from '../src/budget'
import { createPortfolio, appendSubmission, updateTask } from '../src/portfolio'

describe('resolveEstimateNcores（估算取数顺序：spec 钉死优先）', () => {
  it('manifest spec 优先于 pre_json（分歧时规格胜出）', () => {
    const spec = { resources: { ncores: 8, memory: '16GB' } }
    const preJson = { resources: { ncores: 32, memory: '64GB' } }
    expect(resolveEstimateNcores(spec, preJson)).toBe(8)
  })

  it('无 spec 时回落 pre_json', () => {
    expect(resolveEstimateNcores(undefined, { resources: { ncores: 8, memory: '16GB' } })).toBe(8)
  })

  it('两者皆无按 32 核缺省（保守计费）', () => {
    expect(resolveEstimateNcores(undefined, undefined)).toBe(32)
    expect(resolveEstimateNcores({}, {})).toBe(32)
  })
})

describe('reconcileLedger（sacct 实际核时回写，两本账对账）', () => {
  function makeLedger() {
    const p = createPortfolio({
      portfolioId: 'r3',
      budget: { maxSbatch: 10, maxRetriesPerTask: 1, maxCoreHours: 26 },
      tasks: [
        { taskId: 'M1', system: 'a', kind: 'valid' },
        { taskId: 'M2', system: 'b', kind: 'valid' },
      ],
    })
    appendSubmission(p, { taskId: 'M1', jobId: '111', isRetry: false, estimatedCoreHours: 0.5 })
    appendSubmission(p, { taskId: 'M2', jobId: '222', isRetry: false, estimatedCoreHours: 2 })
    updateTask(p, 'M1', { spec: { task: 'opt', resources: { ncores: 8, memory: '16GB' } } })
    updateTask(p, 'M2', { spec: { task: 'opt', resources: { ncores: 8, memory: '16GB' } } })
    return p
  }

  it('按 jobId 回写 actualCoreHours（elapsed × ncores / 3600，ncores 取 spec）', () => {
    const p = makeLedger()
    // 8 核 × 18s = 0.04 core-hours
    const sacct = '111|COMPLETED|0:0|18|/w\n222|COMPLETED|0:0|36|/w\n'
    const r = reconcileLedger(p, sacct)
    expect(r.reconciled).toBe(2)
    expect(p.ledger?.[0].actualCoreHours).toBeCloseTo(0.04, 6)
    expect(p.ledger?.[1].actualCoreHours).toBeCloseTo(0.08, 6)
    expect(r.report.some((l) => l.includes('estimated') && l.includes('actual'))).toBe(true)
  })

  it('sacct 查不到的作业条目不动（记录在 report 未对账行）', () => {
    const p = makeLedger()
    const r = reconcileLedger(p, '111|COMPLETED|0:0|18|/w\n')
    expect(r.reconciled).toBe(1)
    expect(p.ledger?.[1].actualCoreHours).toBeUndefined()
    expect(r.report.some((l) => l.includes('222') || l.includes('unreconciled'))).toBe(true)
  })

  it('重复回写幂等（第二次对账不叠加）', () => {
    const p = makeLedger()
    const sacct = '111|COMPLETED|0:0|18|/w\n'
    reconcileLedger(p, sacct)
    reconcileLedger(p, sacct)
    expect(p.ledger?.[0].actualCoreHours).toBeCloseTo(0.04, 6)
  })
})
