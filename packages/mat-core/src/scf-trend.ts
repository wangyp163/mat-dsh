/**
 * SCF 收敛趋势:提取、分类与采样命令构造(纯逻辑,零 IO)。
 *
 * DFT 作业的失败前兆大多写在收敛曲线里——SCF 振荡烧完 TimeLimit、发散到数值
 * 崩溃——而 sacct 只能看到状态看不到曲线。本模块把曲线采样原料的构造/解析
 * 与趋势分类固化为纯函数,供 watch-loop 的采样状态机消费(设计定稿
 * 2026-09-30:定期进状态板、异常确认才唤 LLM;振荡/停滞/发散是可判定的,
 * 不消耗模型判断力)。
 *
 * 分类语义(防假阳性优先):
 *   insufficient — 样本不足(ΔE 窗口 <6;DIIS 建子空间的头几轮天然振荡,不算)
 *   converging  — 尾部 |ΔE| 递减且低于窗口首值(阻尼振荡同此)
 *   oscillating — 符号翻转 ≥3 且未在阻尼、振幅高于 1e-5 Ha
 *   diverging   — 同号且 |ΔE| 非降(尾部非降且末值 ≥ 窗口首值)
 *   stalled     — 其余:既不收敛也不发散的平台/噪声(逼近 TimeLimit 才预警)
 * 保守原则:不确定归 stalled,不下 diverging/oscillating 的重判。
 */

/** ΔE 观测窗口(分类只看最近 6 个 ΔE)。 */
export const SCF_TREND_WINDOW = 6

/** 数值噪声阈(哈特里):|ΔE| 低于此视同 0(不参与符号判定)。 */
const NOISE_EPS = 1e-8

/** 振荡但振幅已阻尼到此值以下 → 按收敛处理(哈特里)。 */
const CONVERGED_AMPLITUDE = 1e-5

export type ScfTrendKind = 'converging' | 'stalled' | 'oscillating' | 'diverging' | 'insufficient'

export interface ScfTrend {
  kind: ScfTrendKind
  /** 已观测 SCF cycle 数(能量样本数)。 */
  cycles: number
  /** 窗口末尾 |ΔE|(哈特里);insufficient 时缺省。 */
  lastAbsDelta?: number
  /** 人读摘要(趋势行与通知正文)。 */
  summary: string
}

/** g16 l502 每周期收敛表行——真实日志里周期能量的唯一来源(r4 修复):
 *  ` E= -75.2553090460447     Delta-E=  ...  Rises=F Damp=F`(首周期无 Delta-E)。
 *  `SCF Done:` 一次 SCF 过程只打一行终值,不是周期序列——初版提取器只认
 *  SCF Done,采样窗对真实 g16 日志永远 insufficient(S3/SR4 四轮无唤醒的
 *  第一根因;真 fixture 见 r4 回归)。 */
const SCF_CYCLE_LINE_RE = /^\s*E=\s*(-?\d+\.\d+)/

/** 单行 `SCF Done:  E(RB3LYP) = -76.33123456 A.U. after 12 cycles` 的能量提取(终值,SCF 过程结束打一次)。 */
const SCF_DONE_LINE_RE = /SCF Done:\s+E\([^)]+\)\s*=\s*(-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)/

/** 行级提取:l502 周期行优先,SCF Done 终值行次之;两形态都不匹配返回 undefined。 */
function scfEnergyOfLine(line: string): number | undefined {
  const m = SCF_DONE_LINE_RE.exec(line) ?? SCF_CYCLE_LINE_RE.exec(line)
  if (m === null) return undefined
  const v = Number(m[1])
  return Number.isFinite(v) ? v : undefined
}

/** 从文本提取 SCF 能量序列:l502 周期行为主,SCF Done 终值行按出现顺序穿插(多次 SCF 的日志)。 */
export function extractScfEnergies(text: string): number[] {
  const energies: number[] = []
  for (const line of text.split('\n')) {
    const v = scfEnergyOfLine(line)
    if (v !== undefined) energies.push(v)
  }
  return energies
}

