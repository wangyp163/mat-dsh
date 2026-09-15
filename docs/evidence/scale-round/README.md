# scale-round 证据（2026-09-16）：50 任务压测 + 工程收口

产物：前任/接任会话事件转印、`manifest-scale50-reconciled.json`（50 任务全 settled
+ 台账 50 条含 actualCoreHours）、三份 prompt。

## K1–K7 判定

| # | 假设 | 判定 | 证据 |
|---|---|---|---|
| K1 | 估算取数 spec 优先消除 SH3 类误拒 | **confirmed** | resolveEstimateNcores（单测 3 例）+ 本轮 50 提交全走 spec 档（0.5/条），零误拒 |
| K2 | 台账按 sacct 实际回写、两本账可对 | **confirmed** | reconcile-ledger 50/50 回写：估算 25.0 vs 实际 **1.627 core-h（比值 6.51%）** |
| K3 | 无人值守自愈接续 | **confirmed** | 前任提交 13 任务时服务被重启（M13 producer 死，properties 落了 status:killed）；接任会话（全新、最小指令）stale 扫描→sacct 核实 M13 实际 COMPLETED(19s)→手动 post 恢复→续提 37 任务→50/50 settled。M40 瞬时错误自愈重试一次、无重复入账 |
| K4 | 50 任务下主会话上下文有界（≤150k） | **confirmed** | 前任 54.6k（max-tokens 截断时）；接任 **105.0k**（含 stale 恢复+37 提交+50 结算+汇总全程） |
| K5 | 50 份通知收件箱批处理唤醒 ≤5 轮 | **confirmed（优于假设）** | 接任 36 份完成通知**全部并入单回合**（turns=1）——批处理机制在 3.6 倍于 spike 1 的通知量下仍是 1 轮 |
| K6 | exec-gate 串行提交边际墙钟量化 | **confirmed** | 50 提交墙钟 40.6min：**中位间隔 46s、p90 71s**（含 prepare/pre/run/sbatch 四段往返+相位回写） |
| K7 | manifest 操作在 50 行规模仍可操作 | **confirmed（附重大发现）** | show/stale/批量 update 全程可用；但发现见下 |

## 重大规模发现（K7 附带）：自含委托 prompt 不随规模线性扩展

前任会话在撰写第 10 份制备工 prompt 时**耗尽单回合输出预算**（turn/end reason=
max-tokens，5717 输出 token 截断，制备工一个没发出）。修复=瘦委托（基准结构落盘
scale50-base.json，工人自己 read；每回复分批 ≤3 工人）——接任会话全程未复发。
**工程件新条目：批量委托的默认形态必须是"数据在清单/文件、prompt 只给指针"**。

## 终态与科学质量

50/50 COMPLETED、converged=true、0 失败 0 重试（attempts 全 0）；能量随缩放因子
平滑变化（NH3 五档 10⁻⁷ 量级递变）——几何扰动扫描的物理合理性成立。

## 其它发现

1. **会话内凭证缺口**：接任会话的 bash 无 MAT_MCP_KEY，跑不了 reconcile-ledger
   （其用 sacct 手动对账，数据同源；正式回写由操作侧完成）。对账属收尾动作，
   操作侧执行可接受，但若要经理自主对账需凭证管道进会话——记为部署议题。
2. **相位回写批处理**：接任先快速提交（37 连发）后集中结算——中间态出现
   "台账 49 / settled 17" 的相位滞后窗口。stale 语义只认 submitted，未提交完的
   prepared 任务无相位歧义，自愈不受影响；但监控面板读相位要容忍此窗口。
3. 前任 max-tokens 截断的批次可完全恢复（数据在 manifest，不在会话里）——
   无状态经理模式在"会话死亡"维度也验证通过。

## 成本

- 集群：50 sbatch（cap 55），实际 1.627 核时（估算口径 25.0，闸按估算计费）。
- 会话：前任 23 调用/15.6k 出（截断止）；接任 34 调用/36.9k 出/105k 上下文。
- 全程两次中断（一次 max-tokens 自然截断、一次实验方重启）均无损失恢复。
