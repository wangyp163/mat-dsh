import { describe, expect, it } from 'vitest'
import { lintStressReport } from './stress-report-lint.js'

/**
 * 压测报告 lint 门：把 SOP §8.2 报告模板 + §6.7 收口要求从散文变成检查器。
 * 完整模板 0 error；缺收口要件（摘要表/anomalies/回滚判定）必 error。
 */

const SESSION_A = 'session-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'
const SESSION_B = 'session-9f8e7d6c-5b4a-3928-4715-a0b1c2d3e4f5'

const COMPLIANT = `# 2026-09-04 demo：demo Gaussian 压测报告

## 目标、范围与环境
- 目标：验证 TDDFT plots 可被 agent 交付
- 范围：tddft、sp 两个 case
- 环境：workflow 1.3.5、skill 0.7.14-demo、cluster 11250
- 总体结论：全部通过，未破坏部署

## case 矩阵
| Case | 会话 | 用户 prompt | 链路 | workdir | Slurm job id | plots | verdict |
|---|---|---|---|---|---|---|---|
| c1 | 新建 ${SESSION_A} | 算一下水的紫外吸收光谱 | 一站式 | ~/workspace/stress/w1 | 12001 | uvvis_spectrum PNG+CSV | ✓ |
| c2 | 追加 ${SESSION_A} | 水的单点能 | 一站式 | ~/workspace/stress/w2 | 12002 | plots=[] | ✓ |

## 门禁
两次新会话各一次 gate：ok=true、protocol=new、missing_tasks=[]、版本 1.3.5 一致。

## 链路覆盖
一站式 2、分步 0——目标仅单作业，原因：参数齐备无需分步。

## plots 抽查
uvvis_spectrum PNG 45KB、CSV 5 数据行，与 result.json 一致；sp 报数值无缺图错误。

## 失败现场
无失败、无重试；现场未清理。

## 问题分类
- skill / agent：无
- workflow：无
- deployment / provider：无

## session-debug 收口
L0 轻扫命令：pnpm exec tsx scripts/session-debug.ts anomalies <session.jsonl.zstd> --json

| session_id | turns | 未闭合 turn（归因） | tool 失败（fatal / benign） | errors | 读数时效 | L1 升级与否 | 轨迹层结论 |
|---|---|---|---|---|---|---|---|
| ${SESSION_A} | 4 | 0（无） | 0 / 1 | 0 | 21min | 否 | 健康 |
| ${SESSION_B} | 2 | 0（无） | 0 / 0 | 0 | 23min | 否 | 健康 |

## 修复建议与回归
无新增缺陷；回归 case 无。

## 回滚判定
压测未破坏部署，不触发回滚。
`

describe('lintStressReport', () => {
  it('合规模板报告 0 error', () => {
    const result = lintStressReport(COMPLIANT)
    expect(result.errors).toEqual([])
  })

  it('缺 session-debug 摘要表 → error（未收口）', () => {
    const markdown = COMPLIANT.replace(/## session-debug[\s\S]*?## 修复/, '## 修复')
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/摘要表/)
  })

  it('摘要表缺必备列（读数时效）→ error', () => {
    const markdown = COMPLIANT.replace(' | errors | 读数时效 | L1 升级与否 |', ' | errors | L1 升级与否 |')
      .replace(' | 0 | 21min | 否 |', ' | 0 | 否 |')
      .replace(' | 0 | 23min | 否 |', ' | 0 | 否 |')
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/读数时效|时效/)
  })

  it('摘要表无数据行 → error', () => {
    const markdown = COMPLIANT.replace(
      /\n\| session-\w{8}[^\n]*\n\| session-\w{8}[^\n]*\n/,
      '\n',
    )
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/数据行|空/)
  })

  it('case 矩阵缺列（plots、verdict）→ error 并列出缺失列', () => {
    const markdown = COMPLIANT.replace(
      ' | Slurm job id | plots | verdict |',
      ' | Slurm job id |',
    )
      .replace(' | 12001 | uvvis_spectrum PNG+CSV | ✓ |', ' | 12001 |')
      .replace(' | 12002 | plots=[] | ✓ |', ' | 12002 |')
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/plots/)
    expect(result.errors.join('\n')).toMatch(/verdict/)
  })

  it('无 L0 anomalies 证据 → error', () => {
    const markdown = COMPLIANT.replace(
      'L0 轻扫命令：pnpm exec tsx scripts/session-debug.ts anomalies <session.jsonl.zstd> --json',
      '对全部 session 做了轨迹检查。',
    )
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/anomalies|L0/)
  })

  it('无回滚判定 → error', () => {
    const markdown = COMPLIANT.replace('## 回滚判定\n压测未破坏部署，不触发回滚。', '')
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/回滚/)
  })

  it('问题分类缺 deployment/provider → error', () => {
    const markdown = COMPLIANT.replace('- deployment / provider：无\n', '')
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/deployment|provider/)
  })

  it('case 矩阵中的 session 未进摘要表 → error 指名 session', () => {
    const markdown = COMPLIANT.replace(
      `| ${SESSION_A} | 4 | 0（无） | 0 / 1 | 0 | 21min | 否 | 健康 |\n`,
      '',
    )
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toContain(SESSION_A.replace('session-', ''))
  })

  it('只说明一类链路 → error(仅适合其一时也要写明"分步 0"与原因)', () => {
    const withReason = lintStressReport(COMPLIANT)
    expect(withReason.errors.filter((e) => e.includes('链路'))).toEqual([])

    const markdown = COMPLIANT.replace(
      '一站式 2、分步 0——目标仅单作业，原因：参数齐备无需分步。',
      '本轮共执行 2 个 case。',
    )
    const result = lintStressReport(markdown)
    expect(result.errors.join('\n')).toMatch(/链路/)
  })

  it('未记录 PNG 大小/数据行数 → warn', () => {
    const markdown = COMPLIANT.replace(
      'uvvis_spectrum PNG 45KB、CSV 5 数据行，与 result.json 一致；sp 报数值无缺图错误。',
      'plots 已抽查一致。',
    )
    const result = lintStressReport(markdown)
    expect(result.errors).toEqual([])
    expect(result.warnings.join('\n')).toMatch(/PNG|数据行/)
  })
})
