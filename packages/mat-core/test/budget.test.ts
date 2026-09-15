import { describe, expect, it } from 'vitest'
import { createBudgetGuard, checkBudgetAgainstManifest } from '../src/budget'
import { createPortfolio, appendSubmission } from '../src/portfolio'

describe('checkBudgetAgainstManifest（清单驱动的预算闸）', () => {
  const decl = { maxSbatch: 3, maxRetriesPerTask: 1, maxCoreHours: 5 }

  function makePortfolio() {
    return createPortfolio({
      portfolioId: 'p',
      budget: decl,
      tasks: [
        { taskId: 'V1', system: 'a', kind: 'valid' },
        { taskId: 'V2', system: 'b', kind: 'valid' },
      ],
    })
  }

  it('清单内任务预算内放行', () => {
    expect(checkBudgetAgainstManifest(makePortfolio(), { taskId: 'V1', isRetry: false, estimatedCoreHours: 0.5 })).toEqual({ ok: true })
  })

  it('计划外 taskId 结构化拒绝（声明计划即预算）', () => {
    const d = checkBudgetAgainstManifest(makePortfolio(), { taskId: 'X-EXTRA', isRetry: false, estimatedCoreHours: 0.5 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/X-EXTRA/)
  })

  it('台账回放后 sbatch 超限拒绝（H6 实弹语义）', () => {
    const p = makePortfolio()
    appendSubmission(p, { taskId: 'V1', isRetry: false, estimatedCoreHours: 0.5, jobId: '1', at: 't1' })
    appendSubmission(p, { taskId: 'V2', isRetry: false, estimatedCoreHours: 0.5, jobId: '2', at: 't2' })
    appendSubmission(p, { taskId: 'V1', isRetry: true, estimatedCoreHours: 0.5, jobId: '3', at: 't3' })
    const d = checkBudgetAgainstManifest(p, { taskId: 'V2', isRetry: false, estimatedCoreHours: 0.5 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/sbatch/)
  })

  it('台账回放后单任务重试超上限拒绝', () => {
    const p = makePortfolio()
    appendSubmission(p, { taskId: 'V1', isRetry: false, estimatedCoreHours: 0.5, at: 't1' })
    appendSubmission(p, { taskId: 'V1', isRetry: true, estimatedCoreHours: 0.5, at: 't2' })
    const d = checkBudgetAgainstManifest(p, { taskId: 'V1', isRetry: true, estimatedCoreHours: 0.5 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/V1/)
  })

  it('台账核时累计超声明拒绝', () => {
    const p = makePortfolio()
    appendSubmission(p, { taskId: 'V1', isRetry: false, estimatedCoreHours: 4.8, at: 't1' })
    const d = checkBudgetAgainstManifest(p, { taskId: 'V2', isRetry: false, estimatedCoreHours: 0.5 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/core-hour/i)
  })

  it('未声明预算的清单不受闸（opt-in 语义）', () => {
    const p = createPortfolio({ portfolioId: 'q', tasks: [{ taskId: 'V1', system: 'a', kind: 'valid' }] })
    expect(checkBudgetAgainstManifest(p, { taskId: 'V1', isRetry: false, estimatedCoreHours: 99 }).ok).toBe(true)
  })
})

/** spike 档预算：总 sbatch 3、单任务重试 1、核时 1.0。 */
function makeGuard() {
  return createBudgetGuard({ maxSbatch: 3, maxRetriesPerTask: 1, maxCoreHours: 1.0 })
}

describe('createBudgetGuard.check（纯查询不记账）', () => {
  it('预算内放行', () => {
    const g = makeGuard()
    expect(g.check({ taskId: 'V1', isRetry: false, estimatedCoreHours: 0.1 })).toEqual({ ok: true })
  })

  it('check 不改变状态（连续 check 同一请求结果不变）', () => {
    const g = makeGuard()
    for (let i = 0; i < 5; i++) {
      expect(g.check({ taskId: 'V1', isRetry: false, estimatedCoreHours: 0.1 }).ok).toBe(true)
    }
    expect(g.snapshot().sbatchCount).toBe(0)
  })

  it('sbatch 总数超限即结构化拒绝（非抛异常）', () => {
    const g = makeGuard()
    for (let i = 0; i < 3; i++) g.record({ taskId: `V${i + 1}`, isRetry: false, estimatedCoreHours: 0.1 })
    const d = g.check({ taskId: 'V9', isRetry: false, estimatedCoreHours: 0.1 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/sbatch/)
  })

  it('单任务重试超上限即拒绝', () => {
    const g = makeGuard()
    g.record({ taskId: 'F1', isRetry: false, estimatedCoreHours: 0.1 })
    g.record({ taskId: 'F1', isRetry: true, estimatedCoreHours: 0.1 })
    const d = g.check({ taskId: 'F1', isRetry: true, estimatedCoreHours: 0.1 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/F1/)
  })

  it('核时预算超限即拒绝', () => {
    const g = makeGuard()
    g.record({ taskId: 'V1', isRetry: false, estimatedCoreHours: 0.9 })
    const d = g.check({ taskId: 'V2', isRetry: false, estimatedCoreHours: 0.2 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toMatch(/core-hour/i)
  })
})

describe('record + snapshot', () => {
  it('snapshot 反映 sbatch 计数、逐任务重试、累计核时', () => {
    const g = makeGuard()
    g.record({ taskId: 'V1', isRetry: false, estimatedCoreHours: 0.5 })
    g.record({ taskId: 'F1', isRetry: false, estimatedCoreHours: 0.2 })
    g.record({ taskId: 'F1', isRetry: true, estimatedCoreHours: 0.2 })
    const s = g.snapshot()
    expect(s.sbatchCount).toBe(3)
    expect(s.retriesByTask).toEqual({ F1: 1 })
    expect(s.estimatedCoreHours).toBeCloseTo(0.9, 10)
  })
})

describe('checkThenRecord（原子用法）', () => {
  it('过检即记账并返回放行；拒检不记账', () => {
    const g = makeGuard()
    const ok = g.checkThenRecord({ taskId: 'V1', isRetry: false, estimatedCoreHours: 0.1 })
    expect(ok.ok).toBe(true)
    expect(g.snapshot().sbatchCount).toBe(1)
    for (let i = 0; i < 2; i++) g.checkThenRecord({ taskId: `X${i}`, isRetry: false, estimatedCoreHours: 0.1 })
    const rej = g.checkThenRecord({ taskId: 'X9', isRetry: false, estimatedCoreHours: 0.1 })
    expect(rej.ok).toBe(false)
    expect(g.snapshot().sbatchCount).toBe(3)
  })

  it('非法请求（负核时/空 taskId）拒绝且不记账', () => {
    const g = makeGuard()
    expect(g.checkThenRecord({ taskId: '', isRetry: false, estimatedCoreHours: 0.1 }).ok).toBe(false)
    expect(g.checkThenRecord({ taskId: 'V1', isRetry: false, estimatedCoreHours: -1 }).ok).toBe(false)
    expect(g.snapshot().sbatchCount).toBe(0)
  })
})
