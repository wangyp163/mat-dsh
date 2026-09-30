# D0 落地计划：从 Gaussian 线开始

> **状态声明**：本文是 D0 架构（见 `d0-architecture.md`）在 gaussian 线的分阶段实施计划，2026-09-18 定稿。原则：**每阶段独立可发布、不动现有生产路径（一站式/分步链路照常）、agent 侧先行、workflow 侧协作项单列并给降级路径**。工期按 1 人全职估算。

## Phase 0 · 基线冻结（0.5 周）

**目标**：动手前把"现在是什么"钉死，后续每阶段有对照。

- 【 】 归档基线 e2e transcript（一站式 + 分步 ts+irc 各一条，进 `docs/evidence/d0/`）
- 【 】 记录当前版本三元组：skill `0.7.32-demo` / workflow 锚 `1.7.3` / 插件面；确认 `check_environment.sh` 门禁三态（deployed/expected/newer）在目标集群实测通过
- 【 】 声明冻结项：本计划不改 `mat_gaussian` 一站式路径行为、不改 calcflow 相位语义（Phase 3 前提）

**验收**：`docs/evidence/d0/baseline.md` 存在且含上述三项【验证】标注。

## Phase 1 · mat-db（1-2 周）——最便宜，先点亮复用飞轮

**目标**：结果可查询、KB 可检索；纯 agent 侧，零外部依赖。

**压测验收 2026-09-18**：真实链路黑盒压测通过（3 会话 / 5+3 case，报告 `mat-aitool/docs/2026-09-18-d0-agent-side-demo-stress-report.md`，收口三件套全绿）——确认闸三次拦截/放行、结算入库能量三方一致、复用查询与 KB 检索命中、分步不受闸门误伤。C5 TIMEOUT 编排在 Agent0 分区不可达（时限下限），FAILED 路径单测覆盖。**新改进项**：① 分步链路结算不入 mat-db（入库钩仅挂一站式 producer）；② mux 应答白名单纪律入编排模板；③ 失败 fixture 改"大计算量+正常时限"。

**进展 2026-09-18（P1 代码面全部完成，504/504 回归 + tsc 零错）**：① `db.ts`（**驱动改用 node:sqlite 而非 better-sqlite3**：Node 22.22 内置、零原生依赖、零 lockfile 变更，DI 接口不变）；② `kb-sync.ts`（含可导入的 `syncKbToDb()`，CLI/测试双形态）在真实 references/ 上验证（7 条同步、空签名 methods 类跳过匹配、YAML 反转义后真实签名命中 l9999/FormBX）；③ 测试用真实 post-ok fixture 回放入库；④ 入库钩子接在 `mat_gaussian` 的 `onResult`（runs 恒记台账、results 仅在有物性时记、核时经 run.json 估算、库故障一律旁路）；⑤ `mat_db_query` 工具（结果查询 + kb_error 签名查询双模式）+ `tool:mat-db` 引导段（跨会话记忆优先查库）。**待办**：真实集群 e2e 验收（跑一个 opt 后查库命中）——需集群环境，留待下次部署窗口。

- 【x】 `packages/mat-core/src/db.ts`：三表 runs/results/kb + `fromCalcflowResult` 映射 + `kbLookupByError`（regex 签名、坏模式/空签名容错）；SqliteConnection 注入，禁 import 宿主 API（mat-core 纯度纪律，零运行时依赖）
- 【x】 KB 同步：`scripts/kb-sync.ts` 解析 `skills/gaussian-calc/references/` frontmatter 入 kb 表；**保持 grep 兼容**（md 是源，表是索引）
- 【x】 入库钩子：接在 `mat_gaussian` 的 `onResult`（插件层，不动 mat-core/gaussian.ts）——completed 记 results、failed 只记 runs 台账；历史数据批式回填脚本待集群窗口
- 【x】 插件壳：`mat_db_query` 工具（结果查询 + kb_error 签名匹配双模式）+ `tool:mat-db` 系统提示引导段；`test/db-hook.test.ts` 9 用例覆盖入库/格式化/接线/种子查询
- 【x】 测试：vitest，复用 `packages/mat-core/test/contract/` 的 result.json fixture 入库断言（`test/db.test.ts` 6 用例）

