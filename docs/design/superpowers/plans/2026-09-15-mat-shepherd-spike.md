# mat shepherd spike 计划（continuable 子 agent 实弹）

> **For agentic workers:** Steps use checkbox (`- [ ]`)。执行涉及真集群配额（≤6 sbatch / ≤3 核时）；Phase C' 起每相位开工前需用户确认。前一个 spike 的结论页：`mat-dsh/docs/evidence/batch-subagent/CONCLUSIONS.md`。

**Goal:** 验证批量架构的最后一块未验证拼图——**continuable（可续）shepherd 子 agent 全权负责计算链的端到端生命周期**：跨波推进、中途指令注入、中途汇报、预算闸管辖、（stretch）进程崩溃后冷恢复。同时落地 batch-subagent spike 留下的三项工程修正。

**Architecture:** shepherd = `subagent_shepherd` 工具挂载的可续后台子 agent（全 mat 工具面 + 禁 subagent\* + maxDepth 0）。**关键设计约束（前置探针发现）**：rc.8 的 continuation manager 不感知后台作业——可续子 agent 结束回合时其拥有的后台作业会被 `owner disposed` **取消删除**（`subagent/src/continuation.ts:932-940,1405` + `jobs-local/src/index.ts:466-475`）。因此 shepherd 采用**前台长回合跑波次**（提交→回合内等待通知→结算→门检→下一波，spike 1 Phase C 主 agent 已实证同构形态），continuable 的价值在：跨波 `send_message` 注入、`reportFrom` 中途汇报、冷恢复。

**Tech Stack:** 不变（dsh 0.1.0-rc.8 树外 overlay）。新增：`mat-tools/src/manifest-hook.ts`（settle 快照）、`mat-dsh/scripts/fold-child-usage.ts`（子会话用量折叠）。

## 0. 前置事实（2026-09-15 探针核实）

1. `tool-subagent-control`（send_message/interrupt_agent）在 web profile **disabled: true**——overlay 须显式启用（同 skill-filesystem/tool-subagent 的坑）。
2. 可续启动：挂载 config `backgroundMode: continuable`，`run_in_background` 缺省即 true，返回 `{kind:'continuable', subagentId}`（inbox acceptance 即返回，不 collect 结果）。
3. `send_message` 按子会话 id 寻址（FIFO next-turn）；**冷恢复可用**：无驻留 Activation 时从持久化子会话 resume（需持久化后端 + **直接父会话先复活**）——`continuation.ts:945-994`。
4. `report` 工具对可续 in-process 子 agent **自动注入**（子作用域注册，toolFilter 不可滤），默认 `next-step` 交付（steer 唤醒空闲父）。
5. 子 agent 通知唤醒：owner 相对（子 agent 一样可被 job-done 唤醒/注入），**仅当其 Activation 驻留**（running 或 waiting）——见上设计约束。
6. per-child 用量在子会话日志的 `assistant/message.usage` 逐事件可折叠（token-meter 投影同源）。
7. 深度：maxDepth 运行时强制 + toolFilter 双保险（`depth.ts` + `child-agent.ts:48-57`）。

## 1. 场景定义

**2 体系 × 分步两波链（opt → freq）**：H2O 与 CH3OH。shepherd 全权：第一站 `mat_gaussian` task=opt → 回合内等完成通知 → 门检（converged=true 才许进 freq，对齐 M22 门检协议）→ `mat_exec` 读远端 `g16_optimized.xyz` 转第二站 structure → 第二站 task=freq → 等通知 → 终态门检（converged + 虚频数）→ `reportFrom` 交付两站摘要。

- 体系选择刻意保守（都应顺利）——本 spike 聚焦**机制**变量，失败路径已在上个 spike 覆盖。
- **中途注入**：两体系的第一波进行中，经理 `send_message` 给 shepherd："汇报当前进度与预算台账"——验证 FIFO 注入 + 中途 reportFrom。
- **门检失败分支**（若自然发生）：按协议上报不硬撑（预算闸硬顶兜底）。

预算：sbatch ≤6（4 首提 + 2 余量）、单体系重试 ≤1、核时 ≤3。F 系注入失败**不设**（上 spike 已覆盖，控制变量）。

## 2. 假设清单

