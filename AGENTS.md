# mat-dsh 开发纪律

本文件是仓库级硬性约定。改动对应区域时先读本节，违反约定的 PR 不予合入。

仓库定位：基于 DeepSeek Harness（dsh 0.1.0-rc.x）的 HPC 科学计算 harness。本地控制平面（skill / 输入 schema / validator / 声明式控制文件 / 结果解释 / artifact 同步策略）+ HPC 计算平面（workflow 商品 / 科学软件 / Slurm 运行时）。本地只发结构化控制数据（pre.json / run.json / post.json），不上传 workflow 实现。

---

## 一、总纲（跨区域）

### 1.1 树外组合纪律

- **宿主零改动**：本仓的一切能力以树外组合挂进 dsh——组合面只有三个：`profiles/mat.yml`（插件挂载）、`packages/*`（插件实现）、`skills/*`（协议）。不 patch 宿主源码、不 fork 宿主仓库。
- 唯一例外是 `packages/mat-ui` 的 Harmony patch：它对宿主版本有指纹，**跨宿主版本可能静默失效**——升级 `../deepseek-harness` 后必须重验 mat-ui patch 是否仍然生效。
- 树外改不动的宿主机理缺口，以树外协议绕过并记录为上游反馈，不为此破例改宿主。已知三缺口：jobs 不感知子 agent、per-child usage 无 API 面、outputSchema 按次传。

### 1.2 四层拆解纪律

能力沿「状态 / 契约 / 治理 / 权限 / 观测 / 协议」六切面分解，每个切面独立成件，落在四层——**工程件的可独立性正是它可组合性的来源**：

| 层 | 位置 | 职责 | 硬约束 |
|---|---|---|---|
| 纯逻辑 | `packages/mat-core/src` | 状态机、契约、预算、门检 | 零 IO、零 cordis 依赖，执行/定时/持久化全注入——这是可测的前提，不为便利把 IO 塞进状态机 |
| 接线 | `packages/mat-tools/src` | 工具定义、钩子、门闸接线 | 拒绝路径结构化返回，策略用钩子/闸做，不塞进工具 |
| 操作面 | `scripts/` | portfolio-cli、reconcile-ledger、probe 系列 | 人可直接执行、零 LLM 请求 |
| 协议 | `skills/` | 经理/工人/牧羊人 SOP | 见第五节血脉纪律 |

### 1.3 fail-closed 全线与纪律机制化

- 一切拒绝必须**结构化返回 + 零集群副作用**，禁止静默降级：环境门禁 `ENV_GATE_REJECTED`、预算 `BUDGET_REJECTED`、相位 `PHASE_GATE_REJECTED`、波间门检 `GATE_FAILED`、负裁决 `NEGATIVE_VERDICT`、确认闸 `CONFIRM_REQUIRED`——拒收时远端什么都没发生。
- 数据源不可读（门检 result.json、sacct）→ 转 `needs_llm` / `needs_human`，不得用空值或猜测静默放行。
- **批量 N 链必须用 pool，不得用 pipeline 循环**：`mat_pool_start` 是批量路径的唯一正确通道，`mat_pipeline_start` 只驱动单条链。pool 有三个关键纪律：
  - **workdir 唯一性**：每条链必须有各自独立的 workdir，pool 在提交前做批内互撞和撞活链两层检查（`WORKDIR_BUSY`）——同一 workdir 上两条链会互相覆写 `pre.json` 并共享 `result.json`，门检会读到对方的收敛数据，产出静默错误结果，比报错严重得多。
  - **digest 不含结构坐标**：`pkg_digest` 由参数摘要（method/basis/charge/mult/资源/slurm）算出，结构坐标不参与——同参数 10 个反应的 digest 逐位相同。`pipelineId` 自 2026-09-23 起含 workdir 指纹（`pl-<digest12>-<workdir8>`），故 workdir 各异即可并存；但这不影响 workdir 去重要求本身。
  - **maxWaitSeconds 默认 1800s，批量场景必须调大**：这是每波的监控窗口，不是 Slurm 时限。N 条链共用一个分区队列时，排队时间极易超过 30 分钟。到点不结算的链走 `needs_llm` 暂停语义（作业仍在集群，`mat_pool_resume action=retry` + `max_wait_seconds=<更大值>` 续跑）——绝不得重投，重投会双倍耗核时。`cap` 建议保持 2-4，所有命令均过 exec-gate 串行，cap 加大不带来线性提速但会显著加剧锁争抢。
