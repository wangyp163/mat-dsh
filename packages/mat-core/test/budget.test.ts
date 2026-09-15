import { describe, expect, it } from 'vitest'
import { createBudgetGuard } from '../src/budget'

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
