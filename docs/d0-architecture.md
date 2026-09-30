# D0 架构总图：goal → plan → run 的科学计算 Agent 架构

> **状态声明**：本文是 D0 架构的**设计态**记录（2026-09-18 定稿于架构评审系列讨论）。落地计划见 `d0-landing-plan.md`；各阶段完成时按实际实现刷新为**实施态**。决策依据的完整推理存于 `langgraph-practice/DECISIONS.md`（D0-D2.1）。

## 1. 一句话定位

LLM 只站在两端（意图 → goal；result → 报告），中间全部是确定性代码：环境门禁、plan 引擎、calcflow 三相位、异步监控、KB 诊断。**约束住契约与工具层，不住提示词。**

## 2. 主线与四个闭环

```
agent(LLM+harness) ──意图──→ goal.json（材料上下文 + mat-db 用户偏好/历史）
    ↓                                        ↑ 复用飞轮
【环境门禁】版本锚 / 任务注册表 / 凭证 —— 计划前快败（先于用户确认）
    ↓
workflow engine: plan(goal) → plan.json（DAG + 并发度 + 关键参数 + 预估核时）
                          + questions[]（结构化澄清项）
    ↓ 澄清环: questions → agent 问用户 → 修 goal → re-plan
【确认闸】三层：summarize(plan) 纯代码投影 → skill 转述 → run(plan_id, confirmed_digest) 硬校验
    ↓
pre → sbatch →【异步监控 mat_job_watch】→ 终态通知唤醒会话 → post
    ↓                                   ↘ 失败环: 结构化错误 → KB 签名匹配
result.json（calcflow.result.v1）            → 处方梯进 → attempts 重试（engine 自愈）
    ↓                                        耗尽/未知 → 死信 → agent → 人
agent(LLM)：直读结构化字段 → 报告/图表 → mat-db 入库（回环）
```

| 闭环 | 语义 | 状态归属 |
|---|---|---|
| 澄清环 | plan 的 questions 结构化澄清，确认前完成 | goal.json（会话内） |
| 失败环 | KB 诊断 + 梯进重试 engine 自愈；死信不盲目重试 | attempts.jsonl + diag/ |
| 复用飞轮 | result 入库 → 下一次 plan 的复用决策 | mat-db（SQLite） |
| 恢复环 | 状态外置 + stale-scan 续跑（沿 mat-dsh 哲学，不引入图 checkpoint） | plan.json / manifest / jobs.json |

## 3. 盒子 ↔ 资产映射（新盒子只有三个）

| 架构盒子 | 资产 | 状态 |
|---|---|---|
| goal.json schema | 从 pre.json 语义上层导出 | **新建** |
| plan() 相位 | calcflow 契约扩展（复用版本锚治理） | **新建**（workflow 侧） |
| mat-db | SQLite 三表 + 查询工具 | **新建**（agent 侧插件） |
| 环境门禁 | `check_environment.sh` / env-gate v2（版本锚 + missing_tasks） | 已有 |
| 确认闸 | O2 阻塞式确认 + `BUDGET_REJECTED` 同款 digest 模式 | skill 层已有，digest 小改 |
| pre/run/post | calcflow（workflow 锚 1.7.3） | 已有 |
| 异步监控 | `mat_job_watch`（JobHooks 自适应轮询、零模型请求、完成唤醒） | 已有 |
| result.json | `calcflow.result.v1` | 已有 |
| 失败环 | `references/` KB + attempts + diag/ 契约 | 已有 |
| 执行宿主 | dsh 0.1.0-rc.8 + 树外插件（见 D1：缺的能力以插件原生生长） | 已有 |

## 4. 关键决策索引

- **D1 宿主路线**：以 dsh 为基座原生生长（不迁移、不嵌框架）；引擎住 mat-core 纯库、宿主只留薄壳；LangGraph 期权保留不行权。
- **D2 契约归属**：engine（plan/run）留 workflow 侧；agent 侧只做薄对话环。判据：无 LLM ⇒ harness 无关；复用库在结果产出侧；任务注册表随 workflow 版本化。
- **D2.1 确认闸**：展示是投影（给用户签字的数字必须投影不得模型转述）、对话是 skill、闸是工具契约（`CONFIRM_REQUIRED`）。
- **执行模型**：主线 E1（确认后 engine 托管整链）；agent 侧逐节点调度（逐门审批/预算密集场景）留给 pipeline 插件，两模型并存。
- **范式定位**：业界 P4（工作流骨干 + agent 两端）+ 工具层约束；与 FARS 部署级验证同构。