/**
 * SCF 收敛趋势分类(纯函数)。
 * @param energies - 按时间序的 SCF 能量序列(哈特里)。
 */
export function classifyScfTrend(energies: number[]): ScfTrend {
  const deltas: number[] = []
  for (let i = 1; i < energies.length; i += 1) deltas.push(energies[i]! - energies[i - 1]!)
  const cycles = energies.length
  if (deltas.length < SCF_TREND_WINDOW) {
    return { kind: 'insufficient', cycles, summary: `insufficient samples (${deltas.length} ΔE < ${SCF_TREND_WINDOW}; DIIS warmup)` }
  }
  const win = deltas.slice(-SCF_TREND_WINDOW)
  const absWin = win.map(Math.abs)
  const lastAbs = absWin[absWin.length - 1]!
  const fmt = (v: number): string => (Math.abs(v) >= 1e-4 || v === 0 ? v.toPrecision(3) : v.toExponential(1))
  const signs = win.map((d) => (Math.abs(d) < NOISE_EPS ? 0 : d > 0 ? 1 : -1))
  const signFlips = signs.filter((s, i) => i > 0 && s !== 0 && signs[i - 1] !== 0 && s !== signs[i - 1]!).length
  const tail3 = absWin.slice(-3)
  const tailDescending = tail3[0]! >= tail3[1]! && tail3[1]! >= tail3[2]!
  const maxAbs = Math.max(...absWin)
  const damping = tailDescending && lastAbs < absWin[0]!

  if (signFlips >= 3 && !damping && maxAbs > CONVERGED_AMPLITUDE) {
    return {
      kind: 'oscillating', cycles, lastAbsDelta: lastAbs,
      summary: `${signFlips} sign flips in the last ${SCF_TREND_WINDOW} SCF cycles, |ΔE| up to ${fmt(maxAbs)} Ha — not damping`,
    }
  }
  // 阻尼振荡,或振幅已低于收敛阈(≤1e-5 Ha,化学上已收敛)——数值上在收敛
  if (damping || maxAbs <= CONVERGED_AMPLITUDE) {
    return { kind: 'converging', cycles, lastAbsDelta: lastAbs, summary: `|ΔE| descending (${fmt(absWin[0]!)} → ${fmt(lastAbs)} Ha)` }
  }
  const firstSign = signs.find((s) => s !== 0)
  const sameSign = firstSign !== undefined && signs.every((s) => s === 0 || s === firstSign)
  if (sameSign && !tailDescending && lastAbs >= absWin[0]!) {
    return {
      kind: 'diverging', cycles, lastAbsDelta: lastAbs,
      summary: `monotone drift, |ΔE| non-descending (${fmt(absWin[0]!)} → ${fmt(lastAbs)} Ha)`,
    }
  }
  return {
    kind: 'stalled', cycles, lastAbsDelta: lastAbs,
    summary: `plateau: |ΔE| in [${fmt(Math.min(...absWin))}, ${fmt(Math.max(...absWin))}] Ha over the last ${SCF_TREND_WINDOW} cycles`,
  }
}

// ---------------------------------------------------------------------------
// 批量采样:命令构造与分段解析(一次 exec 采样全部在途作业)
// ---------------------------------------------------------------------------

/** 分段标记行前缀(`=== <workdir>`),buildCommand 的输出契约。 */
const SEGMENT_PREFIX = '=== '

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * gaussian 布局的批量采样命令(r4 修正):tail 任务目录本身与各 step 子目录的
 * job.log——sacct WorkDir 是链根,单波任务日志在 `{task}/job.log`,多步链在
 * `{task}/{step}/job.log`(如 03-irc/),只 tail 一层会扑空(初版命令在两种
 * 布局下都采不到文件)。`tail` 多文件时的 `==> 文件 <==` 头行不匹配能量行,
 * 对提取无害。以 `=== <workdir>` 行分段。
 */
