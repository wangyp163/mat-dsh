# mat 批量任务子 agent 化 Spike 计划（batch-subagent）

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. 本计划是**实验设计**：目标是验证工程命题并产出证据，不是交付生产功能。执行涉及真集群配额，Task 2 起每相位开工前需用户确认。

**Goal:** 用一个真实批量场景（10 体系 Gaussian opt+freq，含 2 例注入失败）验证「主 agent 组合经理 + 一次性子 agent fan-out + 确定性监控」架构在 mat-dsh 上的可行性，量化 fan-out 的收益边界，并试炼四个新工程件（manifest / 层间契约 / 预算闸 / 角色化 toolFilter）。

**Architecture:** 主 agent 只持有外置 manifest（任务 → 状态 → 结构化结论），制备/分诊/解读经一次性子 agent（`outputSchema` + `toolFilter`）消化非结构化中间产物；提交与监控走现有 `mat_gaussian` 一站式路径不变（watch-loop/解析/自动 post 仍是零 LLM 确定性代码，契约回放测试照旧覆盖）。子 agent 在等待期零模型请求——由宿主 job-done 通知唤醒。

**Tech Stack:** 现有栈不变（dsh 0.1.0-rc.8 web profile + `--patch` overlay + mat-core/tools）。新增均为树外代码：`mat-core/src/portfolio.ts`、`mat-core/src/contracts/`、`mat-core/src/budget.ts`。模型侧子 agent 尽量路由 `deepseek-v4-flash`（成本），主 agent 保持现路由。

**前置事实（已核实，2026-09-15）:**
- web profile bundle 含 `tool-subagent` / `tool-subagent-control` / `tool-subagent-fork`（`$DSH/packages/bundle/web-app/cordis.patch.yml:395-407`）；`SubagentStartRequest` 支持 `outputSchema`/`toolFilter`/`persona`/`agentOptions`（`$DSH/packages/subagent/subagent/src/types.ts:100`）。
- 宿主 job 完成通知会唤醒 owner agent（`$DSH/packages/jobs/tool-jobs/src/index.ts:279-300`：空闲 `followup` 开新轮，忙碌 `inject` 入下一步收件箱）。
- `exec-gate.ts` 是 (mcpKey, clusterId) 全局串行闸（并发输出串扰修复）——**所有子 agent 的集群往返都会排队**。这是假设 H2 的来源。

---

## 1. 场景定义

### 1.1 批量清单（10 体系，B3LYP/6-31G(d)，最小资源档）

8 个正常体系（小分子，opt+freq 分钟级）：

| # | 体系 | 说明 |
|---|---|---|
| V1–V8 | H2O, CH4, NH3, CH3OH, C2H4, H2CO, HCN, CH3F | 稳定小分子，应全部 COMPLETED 且无虚频 |

2 个注入失败（**必须**写进 manifest 的 `injected` 字段，禁止隐瞒）：

| # | 注入方式 | 预期失败形态 |
|---|---|---|
| F1 | 两原子近重合坐标（差 1e-4 Å） | 过 pre 校验、g16 运行期几何错误（l103/l202 族），快速失败 |
| F2 | route 整体值覆盖 `opt(MaxCycles=3)`（带核心 token 的完整值，V5 体系） | opt 步数超限不收敛，正常终态但未收敛 |

F1/F2 都在 pre 阶段合法（schema 不拦）、在集群上快速失败——注入成本趋近于零，且失败形态覆盖「崩溃型」与「正常终止但科学不可用型」两类分诊输入。

### 1.2 预算硬顶（实验自身受预算闸管辖）

- 总 sbatch ≤ 12（10 首提 + 2 重试余量）；单体系重试 ≤ 1 次。
- 总核时估计 ≤ 5 核时（8 核档 × 分钟级作业）。
- 子 agent 总 token 预算：记录不设限，但每相位后汇总；超 2× 预估值即中止相位并记录。

### 1.3 验收形态

产出一份结论页（`mat-dsh/docs/evidence/batch-subagent/CONCLUSIONS.md`）：假设 H1–H8 逐条 confirmed / refuted / inconclusive + 证据指针；四个工程件各自「保留投产 / 需改造 / 放弃」的建议；主会话上下文增长、总 token、墙钟时间的基线对照表。

