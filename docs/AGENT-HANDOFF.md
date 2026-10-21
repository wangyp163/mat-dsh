# mat-dsh 交接文档（AGENT-HANDOFF）

> **更新：2026-09-04。** 本文档面向接手本项目的其它 agent：目标是一份文件读完即可上岗——项目是什么、在哪、怎么跑、怎么验证、当前到哪一步、哪些雷绝对不能再踩。事实分两档标注：**【验证】**=本次整理时实测确认；**【记录】**=来自会话记忆/提交信息，未在本次重新实测。
>
> 阅读顺序建议：§1–§5 建立认知 → §6 验证门禁必读 → §8 雷区清单在动代码前必读 → §9 遗留事项决定下一步。

---

## 1. 一句话定位

**mat-dsh** = 基于 DeepSeek Harness（dsh，0.1.0-rc.8）的 HPC 科学计算 harness：本地 dsh 插件提供 skill / 工具 / 校验 / 结果解释与 artifact 同步策略，HPC 计算平面提供 workflow 商品、科学软件（当前主打 Gaussian）、集群适配与 Slurm 运行时。本地只发送结构与控制数据（pre.json/run.json/post.json），不上传 workflow 实现。当前主线是 **gaussian-calc skill 端到端可用 + 浏览器侧作业/文件/结构可视化面板**，并已完成 20 会话真实压测与多轮 canonical skill 吸收。

## 2. 位置与目录地图【验证】

```
~/mat-harness/
├── deepseek-harness/          # 宿主仓（dsh 0.1.0-rc.8，git@141eb6fef8）。⚠ 当前带未提交改动，见 §5.3
├── docs/superpowers/          # 设计 spec 与计划（specs/2026-08-27-mat-dsh-design.md 等）
└── mat-dsh/                 # 本项目（独立 git 仓库，无 remote，全部提交在 master）
    ├── packages/
    │   ├── mat-core/        # 核心库：传输/Slurm 解析/watch 循环/gaussian/efile/token/状态板/文件同步
    │   ├── mat-tools/       # dsh 插件（8 个模型工具 + 文件服务 + 状态板接线）
    │   └── mat-ui/          # 浏览器卫星插件（状态卡/任务面板/文件面板/查看器）+ 2 个 harmony 补丁
    ├── profiles/mat.yml     # web profile overlay（LLM 路由/插件/主题/自定义面板 slot）
    ├── skills/                # gaussian-calc（主 skill）、gaussian-demo-stress、session-debug
    ├── scripts/               # dsh-web.sh（服务运维）、build-mat-ui.mjs、session-debug.ts、probe/smoke
    ├── docs/
    │   ├── evidence/          # m0–m4、post-m0、gw-merge-stress（压测全套证据+工具）
    │   ├── mat-workflow-api-product.md   # HPC Workflow API 产品形态提案（目标态，非现状）
    │   └── AGENT-HANDOFF.md   # 本文档
    ├── env.local              # 凭证（gitignored，chmod 600，永不提交/打印/cat/echo）
    └── env.example            # 凭证模板
```

- **运行时数据**：`~/.local/share/mat-dsh/`（DSH_HOME；状态板 jobs.json、profiles/web 安装树、sessions 转录都在这）【验证：dsh-web.sh 内 DSH_HOME_DIR】
- **web 服务**：127.0.0.1:3080，`scripts/dsh-web.sh start|stop|restart|status`，日志 `/tmp/mat-dsh-web.log`，pid 文件 `/tmp/mat-dsh-web.pid`【验证】

## 3. 架构与产品边界

- **本地控制平面**（mat-dsh）：skill 引导、输入 schema、validator、声明式控制文件生成、结果解释器、artifact 同步策略（结构化结果+轻量重要文件本地化，checkpoint/波函数/轨迹 remote-only 按需同步）。
- **HPC 计算平面**：workflow 商品 + 科学软件 + 许可证 + 集群适配 + Slurm。Gaussian 命令链当前经 `RemoteWorkflowAdapter`（remote-shell 调远端 gaussian-workflow CLI）作兼容后端；HPC 正式 Workflow API 出来后换后端不动 skill/工具面（提案见 `docs/mat-workflow-api-product.md`）。
- **LLM 路由**：HPC 网关上的 deepseek-v4-pro / deepseek-v4-flash（1M 上下文，reasoningEfforts 显式声明），overlay 里 `llm-pi-ai` 行替换默认、插件行 insert；`deepseek-official` 路由也指向 HPC 网关【验证：profiles/mat.yml】。
- 集群主用 **11250（昆山 Agent0 队列）**；sacct/sinfo/sbatch/scancel 语义见 §4。

## 4. 代码面清单

### 4.1 模型工具（packages/mat-tools，注册名 mat_*）【记录+验证 README】

| 工具 | 作用 |
|---|---|
| `mat_exec` | 远程 shell（curl 传输三级容错；MAT_TRANSPORT=fetch 可切 fetch 传输 ~2s vs curl ~10s） |
| `mat_partitions` / `mat_sbatch` / `mat_job_status` / `mat_cancel` | 四薄工具：sinfo 五列 / sbatch 解析 / squeue→sacct 兜底 / scancel |
| `mat_job_watch` | **批量异步监控**：一次注册全部 job id，挂宿主后台作业（kind `mat-watch`），服务端自适应轮询 sacct（10/60/120/300s，poll_seconds 可封顶下限 10s），四路结算（全终态/超时/连续 5 次传输异常/取消），宿主自动投递完成通知；`job_kill` 只取消监控不动集群作业 |
| `mat_gaussian` | **一站式 Gaussian**：prepare→pre→run→sbatch 秒级返回 slurm id + 后台作业 id（kind `mat-slurm`）；COMPLETED 自动 post 并解析物性（energy/converged/frequencies/imaginary_count+files）；非 COMPLETED 跳过 post 带 log_tail；默认 B3LYP/6-31G(d)、32核/64GB、Agent0；多波组合不适用走分步。job_output 透传 result.json plots（压测 W1）；post error 壳拒绝透传（D4） |
| `mat_upload` / `mat_download` | 文件传输：首选 OpenAPI(AK/SK HMAC-SHA256→token→efile)，未授权自动降级 remote-shell 分块通道（512KB 块 gzip+base64，校验字节数原子替换） |

### 4.2 核心库（packages/mat-core）

传输（curl/fetch 双 transport）、`job-state.ts`（sacct 解析/终态/自适应档位）、`watch-loop.ts`（依赖全注入、`onAllSettled` 钩子）、`slurm.ts`、`gaussian.ts`（runGaussianSync/parsePostOutput/producer）、`token.ts`/`efile.ts`、`createStatusBoard`（实时状态板，浏览器只读 `/mat-status/jobs`）、file-sync-manager、workdir-resolver（四级：producer 推导→内存→remote-homes.json→exec 回填）。回放契约在 `test/contract/`（真实录制 fixtures，PROVENANCE.md 记来源）。

### 4.3 浏览器 UI（packages/mat-ui，卫星仓零改宿主源码）

