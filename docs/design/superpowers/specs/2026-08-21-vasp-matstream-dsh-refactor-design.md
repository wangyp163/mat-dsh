# vasp-matstream-agent 基于 DeepSeek Harness 重构：可行性与设计

- 日期：2026-08-21
- 状态：设计已经用户逐节确认，待最终审阅
- 范围：将 `vasp-matstream-agent`（Python 3.12 / FastAPI / LangGraph，约 14.7k 行）整体重写为 DeepSeek Harness（dsh，TypeScript/Cordis 插件架构，当前 0.1.0-rc.8）原生智能体
- 关联材料：`vasp-matstream-agent/docs/材料智能体架构与风险评估.md`（下称「风险文档」）、`deepseek-harness/docs/architecture.md`

## 1. 结论

**可行。** 技术对接点全部核实打通；成本集中在平台契约层、中间件语义移植、领域工具三个自研面。选定**方案 A（TypeScript 整体重写）**，总工作量约 **3-4 个月单人全职当量**，分六个可独立验收、可回滚的里程碑推进。

两个前提性判断，贯穿全文：

1. **风险文档中的 S0/S1 问题全部是领域层问题，换 harness 不会自动解决任何一个。** 领域修复在技能/prompt 层并行独立推进（SKILL.md 对两种运行时双栖），不混入迁移代码。
2. **dsh 处于 pre-release（0.1.0-rc.8），磁盘格式无兼容承诺。** 必须精确 pin 版本、只用文档化扩展点（事件监听 + 能力注册），绝不修改 `agent-loop`，上游升级按季度评估。

## 2. 需求与约束（用户确认）

| 项 | 内容 |
|---|---|
| 驱动力 | 现有 LangGraph 中间件栈难维护；想要 dsh 的会话/审批/子代理等能力；当前处于调研评估阶段 |
| 对外接口 | **先兼容** HPC 智能体平台 SSE 契约（`/api/user/agent/chat`、会话、上传、资源卡片），**后切换**到 dsh 自带前端/SDK 体系 |
| 团队技术栈 | 以 Python 为主，TS 经验有限 |
| 部署 | 容器化，要求可水平扩展 |
| 方案选择 | 在 B（绞杀者混合）/ C（只借模式）备选下，用户明确选定 A（整体重写） |

## 3. 备选方案与取舍

| 方案 | 一句话 | 放弃/保留理由 |
|---|---|---|
| **A：整体重写为 dsh 原生（选定）** | 新仓库，自研 3 个 TS 包 + 1 个 Python MCP，其余全部 dsh 配置组合 | 唯一同时满足「想要 dsh 全部能力 + 后切换终点站」的路线；代价是 TS 维护面与最长工期 |
| B：绞杀者混合（备选） | 保留 FastAPI 平台层，dsh 经 Python SDK 子进程做 agent 运行时 | 对 Python 团队最友好、可逐能力迁移；被否的原因：双运行时常驻、SSE 翻译层同样要做、dsh Python SDK 同样 pre-release。**若 M0/M1 受阻，B 是既定退路** |
| C：不迁移只借模式（兜底） | 保持 Python/LangGraph，吸收 dsh 设计修维护痛点 | 风险最低但 dsh 能力零获得；作为 Spike 失败后的兜底 |

## 4. 已核实的可行性证据

| 对接点 | 结论 | 证据 |
|---|---|---|
| MCP | dsh 原生 `dsh-mcp-client` 支持 stdio + streamable-http，工具以 `mcp__<server>__<tool>` 注册进 `ctx.tools`，自带重连退避与超时 | `deepseek-harness/packages/mcp/mcp-client/README.md`；现有 mat_remote_shell 与 optimade 均为 streamable_http，纯配置迁移 |
| 技能 | `dsh-skill-filesystem` 即 Claude 式 SKILL.md 目录，现有 5 个技能近乎原样迁移 | `packages/skill/skill-filesystem/` |
| 模型 | `dsh-llm-pi-ai` 把 OpenAI 兼容网关当配置项：自定义 baseURL + `apiKeyEnv` 凭据引用 + 自建模型目录；多路由等价于旧 model.json 多 provider 注册表 | `packages/llm/llm-pi-ai/README.md`；HPC-MAX 走 OpenAI 兼容协议（旧 `chat_openai_custom.py`） |
| 会话 | dsh session log 追加式、可重放、可 fork；「model-visible ⟺ logged」不变量使平台会话记录可从日志投影，替代 LangGraph sqlite checkpoint + session_store 双轨 | `docs/architecture.md` §Session log |
| 审批 | `interaction`/`approval` 能力把「确认集群/队列」从 prompt 口头约束升级为机制化关卡 | `packages/interaction/` |
| 环境 | 本机 Node v22.22 + pnpm 就绪；`~/.dsh` 已有运行痕迹；deepseek-harness 为 GitHub 官方克隆 | 会话内核实 |

