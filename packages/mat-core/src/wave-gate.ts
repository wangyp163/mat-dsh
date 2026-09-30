/**
 * 波间门检纯逻辑（审阅表 R4：TS 验收合格才准开跑 IRC / M22 的代码面）。
 *
 * 输入是编译产物 TaskPackage（波次 + 门条件，planning.ts 物化）与远端
 * result.json 的解析结果；输出放行/拒绝判定。此前"不过不进下一波"仅是
 * runbook 文本纪律，判定执行者是 LLM——本模块把判定变成可被工具层在
 * sbatch 前强制执行的结构化检查。properties 键兼容两种形态：
 * 扁平点号键（"ts.converged"）与嵌套对象（properties.ts.converged）。
 */

import type { TaskPackage, TaskPackageWave } from './task-package.ts'
import { parseIrcProfile } from './plots.ts'

export type WaveGateDecision = { ok: true } | { ok: false; reason: string }

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function propertyValue(props: unknown, task: string, key: string): unknown {
  const o = asRecord(props)
  if (o === undefined) return undefined
  const flat = o[`${task}.${key}`]
  if (flat !== undefined) return flat
  return asRecord(o[task])?.[key]
}

/** 波已结算 = properties 里出现该 task 的任意键（converged/energy/... 均可作证据）。 */
function isSettled(props: unknown, task: string): boolean {
  const o = asRecord(props)
  if (o === undefined) return false
  if (o[task] !== undefined) return true
  return Object.keys(o).some((k) => k.startsWith(`${task}.`))
}

export function checkWaveGate(pkg: TaskPackage, waveId: number, result: unknown): WaveGateDecision {  const wave = pkg.waves.find((w) => w.id === waveId)
  if (wave === undefined) {
    return { ok: false, reason: `wave ${waveId} not in task package ${pkg.task} (waves: ${pkg.waves.map((w) => w.id).join(',')})` }
  }
  const props = asRecord(asRecord(result)?.['properties'])
  for (const prior of pkg.waves.filter((w) => w.id < waveId)) {
    if (!isSettled(props, prior.task)) {
      return {
        ok: false,
        reason: `wave ${prior.id} (${prior.task}) not settled in result.json — run post for it before submitting wave ${waveId}`,
      }
    }
    if (prior.gate === null) continue
    const converged = propertyValue(props, prior.task, 'converged')
    if (converged !== prior.gate.converged) {
      return {
        ok: false,
        reason: `wave ${prior.id} (${prior.task}) converged=${String(converged)}, gate requires converged=${prior.gate.converged} — stop the chain and diagnose`,
      }
    }
    if (prior.gate.imaginary_frequency_count !== undefined) {
      const actual = propertyValue(props, prior.task, 'imaginary_frequency_count')
      if (typeof actual !== 'number' || actual !== prior.gate.imaginary_frequency_count) {
        const shown = typeof actual === 'number' ? String(actual) : 'missing'
        const verdict = actual === 0 ? '0 虚频=极小点' : '≥2 虚频=高阶鞍点'
        return {
          ok: false,
          reason: `wave ${prior.id} (${prior.task}) imaginary_frequency_count=${shown}, gate requires ${prior.gate.imaginary_frequency_count}（${verdict}，均无接 IRC 资格）— stop the chain and diagnose`,
        }
      }
    }
  }
  return { ok: true }
}

/**
 * 单波自身门检（pipeline driver 结算用）：wave 的 properties 已在场的前提下
 * 判它自己的 gate——ts 波 = converged 且虚频恰为 1；gate=null 只判结算存在性。
 * 键形态：组合后的 result 带步骤前缀（"ts.converged"/嵌套）；单步未组合的
 * post 输出无前缀（"converged"）——仅当结果里不存在任何前缀键时按无前缀回退。
 *
 * R7b：gate.min_real_frequency_cm1 在场且 properties 带 `frequencies_cm-1`
 * 数组时，额外校验最小真实（正）频率不低于阈值——只数虚频个数不足以确认
 * 干净的一阶鞍点（见 references/methods/irc-methods.md 前置条件）。
 */
