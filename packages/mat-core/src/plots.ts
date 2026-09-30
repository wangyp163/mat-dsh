/**
 * plots.ts — 远端 workflow 产出的图谱 CSV 解析（R8a，纯逻辑层）。
 *
 * 数据来源：gaussian-workflow post 阶段产出的 plots 数组（PlotEntry[]），
 * 每个条目的 `data` 字段是 CSV 绝对路径，`image` 字段是 PNG（缺 matplotlib
 * 时为 null）。CSV 是权威数据——所有科学判断基于 CSV，不依赖图像。
 *
 * 设计原则：
 * - 纯函数，零 IO：调用方负责读取 CSV 文本，本模块只做解析与判断。
 * - fail-explicit：解析失败返回结构化 reason，不抛异常，不静默返回空结果。
 * - 契约稳定：列名约定来自 gaussian-workflow M13 IRC 产物契约（SKILL.md），
 *   若远端 workflow 改变 CSV 格式，只需在此处更新，上层消费不感知。
 *
 * IRC 产物契约（workflow 1.4.0+，SKILL.md M13）：
 *   irc_profile   — Total energy along IRC；列：signed_rxn_coord, energy_hartree
 *                   path 1 正值（forward branch），path 2 负值（reverse branch），TS=0
 *   reaction_path — R→TS→P 阶梯图；列：label, energy_hartree
 *                   label 取值：'R'（反应物端）、'TS'（过渡态点 0）、'P'（产物端）
 *
 * 注意：irc_profile 的两个分支不是标记分开的——用 signed_rxn_coord 的正负判断；
 * 点 0（rxn_coord=0 或最接近 0 的点）是 TS。
 */

// ---------------------------------------------------------------------------
// irc_profile
// ---------------------------------------------------------------------------

export interface IrcProfilePoint {
  /** 符号化反应坐标：正 = forward branch（path 1），负 = reverse（path 2），0 = TS。 */
  rxnCoord: number
  energyHartree: number
}

export interface IrcProfileResult {
  /** 全部数据点（已按 rxnCoord 升序排序）。 */
  points: IrcProfilePoint[]
  /** 总点数（含 TS）。 */
  pointCount: number
  /**
   * TS 点能量（rxnCoord 绝对值最小的点，理论上 = 0）。
   * null = 没有任何点，不应发生在合法 IRC 产物中。
   */
  tsEnergyHartree: number | null
  /**
   * Forward branch（rxnCoord > 0）末端能量。
   * null = 无正向分支（单向 IRC 的 reverse-only 场景）。
   */
  forwardEndEnergyHartree: number | null
  /**
   * Reverse branch（rxnCoord < 0）末端能量。
   * null = 无反向分支（单向 IRC 的 forward-only 场景）。
   */
  reverseEndEnergyHartree: number | null
  /**
   * Forward branch 是否单调下坡（从 TS 向末端能量递减）。
   * 判定方法：forward 点按 rxnCoord 升序，能量必须递减（允许数值抖动 ≤ jitterTolerance）。
   * null = 无 forward branch。
   */
  isForwardMonotonic: boolean | null
  /**
   * Reverse branch 是否单调下坡（从 TS 向末端能量递减）。
   * 判定方法：reverse 点按 rxnCoord 降序（即从 0 向更负值），能量递减。
   * null = 无 reverse branch。
   */
  isReverseMonotonic: boolean | null
  /**
   * 是否两分支均存在且均单调下坡（标准双向 IRC 通过的判断）。
   * false 包含三种情况：缺分支、分支能量上升、仅有 TS 点。
   */
  isBidirectionalDownhill: boolean
  /**
   * 解析或判断问题的描述（供 gate 失败的 reason 字段使用）。
   * 为空字符串时表示无问题。
   */
  diagnosticNote: string
}

/**
 * 能量抖动容忍度（Hartree）：IRC 路径上偶有数值微小回升（corrector 收敛残差）
 * 不代表真实势能上升。此阈值内的上升忽略，超出则判为非单调。
 * 0.001 Hartree ≈ 0.6 kcal/mol，合理的收敛残差范围。
 */
