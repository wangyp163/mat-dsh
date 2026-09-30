import { describe, expect, it } from 'vitest'
import { checkIrcDirectionGate, checkSettledWave, checkWaveGate } from '../src/wave-gate'
import type { TaskPackage, TaskPackageWave } from '../src/task-package'

/**
 * R4 波间门检纯逻辑：前序波必须已结算且过门（ts 波 = converged 且虚频恰为 1），
 * 否则拒绝进入下一波——M22 从 runbook 文本纪律升级为结构化判定。
 */

function wave(id: number, task: string, gate: TaskPackageWave['gate']): TaskPackageWave {
  return { id, task, dependsOn: [], gate, preJson: {}, runJson: {}, postJson: {}, reusable: false }
}

function pkg(): TaskPackage {
  return {
    schema_version: 'aimater.taskpackage.v1',
    engine: 'gaussian',
    status: 'ready',
    task: 'tsxtb+ts+irc',
    waves: [
      wave(1, 'tsxtb', null),
      wave(2, 'ts', { converged: true, imaginary_frequency_count: 1 }),
      wave(3, 'irc', null),
    ],
    questions: [],
    assumptions: [],
    estimatedCoreHours: 18,
    digest: 'd'.repeat(64),
    execution: { mode: 'stepwise', instructions: [] },
  }
}

const OK_RESULT = {
  properties: {
    'tsxtb.energy': -76.4,
    'ts.converged': true,
    'ts.imaginary_frequency_count': 1,
  },
}

