# Harness Engineering 学习与研究手册

> **状态声明**：2026-10-15 创建。本仓的学习主线工作文档：以 mat-harness（mat-dsh +
> 宿主 deepseek-harness）为教材，系统学习 harness engineering 范式，最终反哺项目能力。
> 与 [`TECH-HIGHLIGHTS.md`](TECH-HIGHLIGHTS.md)（工程事实清单）、[`d0-architecture.md`](d0-architecture.md)
> （架构决策）互补；范式的原始调研与逐项核对记录在本文第 4 节。
> **这是活文档**：每个补课阶段（P0.5~P5）完成时回写实施态。

## 0. 一句话定位与使用方法

**Agent = Model + Harness**。harness（scaffold）= 让模型作为 agent 行动的系统：处理输入、
编排工具调用、管理消息历史与上下文。**模型是 CPU，harness 是 OS**——同一模型在不同
harness 下任务成功率可差 6 倍（Claude Opus 4.5：OpenCode 2% vs Cursor 12%）。

使用方法：按第 6 节的四阶段循环推进学习，每轮以第 7 节路线中的一个 P 项为出口；
判定自己/项目的范式水位时用第 3.2 节的三态判定法；面试与简历对齐用第 5 节翻译表。

## 1. 范式来源（2026-10 调研）

- Anthropic 工程三篇：Demystifying Evals（harness 定义的出处——**评测是范式核心**）、
  Effective Harnesses for Long-Running Agents、Harness Design（AGENTS.md）。
- Addy Osmani《Agent Harness Engineering》；36氪《一文读懂》；
  awesome-harness-engineering（GitHub）。
- 2026 前沿论文：Agent Lightning（MSR，3500 行 harness-native RL 框架）、
  Polar、Harness-Native RL for Coding Agents。
- 行业信号：OpenAI 用 Codex harness 五个月百万行代码零人写；coding agent 是
  范式主战场（TRAE 类岗位所在域）。

## 2. 知识地图：七子域 × 本项目实例

每个子域先学通用原则，再对照本仓实现——这是把泛读变成研究的方法。

| 子域 | 通用问题 | 本项目实例（可点开验证） |
|---|---|---|
| Loop 主循环 | 谁拥有循环、如何 steer | dsh ReactLoopAgent 事件链；`steer/followup/inject` 三投递；loop 本身是可替换插件 |
| Context 上下文工程 | 什么进上下文、怎么省 | 四件套（结构化投影/增量输出/硬上限/白名单）、子代理契约 7–13× 节省、外置 portfolio |
| Tools 工具设计 | schema/契约/原子性 | `defineTool` 五段执行管线；一站式 Gaussian 6 往返→1 调用；策略外挂钩子 |
| Guardrails 闸门 | 约束放代码还是提示词 | D0 约束归位判别式：可判定→工具闸（`CONFIRM_REQUIRED`/`BUDGET_REJECTED`），判断性→skill 散文 |
| Observability | 可回放、可取证 | 事件溯源会话日志、session-debug 零 token 取证、契约回放夹具 |
| Composition 组合 | 能力如何插拔 | Cordis 插件内核、mat-bundle 一行装载、seam 三段式（换 provider 不改 schema） |
| **Evals 评测** | 怎么证明改对了 | 489 离线测试 + 压测 SOP + stress-report-lint——组件级强，**任务级缺（P0.5 补）** |

## 3. 双层教材

### 3.1 上游 dsh 精读清单（`../deepseek-harness/docs/`，全双语）

推荐顺序（每篇对照 mat-dsh 的对应实现读）：

