import { describe, expect, it } from 'vitest'
import {
  SCF_TREND_WINDOW,
  classifyScfTrend,
  extractScfEnergies,
  formatScfTrendLine,
  gaussianScfTailCommand,
  globScfTailCommand,
  parseScfSamples,
  scfTrendActionable,
} from '../src/scf-trend'
import type { ScfTrendReport } from '../src/scf-trend'

/** 生成 SCF Done 行(gaussian .log 原文格式)。 */
const done = (e: number, i: number) => ` SCF Done:  E(RB3LYP) =  ${e}  A.U. after  ${i} cycles`

describe('extractScfEnergies / parseScfSamples', () => {
  it('从 gaussian log 原文提取能量序列,非 SCF 行忽略', () => {
    const text = [
      ' Cycle   1      E= -76.3',
      done(-76.3, 2),
      ' Leave Link 1',
      done(-76.3301, 3),
      'Convergence achieved', // 终结行不是 SCF Done
    ].join('\n')
    expect(extractScfEnergies(text)).toEqual([-76.3, -76.3301])
  })

  it('r4 回归:真实 g16 l502 收敛表行(E=/Delta-E=)是周期能量的来源', () => {
    // 取自 h2o-osc-999/sp/job.log 真实形态:周期行 " E= -75.25...  Delta-E= ...";
    // SCF Done 一次 SCF 只打一行终值——初版只认 SCF Done,采样永远 insufficient
    const text = [
      ' Leave Link 1  from Wed Sep 30',
      ' E= -75.2553090460447    ',
      ' E= -73.0228139563706     Delta-E=        2.232495089674 Rises=F Damp=F',
      ' RMSDP=1.07D-01 MaxDP=8.89D-01 DE= 2.23D+00 OVMax= 9.90D-01',
      ' E= -71.9343484515809     Delta-E=        1.088465504790 Rises=F Damp=F',
      ' E= -74.6623163047     Delta-E=       -2.727968246928 Rises=F Damp=F',
      ' E= -73.5000000000     Delta-E=        1.162316304700 Rises=F Damp=F',
      ' E= -71.8000000000     Delta-E=        1.700000000000 Rises=F Damp=F',
      ' E= -74.5000000000     Delta-E=       -2.700000000000 Rises=F Damp=F',
      ' E= -73.4000000000     Delta-E=        1.100000000000 Rises=F Damp=F',
      ' SCF Done:  E(RB3LYP) =  -74.6623163047     A.U. after 1000 cycles',
      ' Convergence failure -- run terminated.',
    ].join('\n')
    const energies = extractScfEnergies(text)
    // 8 个周期行 + 1 个 SCF Done 终值
    expect(energies).toEqual([
      -75.2553090460447, -73.0228139563706, -71.9343484515809, -74.6623163047,
      -73.5, -71.8, -74.5, -73.4, -74.6623163047,
    ])
    // 该序列判为振荡(符号翻转 ≥3 且不阻尼)
    expect(classifyScfTrend(energies).kind).toBe('oscillating')
  })

  it('分段解析:=== <workdir> 分段,空段/未知段容错', () => {
    const out = [
      '=== /w/A',
      done(-76.1, 1), done(-76.2, 2),
      '=== /w/B',
      '(no job.log found)', // 尾不到日志的段 → 空序列
      '=== /w/C',
      ' E= -75.0    ',
      ' SCF Done:  E(RB3LYP) =  -75.0  A.U. after 3 cycles',
    ].join('\n')
    const parsed = parseScfSamples(out)
    expect(parsed.get('/w/A')).toEqual([-76.1, -76.2])
    expect(parsed.get('/w/B')).toEqual([])
    expect(parsed.get('/w/C')).toEqual([-75.0, -75.0])
  })

  it('命令构造:gaussian 布局与 glob 布局覆盖 r4 修正的双重路径,workdir 去重且 shell 引用', () => {
    // gaussian:sacct WorkDir=链根,日志在 {task}/job.log(单波)或 {task}/{step}/job.log(多步)
    expect(gaussianScfTailCommand('tsxtb', ['/w/A', '/w/A', '/w/B']))
      .toBe(`for d in '/w/A' '/w/B'; do echo "=== $d"; tail -n 200 "$d/tsxtb/job.log" "$d/tsxtb"/*/job.log 2>/dev/null; done`)
    // glob:sacct WorkDir=提交目录,日志就在目录本身(如 .../sp/job.log),再兜一层子目录
    expect(globScfTailCommand(['/w/A'], 50))
      .toBe(`for d in '/w/A'; do echo "=== $d"; tail -n 50 "$d/job.log" "$d"/*/job.log 2>/dev/null; done`)
  })
})