**验收**：e2e 跑一个 opt，`mat_db_query` 能查到它；KB 表能按签名命中 `ts-step-limit`。
**纪律**：db 文件位置沿 workdir 哲学（`$MAT_FILE_ROOT/mat.db`），原子写。

## Phase 2 · 确认闸硬化 digest（0.5-1 周）——D2.1 三层落地

**目标**：确认从"纪律"升级为"结构"，物理不可绕过。

**进展 2026-09-18（P2 代码面完成，515/515 回归 + tsc 零错）**：`mat-core/confirmation.ts`（summarizePre 投影 / sha256 规范摘要 / 格式化 / 核时估算统一实现）+ `mat_gaussian` 闸门接线（CONFIRM_REQUIRED 结构化拒绝、零集群副作用、`confirmation_gate='off'` 应急回滚）+ SKILL.md 协议条目（版本 0.7.33-demo，M29 记录）。测试：core 6 例 + tools 5 例（无 digest 拒且零副作用 / 错 digest 拒 / 对 digest 提交 / off 直提 / 改参数旧 digest 失效）。**待办**：真实集群 e2e 验收（与 P1 合并同一窗口）。

- 【x】 `summarize_pre(pre.json)`：`mat-core/src/confirmation.ts`（summarizePre/confirmationDigest/formatConfirmationSummary；estimateCoreHoursFromRunJson 统一实现，mat-tools 旧函数改为委托）
- 【x】 `mat_gaussian` 的 `confirmed_digest` 参数 + 闸门（partition 解析后、同步段创建前；拒绝零集群副作用；`confirmation_gate='off'` 应急回滚）
- 【x】 skill 更新：一站式节新增确认闸协议条目（投影原样转述→阻塞确认→同参重调；版本 0.7.33-demo + M29 adaptation）
- 【x】 测试：五例（含零副作用断言与改参数失效例）——core 6 + tools 5

**验收**：无 digest 的提交在单测与 e2e 双层被拒；e2e transcript 进 evidence。
**降级**：digest 校验做成 `options` 开关（默认开），生产异常可临时关，不阻塞主链。

## Phase 3 · goal.json + plan() 相位（3a 原型 1-2 周 agent 侧；3b 迁移 2-4 周 workflow 侧）

**目标**：意图到计划的确定性化。唯一外部协作项，拆两半降风险。

**3a agent 侧原型（先行，无外部依赖）**

**进展 2026-09-19（P3 工具接线完成）**：`mat_task_build` 工具 + `skills/task-builder/`（v0.1.0）落地——goal → task 包（aimater.taskpackage.v1）→ 确认 → 执行的产品化入口。新增 `mat-core/src/task-package.ts`（确定性编译器：波次物化 pre/run/post、one-stop/stepwise 模式判定、runbook 生成、digest）+ golden 测试 8 例 + 工具接线测试 5 例。关键设计：**one-stop digest 与 mat_gaussian 确认闸同源**（同一对 preJson/runJson 经 summarizePre→confirmationDigest），用户批准后首次调用即可带 confirmed_digest 直提；stepwise 为全链摘要。goal 契约加性扩展（参数模板承载面）：`method.route_kwargs`（路由键仅 task 自身路由集放行，异 task 编译期拒绝）+ `resources.ncores/memory/walltime`（O1：pre.resources 唯一来源，ncores 同步 slurm 槽位，walltime 优先于 accuracy）。复用飞轮接线（mat-db past 查询注入编译器）。**待办**：真实集群 e2e（与 P1/P2 合并窗口）。

