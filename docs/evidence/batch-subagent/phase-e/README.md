# Phase E：解读 fan-out + 汇总收官（2026-09-15）

主会话 session-d4331d8f（新会话，manifest 恢复）。产物：会话事件转印、prompt、
`manifest-after-phasee.json`（11/11 final）、9 份 interpret 裁决。

## 结果

- **9/9 解读全过契约**（0 拒收 0 重试）：2 个 subagent_analyst 并行（5+4 分片），
  逐任务回传 `mat.interpret-verdict.v1`。
- **F2 贴边收敛判定**（本相位最有价值的科学判断）：converged=true 站得住——三项
  证据（3 步内 MaxForce 0.000365 < 0.000450 阈、"Stationary point found"、freq 全正
  虚频 0），concerns 标注「MaxCycles=3 上限贴边收敛」备查。契约的 concerns 机制
  在真实边界案例上工作正常。
- **Fan-in 报告主 agent 亲自完成**：9 行任务表 + 3 行总结（可用率 9/11=82%，
  失败处置回顾，产物位置），数值逐位来自裁决。
- 全部 11 任务 final 收口。

## 指标

主会话（新会话，本 spike 最重数据相位）：61 LLM 调用、sum_out 26381、
**最终上下文 ≈75.3k**——仍低于 H1 的 100k 判线。五相位会话带：44.5k / 50.4k /
59.1k / 75.3k（E 最高，因 properties 收集 + 双工人 prompt 内嵌数据 + fan-in 写作
全部经过主上下文）。

## 诚实偏差记录

1. **V1–V8 实际为 opt-only**：Phase C 的 harness prompt 未钉死 task=opt+freq（仅
   F2 指明），主 agent 选了更快的默认 opt。后果：8 个任务无频率数据，"0 虚频"
   实为"无频率"；分析师诚实标注 "(no freq)" 未编造数字，concerns 机制兜住了
   缺口；仅 F2 完整走过 freq 判稳（全正）。架构假设（H1–H8）不依赖 freq，不
   补跑。教训：**harness→经理的任务规格必须完整钉死计算类型**。
2. **job_output 不足以支撑跨相位 fan-out 消费**：settled 作业的 job_output
   （8KB 输出上限 + 上一个会话注册）数据不完整，主 agent 被迫 31 次 mat_exec：
   早期 workdir 路径狩猎（`~/workspace` vs 远端 `/public/home/hpc-user-a` 展开歧义
   ——09-01 压测 skill 问题 #5 在编排语境复现）+ 后期逐任务远端 cat result.json。
   **两条工程件改进**：(a) settle 时把 properties 摘要快照进 manifest（相位间
   数据传递走清单，不走跨会话 job 注册表）；(b) 提交时把远端 workdir 绝对路径
   记进 manifest 任务字段。