- **纪律成熟即机制化**：协议（skill 文案）是机制未到位时的补位；能下沉为工具层强制的约束不得长期停留在文案。已完成的下沉先例：每波终态先 post 再门检（M22 纪律 → M31 `wave_gate` 工具强制）、attempts 手工台账（→ `attempts_ledger` 自动记账）、V9 负裁决误推进（→ `NEGATIVE_VERDICT` 工具拦截）、「波内不结束回合」（shepherd 纪律 → pipeline 代码循环取代）、环境门禁 40 行散文（M33 → `mat_env_gate` 工具闸 + 四入口前置）。新增纪律时先问：能不能做成闸？
- **门禁是四个提交入口的硬前置**：`mat_sbatch` / `mat_gaussian` / `mat_pipeline_start` / `mat_pool_start` 在门禁不新鲜时拒绝。门禁语义是 per-(宿主进程, 集群, 引擎) + TTL（缺省 12h，`MAT_ENV_GATE_MAX_AGE_MS` 可调），故 batch 子代理自动继承主会话门禁——「门禁第一条继承」已是机制事实，不再是纪律。新增提交类入口必须同样接 `assertEnvGate`；`mat_exec` 不设闸（通用通道，且门禁脚本自身经它执行）。应急开关 `MAT_ENV_GATE=off`（测别的闸时用它旁路，见各 hook 测试）。
- **通道归属是编译器的结论，不是模型的判断**：走一站式还是多波链由 `compileTaskPackage` 的 `execution.mode`（`isStepwiseTask` 算出）确定，双向设闸——`mat_gaussian` 拒 stepwise task、`mat_pipeline_start`/`mat_pool_start` 拒 one-stop 包，一律 `WRONG_CHANNEL` 且零集群副作用。反向闸尤其重要：多波链走一站式会在 `prepare/pre/run` 三步产生远端副作用后才失败在 sbatch（slurm.sh 在 `01-<task>/` 子目录，那一层没有）。判据取 `mode ∧ 波数≥2` 两者合取，不一致即产物损坏 → 拒绝并要求重新编译，**不得择一为准**（单波却声称 stepwise 的链进 driver 会「跑完一波即完成」静默假成功）。`isStepwiseTask` 只需 task DSL 字符串，故跳过 `mat_task_build` 直调一站式同样拦得住。留给模型的判断只有一个：**波间是否需要用户插手**——需要才手工逐波，否则默认 pipeline；这是意图判断，与链长、批量规模无关。

### 1.4 证据纪律

- 三轮实验 / 每次翻车 / 每条新纪律都必须有 evidence 落盘（`docs/evidence/<轮次>/`），纪律条目注明事故来源（真实会话 id 取证）——没有事故就没有这一层。
- 探测先于接线：接新通道前先写零 LLM 探针（`scripts/probe-*.ts`）实弹取证。
- 压测报告过 `pnpm stress:report-lint`；批量收尾跑 `reconcile-ledger` 对账并把报告贴进相位摘要。

---

## 二、批量委托纪律（组合经理 × 角色工人 × 牧羊人）

来源：2026-09-15/16 三轮实验（batch-subagent → shepherd → scale-round），20 假设 18 confirmed，证据 `docs/evidence/FINAL-SUMMARY.md`。协议正文在 `skills/batch-orchestrator` 与 `skills/batch-roles`，本节是其中**不可退让的红线**。

### 2.1 拆解判据与形态选择

三个问题，按序问：

1. **「这个中间产物我愿意直接贴进主会话吗？」**——不愿意（日志、sacct 表、post 输出、长诊断），就该有子 agent 在中间消化。这是上下文经济学的硬判据。
2. **「这段工作里有『读非结构化文本 + 判断』吗？」**——没有（轮询、解析、传输、算术），它是代码工作，LLM 化只有损失（不确定、花钱、不可回放）；有，才是 agent 工作。
3. **「这段工作要跨越等待吗？」**（作业生命周期、多波推进）——要，走 continuable 形态；不要，一次性工人。

四类接管形态与选择顺序：**确定性代码优先**（留在 mat-core，契约回放测试覆盖）＞ **代码链**（批量走任务池 `mat_pool_start`、单链走 `mat_pipeline_start`，机制化逐波循环）＞ **一次性工人 fan-out**（prep/triage/analyst，瘦委托）＞ **牧羊人**（过渡通道，仅限无 task-package 编译产物的存量链）。**组合经理不外委**：manifest 操作、fan-in 汇总、预算声明、失败处置决策必须亲自做。