1. `architecture.md` —— 分层与"没有特权内核"
2. `cordis-primer.md` —— Context/Plugin/Service/Fiber/事件五模式
3. `capability-seams.md` —— seam 三段式与 provider 替换
4. `agent-lifecycle.md` —— 主循环事件链（对照 gaussian producer 挂载点）
5. `persistence-catalog.md` —— 事件溯源日志（对照 session-debug 解析）
6. `defensive-patterns.md` —— 防御性模式（对照 exec-gate/exec-guard）
7. `cookbook/extension-cookbook.md` —— feature→机制映射表（逐条验证 "No row modifies the loop"）
8. `testing.md` —— 宿主测试哲学（对照契约回放泳道）

### 3.2 三态判定法（本项目特有的方法论，P1 后升级为四态）

dsh 是"一切皆插件"的组合系统，很多能力**宿主自带、组合未启用**。对本项目做范式
gap 判定时，判定动词必须是三态：

```
有          —— 自研仓或当前组合里已激活、已取证
有但未启用   —— 宿主包族里有、cordis 行没开或没调参（启用成本 = 配置级）
缺          —— 宿主也没有，需自建
```

只看自研仓不看宿主组合继承面，会把"有但未启用"误判成"缺"，导致补课成本高估
一个量级（2026-10-15 核对实证：沙箱与 compaction 两处）。

**P1 修正（2026-10-15）**：还需第四态——**已启用未验证**。沙箱被 P0 判为
"有但未启用"，P1 查 base bundle 发现 `sandbox-local + bash-sandbox` 是全部
profile 的**默认装载**（本仓会话一直在 bwrap 约束下跑，只是无本地 bash 调用
从未触发）。判"未启用"前必须查 base 默认值，不能只看"我没关过"。

## 4. 范式 11 组件对照（调研 × 代码级核对）

> 2026-10-15：第一列为用户调研判定（基于行业范式），"核对"列为对照代码库修正后的
> 三态判定。宿主包族证据：`../deepseek-harness/packages/`（sandbox/compaction/spill
> 等均在）；组合面证据：`profiles/mat.yml` + `packages/mat-bundle/cordis.patch.yml`
> （未禁用任何 base 能力行 → 全继承）。

| # | 范式组件 | 调研判定 | 核对（三态） | 依据 |
|---|---|---|---|---|
| 1 | 上下文工程 | ✅ 领先 | **有**（领先） | 四件套 + 增量去重签名 = append-only context；宿主 runtime-context 快照保持 system prompt 稳定 = KV-cache 友好 |
| 2 | 评测/可观测 | ✅ 领先 | **有但缺一层** | 可观测（session-debug/契约回放/压测 SOP）领先；任务级 golden eval 缺 → P0.5 |
| 3 | Skill/文档工程 | ✅ 有 | **有** | 渐进披露 + adaptation 编年体；术语未对齐（第 5 节） |
| 4 | 工具执行层 + MCP | ✅ 有 | **有** | 9+ 模型工具 + matgen/OPTIMADE MCP 接入 |
| 5 | 反馈回路 | ✅ 有 | **有** | 诊断性 post、波间门、结构化错误 + kb_hint |
| 6 | 沙箱隔离 | ⚠️ 并发控制≠隔离 | **有且默认启用（P1 已验证）** | base bundle 默认装载 sandbox-local+bash-sandbox（bwrap/full）；P1 探针 7/7（越权写/删/改全拒+终态校验）、开销 +3.1ms/调用、A/B 任务级 6/6=6/6；远端 HPC 是服务边界，隔离叙事 = 爆炸半径（预算闸+toolFilter 已有） |
| 7 | Compaction/长会话 | ❌ 缺 | **有但未调优未取证** | 宿主 compaction-basic（surface masking、pre-step 压力自动触发、溢出→压缩→重试）+ tool-result-pruner + /compact + spill + tokenMeter 全继承 → P2 调参取证 |
| 8 | 跨会话记忆 | ❌ 缺 | **一半有** | 结果级已有（mat-db 三表 + 复用飞轮 + kb_hint 注入）；缺 agent 经验记忆（episodic 回写）→ P3 |
| 9 | 多 agent 编排 | ❌ 缺 | **委派式有，协作拓扑缺** | batch-roles 四角色 + 类型化裁决契约 + 引擎级最小权限；`tool-subagent-control`（send_message/interrupt_agent）已启用即通信控制面 |
| 10 | Harness-native RL | ❌ 缺 | **缺（概念层补）** | P4 只读 Agent Lightning/Polar，不做工程投入 |
| 11 | 通用任务域 | ⚠️ 单一 | **缺（域桥接）** | 工具面深绑 HPC；P5 用 Claude Agent SDK/OpenCode 做 coding 域 demo 迁移四件套 |

