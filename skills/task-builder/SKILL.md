---
name: task-builder
# description 禁半角冒号（frontmatter 纪律，同 gaussian-calc）。
description: Use this skill to QUICKLY BUILD runnable Gaussian tasks from a minimal flow description plus a parameter template (参数模板、最小描述、快速建 task、搭一个计算任务、构建计算流程). You turn the user request into a goal.json (aimater.goal.v1), call the local deterministic compiler mat_task_build, relay its blocking questions or parameter summary, and after user confirmation execute the compiled runbook (one-stop mat_gaussian or stepwise multi-wave chain). Composes on top of gaussian-calc tooling; gaussian-calc remains the full-protocol reference skill.
version: 0.2.1
metadata:
  adapted-for: mat-dsh
  source: mat-dsh D0 P3 工具接线（2026-09-19 首版）
  adaptation: 首版定位为 D0 架构「LLM 两端 + 中间确定性」的产品化入口——planning.ts（aimater.goal.v1）+ task-package.ts（aimater.taskpackage.v1 编译器）+ mat_task_build 工具的工具面 SOP。范围 V1 仅 Gaussian；参数模板承载面 = method.route_kwargs + resources.ncores/memory/walltime；one-stop digest 与 mat_gaussian 确认闸同源（用户批准后首次调用即可带 confirmed_digest 直提）。；2026-09-23 M33 通道归属机制化：execution.mode 成为通道唯一权威（mat_gaussian 拒 stepwise / pipeline 与 pool 拒 one-stop，双向 WRONG_CHANNEL 且零集群副作用）——「数波数选工具」从模型判断降为查字段；pipeline 由「长链/批量推荐」改为默认通道，手工逐波只在波间需用户插手时选（意图判断，与链长无关）；版本 0.2.1
---

# Task 构建器（LLM + workflow adaptor）

## 定位与分工

用户给**参数模板 + 计算流程最小描述**，本 skill 把它变成可在 HPC 上运行的 task。你（LLM）只站在两端：**意图 → goal.json** 与 **结果 → 报告**；中间全部是确定性代码（`mat_task_build` 编译器，无 LLM、零集群副作用）。

| 场景 | 用哪个 |
|---|---|
| 参数模板 + 最小描述，快速建一个 task | **本 skill**（先 goal 后编译后确认） |
| 交互式/全协议 Gaussian 工作（诊断、诊断-重试、逐 phase 核查） | gaussian-calc（本 skill 的执行段即其工具面） |

## 第一步：收集最小描述 → goal.json

最小描述三要素（缺一进澄清，**禁静默编造**）：

1. **结构**：xyz 内容（`ts`/`qst2`/`qst3` 为多帧单文件，帧序=分子节序，元素列纯元素符号）。
2. **流程意图**：用户说性质关键词，你映射为 `intent.want` 动词——不要求用户给 task 名：

   | 用户说 | want 动词 |
   |---|---|
   | 优化/弛豫 | `optimize` |
   | 频率/红外谱 | `frequencies` / `spectrum-ir` |
   | 单点能 | `energy` |
   | 过渡态 | `ts` |
   | 反应路径/IRC | `irc` / `reaction-path` |
   | 绝热电子亲合能 | `aea` |
   | 偶极/极化率/TD/荧光/RESP 电荷 | `dipole` / `polarizability` / `td` / `fluorescence` / `resp-charges` |

3. **参数模板**：用户的标准参数集（如 `{method: B3LYP, basis: def2-TZVP, ncores: 16, memory: 32GB}`）映射进 goal 字段。

**参数优先级**：用户显式值 > 参数模板 > 默认档（B3LYP/6-31G(d)、32 核/64GB）——每个未显式给的参数都会出现在编译输出的 assumptions 里，转述时带上。**模板里有你映射不进 goal 契约的键，必须阻塞式问用户怎么处理，禁静默丢弃。**

goal.json 契约（`aimater.goal.v1`）速查：

| 字段 | 说明 |
|---|---|
| `structure.{label, xyz, source}` | label=体系标签（复用查询键，默认 workdir 基名）；xyz 原文；来源审计 |
| `intent.want[]` | 意图动词（上表）；引擎确定性映射为 task DSL |
| `intent.reaction.{reactants_xyz, products_xyz, description}` | 过渡态/路径类意图的可选反应语境 |
| `method.{method, basis, route_kwargs}` | 方法/基组；`route_kwargs` 承载模板附加键（如 `ioplist`、`opt: ["Tight","CalcFC"]`） |
| `charge` / `mult` | mult 缺省时引擎按电子奇偶推断；奇电子体系引擎会生成阻塞式澄清 |
| `accuracy` | `fast`/`medium`/`slow`（只影响 walltime 档；显式 `resources.walltime` 优先） |
| `resources.{partition, ncores, memory, walltime, max_core_hours}` | partition 计费相关**不自动选**；ncores/memory/walltime 是模板资源档承载面 |
| `context.prior_result_ref` | 引用历史结果 |