### 2.2 委托红线（违者即翻车，全部实测产生）

- **瘦委托**：数据先落盘（基准结构→文件、任务规格→manifest spec、properties→快照），工人 prompt 只给**指针**（文件路径 / taskId 列表）+ 变换规则；每条回复最多 **3 个工人**。自含 prompt 不随规模扩展——50 任务时第 10 份 prompt 即 max-tokens 截断。
- **深度锁 1**：工人/牧羊人不得再生子 agent（toolFilter 挡 affordance + maxDepth 运行时硬顶）。
- **提交权集中且过闸**：prep/analyst 的工具目录里根本没有集群工具，triage 只读；牧羊人/任务池的提交通道必须带 `task_ref` 过相位闸+预算闸（工具层强制）；经理也不得把提交权转授给任何无闸通道。
- **规格钉死**：task 类型 / 方法 / 资源档随任务进 manifest 的 spec 字段，禁现场发挥（V1–V8 跑成 opt-only 的教训）。

### 2.3 清单状态纪律（portfolio）

- **manifest 是唯一事实源**：相位只进不退（`PHASE_ORDER`），唯一合法回退是 `portfolio-cli retry`（attempts 记账）。改 `portfolio.ts` 的相位迁移逻辑必须同步其测试。
- 清单操作一律走 `portfolio-cli`，**禁手搓 JSON**；读状态用 `show` 紧凑表，不 cat 原始 JSON。
- 相位间数据走清单（properties / workdir 由工具自动回写），禁跨相位翻旧会话的 job_output 或远端补读。
- **相位推进只看裁决的正面结论**：负裁决（prep `ok:false` / interpret `scientificallyUsable:false`）拒绝推相位（`NEGATIVE_VERDICT`）——契约通过 ≠ 工作成功（V9 教训）。
- injected 任务必带 note（透明纪律）；工人死亡不重试，记 `worker_died` note——死亡是证据。

### 2.4 契约纪律（裁决 schema）

- 工人回传必须是单段 JSON，三个契约之一：`mat.prep-verdict.v1` / `mat.triage-verdict.v1` / `mat.interpret-verdict.v1`（`packages/mat-core/src/contracts.ts`）。evidence / concerns ≤5 行 ×200 字符——这是日志污染的契约面。
- 拒收只重试一次（同角色）；二次不过记 `needs_human`，继续别的任务不停摆。
- 改 schema 字段 = 改跨模块契约：必须同步 `contracts.ts` 校验、`portfolio-cli validate`、`skills/batch-roles` 三处及各自测试。

### 2.5 预算治理纪律

- 清单声明的 sbatch / 重试 / 核时上限是**硬顶**（`budget.ts` + budget-hook）；计划外提交先问用户。
- **每次提交必传 `task_ref`**——经理串行提交、牧羊人、任务池走同一条闸，台账同源，重试上限全局共享。绕过闸的提交入口 = 失控账单，视为 P1。
- 两本账可审计：预算闸估算计费 vs `reconcile-ledger` 的 sacct 实际核时，批量收尾必须对账。

### 2.6 中断恢复纪律

- **组合经理无状态化**：每相位 / 接任用全新会话 + manifest 恢复（服务重启×2、max-tokens 截断、上游 400、会话死亡——五中断实测零损失）。不要在旧会话里续新相位。
- 新会话 / 重启后第一步跑 `portfolio-cli stale` 自愈扫描，恢复完 stale 再继续原计划；pipeline 侧宿主重启后的 running 链用 `mat_pipeline_resume` 的 `reattach` 接手。
- 挂起等通知，**禁手 poll sacct**（等待期模型请求 = 0 是本架构的收益来源之一）。

---

## 三、pipeline 链路纪律（runbook / driver / 状态机）

### 3.1 runbook ⟺ driver 双轨纪律（task package）

**背景。** 一条多波计算链（如 `tsxtb+ts+irc`）在代码里有两个描述：

| 描述体 | 位置 | 消费方 |
|---|---|---|
| runbook（自然语言步骤） | `packages/mat-core/src/task-package.ts` → `stepwiseInstructions()` / `oneStopInstructions()` | LLM（手动 stepwise 路径） |
| driver（代码执行体） | `packages/mat-core/src/pipeline-driver.ts` | 后台 job（自动 pipeline 路径） |

两者描述同一件事却各写各的。改了 runbook 的某一步而忘了改 driver（或反之）**不会有编译错误**，只会在某条特殊失败路径上暴露，且复现困难。