**总评修正**：真缺的只有 8b（经验记忆）、9b（协作拓扑）、10、11 四项，全部增量可补；
6/7 两项是"启用 + 调优 + 取证"，成本天级不是周级。

## 5. 术语翻译表（简历/面试对齐）

| 本仓的说法 | 行业范式词汇 |
|---|---|
| 增量输出（状态不变不产生新行） | append-only context / stable prefix（KV-cache 友好） |
| 版本三副本同步锚 / result.json 单一出口 | single source of truth |
| 环境门禁、红线 | guardrails / policy enforcement |
| 轨迹分析器（session-debug） | trajectory analysis / observability |
| 压测 SOP | end-to-end evals + regression suite |
| 事件溯源会话日志 | trajectory replay / full auditability |
| runtime-context 快照通道 | KV-cache-stable system prompt |
| 四角色子代理 + 类型化裁决 | multi-agent orchestration（delegation + least privilege + typed contracts） |

面试 3 分钟叙事框架："我的 harness 实践和 Anthropic 定义的差异——我做了 OS 的进程
调度和审计（上下文、工具、闸门、评测），compaction 和 sandbox 是宿主能力、正在
启用并取证（有数据），记忆与协作拓扑在补。"主动说边界比被问穿好。

## 6. 学习循环（四阶段，每轮一个 P 项出口）

```
读      上游 dsh 文档/源码 + 范式文章（第 1、3.1 节清单）
  ↓
对照    本项目对应物在哪、为什么这么选、差在哪（第 2 节地图逐格填）
  ↓
动手    小实验或真改进（P0.5~P5；实验优先用"换 provider/挂钩子"而非改 loop）
  ↓
取证    evidence 入库 + 本文档回写实施态 + 记忆更新
```

## 7. 补课路线（修正版，2026-10-15）

| 优先级 | 内容 | 状态 |
|---|---|---|
| P0 | 术语对齐 + 面试叙事（第 5 节） | 2026-10-15 完成（本文档即载体） |
| **P0.5** | **任务级评测基线**：golden task 集 + 本地回放泳道（fake HPC MCP）+ headless 跑批 + 基线指标（成功率/token/轮次/墙钟）。P1/P2/P3 共用的度量仪器 | **2026-10-15 完成并出基线**：5/5 通过（mat/deepseek-v4-pro，token in 91,699 / out 8,755），证据 `docs/evidence/eval/baseline-20261015/`，详见第 8 节 |
| P1 | 沙箱：验证 + 覆盖 + 量化（前提修正：宿主默认已启用，见 3.2 四态） | **2026-10-15 完成**：探针 7/7 + A/B 6/6=6/6 + 开销 +3.1ms/调用，证据 `docs/evidence/eval/sandbox-20261015/report.md`；P1+（可选）：HPC 传输层 egress 收敛 |
| P2 | 长会话 compaction 调优 + session-debug 解析 compaction 事件取证；复用 P0.5 长任务 | **2026-10-15 完成**：6 泳道 × 2 长任务矩阵 + 三问结论（本尺度激进压缩净亏损：token +50~130%、墙钟 ×2~5；pruner 免费杠杆；默认 0.8 哲学被验证），参数表 9.1 节，证据 `docs/evidence/eval/compaction-20261015/report.md` |
| P3 | agent 经验记忆：会话结算写"经验卡"（失败签名→处方→有效性）复用 kb 表 + kb_hint 管道 | 未开工 |
| P4 | Harness-native RL 概念（Agent Lightning 3500 行源码通读 + Polar） | 未开工 |
| P5 | coding 域桥接 demo：Claude Agent SDK/OpenCode 小型 coding harness，迁移四件套/门禁/轨迹分析 | 未开工 |

