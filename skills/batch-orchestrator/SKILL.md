---
name: batch-orchestrator
# description 禁半角冒号（frontmatter 纪律同 gaussian-calc）
description: Use this skill when orchestrating the mat batch portfolio (multi-system Gaussian calculations) as the portfolio manager. Covers manifest operations via portfolio-cli, role-worker fan-out (subagent_prep/subagent_triage/subagent_analyst), contract validation with one retry, worker-death handling, and budget discipline. The manager submits and watches jobs itself; workers never touch the cluster submit path.
version: 0.1.0
metadata:
  adapted-for: mat-dsh batch-subagent spike
---

# 批量组合经理协议（batch-orchestrator）

你是**组合经理**：持有批量计算的任务清单（manifest），把可并行的判断类工作 fan-out 给
角色工人子 agent，自己负责提交/监控/汇总。你的上下文是稀缺资源——一切中间产物经
工人消化成 ≤10 行结构化裁决再进你的会话。

## 清单操作（一律走 CLI，禁手搓 JSON）

```bash
pnpm --dir ~/mat-harness/mat-dsh exec tsx scripts/portfolio-cli.ts <cmd>
```

- `init --id <id> --tasks <tasks.json> --out <manifest>`——建清单（tasks 数组元素：
  `{taskId, system, kind: valid|injected, injectedNote?}`；injected 必带 note，透明纪律）
- `show <manifest>`——紧凑任务表（每轮从这里读状态，**不要 cat 原始 JSON**）
- `update <manifest> <taskId> --phase P [--jobid J] [--note S] [--verdict-file F]`
- `retry <manifest> <taskId>`——唯一合法相位回退（attempts 记账）
- `diff <before> <after>`——增量行
- `validate prep|triage|interpret <payload|->`——契约校验；exit 1 即拒收

相位序：pending → prepared → submitted → settled → diagnosed → interpreted → final。
约定路径：manifest 在 `manifest/portfolio.json`，工人回传落
`manifest/verdicts/<taskId>.json` 再 validate（heredoc 落盘，不走上传通道）。

## 角色工人调用（三工具，prompt 必须自含）

工人**看不到你的会话**：每次调用的 prompt 必须独立成篇——taskId、体系完整描述/
数据、以及"先读 skill batch-roles，按你的角色契约回传单段 JSON"。三个工具：

- `subagent_prep`（制备工，本地无集群工具）——输入：体系描述 → 回传
  `mat.prep-verdict.v1`
- `subagent_triage`（分诊工，只读远端）——输入：终态+log_tail → 回传
  `mat.triage-verdict.v1`
- `subagent_analyst`（分析师，本地分析）——输入：result.json properties → 回传
  `mat.interpret-verdict.v1`

独立调用**在同一个回复里并行发出**（`run_in_background: false` 等结果时才串行）。

## 契约校验循环（拒收只重试一次）

1. 工人回传 → heredoc 落盘 `manifest/verdicts/<taskId>.json`
2. `validate` → 过：`update --phase <next> --verdict-file`
3. 不过：把 issues 原文 + "重新回传，修复这些问题"再派**同角色一次**；
   二次不过 → `update --note "needs_human: <一句原因>"`，继续别的任务不停摆
4. **契约通过 ≠ 工作成功**：裁决本体 `ok:false`（如制备缺陷、科学不可用）时
   相位**不动**，只记 `update --note "needs_human: <problem 原文>"`——相位推进
   只看裁决的正面结论（Phase B 教训：V9 被误推进 prepared）

## 工人死亡处理

工人工具调用返回 error（含 max-tokens/refusal 字样）：**不重试工人**，`update --note
"worker_died: <stopReason 摘录>"`，该任务标 needs_human 或换角度重派一次（预算允许时）。
死亡是证据，记录它。

## 经理自己的事（不委托）

- 集群操作全部自己来：门禁、提交（`mat_gaussian` 一站式优先）、`mat_job_watch`
  批量监控、终态表读取。工人无提交权（toolFilter 已裁，但纪律上你也不许转授）。
- fan-in 汇总自己写：最终报告 ≤30 行，数值逐位来自结构化裁决。
- 预算纪律：清单声明的 sbatch/重试/核时上限是硬顶；计划外提交先问用户。

## 相位边界（本 spike 的分相执行）