两个 runbook 函数是**模块私有**的，唯一调用点是 `compileTaskPackage()`——它在对象组装后按 `mode` 择一填进 `pkg.execution.instructions`。改 runbook 直接改这两个函数，不要从导出面找入口（`task-package.ts` 的导出只有 `compileTaskPackage` / `formatTaskPackage` / `taskPackageDigest`）。

**约定。**

1. 在 `stepwiseInstructions()` / `oneStopInstructions()` 里新增或修改一条对执行者的**硬约束**时，必须回答：driver 是否也受此约束？
   - **是** → 在 driver 里落实为代码路径或断言，并在 `packages/mat-core/test/runbook-driver-consistency.test.ts` 加对应用例。
   - **否**（纯手动路径的提示）→ 在该条 runbook 文案里显式标注 `(manual path only)`，让读者不必猜。
2. 在 `pipeline-driver.ts` 里改变**执行顺序、门检口径、重试语义、提交纪律**时，必须检查 runbook 对应条目是否仍然真实；不真实就同步改文案。
3. `runbook-driver-consistency.test.ts` 任一用例失败 = 两条轨道已漂移。**不允许通过改测试消除**——先判定哪一侧是对的，再改那一侧。

**锚点。** 该测试文件头部注释列有当前已钉死的纪律清单（同一 work_dir/task DSL、门检不过不进下一波、attempts 自动记账、每波必做 post、step 目录形态、诊断载荷前缀契约）。注意 §3.5 的诊断载荷契约用例也落在本文件（两条：前缀集合与 `diagnosticTextOf` 提取口径一致、无契约行时保守回退整段），不在 `gaussian.test.ts`。

### 3.2 提交幂等纪律（pipeline driver）

`sbatch` 有远端副作用，而状态落盘在其后——两者之间崩溃会留下「集群有作业、状态说没提交」的窗口，重跑即双跑烧核时。

**约定。**

1. **任何发出 `sbatch` 的代码路径，必须先落盘提交意图**（`onSubmitIntent` → `persist`），再发 `sbatch`；拿到 jobId 后才 `onWaveSubmitted` 清除意图。
2. **driver 遇到未收口的 `pendingSubmit` 一律 fail-closed**：转 `needs_llm` 停链，不自行重投。收口权在会话（`mat_pipeline_resume` 的 `action=adopt` / `action=resubmit`）。
3. 新增任何「提交类」远端副作用（sbatch 之外的排队/注册动作）同样适用本纪律。
4. `pipelineFromJson` 会校验 `pendingSubmit.attempt === wave.attempt + 1`。破坏这个不变量的写入路径 = bug。

### 3.3 失败预算纪律（attempt cap）

**约定。** `maxAttemptsPerWave` 是**两条路径共用的**硬上限：

- driver 自动处方梯进（`pipeline-driver.ts`）；
- LLM 手动 `mat_pipeline_resume action=retry`（`pipeline.ts` 的 `resumePipeline`）。

新增任何「让某一波再跑一次」的入口，**必须**同样检查 `attempt >= maxAttemptsPerWave`。绕过 cap 的入口 = 允许无限烧核时，视为 P1 缺陷。批量侧重试同理：必须先 `portfolio-cli retry`（attempts+1、相位回 prepared），预算闸按 attempts 派生重试身份。

### 3.4 门检数据源纪律

**约定。** 门检（`checkWaveGate` / `checkSettledWave`）的输入应当是**远端 `result.json` 原文**，而不是某个内存副本。

- 工具层 `mat_sbatch`（`wave_gate` 参数）走 `packages/mat-tools/src/wave-gate.ts` → 读远端 `result.json`；
- pipeline driver 通过注入的 `readResultJson` 走同一条数据源；
- 门检数据源不可读时 **fail-closed**（`GATE_FAILED` / 转 `needs_llm`），不得用空 properties 静默放行。

新增第三方门检调用点时必须说明其数据源；引入内存副本会重新制造双轨不一致。

### 3.5 诊断载荷契约（producer ⟷ diagnose）

**约定。** producer 与失败环签名索引（`diagnose`）之间靠 `gaussian.ts` 的 `DIAGNOSTIC_LINE_PREFIXES` 通信：

```
diagnostic_post: <workflow post 的结构化 error>
log_tail: <job.log 尾部>
post failed: <post 阶段异常>
```

- 改动这些前缀 = 改动跨模块契约，**必须**同步 `diagnosticTextOf()` 及其测试。
- driver 送进 `diagnose()` 的文本必须经 `diagnosticTextOf()` 提取，不要直接把整段监控日志丢进去（稀释签名命中率，且让格式耦合隐形）。