## 2. 假设清单（实验要判定的工程命题）

| # | 假设 | 判定手段 |
|---|---|---|
| H1 | 制备/分诊/解读经子 agent 后，主会话上下文增长降到基线 1/3 以下 | session-debug 对比基线（§4 Phase A） |
| H2 | 子 agent 并发集群 I/O 被 exec-gate 串行化；fan-out 收益仅存在于本地判断类工作 | 分诊相位墙钟 vs 串行对照；gate 排队可观测 |
| H3 | 等待期零模型请求：挂起 agent 在 watch 结算通知前无 LLM 调用 | transcript 事件时间线 |
| H4 | 10 个 watch 结算的通知合并后，唤醒轮次 ≤ 3 | session 事件计数 |
| H5 | `outputSchema` + 本地校验器把分诊结论压成 ≤10 行结构化数据 | 契约测试 + 实际回传 |
| H6 | 预算闸在超预算 sbatch 时结构化拒绝（先测试后实弹） | vitest + 一次故意超限调用 |
| H7 | 子 agent 异常 stopReason（error/max-tokens）可被主 agent 发现并按 manifest 重派或上报 | 注入 1 个坏 prompt 子 agent |
| H8 | `toolFilter` 生效：制备工调不出 `mat_exec`，分析师无 exec 类工具 | 子 agent 内实测调用被拒 |

## 3. 新建工程件（全部树外，TDD）

| 件 | 位置 | 内容 |
|---|---|---|
| P1 manifest | `mat-core/src/portfolio.ts` | JSON 清单：task_id/体系/phase/job_id/verdict/cost/attempts/injected；读写 + 增量查询（「自上次读取以来变化的行」语义，对齐 watch-loop readOutput） |
| P2 层间契约 | `mat-core/src/contracts/` | 三个 zod schema + 校验器：`prep-verdict`（体系→pre.json 就绪/缺陷）、`triage-verdict`（失败类别/证据行/重试建议/预估成本）、`interpret-verdict`（converged/虚频数/科学可用判定）。子 agent 回传先过校验，不过即拒收重试一次 |
| P3 预算闸 | `mat-core/src/budget.ts` | 声明计划（来自 manifest 初始化）+ 台账（sbatch 计数/核时估计/重试计数）；接线 `mat_sbatch`/`mat_gaussian` 工具入口，超限返回结构化错误（非抛异常）。注意：这是**预算闸**，与既有 exec-gate（串行闸）正交 |
| P4 角色档案 | `mat-dsh/skills/`（新增 batch-roles 说明） | 三个角色的 persona/协议文案 + 对应 `toolFilter` 白名单：制备工（无 exec 类）、分诊工（只读 exec：cat/tail/sacct）、分析师（无 exec，只消费已取回数据） |

不变的（红线）：watch-loop、job-state、gaussian producer、契约回放测试、exec-gate、mat_gaussian 一站式语义、skill 的门禁/确认纪律（破坏性命令确认、门禁第一条、版本锚）一律不动。

## 4. 相位与任务

### Phase A（Task 0–1）：基线与前置

- [ ] **Task 0: 前置核对**
  - 实机确认 `subagent` 工具在当前 web profile 会话中可用（纸面已核实 bundle 含之）；确认子 agent 可指定模型路由（`agentOptions`）——不可指定则记录并用默认路由。
  - 集群门禁一次（`check_environment.sh`，版本锚对齐）；cluster_id 以 env.local 当前值为准。
  - 基线材料：不重跑全量——复用既有压测取证（`docs/evidence/gw-merge-stress/`、skill M15/M22 引用的 S1–S3 会话）经 session-debug 提取「主会话上下文增长、手工分诊轮次」作对照基线；另跑 1 个体系（V1）单 agent 直通作校准点。
- [ ] **Task 1: 工程件 TDD**（P1/P2/P3 先写失败测试再实现；P4 只写文案不写代码）

### Phase B（Task 2）：批量制备 fan-out

