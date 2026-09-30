import { describe, expect, it } from 'vitest'
import {
  HARTREE_TO_KCAL_MOL,
  computeReactionEnergy,
  formatReactionEnergy,
  selectEnergyBasis,
  type SpeciesEnergies,
} from '../src/thermo'

/**
 * R9b：反应能学对账（纯逻辑）。
 *
 * 纪律要点（每条都有对应用例）：
 * 1. 基准必须对所有物种一致——不允许 TS 用自由能、反应物用电子能；
 * 2. 热化学缺失时回落到电子能，但必须**显式警告**报出的不是自由能垒；
 * 3. 未收敛的结果做能量差没有意义，必须警告；
 * 4. TS 低于两端 = 物种配错或那不是鞍点，必须警告（负活化能）。
 */

/** 甲醇脱氢体系的量级（数值为构造，量级取自真实 B3LYP/6-31G(d) 水分子附近）。 */
function species(
  label: string,
  e: number | null,
  g: number | null = null,
  h: number | null = null,
  converged: boolean | null = true,
): SpeciesEnergies {
  return {
    label,
    energyHartree: e,
    sumElectronicFreeEnergyHartree: g,
    sumElectronicEnthalpyHartree: h,
    converged,
  }
}

describe('selectEnergyBasis', () => {
  it('全部物种有自由能 → gibbs，无警告', () => {
    const r = selectEnergyBasis([
      species('R', -76.52, -76.49),
      species('TS', -76.45, -76.42),
    ])
    expect(r.basis).toBe('gibbs')
    expect(r.warnings).toEqual([])
  })

  it('部分缺自由能但全有焓 → enthalpy 且警告回落', () => {
    const r = selectEnergyBasis([
      species('R', -76.52, null, -76.50),
      species('TS', -76.45, null, -76.43),
    ])
    expect(r.basis).toBe('enthalpy')
    expect(r.warnings.join()).toMatch(/fell back to enthalpy/)
  })

  it('只有电子能 → electronic 且警告点名「不是自由能垒」与缺数物种', () => {
    const r = selectEnergyBasis([
      species('R', -76.52),
      species('TS', -76.45),
    ])
    expect(r.basis).toBe('electronic')
    expect(r.warnings.join()).toMatch(/NOT a free-energy barrier/)
    expect(r.warnings.join()).toMatch(/opt\+freq/)
    expect(r.warnings.join()).toMatch(/R, TS/)
  })

  it('混合情形不得挑最高档：只要有一个物种缺自由能就整体回落', () => {
    const r = selectEnergyBasis([
      species('R', -76.52, -76.49),   // 有自由能
      species('TS', -76.45, null),    // 缺自由能
    ])
    expect(r.basis).not.toBe('gibbs')
  })
})