### 3.6 状态外置与审计纪律

**约定。**

1. 关键事件（`created` / `completed` / `dead_lettered` / `cancelled` / `needs_llm` / `gate_failed` / `submit_intent` / `submit_adopted` / `submit_resubmitted` / `resume_retry` / `driver_error`）在 `pipeline.json` 里**永久保留**，不参与常规事件的滚动截断（见 `pipeline.ts` 的 `CRITICAL_EVENTS` / `pruneHistory`）。新增关键事件时同步加入该集合。
2. pipeline / pool / portfolio 状态文件一律 `.part` + `rename` 原子写，权限 `0600`。
3. **一个 workdir 只允许一条在跑的链**（`findLivePipelineOnWorkdir` 闸）。处方换档是 `pre.json` 整体覆写、门检共享 `result.json`，同 workdir 双链必然互相污染。

---

## 三之二、科学结论纪律（R7–R9：算完之后的部分）

前三节管的是「把作业跑对」；本节管的是「跑完之后得出的科学结论」——此前这一段基本是把数字丢给 LLM 自己判断。

### 3.7 物性落地纪律（采集 ≠ 消费）

远端 workflow（1.4.0+ / 1.6.3+）早已产出热化学十键、`frequencies_cm-1`、`irc_point_count`、`dipole_moment_debye`、`excitation_energies_ev`，并全量透传进 `job_output`。缺口从来不在采集，而在**落地与消费**。

**约定。**

1. **远端已产出的物性键不得在本地静默丢弃**。新增一个模型可见/可判定的物性 ⇒ 必须同时落 `results` 表列（`db.ts` 的 `SCHEMA_SQL` + `migrate()` 守卫式补列 + `fromCalcflowResult` 映射 + `rowToResult` 读回）。只透传不落库 = 下一步没法用它做判断。
2. 键名一律**取远端原样**（snake_case + 单位后缀，见 `CalcflowProperties`），不在映射层改名——远端字段名是跨进程契约，改名会让日后对账无从追溯。
3. 老库兼容一律走 `migrate()` 的守卫式 `ALTER TABLE`，新列 nullable；**读取形态（`ResultRecord`）全字段 nullable，写入形态（`ResultRecordInput`）新字段可选**——不要为了"完整"强迫既有调用点补一串 `null`。

### 3.8 科学判断纪律（判据必须是代码，不是提示词）

**约定。**

1. **能做成结构化判据的科学验收，不许留在 runbook 文案里**。已下沉的三条：
   - TS 验收不只数虚频个数——`gate.min_real_frequency_cm1` 校验最小正频（`TS_MIN_REAL_FREQ_CM1 = 10`，低于此为平台区/残留平动转动）；
   - IRC 方向性——`gate.irc_direction_check` 解析 `irc_profile` CSV 要求两分支从 TS 单调下坡（`checkIrcDirectionGate`），此前完全不验证，而 `irc-methods.md` 明写方向错误是 IRC 走不通的首要原因；
   - 反应能学——`mat_reaction_energy`（`thermo.ts`）算垒高，模型不得自己做 Hartree→kcal/mol 的减法。
2. **图谱 CSV 是权威数据，PNG 不是**（`image` 可为 null）。要基于图谱做判断就解析 `data` 指向的 CSV（`plots.ts`），不要让模型"看图说话"。
3. 能量基准**必须对全部物种一致**（`selectEnergyBasis`：自由能 > 焓 > 电子能，取全员可用的最高档）。用 TS 的自由能减反应物的电子能没有物理意义，靠模型自觉很容易发生，故在代码里强制。
4. 回落到电子能、物种未收敛、活化能为负（TS 低于端点）一律**显式警告并要求逐条转述用户**——算得出数字不等于数字可用。
5. 新增科学判据时：纯判断逻辑进 `mat-core`（零 IO、可单测），需要读远端文件的部分做成**注入**（如 `readResultJson` / `readCsvFile`），未注入时的行为必须明确写在函数注释里（方向门未注入=放行，读取失败=拒绝）。

### 3.9 能力边界诚实化纪律

**约定。**

1. `TASK_PLANS` 每个 task 必须声明 `kbCoverage`（`'ladder' | 'decision' | 'none'`），与 `references/errors/` 的**实际条目**一致：
   - `ladder` = 有带 `level` 的有序梯 → driver 自动换档重试；
   - `decision` = 只有决策表 → 不自动重试，停 `needs_llm` 由 LLM 按 trace 选行；
   - `none` = 无签名条目 → 失败必然 `needs_llm`，**这是预期行为不是系统故障**。
