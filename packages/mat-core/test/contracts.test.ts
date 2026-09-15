import { describe, expect, it } from 'vitest'
import {
  parsePrepVerdict,
  parseTriageVerdict,
  parseInterpretVerdict,
  verdictToLines,
  extractJson,
} from '../src/contracts'

describe('extractJson（子 agent 文本回传的第一道清洗）', () => {
  it('裸 JSON 直取', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('剥 ```json 围栏', () => {
    expect(extractJson('前置说明\n```json\n{"a":1}\n```\n尾巴')).toEqual({ a: 1 })
  })

  it('非对象（数组/字符串）原样返回，由上层 schema 判拒', () => {
    expect(extractJson('[1,2]')).toEqual([1, 2])
    expect(extractJson('"hello"')).toBe('hello')
  })
})

describe('parsePrepVerdict', () => {
  const good = {
    schema: 'mat.prep-verdict.v1',
    taskId: 'V1',
    ok: true,
    structure: 'O 0 0 0; H 0.757 0.586 0; H -0.757 0.586 0',
  }

  it('合法载荷通过并保留字段', () => {
    const r = parsePrepVerdict(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.taskId).toBe('V1')
  })

  it('失败制备必须给 problem', () => {
    const r = parsePrepVerdict({ ...good, ok: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join()).toMatch(/problem/)
  })

  it('schema 字串不符即拒（版本漂移防线上移到收口）', () => {
    const r = parsePrepVerdict({ ...good, schema: 'mat.prep-verdict.v0' })
    expect(r.ok).toBe(false)
  })
})

describe('parseTriageVerdict', () => {
  const good = {
    schema: 'mat.triage-verdict.v1',
    taskId: 'F1',
    failureClass: 'input',
    evidence: ['job.log L12: Bend angle too small', 'sacct: FAILED exit=1'],
    retryable: true,
    retryPlan: '修正重合原子坐标后重提',
    estimatedCoreHours: 0.1,
  }

  it('合法载荷通过', () => {
    expect(parseTriageVerdict(good).ok).toBe(true)
  })

  it('failureClass 超枚举即拒', () => {
    expect(parseTriageVerdict({ ...good, failureClass: 'weather' }).ok).toBe(false)
  })

  it('evidence 超 5 行即拒（防日志倒灌主会话——这是 H5 的契约面）', () => {
    const evidence = Array.from({ length: 6 }, (_, i) => `line ${i}`)
    expect(parseTriageVerdict({ ...good, evidence }).ok).toBe(false)
  })

  it('retryable=true 而 retryPlan 缺失即拒（可重试必须有可执行计划）', () => {
    const { retryPlan: _drop, ...noPlan } = good
    expect(parseTriageVerdict(noPlan).ok).toBe(false)
  })

  it('estimatedCoreHours 负数即拒', () => {
    expect(parseTriageVerdict({ ...good, estimatedCoreHours: -1 }).ok).toBe(false)
  })
})

describe('parseInterpretVerdict', () => {
  const good = {
    schema: 'mat.interpret-verdict.v1',
    taskId: 'V1',
    converged: true,
    imaginaryFrequencies: 0,
    scientificallyUsable: true,
    headline: 'E=-76.4089539792 Hartree, 0 虚频, 极小值',
  }

  it('合法载荷通过', () => {
    expect(parseInterpretVerdict(good).ok).toBe(true)
  })

  it('imaginaryFrequencies 负数或非整数即拒', () => {
    expect(parseInterpretVerdict({ ...good, imaginaryFrequencies: -1 }).ok).toBe(false)
    expect(parseInterpretVerdict({ ...good, imaginaryFrequencies: 1.5 }).ok).toBe(false)
  })

  it('converged=false 而 scientificallyUsable=true 需在 concerns 里给理由', () => {
    expect(parseInterpretVerdict({ ...good, converged: false }).ok).toBe(false)
    expect(
      parseInterpretVerdict({ ...good, converged: false, concerns: ['freq 未收敛但几何可用'] }).ok,
    ).toBe(true)
  })
})

describe('verdictToLines（≤10 行紧凑渲染，主会话消费形态）', () => {
  it('三类裁决都渲染成 ≤10 行', () => {
    const prep = parsePrepVerdict({
      schema: 'mat.prep-verdict.v1',
      taskId: 'V1',
      ok: true,
      structure: 'x',
    })
    const triage = parseTriageVerdict({
      schema: 'mat.triage-verdict.v1',
      taskId: 'F1',
      failureClass: 'input',
      evidence: ['a', 'b'],
      retryable: false,
    })
    const interp = parseInterpretVerdict({
      schema: 'mat.interpret-verdict.v1',
      taskId: 'V1',
      converged: true,
      imaginaryFrequencies: 0,
      scientificallyUsable: true,
      headline: 'ok',
    })
    for (const r of [prep, triage, interp]) {
      expect(r.ok).toBe(true)
      if (r.ok) expect(verdictToLines(r.value).length).toBeLessThanOrEqual(10)
    }
  })
})