- **Phase B（制备）**：init → prep fan-out → validate/回写。**零集群调用**
  （不 mat_exec、不上传、不 sbatch）——制备产物留本地待 Phase C 集中上传。
- **Phase C（提交+监控）**：经理串行提交（每任务过预算闸）、批量 watch、终态回写。
- **Phase D（分诊）**：失败任务 → triage fan-out → 重试决策。
- **Phase E（解读+汇总）**：成功任务 → analyst fan-out → 经理汇总报告。

每相位结束时输出：相位摘要 ≤10 行（任务计数/相位分布/拒收与死亡数/token 无需你报）。

## 标准操作模式（shepherd spike 起）

- **组合经理无状态化**：每个相位/批次用全新会话 + manifest 恢复——已多相位实战
  验证（更抗漂移、可续跑、可审计）。不要在旧会话里续新相位。
- **相位间数据走清单**：任务结算的物性快照与远端 workdir 由工具自动写进 manifest
  （properties/workdir 字段）——读取用 `show`，禁止跨相位翻旧会话的 job_output
  或远端补读。

## 自愈扫描（scale-round 起，新会话/重启后第一步）

接手任何批量清单先跑 `portfolio-cli stale <manifest>`：

- **有 stale（submitted 未结算）**：上次会话/服务中断过。逐个对账恢复——
  `mat_exec` 跑 `sacct -j <jobid> -P -n -o JobID,State,ExitCode,ElapsedRaw`：
  终态 COMPLETED → 按 gaussian-calc 分步协议手动 post 拿 properties → 门检 →
  `update --phase settled`；非 COMPLETED → 记 note 并按分诊协议处理。
  恢复完 stale 再继续 pending/prepared 的原计划提交。
- **无 stale**：直接按清单继续（prepared 的提交、settled 的解读）。
- 批量收尾时跑 `scripts/reconcile-ledger.ts <cluster> <manifest>` 对账两本账
  （闸的估算计费 vs sacct 实际核时），把报告贴进相位摘要。

## 链式任务委托（shepherd）

多波链（如 opt→freq 分步）委托给 `subagent_shepherd`（可续后台子 agent，协议见
batch-roles shepherd 节）：

- 委托 prompt 自含：taskId、manifest 绝对路径、预算声明、体系描述；规格已钉在
  manifest 的 spec 字段（task 类型/方法/资源档），让牧羊人自己读清单。
- 启动返回 `{kind:'continuable', subagentId}`——记录之；牧羊人自己跑长回合。
- 中途询问进度用 `send_message`（FIFO 下一回合生效；波内注入会在回合边界交付）；
  牧羊人波结算后用 report 主动汇报（你的会话会收到 `Background subagent <id>
  reported:` 消息）。
- 需要强停链用 `interrupt_agent`（lineage 校验只许停自己的子）。
- 牧羊人的提交自带 task_ref 过预算闸——台账与你串行提交同源，重试上限/核时
  全局共享。

## Phase C 提交协议（预算闸实弹）

- 环境门禁一次（gaussian-calc skill 第一条），然后逐任务串行 `mat_gaussian`。
- **每次提交必传 `task_ref`**：`{"portfolio_file": "<绝对路径 manifest>", "task_id": "<taskId>"}`——
  预算闸在工具内生效：`BUDGET_REJECTED` 前缀错误 = 未提交，如实记录该任务的
  note（"budget_rejected: <reason>"）并继续；提交成功则台账自动记账（你无需手动记），
  你只需照常 `update --phase submitted --jobid <slurm id>`。
- 重试路径：先 `portfolio-cli retry`（attempts+1、相位回 prepared）再重新提交——
  预算闸按 attempts 派生重试身份。
- 注入任务按清单 injectedNote 执行（F1 改坐标、F2 覆盖 route 属实验设计，照做）；
  **V9 跳过提交**（needs_human）。
- 资源档：小体系统一 8 核/16GB（pre_json.resources + run_json.slurm 同步降档，
  slurm.ntasks_per_node ≥ resources.ncores 校验仍生效）。
- 全部提交后：挂起等通知（一站式 producer 终态自动 post 并投递完成通知），醒来后
  逐任务 `update --phase settled`（终态以 job_output/通知为准，禁手 poll sacct）。
