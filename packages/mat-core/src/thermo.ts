/**
 * thermo.ts — 反应能学对账（R9b，纯逻辑层）。
 *
 * 目标：把「算完之后的科学结论」从 LLM 的字符串拼接里拿出来变成代码。
 *
 * 此前的状况：opt+freq 产出的热化学十键全量透传进 job_output 给模型看，
 * 模型自己挑数、自己做减法、自己换单位。三个问题：
 *   1. Hartree→kcal/mol 的换算靠模型心算，错了没人发现；
 *   2. 用电子能还是自由能做垒高全凭模型当时的判断，不可复现；
 *   3. 没有任何地方检查「热化学数据是否存在」——缺 freq 的体系也能被
 *      报出一个「自由能垒」，实际上那只是电子能差。
 *
 * 本模块只做算术与可用性判定，不读库不读文件；调用方（工具层）负责取数。
 */

/** Hartree → kcal/mol（CODATA 2018）。 */
export const HARTREE_TO_KCAL_MOL = 627.5094740631

/** 参与反应能学计算的单点能量集合（一个物种一条）。 */
export interface SpeciesEnergies {
  /** 体系标签（DB 的 structure 列）。 */
  label: string
  /** 电子能（Hartree）；null = 该物种无可用结果。 */
  energyHartree: number | null
  /**
   * 电子能 + 热校正的吉布斯自由能总和（Hartree，workflow 的
   * sum_electronic_free_energy_hartree）；null = 未做 freq 或旧版 workflow。
   */
  sumElectronicFreeEnergyHartree: number | null
  /** 电子能 + 焓校正（Hartree）；null 同上。 */
  sumElectronicEnthalpyHartree: number | null
  /** 该结果是否收敛（null = 未知）。 */
  converged: boolean | null
}

/** 能量基准：自由能优先，回落焓，再回落电子能。 */
export type EnergyBasis = 'gibbs' | 'enthalpy' | 'electronic'

export interface ReactionEnergyResult {
  /** 实际采用的能量基准（三者中最高可用档）。 */
  basis: EnergyBasis
  /**
   * 活化自由能 ΔG‡（kcal/mol）= TS - 反应物。
   * null = 缺 TS 或反应物在该基准下的数据。
   */
  activationKcalMol: number | null
  /**
   * 反应自由能 ΔG（kcal/mol）= 产物 - 反应物。
   * null = 缺产物或反应物。
   */
  reactionKcalMol: number | null
  /** 逆向活化能（kcal/mol）= TS - 产物；用于判断可逆性。 */
  reverseActivationKcalMol: number | null
  /** 采用的原始数值（Hartree），便于审计换算。 */
  raw: { reactant: number | null; ts: number | null; product: number | null }
  /**
   * 数据可用性与科学有效性的警告清单。非空**不代表结果错误**，
   * 但每一条都必须转述给用户——例如「基准回落到电子能」意味着
   * 报出的不是自由能垒。
   */
  warnings: string[]
}

function pick(species: SpeciesEnergies | undefined, basis: EnergyBasis): number | null {
  if (species === undefined) return null
  if (basis === 'gibbs') return species.sumElectronicFreeEnergyHartree
  if (basis === 'enthalpy') return species.sumElectronicEnthalpyHartree
  return species.energyHartree
}

/**
 * 选择能同时覆盖「已提供的全部物种」的最高能量基准。
 *
 * 纪律：基准必须对所有参与物种一致——用 TS 的自由能减反应物的电子能
 * 是没有物理意义的，但纯靠模型自觉很容易发生。这里强制同基准。
 */
export function selectEnergyBasis(species: SpeciesEnergies[]): { basis: EnergyBasis; warnings: string[] } {
  const present = species.filter((s) => s !== undefined)
  const warnings: string[] = []
  const allHave = (basis: EnergyBasis): boolean =>
    present.length > 0 && present.every((s) => pick(s, basis) !== null)

  if (allHave('gibbs')) return { basis: 'gibbs', warnings }
  if (allHave('enthalpy')) {
    warnings.push('no Gibbs free energy for all species — fell back to enthalpy basis (sum_electronic_enthalpy)')
    return { basis: 'enthalpy', warnings }
  }
  const missingThermo = present
    .filter((s) => s.sumElectronicFreeEnergyHartree === null)
    .map((s) => s.label)
  warnings.push(
    `no thermochemistry for ${missingThermo.join(', ') || 'some species'} — fell back to ELECTRONIC energy. ` +
    'The reported barrier is NOT a free-energy barrier; run opt+freq (workflow ≥1.6.3) on these species for ΔG‡.',
  )
  return { basis: 'electronic', warnings }
}

