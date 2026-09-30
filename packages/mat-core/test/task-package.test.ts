import { describe, expect, it } from 'vitest'
import { confirmationDigest, summarizePre } from '../src/confirmation'
import { compileTaskPackage, formatTaskPackage } from '../src/task-package'
import type { Goal } from '../src/planning'

/**
 * task 构建器 golden 测试（D0 P3 工具接线）：goal → task 包的确定性编译。
 * 纪律锚点：one-stop digest 与 mat_gaussian 确认闸同源（同输入同摘要）、
 * stepwise 全链摘要、一站式边界（opt+sp/aea/多波走分步）、路由键禁区、
 * 资源档覆盖（O1：pre.resources 唯一来源 + 槽位同步）、复用标记。
 */

const WATER_XYZ = '3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n'

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    schema_version: 'aimater.goal.v1',
    structure: { label: 'h2o-run1', xyz: WATER_XYZ, source: 'user-upload' },
    intent: { want: ['optimize', 'frequencies'] },
    resources: { partition: 'Agent0' },
    ...overrides,
  }
}

describe('compileTaskPackage golden', () => {
  it('① 单波 one-stop：digest 与确认闸同源，runbook 指向 mat_gaussian 直提', () => {
    const r = compileTaskPackage(goal())
    expect(r.status).toBe('ready')
    const pkg = r.pkg!
    expect(pkg.execution.mode).toBe('one-stop')
    expect(pkg.waves).toHaveLength(1)
    expect(pkg.waves[0].postJson).toEqual({})
    const gateDigest = confirmationDigest(summarizePre(pkg.waves[0].preJson, pkg.waves[0].runJson))
    expect(pkg.digest).toBe(gateDigest) // 与 mat_gaussian 闸门逐字节一致
    const text = formatTaskPackage(r)
    expect(text).toContain('TASK_PACKAGE_READY')
    expect(text).toContain(gateDigest)
    expect(text).toContain('mat_gaussian')
    expect(text).toContain('confirmed_digest')
    expect(text).toContain('task: "opt+freq"')
    expect(text).toContain('计算参数摘要')
  })

  it('② 多波 tsxtb+ts+irc：stepwise，指令含完整 DSL 三相位与逐波门检，全链 digest 稳定', () => {
    const base = goal({ intent: { want: ['ts', 'irc'] }, structure: { label: 'meoh', xyz: WATER_XYZ } })
    const r = compileTaskPackage(base)
    const pkg = r.pkg!
    expect(pkg.execution.mode).toBe('stepwise')
    expect(pkg.waves.map((w) => w.task)).toEqual(['tsxtb', 'ts', 'irc'])
    // R7b：ts 波门除虚频计数外还带最小真实频率下限（干净一阶鞍点不能只数个数）
    expect(pkg.waves[1].gate).toEqual({ converged: true, imaginary_frequency_count: 1, min_real_frequency_cm1: 10 })
    // R8b：irc 波门要求 irc_profile 两分支从 TS 单调下坡
    expect(pkg.waves[2].gate).toEqual({ converged: true, irc_direction_check: true })
    const runbook = pkg.execution.instructions.join('\n')
    expect((runbook.match(/-t tsxtb\+ts\+irc/g) ?? []).length).toBeGreaterThanOrEqual(3) // pre/run/post 同一 DSL
    expect(runbook).toContain('ts.converged')
    expect(runbook).toContain('imaginary_frequency_count == 1')
    expect(runbook).toContain('mat_sbatch')
    expect(runbook).toContain('mat_job_watch')
    expect(runbook).toContain('attempts.jsonl')
    expect(runbook).toContain('GAUSSIAN_ENV_SCRIPT') // run 命令内联导出（M21）
    expect(pkg.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(pkg.digest).not.toBe(confirmationDigest(summarizePre(pkg.waves[0].preJson, pkg.waves[0].runJson)))
    // 确定性：同 goal 两次编译同摘要
    expect(compileTaskPackage(base).pkg!.digest).toBe(pkg.digest)
  })

  it('③ 一站式边界：opt+sp 与 aea 单 DSL 判 stepwise（需分波提交）', () => {
    const optsp = compileTaskPackage(goal({ intent: { want: ['optimize', 'energy'] } }))
    expect(optsp.pkg!.task).toBe('opt+sp')
    expect(optsp.pkg!.execution.mode).toBe('stepwise')
    const aea = compileTaskPackage(goal({ intent: { want: ['aea'] } }))
    expect(aea.pkg!.task).toBe('aea')
    expect(aea.pkg!.execution.mode).toBe('stepwise')
  })

  it('④ needs_clarification：digest 空、runbook 空、questions 透传进输出', () => {
    const r = compileTaskPackage(goal({ resources: {} }))
    expect(r.status).toBe('needs_clarification')
    const pkg = r.pkg!
    expect(pkg.digest).toBe('')
    expect(pkg.execution.instructions).toEqual([])
    const text = formatTaskPackage(r)
    expect(text).toContain('NEEDS_CLARIFICATION')
    expect(text).toContain('缺少 Slurm 分区')
    expect(text).toContain('阻塞式')
  })

  it('⑤ route_kwargs：附加键并入 calculator_kwargs；异 task 路由键 → invalid', () => {
    const ok = compileTaskPackage(goal({
      intent: { want: ['optimize'] },
      method: { route_kwargs: { opt: ['Tight', 'CalcFC'], ioplist: ['2/9=1'] } },
    }))
    expect(ok.status).toBe('ready')
    expect(ok.pkg!.waves[0].preJson).toMatchObject({
      ase: { calculator_kwargs: { opt: ['Tight', 'CalcFC'], ioplist: ['2/9=1'] } },
    })
    // 自身路由集内（tddft → td）放行
    const own = compileTaskPackage(goal({ intent: { want: ['td'] }, method: { route_kwargs: { td: ['nstates=30'] } } }))
    expect(own.status).toBe('ready')
    // 异 task 路由键 / 组合链路由键一律拒绝
    const wrong = compileTaskPackage(goal({ intent: { want: ['td'] }, method: { route_kwargs: { opt: ['Tight'] } } }))
    expect(wrong.status).toBe('invalid')
    expect(wrong.errors.join()).toContain('路由键 opt')
    const chain = compileTaskPackage(goal({
      intent: { want: ['ts', 'irc'] },
      method: { route_kwargs: { freq: ['HPModes'] } },
    }))
    expect(chain.status).toBe('invalid')
    expect(formatTaskPackage(chain)).toContain('INVALID_GOAL')
    // 一等字段旁路忽略并记 assumption
    const bypass = compileTaskPackage(goal({ method: { route_kwargs: { basis: 'STO-3G' } } }))
    expect(bypass.status).toBe('ready')
    expect(bypass.pkg!.assumptions.join()).toContain('一等字段')
    expect((bypass.pkg!.waves[0].preJson.ase as { calculator_kwargs: Record<string, unknown> }).calculator_kwargs.basis).toBe('6-31G(d)')
  })

  it('⑥ 资源档覆盖：ncores/memory/walltime 落 pre 与 slurm，槽位同步、walltime 优先于 accuracy', () => {
    const r = compileTaskPackage(goal({
      resources: { partition: 'Agent0', ncores: 16, memory: '32GB', walltime: '01:00:00' },
      accuracy: 'fast',
    }))
    expect(r.status).toBe('ready')
    const wave = r.pkg!.waves[0]
    expect(wave.preJson).toMatchObject({ resources: { ncores: 16, memory: '32GB' } })
    expect(wave.runJson).toMatchObject({ slurm: { ntasks_per_node: 16, mem: '32GB', time: '01:00:00' } })
    // 改参数 → digest 变
    const plain = compileTaskPackage(goal())
    expect(r.pkg!.digest).not.toBe(plain.pkg!.digest)
    // 非法值快败
    expect(compileTaskPackage(goal({ resources: { partition: 'Agent0', walltime: '1h' } })).status).toBe('invalid')
    expect(compileTaskPackage(goal({ resources: { partition: 'Agent0', ncores: 0 } })).status).toBe('invalid')
  })

  it('⑦ 复用：past 命中 → 波 reusable、runbook 含复用提示、核时归零', () => {
    const past = (label: string, task: string) =>
      label === 'h2o-run1' && task === 'opt+freq'
        ? [{ task: 'opt+freq', converged: true, energy: -76.408954, artifactsPath: '/w/h2o-run1/artifacts.json' }]
        : []
    const r = compileTaskPackage(goal(), { past })
    expect(r.status).toBe('ready')
    expect(r.pkg!.waves[0].reusable).toBe(true)
    expect(r.pkg!.waves[0].reuseRef?.energy).toBe(-76.408954)
    expect(r.pkg!.estimatedCoreHours).toBe(0)
    expect(formatTaskPackage(r)).toContain('命中复用')
  })

  it('⑧ 预算警示：预估核时超 max_core_hours → BUDGET_WARNING 行', () => {
    const r = compileTaskPackage(goal())
    expect(r.pkg!.estimatedCoreHours).toBe(16)
    const text = formatTaskPackage(r, 1)
    expect(text).toContain('BUDGET_WARNING')
    expect(text).toContain('max_core_hours 1')
    expect(formatTaskPackage(r, 100)).not.toContain('BUDGET_WARNING')
  })
})
