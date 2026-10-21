# mat-dsh：基于 DeepSeek Harness 的 HPC 科学计算 harness 设计

- 日期：2026-08-27
- 状态：设计已经用户逐节确认（§1–§8 两轮确认），待最终审阅
- 范围：新建单用户本地工具 mat-dsh——在**不改源码、精确 pin** 的 deepseek-harness（dsh 0.1.0-rc.8）之上，以树外插件包组合出"对话式 HPC 科学计算"产品：Gaussian 工作流 + 通用 Slurm 原语，作业后台监控、完成自动唤醒汇报
- 关联材料：
  - `deepseek-harness/`（宿主克隆，只读）：`docs/architecture.md`、`packages/jobs/*/README.md`
  - `~/other-projects/vasp-matstream-agent/skills/mat-plugin/MIGRATE_PROMPT.md`（下称「迁移提示」——已真集群端到端验证的 Python 插件，本项目 TS 移植的源）
  - `vasp-matstream-dsh/`（兄弟项目）：`docs/spike-results.md` M0 结论（Q1/Q2/Q4 证据可复用）
  - `vasp-matstream-agent/`（参考对象）：任务监控 handoff 语义、队列选择纪律、`skills/mat-job-manager/SKILL.md`
  - `docs/superpowers/specs/2026-08-21-vasp-matstream-dsh-refactor-design.md`（已核实的 dsh 对接点证据）

## 0. 用户确认的决策（brainstorm 逐项定案）

| 决策点 | 结论 |
|---|---|
| 产品定位 | 单用户本地工具：本机 `mat-dsh web`，浏览器访问，配置自己的凭证 |
| 代码形态 | 树外：deepseek-harness 保持原样可升级，新仓库装本地插件包 + profile overlay 组合 |
| 插件接入 | HPCPlugin（Python）移植为 TypeScript（mat-core），Python 原版留作交叉验证参照 |
| 模型后端 | OpenAI 兼容端点（llm-pi-ai provider，自定义 baseURL + apiKeyEnv——spike Q1 已验证该模式） |
| 计算范围 | MVP：已验证的 Gaussian 工作流 + 通用 Slurm 原语 |
| 卡片 UX | MVP 用 dsh 原生机制（ctx.jobs + 现成 ui-jobs + ask-user）；自定义卡片二期 |
| 验收标准 | 水分子 opt+freq 真集群端到端，对齐迁移提示基准 |

## 1. 备选方案与取舍

| 方案 | 一句话 | 结论 |
|---|---|---|
| **A：工具能力 + 后台作业 provider（选定）** | HPC 作为模型可见工具（ctx.tools）+ Slurm 监控映射 ctx.jobs | 唯一同时满足"全走文档化扩展点 + 监控语义原生"的路线 |
| B：HPC 作为 shell/fs 能力 provider | Bash/文件工具透明跑到远程计费集群 | 否：agent 自身执行环境换成计费生产集群，费用/安全/延迟语义全变味；精确编排藏在 skill 提示词里不如类型化工具可靠 |
| C：MCP-first | 直接用 dsh mcp-client 连 HPC remote-shell 网关 | 否（暂）：Node fetch 对 mcp-gateway.example.internal 未实测（spike Q2 的 dsh 侧 PASS 用的是 optimade 端点）；网关 ~50% 断连需要的正是插件那套 curl 三级容错。transport 抽象成接口，FetchTransport 列为 spike 项，稳了可后换 |

传输层判断依据（迁移提示 §3.1，实测）：对 mcp-gateway.example.internal 的 HTTPS，Python requests SSL 握手失败、curl 稳定；故 mat-core 默认 `CurlTransport`（curl 子进程），该实测结论作为移植不变量。

## 2. 总体架构