## 5. 约束归位（判别式 + 总表）

一条约束该写成散文还是做成闸，不凭感觉——按形态判别：

| 约束形态 | 归位 | 形态 |
|---|---|---|
| 结构性可判定（字段/数字/状态可比） | 工具层闸门 | 结构化错误码前缀 + 拒绝即零集群副作用 |
| 判断性（怎么做得对，不可枚举） | skill 散文 | 协议纪律 + 典型处方 |
| 跨进程持久事实 | 远端集群 | sacct / phase 文件 / result.json，宿主可随时重建 |
| 跨客户端共享保证 | 远端协议 | calcflow 契约（不拉回宿主） |

推论：skill 里每一条「必须/禁止」要么有对应结构化错误码，要么明示为判断性指导。**权威唯一在代码，投影同步有纪律**——每一对重复都要能回答「谁是权威、谁是投影」。

当前归位总表：

| 约束 | 归位 | 强制形态 |
|---|---|---|
| 环境门禁（ok/protocol/版本锚/missing_tasks） | 工具（M33） | `ENV_GATE_REJECTED`，四入口前置；按 (宿主进程, 集群, 引擎) + 12h TTL 缓存 |
| 通道归属（一站式 vs 多波链） | 工具（M33） | `WRONG_CHANNEL` 双向闸，判据 `execution.mode ∧ 波数`；不一致即拒并要求重编译 |
| 参数摘要确认 | 工具（M29） | `CONFIRM_REQUIRED` + digest |
| 预算闸 / 相位闸 / 波间门 / 台账 | 工具（M31） | `BUDGET_REJECTED` / `PHASE_GATE_REJECTED` / `GATE_FAILED` / 自动记账 |
| 负裁决阻塞相位 | 工具（M31） | `NEGATIVE_VERDICT` |
| 提交幂等 / attempt cap | mat-core 状态机 | pendingSubmit 收口 + 双路径 cap |
| 科学判据（TS 最小正频 / IRC 方向 / 能量基准） | mat-core 纯函数 | gate 结构化字段 + `runbook-driver-consistency` 一致性闸 |
| log 消费红线 | skill 散文（待毕业） | 尚无谓词——B 批候选 |
| 重试 workdir 语义 / 路由行核对 / diag 目录契约 / 门禁黑盒禁令 | skill 散文 | 判断性，留 skill |
| 收敛校验 / run 不执行二进制 / 相位状态机 | 远端 calcflow | 协议级，不拉回宿主 |

**毕业通道**：约束先以散文落地（改起来快、可逐轮取证），证明可判定后毕业为工具强制。已完成的毕业：M22 波间门检散文 → M31 `GATE_FAILED`；手工 echo 台账 → `attempts_ledger`；M29 确认闸；「波内不结束回合」shepherd 纪律 → pipeline 代码循环；M33 门禁 40 行散文 → `mat_env_gate` 工具闸；M33 「数波数选工具」→ `WRONG_CHANNEL` 双向闸。新增纪律时先问：能不能做成闸？

**闸要成对**：单向闸只挡住一半，而漏掉的那一半往往是更容易走错的方向。通道闸就是实例——正向（pipeline 拒单波）早已存在，反向（一站式拒多波链）缺了整整一轮，而一站式门槛更低、prompt 里更显眼，误用概率更高。新增「A 该走这条、B 该走那条」类约束时，两个方向都要设闸。

## 6. 非目标（明确不做）

- 不引入通用图引擎/宿主迁移（编排模式全系统仅 3-4 种，模式引擎足够）；
- 不为确认点单独建图（图级 interrupt 仅属 pipeline 插件场景）；
- 不把规划逻辑放 agent 侧长期维护（Phase 3 原型必须纯模块 + schema 即契约，便于搬家）。