## 8. P0.5 评测基线设计（实施态，滚动更新）

**目标**：任何 harness 改动（提示词/工具 schema/compaction/沙箱/provider 替换）都能
在同一组任务上跑出可对比的量化数据。

**双泳道**（沿用本仓"昂贵的都回放，便宜的都检查"哲学）：

- **回放泳道（本 P 的交付）**：本地 fake HPC MCP 服务器（HTTP，node:http）复刻
  HPC remote-shell 协议（initialize → tools/call，SSE 信封，exec-guard 标记透传），
  响应体来自 `packages/mat-core/test/contract/fixtures/` 的**真实录制夹具** + 有状态
  Slurm 模拟（sbatch 发号、sacct 按墙钟推进 PENDING→RUNNING→COMPLETED）。零集群、
  零核时、可无限重放。
- **实弹泳道（沿用现有）**：真实集群 e2e 照旧走部署窗口，作为回放泳道的真值校准。

**组件**：

| 组件 | 位置 | 职责 |
|---|---|---|
| golden 任务集 | `scripts/eval-golden-tasks.ts` | 任务 prompt + 成功判定（final-message 断言 + 工具面期望/禁止） |
| fake HPC | `scripts/eval-fake-mat.ts` | 协议复刻 + 夹具回放 + Slurm 状态机（sbatch 发号、sacct 按墙钟推进、scancel） |
| 跑批器 | `scripts/eval-run.ts` | 起 fake → 装 headless profile（dsh-web.sh 同款注入）→ 逐任务跑 headless dsh → 会话日志差集归档 |
| 报告器 | `scripts/eval-report.ts` | 会话日志 → 指标（成功率/steps/turns/token/工具面/墙钟）→ report.md + metrics.json + `--baseline` 对比 |
| eval overlay | `profiles/eval.yml` | headless 下禁用 mat-ui/matgen/optimade 行（缩小变量面） |

CLI：`pnpm eval:run -- --tasks all --out <dir> [--provider P --model M]` → `pnpm eval:report -- --run <dir> [--baseline <metrics.json>]`。
任务集 v1（5 任务）：partitions-lookup（薄工具+夹具读取）、sleep-watch（异步监控闭环+零忙等）、
gaussian-onestop（一站式+确认闸+producer 自动 post）、gaussian-fail-diagnosis（失败环+诊断转述）、
cancel-job（提交+取消闭环）。会话/状态隔离：每任务独立 fake 实例 + 独立 `MAT_FILE_ROOT`
（防 mat-db 复用飞轮跨任务污染判定）。

**判定口径**：任务成功 = 最终答复命中全部 mustMatch 断言 ∧ 工具面符合期望
（如"一站式任务必须出现 mat_gaussian 且零 mat_sbatch"）；指标从事件溯源日志
离线提取（不花 token）——**断言校准改动只需重跑 eval-report，零模型成本**。

**基线（2026-10-15，v1.2 任务集 / mat/deepseek-v4-pro）**：5/5 通过；
全轮 token in 91,699 / out 8,755；一站式 Gaussian 全链（确认闸两段 + producer
自动 post + 物性报告）5 steps / 59s。`metrics.json` 即后续改动的对比基线
（`pnpm eval:report -- --run <dir> --baseline <dir>/metrics.json`）。

**泳道发现（首轮就抓到三类真问题——评测仪器有效性的最好证明）**：