export function checkSettledWave(wave: { id: number; task: string; gate: TaskPackageWave['gate'] }, result: unknown): WaveGateDecision {
  const props = asRecord(asRecord(result)?.['properties'])
  const hasPrefixKeys = props !== undefined && Object.keys(props).some((k) => k.includes('.'))
  const settled = isSettled(props, wave.task)
    || (props !== undefined && !hasPrefixKeys && Object.keys(props).length > 0)
  if (!settled) {
    return { ok: false, reason: `wave ${wave.id} (${wave.task}) has no properties in post output — treat as unsettled` }
  }
  if (wave.gate === null) return { ok: true }
  const unprefixed = props !== undefined && !Object.keys(props).some((k) => k.includes('.'))
    ? props
    : undefined
  const read = (key: string): unknown => propertyValue(props, wave.task, key) ?? (unprefixed?.[key] !== undefined ? unprefixed[key] : undefined)
  const converged = read('converged')
  if (converged !== wave.gate.converged) {
    return { ok: false, reason: `converged=${String(converged)}, gate requires converged=${wave.gate.converged}` }
  }
  if (wave.gate.imaginary_frequency_count !== undefined) {
    const actual = read('imaginary_frequency_count')
    if (typeof actual !== 'number' || actual !== wave.gate.imaginary_frequency_count) {
      const shown = typeof actual === 'number' ? String(actual) : 'missing'
      const verdict = actual === 0 ? '0 虚频=极小点' : '≥2 虚频=高阶鞍点'
      return {
        ok: false,
        reason: `imaginary_frequency_count=${shown}, gate requires ${wave.gate.imaginary_frequency_count}（${verdict}，均无接 IRC 资格）`,
      }
    }
  }
  // R7b：最小真实频率下限（需要 frequencies_cm-1 数组；缺数组时跳过——
  // 旧版 workflow 不产此键，不能因此拒绝一个本来合格的波）
  if (wave.gate.min_real_frequency_cm1 !== undefined) {
    const raw = read('frequencies_cm-1')
    if (Array.isArray(raw)) {
      const positives = raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
      if (positives.length > 0) {
        const minPositive = Math.min(...positives)
        if (minPositive < wave.gate.min_real_frequency_cm1) {
          return {
            ok: false,
            reason: `min real frequency ${minPositive.toFixed(2)} cm⁻¹ < gate floor ${wave.gate.min_real_frequency_cm1} cm⁻¹` +
              `（极低真实频率 = 平台区/残留平动转动，几何不是干净的一阶鞍点——只数虚频个数不足以验收）`,
          }
        }
      }
    }
  }
  return { ok: true }
}

/**
 * IRC 方向门（R8b）：要求 irc_profile 的两个分支均从 TS 单调下坡。
 *
 * 为什么单独成一个异步函数而不并入 checkSettledWave：方向判断要读远端 CSV
 * 文件，而 checkSettledWave 是同步纯函数（被工具层与 driver 两处复用）。
 * 把 IO 隔离在此，同步门的纯粹性不被破坏。
 *
 * 语义（fail-open 的边界很重要）：
 * - gate.irc_direction_check 未开启 → 直接放行；
 * - 开启但没有注入 readCsvFile → 放行并不报错（向后兼容：老接线没有这个能力）；
 * - 开启且能读到 CSV，但两分支不满足单调下坡 → **拒绝**，理由结构化；
 * - 开启、能读，但 result.json 里根本没有 irc_profile 条目 → 拒绝
 *   （IRC 波本应产出此图，缺失说明上游有问题，不能静默放行）；
 * - CSV 读取抛错 → 拒绝（证据缺失不放行，与 driver 的 readResultJson 同纪律）。
 */
export async function checkIrcDirectionGate(
  wave: { id: number; task: string; gate: TaskPackageWave['gate'] },
  result: unknown,
  readCsvFile?: (path: string) => Promise<string>,
): Promise<WaveGateDecision> {
  if (wave.gate?.irc_direction_check !== true) return { ok: true }
  if (readCsvFile === undefined) return { ok: true } // 未注入读取能力：保持旧行为

  const plots = asRecord(result)?.['plots']
  if (!Array.isArray(plots)) {
    return {
      ok: false,
      reason: `wave ${wave.id} (${wave.task}) gate requires irc_profile but result.json has no plots array — ` +
        'IRC 波应产出 irc_profile；缺失说明 post 未完成或 workflow 版本过旧',
    }
  }
  const entry = plots
    .map((p) => asRecord(p))
    .find((p) => p !== undefined && typeof p['kind'] === 'string' && p['kind'] === 'irc_profile')
  const csvPath = entry === undefined ? undefined : entry['data']
  if (typeof csvPath !== 'string' || csvPath.length === 0) {
    return {
      ok: false,
      reason: `wave ${wave.id} (${wave.task}) gate requires irc_profile CSV but plots has no irc_profile entry with a data path`,
    }
  }

  let csvText: string
  try {
    csvText = await readCsvFile(csvPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      reason: `wave ${wave.id} (${wave.task}) cannot read irc_profile CSV ${csvPath} (${message.slice(0, 160)}) — ` +
        'direction evidence missing, refusing to pass the gate',
    }
  }

  const profile = parseIrcProfile(csvText)
  if (!profile.isBidirectionalDownhill) {
    return {
      ok: false,
      reason: `wave ${wave.id} (${wave.task}) IRC direction check failed: ${profile.diagnosticNote || 'branches are not both monotonically downhill from the TS'}` +
        `（${profile.pointCount} points; forward=${profile.isForwardMonotonic}, reverse=${profile.isReverseMonotonic}）` +
        ' — 方向错误是 IRC 走不通的最常见上游原因（见 kb:irc-wrong-direction）',
    }
  }
  return { ok: true }
}