**进展 2026-09-18（3a 代码面完成，523/523 回归 + tsc 零错）**：`goal-schema.json`（aimater.goal.v1 契约文档）+ `planning.ts`（意图→task DSL 确定性映射、多帧 xyz 切分、电子奇偶前移、波间门、复用标记、结构化 questions）+ golden 测试 8 例（五形态：常规单作业/过渡态三波链/需澄清闭环/复用扣减/精度与非法输入）。

- 【x】 goal schema v1：`packages/mat-core/src/goal-schema.json`（结构/意图关键词/精度/资源/复用引用）
- 【x】 `planning.ts` 纯模块：goal → plan.json（波次 DAG + 波间门 + 并发字段 + 复用标记 + 预估核时 + assumptions）+ questions[]（O2 形态结构化选项）；复用经 `deps.past` 注入 mat-db 查询（P3a 匹配语义=label+task+converged 精确命中，方法级匹配留 TODO-P3b）；任务注册表内置 gaussian 全量（锚 1.7.3）
- 【x】 澄清环协议进 SKILL.md：**已随 mat_task_build 工具接线落地**（2026-09-19，`skills/task-builder/SKILL.md`——O2 阻塞式转述 → 修 goal → 重建；含确认闸/执行 runbook/结果消费全链 SOP）
- 【x】 vitest golden 测试：`test/planning.test.ts` 8 例五形态

**3b workflow 侧迁移（与 HPC 协作）**
- 【 ] calcflow 增加 plan 相位：`goal.json → plan.json + questions`，版本锚升版；环境门禁前移到 plan 之前
- 【 ] agent 侧删原型实现，工具改调远端 plan（搬家不重写——3a 纪律的兑现点）
- 【 ] 三脚本 e2e：常规链 / 复用命中（mat-db 有历史）/ questions 触发澄清

**验收（3a）**：agent 会话内走通 意图→goal→plan→确认→run 全链（plan 用本地原型）。
**风险对冲**：3b 排期不可控时，3a 原型可长期顶（纯模块 + schema 即契约，无迁移死锁）。

## Phase 4 · 失败环接索引 + 死信收口（1 周，大半已有）

**进展 2026-09-18（P4 代码面完成，528/528 回归 + tsc 零错）**：① producer 注入 `diagnose` 回调——非 COMPLETED 结算时以诊断文本（diagnostic_post + log_tail）查 mat-db kb 索引，命中且未被 workflow 自带 `kb:<id>` 引用的条目以 `kb_hint:` 行自动附加进 job_output（库缺位/回调故障自动旁路 = 退回 grep 协议，兼容承诺兑现）；② `markDeadLetter`（runs 表守卫式补列 dead_letter/dead_reason/dead_kb，旧库 migrate 兼容）+ `mat_db_dead_letter` 工具（no-workaround 收口：梯进耗尽/未知错误 → 标记停提、留给人）；③ 测试 +5：kb_hint 命中/去重两例、死信往返/旧库迁移/工具接线。**待办**：真实集群 e2e（与 P1/P2 合并窗口）；梯进重试的 e2e 取证。

- 【x】 诊断路径改读 kb 表：producer `diagnose` 回调接 `kbLookupByError`（签名 regex SQL 面）；grep 兼容保留为 fallback（无库/无命中时零提示行，agent 自然走原协议）
- 【x→】 死信语义：**改落在 agent 侧 runs 台账**（`dead_letter/dead_reason/dead_kb` 列 + `mat_db_dead_letter` 工具）——result.json 属 workflow 侧产物，死信标记迁入 result.json 归 P3b 一并谈（偏离记录）
- 【→】 e2e：梯进重试 + 死信取证——待集群窗口（单测层已覆盖两条路径的判定面）

## 需求微调清单（滚动记录）

