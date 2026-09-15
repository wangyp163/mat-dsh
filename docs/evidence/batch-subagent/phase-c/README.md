# Phase C：集中提交 + 批量监控（2026-09-15）

主会话 session-0d4d12a5（**新会话**，从磁盘 manifest 恢复——组合状态外置的实证）。
产物：`manifest-after-phasec.json`（含 10 条提交台账）+ 会话事件转印 + prompt。

## 预算闸接线（Phase C 开工件）

- TDD：`checkBudgetAgainstManifest`（清单台账回放/计划外拒绝/重试上限/核时累计，
  6 用例先红后绿）+ `appendSubmission` 台账（portfolio.ledger append-only）。
- 工具面：`mat-tools/src/budget-hook.ts`——`task_ref {portfolio_file, task_id}`
  激活；拒绝抛 `BUDGET_REJECTED` 前缀错误（未发生 sbatch）；成功自动台账原子写回。
  `mat_gaussian`/`mat_sbatch` 入口接线；核时估算 = pre_json.resources.ncores ×
  3.75min（缺省 32 核）。不传 task_ref = 不受闸（存量用法零影响）。
- 坑：defineTool 的 object 参数必须带 `additionalProperties`，否则整个参数类型推断
  降级为 JsonValue 联合（typecheck 抓住，已修）。
- 脚本烟雾：不受闸/计划外拒绝/计划内过闸/坏形状拒绝四路全对。

## 提交与结算结果

- **10/10 提交成功**（V1–V8、F1、F2，全部带 task_ref 过闸；V9 按协议跳过）。
  资源档 8 核/16GB（pre_json.resources + run_json.slurm 同步降档）。
- **台账自动记账 10 条**（各 0.5 核时 = 5.0，正好顶满声明上限——第 11 次任何提交
  都会被核时闸拦住，X-EXTRA 则被计划外规则拦住）。
- **H6 实弹证实**：X-EXTRA 计划外提交被工具层拒绝，原文
  `BUDGET_REJECTED: task X-EXTRA is not in portfolio batch-subagent-spike —
  plan-external submission refused`。
- 终态：**8 COMPLETED / 2 FAILED**（V5 天然失败、F1 注入失败）。
  能量抽样：V1=-76.40895（与压测 a1/a4 一致）、V2=-40.51838、V6=-114.50047。
- 纪律执行：零手动 squeue/sacct、零 log 原文读取；完成通知驱动结算。

## H3/H4（等待期零请求 + 通知批处理）

主会话 1 个用户回合内完成全部提交与 X-EXTRA 演示后收尾等通知；producer 服务端
轮询（零模型请求），10 个作业终态通知陆续投递、agent 汇总回写。LLM 调用 14 次
（含等待后的结算轮），全程无轮询循环。（细粒度时间线见事件转印；正式判定入
CONCLUSIONS。）

## 指标

| 指标 | Phase C（10 提交+结算） |
|---|---|
| 主会话 LLM 调用 | 14 |
| 主会话 sum_output | 14645 |
| **主会话最终上下文** | **≈50.4k** |

对照：B 相后 44.5k → C 相后 50.4k（+6k 完成 10 次提交+终态结算，其中含 10 份
结构裁决读取与转 xyz）。solo 基线外推（10×28k）下 H1 继续强支持。

## 诚实偏差记录

1. **F2 注入未生效**：H2CO 在 MaxCycles=3 下 3 步即收敛（体系太容易），注入的
   "convergence 类失败"没有出现——F2 实际按 COMPLETED 走（E 与 V6 逐位一致）。
   设计失误如实入档；Phase D 的 convergence 类分诊改由 V5 的真实失败代偿覆盖。
2. **V5 天然失败 = 制备契约缺口证据**：制备工给出的乙烯几何同侧 H 间距 0.276Å
   （verdicts/V5.json 可查）——batch-roles 的自检阈值（<0.1Å 报 problem）拦不住
   "化学上错但间距不极端"的几何；g16 距离矩阵在运行期抓住。**工程件改进项**：
   prep 自检需加"同侧原子对间距合理性"规则（H-H < 1Å 即坏）。
3. F2 的 note 未按协议写"注入未生效"说明（相位推进正确但透明度欠缺）。