| # | 假设 | 判定手段 |
|---|---|---|
| S1 | 可续机制实弹：启动返回 subagentId；中途 send_message FIFO 生效；reportFrom 中途汇报以 `subagent-report` 源落地经理会话 | 会话事件时间线 |
| S2 | 前台长回合通知驱动：shepherd 回合内，作业完成通知在步边界送达 shepherd（子 agent owner 唤醒），零轮询 | shepherd 会话 transcript |
| S3 | 冷恢复（stretch）：服务重启→经理会话复活→send_message 冷恢复子会话续链或对账收尾 | 重启实验 + 续跑 runbook |
| S4 | 长寿会话上下文有界：shepherd 完成两波链其会话上下文 <60k；经理会话只增 reportFrom 摘要（≤10k） | token 折叠 |
| S5 | 预算闸管得住 shepherd：其每次提交带 task_ref 过闸；重试身份/上限生效 | 台账 + BUDGET_REJECTED 路径 |
| S6 | 子会话用量可折叠：fold-child-usage 脚本从子会话日志出 per-shepherd token 用量 | 脚本输出对账 |
| S7 | 负发现文档化：settled 可续子的作业被 owner-disposed 清理——复验一次（空载子 + 作业 + 结束回合 → 作业被杀）并写成上游反馈项 + skill 纪律（"波内不结束回合"） | 定向小实验 |

## 3. 工程修正（Phase A'，全部 TDD/树外）

| 件 | 位置 | 内容 |
|---|---|---|
| C1 manifest 快照钩子 | `mat-tools/src/manifest-hook.ts` | mat_gaussian 提交成功时把**远端 workdir 绝对路径**记入 manifest 任务；producer settle（onResult）时把 properties 摘要（energy/converged/imaginary_frequency_count/文件清单）快照进任务字段——相位间数据传递走清单（上 spike E 相 31 次 exec 的根治） |
| C2 任务规格钉死 | portfolio.ts 任务 `spec` 字段 + CLI update 透传 | calc type/method/资源档随任务声明；提交时经理从 manifest 读规格，禁现场发挥（上 spike V1–V8 跑成 opt-only 的根治） |
| C3 子会话用量折叠 | `scripts/fold-child-usage.ts` | 按子会话 id 折叠 usage 事件（对齐 token-meter 投影语义），输出单行摘要进 evidence |
| C4 overlay | profiles/mat.yml | enable `tool-subagent-control`；挂 `subagent_shepherd`（provider spawn、backgroundMode continuable、toolFilter 允许 mat 全套+skill+read+bash+job_output、**deny subagent\***、maxDepth 0、agentOptions flash） |
| C5 skills | batch-roles / batch-orchestrator | 新增 shepherd 角色协议（长回合纪律、门检、reportFrom 时机、预算纪律）；orchestrator 补"每相位全新会话+manifest 恢复=标准模式"与"波内不结束回合"约束 |

## 4. 相位与任务

### Phase A'（Task 0–2）：修正与挂载
- [ ] Task 0: S7 定向小实验（空载 continuable 子 + 作业 + 结束回合 → 观察作业被 owner-disposed 清理），负发现定案
- [ ] Task 1: C1/C2 TDD（先红后绿：快照字段往返、spec 校验、workdir 记录）+ C3 脚本 + 烟雾
- [ ] Task 2: C4 overlay + dump 验证 + 服务重启；C5 skill 文案

### Phase B'（Task 3）：机制探针（零集群）
- [ ] 空载 continuable 往返：启动（得 subagentId）→ send_message（FIFO）→ reportFrom（落地经理会话，验 source=subagent-report）→ interrupt_agent（lineage 校验）→ S1 判定

### Phase C'（Task 4）：实弹链【用户确认后】
- [ ] manager 会话（新会话+manifest）委托 shepherd ×2 体系（并行或串行，声明预算）
- [ ] shepherd 长回合跑 opt→门检→freq→终检→reportFrom；中途经理注入进度询问（S1/S2/S4/S5 观测点）
- [ ] C3 折叠 shepherd 用量（S6）

### Phase D'（Task 5，stretch）：冷恢复【用户确认后】
- [ ] 链中重启服务 → Slurm 作业继续远端跑 → 经理会话 re-prompt 复活 → send_message 冷恢复 shepherd → 对账续链/收尾（S3；对账协议引用 gaussian-calc 续跑 runbook）

### Task 6: CONCLUSIONS-2
- [ ] S1–S7 判定、机制结论、上游反馈清单（owner-disposed 作业清理为首要项）、shepherd 是否升标准件的裁决

## 5. 执行约定

沿用前 spike 全部铁律（宿主零修改、evidence 落盘 `mat-dsh/docs/evidence/shepherd-spike/`、TDD、凭证 env.local、注入透明、每相位 commit）+ 新增：
- **shepherd 波内不结束回合**（S7 机理约束，写进角色协议）
- 冷恢复实验前必须确认远端作业状态（sacct 探针），重启窗口避开其他在跑会话
- 中断/恢复全程 sacct 对账，远端作业不允许被本地实验误杀（job_kill 只杀监控）

## 6. 风险与中止

- shepherd 长回合跨多分钟——上游 LLM 400 瞬断（压测见过）→ 续跑 runbook 兜底
- 冷恢复若 `NOT_RESUMABLE`（描述符丢失等）→ S3 记 refuted/obstacle，不强拆
- 预算闸拒绝 shepherd 提交 → 按协议上报，不绕闸