const IRC_ENERGY_JITTER_TOLERANCE_HARTREE = 0.001

/**
 * 解析 irc_profile CSV 文本，返回结构化判断结果。
 *
 * @param csvText  远端 irc_profile.csv 文件的原始内容（UTF-8 字符串）
 * @param opts     可选参数
 * @param opts.jitterTolerance  单调性判定的能量容忍阈值（Hartree，默认 0.001）
 */
export function parseIrcProfile(
  csvText: string,
  opts?: { jitterTolerance?: number },
): IrcProfileResult {
  const jitter = opts?.jitterTolerance ?? IRC_ENERGY_JITTER_TOLERANCE_HARTREE
  const notes: string[] = []

  // ── CSV 解析 ──
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) {
    return {
      points: [], pointCount: 0,
      tsEnergyHartree: null, forwardEndEnergyHartree: null, reverseEndEnergyHartree: null,
      isForwardMonotonic: null, isReverseMonotonic: null,
      isBidirectionalDownhill: false,
      diagnosticNote: 'irc_profile CSV is empty',
    }
  }

  // ── 列解析:头行列名必须真正用于取数 ──
  // workflow 1.7.3 的 irc_profile schema 是「无符号坐标 + path 列」:
  //   point,path,reaction_coordinate,energy_hartree(两支各自从 0.0 出发,
  //   支身份在 path 列,正负号不再编码方向)。旧 schema 是带符号坐标
  //   (rxn_coord<0 = 反向支)无 path 列。旧实现识别了头行却仍按 col0/col1
  //   位置取数——把 point/path 当坐标/能量解析,两支交错产生了 627.5
  //   kcal/mol 的人工跳变(r1 取证:门假阳性致链 dead_letter,物理正确)。
  const firstLine = lines[0]!
  const hasHeader = /[a-zA-Z]/.test(firstLine)
  let dataStart = hasHeader ? 1 : 0
  let rxnIdx = 0
  let enIdx = 1
  let pathIdx = -1
  if (hasHeader) {
    const headers = firstLine.split(',').map((h) => h.toLowerCase().replace(/\s+/g, '_'))
    const rxn = headers.findIndex((h) => h.includes('rxn') || h.includes('coord') || h.includes('reaction'))
    const en = headers.findIndex((h) => h.includes('energy') || h.includes('hartree'))
    const pt = headers.findIndex((h) => h === 'path' || h.includes('path_') || h.endsWith('path'))
    if (rxn !== -1 && en !== -1) {
      rxnIdx = rxn
      enIdx = en
      pathIdx = pt
    } else {
      notes.push(`irc_profile header unrecognized (got: ${firstLine.slice(0, 80)}); assuming col0=rxn_coord col1=energy`)
    }
  }

  const points: IrcProfilePoint[] = []
  /** 与 points 同长的支号(path 列 schema;无 path 列时恒 0 = 带符号坐标模式)。 */
  const branchOf: number[] = []
  const parseErrors: string[] = []
  for (let i = dataStart; i < lines.length; i += 1) {
    const cols = lines[i]!.split(',')
    const rxnCoord = parseFloat(cols[rxnIdx] ?? '')
    const energyHartree = parseFloat(cols[enIdx] ?? '')
    const branch = pathIdx >= 0 ? parseFloat(cols[pathIdx] ?? '') : 0
    if (!Number.isFinite(rxnCoord) || !Number.isFinite(energyHartree) || !Number.isFinite(branch)) {
      parseErrors.push(`line ${i + 1}: '${lines[i]!.slice(0, 60)}'`)
      continue
    }
    points.push({ rxnCoord, energyHartree })
    branchOf.push(branch)
  }
  if (parseErrors.length > 0) {
    notes.push(`${parseErrors.length} unparseable row(s): ${parseErrors.slice(0, 3).join('; ')}${parseErrors.length > 3 ? ' ...' : ''}`)
  }
  if (points.length === 0) {
    return {
      points: [], pointCount: 0,
      tsEnergyHartree: null, forwardEndEnergyHartree: null, reverseEndEnergyHartree: null,
      isForwardMonotonic: null, isReverseMonotonic: null,
      isBidirectionalDownhill: false,
      diagnosticNote: `irc_profile has no parseable data rows. ${notes.join(' ')}`.trim(),
    }
  }

  // ── 单调性判定公用 ──
  function isMonotonic(seq: IrcProfilePoint[]): boolean {
    for (let i = 1; i < seq.length; i += 1) {
      // 从 TS 向末端能量应递减（或持平在容忍范围内）
      if (seq[i]!.energyHartree > seq[i - 1]!.energyHartree + jitter) return false
    }
    return true
  }
  function maxRiseKcal(seq: IrcProfilePoint[]): number {
    return Math.max(...seq.slice(1).map((p, i) => p.energyHartree - seq[i]!.energyHartree)) * 627.5
  }

  // ── path 列 schema(workflow 1.7.3+):每支自 TS(支内坐标最小处)单调外推 ──
  if (pathIdx >= 0) {
    const byBranch = new Map<number, IrcProfilePoint[]>()
    points.forEach((p, i) => {
      const list = byBranch.get(branchOf[i]!) ?? []
      list.push(p)
      byBranch.set(branchOf[i]!, list)
    })
    for (const list of byBranch.values()) list.sort((a, b) => a.rxnCoord - b.rxnCoord)
    const branchIds = [...byBranch.keys()].sort((a, b) => a - b)
    if (branchIds.length > 2) notes.push(`${branchIds.length} path branches (>2): checking all of them`)
    // TS 参考:全局 |coord| 最小行(两支通常共享各自的 0.0 行;缺 0.0 行时
    // 由全局 TS 行补首,保证每支序列从同一 TS 能量出发)
    const tsPoint = points.reduce((a, b) => (Math.abs(a.rxnCoord) <= Math.abs(b.rxnCoord) ? a : b))
    const seqs = branchIds.map((id) => {
      const rows = byBranch.get(id)!
      return rows[0]!.rxnCoord === tsPoint.rxnCoord ? rows : [tsPoint, ...rows]
    })
    const monotonicPerBranch = seqs.map(isMonotonic)
    const [forwardSeq, reverseSeq] = seqs
    if (seqs.length < 2) notes.push(`only ${seqs.length} path branch (rxn direction encoded in the path column): single-direction IRC`)
    if (monotonicPerBranch[0] === false) {
      notes.push(`branch path=${branchIds[0]} not monotonically downhill (max upward step: ${maxRiseKcal(seqs[0]!).toFixed(2)} kcal/mol)`)
    }
    if (seqs.length > 1 && monotonicPerBranch[1] === false) {
      notes.push(`branch path=${branchIds[1]} not monotonically downhill (max upward step: ${maxRiseKcal(seqs[1]!).toFixed(2)} kcal/mol)`)
    }
    return {
      points,
      pointCount: points.length,
      tsEnergyHartree: tsPoint.energyHartree,
      forwardEndEnergyHartree: forwardSeq !== undefined ? forwardSeq[forwardSeq.length - 1]!.energyHartree : null,
      reverseEndEnergyHartree: reverseSeq !== undefined ? reverseSeq[reverseSeq.length - 1]!.energyHartree : null,
      isForwardMonotonic: monotonicPerBranch[0] ?? null,
      isReverseMonotonic: monotonicPerBranch[1] ?? null,
      isBidirectionalDownhill: seqs.length >= 2 && monotonicPerBranch.every((m) => m === true),
      diagnosticNote: notes.join('; '),
    }
  }

  // ── 带符号坐标 schema(旧):按 rxnCoord 升序排序 ──
  points.sort((a, b) => a.rxnCoord - b.rxnCoord)

  // ── TS 点（rxnCoord 绝对值最小）──
  const tsPoint = points.reduce((a, b) => Math.abs(a.rxnCoord) <= Math.abs(b.rxnCoord) ? a : b)
  const tsEnergy = tsPoint.energyHartree

  // ── 分支划分 ──
  const forwardBranch = points.filter((p) => p.rxnCoord > 0).sort((a, b) => a.rxnCoord - b.rxnCoord)
  const reverseBranch = points.filter((p) => p.rxnCoord < 0).sort((a, b) => b.rxnCoord - a.rxnCoord) // 从 0 向更负值
  const tsPlusForward = [tsPoint, ...forwardBranch]
  const tsPlusReverse = [tsPoint, ...reverseBranch]

  if (forwardBranch.length === 0) notes.push('no forward branch (rxn_coord > 0): single-direction IRC or all points at TS')
  if (reverseBranch.length === 0) notes.push('no reverse branch (rxn_coord < 0): single-direction IRC or all points at TS')

  const forwardEnd = forwardBranch.length > 0 ? forwardBranch[forwardBranch.length - 1]!.energyHartree : null
  const reverseEnd = reverseBranch.length > 0 ? reverseBranch[reverseBranch.length - 1]!.energyHartree : null

  // 单调性判断复用前述 isMonotonic/maxRiseKcal
  const fwdMonotonic = forwardBranch.length > 0 ? isMonotonic(tsPlusForward) : null
  const revMonotonic = reverseBranch.length > 0 ? isMonotonic(tsPlusReverse) : null

  if (fwdMonotonic === false) {
    notes.push(`forward branch not monotonically downhill (max upward step: ${maxRiseKcal(tsPlusForward).toFixed(2)} kcal/mol)`)
  }
  if (revMonotonic === false) {
    notes.push(`reverse branch not monotonically downhill (max upward step: ${maxRiseKcal(tsPlusReverse).toFixed(2)} kcal/mol)`)
  }

  const isBidirectionalDownhill = (fwdMonotonic === true) && (revMonotonic === true)

  return {
    points,
    pointCount: points.length,
    tsEnergyHartree: tsEnergy,
    forwardEndEnergyHartree: forwardEnd,
    reverseEndEnergyHartree: reverseEnd,
    isForwardMonotonic: fwdMonotonic,
    isReverseMonotonic: revMonotonic,
    isBidirectionalDownhill,
    diagnosticNote: notes.join('; '),
  }
}