```
┌─────────────────────────── mat-dsh（新仓库，树外）───────────────────────────┐
│                                                                                │
│  profiles/mat.yml（web profile overlay）                                      │
│    ├─ llm-pi-ai: provider mat ← baseURL/apiKey 环境变量（spike Q1 已验证模式）  │
│    ├─ skill-filesystem: skills/mat-gaussian（SKILL.md）                       │
│    └─ 挂载三个本地插件包 ↓                                                       │
│                                                                                │
│  packages/mat-tools ──注册──▶ ctx.tools                                       │
│    mat_exec / mat_partitions / mat_sbatch /                              │
│    mat_job_status / mat_cancel / mat_gaussian                            │
│         │                          │                                           │
│         ▼                          ▼ 提交后立即返回 jobId                      │
│  packages/mat-core ◀──── packages/mat-jobs ──注册──▶ ctx.jobs              │
│  （纯库，TS 移植插件）        （JobKind: mat-slurm 轮询 producer；             │
│   curl→MCP/三级容错/          终态后自动跑 post 阶段；completion notice          │
│   Slurm 原语/Gaussian 编排     唤醒 agent 收结果）                              │
└────────────────────────────────────────────────────────────────────────────────┘
                                          ▼ 组合（不改源码，精确 pin 0.1.0-rc.8）
                            deepseek-harness（web profile + dsh-base）
```

**MVP 凭证简化**：Gaussian 全流程只需 `mcp_key` 一个凭证（迁移提示 §2：仅需 sk- 密钥构造 MCP URL）。AK/SK token API 整体不移植（YAGNI，二期）。环境变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `MAT_MCP_KEY` | 是 | 用户本人在 HPC 密钥中心创建的 remote-shell 密钥（sk- 开头） |
| `MAT_MCP_BASE_URL` | 否 | 覆盖默认 `https://mcp-gateway.example.internal/api`（开发网关等场景） |

## 3. 仓库布局

新仓库建议路径 `~/mat-harness/mat-dsh/`（与 vasp-matstream-dsh 平级、模式一致）：

```
mat-dsh/
├── package.json / pnpm-workspace.yaml    # pin @deepseek-ai/dsh-* 0.1.0-rc.8 + cordis deps（同 spike 依赖清单）
├── packages/
│   ├── mat-core/       # 纯 TS 库，零 dsh 依赖 → 可独立单测/回放
│   ├── mat-tools/      # 依赖 mat-core + dsh core/tools
│   └── mat-jobs/       # 依赖 mat-core + dsh jobs
├── profiles/mat.yml    # overlay：骑在 web profile 上（spike 已验证 --patch 模式）
├── skills/mat-gaussian/SKILL.md   # 集群/队列选择纪律、费用决策必须交用户等
└── tests/{unit,replay}/  # 单测 + 真实输出回放
```

MVP 用 profile overlay 组合（spike 已验证）；打成交付 bundle 是后续分发问题，不影响包结构。

## 4. mat-core：移植映射表（坑即不变量）

源为迁移提示 §4 `plugin.py`（已真集群验证，2026-08-27 基准：昆山 11250 / Agent0 / 水分子 opt+freq → job 120170529 COMPLETED，energy=-76.408953979，freqs=[1713.1285, 3727.1699, 3849.0959]，imag=0）。

