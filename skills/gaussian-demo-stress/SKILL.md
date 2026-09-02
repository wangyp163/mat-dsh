---
name: gaussian-demo-stress
description: 'Plan and execute authorized end-to-end stress tests for the demo Gaussian workflow through mat-dsh: decompose a user goal into cases, select one-shot or stepwise execution, validate gates, plots, results, session delivery, and produce an evidence-based report.'
version: 0.1.0
metadata:
  adapted-for: mat-dsh
  companion-sop: ~/dev/mat-aitool/docs/gaussian-demo-stress-test-sop.md
---

# demo Gaussian 压测编排

## 何时使用

当用户要求对 demo 环境的 Gaussian workflow 做“压测、回归、端到端验证、链路验证、plots 验证、稳定性测试”或要求生成此类压测计划时使用本 skill。

本 skill 负责**计划、编排、验收和证据报告**；单个 Gaussian 计算必须委派给 `gaussian-calc`。会话轨迹异常时按需使用 `session-debug`。不要把本 skill 当成普通 Gaussian 计算 skill，也不要在普通计算中主动加载它。

完整操作细节、case 库和报告模板见：

```text
~/dev/mat-aitool/docs/gaussian-demo-stress-test-sop.md
```

只按需读取相关章节，不要把整份 SOP 或完整 session transcript 注入模型上下文。

## 计划阶段：先生成，再确认

收到目标后，先生成计划，不要立即投放真实任务。将目标整理为：

1. **目标和停止条件**：要验证的可观察行为；gate/版本漂移、关键 case 失败、用户取消即停止。
2. **假设和环境**：cluster、期望 workflow 版本、skill 版本、fixture、方法/基组、电荷/多重度、并发和冷启动要求。科学参数未指定时只使用 `gaussian-calc` 的显式默认值，并标注假设。
3. **case 矩阵**：每项必须有 case id、原始用户口吻 prompt、会话（新建/追加）、链路、唯一 workdir、预期 route、预期结果/plots 和可量化断言。
4. **执行顺序和风险**：哪些 case 独立、哪些依赖上游结果；重试边界、失败现场和预计报告路径。
5. **确认边界**：计划生成后先请用户确认，再创建会话、提交作业或执行任何真实远端计算。涉及科学参数扩大、专用 fixture 或破坏性动作时必须明确确认。

用户确认后才能投放。prompt 中不要泄露内部压测编排信息，例如不要说“这是压测”。

## Case 和链路选择

按目标选择最小充分集合，必要时覆盖正向、冷启动、链路、组合/多阶段、异常/兼容和最终交付：

- 单作业且参数齐备：优先 `mat_gaussian` 一站式。
- 用户要查看每一步输入/Slurm 脚本、多波任务、二次 run 或诊断：使用 `pre → run → sbatch → mat_job_watch → post` 分步链路。
- 至少安排一个新会话验证冷启动；追加 case 只复用健康会话。
- 光谱/优化/TS/IRC 等可视化任务验收 `job_output` 的 `plots:` 行优先，无则 `result.json` 兜底；纯数值任务允许 `plots: []` 或旧部署无 `plots` 键。
- 多阶段任务必须把上游明确完成的结果作为下游输入；不得猜测、伪造或静默改变任务范围。

常见 kind：`scf_convergence`、`ir_spectrum`、`uvvis_spectrum`、`emission_spectrum`、`irc_profile`。完整映射和数据行断言查 SOP，不要凭记忆扩大断言。

## 强制执行规则

1. 每个新会话的第一条业务命令只允许一次：

   ```bash
   bash $HOME/workspace/.gaussian-calc/scripts/check_environment.sh
   ```

   使用 timeout 180；必须得到 `ok=true`、`protocol=new`、部署/期望版本一致、`missing_tasks=[]`。失败立即停止，不搜索源码、registry 或 CLI help，不提交作业。

2. 一站式任务由 `gaussian-calc` 调用 `mat_gaussian`；记录 Slurm job id 和 background job id，等待终态后用一次 `job_output`。
3. 分步任务严格保持 phase 边界：`pre` 只生成并检查输入，`run` 只生成脚本，提交后一次性使用 `mat_job_watch`，终态后才 `post`。
4. 按 `gaussian-calc` 0.7.9+ 契约：`job_output` 直读 `plots:` 行优先，无则只读 `{workdir}/result.json` 的 `plots` 字段；报告 kind、PNG 和 CSV 路径。不要 cat PNG 或通读 CSV。
5. 重试优先复用原 workdir；必须换目录时说明旧/新路径和原因。失败现场、result、job id 和 session trace 不得清理。
6. 不手动循环 `squeue`/`sacct`；不未经用户确认执行 `rm`、`rm -rf`、`mv` 或覆盖/清空既有目录；不把凭据写入文件、prompt 或报告。
7. 区分 workflow 已完成、结果解析成功、文件已生成、agent 已向用户交付和 session turn 已完成这五个层次；任一层失败都要单独记录。

## session-debug：仅异常触发

`session-debug` 是本地离线解析器，不调用模型、不占 HPC 作业配额、不增加 LLM token。正常 case 只记录轻量统计：session id、turn/step 数、工具失败数、diagnostics 数量和最终状态。

以下情况触发诊断：turn/step 未闭合、dsh/mux 中断、job/result/tool 状态矛盾、plots 未交付、gate/provider/权限异常、skill resource root 异常。按最小成本顺序：

```bash
pnpm debug:session <session.jsonl.zstd> anomalies --json
pnpm debug:session <session.jsonl.zstd> tools --json
pnpm debug:session <session.jsonl.zstd> timeline --json
```

只把脱敏后的异常类型、seq、相关 tool/turn 和最小错误片段纳入分析；禁止默认回灌完整 `report`、完整 transcript、raw log 或凭据。发现 `stale-skill-root`（`/tmp/.../skills/...`）时，按 SOP 的 skill discovery 处理，不把临时路径当作稳定证据。

## 交付和报告

每个 case 至少留存：

```text
case_id / 原始 prompt / session_id / 新建或追加
provider/model / gate 摘要 / 实际链路 / workdir
Slurm job id / background job id / job 与 post 终态
route / properties / plots(kind,image,data)
PNG 大小 / CSV 数据行数 / agent 交付情况
失败现场与 trace / 验收 verdict / 缺陷归类
```

最终报告写入：

```text
docs/<YYYY-MM-DD>-<feature>-demo-stress-report.md
```

至少包含 case 矩阵、环境与门禁、链路覆盖、plots/数据抽查、兼容性、失败现场、session-debug 摘要、问题分类（skill/agent、workflow、deployment/provider）、修复建议和回滚判定。模型预算、队列延迟或单个科学任务失败不自动触发远端回滚；只有确认压测破坏部署时才执行既定回滚流程。