// ---------------------------------------------------------------------------
// reaction_path（R→TS→P 阶梯）
// ---------------------------------------------------------------------------

export interface ReactionPathResult {
  /** kcal/mol，相对于最低点（通常为 R 或 P）的活化能；null = 数据不完整。 */
  activationEnergyKcalMol: number | null
  /** kcal/mol，P 相对于 R 的自由能差（Δ = P - R）；null = 缺 R 或 P。 */
  reactionEnergyKcalMol: number | null
  rEnergyHartree: number | null
  tsEnergyHartree: number | null
  pEnergyHartree: number | null
  diagnosticNote: string
}

const HARTREE_TO_KCAL = 627.5094740631

/** 解析 reaction_path CSV（R→TS→P 阶梯图）。列：label, energy_hartree。 */
export function parseReactionPath(csvText: string): ReactionPathResult {
  const lines = csvText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const notes: string[] = []
  const energies: Record<string, number> = {}

  for (const line of lines) {
    const cols = line.split(',')
    if (cols.length < 2) continue
    const label = (cols[0] ?? '').trim().toUpperCase()
    const energy = parseFloat(cols[1] ?? '')
    if ((label === 'R' || label === 'TS' || label === 'P') && Number.isFinite(energy)) {
      energies[label] = energy
    }
  }

  const r = energies['R'] ?? null
  const ts = energies['TS'] ?? null
  const p = energies['P'] ?? null

  if (r === null) notes.push('missing R row')
  if (ts === null) notes.push('missing TS row')
  if (p === null) notes.push('missing P row')

  const activation = (r !== null && ts !== null) ? (ts - r) * HARTREE_TO_KCAL : null
  const reaction = (r !== null && p !== null) ? (p - r) * HARTREE_TO_KCAL : null

  return {
    activationEnergyKcalMol: activation,
    reactionEnergyKcalMol: reaction,
    rEnergyHartree: r,
    tsEnergyHartree: ts,
    pEnergyHartree: p,
    diagnosticNote: notes.join('; '),
  }
}