1. **headless 面不等后台作业结算**：宿主 runner（`bundle/headless/src/index.ts`
   的 `whenIdle()`）在主循环空闲即退出，异步完成通知来不及唤醒会话——
   v1.0 两任务因此挂掉。异步唤醒路径留在 web 面取证（M1 followup-wake 证据），
   回放泳道任务改阻塞等待形态（v1.1）。这是「同一 harness 不同 surface 语义不同」
   的典型样本（面试可讲：surface 语义也是 harness 设计面）。
2. **模型自发走 efile 上传降级链**：sleep-watch 任务里模型先试 `mat_upload`
   （OpenAPI efile），fake 未实现该端点 → 工具自动降级 remote-shell 分块通道
   （`mat_exec`×6）成功落盘——M2 设计的优雅降级被评测意外验证。
3. **断言必须对排版宽容**：模型把「退出码|0」写进表格相邻单元格，锁措辞的正则
   误报失败（v1.2 修正为行内邻近匹配）。教训：final-message 断言断「语义要素
   同行出现」，不断排版。

## 9. P2 Compaction 实验（实施态，2026-10-15）

### 9.1 可调参数表（源码核对，含联动约束）

**compaction-basic**（`packages/compaction/compaction-basic/src/config.ts`）：

| 参数 | 默认 | 语义 |
|---|---|---|
| `auto` | true | 自动压力检查（agent/pre-step）+ 溢出恢复 开关 |
| `thresholdRatio` | 0.8 | 触压比例 × 声明 contextWindow；tokenMeter 压力（头估算+surface）越线即压 |
| `retainRatio` | 0.16 | 压缩后保留的逐字尾巴比例；**必须 < thresholdRatio**（校验器强制——否则压完仍在阈值上永久重触发） |
| `retainTokens` | — | 绝对保留量（覆盖比例式） |
| `summarizationProvider/Model` | '' | 摘要模型；缺省用会话当前路由模型 |
| `maxTokens` | 8192 | 摘要本身的一次性 token 预算 |
| `compactionRetries` / `maxOverflowRetries` | 1 / 1 | 压缩重试 / 溢出恢复重试 |
| `modelPolicies` | [] | 按 provider/model 精确覆盖上列全部字段 |

**tool-result-pruner**（base 行 `tool-result-pruner`）：`thresholdChars 8192 / headChars 4096 / tailChars 1024`——单条工具结果超阈值即头尾保留中段遮蔽（确定性、零 LLM）。
**spill-policy**：`maxInlineBytes 50000`（超大输出外置文件，模型按需读回）。

**实测联动约束（2026-10-15 六轮冒烟定位，非文档显式记载）**：

1. **pi-ai 输出预算**：`min(显式 maxTokens ?? 模型能力, 声明窗口 − prompt 字符估算 − 4096)`——声明窗口过小会把输出挤到个位数（实测 out=2 的 max-tokens 死）；模型级 `maxTokens` 显式声明可作请求默认 cap，但救不了 available 为负的情形。
2. **阈值可达性算术**：估算器对 prompt 的计价偏保守（约 1.4×），thresholdRatio 0.8 与"输出不饿死的最小窗口"联立后，摘要压缩在健康窗口下**几乎不可达**——它是溢出前的最后防线，pruner 才是日常主力。要实验触发需显式调低 thresholdRatio。
3. **填充的反直觉**：工具结果超过 pruner 阈值后，可见部分被钉在 ~head+tail（≈5k 字符）；**恰好低于阈值的中等结果（~8k 字符）才是最大累积向量**。
4. **压力口径**：tokenMeter 为锚定缓存式计价（头估算 + surface 增量），网关 usage 是"未命中缓存"口径——两者都不是 surface 全量，取证以 compaction 事件的 `shadowedTokenCount` 为权威。

### 9.2 实验设计

泳道（全部 `--tasks long-composite,long-gaussian-pair`，模型 mat/deepseek-v4-pro）：

