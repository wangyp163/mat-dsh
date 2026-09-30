# mat-dsh 技术亮点总结

> 整理日期：2026-09-16
> 范围：`mat-dsh`（mat-dsh）及其与宿主 deepseek-harness（dsh v0.1.0-rc.8，只读 pin）的集成设计
> 性质：每项亮点均附源码路径与/或量化证据，可回溯验证

## 项目定位

mat-dsh 是基于 DeepSeek Harness（dsh）构建的**对话式超算科研 harness**：科研人员在 dsh Web UI 中对话式地驱动 HPC Slurm 集群上的 Gaussian 16 量子化学计算。架构为"**本地控制面 + HPC 算力面**"——本地插件负责技能、输入 schema、校验器、声明式控制文件（`pre.json`/`run.json`/`post.json`）与产物同步策略；HPC 负责 workflow 实现、Gaussian 许可与 Slurm 运行时。跨边界只传结构化数据，重产物默认留在远端。

对宿主零改动：一切通过 dsh 文档化扩展点（`ctx.tools`、`ctx.jobs`、profile overlay）注入，`packages/mat-tools/src/index.ts` 以 `declare module` 类型安全地注册 `mat-watch`/`mat-slurm` 作业类型。

---

## 一、成本与性能类收益

### 1. 服务端异步批量 Slurm 监控——等待期零 LLM 消耗

**位置**：`packages/mat-core/src/watch-loop.ts`、`job-state.ts`；工具接线 `packages/mat-tools/src/index.ts`

**机制**：`mat_job_watch` 一次调用注册全部作业 id，启动后台作业（kind `mat-watch`）。每个轮询周期只发**一条**批量命令 `sacct -j <id1>,<id2>,... -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir`——N 个作业 1 次往返而非 N 次；`WorkDir` 在同一次往返中取回，供文件面板零成本使用。轮询间隔按运行时长自适应退避（10s → 60s → 120s → 300s），四条独立落定路径（全部终态 / maxWait 超时并附"仍在运行"清单 / 连续 5 次传输错误 / 取消）。返回的句柄严格贴合宿主 `JobHooks` 形状（`{cancel, done, readOutput}`），集群作业被当作原生后台作业对待。

**收益**：消除了 agent 驱动 HPC 最主要的成本——模型在循环里轮询 `squeue`。等待期零模型请求，完成通知由宿主投递。增量输出按每作业变更签名 `state|exit|elapsed` 去重，模型只消费变化行，节省上下文。状态卡按 `cluster:jobId` 确定性定键，maxWait 落定后重挂 watch 合并到同一张卡，不产生重复。

### 2. 一站式 Gaussian 编排——6 次往返压缩为 1 次调用

**位置**：`packages/mat-core/src/gaussian.ts`；工具 `packages/mat-tools/src/index.ts`（`mat_gaussian`）

**机制**：`prepareInputsCommand` 把 `mkdir -p`、`molecule.xyz` heredoc、三份 `echo > json` 控制文件写入、非空文件校验循环（`MISSING:<file>` 哨兵）、`PREP_READY` 标记打包进**单条** shell 命令——Python 时代需 6 次往返。同步链 prepare → pre → run → sbatch 逐级 fail-fast，错误带输出尾。后台 producer（`createGaussianProducerHooks`）监控 sacct 至终态后**自动执行 post 阶段并解析结构化属性**（能量、收敛性、虚频计数、文件、图表）进作业输出；COMPLETED 但 post 失败不置败作业，而是标注 `COMPLETED but post failed` 附日志尾；非 COMPLETED 终态走尽力而为的**诊断性** post（结构化收敛轨迹、`kb:<id>` 知识引用），终态保持权威。默认 producer 轮询上限 30s，专门封堵一个实测竞态：sacct 已显示 COMPLETED 但 `job_output` 仍返回上一 tick 快照。

**收益**：一次工具调用替代整段交互式技能流程；已知选项的计算不再需要多轮模型交互，计算属性随一条完成通知送达。

### 3. 声明即预算的成本闸门 + sacct 对账

**位置**：`packages/mat-core/src/budget.ts`、`portfolio.ts`；闸门 `packages/mat-tools/src/budget-hook.ts`；对账 `scripts/reconcile-ledger.ts`

