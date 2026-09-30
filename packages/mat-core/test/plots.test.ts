import { describe, expect, it } from 'vitest'
import { parseIrcProfile, parseReactionPath } from '../src/plots'

/**
 * R8a：图谱 CSV 解析（纯逻辑）。
 *
 * 这是仓库里第一条「从结果数据到结构化科学判断」的代码路径——此前 plots 的
 * CSV 只是路径字符串透传给模型，没有任何代码读过内容。
 *
 * 用例取自 irc-methods.md 的方法学与 irc-l123-divergence.md 的真实失败形态：
 * - 正常双向 IRC：TS 在 0，两分支向外单调下坡
 * - corrector 发散（真实案例 r6 D15 / r7 D17 / 会话 4bd8fec0）：分支能量回升
 * - 单向 IRC（forward/reverse 关键字）：只有一个分支，属合法产物不报错
 */

/** 正常双向 IRC：TS 在 0 为最高点，两侧单调下坡。 */
const HEALTHY_IRC = `signed_rxn_coord,energy_hartree
-3.0,-76.520000
-2.0,-76.510000
-1.0,-76.490000
0.0,-76.450000
1.0,-76.495000
2.0,-76.515000
3.0,-76.525000
`

/**
 * workflow 1.7.3+ 的「无符号坐标 + path 列」schema(r1 回归 fixture)。
 * 列名与数值形态取自 hcn-hshift 链 03-irc/irc_profile.csv 真实产物
 * (path1: -93.342898→-93.3929;path2: -93.342898→-93.4218,两支单调下坡)。
 */
const PATH_COLUMN_IRC = `point,path,reaction_coordinate,energy_hartree
0,1,0.0,-93.3428982077
1,1,0.10797,-93.3431797405
2,1,0.2159,-93.3439841886
3,1,0.32384,-93.3452246717
0,2,0.0,-93.3428982077
4,2,0.43178,-93.3467893108
5,2,0.53971,-93.3485596519
6,2,0.64764,-93.3504338475
`

/** 发散 IRC：forward 分支中途能量回升（corrector 未收敛的典型形态）。 */
const DIVERGENT_FORWARD = `signed_rxn_coord,energy_hartree
-2.0,-76.510000
-1.0,-76.490000
0.0,-76.450000
1.0,-76.470000
2.0,-76.430000
`

/** 单向 IRC（只有 forward）：合法产物，reverse 分支缺失不算错误。 */
const FORWARD_ONLY = `signed_rxn_coord,energy_hartree
0.0,-76.450000
1.0,-76.480000
2.0,-76.500000
`