| plugin.py（Python） | mat-core（TS） | 移植不变量（实测坑，不得"优化"掉） |
|---|---|---|
| `build_mcp_url` | `url.ts` | `{base}/mcp/{mcp_key}/{service_id}/mcp`；service_id 固定 `7552849000000000000` |
| `_mcp_init/_mcp_exec` | `curl-transport.ts` | 必须 curl 子进程（`-k -s --noproxy *`）；双头 `Accept: application/json, text/event-stream`（缺则 406）；首次 initialize 从响应头取 `mcp-session-id`（小写匹配），后续回传；响应取 SSE `data:` 行解析 JSON |
| `_curl_with_retry` | `curl-transport.ts` | rc≠0 **或 body 为空**（HTTP 000 连接重置时 curl 正常退出但 body 空，必须检测）→ 5s/15s/30s 重试 3 次 |
| `exec_command` 三级容错 | `client.ts` | curl 层 3 次 → 会话层重建 3 次 → 轮询层连续 5 次失败才放弃 |
| remote_shell 返回归一化 | `client.ts` | `code:0` 时 `data` 为 stdout 字符串；`code:10020` 时 `data` 为 `{stdout, stderr, exitCode}`；data 可能 str/dict，统一归一化 |
| `list_partitions` | `slurm.ts` | `sinfo -o '%P|%a|%l|%D|%t'`，分区名去尾部 `*` |
| `sbatch` | `slurm.ts` | 解析 `Submitted batch job <id>` |
| `job_status` | `slurm.ts` | squeue 优先、空则 sacct 回退 |
| `wait_job` | `slurm.ts` | 终态集合 {COMPLETED, FAILED, CANCELLED, TIMEOUT, NODE_FAIL, OUT_OF_MEMORY, CANCELLED+}；单次失败跳过、连续 5 次放弃 |
| `scancel` | `slurm.ts` | 直传 |
| `gaussian_calc` | `gaussian.ts` | 写文件后**落盘校验**（`[ -s file ]` MISSING 检查）；run 前 `export GAUSSIAN_ENV_SCRIPT=$HOME/workspace/g16-hy/scripts/env.sh`；`pre.json` schema `gaussian_workflow.pre.v1`、`run.json` 只含 slurm 块、`post.json` 必须 `{}`；post 输出 JSON 行解析 `properties.energy / converged / frequencies_cm-1 / imaginary_frequency_count`；`opt+freq` 是单作业组合；默认 workflow env `$HOME/workspace/demo/env.sh`，均可配置覆盖 |
| token API（AK/SK 全家族） | **不移植** | MVP 仅 mcp_key；分区查询走 sinfo 不需要 AK/SK；upload/download 二期评估 |

transport 抽象为接口：默认 `CurlTransport`；`FetchTransport` 为 M0 可选 spike 项（Node fetch 对 mcp-gateway.example.internal 直连探测），若稳可替换实现、接口不变。

## 5. mat-tools + mat-jobs 协作

### 5.1 工具面（模型可见，注册于 ctx.tools）

| 工具 | 参数 | 返回 |
|---|---|---|
| `mat_exec` | cluster_id, command, timeout_seconds=30 | 归一化 stdout；失败时完整 `{stdout, stderr, exitCode}` 如实展示 |
| `mat_partitions` | cluster_id | 分区列表（name/avail/timelimit/nodes/state） |
| `mat_sbatch` | cluster_id, workdir, script="slurm.sh" | slurm_job_id |
| `mat_job_status` | cluster_id, job_id | 当前状态字符串 |
| `mat_cancel` | cluster_id, job_id | 执行输出 |
| `mat_gaussian` | cluster_id, task, structure, workdir, partition?, options?（pre_json/run_json/workflow_env/g16_env/poll/max_wait，均有 §4 默认值） | `{slurm_job_id, background_job_id, workdir}`（秒级返回） |

`mat_gaussian` 只做 pre→run→sbatch（秒级），随即 `ctx.jobs.start` 启动后台监控并立即返回——不阻塞 agent loop（dsh 有工具超时护栏，长等待必须走后台作业）。

### 5.2 后台 producer（mat-jobs，JobKind `mat-slurm`）

- 轮询 `job_status`（10s 间隔，轮询层容错照抄 waitJob）至终态
- 终态后**在 job 内自动执行 post 阶段**（确定性工作放代码、不放提示词）
- settle 时 output：`{slurm_state, properties{energy, converged, frequencies_cm-1, imaginary_frequency_count}, files, log_tail?}`
- 完成通知走 dsh 原生投递（`dsh-tool-jobs` completion notices：空闲 owner 唤醒新 turn，忙碌 owner 注入 next-step inbox）→ 模型 `job_output` 收结果、向用户汇报——**这正是 vasp-matstream-agent 手写 job-monitor handoff 中间件的语义，dsh 原生免费获得**
- `ui-jobs` 现成 UI（会话头部作业列表：状态、运行时长、detail）即 MVP 的"任务监控卡片"

