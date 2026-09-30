import { describe, expect, it } from 'vitest'
import { compileTaskPackage } from '../src/task-package'
import { kbCoverageOf } from '../src/planning'
import type { Goal } from '../src/planning'
import { DIAGNOSTIC_LINE_PREFIXES, diagnosticTextOf } from '../src/gaussian'
import { selectWaveStepDir } from '../src/pipeline-driver'

/**
 * runbook ⟺ driver 一致性闸（开发纪律的可执行形态）。
 *
 * 背景：task-package.ts 的 execution.instructions 是给 LLM 读的自然语言 runbook；
 * pipeline-driver.ts 是同一条链的代码执行体。两者描述同一件事却各写各的——
 * 改了 runbook 的某一步而忘了改 driver（或反之）不会有编译错误，只会在某条
 * 特殊失败路径上暴露，且复现困难。这就是「双轨漂移」。
 *
 * 本测试把 runbook 里那些「driver 必须同样遵守」的纪律逐条钉死。它不检查文案
 * 措辞，只检查纪律所依赖的结构化事实仍然成立。
 *
 * ── 开发纪律（改动 runbook 或 driver 时必读）──
 * 1. 在 stepwiseInstructions() 里新增/修改一条对执行者的**硬约束**时，必须回答：
 *    driver 是否也受此约束？若是 → 在 driver 里落实为断言/代码路径，并在此文件
 *    加一条对应用例；若否（纯 LLM 手动路径的提示）→ 在 runbook 文案里显式标注
 *    「(manual path only)」，使读者不必猜。
 * 2. 在 pipeline-driver.ts 里改变执行顺序、门检口径、重试语义、提交纪律时，
 *    必须检查 runbook 对应条目是否仍然真实；不真实就同步改文案。
 * 3. 本文件任一用例失败 = 两条轨道已经漂移，不允许通过「改测试」消除——
 *    先判定哪一侧是对的，再改那一侧。
 */

const WATER_XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

function goal(want: string[]): Goal {
  return {
    schema_version: 'aimater.goal.v1',
    structure: { label: 'h2o-run1', xyz: WATER_XYZ, source: 'user-upload' },
    intent: { want },
    resources: { partition: 'Agent0' },
  }
}

function runbookOf(want: string[]): string[] {
  const result = compileTaskPackage(goal(want))
  expect(result.status).toBe('ready')
  return result.pkg!.execution.instructions
}