describe('classifyScfTrend(分类矩阵,防假阳性优先)', () => {
  /** 由 ΔE 序列构造能量序列。 */
  const energiesOf = (deltas: number[], first = -76.3): number[] => {
    const out = [first]
    let e = first
    for (const d of deltas) { e += d; out.push(e) }
    return out
  }

  it('样本不足(DIIS 建子空间)→ insufficient,不下任何重判', () => {
    for (let n = 1; n < SCF_TREND_WINDOW; n += 1) {
      const deltas = Array.from({ length: n }, () => 1e-3)
      expect(classifyScfTrend(energiesOf(deltas)).kind).toBe('insufficient')
    }
  })

  it('单调收敛(|ΔE| 递减)→ converging', () => {
    const deltas = [1e-2, 5e-3, 2e-3, 8e-4, 3e-4, 1e-4, 4e-5]
    const t = classifyScfTrend(energiesOf(deltas))
    expect(t.kind).toBe('converging')
    expect(t.lastAbsDelta).toBeCloseTo(4e-5, 10)
  })

  it('阻尼振荡(符号交替但振幅收缩)→ converging,不是 oscillating', () => {
    const deltas = [+1e-3, -5e-4, +2.5e-4, -1.2e-4, +6e-5, -3e-5]
    expect(classifyScfTrend(energiesOf(deltas)).kind).toBe('converging')
  })

  it('等幅振荡(符号翻转 ≥3 且不阻尼)→ oscillating', () => {
    const deltas = [+1e-3, -1e-3, +1e-3, -1e-3, +1e-3, -1e-3]
    const t = classifyScfTrend(energiesOf(deltas))
    expect(t.kind).toBe('oscillating')
    expect(t.summary).toMatch(/sign flips/)
  })

  it('微振荡(振幅 ≤1e-5 Ha)→ converging:数值上已收敛', () => {
    const deltas = [+1e-6, -1e-6, +1e-6, -1e-6, +1e-6, -1e-6]
    expect(classifyScfTrend(energiesOf(deltas)).kind).toBe('converging')
  })

  it('发散(同号且 |ΔE| 非降)→ diverging', () => {
    const deltas = [1e-3, 2e-3, 3e-3, 4e-3, 5e-3, 6e-3]
    const t = classifyScfTrend(energiesOf(deltas))
    expect(t.kind).toBe('diverging')
  })

  it('平台(|ΔE| 恒定不降)→ stalled', () => {
    const deltas = [5e-4, 5e-4, 5e-4, 5e-4, 5e-4, 5e-4]
    const t = classifyScfTrend(energiesOf(deltas))
    expect(t.kind).toBe('stalled')
    expect(t.summary).toMatch(/plateau/)
  })
})

describe('scfTrendActionable / formatScfTrendLine', () => {
  const reportOf = (kind: ScfTrendReport['trend']['kind'], over: Partial<ScfTrendReport> = {}): ScfTrendReport => ({
    jobId: '911',
    workdir: '/w/A',
    trend: { kind, cycles: 12, lastAbsDelta: 1e-3, summary: `${kind} summary` },
    recentDeltas: [1e-3, -1e-3, 1e-3],
    ...over,
  })

  it('振荡/发散:确认即报;停滞:仅逼近 TimeLimit(≤20% 余量)才报', () => {
    expect(scfTrendActionable(reportOf('oscillating'))).toBe(true)
    expect(scfTrendActionable(reportOf('diverging'))).toBe(true)
    expect(scfTrendActionable(reportOf('stalled'))).toBe(false) // 无时限数据不报
    expect(scfTrendActionable(reportOf('stalled', { elapsedSeconds: 5_000, timelimitSeconds: 14_400 }))).toBe(false)
    expect(scfTrendActionable(reportOf('stalled', { elapsedSeconds: 12_000, timelimitSeconds: 14_400 }))).toBe(true)
    expect(scfTrendActionable(reportOf('converging'))).toBe(false)
    expect(scfTrendActionable(reportOf('insufficient'))).toBe(false)
  })

  it('趋势行契约:scf_trend: 前缀,含 kind/cycle/摘要/近期 ΔE', () => {
    const line = formatScfTrendLine(reportOf('stalled', { elapsedSeconds: 12_000, timelimitSeconds: 14_400 }))
    expect(line.startsWith('scf_trend: job 911 stalled')).toBe(true)
    expect(line).toContain('cycle 12')
    expect(line).toContain('elapsed=12000s/14400s')
    expect(line).toContain('recent ΔE:')
  })
})