- **R2（2026-09-19 记录，✅ 2026-09-19 已实施）**：添加显式**排队状态**，消除"提交后长时间静默"歧义。实施记录：状态板 upsert 支持 phase 推进（rank 单调 monitoring<queued<running<settled，settled 不回退）；watch/gaussian 两路 onTick 派生相位、提交即 queued；producer 首个 RUNNING 观察拍评估一次阈值（≥60s 排队→owner.followup 一次性"已开始运行"通知）；StatusDock 文案三态；系统提示补排队语义；skill 0.7.34-demo（M30）。**实施中发现并修复一个真 bug**：阈值原在每个 RUNNING 拍重复评估——长运行作业运行时长跨 60s 会误报"排队 60s"，改为仅在首个 RUNNING 观察拍评估一次。跃迁通知为 best-effort：RUNNING 窗口短于轮询间隔时可能被跳过（直接 PENDING→COMPLETED，不通知），语义已写入 SKILL。
  - 背景：压测归因附录显示 122506567 的 773s 感知延迟中 701s 是 Agent0 排队——但会话内自提交回执到完成通知之间零可见信号，用户无法区分"排队/运行/卡死"。
  - 方案（三层，按最小实现排序）：
    1. **状态板卡相位细分**：producer `onTick` upsert 时按 sacct 派生相位——全 PENDING → `queued`（排队中）；出现 RUNNING → `running`；终态 → `settled`（现状不变）。mat-ui 卡片即可显示 排队中/运行中。
    2. **会话内跃迁通知**：watcher 观察 PENDING→RUNNING 跃迁时，经完成通知同款通道推一条"作业已开始运行（此前排队 Ns）"；只推跃迁事件不推每次轮询，避免刷屏。可选：排队超阈值（如 120s）加推一次"仍在排队"。
    3. **话术一句**：系统提示 mat 引导段补"提交回执后作业可能排队（PENDING）数分钟，面板可见排队/运行状态；长时间无完成通知通常是排队而非故障"。
  - 验收断言：排队期间面板显示"排队中"；跃迁产生一次会话通知；既有 e2e（status-wiring/gaussian-replay）不回归。

- **R1（2026-09-19 记录，✅ 2026-09-19 已实施）**：确认闸用户可见措辞——"计算参数投影摘要"改为"计算参数摘要"。
  - 背景：压测 S1 实测 agent 转述时用了"计算参数投影摘要"（源自 SKILL.md M29 条目的"投影摘要"措辞）；"投影"是 D2.1 的内部机制名，不应进用户话术。
  - 改动点：`skills/gaussian-calc/SKILL.md` 确认闸条目中"投影摘要"→"摘要"（其余"投影"作为机制描述保留）；工具拒绝消息本身是英文 "parameter summary"，不涉及。实施时 skill 版本 +1 并同步 M29 adaptation 记录。

## Phase 5 · 实施态文档 + 交接（0.5 周）

- 【 ] `d0-architecture.md` 刷新为实施态（盒子↔资产映射逐项标【验证】）
- 【 ] 更新 `AGENT-HANDOFF.md`（§5 里程碑、§9 遗留）
- [ ] 全量回归：`pnpm test` + deploy-check + 两条 e2e

## 里程碑与依赖

```
P0(0.5w) → P1(1-2w) → P2(0.5-1w) → P3a(1-2w) ─┬→ P4(1w) → P5(0.5w)
                                              └→ P3b(2-4w, 外部协作, 可并行/可延后)
```
关键路径：P0→P1→P3a→P4→P5 ≈ 4-6 周（不含 3b）。P2 可与 P1 并行。

## 全程纪律（违者阶段不验收）

1. mat-core 新模块一律 DI + 零宿主 import（D1 退出保障）；
2. 契约变更必配 fixture 回放测试；版本锚三处同步（skill/远端 workflow/env_profile）；
3. 给用户签字的数字只来自投影函数（D2.1）；
4. 每阶段 evidence 进 `docs/evidence/d0/`，沿用【验证】/【记录】分级。
