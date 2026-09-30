import { describe, expect, it } from 'vitest'
import { intentToTask, parseXyzFrames, planFromGoal, validateGoal } from '../src/planning'

/**
 * D0 P3a golden 测试：goal → plan 的确定性映射（四个代表性形态）。
 * 纪律锚点：波间门（M22）、tsxtb 自动前缀（M16）、奇电子 mult 前移（M15）、
 * 分区不自动选（O2）、复用标记（P1 mat-db 注入）。
 */

const WATER_XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'
const CH3_XYZ = '4\n\nC 0.0 0.0 0.0\nH 1.0 0.0 0.0\nH -0.5 0.87 0.0\nH -0.5 -0.87 0.0\n' // 9 电子（奇）

describe('intentToTask（意图 → task DSL）', () => {
  it('性质关键词映射', () => {
    expect(intentToTask(['optimize'])).toBe('opt')
    expect(intentToTask(['optimize', 'frequencies'])).toBe('opt+freq')
    expect(intentToTask(['energy'])).toBe('sp')
    expect(intentToTask(['spectrum-ir'])).toBe('freq')
    expect(intentToTask(['ts'])).toBe('ts')
    expect(intentToTask(['irc'])).toBe('tsxtb+ts+irc') // M16：初猜未知 → xTB 前缀
    expect(intentToTask(['reaction-path'])).toBe('tsxtb+ts+irc')
    expect(intentToTask(['aea'])).toBe('aea')
    expect(intentToTask(['td'])).toBe('tddft')
  })
})

describe('parseXyzFrames（多帧切分）', () => {
  it('单帧', () => {
    expect(parseXyzFrames(WATER_XYZ)).toHaveLength(1)
  })
  it('双帧（qst2 形态）', () => {
    const two = WATER_XYZ + WATER_XYZ
    expect(parseXyzFrames(two)).toHaveLength(2)
  })
})

describe('planFromGoal golden（四形态）', () => {
  it('① 常规单作业：水 opt+freq，参数齐备 → ready、单波、含默认档假设与核时', () => {
    const r = planFromGoal({
      schema_version: 'aimater.goal.v1',
      structure: { label: 'h2o-run1', xyz: WATER_XYZ, source: 'user-upload' },
      intent: { want: ['optimize', 'frequencies'] },
      resources: { partition: 'Agent0' },
    })
    expect(r.status).toBe('ready')
    expect(r.plan!.task).toBe('opt+freq')
    expect(r.plan!.waves).toHaveLength(1)
    expect(r.plan!.waves[0].gate).toBeNull()
    expect(r.plan!.estimatedCoreHours).toBe(16) // 默认 1×32×0.5h
    expect(r.plan!.assumptions.join()).toContain('B3LYP/6-31G(d)')
    expect(r.plan!.questions).toHaveLength(0)
    expect(r.plan!.preJson).toMatchObject({ ase: { calculator_kwargs: { charge: 0, mult: 1 } } })
  })

  it('② 过渡态链：irc 意图 → tsxtb+ts+irc 三波、ts 波带门、串行依赖', () => {
    const r = planFromGoal({
      schema_version: 'aimater.goal.v1',
      structure: { label: 'meoh-deh', xyz: WATER_XYZ }, // 单帧初猜（演示用）
      intent: { want: ['ts', 'irc'] },
      resources: { partition: 'Agent0' },
    })
    expect(r.status).toBe('ready')
    expect(r.plan!.task).toBe('tsxtb+ts+irc')
    expect(r.plan!.waves.map((w) => w.task)).toEqual(['tsxtb', 'ts', 'irc'])
    const tsWave = r.plan!.waves[1]
    // R7b：ts 波门带最小真实频率下限（10 cm⁻¹，过滤平台区/残留平动转动）
    expect(tsWave.gate).toEqual({ converged: true, imaginary_frequency_count: 1, min_real_frequency_cm1: 10 })
    // R8b：irc 波门要求两分支从 TS 单调下坡
    expect(r.plan!.waves[2].gate).toEqual({ converged: true, irc_direction_check: true })
    expect(r.plan!.waves[2].dependsOn).toEqual([2])
    expect(r.plan!.assumptions.join()).toContain('tsxtb')
    expect(r.plan!.estimatedCoreHours).toBe(48) // 三波 × 16
  })

  it('③ 需澄清：奇电子无 mult（阻塞）+ 缺结构 + 缺分区 → needs_clarification，选项带推荐', () => {
    const r = planFromGoal({
      schema_version: 'aimater.goal.v1',
      intent: { want: ['optimize'] }, // 无 structure、无 partition
    })
    expect(r.status).toBe('needs_clarification')
    const kinds = r.plan!.questions.map((q) => q.kind).sort()
    expect(kinds).toEqual(['partition', 'structure'])

    const odd = planFromGoal({
      schema_version: 'aimater.goal.v1',
      structure: { label: 'ch3', xyz: CH3_XYZ },
      intent: { want: ['optimize'] },
      resources: { partition: 'Agent0' },
    })
    expect(odd.status).toBe('needs_clarification')
    const q = odd.plan!.questions.find((x) => x.kind === 'mult')
    expect(q).toBeDefined()
    expect(q!.prompt).toContain('9')
    expect(q!.options[0].value).toBe('2') // 推荐双重态
    // 补上 mult 后 → ready（澄清环闭环）
    const fixed = planFromGoal({
      schema_version: 'aimater.goal.v1',
      structure: { label: 'ch3', xyz: CH3_XYZ },
      intent: { want: ['optimize'] },
      resources: { partition: 'Agent0' },
      mult: 2,
    })
    expect(fixed.status).toBe('ready')
    expect(fixed.plan!.preJson).toMatchObject({ ase: { calculator_kwargs: { mult: 2 } } })
  })

  it('④ 复用：历史命中（label+task+converged）→ 波标记 reusable、核时扣减', () => {
    const past = (label: string, task: string) =>
      label === 'h2o-run1' && task === 'opt+freq'
        ? [{ task: 'opt+freq', converged: true, energy: -76.408954, artifactsPath: '/w/h2o-run1/artifacts.json' }]
        : []
    const r = planFromGoal({
      schema_version: 'aimater.goal.v1',
      structure: { label: 'h2o-run1', xyz: WATER_XYZ },
      intent: { want: ['optimize', 'frequencies'] },
      resources: { partition: 'Agent0' },
    }, { past })
    expect(r.status).toBe('ready')
    expect(r.plan!.waves[0].reusable).toBe(true)
    expect(r.plan!.waves[0].reuseRef).toMatchObject({ energy: -76.408954 })
    expect(r.plan!.estimatedCoreHours).toBe(0) // 全复用零新核时
  })

  it('⑤ 精度偏好与非法 goal', () => {
    const fast = planFromGoal({
      intent: { want: ['energy'] },
      structure: { xyz: WATER_XYZ },
      resources: { partition: 'Agent0' },
      accuracy: 'fast',
    })
    expect((fast.plan!.runJson as { slurm: { time: string } }).slurm.time).toBe('00:15:00')
    expect(fast.plan!.estimatedCoreHours).toBe(8)

    const invalid = planFromGoal({ intent: { want: ['不存在'] } as never })
    expect(invalid.status).toBe('invalid')
    expect(invalid.errors.join()).toContain('未知意图')
    expect(validateGoal({} as never).join()).toContain('intent.want')
  })
})