/**
 * 计算反应能学（活化能 / 反应能 / 逆向活化能）。
 *
 * @param input.reactant 反应物（必需才能得任何相对量）
 * @param input.ts       过渡态（缺则活化能为 null）
 * @param input.product  产物（缺则反应能为 null）
 */
export function computeReactionEnergy(input: {
  reactant?: SpeciesEnergies
  ts?: SpeciesEnergies
  product?: SpeciesEnergies
}): ReactionEnergyResult {
  const provided = [input.reactant, input.ts, input.product].filter(
    (s): s is SpeciesEnergies => s !== undefined,
  )
  const { basis, warnings } = selectEnergyBasis(provided)

  const r = pick(input.reactant, basis)
  const ts = pick(input.ts, basis)
  const p = pick(input.product, basis)

  // 收敛性检查：未收敛的结果做能量差没有意义
  for (const s of provided) {
    if (s.converged === false) {
      warnings.push(`${s.label} is NOT converged — its energy is unusable for reaction energetics`)
    } else if (s.converged === null) {
      warnings.push(`${s.label} convergence unknown — verify before quoting these numbers`)
    }
  }
  if (input.reactant === undefined) warnings.push('no reactant provided — all relative energies are null')
  if (input.ts === undefined) warnings.push('no transition state provided — activation energy unavailable')
  if (input.product === undefined) warnings.push('no product provided — reaction energy unavailable')

  const diff = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : (a - b) * HARTREE_TO_KCAL_MOL

  const activation = diff(ts, r)
  const reaction = diff(p, r)
  const reverseActivation = diff(ts, p)

  // 科学合理性：TS 必须高于两端，否则不是真鞍点（或配错了物种）
  if (activation !== null && activation < 0) {
    warnings.push(
      `activation energy is NEGATIVE (${activation.toFixed(2)} kcal/mol) — the "TS" lies below the reactant. ` +
      'Either the species are mismatched or that geometry is not the transition state for this step.',
    )
  }
  if (reverseActivation !== null && reverseActivation < 0) {
    warnings.push(
      `reverse activation energy is NEGATIVE (${reverseActivation.toFixed(2)} kcal/mol) — the "TS" lies below the product.`,
    )
  }

  return {
    basis,
    activationKcalMol: activation,
    reactionKcalMol: reaction,
    reverseActivationKcalMol: reverseActivation,
    raw: { reactant: r, ts, product: p },
    warnings,
  }
}

/** 人类可读呈现（工具输出用；数字统一两位小数，基准与警告显式标注）。 */
export function formatReactionEnergy(result: ReactionEnergyResult): string {
  const basisLabel: Record<EnergyBasis, string> = {
    gibbs: 'Gibbs free energy (ΔG, sum_electronic_free_energy)',
    enthalpy: 'enthalpy (ΔH, sum_electronic_enthalpy)',
    electronic: 'ELECTRONIC energy only (ΔE — not a free-energy barrier)',
  }
  const num = (v: number | null, unit = 'kcal/mol'): string =>
    v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} ${unit}`

  const lines = [
    `basis                   : ${basisLabel[result.basis]}`,
    `activation ΔG‡ (fwd)    : ${num(result.activationKcalMol)}`,
    `reaction ΔG             : ${num(result.reactionKcalMol)}`,
    `activation ΔG‡ (rev)    : ${num(result.reverseActivationKcalMol)}`,
    '',
    'raw (Hartree, for audit):',
    `  reactant = ${result.raw.reactant ?? '—'}`,
    `  ts       = ${result.raw.ts ?? '—'}`,
    `  product  = ${result.raw.product ?? '—'}`,
  ]
  if (result.warnings.length > 0) {
    lines.push('', 'WARNINGS (report every one of these to the user):')
    for (const w of result.warnings) lines.push(`  - ${w}`)
  }
  return lines.join('\n')
}