describe('checkWaveGate', () => {
  it('首波无前置门直接放行（不读 result）', () => {
    expect(checkWaveGate(pkg(), 1, undefined)).toEqual({ ok: true })
  })

  it('前序波全部结算且过门放行（扁平点号键）', () => {
    expect(checkWaveGate(pkg(), 3, OK_RESULT)).toEqual({ ok: true })
  })

  it('嵌套 properties 形态同样支持', () => {
    const nested = { properties: { tsxtb: { energy: -76.4 }, ts: { converged: true, imaginary_frequency_count: 1 } } }
    expect(checkWaveGate(pkg(), 3, nested)).toEqual({ ok: true })
  })

  it('前序波未结算（result.json 无该 task 键）拒绝并指向 post', () => {
    const r = checkWaveGate(pkg(), 2, { properties: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/wave 1 \(tsxtb\) not settled/)
  })

  it('ts 收敛但虚频=0（极小点）拒绝——不得接 IRC', () => {
    const r = checkWaveGate(pkg(), 3, {
      properties: { 'tsxtb.energy': -76.4, 'ts.converged': true, 'ts.imaginary_frequency_count': 0 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/imaginary_frequency_count=0.*极小点/)
  })

  it('虚频≥2（高阶鞍点）同样拒绝', () => {
    const r = checkWaveGate(pkg(), 3, {
      properties: { 'tsxtb.energy': -76.4, 'ts.converged': true, 'ts.imaginary_frequency_count': 2 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/高阶鞍点/)
  })

  it('ts 未收敛拒绝', () => {
    const r = checkWaveGate(pkg(), 3, {
      properties: { 'tsxtb.energy': -76.4, 'ts.converged': false, 'ts.imaginary_frequency_count': 1 },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/converged=false/)
  })

  it('wave_id 不在包内拒绝', () => {
    const r = checkWaveGate(pkg(), 9, OK_RESULT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/wave 9 not in task package/)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// R7b：最小真实频率下限
// ───────────────────────────────────────────────────────────────────────────

describe('checkSettledWave — R7b 频率下限门', () => {
  const tsWave = (min?: number) => ({
    id: 2, task: 'ts',
    gate: { converged: true, imaginary_frequency_count: 1, ...(min !== undefined ? { min_real_frequency_cm1: min } : {}) },
  })

  it('虚频=1 且最小正频高于下限 → 放行', () => {
    const r = checkSettledWave(tsWave(10), {
      properties: {
        'ts.converged': true,
        'ts.imaginary_frequency_count': 1,
        'ts.frequencies_cm-1': [-450.2, 35.6, 1620.1, 3400.5],
      },
    })
    expect(r).toEqual({ ok: true })
  })

  it('虚频=1 但最小正频低于下限 → 拒绝（干净一阶鞍点不能只数虚频个数）', () => {
    const r = checkSettledWave(tsWave(10), {
      properties: {
        'ts.converged': true,
        'ts.imaginary_frequency_count': 1,
        'ts.frequencies_cm-1': [-450.2, 3.1, 1620.1],
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/min real frequency 3\.10/)
      expect(r.reason).toMatch(/平台区|一阶鞍点/)
    }
  })

  it('未设 min_real_frequency_cm1 → 不做频率判断（向后兼容）', () => {
    const r = checkSettledWave(tsWave(), {
      properties: { 'ts.converged': true, 'ts.imaginary_frequency_count': 1, 'ts.frequencies_cm-1': [-450, 0.5] },
    })
    expect(r).toEqual({ ok: true })
  })

  it('设了下限但 properties 无 frequencies 数组 → 跳过判断（旧版 workflow 不产此键）', () => {
    const r = checkSettledWave(tsWave(10), {
      properties: { 'ts.converged': true, 'ts.imaginary_frequency_count': 1 },
    })
    expect(r).toEqual({ ok: true })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// R8b：IRC 方向门
// ───────────────────────────────────────────────────────────────────────────

const HEALTHY_IRC_CSV = `signed_rxn_coord,energy_hartree
-2.0,-76.510000
-1.0,-76.490000
0.0,-76.450000
1.0,-76.495000
2.0,-76.515000
`

const DIVERGENT_IRC_CSV = `signed_rxn_coord,energy_hartree
-2.0,-76.510000
-1.0,-76.490000
0.0,-76.450000
1.0,-76.470000
2.0,-76.430000
`

describe('checkIrcDirectionGate — R8b', () => {
  const ircWave = (check: boolean) => ({
    id: 3, task: 'irc',
    gate: { converged: true, irc_direction_check: check },
  })
  const resultWithPlot = (dataPath: string) => ({
    properties: { 'irc.irc_point_count': 5 },
    plots: [
      { kind: 'scf_convergence', image: '/w/scf.png', data: '/w/scf.csv' },
      { kind: 'irc_profile', image: '/w/irc.png', data: dataPath },
    ],
  })

  it('未开启方向检查 → 放行（不读文件）', async () => {
    let called = false
    const r = await checkIrcDirectionGate(ircWave(false), resultWithPlot('/w/irc.csv'), async () => {
      called = true
      return ''
    })
    expect(r).toEqual({ ok: true })
    expect(called).toBe(false)
  })

  it('开启但未注入 readCsvFile → 放行（老接线向后兼容）', async () => {
    const r = await checkIrcDirectionGate(ircWave(true), resultWithPlot('/w/irc.csv'), undefined)
    expect(r).toEqual({ ok: true })
  })

  it('两分支从 TS 单调下坡 → 放行', async () => {
    const r = await checkIrcDirectionGate(ircWave(true), resultWithPlot('/w/irc.csv'), async () => HEALTHY_IRC_CSV)
    expect(r).toEqual({ ok: true })
  })

  it('forward 分支能量回升 → 拒绝，理由含 kb 指针与分支状态', async () => {
    const r = await checkIrcDirectionGate(ircWave(true), resultWithPlot('/w/irc.csv'), async () => DIVERGENT_IRC_CSV)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/IRC direction check failed/)
      expect(r.reason).toMatch(/forward branch not monotonically downhill/)
      expect(r.reason).toMatch(/kb:irc-wrong-direction/)
    }
  })

  it('result.json 无 plots 数组 → 拒绝（IRC 波本应产图）', async () => {
    const r = await checkIrcDirectionGate(ircWave(true), { properties: {} }, async () => HEALTHY_IRC_CSV)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/no plots array/)
  })

  it('plots 里没有 irc_profile 条目 → 拒绝', async () => {
    const noIrc = { properties: {}, plots: [{ kind: 'scf_convergence', image: null, data: '/w/scf.csv' }] }
    const r = await checkIrcDirectionGate(ircWave(true), noIrc, async () => HEALTHY_IRC_CSV)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/no irc_profile entry/)
  })

  it('CSV 读取抛错 → 拒绝（证据缺失不放行，fail-closed）', async () => {
    const r = await checkIrcDirectionGate(ircWave(true), resultWithPlot('/w/irc.csv'), async () => {
      throw new Error('No such file or directory')
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/cannot read irc_profile CSV/)
      expect(r.reason).toMatch(/refusing to pass the gate/)
    }
  })

  it('gate=null 的波 → 放行', async () => {
    const r = await checkIrcDirectionGate({ id: 1, task: 'tsxtb', gate: null }, resultWithPlot('/w/irc.csv'), async () => '')
    expect(r).toEqual({ ok: true })
  })
})