**机制**：批量任务存放于外部 JSON **portfolio 清单**（阶段 `pending → prepared → submitted → settled → diagnosed → interpreted → final`），刻意置于会话之外以节省上下文；阶段只进不退，重试必须走 `resetForRetry`（递增 `attempts`、清除 `jobId`）。清单可声明预算 `{maxSbatch, maxRetriesPerTask, maxCoreHours}`；提交工具收到 `task_ref={portfolio_file, task_id}` 时，`openBudgetGate` 重放追加式提交台账，在任何 sbatch 发生**之前**拒绝超预算操作（含计划外 taskId），返回结构化 `BUDGET_REJECTED` 错误。记账只发生在真实 sbatch 作业 id 解析成功之后，清单写入走 `.part` + rename 原子落盘。事后 `reconcile-ledger.ts` 对全部台账作业发一条批量 sacct，回写 `actualCoreHours = elapsedSeconds × ncores / 3600`（幂等覆盖），输出估算 vs 实际偏差报告。

**收益**：自主 agent（或失控循环）物理上无法突破声明的核时/提交数上限——硬性成本遏制；预算估算质量可度量（规模轮实测偏差 6.51%）。

### 4. 文件同步状态机 + "remote-only" 策略 + 主文件预取

**位置**：`packages/mat-core/src/file-sync-manager.ts`、`remote-file-model.ts`；编排 `packages/mat-tools/src/file-service.ts`

**机制**：`FileSyncManager` 以状态机管理每次同步（`queued → downloading → verifying → completed/failed/cancelled`），落盘前校验字节数与传输结果一致，再原子 rename；失败清理临时文件，同 id 重入即重试。目录创建逐段校验并**拒绝符号链接父目录**；`keep-both` 冲突加 `.mat-N` 后缀。`remote-file-model.ts` 强制远端路径为绝对 POSIX 无穿越、映射本地路径禁闭在任务根下；合并本地+远端树为统一工作区视图（`local-only`/`remote-only`/`synchronized`/`downloading`/`conflict`）。作业落定时**旁路预取**至多 20 个主文件（4 并发池），只拉 ≤2MB 的——预取失败静默吞掉，绝不影响落定。全链硬预算：MAX_FILES=100、MAX_BYTES=100MB、MAX_DEPTH=16。

**收益**：大体积检查点/波函数按策略留在远端（省带宽、省同步成本）；小而关键的结果在用户打开前已本地就绪。逐块校验 + 原子 rename 意味着截断的传输不可能冒充成功产物。

---

## 二、可靠性与正确性类收益

### 5. 远程 shell 输出串扰双层防护（真实生产事故修复）

**位置**：`packages/mat-core/src/exec-gate.ts`、`exec-guard.ts`、`client.ts`；事故记录 `docs/evidence/post-m3/2026-09-04-exec-channel-crosstalk-fix.md`

**背景**：2026-09-04 三个并发会话实证 HPC 远程 shell 通道按 (mcpKey, clusterId) 复用同一 shell 且无输出路由隔离——会话 S3 的 `sbatch` 返回了 S1 的 `ls` 输出（作业 id 静默丢失）、下载解析到别的会话的列表、stderr 交错。

**机制**：
- **exec-gate（预防）**：全部 `remote_shell_execute` 按 `(mcpKey, clusterId)` 串行。第一层进程内 FIFO promise 链（`Map<key, Promise>`，覆盖所有 `MatClient` 实例）；第二层跨进程文件锁（`open(path,'wx')` = O_CREAT|O_EXCL，15s mtime 心跳、90s 崩溃抢占、75ms 抖动轮询、300s 获取预算），**任何文件系统异常时 fail-open**——可用性优先，正确性由第三层兜底。锁键 `sha256(mcpKey|clusterId).slice(0,32)`，密钥不进文件名。开关：`MAT_EXEC_GATE=off`、`MAT_EXEC_FILE_LOCK=off`。
- **exec-guard（检测）**：每条命令包一次性随机令牌——stdout 起标记 `SCNXS:<token>`、stderr 止标记 `SCNXE:<token> rc=N`，尾随 `test "$rc" -eq 0` 保住真实退出码（127 不再被压扁成 1）；标记独占行，heredoc 存活。响应缺失**本次调用**的令牌即抛 `RemoteShellCrosstalkError`，`MatClient.execCommand` 换新令牌重试至多 3 次（5s/15s 退避，重试间释放闸门）。

**收益**：把"静默吞掉别的会话数据当作自己的"——科学结果最恶劣的失败类别——变成可检测、可重试的错误；顺带修复了退出码保真问题。

### 6. 三层容错传输栈 + 双传输实现

**位置**：`packages/mat-core/src/curl.ts`、`transport.ts`、`fetch-transport.ts`、`client.ts`