### 5.3 集群/队列选择纪律（SKILL.md，继承 vasp-matstream-agent 铁律）

- 集群未指定 → 先问；分区（费用相关）**必须用户决断，任何情况下禁止代选**，即使只有一个可选
- 交互走 dsh 现成 ask-user 机制
- 输出面向用户时用集群名（如 华东一区【昆山】），内部流转用 cluster_id

## 6. 端到端数据流（验收场景）

```
用户: "帮我对这个水分子做 opt+freq"
  │
  ▼  agent 加载 SKILL.md(mat-gaussian)：集群未定→先问；分区必须用户选
mat_partitions("11250") ──▶ sinfo 分区表
ask-user（费用决策关卡）  ──▶ 用户选 Agent0
  │
  ▼  agent 调 mat_gaussian(cluster_id, "opt+freq", xyz, workdir, partition)
  │   [工具内·秒级] mkdir → 写 4 个输入文件 + 落盘校验 → pre → run(export GAUSSIAN_ENV_SCRIPT)
  │                 → sbatch → slurm_job_id → ctx.jobs.start(监控producer)
  ▼
返回 {slurm_job_id, background_job_id, workdir} → agent 告知"已提交，监控中"
  │
  ▼  [后台·与对话并行] 每 10s job_status（squeue→sacct 回退；单次失败跳过）
COMPLETED ──▶ 自动执行 post 阶段（确定性代码，不经 LLM）──▶ 解析 properties ──▶ job settle
  │
  ▼  dsh completion notice：agent 空闲则唤醒新 turn
agent: job_output(background_job_id)
  ──▶ {slurm_state:"COMPLETED", properties:{energy:-76.408954, converged:true,
       frequencies_cm-1:[1713.13,3727.17,3849.10], imaginary_frequency_count:0}, files:[...]}
  │
  ▼
agent 向用户汇报结果；期间用户随时可问"好了吗"（agent 查 job_output/status 即答）
```

失败分支：Slurm FAILED/TIMEOUT → job 照常 settle，output 携带终态 + `job.log` 尾部摘要 → agent 诊断（可再调 `mat_exec` 查日志）后向用户解释。

## 7. 错误处理（分层）

| 层 | 行为 | 对外表现 |
|---|---|---|
| curl 传输 | rc≠0 或 body 空（HTTP 000）→ 5s/15s/30s 重试 3 次 | 仍失败 → `MatTransportError`（含末次 curl stderr 摘要） |
| MCP 会话 | exec 失败 → 重建 session 重试 3 次 | `MatSessionError` |
| 轮询 | 单次失败跳过，连续 5 次才放弃 | job settle 为 failed，output 带错误链 |
| 远程命令 | `code:10020` → 归一化 `{stdout, stderr, exitCode}` | 如实展示给模型（不吞错，模型据此诊断） |
| Gaussian 阶段 | pre/run 输出无 `"status": "ok"` / 落盘校验 MISSING | 抛错带阶段名 + 原始输出尾部 |
| 凭证 | `mcp_key` 缺失或无效 | 工具立即明示凭证问题（不隐藏、不误报） |
| 轮询超时 | `max_wait`（默认 30min，对齐插件）| settle 输出 `TIMEOUT_WAITING` + 末次状态，agent 可决定续监控 |

浮点结果（energy/freqs）一律近似比较，禁止精确 `==`。

## 8. 测试策略

延续轻量 TDD + vasp-matstream-dsh M1 的"契约层 + 回放"纪律：