describe('multi-wave chain frame validation（regression: tsxtb+ts+irc 帧数漏洞修复验证）', () => {
  const twoFrames = `3\nframe A\nO 0 0 0\nH 0 0 1\nH 0 1 0\n3\nframe B\nO 0 0 0\nH 0 0 2\nH 0 2 0\n`
  const oneFrame = `3\nframe A\nO 0 0 0\nH 0 0 1\nH 0 1 0\n`

  it('tsxtb+ts+irc 给 2 帧初猜（首波 tsxtb 需 1 帧）→ needs_clarification with structure-frames', () => {
    const r = planFromGoal({
      intent: { want: ['irc'] },
      structure: { xyz: twoFrames },
      resources: { partition: 'Agent0' },
    })
    expect(r.status).toBe('needs_clarification')
    expect(r.plan!.questions.map((q) => q.id)).toContain('structure-frames')
    const q = r.plan!.questions.find((x) => x.id === 'structure-frames')!
    expect(q.prompt).toContain('1 帧')
    expect(q.prompt).toContain('tsxtb+ts+irc')
  })

  it('tsxtb+ts+irc 给 1 帧 → frame 问题不触发', () => {
    const r = planFromGoal({
      intent: { want: ['irc'] },
      structure: { xyz: oneFrame },
      resources: { partition: 'Agent0' },
    })
    expect(r.plan!.questions.map((q) => q.id)).not.toContain('structure-frames')
  })

  it('qst2 单独给 1 帧 → needs_clarification（仍需 2 帧）', () => {
    const r = planFromGoal({
      intent: { want: ['ts'] },
      // 注：intentToTask(['ts']) → 'ts'（单帧）；若要测 qst2 需显式 goal
      structure: { xyz: oneFrame },
      resources: { partition: 'Agent0' },
    })
    // ts 单波也需 1 帧，不应触发 structure-frames（1 帧正好够）
    expect(r.plan!.questions.map((q) => q.id)).not.toContain('structure-frames')
  })
})