2. 新增 KB 条目或改处方形态 ⇒ 同步 `kbCoverage` 并更新一致性测试（`runbook-driver-consistency.test.ts` 的覆盖率用例）。**不许**在 SKILL.md 宣称支持而代码零覆盖却不标注——这正是"以为系统会自动处理、实际系统在等人"的来源。
3. runbook 必须披露失败处置能力（`kbCoverageLine`），让执行者知道失败时是自动重试还是等他诊断。
4. 新 KB 条目落盘后用**真实解析器**验证（`scripts/kb-sync.ts` 的 `parseFrontmatter`），至少确认：signature 是合法正则、能命中真实失败文本、不误命中邻近条目的签名。不要凭肉眼判断 frontmatter 正确。

### 3.10 引擎边界纪律

**约定。**

1. 引擎假设集中声明在 `packages/mat-core/src/engine.ts`（`EngineId` / `GAUSSIAN_PROPERTY_KEYS` / `GAUSSIAN_PLOT_KINDS` / `ENGINE_BOUNDARY_NOTES`）。新增依赖引擎语义的常量（物性键名、相位名、脚本名）先查这里，没有就加进去，**不要散落回各模块**。
2. **`ENGINE_BOUNDARY_NOTES.documentedOnly` 里的引擎不算"已支持"**：ABACUS 有高质量 skill 文档但零 mat-core 整合（无 engine 字段、无 adapter、无结果解析、无门检），跑在"LLM 按散文操作集群命令"的路径上。对外描述能力时按 `implemented` 说，不按 `skills/` 目录数。
3. 本仓**不做投机性引擎抽象**：没有真实第二引擎需求时，完整抽象会付出可观复杂度而无第二实现检验，抽象大概率是错的。当前只做"标注 + 一条缝"（`EnginePhaseCommands`）。真要接第二引擎，先更新 `ENGINE_BOUNDARY_NOTES.hardcodedAssumptions` 逐条评估，不要直接加 adapter。

---

## 四、测试与验证

- 纯逻辑优先（见 1.2 的硬约束）——这是这些模块可测的前提。
- 改动后跑 **`bash scripts/ci.sh`**（typecheck 两包 + 全量 vitest 的单一定义）。本仓 remote 是 Gitee，`.github/workflows/ci.yml` 不会自动执行——它只是同一条步骤的声明，真正可执行的是 `scripts/ci.sh`，本地/hook/任何 CI 系统都调它。逐项手跑：

  ```bash
  pnpm typecheck   # tsc -b + scripts 前提检查
  pnpm test        # vitest run（全仓）
  # 或逐包：
  npx tsc --noEmit -p packages/mat-core
  npx tsc --noEmit -p packages/mat-tools
  npx vitest run packages/mat-core packages/mat-tools
  ```

- pipeline / pool driver 的集成测试用 fake `execCommand` + 伪时钟（`vi.useFakeTimers`）跑完整链，**不碰集群**。
- 契约（contracts / 门检 / 预算 / 相位迁移）改动必须带对应用例；一致性闸（`runbook-driver-consistency.test.ts` 等）失败不许通过改测试消除。

---

## 五、skill 血脉纪律

- **frontmatter `description` 禁半角冒号**（YAML 解析教训，2026-08-28 / M12），skill 顶部注释已留锚。
- **gaussian-calc 三血脉同步**：本仓 `skills/gaussian-calc`（版本带 `-demo` 后缀，跳号避让 canonical 撞号）↔ canonical 仓（`mat-aitool/skills/gaussian-calc`，吸收时 references 字节对齐）↔ 远端 workflow（`scripts/env_profile.sh` 的 `WORKFLOW_VERSION`，三副本同步）。改任一血脉必须回答：另外两处要不要同步、版本号怎么走。
- 版本纪律：改 skill 正文 / 契约 → `version` bump + frontmatter `adaptation` 行记因（日期 + 一句改动理由 + 取证锚）；改远端 workflow → `WORKFLOW_VERSION` bump + env_profile 三副本同步。
- **缺陷归源原则**：workflow/skill 侧的问题不绕行（session-debug 的绕行签名清单纪律）；绕行方案必须登记。
- 协议类 skill（batch-orchestrator / batch-roles）的每条纪律注明事故来源，并按 1.3 的方向持续把文案纪律下沉为工具强制。