**机制**：三级重试栈：(1) curl 子进程重试 5s/15s/30s，`requireBody` 把空 body 视为网络故障；(2) MCP 会话层——initialize → 捕获 `Mcp-Session-Id` → `tools/call`，任何可疑即失效强制重新初始化；(3) 整体执行重试 + 传输失效。SSE 解析跳过心跳/半截 JSON 行，只接受可解析的 `data:` 行。双传输并存源于实测环境差异：Node 网络栈对 `mcp-gateway.example.internal` SSL 不稳，curl 是被验证的默认；原生 fetch 备选（`MAT_TRANSPORT=fetch`）把单次往返从 ~10s 降到 ~2s，但需要**显式非 2xx 状态检查**（fetch 不像 curl 会把 HTTP 406 体现为退出码），状态嵌入错误并失效会话。两者共享注入的依赖缝隙（`CommandRunner`、`FetchLike`）供离线单测。

**收益**：脆弱网络环境下的韧性；保留经实测的提速通道。

### 7. 原子写与旁路隔离贯穿全库

**位置**：`packages/mat-tools/src/index.ts`（jobs.json 持久化）、`status-board.ts` 等

**机制**：所有落盘状态（jobs.json、portfolio 清单、preferences.json）一律临时文件 + `renameSync` 原子写。状态板喂入、预取、诊断 post、清单快照全部包在旁路（bypass）里，失败绝不污染主路径（监控、落定、提交）。状态板 `maxSettled` 从 20 提到 500，注释记载所防的真实故障：核心默认裁剪最旧已落定条目，被裁剪的快照落盘后，磁盘目录变成不可达孤儿。`upsert` 永不把已落定条目回退为监控中，终态字段冻结；每次变更触发 `onChange` 持久化，但持久化失败被包住不会破坏状态板。

**收益**：进程被杀/崩溃不留撕裂状态；辅助功能的故障不放大为主流程故障。

---

## 三、安全类收益

### 8. 加固的浏览器-文件系统边界

**位置**：`packages/mat-ui/src/index.ts` + `packages/mat-tools/src/file-service.ts`

**机制**：会话工作区根**服务端**从宿主 `session_projcache.json` 解析——浏览器只传 session id，代码注释明言"绝不接受客户端路径，防任意目录读取"。每条路由再校验：仅相对路径、拒绝 `..` 与 NUL、路径数 1–100、身份绑定（工作区必须恰为 `<localRoot>/<clusterId>/<jobId-segment>`）、物化后路径等值复查（"物化文件逃逸出约定工作区"即拒绝）。文件预览走内容类型白名单且**永不返回 `text/html`**，所有响应带 `x-content-type-options: nosniff`；请求体上限 64KB。分子查看器（内置 NGL，MB 级 JS）磁盘读一次进模块级缓冲，ETag（size+mtime）+ `304` 复验 + `cache-control: public, max-age=86400`。多远端文件下载走 4 并发物化池，无依赖 ZIP 写入器自带 CRC32。

**收益**：Web 面板不成为任意文件读取后门；大静态资源不重复占带宽。

### 9. 引擎级子代理权限最小化 + 类型化裁决契约

**位置**：`packages/mat-core/src/contracts.ts`；角色定义 `profiles/mat.yml`

**机制**：`profiles/mat.yml` 按角色配置 allow/deny 工具过滤器与 `maxDepth` 上限——`subagent-prep`（仅本地，allowlist `['skill','read','bash']`）、`subagent-triage`（经 `mat_exec` 只读远端取证）、`subagent-analyst`（无任何 mat 工具）、可续跑的 `subagent-shepherd`（独占一条计算链，deny 全部派生工具 + `maxDepth: 1`；注释记载 `maxDepth: 0` 意为"完全不能委托"的实测陷阱）。角色固定用更便宜的 `deepseek-v4-flash`，8K–16K token 上限。`contracts.ts` 三个裁决 schema（`prep-verdict.v1`、`triage-verdict.v1`、`interpret-verdict.v1`）用手写校验器（刻意不用 zod）；子代理文本必须过 `extractJson`（剥代码围栏）+ schema 解析，否则拒收并重试一次；证据上限 5 行 × 200 字符；跨字段规则强制（如 `retryable=true` 必须带 `retryPlan`；`converged=false && scientificallyUsable=true` 必须带 `concerns`）。

**收益**：权限靠引擎而非提示词约束（实测有效的缓解，不是请求）；"防止日志与散文灌入主会话"。规模轮实测主会话上下文节省 7–13 倍。

---

## 四、质量工程与运维类收益

### 10. 零 token 的会话取证与报告闸门

**位置**：`scripts/session-debug.ts`、`fold-child-usage.ts`、`stress-report-lint.ts`（各自带单测）