**route_kwargs 路由键禁区**（硬规则，违反即 INVALID_GOAL）：路由键 `opt/freq/td/irc/polar/force/scan` 只允许出现在 task 自身路由集内（`opt`→opt、`freq`→freq、`opt+freq`→opt+freq、`tddft`→td、`irc`→irc、`polar`→polar）；其余 task（sp/ts/qst2/qst3/组合链等）携带任何路由键都会被拒绝——路由身份由 `-t task` 决定。一等字段 `method/basis/charge/mult` 出现在 route_kwargs 里会被忽略并记 assumption。

## 第二步：编译（一次工具调用）

```
mat_task_build({goal_json: <goal 对象>})
```

编译器自动查 mat-db 复用飞轮（同 label+task 的 converged 历史会标记复用）。三种输出：

- **`INVALID_GOAL`**：按错误提示修 goal 重建（路由键/walltime 格式等契约错误，不进澄清环）。
- **`NEEDS_CLARIFICATION`**：逐条**阻塞式**向用户转述问题（选项原样列出、带推荐），按答复修订 goal 后重新调用。典型：缺结构、奇电子缺 mult、缺分区。
- **`TASK_PACKAGE_READY`**：进入第三步。

## 第三步：确认（确认闸，O2）

向用户**逐字转述**编译输出的「计算参数摘要」（method/basis/charge/mult、资源、slurm、预估核时、digest）——**数字只来自摘要投影，不得改写或凭记忆补数**。有 `BUDGET_WARNING` 行（预估核时超 `max_core_hours`）必须明示超出并取得接受。用**阻塞式提问**等待确认，禁文本收尾。波次带 `[reuse]` 标记时，是否采纳复用（不重算）必须用户明示。

## 第四步：执行（按 runbook，不即兴）

**通道不用你判断**：编译输出的 `execution.mode` 已经给出结论（`one-stop` / `stepwise`），它由 `isStepwiseTask` 按 task 注册表确定性算出。不要自己数波数推导，也不要在两个工具间试——用错通道时两侧都在任何集群调用之前以 `WRONG_CHANNEL` 拒绝并指路。

- **one-stop 模式**（`execution.mode == 'one-stop'`）：按输出第 2 条原样调用 `mat_gaussian`，**首次调用即可带 `confirmed_digest` 直提**（digest 与确认闸同源）。若仍返回 `CONFIRM_REQUIRED`，说明构建后参数变动——回 `mat_task_build` 重建，禁手改参数重试。
- **stepwise 模式**（`execution.mode == 'stepwise'`；多波组合 `ts+irc`/`qst2+irc`/`qst3+irc`/`tsxtb+ts+irc`，及需分波提交的 `opt+sp`/`aea`）：**默认交给代码 pipeline**，只有一个理由选手工——用户需要在波间查看或批准什么。这是关于意图的判断，与链长、批量规模无关。
  - **代码 pipeline（默认，M31 起）**：runbook 第 1-4 步（确认、输入落盘、pre）由你完成后，调 `mat_pipeline_start(pkg_digest, cluster_id, workdir)` 把逐波循环整条交给代码——门检、attempts 记账、处方梯重试、死信全自动；你只在 needs_llm 唤醒时按 gaussian-calc 诊断协议处置并以 `mat_pipeline_resume` 续跑，终态通知后读 result.json 出报告。
  - **手工逐波（仅波间需插手时）**：机制化程度严格更低——门检、记账要你逐次传参，处方梯重试／死信／needs_llm 唤醒全都没有，得你自己扛。严格按输出 runbook 逐波执行——全程同一 `{work_dir}` 与完整 task DSL 字符串；逐波 `run（渲染前沿）→ mat_sbatch（带 wave_gate 门检与 attempts_ledger 自动记账，M31 起机制化）→ mat_job_watch → 终态后先 post 再门检`。门检读 result.json 的结构化字段（如 `ts.converged == true` 且 `ts.imaginary_frequency_count == 1`），**不过不进下一波**（带 wave_gate 时工具直接 GATE_FAILED 拒绝提交）；门检不过或 FAILED 时按 post 的结构化错误（error_detail/kb 引用，kb_hint 已直接携带处方梯级）诊断处置。`composition incomplete: pending steps` 在链中属预期。

## 第五步：结果消费

终态后直读结构化字段报告：properties（energy/converged/frequencies_cm-1/imaginary_frequency_count…）、plots（图 PNG + CSV 两类路径，`image: null` 时告知缺 matplotlib、数据在 CSV）。**不 grep log 原文。** tsxtb 结果报告时附 gau_xtb 引用（Tian Lu, gau_xtb, http://sobereva.com/soft/gau_xtb）。

## 红线

- 缺料必问，禁静默编结构/参数；模板未知键禁丢弃。
- 确认前零集群副作用；摘要数字只来自投影。
- partition 计费相关不自动选。
- 破坏性命令（rm/rm -rf/mv）先列目标经用户确认；非本会话创建的目录一律视为他人数据。
- 提交后不手动 squeue/sacct 轮询；长时间静默通常是排队（状态板可见排队/运行相位）。