未证实、进入 Spike 清单的风险项见 §10。

## 5. 架构

### 5.1 目标与非目标

目标：

- dsh 成为唯一 agent 运行时，VASP 能力全部以插件/bundle/配置组合表达。
- 对外 SSE 契约与现有平台语义等价（先兼容）；适配层（platform-gateway）可整体摘除（后切换）。
- 中间件栈的隐式行为变为显式插件 + 事件流——「难维护」的根治点。

非目标：不改 matstream / HPC / OPTIMADE 外部服务本身；本期不做 dsh web 前端替换；S0/S1 领域修复不混入迁移代码。

### 5.2 仓库形态

新仓库 `vasp-matstream-dsh`（不污染旧仓库，便于双跑对比）：

```
vasp-matstream-dsh/
├── packages/
│   ├── platform-gateway/     # 自研：平台 HTTP/SSE 契约 ⟷ dsh 会话事件投影
│   ├── vasp-tools/           # 自研 TS 插件：computation-report、资源卡片等纯逻辑工具
│   └── vasp-gates/           # 自研 TS 插件：计算前置校验门（风险文档 §8.1）
├── python/vasp-mcp/          # Python stdio MCP：VASP 解析/绘图/RAG（pymatgen 生态留在 Python）
├── skills/                   # 从旧仓库原样迁入
├── profiles/vasp.yml         # cordis.yml 组合
└── tests/
    ├── contract/             # SSE 契约回放测试（旧 agent 录制流为 fixture）
    └── snapshot/             # dsh 风格 headless 快照
```

### 5.3 部署模型

单容器 = 1 个 Node 进程（gateway 以 bundle 进程内组合，不拆独立服务），一个进程承载 N 个并发会话（dsh `ctx.agents` 原生多活 agent）。水平扩展 = 副本 × 粘滞路由（`conversation_id` 哈希；会话本为长连 SSE，粘滞零额外代价）。副本故障时新副本从 session log（JSONL，持久化在 `$DSH_HOME/sessions`）恢复会话；SQLite 仅是可选的检索索引，不承担持久化。将来拆 gateway/worker 走 dsh 现成 JSON-RPC/ACP，不改插件。

### 5.4 插件组合（profiles/vasp.yml）

| 层 | 来源 | 替代的旧组件 |
|---|---|---|
| `llm-pi-ai` 路由 → HPC-MAX（+qwen 备用路由） | dsh 现成 | `src/llm/`（loader/model.json，约 700 行删除） |
| `mcp-client` ×2（streamable-http） | dsh 现成 | `src/mcp/loader.py` + conf.yaml |
| `skill-filesystem` → `skills/` | dsh 现成 | `src/skills/` |
| `shell`/`fs`/`subprocess`/`sandbox` | dsh 现成 | shell backend 配置段 |
| `compaction` | dsh 现成 | summarization + context_budget 中间件 |
| `guard`（loop 卫生 + 工具超时） | dsh 现成 | 分散的超时/重试逻辑 |
| `interaction`/`approval` | dsh 现成 | 「确认队列」prompt 口头约束 |
| `session`（JSONL 持久化 + 可选 SQLite 检索索引） | dsh 现成 | LangGraph checkpoint + session_store 双轨 |
| `subagent` | dsh 现成 | `src/subagents/` + streaming_subagent 中间件 |
| `platform-gateway` | **自研** | `server.py` + `src/api/` 全部 |
| `vasp-tools` | **自研** | `src/tools/` 中适合 TS 的部分 |
| `vasp-gates` | **自研** | 新增能力（旧代码没有） |
| `python/vasp-mcp`（stdio） | **自研**（Python） | `src/tools/` 中依赖 pymatgen 的部分 |

自研面收敛到 **3 个 TS 包 + 1 个 Python MCP**，其余全是配置组合。这是对冲「Python 团队维护 TS」风险的核心手段。

### 5.5 工具切分原则