**机制**：`session-debug` 完全离线解析宿主 zstd 压缩会话日志：还原打包存储行（text/reasoning/tool-call chunks + delta 时间数组）为独立事件；检测序列空洞/重复/乱序、未配对的工具调用/结果、未闭合轮次、错误事件、从临时目录加载的过期技能根；计算每工具耗时；**打印前自动脱敏**（`sk-` 密钥、bearer 令牌、api-key 赋值、敏感对象键）；容忍活会话被杀留下的撕裂 zstd 帧（从部分 stdout 抢救完整帧）。`stress-report-lint.ts` 把压测 SOP 编译成检查器——缺收官要件（session-debug 汇总表、L0 异常证据、回滚判定、三类问题归纳）即错误退出 1，并交叉核对案例矩阵中每个会话 UUID 在汇总表中有行。

**收益**：自主测试轮的质量闸门零 LLM token 成本；系统提示词硬编码规则"没有 session-debug 汇总表的压测报告不算收官"——"绿了"必须附轨迹级证据，报告无法凑合。

### 11. 真实录制夹具的契约回放测试

**位置**：`packages/mat-core/test/contract/`（slurm/gaussian/efile 回放）+ `PROVENANCE.md`

**机制**：真实集群输出（含子行与 `CANCELLED by <uid>` 变体的 sacct、sbatch 信封、squeue 对 RUNNING 作业显示为空的行为、gaussian pre/run/post stdout）逐字转写为夹具，回放过解析器与完整 watch 管道；能量值 E=-76.4089539792 与 Python 时代交叉核对一致。`PROVENANCE.md` 标注每个夹具 real/synthetic、集群/日期/来源，并记录机械列裁剪适配器。共 64 个测试文件、489 项测试离线全绿。

**收益**：不花集群/LLM 预算锁住协议行为——解析器或管线的行为漂移直接红掉。

### 12. 一命令部署自检 + 4 步部署

**位置**：`scripts/deploy-check.ts`、`scripts/dsh-web.sh`；流程 `DEPLOY.md`

**机制**：`deploy-check.ts` 六项预检：本地依赖（node≥18、pnpm、curl——生产传输依赖它）、凭据存在性（只查 set，绝不回显值）、宿主仓库布局，以及**活体**往返：一条真实 MCP 命令走完整 exec-gate/exec-guard/三层重试栈、Slurm 分区可见性、远端 workflow/g16 环境探测（全部只读）。`dsh-web.sh` 提供 start/stop/restart/status：`setsid` 进程组管理、按端口反查孤儿进程（`ss -ltnp` → pid → 连 pnpm 父进程一起杀）、HTTP 健康门控启动、日志轮转。部署产物无绝对路径依赖（`MAT_DSH_ROOT`），换机位置无关。

**收益**：新机器部署 = 装依赖 + 填凭据 + 跑一条自检——本地→网关→集群→Gaussian 全链路问题在任何真实使用前暴露。

---

## 五、量化佐证（50 任务规模轮）

数据来自 `docs/evidence/scale-round/` 与 `docs/evidence/FINAL-SUMMARY.md`：

| 指标 | 数值 |
|---|---|
| 核时消耗 | ~2.7 核时完成 70 次 sbatch（50 任务几何微扰批） |
| 上下文节省 | 主会话 7–13 倍（子代理契约 + 外置 portfolio 清单） |
| 中断恢复 | 5 类中断全部零损失恢复 |
| 预算估算质量 | 估算 vs 实际核时偏差 6.51%（sacct 对账） |
| 测试规模 | 64 个测试文件，489 项离线全绿 |
| 收官判定 | K1–K7 判定全绿，含预算对账与自愈清单扫描 |

## 贯穿全库的工程模式

1. **依赖注入无处不在**（`execCommand`、`scheduleTimeout`、`FetchLike`、`CommandRunner`、`now`）——整个核心可离线单测，不需要真实集群凭据。
2. **对错误数据 fail-closed，对基础设施 fail-open**——串扰标记抛错，但文件锁异常放行（可用性），因为标记层兜底正确性。
3. **证据驱动注释**——几乎每个非常规常量都带 `docs/evidence/` 日期化事故/实验引用，代码库对"这个机制为什么存在"自文档化。
4. **昂贵的都回放，便宜的都检查**——录制夹具契约回放 + 快照测试替代默认闸门中的活体调用，活体测试是显式可选泳道。
5. **散文 SOP 背后有检查器**——stress-report-lint、sop-lint、deploy-check、check_environment.sh，每个 SOP 都有一个以退出码执法的工具，且多数工具自带单测。