1. **单元测试**（mat-core，mock 子进程 / fake timers）：curl 命令构造、SSE 解析、`mcp-session-id` 提取、HTTP 000 重试、三级容错状态机、`10020` 归一化、sinfo/squeue/sbatch 输出解析、gaussian 命令序列与 MISSING 分支
2. **回放测试**（真实输出样本 → 解析断言）：昆山 11250 的 sinfo/squeue/sbatch 实际输出；gaussian-workflow pre/run/post 真实 JSON；**与 Python 插件交叉验证**（同输入，TS 与 Python 解析结果一致）
3. **契约测试**：工具 schema 注册、producer 生命周期（settle→notice）
4. **真集群冒烟（验收）**：水分子 opt+freq 端到端，对照基准 `energy≈-76.408954 / freqs≈[1713.13, 3727.17, 3849.10] / imag=0`（近似比较）

## 9. 里程碑

| 里程碑 | 内容 | 出口判据 |
|---|---|---|
| **M0 spike**（~1天） | 仓库骨架 + profile overlay 起 web（LLM 走 OpenAI 兼容端点）；最小 `mat_exec` 工具经 CurlTransport 对 11250 跑 `hostname`；（可选）FetchTransport 对 mcp-gateway.example.internal 探测 | web UI 一句话让模型执行远程命令成功；`git -C deepseek-harness status` 干净 |
| **M1 core**（1–2周） | mat-core 全量移植 + 单测/回放 | 单测/回放全绿；与 Python 交叉验证一致 |
| **M2 tools+jobs**（~1周） | 工具面 + producer + SKILL.md；headless 跑通"提交→后台监控→notice 唤醒→收结果" | 循环闭环（短作业） |
| **M3 验收**（数天） | web UI 水分子端到端 | 基准对照通过（浮点近似） |

每个里程碑独立可验收、可回滚。M0 复用 vasp-matstream-dsh spike 的依赖清单与 profile 模式（Q1/Q4 证据直接可用，不重验）。

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| dsh 0.1.0-rc.8 pre-release，磁盘格式无兼容承诺 | 精确 pin；只用文档化扩展点（ctx.tools/ctx.jobs/skill-filesystem/llm-pi-ai/ask-user）；季度评估升级（沿用 vasp-matstream-dsh 判断） |
| mcp-gateway.example.internal 网关断连率 ~50% | 三级容错作为移植不变量；单测覆盖状态机 |
| Node fetch 对 mcp-gateway.example.internal 未实测（spike Q2 dsh 侧 PASS 用的是 optimade 端点） | 默认 CurlTransport（实测稳）；M0 可选探测 FetchTransport，接口已抽象 |
| 二期自定义卡片依赖树外 client UI 插件（无官方先例文档） | MVP 不需要；二期前单独 spike（dsh 的 UI 全由 client 插件构成，理论可行） |
| gaussian-workflow CLI 依赖集群侧部署（demo env 路径写死在默认值） | 路径全部可配置覆盖；SKILL.md 记录探测方法 |
| 用户级 `~/.dsh/settings.yaml` 静默顶掉 profile 路由（spike 踩过） | 文档明示 + 测试用干净 `DSH_HOME` |

## 11. 非目标（本期不做）

- AK/SK token API（集群/队列 REST 查询、文件上传下载、HPC job submit）——二期评估
- 自定义任务卡片 UI（对齐 vasp-matstream-agent 风格的 client 插件）——二期
- 多用户服务部署、容器化、水平扩展
- VASP 等其他计算软件工作流——后续按 Gaussian 同模式扩展
- 计算报告生成（computation_report）——后续作为 skill
- Python 插件本体的继续维护——冻结为交叉验证参照

## 12. 与兄弟项目的关系

`vasp-matstream-dsh`（进行中，M2 待启动）：平台网关、SSE 契约兼容、多用户服务方向。本项目与它**共享模式（profile overlay、pin 策略、测试纪律）、零代码依赖、互不阻塞**。MIGRATE_PROMPT.md 的插件原生于 dpag/vasp-matstream-agent，本项目移植后如需回馈，以 mat-core 为基准反向同步。