- 状态卡（`conversation.input.dock` 轮询监控）+ 最近结算 turnTail + 7 个 HPC 工具 keyed toolview 表格；M4 输出管理（Thinking/ToolCall 隐藏/摘要/展开）。
- 三面板右侧栏：**任务**（TaskDetailsPanel 元数据规格卡/失败卡）/**文件**（FileManagerPanel 合并树+下载+SWR 缓存）/**查看**（ViewerPanel，vendored NGL：球棍/线框/填充/自转；POSCAR/xyz 转 CIF）+ 状态条悬浮钮（rail toggle）。
- **结构渲染改 NGL.Shape 自绘（09-24，OPTIMADE viewer 管线移植）**：`structure-model.ts` 自解析（POSCAR v5/xyz/cif → 晶格行向量+分数/笛卡尔位点）→ 共价半径 27 镜像 MIC 成键（`0.1 < d < (ri+rj)×1.2`，>1600 原子退化为纯球）→ 三 shape 独立透明度自绘：原子球 r=0.5 CPK 色（Jmol 表）不透明 0.9、键圆柱 r=0.075 灰 0.6、晶胞 12 棱 r=0.04 蓝 0.4（xyz 假盒不画）+ 跨胞键镜像端点原子去重补画。颜色必须 [r,g,b] 数组（hex 串崩 NGL 2.4.0）。工具条下加信息行（化学式+晶胞+位点/键数，OPTIMADE 同款）；三风格=球棍/线框（0.15 球+0.03 键）/填充（共价半径×1.25 按元素）。旧 CIF 管线（structureBody/poscarToCif）保留为兼容出口，输出逐字节不变（view-model 测试锚定）。
- **会话文件归档（按会话分档，09-27）**：会话分组（本会话/会话行）下先列**该会话归档的文件**再列作业目录（计数=文件+作业）。归属机制=订阅宿主 `session/event`（mat-tools apply，`ctx.on`）——`write`/`edit`（file_path）与 `mat_download`（local_path）的 `tool/call` 即记账；arguments 是 JSON 字符串，相对路径按 `session.header.cwd` 解析，cwd 外忽略；bash 内部命令产物 v1 不归档。台账 `SessionFileLedger`（file-service.ts）：`<MAT_FILE_ROOT>/session-files.json` 原子写，同路径后写者覆盖，加载 GC + 5000 条上限；根列表（path=''）响应附 `sessionFiles: Record<sid, paths[]>`（逐条 stat 过滤幽灵条目），子目录不带。客户端 FileManagerPanel 挑字段渲染归档行（点击走沉浸预览）；5s 轮询自动保鲜。既有会话可用 `npx tsx scripts/backfill-session-files.mts` 回填（已执行：117 会话/72 条）。**坑：宿主以 node strip-only 直跑 TS 源码，构造器参数属性（constructor(private …)）会让整个插件崩——字段必须显式赋值。**
- **工作区树自动保鲜（09-24）**：会话 cwd（工作区 scope）5s 轮询刷新根+已展开目录（纯本地 readdir；作业 scope 含远端 listing 不轮询，维持手动刷新）——agent 中途写入/下载的文件（如 matgen/optimade 下载的 POSCAR）无需手动刷新即出现在右侧文件树，点击即走沉浸 3D 预览。清单签名未变时跳过 setTrees，静止时零重渲染；改 client 包后浏览器刷新页面即生效（宿主按磁盘内容伺服 bundle，无需重启进程）。
- **窄视口右栏腾位（09-24）**：宿主三列求解链 侧栏≥280+中列≥640+右栏≥300，视口 <1220px 时右栏被 Step 3 自动收起且 openDetails 当帧被压回 0——右缘「展开任务面板」悬浮钮是死按钮（用户实证：窄窗口下"右侧栏看不到文件"）。修复：`layout-room.ts` 的 `openDetailsWithRoom(layout)`——读 AppFrame 内联轨道契约（与 rail toggle 同真相源），宽度不足且收侧栏（56px rail）可行时先 `toggleSidebar()` 再 `openDetails()`；接入三个入口（悬浮展开钮 / 状态卡「文件」/ 任务页「打开文件」，后两者由 index.tsx 注册点传 `ctx.layout`）。无头黑盒已验证 1100px 全链路：点展开→侧栏收到 56px→右栏 360px→文件树→POSCAR→沉浸 3D 画布。
- **宿主改动的两条路**（破坏"零改宿主"时的正路）：① harmony AST 补丁 `details-tab-reactivity.patch.cjs` / `turn-fold-compat.patch.cjs`（运行时打在宿主 bundle 上，宿主仓不动）；② 少数确需宿主源码的（DetailsPanel 附加 tab 行）直接改宿主仓 ui-conversation 并未提交携带——见 §5.3。
- 品牌位（09-04，锁定式）：mat-ui 占 `sidebar.brand.mark` + `conversation.hero.brand.mark` 渲染**黑色 HPC wordmark** 充当品牌名，`sidebar.brand.name` 只渲染 "Harness"，hero 文字为「科研Harness」（宿主鱼形 fallback 不再渲染）；详见 §5.2④。浏览器标签页标题仍是 DSH Local Build（`DSH_CLIENT_TITLE`，未动）。
- 主题：`theme.overrideTokens` 常开精修层，light/dark 成对；克制科研蓝、衬线标题、等宽数值 tabular-nums；控件全部用宿主 Button 变体（primary/outline，**弃用灰底 toolbar 变体**）。

### 4.4 skills

- **gaussian-calc**：主 skill，版本线 `0.7.12-demo`（本地续跳号避让 canonical 版本号）；吸收 canonical v0.7.5–v0.7.10 全部（门禁版本锚懒校验、newer_version 吸收、plots 直读契约、参数默认去路由键、过渡态 ts/qst2/qst3 三件套、压测行为增补、O1 资源档语义=pre.json resources 是作业资源档唯一来源、O2 阻塞式确认闸=等用户确认必须用阻塞式 question 禁文本收尾）。远端 workflow 版本锚 1.3.4。
- **gaussian-demo-stress**（v0.2.1）：压测编排 skill（含收口必跑 session-debug L0 轻扫）；0.2.1 起 description 载入中文触发词与收口红线摘要（SOP 固化第 1 层，见 §5.2⑥）。
- **session-debug**（v0.2.0）：session.jsonl(.zstd) 轨迹分析（读数时效：zstd 块延迟落盘≥15min、RPC projection 重启后冻结；TDZ 签名「返回层崩溃≠远端没跑」）。
- web profile 下 skill 靠 `$DSH_HOME/skills` 软链发现（customSkillDirs overlay 只对 headless 生效）【记录】

## 5. 当前状态（截至 2026-09-04）

### 5.1 已提交（master，HEAD=33e98ed，68 commits）【验证】

| 里程碑 | 日期 | 内容 |
|---|---|---|
| M0 | 08-27 | spike GO：curl 传输、mat_exec、overlay、端到端打通（08ccd06） |
| M1 | 08-28 | mat_job_watch 批量异步监控 + FetchTransport + web apiproxy 可编程驱动（57b7a0d） |
| M2 | 08-28 | 四薄工具 + mat_gaussian 一站式 + upload/download + 回放契约；三层基准交叉验证（9165e2a） |
| M3 | 08-28 | 实时状态通道 createStatusBoard + 浏览器监控卡/工具表格/主题（a43d987） |
| M4 | 08-31 | 输出管理（Thinking/ToolCall 显隐摘要展开）（40b401f）+ ModuleLoader CJS/挂载修复 |
| M6+M7 存量收口 | 09-02 | 门禁版本锚懒校验、newer_version 吸收、plots 消费契约、workflow-contract adapter、mat-ui 会话视图（3349504） |
| 压测 P/W 修复 | 09-02 | defaultPreJson 去 task 路由键(P4/P1)、job_output 透传 plots(W1)、producer 轮询默认封顶 30s(P6)；skill 0.7.9 |
| M9/M10/M11 | 09-02/03 | 吸收 canonical v0.7.8/0.7.9/0.7.10（过渡态三件套、压测行为、O1/O2）+ D8 混合模式 post log 名修复；workflow 1.3.2→1.3.4 |
| 压测 D1/D4 + M6–M8 存量落盘 | 09-03 | TDZ 缓解（微任务版）、post error 壳拒透传、workdir 解析器/预取/viewer/rail 存量入库；全仓 330 绿（6e57b08） |

（注：提交序列里没有显式 M5 标签；M6/M7 提交信息自称"存量收口"，即把工作树上已验收的量先落盘。）

**压测**：20 会话端到端真实压测已完成（2026-09-01，gaussian-calc v0.7.4-demo + gw-merge 合并代码），证据与可复用编排工具全套在 `docs/evidence/gw-merge-stress/`（SOP.md 方法论、sess.py/wave.py/watch.mjs/reflaky.py 编排、stress-table 结果表）。关键结论：门禁 20/20、三阶段+sbatch 全对、数值零幻觉；压测暴露的代码问题（D1/D4、P1/P4/P6、W1）已在上述提交收口。

### 5.2 未提交工作树（mat-dsh）【验证 2026-09-04 两次盘点】

**注意：本节清单在 09-04 当天内从 16 行增长到 32 行**（`git status --porcelain`），增量来自两摊，见 ④⑤。commit 前先重新盘点并按语义拆分。

以下 1–3 块为记忆中"第六/七/八轮"（2026-09-03 傍晚~晚，已部署已验收，未 commit），4 为当时记录的验证状态：

1. **一卡一 Slurm 作业（第六轮，数据模型重做）**：状态板键改为 `clusterId:slurmJobId` 确定性语义键——重复 watch/跨会话同键幂等合并；watch 条目 label=纯作业号（下拉即 job-id 可解析）；workspace=`<root>/<cluster>/<slurmJobId>`；每作业一张卡、逐卡按各自终态结算（COMPLETED→completed、CANCELLED→killed、其余→failed）。**TDZ 缓解机制整个消亡**（键不依赖宿主任务 id，run() 无闭包引用；6e57b08 的 queueMicrotask 方案被此取代）。
2. **板键冒号撞严格段校验修复（第七轮）**：`workspaceSegment(jobId)` 身份与目录解耦——listWorkspace 改严格身份绑定（段名白名单且 mappedRoot 全等），FileSyncRequest 增 `localDir`，enqueue/taskRoot/zip 文件名用段名；身份绑定必须锚定板键推导段，不能只看形态（relative() 结构校验放过同 cluster 其它作业目录，旧测试抓到）。
3. **右侧栏收尾（第八轮）**：删顶部"详情"标题与死按钮兜底 tab（宿主 DetailsPanel.tsx `!hasAdditiveTabs` 才渲染标题）；任务页红字失败块改 `stateOf(job)==='error' && job.detail!==undefined` 才渲染；打开文件按钮上移（footer 去 margin-top:auto）。
4. 记忆记录的验证状态：339/339（mat-dsh vitest）+ 467/467（宿主 ui-conversation）+ 双仓 typecheck，dsh-web.sh 已部署。【记录】本次重跑结果见 §6。

④ **浏览器品牌位（09-04 定稿锁定式 lockup；10-08 用户点名去除 HPC logo）**：品牌名只出现一次——~~mark 插槽的 wordmark 充当品牌名 HPC，文字只留限定词~~（lockup 的 mark 半边已撤）。
- 左上角 = **[宿主鱼形 mark] Harness**：`sidebar.brand.name` 只渲染 "Harness"（`src/client/Brand.tsx` + index.tsx 注入 + style.ts `.mat-brand-name` 镜像宿主 fallback 度量 17px/无字距/nowrap；package.json 增 ui-sidebar link 依赖与 inject 声明、pnpm-lock 随之；manifest.test.ts 期望清单同步）。宿主源码零改动，fallback（DSH Local Build + 构建号）不再渲染。
- ~~鲸鱼 logo → 黑色 HPC wordmark~~（10-08 撤销）：`MatBrandMark`/`logo-data.ts`/`mat-logo-black.png` 已删，`sidebar.brand.mark`（宽态+折叠 rail）与 `conversation.hero.brand.mark` 两处不再注入，回退宿主鱼形 fallback；style.ts 的 `.mat-brand-mark`（max-width 收缩 + 深色 invert）随删；brand.test.ts 反向断言守卫。
- 中间欢迎语 = **[宿主鱼形] 科研Harness ⟨预览版⟩**：`hero.headline` 是 locale 文案无插槽，宿主 `ui-conversation/src/client/locales.ts` 直改（zh：'科研Harness'，en：'Research Harness'），skeleton 测试断言同步——这笔属宿主有意携带（§5.3）；10-08 去 logo 时未动（原 HPC 前缀由 mark 提供，如需文字补回要再改 locale）。
- 09-04 bundle 均已重建部署（服务端实据：`/plugins/mat-ui/client.js` 含 logo data URL 与三个品牌插槽的 inject+register）；10-08 去 logo 后 bundle 已重建、vitest 856/856 绿、live 3080 端口 `/plugins/mat-ui/client.js` 实测 logo 字符串 0 命中且 `sidebar.brand.name` 注入仍在。浏览器标签页标题仍为 DSH Local Build（`DSH_CLIENT_TITLE` 默认，未在要求内，未动）；favicon 仍是宿主鲸鱼（web 前端资产，未动）。

⑥ **会话删除 + 文件面板本地删除（09-04 本会话，用户点名功能，已部署已验收未 commit）**：左侧会话行菜单新增「删除会话」（危险项，确认弹框含「同时删除会话文件」勾选默认勾选；保留文件语义=归档集隐藏+记账摘除）；右侧文件面板新增「删除」按钮+面板内确认条（仅删本地副本，`/mat-files/delete` 路由 + `deleteLocalFiles`）。涉及宿主仓 9 包未提交携带（apiproxy/workspace/session-persistence(+jsonl)/api-remotes/client-runtime/ui-workspace/test-support/测试假件，`session-active` 错误码新增，gateway 级 agent handle 保留 onHandle），宿主 bundle 已重建；验证中修 4 个顺序/竞态缺陷。证据：`docs/evidence/delete-feature/2026-09-04-session-and-file-delete.md`（含 live RPC 全场景矩阵）。本环境无浏览器后端，DOM 级未截图。

⑤ **并行会话增量（09-04 出现，非本会话产物，归属未确认）**：sacct 解析增 WorkDir 第 5 列（`mat-core` job-state.ts/watch-loop.ts + 对应测试 + 新 fixture `sacct-completed-workdir-5col.txt`——内容带当日真实集群路径 h3-qst3-0904r3 + PROVENANCE.md）；viewer 文本类增 jsonl（view-model.ts + 测试）；job-visibility/status-dock 测试扩充。改动自洽带测试，动前先问用户归属。

⑥ **SOP 固化第 1/2 步（09-04 本会话，已验收待部署）**：压测 SOP 去"每次先阅读"化的前两步——
- **常驻触发**：`mat-tools` 系统提示新增 `tool:mat-stress` 引导段（order 101，中文触发词+计划确认闸+session-debug 收口内核）；`gaussian-demo-stress` skill 0.2.1 description 同步载入触发词与红线摘要。**生效条件：web 服务重启**（09-04 重启时 `tsqst-stress-r4` 轮有在途 turn，按重启纪律未重启，留待轮次收口后 `dsh-web.sh restart`）。
- **工具化验收**：`scripts/stress-report-lint.ts`（`pnpm stress:report-lint <报告.md> [--json] [--strict]`）——§8.2 报告要件与 §6.7 收口变成检查器：缺摘要表/anomalies 证据/回滚判定、case 矩阵缺列、矩阵 session 未进摘要表等报 error 退出码 1；PNG 大小/数据行数缺失报 warning。配套 vitest include 扩到 `scripts/**/*.test.ts`（`stress-report-lint.test.ts` 11 用例 + `system-prompt.test.ts` 3 用例锁引导段红线）。
- **写回**：SOP §6.7 收口节与 skill 收口程序补 lint 机检步骤；后续新回归优先写成 lint 规则。
- 门禁：362/362 + typecheck 干净（含并行会话增量）。

⑦ **查看器沉浸全屏（09-04 本会话，用户三选一定稿 A 方案，已部署）**：侧栏详情栏宽度上限 520px（宿主 `ui-layout/columns.ts` 冻结常量，layout 服务只暴露 open/close 无调宽口），3D/图片/PDF/文本查看太挤——查看 tab 工具条加「放大」钮 → `viewerState.enterImmersive()` → `shell.overlay` 第二 occupant（`id: mat-viewer-overlay`，list 插槽多占合法）渲染全屏遮罩 + 大卡片（`min(1200px,92vw) × min(82vh,900px)`），ESC/点遮罩/「收起」钮退出。要点：
- `ViewerPanel` 拆出 `ViewerSurface({ variant: 'panel' | 'overlay' })` 共用主体，overlay 变体自挂 NGL Stage（数据本地重建秒级）；
- **NGL 自适应底座**：vendored ngl.js 零 ResizeObserver，容器尺寸变化不重设画布（rail 拖宽位图被 CSS 拉伸的老毛病）——Stage 创建后挂 `ResizeObserver → stage.handleResize()`，卸载 disconnect；
- 遮罩 `position:fixed` 叠在宿主 `.overlayLayer`（absolute/z-20/pointer-events:none）内合法；dialog 语义（role=dialog + aria-modal）但不做焦点陷阱（卫星插件克制）；
- 拒绝的备选：B 拓宽宿主 DETAILS_MAX（挤中心列+宿主携带改动）、C 浮动自由窗（实现重+z-index 冲突）、D 主列 zen 接管（宿主 view ring 无插槽只能硬凿）。
- 门禁：369/369 + typecheck 干净；服务端实据（14:28 实例复查）occupant/dialog 语义均在。**重启协调警示**：本会话当日三次 `dsh-web.sh restart` 均未先查在途压测轮（r5 波次 13:59–14:13 在途），幸事后 jsonl 显示轮次继续落盘未见中断；后续重启前先看 `sessions/` 最新 mtime 与并行会话在文档里的在途标记。

⑧ **任务页规格卡美化（09-04 本会话，用户圈元数据卡点名"按钮+字体美化"，已部署）**：`TaskDetailsPanel` 元数据值不再清一色 11px 打字机 monospace——**字体分型**：值默认无衬线 `500 12px/1.45`（"in progress"/"Agent0"/状态词），纯数值/ID 走 `dd--mono` 变体（11.5px 等宽 + tabular-nums，job id/能量数）；标签 9px→10px；卡 padding/圆角微调（7px→9px、8→10px）。**状态语义色**：`status`/`converged` 两行渲染宿主 `StateDot`（COMPLETED/RUNNING/FAILED→绿蓝红、converged yes/no→绿黄，含 COMPLETING/PENDING/TIMEOUT/OUT_OF_MEMORY/NODE_FAIL 映射），done 行绿字、error 行红字。**按钮**：「打开文件」走宿主 Button 原生 `icon` 位挂 `IconFolderOpen16`（仍不写插件元素选择器压宿主按钮模块类——§8 纪律不变）。旧字阶契约测试同步改写（`font:11px/1.4 ui-monospace` 全值覆盖 → 分型断言）。门禁 376/376 + typecheck；服务端实据 dd--mono/icon 槽/语义色规则在现役 bundle。**部署后曾误报"按钮损坏/tab 失响应"**——实为当日多次宿主重建触发的供应解析回退（见 §8 内存变换条目），与美化改动无关，二次 restart 已恢复。

⑨ **文件面板会话工作区模式（09-07 本会话，用户报"无作业时打不开本地工作目录"，已部署）**：原实现整面板 job 键控——无作业时树/下载/位置行全死。三层改动：
- **服务端真相源**：会话→cwd 从宿主持久化 `DSH_HOME/storages/session_projcache.json`（`tables.sessions.<id>.identity.cwd`）解析，**客户端只传 session id、绝不接受浏览器侧路径**（防任意目录读取）；session id 形态校验 `^session-[A-Za-z0-9-]+$`。
- **路由**：`/mat-files/tree|content|download` 增 `session` 参数分支——tree 走 `listSessionWorkspace`（纯本地树，`root` 绝对路径回传），content 直接读 cwd 下白名单文件（64MB 上限、nosniff、同 mime 表），download 走 `prepareLocalDownload`（不经同步记录直接打包，walk 与 prepareDownload 共用 `walkLocalFile`）；未知会话 404 `unknown-session`，穿越全拒。
- **客户端**：`FileManagerPanel` 无作业且有会话时进 session 模式——pseudo-key `session:<sessionId>` 驱动树缓存/预览/下载；位置行显示「本地工作目录」+ cwd（openWorkspace 可点）；能力面收敛：隐藏任务下拉（改"会话工作区"徽标）/删除/固定，保留刷新/下载/预览；`ViewerPanel.contentUrl` 对 `session:` 前缀目标改走 session 参数。作业出现时自动切回 job 模式。
- 门禁 404/404 + typecheck；live 实据：真会话（cwd=~/stress-run/abacus-dsh-r3）tree/content 200、未知会话 404、穿越 400。无扩展名文件（如 POSCAR_Si_diamond）预览报 unsupported 是**既有白名单行为**（客户端 classifyFile 同判），非本次缺陷。
- §8 增补：esbuild 对非 ASCII 字符串输出**大写十六进制转义**（`\u672C`）——grep 产物验证中文串时小写 hex 检索必漏，须宽松匹配或大小写不敏感。

⑩ **统一虚拟树（09-07 本会话，用户 brainstorm 四选一定稿 B 方案，已部署）**：⑨ 的"零作业才见会话工作区"过渡形态被取代——文件面板改为一棵树多 scope 共存：
- **scopeOrder**：会话工作区（`session:<id>`）固定首位 + 按板序各作业，末位=最新作业；scope 行是虚拟根（depth 0，`mat-files__row--scope`），点击展开/收起其子树（子树行缩进 +1）；会话子树纯本地、作业子树保留远端合并/同步徽章。
- **状态层**（file-manager-state）：路径级动作（toggleExpanded/selectPath/pin/unpin/beginExpand/removePaths/beginDownload/setPins）全部增可选 `scope` 参数（缺省=焦点 scope）；新增 `openScopes[]` + openScope/closeScope/toggleScope；`select/selectJob` 顺带展开目标 scope（跨面板联动：任务页"打开文件"直接展开作业子树）；snapshot 增 `scopes` 映射（每 scope 的 expanded/selectedPaths/pins）。
- **自动策略**（A 方案遗产）：初值聚焦末位 scope（最新作业，无作业→会话）；新作业首次出现自动展开+聚焦（seenRef 首轮只播种不触发），此后记住手动选择直到下一个新作业。
- **能力收敛**：选中按 scope 各自持有——下载聚合多 scope **逐个请求**（路由单 scope 限制的诚实呈现，状态行标注"跨 N 个范围"）；删除仅限**单一作业 scope**（会话/跨范围禁用并给原因）；固定仅作业子树；位置行按聚焦 scope 切换（会话=rootPath 即 cwd，作业=localWorkspace）；主要文件 chips 归属聚焦作业 scope。
- 验证：409/409 + typecheck；服务重启后 live 实据 scopeOrder/openScopes/toggleScope/scope 行类/seenRef/startsWith("session:") 全在 bundle，session tree 与 jobs 路由双 200。
- **再次踩中 §6 老雷**：模板串漏闭合反引号，字符串断言测试（只 readFile 不解析）+ mat-ui 不在 typecheck 范围 → 全绿假象，esbuild 一跑才炸。mat-ui 改动后**必须跑 build-mat-ui.mjs** 当解析门禁。

⑪ **状态板 settled 保留上限修复（09-07 本会话，用户报"时间久了 job 卡片/目录键消失"，已部署）**：实测磁盘 `mat-files/11250/` 下 **163 个作业目录、板上只剩 21 条**（=maxSettled 20+1 monitoring），**142 个目录成不可达孤儿**。根因链：核心 `createStatusBoard` 默认 `maxSettled:20`，settle 时按最旧裁内存板 → `onChange` 把**裁剪后**快照原子写回 `mat-files/jobs.json` → 持久层忠实记录丢失（持久化/恢复链路本身健康，重启 initialEntries 带 ownerSession 全量回灌已验证）。修复：tools 接线处显式 `maxSettled: 500`（≈27 天窗口 @ ~18 作业/日；monitoring 永不裁剪），行为测试锁"结算 25 个作业全量保留+重启恢复"。**遗留**：修复前已产生的 142 个孤儿目录 ownerSession 无法从 jobs.json 恢复（要恢复只能扫 session 转录反查 mat_sbatch 归属，session-debug 的 zstd 管道可复用——未做，等用户拍板）；孤儿目录本体在磁盘完好，不入板不影响新作业。

⑫ **"会话工作区"语义修正（09-07 本会话，用户指出共享单位是工作区非会话，已部署）**：projcache 实测——`~/workspace/test-mat-harness/molecules` 下 **28 个会话共享同一 cwd**、stress-run 26 个：宿主的共享单位是工作区，会话只是工作区里的会话。⑨/⑩ 的"会话工作区"命名撒谎了。修正：scope 行改标「**工作区 · molecules**」（root basename 进标签），kind 徽章 会话→工作区，作业行标签换正统 `jobOptionLabel`（纯 Slurm 号）；`session:<id>` 保留为线上键（服务端解析 cwd 的通道，防任意路径），但不再是身份语义。**设计真相**：平面 cwd 上的文件没有会话归属，工作区树天然是多会话共享视图（会话 A 准备的输入会出现在会话 B 的面板里——这是事实而非缺陷）；per-session 文件隔离的唯一惯例是 gaussian-calc 的每任务子目录。门禁 411/411；产物旧名 0 残留。

⑬ **三层树：工作区 → 会话 → 作业（09-07 本会话，用户点名层级，已部署）**：⑩ 的"工作区+作业平铺"改为按会话归属分组——共享 cwd 下"谁的作业是谁的"一眼可辨。
- **新路由** `/mat-files/workspace-sessions?session=<id>`：服务端经 projcache 反查同 cwd 的会话清单（`identity.cwd` 匹配；标题取 `rows.title.val`，createdAt 倒序）；客户端仍只传会话 id，不传路径。projcache 读取抽成 `readProjcache()` 与 `sessionCwdOf` 共用。
- **树形**：工作区（唯一顶层 scope，含其散文件）→ 会话行（虚拟，`会话 · 标题/短id`，本会话置顶带「本会话」徽章+作业计数；**无作业的其它会话不列**——28 会话共享一个 cwd，全列即噪声）→ 作业行（`ownerSession` 分桶，即原 job scope 嵌套一层）→ 作业文件子树（`entry.depth+3` 起）；无主作业进尾部「未归属会话」组；空会话行显示「无跟踪作业」。
- **默认展开**：挂载即开工作区+本会话行；聚焦最新作业不变；新作业出现自动开其作业 scope 并确保本会话行展开。会话行展开态是面板本地 `openSessions`（不入 fileManagerState——会话行不参与选中/能力面）。
- 注意：面板的作业数据从 jobsForSession 过滤改为全量 `jobs` 按 ownerSession 分桶（其它会话的作业在树里可见可展开可下载）；散文件仍只在工作区层（平面 cwd 无会话归属，§5.2⑫ 的边界不变）。
- 门禁 415/415 + typecheck + build 解析门禁；live 实据：workspace-sessions 返回同工作区 5 会话（4 带真实标题）、bundle 含新接线。**排序修订（同日用户反馈）**：会话行提升到工作区散文件**之前**（先看归属再看散件），契约测试锁块序（source indexOf 比较；注意 esbuild 会给遮蔽变量改名 `rows`→`rows2`，产物级校验别按源码标识符搜）。**插件发现机制澄清**：SPA index.html 以 rev 哈希引用 `mat-ui/client.js?rev=<hash>`（每次重建变）——"看到老版本"的第一嫌疑永远是旧 tab 未整页刷新（§8 老雷），服务端 no-cache 无 etag、刷新必得新。

⑭ **删除解禁：自由删除（09-07 本会话，用户点名"删除按钮依旧 job 驱动，应可自由删+确认"，已部署）**：
- **tools**：`deleteSessionFiles({cwd, paths})`——按 cwd 根删安全相对路径（与 listSessionWorkspace 同根同校验），deleted/missing 报告，无 pins 卫生（工作区文件不参与固定）。
- **路由**：`/mat-files/delete` 增 session 体分支（cwd 由 projcache 解析，客户端不传路径）；501 门放宽为两删除方法其一在位即可。
- **面板**：删除约束从「单一作业范围」解禁为**任意选中可删**——工作区散文件、跨范围混选都可；多范围按 `selectionsByScope` 逐个执行（失败即停保留现场）；**两段式确认保留**，文案升级为「作业范围为本地副本、远端不动；工作区文件为本地原件，均不可恢复」。job 删除的 pins 卫生/缓存失效逻辑不变。
- 门禁 419/419 + typecheck + build；live 实据：probe 文件真删（`deleted` 返回+ls 确认消失）、`../env.local` 穿越 400、未知会话 404。

⑮ **作业清单轮询修复（09-07 本会话，用户报"作业 running 但会话下一直显示无跟踪作业，点打开文件才出现"，已部署）**：根因不是 job 键机制而是**拉取时机**——`FileManagerPanel` 的 `/mat-files/jobs` 是挂载时一次性拉取（TaskDetailsPanel 一直是 5s 轮询）：面板在提交前挂载则 `jobs=[]`，「无跟踪作业」钉死；点任务页「打开文件」触发 tab 切换**重挂面板**才重新拉取——这就是"点按钮才加载出来"的假因果。修复：jobs 拉取对齐 5s `setInterval` 轮询（live=false + clearInterval 清理），新作业随之进入 `sessionGroups` 分组与 `seenRef` 自动展开链。产物校验注记：esbuild 把 `5_000` 编成 `5e3`，按源码字面 grep 产物必漏。门禁 420/420。

⑯ **查看器重设计：直开沉浸 + 同后缀翻阅（09-07 本会话，用户四选一定稿 A 极简导航条，已部署）**：
- **侧栏不再保留查看 tab**：`mat-view` details tab 注册整体移除（`ViewerPanel` 包装器随之删除，`ViewerSurface` 成唯一入口、默认 overlay 变体）；点文件 = `viewerState.open()` + `enterImmersive()` 直达全屏大画布（右侧栏此后只剩「任务」「文件」两 tab）。
- **同后缀导航**（tools）：`listLocalPeers(root, path)`——递归遍历 scope 根收同后缀（大小写不敏感；无后缀按"无点文件"组）**已同步本地普通文件**，字典序排序 + 当前项索引；符号链接/分块残件跳过，深度 16/条数 100 上限；当前项不在清单（已删/未同步）退化为单元素组。**为何服务端遍历**：前端树只有已展开目录的条目，未展开子目录的文件会被漏掉（live 实证：29 个 .xyz 含 `dehydro_runs/` 子目录三层）。
- **路由** `/mat-files/peers`：根与 tree/content 同源——`jobId` → 板键作业的 localWorkspace，`session` → projcache 解析的 cwd；未知身份 404 `unknown-scope`，穿越 400。
- **导航 UI**：overlay 工具条 `‹ i/n ›` 计数簇（宿主 Button outline + tabular-nums 计数），`←`/`→` 键盘翻页，首尾循环；翻页限本 scope（工作区的 .gjf 不会翻进作业输出）。清单取不到时静默退化为无翻页（导航是增益，不阻断预览）。
- 门禁 424/424 + typecheck + build；live 实据：molecules 工作区 `.xyz` peers 返回 **29 个（含子目录）index=26**、README.md 单元素组、bundle 内 `mat-view` tab 注册 0 残留且 peers 导航/ArrowLeft 在位。

⑰ **类型标签 chip 化 + 作业默认折叠（09-07 本会话，用户点名样式+默认不展开，已部署）**：
- **样式**：拆掉行首文字前缀 + 行尾 `kind-label` 徽章的重复表达（同 logo+文字教训）——改为**行首三色 chip**：工作区中性灰、会话品牌蓝、作业成功绿（均走 `--dsw-alias-*` 色板，8% 淡底+35% 描边）；**本会话**变体实心品牌蓝（白字）；`scopeLabel` 只出名字本身（不再拼「作业 xx」「会话 · xx」）。
- **默认折叠**：状态层新增 `focus(jobId)`（只改焦点不展开 `openScopes`），面板初值/新作业自动聚焦改用 `focus`——作业目录默认折叠，展开由用户点 scope 行触发；`selectJob`（任务页「打开文件」跨面板联动）仍顺带展开，语义不变。
- 门禁 427/427 + typecheck + build；产物实据：`mat-files__tag` 基类+三色变体+`--current`全在位、`kind-label` 0 残留、`focus(` 出现、面板内 `fileManagerState.select(` 0 残留。

⑱ **作业 chip 状态分色 + 入口定位居中（09-07 本会话，用户点名，已部署）**：
- **分色**：`jobTagTone(job)` 四态——running 蓝（RUNNING/PENDING/COMPLETING 或 phase≠settled）、failed 红（FAILED/CANCELLED/TIMEOUT/OUT_OF_MEMORY/NODE_FAIL 或 outcomeStatus failed/killed）、done 绿（COMPLETED）、idle 中性兜底；**取值优先 sacct 实时 state，再退板上终态**——live 实据里存在 `slurm=FAILED` 但 `outcomeStatus=completed` 的作业（壳成功而计算失败），实时态优先判红才是诚实语义。`FileManagerJob` 类型补 `slurm`（路由一直在回传，之前类型漏声明）。
- **定位居中**：状态卡「文件」与任务页「打开文件」都走 `selectJob`（已顺带展开），新增焦点 scope 展开后 `scrollIntoView({block:'center', behavior:'smooth'})`——长树里不再"展开了但看不见"；锚点用树容器 ref + `[data-scope]` 查询（不用全局 querySelector）。
- 门禁 429/429 + typecheck + build；产物实据四色变体/scrollIntoView/center/treeRef 全在位；live 判定核对：板上 41 作业 → 27 绿 / 12 红 / 2 蓝。

⑲ **下载/同步双动作：本地工作树落点补全（09-07 本会话，用户指出"下载不进工作树而是进本机下载目录"，四选一定稿 A，已部署）**：
- **诊断实据**：① 原「下载」走浏览器 `<a download>`（createObjectURL），文件直通本机下载目录、服务端不落盘——用户判断正确；② 本地工作树**真实存在**于 `DSH_HOME/mat-files/<cluster>/<jobId>/`（实测 289 个作业目录、134 个非空、967MB），由**按需物化**（预览触发 materializeFile）自然积累；③ 真正的缺口是**没有主动同步入口**——`/mat-files/sync` 路由早就在（工具面用），但 UI 从未接过；④ 作业镜像与用户工作区（cwd）是两个物理位置，作业结果不会自动出现在工作区。
- **双动作**：「**同步到本地**」（primary，把选中远端文件拉进该作业的本地镜像，完成后清 scope 缓存+重载让徽章从「远端」翻「本地 + 远端」）+「**导出**」（outline，原下载语义改名，明确是导出到本机）。同步仅对作业 scope 可用（工作区本身即本地，禁用理由「工作区文件已在本地，无需同步」）；跨范围时逐 scope 同步。
- **路由适配**：sync 原只吃远端绝对路径（工具面语义），新增相对路径分支——按 `job.workdir` 拼绝对再走原 `remoteRelativePath` 校验，`..`/空/NUL 拒绝；绝对路径老调用不变。
- 门禁 434/434 + typecheck + build；**live 端到端实据**：选一个本地镜像为空的真实作业（11250:121477070），POST sync 两个远端文件 → HTTP 202、两条 `status=completed`、`ls` 确认文件真的落进 `mat-files/11250/121477070/`（测试残留已清理）。产物实据 syncSelection/sync 路由/中文文案/禁用理由全在位（中文按 esbuild 大写转义形态核对，§8 老雷）。

⑳ **翻页失灵修复 + 本地镜像路径可见可复制（09-07 本会话，用户报障，已部署）**：
- **翻页失灵根因**：`ViewerOverlay` 的 peers effect 在目标切换时先 `setPeers(undefined)` 再异步重取——导航簇（`peers.length > 1` 才渲染）在这一拍**整簇卸载**，视觉上就是"点了没反应"（数据侧一直正确：live 核对 `g16_initial.xyz` index=0/2、`g16_optimized.xyz` index=1/2）。修复：重取期间**保留旧清单**，新数据到达再整体替换。诊断教训：先验服务端数据（peers 返回正确）→ 再查渲染层卸载条件，比逐层读状态机快。
- **本地镜像路径**：新增 `/mat-files/localpath`（根与 tree/peers 同源：job→localWorkspace、session→cwd；回传 `root`/`localPath`/`exists`，客户端仍不传路径根）。沉浸层工具条下方新增**路径条**（等宽、`direction:rtl` 省略号截左保尾、title 全文）+「复制路径」按钮（1.5s「已复制」回馈）；侧栏位置行同步改为**点击即复制**（原 openWorkspace 在 WSL 下必炸，§8 老雷）+ title 全文 + 「已复制」提示。
- 门禁 436/436 + typecheck + build；live 实据：两个 .xyz 的 localPath 准确且 `exists=true`、peers 索引正确翻转；产物实据 localpath 接线在位、`setPeers(undefined)` 0 残留、路径条/复制文案全在。

㉑ **结构翻页死画布修复（09-07 本会话，用户报"翻页数据不更新+3D 卡住"，已部署）**：**根因**——React 复用同一 `<div ref={containerRef}>`（无 key），NGL `stage.dispose()` 只销毁实例、**不回收它注入容器的 canvas 与事件层**；翻页后旧死画布盖住新画布（画面停在旧分子）且截走鼠标事件（3D 卡死）。修复双保险：① 清理函数 dispose 后 `containerRef.current.replaceChildren()` 显式清残留；② 容器改带 `key=ngl-${jobId}-${path}`，目标变化即整棵子树重建（React 复用节点的老坑）。**路径条顺带修**：上一轮用 `direction:rtl` 做省略会把开头的 `/` 甩到行尾（截图 `/g16_initial.xyz/` 即此副作用），改 JS 头部省略（`…`+末 71 字符，完整值在 title）。诊断经验：翻页类"画面不动"先查**是否 DOM 节点复用**，再查状态/数据。门禁 438/438；产物实据 replaceChildren/ngl-key 在位、rtl 0 残留。

### 5.3 宿主仓（deepseek-harness）现状 ⚠【验证 2026-09-04】

`git status` = **48 个改动文件未提交**（46 M + 2 untracked）。分两摊：

- **mat-dsh 造成的（有意携带）**：`packages/client/ui-conversation/`（DetailsPanel 附加 tab 行 + `.header[data-with-tabs]` 样式 + `src/client/details/` untracked 目录 + `tests/details-tabs.client.spec.tsx` untracked；09-04 起再加 `locales.ts` 两处 hero.headline 与 `tests/skeleton.client.spec.tsx` 断言同步——品牌文案，见 §5.2④）。bundle 需在 **harness 根**跑 `pnpm --filter @deepseek-ai/dsh-client-ui-conversation bundle`（在 mat-dsh 目录跑会 "No projects matched" 静默不建）。
- **非 mat-dsh 的改动**（filesystem 文档、`.agents/notes`、`packages/fs/tool-str-replace-editor`、`scripts/gen-cordis-catalog.ts` 等）：来源不是本项目会话，**动它们之前必须先与用户确认**。

> 早期"宿主仓必须 git status 为空"的硬门禁已被上述有意的宿主补丁路线取代；但仍禁止把宿主仓改动随手 commit 或 reset。

## 6. 验证门禁（声称完成前必跑）

```bash
# mat-dsh 全量（在 ~/mat-harness/mat-dsh）
pnpm test                 # = vitest run（⚠ 不要加 --reporter=basic，vitest 4 已移除该 reporter，会 ERR_LOAD_URL 假失败）
pnpm typecheck            # = tsc -b && tsc --noEmit -p scripts

# 宿主 ui-conversation（若动了宿主侧；在 harness 根跑）
npx vitest run packages/client/ui-conversation   # 467/467 基线【验证 2026-09-04】
pnpm --filter @deepseek-ai/dsh-client-ui-conversation bundle    # 在 harness 根跑！
```

> ⚠ **`pnpm --filter @deepseek-ai/dsh-client-ui-conversation test` 是空跑**：该包 package.json 没有 `test` 脚本，pnpm 退出码 0 且无任何输出——看起来绿了其实什么都没跑（本文档旧版误记为门禁，09-04 实测戳穿）。宿主包测试的 scoped 跑法就是上面的 `npx vitest run packages/client/<pkg>`。

- 09-04 两次实跑 mat-dsh 门禁：早间 **339/339 + typecheck 干净**；品牌改动并入工作树后（含并行会话增量，§5.2⑤）**346/346（51 文件）+ typecheck 干净**。
- 宿主 ui-conversation：**467/467**（含品牌文案断言更新后复跑）。
- ⚠ 误跑警钟：本次曾因并行调用导致 shell cwd 漂移，在宿主仓跑了 `npx vitest run`（14266 测试、406s）——结果是 **15 failed / 14136 passed**（失败含 WorkspaceAnalyzer 等用例，归属未查证，可能来自宿主仓非 mat-dsh 改动，见 §5.3）。mat-dsh 相关门禁以本仓 + 宿主 `--filter @deepseek-ai/dsh-client-ui-conversation` 为准；跑测试前先 `pwd` 确认在 mat-dsh。
- **mat-ui 不在 typecheck 范围**（根 tsconfig 只 references mat-core/mat-tools；client TSX 仅 esbuild 无类型门）——源码字符串断言型测试抓不到运行时 DOM 问题（#17 首版就是这样漏过的）。
- 浮点断言用近似比较（vitest `toBeCloseTo`/近似），重 IO 用例显式加 `, 20_000` 限时（满载并行下 512KB 传输用例曾超默认 5s）。
- 测试假件必须镜像生产同步调用序：jobs.start 假件要**先 `input.run()` 后赋 id**（与 jobs-local 逐行对齐）——旧假件 `queueMicrotask(()=>input.run())` 恰好掩盖 TDZ 33+ 次。

## 7. 硬纪律

1. **凭证**：`env.local` gitignored、chmod 600，只 `set -a && source env.local && set +a`，**永不提交、打印、cat/echo**。凭证键：LLM_API_KEY/LLM_BASE_URL/LLM_MODEL_ID、MAT_MCP_KEY、MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER。
2. **证据保真**：证据文档粘贴原文/命令输出自洽、退出码内嵌；声称完成必须看到全绿输出；live 验证记录真实 URL/字节数/状态码。证据按 `docs/evidence/<阶段>/日期-主题.md` 归档。
3. **轻量 TDD 默认**：🔴 先写失败测试并确认看到失败 → 🟢 最少代码过 → 🔵 重构；没有失败测试不写实现。commit 命令勿写 `测试 | 管道 && git`（吞失败码），用 `测试 && git` 或 `set -o pipefail`。
4. **宿主边界**：优先零改宿主（卫星仓/harmony 补丁）；确需宿主源码改动要有用户验收背书并保持未提交携带；禁止 commit/reset 宿主仓。
5. **skill 版本纪律**：本地 skill 版本续跳号避让 canonical（0.7.12-demo）；canonical 有新版先吸收再谈别的；远端 workflow 版本锚（env_profile.sh WORKFLOW_VERSION=1.3.4）与 skill 门禁声明必须同步。
6. **压测 prompt 只表达科学意图**（不含命令/路径协议），每 prompt 全新会话+独立 workdir，判定权在评审者（数值必须与集群 result.json 对账防幻觉）。

## 8. 雷区清单（动代码前必读，全是真金白银换来的）

### 集群/传输
- **squeue 对 RUNNING 常返回空**（PENDING 可见）——作业状态一律 **sacct**（`sacct -j id1,id2 -P -n -o JobID,State,ExitCode,ElapsedRaw`；过滤 `.batch/.extern` 子行；ExitCode 取冒号前；scancel 后过渡态 COMPLETING 原样透传）。
- Node 原生 fetch 对 mcp-gateway.example.internal 默认配置可用（无需 -k/禁代理），但 fetch 不把 406 变退出码——换传输必须补非 2xx 显式检查（已实现）。
- remote-shell 单次输出上限 **1,048,576 字符（1MiB）**——分块 512KB（base64 ~700K 安全）+ 每块独立 gzip 流；exec/解压失败一次性回退纯 base64。
- 树外插件依赖用 `link:` 绝对路径指向宿主 workspace（npm 上 dsh-tools 是 stale 0.0.1-rc.1）。

### dsh 宿主语义
- 宿主 jobs 服务 `start()` **同步**调 `spec.run()`、`id` 返回后才赋值——run() 内闭包引用 id 必 TDZ（历史根因；语义键模型已根治，但新后台作业工具仍要遵守"run() 内不引用宿主任务 id"）。
- JobOutcome.status 只有 completed/killed/failed 三值；readOutput 是增量流语义；kind 靠 `declare module '@deepseek-ai/dsh-jobs'` JobKindMap 合并注册；宿主默认 waitTimeoutMs=30s——web 验收主路径用**通知驱动**（提交即收尾→通知后读一次），不要让模型就地 `job_output wait:true` 长阻塞。
- SKILL.md frontmatter description 裸标量含 `: ` → YAML 解析失败整 skill 静默 skip，必须整体加引号。
- 忘带 DSH_HOME 会读到坏的 `~/.dsh/.credentials.yaml` 而拒启——统一走 dsh-web.sh。

### 浏览器/构建验证
- **dsh-web.sh restart 会切断 SSE**：旧 SPA tab 保留旧模块图，验收前必须**整页刷新**。
- **宿主包是 harmony 内存变换后供应的，磁盘文件永不带补丁标记**（09-04 事故：tab 全死）。验收宿主侧改动必须 curl `/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js` 验供应内容——验「工作区构建在位」（改过的 locale 串）+「补丁已注入」（`useDetailsState`、`__matDshTurnFoldIsUnsettledToolNode` 标记），只验 mat-ui 会漏。harmony 启动时先建模块图、后修 `profiles/node_modules/@deepseek-ai/*` 共享库链接（指向工作区），**宿主重建后的第一次 restart 可能仍供应旧解析副本，二次 restart 才干净**（09-04 实证：16:07 relink、16:33 二次重启恢复）。诊断入口：transform.js 的 `applySourcePatch` fail-closed 会静默跳过补丁；比对供应 bundle 的标记即可定位。
- 浏览器 bundle 真实 URL 是 `/plugins/mat-ui/client.js`（无 query 也 200）；`/mat-ui/client.js` 是 SPA 兜底 HTML（~15.8KB），拿它验内容会误判"旧 bundle"。
- **esbuild 会把单引号改双引号、JSX 属性编译成对象属性**（`variant:"outline"` 带空格），且**非 ASCII 字符串转义成大写十六进制**（本地工作目录 → `\u672C\u5730…`）——grep 部署产物验证时用宽松/大小写不敏感正则，按源码字面或小写 `\u` 形态搜都会漏判（09-07 实证：中文串三连漏判，险误诊"构建丢代码"）。
- 观察带 CSS 过渡的宿主属性（如 frame 轨道 0.3s grid-template-columns 过渡）**必须读内联 style 目标值**，getComputedStyle 在过渡期间读到的是起点旧值且不再发变更事件。
- 需要 DOM 锚点但组件可能渲染 null 时**不能用自身 ref**（死锁：ref 永远 null）——用 `document.querySelector('[data-shell-overlay]')?.parentElement` 这类宿主层唯一锚。
- 插件元素选择器（`.mat-x button`，特异度 0,1,1）会压过宿主按钮 CSS 模块类（0,1,0）——换宿主 Button 变体时必须删自己的按钮元素选择器规则，布局约束改挂包装 div。
- NGL（vendored）：无 xyz 解析器（xyz 也转 CIF）；最小 CIF 分支 gates 要求 `_symmetry_space_group_name_H-M` 旧式标签与 `atom_site_occupancy` 列**必须存在**（缺了崩 `t[i] is undefined`）；cif 解析器会把边界邻像原子真加进 atomStore（跨胞键完整、边界原子是晶体视图惯例）；`setDefaultAssembly('UNITCELL')` 是可证 no-op，勿再加。笛卡尔坐标转 CIF 伴随阵=余子式阵**转置**。headless 探针法：UMD 先 `global.exports={}`+`global.module`，`new NGL.ParserRegistry.get('cif')(TextStreamer).parse()` 结果本身就是 Structure。

### 诊断方法论
- 宿主源码读不出的运行时行为，**直接看磁盘实据**（jobs.json 的 ownerSession 分布、sessions 目录、session.jsonl.zstd 首行 cwd）比继续读源码快。
- 最小 cordis 探针（tsx 起 Context+两插件直查）二分定位 skill/插件问题。
- session 轨迹分析用 `pnpm session-debug`（scripts/session-debug.ts）；注意 zstd 块延迟落盘 ≥15min、RPC projection 重启后冻结——下结论前双源确认。

## 9. 遗留与待办

1. **efile 授权（唯一长期遗留）**：AK/SK/user 一直在场；真实阻塞是账号 6 集群 token 全空 + efileUrls=0 → efile 服务未开通（token API 鉴权本身已通，HMAC-SHA256 与 Python 向量对齐；错误路径 live 验证过 `cluster 11250 returned an empty token`）。**账号授权后回填真实 fixtures 即闭环**。
2. **未提交工作树待 commit**（§5.2 三块，已验收已部署）：建议按语义拆 commit；commit 前跑 §6 门禁。
3. **P2 已知未做**【记录】：openFile 静默 no-op 提示（部分已改报错）、jobs effect stale-snapshot race（部分已修）、远端列表 >100 截断。
4. **宿主仓非 mat-dsh 改动**（§5.3）归属未明，动前问用户。
5. **Workflow API 提案待 HPC 侧**：`docs/mat-workflow-api-product.md` 是目标态提案，等正式 API 后换 RemoteWorkflowAdapter 后端。
6. **远端通道串扰本侧已修（2026-09-04），服务端根因未修**：exec-gate（同 (密钥,集群) 全实例串行 + 跨进程文件锁）+ exec-guard（token 标记校验，串扰可检测可重试）已进 `mat-core`（`docs/evidence/post-m3/2026-09-04-exec-channel-crosstalk-fix.md`）。当日数据追偿已闭环：S3 乙醇丢失 job id 找回（120898931，瞬态失败后被 120900192 取代）；S2 甲醇/乙烷 post 确认会话自愈（远端 result.json ok）。服务端反馈稿 `docs/evidence/post-m3/2026-09-04-mat-server-feedback.md` 待提交 HPC，回复后在压测轮验证关闭。
7. **图像模型已切 BigModel glm-5.3-flash（2026-09-04）**：HPC 网关 deepseek 双模型对 image_url 静默丢图（实测）。`profiles/mat.yml` bigmodel 段 + 用户 settings.yaml 双源声明（zai thinking 格式、`supportsReasoningEffort: true`、effort 档 low/high/max **不含 off**——GLM-5.3 系关思考直接 400、input 含 image）。**密钥 `BIGMODEL_API_KEY` 尚未填入 env.local**；填后跑 `pnpm tsx scripts/probe-bigmodel.ts` 四项验证再重启 dsh（profile 改动须重启生效）。

## 10. 深入文档索引

| 主题 | 路径 |
|---|---|
| 设计 spec | `docs/design/superpowers/specs/2026-08-27-mat-dsh-design.md` |
| M0 spike 计划/判定 | `docs/design/superpowers/plans/2026-08-27-mat-dsh-m0-spike.md`、`docs/evidence/m0/m0-verdict.md`（含 M1 backlog） |
| 各里程碑证据 | `docs/evidence/{m0,m1,m2,m3,post-m0}/` |
| 压测全套（SOP+工具+结果） | `docs/evidence/gw-merge-stress/`（README.md 起步） |
| Workflow API 提案 | `docs/mat-workflow-api-product.md` |
| 里程碑叙事（M0–M2 细节） | `README.md`（M3 之后看 git log 与 evidence） |
| 相邻项目 | vasp-matstream-dsh（同模式先例，`~/mat-harness` 外的另一 harness 仓） |