describe('computeReactionEnergy', () => {
  it('自由能基准：ΔG‡ 与 ΔG 的换算与手算一致', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.52, -76.490000),
      ts: species('TS', -76.45, -76.420000),
      product: species('P', -76.525, -76.495000),
    })
    expect(r.basis).toBe('gibbs')
    // ΔG‡ = (-76.42 - (-76.49)) × 627.509... = +43.93 kcal/mol
    expect(r.activationKcalMol).toBeCloseTo((-76.42 - -76.49) * HARTREE_TO_KCAL_MOL, 6)
    expect(r.reactionKcalMol).toBeCloseTo((-76.495 - -76.49) * HARTREE_TO_KCAL_MOL, 6)
    expect(r.reverseActivationKcalMol).toBeCloseTo((-76.42 - -76.495) * HARTREE_TO_KCAL_MOL, 6)
    // 放行：活化能为正、收敛齐全
    expect(r.warnings).toEqual([])
  })

  it('raw 保留 Hartree 原值供审计（换算可复核）', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.52, -76.49),
      ts: species('TS', -76.45, -76.42),
    })
    expect(r.raw.reactant).toBe(-76.49)
    expect(r.raw.ts).toBe(-76.42)
    expect(r.raw.product).toBeNull()
  })

  it('缺 TS → 活化能 null 且警告；反应能仍可得', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.52, -76.49),
      product: species('P', -76.525, -76.495),
    })
    expect(r.activationKcalMol).toBeNull()
    expect(r.reactionKcalMol).not.toBeNull()
    expect(r.warnings.join()).toMatch(/no transition state provided/)
  })

  it('缺反应物 → 所有相对量为 null', () => {
    const r = computeReactionEnergy({ ts: species('TS', -76.45, -76.42) })
    expect(r.activationKcalMol).toBeNull()
    expect(r.reactionKcalMol).toBeNull()
    expect(r.warnings.join()).toMatch(/no reactant provided/)
  })

  it('未收敛物种 → 警告点名（能量差无意义）', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.52, -76.49, null, true),
      ts: species('TS-bad', -76.45, -76.42, null, false),
    })
    expect(r.warnings.join()).toMatch(/TS-bad is NOT converged/)
  })

  it('收敛状态未知 → 警告要求核实', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.52, -76.49, null, null),
      ts: species('TS', -76.45, -76.42, null, true),
    })
    expect(r.warnings.join()).toMatch(/convergence unknown/)
  })

  it('负活化能（TS 低于反应物）→ 警告物种配错或非鞍点', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.45, -76.42),
      ts: species('TS', -76.52, -76.49),   // 比反应物还低
    })
    expect(r.activationKcalMol!).toBeLessThan(0)
    expect(r.warnings.join()).toMatch(/activation energy is NEGATIVE/)
    expect(r.warnings.join()).toMatch(/mismatched|not the transition state/)
  })

  it('TS 低于产物 → 逆向活化能为负并警告', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.60, -76.57),
      ts: species('TS', -76.50, -76.47),
      product: species('P', -76.45, -76.42),   // 产物比 TS 高
    })
    expect(r.reverseActivationKcalMol!).toBeLessThan(0)
    expect(r.warnings.join()).toMatch(/reverse activation energy is NEGATIVE/)
  })

  it('电子能回落路径：仍算出数值，但警告说明不是自由能垒', () => {
    const r = computeReactionEnergy({
      reactant: species('R', -76.520000),
      ts: species('TS', -76.450000),
    })
    expect(r.basis).toBe('electronic')
    expect(r.activationKcalMol).toBeCloseTo((-76.45 - -76.52) * HARTREE_TO_KCAL_MOL, 6)
    expect(r.warnings.join()).toMatch(/NOT a free-energy barrier/)
  })
})

describe('formatReactionEnergy', () => {
  it('标注基准、带符号数值、raw 审计段与全部警告', () => {
    const out = formatReactionEnergy(computeReactionEnergy({
      reactant: species('R', -76.52, -76.49),
      ts: species('TS', -76.45, -76.42),
      product: species('P', -76.525, -76.495),
    }))
    expect(out).toMatch(/basis\s+: Gibbs free energy/)
    expect(out).toMatch(/\+43\.\d\d kcal\/mol/)      // 活化能带正号
    expect(out).toMatch(/raw \(Hartree, for audit\)/)
    expect(out).not.toMatch(/WARNINGS/)              // 干净路径无警告段
  })

  it('电子能回落时 basis 行明确写「not a free-energy barrier」且有 WARNINGS 段', () => {
    const out = formatReactionEnergy(computeReactionEnergy({
      reactant: species('R', -76.52),
      ts: species('TS', -76.45),
    }))
    expect(out).toMatch(/ELECTRONIC energy only/)
    expect(out).toMatch(/not a free-energy barrier/)
    expect(out).toMatch(/WARNINGS/)
  })

  it('缺值渲染为破折号不是 null/NaN', () => {
    const out = formatReactionEnergy(computeReactionEnergy({ reactant: species('R', -76.52, -76.49) }))
    expect(out).toMatch(/activation ΔG‡ \(fwd\)\s+: —/)
    expect(out).not.toMatch(/null|NaN/)
  })
})