describe('parseIrcProfile', () => {
  it('正常双向 IRC：两分支单调下坡，isBidirectionalDownhill=true', () => {
    const r = parseIrcProfile(HEALTHY_IRC)
    expect(r.pointCount).toBe(7)
    expect(r.tsEnergyHartree).toBeCloseTo(-76.45, 6)
    expect(r.forwardEndEnergyHartree).toBeCloseTo(-76.525, 6)
    expect(r.reverseEndEnergyHartree).toBeCloseTo(-76.52, 6)
    expect(r.isForwardMonotonic).toBe(true)
    expect(r.isReverseMonotonic).toBe(true)
    expect(r.isBidirectionalDownhill).toBe(true)
    expect(r.diagnosticNote).toBe('')
  })

  // ── workflow 1.7.3+ 的「无符号坐标 + path 列」schema(r1 修复回归) ──
  // r1 压测取证:旧实现识别头行却仍按 col0/col1 位置取数,把 point/path 当
  // 坐标/能量解析,两支交错产生 627.5 kcal/mol 人工跳变 → 方向门假阳性,
  // 物理正确的链被拦死信(hcn-hshift 链 diag/att-001 取证)。fixture 取自
  // 该链 03-irc/irc_profile.csv 真实形态(列名/首尾行原样)。
  it('path 列 schema(1.7.3):两支各自单调下坡 → 双向下坡成立(假阳性回归)', () => {
    const r = parseIrcProfile(PATH_COLUMN_IRC)
    expect(r.pointCount).toBe(8)
    expect(r.tsEnergyHartree).toBeCloseTo(-93.3428982077, 9)
    expect(r.forwardEndEnergyHartree).toBeCloseTo(-93.3452246717, 9)
    expect(r.reverseEndEnergyHartree).toBeCloseTo(-93.3504338475, 9)
    expect(r.isForwardMonotonic).toBe(true)
    expect(r.isReverseMonotonic).toBe(true)
    expect(r.isBidirectionalDownhill).toBe(true)
    expect(r.diagnosticNote).toBe('')
  })

  it('path 列 schema:某支回升 → 非单调且诊断点名支号与幅度', () => {
    const divergent = PATH_COLUMN_IRC.replace('-93.3439841886', '-93.3400000000')
    const r = parseIrcProfile(divergent)
    expect(r.isForwardMonotonic).toBe(false)
    expect(r.isBidirectionalDownhill).toBe(false)
    expect(r.diagnosticNote).toMatch(/path=1 not monotonically downhill/)
    expect(r.diagnosticNote).toMatch(/kcal\/mol/)
  })

  it('path 列 schema:仅剩一支 → 单向 IRC 语义,不误判', () => {
    const single = PATH_COLUMN_IRC.split('\n').filter((l) => !/^[^,]+,2,/.test(l)).join('\n')
    const r = parseIrcProfile(single)
    expect(r.isForwardMonotonic).toBe(true)
    expect(r.isReverseMonotonic).toBeNull()
    expect(r.isBidirectionalDownhill).toBe(false)
    expect(r.diagnosticNote).toMatch(/single-direction/)
  })

  it('头行命中的列名真正用于取数(非 path 列但列序颠倒也不再错位)', () => {
    // 能量列在前、坐标列在后的头行:旧实现按 col0/col1 位置取数会颠倒
    const swapped = `energy_hartree,signed_rxn_coord
-76.52,-3.0
-76.45,0.0
-76.525,3.0
`
    const r = parseIrcProfile(swapped)
    expect(r.tsEnergyHartree).toBeCloseTo(-76.45, 6)
    expect(r.isBidirectionalDownhill).toBe(true)
  })

  it('TS 是能量最高点（两分支末端都低于 TS）', () => {
    const r = parseIrcProfile(HEALTHY_IRC)
    expect(r.forwardEndEnergyHartree!).toBeLessThan(r.tsEnergyHartree!)
    expect(r.reverseEndEnergyHartree!).toBeLessThan(r.tsEnergyHartree!)
  })

  it('发散 IRC：forward 分支能量回升 → 非单调，诊断说明含 kcal/mol 幅度', () => {
    const r = parseIrcProfile(DIVERGENT_FORWARD)
    expect(r.isForwardMonotonic).toBe(false)
    expect(r.isReverseMonotonic).toBe(true)
    expect(r.isBidirectionalDownhill).toBe(false)
    expect(r.diagnosticNote).toMatch(/forward branch not monotonically downhill/)
    expect(r.diagnosticNote).toMatch(/kcal\/mol/)
  })

  it('单向 IRC（仅 forward）：reverse 为 null 不误判为失败单调性', () => {
    const r = parseIrcProfile(FORWARD_ONLY)
    expect(r.isForwardMonotonic).toBe(true)
    expect(r.isReverseMonotonic).toBeNull()
    expect(r.reverseEndEnergyHartree).toBeNull()
    // 单向 IRC 不满足双向下坡（调用方据此决定是否要求双向）
    expect(r.isBidirectionalDownhill).toBe(false)
    expect(r.diagnosticNote).toMatch(/no reverse branch/)
  })

  it('抖动容忍：容忍阈值内的微小回升仍判单调', () => {
    // 回升 0.0005 Hartree（约 0.3 kcal/mol），在默认 0.001 容忍内
    const jittery = `signed_rxn_coord,energy_hartree
0.0,-76.450000
1.0,-76.480000
2.0,-76.479500
3.0,-76.500000
`
    expect(parseIrcProfile(jittery).isForwardMonotonic).toBe(true)
    // 收紧容忍到 0 则判非单调
    expect(parseIrcProfile(jittery, { jitterTolerance: 0 }).isForwardMonotonic).toBe(false)
  })

  it('空 CSV / 无数据行：结构化返回，不抛异常', () => {
    const empty = parseIrcProfile('')
    expect(empty.pointCount).toBe(0)
    expect(empty.isBidirectionalDownhill).toBe(false)
    expect(empty.diagnosticNote).toMatch(/empty/)

    const headerOnly = parseIrcProfile('signed_rxn_coord,energy_hartree\n')
    expect(headerOnly.pointCount).toBe(0)
    expect(headerOnly.diagnosticNote).toMatch(/no parseable data rows/)
  })

  it('坏数据行被跳过并计入诊断，好行仍解析', () => {
    const partial = `signed_rxn_coord,energy_hartree
-1.0,-76.490000
garbage,notanumber
0.0,-76.450000
1.0,-76.495000
`
    const r = parseIrcProfile(partial)
    expect(r.pointCount).toBe(3)
    expect(r.diagnosticNote).toMatch(/unparseable row/)
  })

  it('无头行的裸数据 CSV 也能解析', () => {
    const noHeader = `-1.0,-76.490000
0.0,-76.450000
1.0,-76.495000
`
    const r = parseIrcProfile(noHeader)
    expect(r.pointCount).toBe(3)
    expect(r.tsEnergyHartree).toBeCloseTo(-76.45, 6)
  })

  it('乱序输入按 rxnCoord 升序归一', () => {
    const shuffled = `signed_rxn_coord,energy_hartree
2.0,-76.515000
-1.0,-76.490000
0.0,-76.450000
1.0,-76.495000
`
    const r = parseIrcProfile(shuffled)
    expect(r.points.map((p) => p.rxnCoord)).toEqual([-1, 0, 1, 2])
    expect(r.isForwardMonotonic).toBe(true)
  })
})