- [ ] 主 agent 初始化 manifest（10 行，含 injected 标记、预算声明）。
- [ ] 5 个一次性制备子 agent × 2 体系：读用户意图 → 生成 xyz/pre 输入 → 过 P2 `prep-verdict` 契约 → manifest 回写。`toolFilter` 禁 exec（H8）。制备工本地生成，**不上传**——上传集中在 Phase C（H2 的对照面）。
- [ ] H7 注入点：1 个制备子 agent 故意给坏 prompt（引用不存在文件），主 agent 应捕获 stopReason 并重派或标 `needs_human`。

### Phase C（Task 3）：集中提交 + 批量监控

- [ ] 主 agent（非子 agent）串行走 10 次 `mat_gaussian` 一站式（秒级返回 job_id + 后台 watch）；观察 exec-gate 对 10 次串行往返的实际墙钟（H2 数据点）。
- [ ] 全部提交后主 agent 挂起；watch 结算通知唤醒（H3/H4：transcript 时间线 + 唤醒轮次）。
- [ ] manifest 回写 job_id/终态（job_output 终态表为准，不读 log 原文——skill 纪律）。

### Phase D（Task 4）：失败分诊 fan-out

- [ ] 对 F1/F2 各起 1 个一次性分诊子 agent：`toolFilter` 只读（cat/tail/sacct），读 log_tail/诊断 post 行 → `triage-verdict` 契约回传（失败类别/证据/重试建议/预估成本，≤10 行，H5）。
- [ ] 主 agent 按裁决 + 预算闸决定重试：F1 修坐标重提 1 次（应转绿）；F2 建议放弃并上报（验证「预算内重试」与「上报不硬撑」两条路都走得通）。

### Phase E（Task 5）：解读 fan-out + 汇总

- [ ] 8 个正常体系 → 2 个一次性分析师子 agent × 4 体系（并行度故意 ≠ 制备相位，采集 fan-out 度对 token/墙钟的曲线）：消费结构化 result/properties（不读 log 原文），`interpret-verdict` 回传。
- [ ] 主 agent 汇总成最终表（体系/能量/虚频/可用性）+ 一份 ≤30 行报告——这一步**必须**主 agent 亲自做（fan-in 判断是组合经理职责）。

### Phase F（Task 6，可选 stretch，前五相全绿才做）

- [ ] 1 个 continuable shepherd 接管 F1 修复重试全程（提交→被通知唤醒→验证→reportFrom 汇报），验证 followup/reportFrom/冷恢复机制。只批 1 个体系的重试预算。

### Task 7: 结论页

- [ ] `CONCLUSIONS.md`：H1–H8 判定表、工程件去留建议、成本对照（基线 vs fan-out）、「下一相位值得做什么」（含 continuable shepherd 是否升级为标准件）。

## 5. 执行约定（沿用 M0 + 本实验新增）

- 沿用：宿主 `$DSH` 零修改（每任务末 `git -C $DSH status --short` 为空）；evidence 原样落盘（本实验 → `mat-dsh/docs/evidence/batch-subagent/`，按相位分目录）；TDD 铁律；凭证只走 env.local。
- 新增：
  - **声明计划即预算**：Phase B 初始化的 manifest 是唯一合法提交计划；计划外 sbatch 必须先问用户（预算闸强制）。
  - **注入失败透明**：F1/F2 在 manifest、最终报告、结论页三处都必须标注 injected。
  - **skill 纪律继承**：子 agent 同样受门禁第一条、破坏性命令确认、版本锚约束——角色档案（P4）里逐条写入。
  - 每相位结束 commit 一次 evidence；中断可从相位边界续跑。

## 6. 度量与风险

**度量口径**（每相位采集）：主会话上下文增量（session-debug）、子 agent 逐个 token 用量、墙钟（提交/等待/分诊/汇总分段）、exec-gate 排队可观测指标、唤醒轮次、自治决策数 vs 上报数。

**风险与中止条件**：
- 队列拥堵 → 低峰时段执行；排队 >1h 的体系标 `deferred` 不阻塞后续相位。
- HPC 传输抖动 → watch 已有 5 次容错；连续抖动按既有重跑协议。
- token 超估 2× → 中止当前相位，记录后跳 Task 7（负结果也是结果）。
- 子 agent 大面积不听话（忽略 toolFilter/契约）→ 本身是 H8/H5 的 refuted 证据，记录并收缩回主 agent 直做。
