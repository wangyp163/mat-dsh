# Phase D：失败分诊 fan-out + 重试决策（2026-09-15）

主会话 session-f96d449f（新会话，manifest 恢复）。产物：会话事件转印、prompt、
`manifest-after-phased.json`、V5/F1 分诊裁决 + V5 原始（坏）制备裁决。

## 预算声明扩展（声明计划即预算的扩计划路径）

Phase C 台账 10×0.5=5.0 核时顶满原声明。V5 重试（+0.5）经用户 Phase D 批准，
harness 操作员把 `maxCoreHours 5→6` 并写入 `budgetAmendment`（时间/批准来源/原因）
留档——"扩计划必须人批"第一次完整走通。工程件改进项：amend 应做成 portfolio-cli
一等命令（当前是操作员直改 + 留档，缺 CLI 审计面）。

## 分诊结果（subagent_triage fan-out ×2，并行）

两份裁决都过契约（failureClass=input、5 行证据、retryPlan 完整）：

- **V5**：job.log 行号级取证（R(3,5)=0.276Å、l202 distance matrix、no SCF ran），
  retryPlan 精确到坐标修正（交换 H5/H6 的 y 符号）。
- **F1**：确认注入对（R(3,4)=0.0001Å）、证明确定性（"提高 MaxCycle 无济于事"——
  抵抗了错误修法）、用 sacct MaxRSS 排除资源/节点因素，并**发现上游 bug**：
  result.json 把该输入错误误分类为 convergence/ts-step-limit（kb 标签错）——
  已按协议上报，属 workflow 侧诊断分类器缺陷（待反馈 HPC 侧）。

## 重试结果

- **V5 重试全链转绿**：retry（attempts=1）→ prep 工人重备正确 D2h 几何 → 过闸重提
  （task_ref 重试身份派生：attempts>0 → isRetry=true，预算 5.5/6.0、sbatch 11/12、
  V5 重试 1/1 全过）→ job 122194582 COMPLETED（15s），E=-78.5874586758 Eh
  converged=true（正确乙烯 B3LYP/6-31G(d) 能量量级）。
- **F1 按相位授权上报不重试**（分诊虽然 retryable=true，注入任务重试权在用户）。

## 指标

主会话（新会话）：26 LLM 调用、sum_out 17627、**最终上下文 ≈59.1k**。
每相位会话上下文带状分布（B 44.5k / C 50.4k / D 59.1k）——与任务数解耦，
H1 的准确表述应为"**每相位上下文有界，不随组合规模增长**"。

## 诚实偏差记录

1. **重试制备裁决未落盘**：V5.json 仍是旧坏几何（22:43），重试轮的正确结构只在
   会话 transcript 与远端 molecule.xyz 里；task.verdict 被分诊裁决覆盖。改进项：
   batch-orchestrator 补重试轮 verdict 文件命名（如 `<taskId>.attempt2.json`）。
2. F1 的上报 note 写明"per phase authorization"——授权边界来自 prompt 而非清单；
   改进项：注入任务的 retry 策略应进 manifest 任务字段（如 `retryPolicy: none`），
   而不是靠相位 prompt 约定。