- **TS（vasp-tools）**：纯逻辑、无科学计算依赖——资源卡片、报告组装、目录/清单读取、预览元数据。
- **Python（vasp-mcp）**：依赖 pymatgen/科学栈——VASP 输出解析（OUTCAR/vasprun.xml）、能带/DOS 绘图、RAG、文献检索。
- 切分判据就一条：**是否 import 科学计算生态**。

## 6. 数据流与 SSE 契约

### 6.1 聊天请求主链路

```
平台前端 ──POST /api/user/agent/chat──▶ platform-gateway
 1. 校验上下文（user_id/conversation_id/鉴权），剥离 #debug-trace 关键词
 2. 定位/创建 agent：conversation_id ⟷ dsh session id
 3. SSE 建立，发 start（含 debugTrace 元数据）
 4. 输入入队 → dsh agent-loop（turn/start → step* → turn/end）
 5. gateway 订阅 session/event 流，逐事件投影为平台 SSE（§6.2）
 6. turn/end → finish（用量/耗时）→ 平台会话记录从事件流投影持久化

上传：POST 上传 → 存 $HOME/workspace/{conversation_id}/ → system-prompt 动态 section 注入清单
停止：POST /stop → agent handle 取消 → SSE cancelled（中断前 chunk 已在会话日志中保留）
```

### 6.2 SSE 事件投影表（gateway 核心职责）

| 平台 SSE 事件 | dsh 来源 | 备注 |
|---|---|---|
| `start` | gateway 自身 | 含 debugTrace 元数据 |
| `text_delta` | `assistant/chunk` 文本部分 | |
| `reasoning_summary` | `assistant/chunk` reasoning 部分 | Spike 验证 pi-ai 透传 |
| `tool_call` | `tool/call` | MCP 工具限定名 → 展示名映射 |
| `tool_result` | `tool/result` | |
| 资源卡片 | 特定工具 result 投影 | UI render intent 在 vasp-tools 声明 |
| 文件/图片预览 | 特定工具 result 投影 | 替代 read_file_image_result |
| `error` | turn 失败 / llm 错误 | |
| `cancelled` | agent 取消完成 | |
| `finish` | `turn/end` + 用量事件 | |

**兼容验收标准（「先兼容」的可执行定义）**：用旧 agent 录制真实 SSE 流为 fixture，契约回放测试断言新旧事件序列**语义等价**（时间戳与具体用量数值允许归一化）。

### 6.3 中间件迁移矩阵

| 旧中间件 | dsh 去向 | 验收点 |
|---|---|---|
| tool_description_param | 消亡（dsh 工具 schema 原生完整声明） | 契约回放 |
| agent_state_messages | system-prompt 动态 section | 契约回放 |
| prompt_context | system-prompt section | 上传后可引用文件 |
| context_budget | compaction 配置 | 压缩触发点与旧版对齐 ±20% |
| summarization | compaction capability | 压缩后早期事实快照用例 |
| streaming_subagent | dsh subagent 事件流 | 子代理进度 SSE 可见 |
| tool_handoff + job_monitor_handoff | `ctx.jobs` + `job_*` 工具（重设计） | 作业监控跨 turn 存活 |
| stop_token | gateway + agent 取消 | stop 后会话可继续 |
| mcp_tool_error | `tools/post-execute` 监听小插件 | MCP 断连错误可读不毒化 |
| interrupted_output_fallback | dsh 原生取消路径 | 中断后内容保留 |
| computation_report_state | vasp-tools 监听 session 事件 | 报告状态跨 turn 一致 |
| read_file_image_result | gateway 投影 | 预览事件同形 |

规律：约一半中间件消亡或原生化；真正写代码的是投影层与自研包。旧栈 13 个隐式中间件 → 1 张显式映射表 + 事件订阅。

### 6.4 模型路由

HPC-MAX：pi-ai 自定义路由，`apiKeyEnv` 凭据引用，temperature 0 / top_p 0 入路由配置；qwen 等备用路由同构保留。Spike 验证：`enable_thinking` 等自定义 args 透传、reasoning 流式行为、工具调用并发。

## 7. 错误处理