export function gaussianScfTailCommand(task: string, workdirs: string[], lines = 200): string {
  const dirs = [...new Set(workdirs)].map(shellQuote).join(' ')
  return `for d in ${dirs}; do echo "${SEGMENT_PREFIX}$d"; tail -n ${lines} "$d/${task}/job.log" "$d/${task}"/*/job.log 2>/dev/null; done`
}

/**
 * 通用布局的尽力而为采样(r4 修正):sacct WorkDir = sbatch 提交目录 = 日志所在
 * 目录(gaussian 作业的 job.log 就在提交目录本身,如 `.../sp/job.log`),初版
 * 只 tail 一层子目录、恰好差一层永远扑空。改为 tail 提交目录本身 + 一层子目录
 * 兜底。(注释里不写字面 glob——星号加斜杠会终止块注释,r4 两度踩坑。)
 */
export function globScfTailCommand(workdirs: string[], lines = 200): string {
  const dirs = [...new Set(workdirs)].map(shellQuote).join(' ')
  return `for d in ${dirs}; do echo "${SEGMENT_PREFIX}$d"; tail -n ${lines} "$d/job.log" "$d"/*/job.log 2>/dev/null; done`
}

/** 解析分段采样输出:workdir → SCF 能量序列(未知段/无 SCF 行的段为空数组)。 */
export function parseScfSamples(output: string): Map<string, number[]> {
  const result = new Map<string, number[]>()
  let current: string | undefined
  for (const line of output.split('\n')) {
    if (line.startsWith(SEGMENT_PREFIX)) {
      const key = line.slice(SEGMENT_PREFIX.length).trim()
      if (key !== '' && !result.has(key)) result.set(key, [])
      current = key !== '' ? key : undefined
      continue
    }
    if (current === undefined) continue
    const v = scfEnergyOfLine(line)
    if (v !== undefined) result.get(current)!.push(v)
  }
  return result
}

// ---------------------------------------------------------------------------
// 上报(异常确认后的通知载荷)
// ---------------------------------------------------------------------------

/** watch-loop 采样状态机产出的异常报告(onTrend 回调的载荷)。 */
export interface ScfTrendReport {
  jobId: string
  workdir: string
  trend: ScfTrend
  /** 最近若干 ΔE(哈特里,人读摘要)。 */
  recentDeltas: number[]
  /** sacct 观测:停滞预警需要 elapsed 逼近 Timelimit 的判定。 */
  elapsedSeconds?: number
  timelimitSeconds?: number
}

/** 趋势行(watch 增量输出里的可见物;前缀是公开契约,同 log_tail/diagnostic_post)。 */
export function formatScfTrendLine(report: ScfTrendReport): string {
  const deltas = report.recentDeltas.map((d) => d.toExponential(1)).join(', ')
  const limit = report.timelimitSeconds !== undefined && report.elapsedSeconds !== undefined
    ? ` elapsed=${report.elapsedSeconds}s/${report.timelimitSeconds}s`
    : report.elapsedSeconds !== undefined ? ` elapsed=${report.elapsedSeconds}s` : ''
  return `scf_trend: job ${report.jobId} ${report.trend.kind} (cycle ${report.trend.cycles}${limit}) — ${report.trend.summary}; recent ΔE: ${deltas}`
}

/**
 * 确认后的异常是否值得唤醒:振荡/发散确认即报;停滞只在逼近 TimeLimit
 * (剩余 ≤20%)时报——停滞本身可能只是慢收敛,TimeLimit 余量才是可行动信号。
 */
export function scfTrendActionable(report: ScfTrendReport): boolean {
  if (report.trend.kind === 'oscillating' || report.trend.kind === 'diverging') return true
  if (report.trend.kind === 'stalled') {
    return report.timelimitSeconds !== undefined && report.timelimitSeconds > 0
      && report.elapsedSeconds !== undefined && report.elapsedSeconds >= 0.8 * report.timelimitSeconds
  }
  return false
}