describe('parseReactionPath', () => {
  it('R/TS/P 三行 → 活化能与反应能（kcal/mol）', () => {
    // R=-76.52, TS=-76.45, P=-76.525 → Ea=+43.9, ΔE=-3.1 kcal/mol
    const csv = `label,energy_hartree
R,-76.520000
TS,-76.450000
P,-76.525000
`
    const r = parseReactionPath(csv)
    expect(r.rEnergyHartree).toBeCloseTo(-76.52, 6)
    expect(r.activationEnergyKcalMol).toBeCloseTo(((-76.45) - (-76.52)) * 627.5094740631, 4)
    expect(r.reactionEnergyKcalMol).toBeCloseTo(((-76.525) - (-76.52)) * 627.5094740631, 4)
    expect(r.diagnosticNote).toBe('')
  })

  it('缺 P 行（单向 IRC）：reactionEnergy 为 null，活化能仍可得', () => {
    const csv = `label,energy_hartree
R,-76.520000
TS,-76.450000
`
    const r = parseReactionPath(csv)
    expect(r.activationEnergyKcalMol).not.toBeNull()
    expect(r.reactionEnergyKcalMol).toBeNull()
    expect(r.diagnosticNote).toMatch(/missing P row/)
  })

  it('标签大小写与空格容忍', () => {
    const csv = ` r , -76.520000
 ts , -76.450000
 p , -76.525000
`
    const r = parseReactionPath(csv)
    expect(r.rEnergyHartree).toBeCloseTo(-76.52, 6)
    expect(r.tsEnergyHartree).toBeCloseTo(-76.45, 6)
    expect(r.pEnergyHartree).toBeCloseTo(-76.525, 6)
  })

  it('空 CSV：三值全 null 且诊断列出缺失', () => {
    const r = parseReactionPath('')
    expect(r.rEnergyHartree).toBeNull()
    expect(r.activationEnergyKcalMol).toBeNull()
    expect(r.diagnosticNote).toMatch(/missing R row/)
  })
})