| 故障域 | 策略 |
|---|---|
| MCP 不可用（现状：两个 MCP 均 `available: false`） | `failOnStartupError: false` + 重连退避；可用性投影到资源卡片/系统提示，模型显式感知降级（部分改善 R-01 体验面）。根因在外部服务，另行推动 |
| 模型网关错误 | 路由级 retryPolicy（指数退避）；连续失败 → SSE `error`，会话可继续 |
| 工具超时 | `guard` 工具超时；HPC 远程命令单独长超时 |
| 进程崩溃/副本漂移 | session log 恢复；前端重连既有会话 |
| 危险操作 | `interaction`/`approval`：作业提交、删除、高核时确认机制化 |
| 命令执行分歧（R-15/R-16） | `MAT_SANDBOX` 严格布尔解析收进 vasp-gates 一处定义；提交路径统一过 gates |

## 8. 测试策略

1. **契约回放**（M1 起常青）：旧 SSE fixture 语义等价断言。
2. **无 key 快照**：headless profile + 模型回放，锁行为。
3. **真 API e2e**：HPC-MAX + 真 MCP，环境变量门控自跳过。
4. **领域回归**：Si / MoS₂ / AFM 氧化物 / SOC / 金属基准体系端到端（风险文档第三阶段，切换前必须绿灯）。
5. **门测试**：vasp-gates 每门的「应拒未拒」用例。

## 9. 里程碑

| 阶段 | 内容 | 出口判据 | 预估 |
|---|---|---|---|
| M0 脚手架 | profile 启动，LLM+MCP+技能活，headless 跑通一轮对话 | Spike 四问全绿 | 1-2 周 |
| M1 契约层 | gateway MVP：SSE chat + 会话 + 上传 | 契约回放通过 | 2-3 周 |
| M2 能力对齐 | compaction / stop / 子代理流 / 工具错误映射 | 迁移矩阵逐行验收 | 2-3 周 |
| M3 领域迁移 | vasp-mcp + vasp-tools + vasp-gates | 领域回归绿 | 3-4 周 |
| M4 双跑灰度 | 新旧并行 diff，按比例切流 | 一周灰度无 S 级差异 | 1-2 周 |
| M5 收尾 | 旧服务下线；dsh pin rc + 季度升级评估 | — | 1 周 |

总计约 3-4 个月单人全职当量（含 TS 学习曲线）。S0/S1 领域修复并行独立，不占关键路径。

## 10. 风险登记册

| 风险 | 等级 | 缓解 |
|---|---|---|
| Python 团队维护 TS | 高 | TS 面收敛 3 包；只碰文档化扩展点；领域逻辑留 Python MCP；前两里程碑 pair review |
| dsh pre-release 变更 | 高 | pin 精确版本；不 fork 不改 loop；季度升级评估；最坏 vendor 锁死 |
| SSE 契约隐藏语义丢失 | 中 | M1 先录旧流再写 gateway；M4 双跑 diff 兜底 |
| HPC-MAX 经 pi-ai 行为差异 | 中 | Spike 首项验证；不行自写薄 LLM adapter 插件（seam 本就支持） |
| 双运行时运维（Node + Python MCP） | 中 | Python MCP 无状态、容器内 uv 脚本拉起；健康检查统一进 gateway |
| 人力挤占导致烂尾 | 中 | 每里程碑独立可验收；M1 后任意时刻停下都有能跑的半成品，旧系统不受影响 |

## 11. Spike 验证清单（M0 出口，按风险排序）

1. pi-ai 自定义路由指向 HPC-MAX：流式、reasoning 透传、`enable_thinking` 等 args、工具调用并发。
2. mcp-client 接 mat_remote_shell 与 optimade（顺带确认两服务当前可用性——配置中均为 `available: false`，`ConnectError`/404）。
3. dsh 多并发会话 + session log 恢复在容器内的行为（sessions 卷、粘滞路由失效恢复）。
4. skill-filesystem 加载现有 5 个 SKILL.md（变量展开、`${file:...}` 类占位符是否需要改写）。

Spike 失败的退路：转方案 B（dsh 经 Python SDK 子进程）或 C（只借模式），沉没成本 ≤ 2 周。

## 12. 决策记录

- 2026-08-21：用户确认驱动力（难维护 + 想要 dsh 能力 + 调研阶段）、接口策略（先兼容后切换）、团队栈（Python 为主）、部署（容器化可扩展）。
- 2026-08-21：在 B/C 备选下选定方案 A（整体重写）；B 为 Spike 受阻退路，C 为兜底。
- 2026-08-21：设计三节（架构 / 数据流与 SSE 映射 / 错误-测试-路线-风险）逐节确认通过。
