import { describe, expect, it } from 'vitest'
import {
  confirmationDigest,
  estimateCoreHoursFromRunJson,
  formatConfirmationSummary,
  summarizePre,
} from '../src/confirmation'
import { defaultPreJson, defaultRunJson } from '../src/gaussian'

/** D0 P2 确认闸投影：字段覆盖、摘要确定性、核时估算（默认 32 核半小时 = 16 核时）。 */

describe('summarizePre（投影）', () => {
  it('默认配置投影出全部关键字段', () => {
    const s = summarizePre(defaultPreJson(), defaultRunJson())
    expect(s.method).toBe('B3LYP')
    expect(s.basis).toBe('6-31G(d)')
    expect(s.charge).toBe(0)
    expect(s.mult).toBe(1)
    expect(s.ncores).toBe(32)
    expect(s.memory).toBe('64GB')
    expect(s.partition).toBe('kshcnormal')
    expect(s.walltime).toBe('00:30:00')
    expect(s.estimatedCoreHours).toBe(16)
  })

  it('自定义 run_json 的 partition 进入投影（生效值而非入参）', () => {
    const s = summarizePre(defaultPreJson(), { slurm: { partition: 'CustomQueue', nodes: 2, ntasks_per_node: 16, time: '01:00:00', mem: '128GB' } })
    expect(s.partition).toBe('CustomQueue')
    expect(s.estimatedCoreHours).toBe(32) // 2×16×1h
  })

  it('畸形输入不炸，缺失字段落 -/null', () => {
    const s = summarizePre({}, {})
    expect(s.method).toBe('')
    expect(s.charge).toBeNull()
    expect(s.estimatedCoreHours).toBeNull()
  })
})

describe('confirmationDigest（摘要）', () => {
  it('同配置同摘要；改 walltime 即变（规范键序 + sha256 hex64）', () => {
    const a = confirmationDigest(summarizePre(defaultPreJson(), defaultRunJson()))
    const b = confirmationDigest(summarizePre(defaultPreJson(), defaultRunJson()))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    const c = confirmationDigest(summarizePre(defaultPreJson(), defaultRunJson('OtherQueue')))
    expect(c).not.toBe(a)
  })

  it('formatConfirmationSummary 含四类签字要素 + digest', () => {
    const s = summarizePre(defaultPreJson(), defaultRunJson())
    const text = formatConfirmationSummary(s, confirmationDigest(s))
    expect(text).toContain('B3LYP / 6-31G(d) / 0 / 1')
    expect(text).toContain('32 cores, 64GB')
    expect(text).toContain('partition=kshcnormal')
    expect(text).toContain('estimated core-hours     : 16')
    expect(text).toMatch(/digest\s+: [0-9a-f]{64}/)
  })
})

describe('estimateCoreHoursFromRunJson', () => {
  it('32 核 × 0.5h = 16；畸形 null', () => {
    expect(estimateCoreHoursFromRunJson(defaultRunJson())).toBe(16)
    expect(estimateCoreHoursFromRunJson({ slurm: { nodes: 1, ntasks_per_node: 32, time: 'xx' } })).toBeNull()
    expect(estimateCoreHoursFromRunJson(undefined)).toBeNull()
  })
})