| 泳道 | overlay | 参数 | 轮数 |
|---|---|---|---|
| DEFAULT（现状） | eval-compaction.yml | 窗口 40960 + maxTokens 4096，compaction 默认 0.8/0.16 | 1 |
| NOPRESSURE（对照） | eval-bigwin.yml | 窗口 1M（压缩永不触压），maxTokens 同左 | 1 |
| EARLY | + eval-compact-early.yml | 0.15/0.08，pruner 默认 | 2 |
| EARLY+FAT | + eval-compact-tuned.yml | 0.15/0.12 + pruner 4096/2048/512 | 2 |

长任务（信息存活断言——早期喂入的会话代号/作业号/能量必须出现在最终答复）：
`long-composite`（多计算+中途查询+末尾汇总）、`long-gaussian-pair`（同会话两次一站式计算）。

### 9.3 结果与结论（2026-10-15 矩阵）

**三问回答**（完整数据与失败谱系见 `docs/evidence/eval/compaction-20261015/report.md`）：

1. **token**：本尺度上激进压缩（0.15 阈值）净亏损——未命中输入 token +50~130%
   （摘要全价调用 + 压缩后 KV 前缀失效全量重读）；收益（防历史无限增长）在
   回放泳道量级不可见。**pruner（确定性、零 LLM）是免费杠杆**。
2. **成功率/信息存活**：单轮 pass 被模型方差主导（同配置 EARLY 两轮 2/2 vs
   0/2；对照泳道也丢断言）；压缩特有风险 = 墙钟风暴（9 次摘要→480s 超时）
   与弱显著性信息（会话代号类）不保证存活；retainRatio 0.12 厚尾巴下能量/
   收敛/虚频全数存活。
3. **KV-cache 代价叙事**："compaction 是一次全价重读换后续每步瘦身的交易"——
   稳态未命中 ~0.3-1k/请求 → 压缩后首请求 4-12.7k。短会话净亏、长会话必要恶；
   宿主默认 0.8 阈值（摘要=溢出保险而非日常）哲学被实验验证。

**生产建议**：维持默认 0.8/0.16；真长会话场景优先调 retainRatio 而非降
thresholdRatio；摘要模型可指 flash 档。

**P2 泳道发现**（新增到第 8 节清单的同族条目）：

5. **pi-ai 输出预算算术**（9.1 节联动约束 1）——声明窗口 − 字符估算 − 4096；
   实验泳道必须同时声明窗口与显式 maxTokens，否则输出饿死（out=2 实锤）。
6. **想撑爆上下文，用"多条中等"而非"一条巨大"**——pruner 把超大结果钉死在
   ~5k 字符可见；恰低于 8192 阈值的中等结果才是最大累积向量（攻击面认知）。
7. **压缩风暴的墙钟代价**——每次摘要是一次 reasoning-high 全价调用，9 次
   连环压缩直接把 480s 任务上限烧穿；阈值调低的隐性成本。
8. **断言归因纪律**——跨泳道稳定复现的失败才归因 harness；单轮失败先怀疑
   模型方差（第 4 次同族教训，这次升级成了归因规则）。

## 10. 来源清单

- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/engineering/harness-design-long-running-apps
- https://addyosmani.com/blog/agent-harness-engineering
- https://medium.com/@richardhightower/harness-engineering-vs-context-engineering-the-model-is-the-cpu-the-harness-is-the-os-51b28c5bddbb
- https://m.36kr.com/p/3749464991187458
- https://github.com/ai-boost/awesome-harness-engineering
- https://www.microsoft.com/en-us/research/blog/agent-lightning-v1-0-a-3500-line-lightweight-agentic-rl-framework-for-training-agents-with-real-harnesses
- https://arxiv.org/html/2605.24220v1 （Polar）
- https://www.alphaxiv.org/abs/2608.17393 （Harness-Native RL）
- https://modal.com/resources/best-sandboxes-stateful-multi-turn-rl-episodes