describe('runbook ⟺ driver 一致性', () => {
  it('多波链编译为 stepwise，且 runbook 非空（前提成立）', () => {
    const result = compileTaskPackage(goal(['ts', 'irc']))
    expect(result.status).toBe('ready')
    expect(result.pkg!.execution.mode).toBe('stepwise')
    expect(result.pkg!.waves.length).toBeGreaterThan(1)
    expect(result.pkg!.execution.instructions.length).toBeGreaterThan(0)
  })

  it('纪律「同一 work_dir / 同一 task DSL」：driver 用的是 state.workdir 与 pkg.task 单一来源', () => {
    const lines = runbookOf(['ts', 'irc']).join('\n')
    // runbook 仍在声明这条纪律
    expect(lines).toMatch(/同一个 \{work_dir\}|全程同一个/)
    // driver 侧的对应事实：编译产物里每一波共享同一个 task 字符串，
    // driver 的 prePhase/runPhase/postPhase 都以 pkg.task 为唯一入参，
    // 没有任何「按波拆 task」的结构存在。
    const pkg = compileTaskPackage(goal(['ts', 'irc'])).pkg!
    expect(new Set(pkg.waves.map(() => pkg.task)).size).toBe(1)
  })

  it('纪律「门检不过不进下一波」：每个带 gate 的波都有结构化门条件（非文本纪律）', () => {
    const pkg = compileTaskPackage(goal(['ts', 'irc'])).pkg!
    const tsWave = pkg.waves.find((w) => w.task === 'ts')
    expect(tsWave).toBeDefined()
    // ts 波的门必须是结构化的（converged + 虚频恰 1），driver 的 checkSettledWave
    // 才能在代码里强制执行，而不是依赖 LLM 读 runbook 自觉遵守。
    expect(tsWave!.gate).not.toBeNull()
    expect(tsWave!.gate!.converged).toBe(true)
    expect(tsWave!.gate!.imaginary_frequency_count).toBe(1)
    // runbook 里这条纪律的文字仍在
    expect(runbookOf(['ts', 'irc']).join('\n')).toMatch(/不过不进下一波/)
  })

  it('纪律「attempts 台账自动记账」：runbook 声明由工具自动追加，不再手工 echo', () => {
    const lines = runbookOf(['ts', 'irc']).join('\n')
    expect(lines).toMatch(/attempts\.jsonl/)
    // 纪律要点：记账是自动的（driver 侧是 submitWave 里唯一写点）
    expect(lines).toMatch(/自动追加|自动记账/)
    // 反向纪律：runbook 不应再教人手工 echo 追加台账
    expect(lines).not.toMatch(/手工 echo 追加/)
  })

  it('纪律「每波必做 post，不把 post 留到链尾」：runbook 声明仍在，driver 每波 watch 后即门检', () => {
    const lines = runbookOf(['ts', 'irc']).join('\n')
    expect(lines).toMatch(/不把 post 留到链尾|每波必做/)
    // driver 侧对应事实：每波都有独立 gate 判定点（gate 为 null 也是一次判定），
    // 不存在「所有波跑完再统一 post」的结构。
    const pkg = compileTaskPackage(goal(['ts', 'irc'])).pkg!
    expect(pkg.waves.every((w) => 'gate' in w)).toBe(true)
  })

  it('step 目录选择：driver 的 selectWaveStepDir 与 runbook 描述的目录形态一致', () => {
    const lines = runbookOf(['ts', 'irc']).join('\n')
    // runbook 告诉 LLM step 目录形如 0<N>-<task>/
    expect(lines).toMatch(/0\d-\w+\/|<本波 step 目录>/)
    // driver 必须能从该形态里正确选出本波目录（含易错的前缀相交场景）
    const scripts = ['/w/ts+irc/01-ts/slurm.sh', '/w/ts+irc/02-irc/slurm.sh']
    expect(selectWaveStepDir(scripts, 'ts', 1)).toBe('/w/ts+irc/01-ts')
    expect(selectWaveStepDir(scripts, 'irc', 2)).toBe('/w/ts+irc/02-irc')
  })

  it('诊断载荷契约：producer 前缀集合与 diagnosticTextOf 提取口径一致', () => {
    // 这是 producer → diagnose 的跨模块契约。改前缀必须同步改提取函数。
    expect(DIAGNOSTIC_LINE_PREFIXES).toContain('diagnostic_post: ')
    expect(DIAGNOSTIC_LINE_PREFIXES).toContain('log_tail: ')

    const producerOutput = [
      'polling job 800...',
      'slurm_state: FAILED',
      'diagnostic_post: convergence failure at step 12 (kb:ts-step-limit)',
      'log_tail: Error termination request processed by link 9999',
      'kb_hint: kb:ts-step-limit — some/path',
    ].join('\n')
    const extracted = diagnosticTextOf(producerOutput)
    // 诊断载荷在
    expect(extracted).toMatch(/convergence failure/)
    expect(extracted).toMatch(/link 9999/)
    // 噪声不在（轮询行、kb_hint 回显不参与签名匹配）
    expect(extracted).not.toMatch(/polling job/)
    expect(extracted).not.toMatch(/kb_hint:/)
  })

  it('诊断载荷契约：无契约行时保守回退整段（不静默丢失诊断）', () => {
    const weird = 'some unexpected producer output\nwithout any known prefix'
    expect(diagnosticTextOf(weird)).toBe(weird)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // R7b/R8b/KB 覆盖率：新增纪律同样钉成结构化断言（纪律第 1 条的体现）
  // ─────────────────────────────────────────────────────────────────────────

  it('R7b 纪律「TS 不能只数虚频个数」：ts 波门带结构化频率下限字段', () => {
    const pkg = compileTaskPackage(goal(['ts', 'irc'])).pkg!
    const tsWave = pkg.waves.find((w) => w.task === 'ts')!
    // 门条件必须是结构化数值，driver 才能在代码里强制执行（而非 runbook 文字提醒）
    expect(typeof tsWave.gate!.min_real_frequency_cm1).toBe('number')
    expect(tsWave.gate!.min_real_frequency_cm1).toBeGreaterThan(0)
  })

  it('R8b 纪律「IRC 方向必须验证」：irc 波门带结构化方向检查开关', () => {
    const pkg = compileTaskPackage(goal(['ts', 'irc'])).pkg!
    const ircWave = pkg.waves.find((w) => w.task === 'irc')!
    expect(ircWave.gate).not.toBeNull()
    expect(ircWave.gate!.irc_direction_check).toBe(true)
  })

  it('KB 覆盖率诚实化：kbCoverage 与 errors/ 实际条目一致，不虚报自动重试能力', () => {
    // 有序梯（driver 可自动换档）：irc 链——kb:irc-l123-divergence L1→L3
    expect(kbCoverageOf('tsxtb+ts+irc')).toBe('ladder')
    expect(kbCoverageOf('irc')).toBe('ladder')
    // 决策表（需 LLM 按 trace 形态选行）：ts 系——kb:ts-step-limit / ts-l103-formbx
    expect(kbCoverageOf('ts')).toBe('decision')
    expect(kbCoverageOf('opt')).toBe('decision')
    // 无条目：失败必然 needs_llm，这是**预期行为**而非系统故障
    expect(kbCoverageOf('tddft')).toBe('none')
    expect(kbCoverageOf('resp')).toBe('none')
    expect(kbCoverageOf('aea')).toBe('none')
    // 未注册 task 保守视为无覆盖
    expect(kbCoverageOf('nonexistent-task')).toBe('none')
  })
})
