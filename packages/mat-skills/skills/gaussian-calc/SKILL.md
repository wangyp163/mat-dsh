---
name: gaussian-calc
# description 禁半角冒号（技能开发指南 frontmatter 纪律）：裸标量遇 "冒号+空格" 会被 YAML
# 解析器拒掉、整个 skill 静默跳过——2026-08-28 e2e 排障定位，值里改用括号列举。
description: Use this skill for Gaussian 16 calculations through the calcflow-based gaussian-workflow CLI (sp, opt, freq, dipole, polar, tddft, fluorescence, resp, ts, tsxtb, qst2, qst3, irc, aea) and valid task compositions such as opt+sp, opt+freq, ts+irc and tsxtb+ts+irc. Generates Gaussian inputs, uses HPC tools to execute pre/post commands, upload files, submit and monitor Slurm jobs, and retrieves results.
version: 0.7.37-demo
metadata:
  adapted-for: mat-dsh
  source: ~/other-projects/vasp-matstream-agent/skills/debug-gaussian-calc@0.7.1-demo
  adaptation: 2026-08-28 将 mat-command-executor/mat-job-manager/mat-chat 的职责全部映射到 mat_exec；未随包 tests/ 与 scripts/check_skill_contract.py（其断言针对上游 SKILL.md 原文）；2026-08-28 M2 增补「一站式路径（mat_gaussian）」节与 mat_upload/mat_download 文件通道；2026-08-31 M3 门禁 heredoc 落盘模式 + 门禁黑盒/registry 探针禁令 + 一站式 job_output 终点收口（session c9d00865 排障）；2026-08-31 M4 rm/rm -rf/mv 全局用户确认 + 一站式/分步重试 workdir 语义（session f4f3d916 排障）；2026-09-01 M5 冗余精简：删 demo 直连节、协议判定旧协议史、快速定位部署配方；2026-09-01 M6 吸收 canonical v0.7.5 门禁版本锚（deployed/expected/newer_version），门禁改懒校验：远端常驻 .gaussian-calc/scripts 直达、heredoc 降级为播种/刷新（scripts/ 随包同步 canonical 并新增 env_profile.sh）；修正 bootstrap 命令块本机路径 bug；sinfo 输出 legend + 决策树 fallback 措辞修正；版本 0.7.7 为避免与 canonical v0.7.6（plots 契约，本血脉未含）撞号；2026-09-01 M7 吸收 canonical v0.7.6 plots 消费契约（result.json `plots` 数组：图+绘图数据两类路径报告、`image=null` 降级、无键向后兼容），速查表/一站式例外/决策树三处落地，配套远端 workflow 升 1.3.0（双 wheel force-reinstall + VERSION 锚，env_profile 三副本同步）；版本 0.7.8 续跳号；2026-09-02 M8 压测问题修复：默认 pre.json 去 task 路由键（路由身份由 task 决定，workflow 侧同步剥离异 task 键并升 1.3.1）、job_output 直读 plots（保留 result.json fallback）、producer 轮询默认封顶 30s（job_output 是轮询快照、完成通知才是终态权威）、一站式节内联纪律（不手动 squeue/sacct、不读 log 原文点名 grep/awk/sed/tail、task 即计算范围）；版本 0.7.9；2026-09-03 M9 吸收 canonical v0.7.8 过渡态搜索三件套（ts 补 freq 路由 + qst2/qst3 多帧 xyz 输入：structure/上传文件可含多帧、恰 1/2/3 帧语义、原子序号逐位一致、ts+irc 组合、imaginary_frequency_count equals=1 验收），配套远端 workflow 升 1.3.2；版本 0.7.10 续跳号避让 canonical v0.7.8；2026-09-03 M10 吸收 canonical v0.7.9 压测行为增补（多帧缺失禁历史补帧 C6、一站式崩溃先对账再分步收尾禁改 gjf D1、诊断实验收敛 diag/ 子目录 + 产物尺寸约束、重跑同名额删除边界）+ run 幂等新语义（命令段不一致整体重写、ulimit -c 0，D3/D2 配套 workflow 1.3.3），env_profile 三副本同步 1.3.3；版本 0.7.11-demo 续跳号避让 canonical v0.7.9；2026-09-03 M11 吸收 canonical v0.7.10（资源档语义 O1：resources 是作业资源档唯一来源、自建 pre.json 必填否则结构化报错、一站式内置默认档仅在不传 pre_json 时生效；确认闸必须阻塞式 question 禁文本收尾 O2——队列编排会越过文本等待点），配套远端 workflow 升 1.3.4（D8：post log 名从 phase state 解析，json pre + legacy post 混合模式不再找 g16.log），env_profile 同步 1.3.4；版本 0.7.12-demo 续跳号避让 canonical v0.7.10；2026-09-04 M12 吸收 canonical v0.7.13 分步链同模式纪律（D9：no-json pre 接 json run 的 no pre phase state 是契约报错、no-json run 为本地执行语义，集群分步只有全程 json 相位或 no-json pre 产物直接提交；l101 Wanted an integer 双空行布局签名禁手改 gjf 掩盖），description 去半角冒号（frontmatter 纪律），配套远端 workflow 升 1.3.5（D9 修复：空 extra 归一 None 杜绝空 route 行），env_profile 同步 1.3.5；版本 0.7.14-demo 续跳号避让 canonical v0.7.13；2026-09-04 M13 吸收 canonical v0.7.14 IRC 产物契约（irc_profile 升级为 Total energy along IRC 曲线——符号化反应坐标 path 1 正/path 2 负/TS=0、Link-123 逐点解析末次 SCF 为点能；新增 reaction_path R→TS→P 阶梯图 kcal/mol 垒高、IRC 分支端点+point 0 数据源、单向 irc 跳过语义；irc_point_count 属性；qst2+irc/qst3+irc 组合认证），配套远端 workflow 升 1.4.0（irc 专用解析器 read_irc_points + 两图渲染），env_profile 同步 1.4.0；2026-09-04 M14 配套远端 workflow 升 1.4.1（D10 修复：read_irc_points 改真实 g16 逐点能量关联——每点能量取「本点 header 之前」的末次 SCF Done，point 0 取 TS 初始 SCF、无 NET REACTION COORDINATE 行，修复前对真实 log 必抛 OutputParsingError/能量错位一格；真实 log 冒烟为放行依据，合成 log 冒烟废除），版本 0.7.17-demo 续跳号避让 canonical v0.7.14；2026-09-04 M15 三会话取证（S1/S2/S3 随机三分子 TS+IRC）配套五条指引：xyz 元素列纯元素符号（编号标签 1.4.2 起 VALIDATION_FAILED、更早裸 KeyError）、charge/mult 电子数奇偶硬校验（奇电子必须偶数 mult，pre 拒绝并给建议值）、IRC 默认路由勘误 irc(CalcFC,MaxPoints=30,StepSize=10)（1.4.2 起）+ l123 处方（StepSize=5,MaxPoints=50 整体值覆盖）、残留失败 job.log 新语义（1.4.2 run 视为上一波未完成，warning + 自动重渲染重跑，不再阻塞）、路由自身键整体值覆盖须带核心 token（加 MaxCycle 要重复完整值，丢 QST2/TS 1.4.2 起 warnings 点名）；2026-09-07 M15 配套远端 workflow 升 1.4.3（D18：dipole/polar/tddft post 落结构化物性 dipole_moment_debye/polarizability_*_au/excitation_energies_ev，消费侧直读 properties 禁 grep log；D19：resp 依赖预检具名报错 + formchk 自 GAUSSIAN_ENV_SCRIPT 推导并 source g16 环境执行（裸调段错误）+ Multiwfn 走 run_tool + json 模式任务身份参数 extra/chk 自动注入——1.4.2 及以前 json 静默丢弃致 resp 必挂；D16 残留：phase 层透传 calculator warnings 进 result.json；scf 键透传确认正常——r7 S5 误判澄清），env_profile 同步 1.4.3；版本 0.7.19-demo 续跳号避让 canonical v0.7.16；2026-09-07 M16 吸收 canonical v0.7.17/v0.7.18：过渡态方法选择指引（ts 默认/qst2 仅两特例/qst3 不主动引导，用户点名 qst2/qst3 才采纳——sobereva/460）+ tsxtb GFN2-xTB 初猜层（g16 external 网关：opt(TS,CalcFC,NoEigenTest,Nomicro)，无 freq 融合、post 只报 energy/converged/scf_convergence 无虚频计数，定位只产初猜几何；tsxtb+ts+irc 三波链不支持一站式；json 模式 method/basis 由 task 强制接管；集群 xtb 二进制在 environment/ 或 PATH），配套远端 workflow 升 1.5.0 + REQUIRED_TASKS 守门 + environments.yaml 治愈（r7 漏更 1.4.2→1.5.0），env_profile 同步 1.5.0；版本 0.7.20-demo 续跳号避让 canonical v0.7.18；2026-09-08 M17 配套远端 workflow 升 1.5.1（D21 修复：组合推进区分 stale log 与正常终止但解析失败——后者 warning 点名具体异常并置 needs_review，不再诱导重提循环；tsxtb 不收敛签名识别——步数超限/l9999 收尾猝死分类报错 + convergence_trace.csv 诊断导出 + kb:ts-step-limit 条目引用）+ references wiki M0 骨架（INDEX/errors/methods 三血脉字节一致：ts-step-limit、ts-convergence，签名可 grep + frontmatter schema；知识检索协议入正文），env_profile 同步 1.5.1；版本 0.7.21-demo 续跳号避让 canonical v0.7.19；2026-09-08 M18 配套远端 workflow 升 1.5.2（D22：producer 对非 COMPLETED 终态执行诊断性 post——error 全文进 job_output 的 diagnostic_post 行（含 kb:<id> 与诊断产物名），作业终态权威不变，log_tail 兜底；D23：组合 pre 同 task 同参数幂等保留已就绪波——中断链 pre+run 一次推进 frontier，改参全量重建）+ 续跑 runbook 入正文，env_profile 同步 1.5.2；版本 0.7.22-demo 续跳号避让 canonical v0.7.20；2026-09-08 M19 mat_job_watch 新增可选 label 参数（分步 watch 卡片与一站式 job 同形态「gaussian <task> @<cluster> #<jobid>」，D24 收口——r10 观察/r11 复现的裸 jobid 混排）；skill 补注册用法；版本 0.7.23-demo；2026-09-08 M20 吸收 canonical 0.7.21——IRC 知识条目（errors/irc-l123-divergence：l123 corrector 发散三级梯进 StepSize 减半→CalcAll→Steep 最速下降兜底；methods/irc-methods：sobereva/400 IRC 方法学+参数语义+端点精修），源自真实会话 4bd8fec0 甲醇脱氢 IRC 三连败取证（StepSize 与 CalcAll 均只让死亡点后移）；正文处方行升级为条目引用；版本 0.7.24-demo；2026-09-08 M21 Step 3 run 配方内联 export GAUSSIAN_ENV_SCRIPT（mat_exec 每命令新 shell、export 不跨命令持久——真实会话 4bd8fec0 取证每会话首跑必撞 JSON run requires GAUSSIAN_ENV_SCRIPT 白费一次往返；一站式路径不受影响，runPhaseCommand 本就内联导出）；版本 0.7.25-demo；2026-09-08 M22 组合多波循环插入「每波终态先 post 再结构化门检」（b497c3f4 实证：agent 把 post 留到链尾、中段手搓 Frequencies grep 与几何 diff 找虚频——违背结构化消费契约；门检 = converged + imaginary_frequency_count==1 才许接 IRC，incomplete 警告波间属预期；同步 canonical 0.7.23 同款协议）；版本 0.7.26-demo；2026-09-08 M23 tsxtb 引用义务入节（gau_xtb 作者要求：Tian Lu, gau_xtb: A Gaussian interface for xtb code, http://sobereva.com/soft/gau_xtb，accessed 填实际日期；报告 tsxtb 结果主动附引用——同步 canonical 0.7.24）；版本 0.7.27-demo；2026-09-08 M24 配套远端 workflow 升 1.6.0（R1 诊断-重试目录树：attempts 归档+台账+att 标题行+trace/geometry_changes 导出+tsxtb 官方 gau_xtb 1.0.1 切换——环境 environment/gau_xtb/ 部署、%nprocshared=1 pin、OMP=resources.ncores），env_profile 三副本同步 1.6.0；版本 0.7.28-demo2026-09-08 M25 配套远端 workflow 升 1.6.1（波次交接物化：resume-pre 遇「上一波 log 正常终止+下游 pending+g16_optimized.xyz 缺失」幂等执行该波 post 物成交接产物——真实会话 26ba62e0 取证 tsxtb 完成后 91 秒空窗内 agent 检查产物扑空、误判 frontier 停滞并手工重建 xtb 几何；frontier 推进仍归 run，改参重建/stale 场景不触发），env_profile 三副本同步 1.6.1；版本 0.7.29-demo（原 R2 文案轮顺延 0.7.30/M26）。；2026-09-09 M26 R2 文案轮：诊断-重试协议节（diag/契约+submitted 台账回写+对账协议+同参 pre 双语义）+ 过渡态输入要求前置披露表（缺料必问禁静默编结构）+ 门禁优先强化（r13 S2 跨轮产物不得诱发 pre-gate 取证）+ kb 新增 errors/ts-l103-formbx（Tors failed→FormBX 内坐标崩塌）+ ts-step-limit 处方决策表化 + 三条目处置回写指针（同步 canonical 0.7.25，references 六件字节一致）；版本 0.7.30-demo。；2026-09-09 M27 配套远端 workflow 升 1.6.2（盲区收口：input_digest 换输入重建 / log-predates-input 拒推进拒物化 / tsxtb opt 身份钉 / geometry 0.01 阈值 / g16_trajectory.xyz 导出 / 帧数结构化错误），env_profile 三副本同步 1.6.2（canonical env/demo 副本上轮漏更 1.6.1，本轮直跳补齐）；版本 0.7.31-demo。；2026-09-10 M28 配套 workflow 1.6.3——热化学十键消费文档（freq 系 task）+ VALIDATION_FAILED 第三签名（payload 路径按 cwd 解析落空，禁未核对绕行）+ tsxtb 网关守卫签名（xtb FAILED 取代 PGFIO 解读），env_profile 同步 1.6.3；版本 0.7.32-demo（自有线 +1，仍避让 canonical 0.7.26）；2026-09-18 M29 D0 P2 确认闸硬化：mat_gaussian 增加 CONFIRM_REQUIRED digest 协议（投影原样转述→阻塞式确认→带 confirmed_digest 同参重调；确认前零集群副作用；confirmation_gate='off' 仅限同会话已批准同配置的应急回滚）——配套 mat-core/confirmation.ts 投影与摘要、mat-tools 接线及五例测试；版本 0.7.33-demo；2026-09-19 M30 R1+R2：①确认闸用户话术定名「计算参数摘要」（R1——投影为内部机制名不进用户可见文本，压测 S1 曾把「投影摘要」漏进标题）；②排队状态可见性（R2）——状态板相位细分 queued/running（提交即 queued、sacct 全 PENDING=queued、任一 RUNNING/COMPLETING=running）、mat_gaussian producer 在 PENDING→RUNNING 跃迁且排队≥60s 时经 owner.followup 推一次性「已开始运行（此前排队 Ns）」会话通知、系统提示补排队语义（提交后静默通常是排队非故障）；版本 0.7.34-demo；2026-09-20 M31 硬约束落地轮（审阅表 R1-R6）：①波间门检机制化——mat_task_build 编译产物按 digest 落盘（MAT_FILE_ROOT/task-packages/），mat_sbatch 新增 wave_gate 参数（提交前自动校验前序波已结算且过门，不过抛 GATE_FAILED 零集群副作用，M22 从纪律升级为工具强制）；②attempts 台账自动记账——mat_sbatch 新增 attempts_ledger 参数（提交成功自动补 submitted 行，替代手工 echo 义务）；③KB 处方结构化——errors/ 三条目 frontmatter 新增 prescription 键（有序梯 {level,route,when} / 决策行 {match,route}），kb-sync 同步入 kb 表新列，失败环 kb_hint 直接携带梯级内容；④多波链代码循环——新增 mat_pipeline_start/status/resume 三工具（mat-core pipeline.ts 状态机 + driver：逐波 run→sbatch→watch→post→门检、处方梯自动换档、梯尽自动死信、模糊诊断 needs_llm 唤醒会话——「波内绝不结束回合」类 shepherd 纪律由机制取代）；⑤批量侧——portfolio-cli update 负裁决（prep ok=false / interpret scientificallyUsable=false）拒绝推相位（NEGATIVE_VERDICT，V9 教训收口）、mat_sbatch/mat_gaussian 相位闸（manifest 存 pending 任务即 PHASE_GATE_REJECTED，Phase B 零集群硬约束）；版本 0.7.35-demo；2026-09-22 M32 新账号引导轮：hpc-user-a 账号死亡（旧 HOME 已删），HPC 凭证整体换 hpc-user-b（AK/SK + 新 MAT_MCP_KEY，通道=remote_shell_execute @cluster 11250，ssh demo 直连永久退场）；配套远端 workflow 1.7.4 全新 HOME 部署（public v1.0.0 conda-pack 基座 + 双 wheel force-reinstall + VERSION 锚 + g16 bootstrap + environment/{Multiwfn,xtb,gau_xtb} 三资产），env_profile 同步 1.7.4；efile 上传协议勘误——path 字段为目标目录（文件名取本地名），单文件 >8M 需分片；版本 0.7.36-demo；2026-09-23 M33 环境门禁机制化（constraint-decoupling A 批）：新增 mat_env_gate 工具（mat-core/env-gate.ts 三态判定 pass/fail/seed-needed + mat-tools 进程级注册表 (宿主进程,集群,引擎)+12h TTL），mat_sbatch/mat_gaussian/mat_pipeline_start/mat_pool_start 四入口门禁未过即 ENV_GATE_REJECTED（零集群副作用）；门禁从 per-session 散文纪律升级为进程级机制事实——batch 子代理自动继承主会话门禁；应急开关 MAT_ENV_GATE=off / MAT_ENV_GATE_MAX_AGE_MS；本节 43 行散文缩至 28 行并改为引用工具闸（判据权威迁入 packages/，散文降为投影）；版本 0.7.37-demo
---

# Gaussian 工作流

## 产品边界：本地 skill 与 HPC 远端 workflow

本 skill 是本地 dsh 插件的一部分，负责理解用户意图、校验并生成声明式的 `pre.json`/`run.json`/`post.json` 控制数据，以及解释 `result.json` 和 artifact manifest。Gaussian workflow 的执行包、软件环境、许可证和 Slurm 运行时属于 HPC 一侧的商品，**不得把 workflow 源码或执行包上传到远端**。本地只提交结构与控制输入，并调用 HPC 上已部署且有版本契约的 workflow；当前 `mat_gaussian` 的命令式路径是该远端 workflow 契约尚未提供统一 API 时的兼容适配器。

计算完成后，优先把结构化结果和轻量 artifact 同步到本地；大型 checkpoint、波函数、轨迹和中间文件只保留远端映射，除非用户或 Agent 明确按需同步。skill、schema、validator、结果解释器和 HPC adapter 可以独立随 dsh 插件版本发布，不等同于远端 workflow 执行包。

## 环境激活（先读）

执行任何命令前，先激活环境。本 skill 涉及**两个互相独立的环境、两个不同的 `env.sh`，激活命令不同，不要混淆，也无需定位 `g16` 可执行文件路径**：

| 环境 | 作用 | 激活方式 |
|---|---|---|
| **workflow_env**（Python） | 提供 `gaussian-workflow` 命令，跑 pre/run/post | 登录节点执行 `source $HOME/workspace/demo/env.sh` |
| **GAUSSIAN_ENV_SCRIPT**（g16 runtime） | 让 Slurm 作业内能执行 `g16` | `export GAUSSIAN_ENV_SCRIPT="$HOME/workspace/g16-hy/scripts/env.sh"`（需先 bootstrap，见下） |

要点：

- **workflow_env 在登录节点 source**：每条 `gaussian-workflow -p ...` 命令前都要 `source "$workflow_env"`（同一 shell 内 source 一次即可；新 shell / 新会话需重新 source）。`source` 后 `gaussian-workflow` 即在 PATH，无需另设 `PYTHONPATH`、无需上传源码。
- **无需定位 `g16` 的可执行文件路径**：`g16` 由 `GAUSSIAN_ENV_SCRIPT` 激活，**仅**在 `run` 生成的 `slurm.sh` 作业内 source；agent 永不在登录节点执行 `g16`，也不必去找 `g16` 二进制位置——只要 `GAUSSIAN_ENV_SCRIPT` 指向 bootstrap 后的 env.sh，其余交给 Slurm。
- 首次使用前先 bootstrap g16 用户副本：`bash <GAUSSIAN_CALC>/scripts/bootstrap_g16.sh`（详见下文「环境与部署」）。
- 两类环境**不可互换**；集群环境定位表、bootstrap 细节、协议判定见下文「环境与部署」。

当前 `gaussian-workflow` 基于 `calcflow`，已注册 task：

```text
sp            单点能
opt           几何优化
freq          分子振动频率与热化学（非周期 phonon）
dipole        偶极矩
polar         极化率
tddft         TDDFT 激发态
fluorescence  荧光激发态/光谱
resp          RESP 电荷
ts            过渡态优化（初猜结构 + 频率验证）——过渡态默认方法
tsxtb         GFN2-xTB 过渡态初猜层（g16 external 接口，只出几何不出结论）
qst2          QST2 过渡态搜索（反应物+产物，两帧输入）——仅特例场景，用户点名才用
qst3          QST3 过渡态搜索（反应物+产物+TS 初猜，三帧输入）——不主动引导，用户点名才用
irc           IRC
aea           绝热电子亲和能（多步）
```

也支持顺序组合 DSL，例如 `opt+sp`、`opt+freq`、`ts+irc`（IRC 消费 TS 的优化几何）。每个原子 task 必须已注册，组合不得含空项、重复项或未知项；最终结果 JSON 的 `task` 回显完整 DSL 字符串。`freq` 用于分子振动频率计算，不实现周期性 `phonon`。过渡态**默认用 `ts`**——`qst2` 仅特例、`qst3` 不主动引导，用户明确提出 `qst2`/`qst3` 才采纳，初猜不足先用 `tsxtb` 预优化（选择指引见「特殊 task」节）。`ts`/`qst2`/`qst3` 使用**多帧 xyz 单文件**输入，约定见「特殊 task」节。

所有集群操作统一通过 `mat_exec` 工具完成（在目标集群登录节点执行 shell 命令）。它是 JSON 参数工具，不是 shell 命令：调用形态为 `mat_exec({"cluster_id": "11250", "command": "<shell 命令>", "timeout_seconds": 30})`；下文代码块里的 `command` 值原样传给远端 shell。

- **破坏性命令必须先经用户确认**：任何 `rm`、`rm -rf`、`mv`（删除、覆盖或挪走既有文件/目录），以及清空 scratch、清理历史 workdir 等，**无论出现在哪个环节**（故障排查、磁盘空间不足、重试前清场）都一律先把目标路径列给用户、取得确认后再执行；未确认前只报告建议、不动手。非本会话创建的目录一律视为他人数据，同样不得自行删除。
- 环境门禁：`mat_env_gate` 工具（**第一条业务命令**，四个提交工具的硬前置）。`bootstrap`、workflow `pre/post`、只读检查：`mat_exec` 直接执行对应命令。
- 查询集群/队列（sinfo）、写输入文件（heredoc/cat）、提交 Slurm（sbatch）：同样经 `mat_exec`。
- **提交后的作业监控用 `mat_job_watch` 异步批量监控**：一次注册全部 job_id，不要手动 squeue/sacct 轮询（见"提交和监控"节）。
- **选项齐备的单作业计算优先 `mat_gaussian` 一站式**：一次调用完成输入落盘→pre→run→sbatch→监控→自动 post（见"一站式路径"节）；分步链路用于交互确认、多波组合与诊断。
- 需要读取集群上的文件时：`mat_exec` 执行 `cat`/`tail` 取回内容；需要把文件落到本机时用 `mat_download`（efile 通道，需 MAT 凭证环境变量），上传用 `mat_upload`。

HPC 凭据由工具管理，本 skill 不记录密码、AK/SK、服务器地址。

## 环境门禁（第一条业务命令）

门禁已机制化为 `mat_env_gate` 工具闸：`mat_sbatch` / `mat_gaussian` / `mat_pipeline_start` / `mat_pool_start` 在门禁未通过时一律以 `ENV_GATE_REJECTED` 拒绝（零集群副作用），不必也不应再手搓门禁脚本命令。一次通过按 (宿主进程, 集群, 引擎) 缓存 12 小时——batch 子代理自动继承主会话门禁，不要每个任务各跑一次。

```bash
mat_env_gate({"cluster_id": "{cluster_id}"})
```

- **通过**：返回 `env gate PASS version=… protocol=… tasks=N` 摘要；本次会话不再查找环境或阅读源码，直接进入队列选择和计算。带 `newer_version` warning 时把该提醒**原样转告用户**（不影响通过，由用户决定是否升级期望）。
- **`ENV_GATE_REJECTED`**：立即停止，只按返回的 errors 报告缺失项；不得搜索源码、猜测 fallback 或提交作业。错误是 `g16_env_missing`/`g16_unavailable` 时可按本文 bootstrap 指令修复一次，然后只重跑门禁。版本漂移（`version_mismatch`/`version_unpinned`）说明「本文档 vs 实际部署」已不一致，先对齐再执行。
- **`ENV_GATE_SEED_NEEDED`**：脚本缺失或代数旧（判据在工具层：`SCRIPT_NOT_FOUND`、schema 非 `gaussian-env-gate.v2`、或缺 `deployed_version`/`expected_version`/`newer_version` 字段）。唯一动作是按下方播种步骤 heredoc 落盘后重跑门禁，**不是**降级为手工逐项检查环境。
- 需覆盖默认路径时传 `workflow_root` / `g16_home` 参数。

**门禁是黑盒**：判定一律以工具返回为准。不要读脚本内容来理解它检查什么（`--help`、python 探针、`inspect.getsource` 都算违规探测），也不要用 python 探针自查 task registry——task 注册是 `import gaussian_workflow` 的副作用，裸 `from calcflow.task.registry import list_tasks` **恒返回 `[]`**，据此判定"部署缺 task"必然误判。task 集只能信门禁返回的 `tasks`/`missing_tasks`。

**播种/刷新（罕见路径）**：`mat_upload` 依赖 MAT 凭证不能作主通道，heredoc 是唯一无凭证内容通道。read 取本机 `<GAUSSIAN_CALC>/scripts/` 两个文件全文（仅为原样传输），heredoc 落到 `$HOME/workspace/.gaussian-calc/scripts/` 后重跑 `mat_env_gate`：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": "mkdir -p $HOME/workspace/.gaussian-calc/scripts && cat > $HOME/workspace/.gaussian-calc/scripts/env_profile.sh <<'GATE_EOF'
<env_profile.sh 全文，原样粘贴，不改一行>
GATE_EOF
cat > $HOME/workspace/.gaussian-calc/scripts/check_environment.sh <<'GATE_EOF'
<check_environment.sh 全文，原样粘贴，不改一行>
GATE_EOF
echo SEEDED", "timeout_seconds": 180})
```

门禁脚本只做无副作用检查，不运行 `g16`、不提交 Slurm；`required_tasks` 是 skill 要求的公开 task 集，`missing_tasks` 是运行时实际缺失的 task（任何 `missing_tasks` 都会使门禁不通过）。

## 最小决策树

为避免重复探测、重复上传和无必要的报告生成，按以下顺序执行：

1. 调用 `mat_env_gate` 一次；它已经合并 workflow env、CLI、import、协议、registry 和 g16 runtime 检查，且未通过时四个提交工具会直接拒绝。不要再逐项探测，也不要先阅读源码猜测运行时能力。
2. 任务能力必须与部署一致：skill 声明支持 `freq` 时，若 registry 缺少 `freq`，立即停止并报告部署版本漂移，不能静默改用旧实现。
3. `opt+freq` 必须使用公开的 composition DSL；不得退化为 `-t opt` 加隐藏的 `calculator_kwargs.freq` route hack。只有用户明确要求兼容旧部署时，才可说明该差异，不得自动执行 fallback。
4. 结构或配置文件上传前先做一次远端存在性和内容校验；若共享文件系统已可见，跳过上传，不重复复制。
5. 计算完成后从 `result.json` 获取结构化结果（properties、status、warnings、files、plots）；可可视化任务把 `plots` 的图与绘图数据路径一并报告；只有用户明确要求正式报告时，才生成额外 Markdown 报告。
6. 队列查询只需一次 `sinfo`。若输出不完整，使用一次明确的只读 fallback（如 `scontrol show partitions`），仍无法确认时交给用户选择，不循环尝试。

## 执行模型

生产集群的 phase 生命周期由外部作业管理器串联：

```text
pre → run → mat_exec 提交（sbatch）→ mat_job_watch 批量异步监控 → post
```

- `pre`：读取结构和可选 `pre.json`，生成 Gaussian 输入及 task-local state；不提交作业，也不报告最终物性。
- `run`：读取 state 与可选 `run.json`，仅生成或更新 `slurm.sh`；**不在登录节点执行 `g16`**。
- `mat_exec`：提交（sbatch）已生成的 Slurm 脚本；集群检查、文件操作也经它。
- `mat_job_watch`：把本轮全部 job_id **一次**注册为后台批量监控（服务端自适应轮询 sacct，无模型请求），全终态后收到会内完成通知。注册时带 `label: "gaussian <task> @<cluster_id>"`（如 `gaussian irc @11250`）——状态板卡片与一站式 `gaussian <task> @<cluster> #<jobid>` 同形态，多波/多 task 对账不混淆。
- `post`：验证 Gaussian 正常终止和任务所需收敛，解析完成的输出并返回结构化结果，同时写入 `{work_dir}/result.json`（`calcflow.result.v1`）。
- **分步链全程同模式（D9 纪律）**：跨 phase state（`.calcflow-phase.json`）只有带 `--json pre.json` 的 pre 才写，带 `--json run.json` 的 run 强制读取——no-json pre 接 json run 必然报 `no pre phase state`（契约报错，非缺陷）；而无 `--json` 的 run 是**本地执行语义**（在当前节点直接跑 `g16`，不经 Slurm），生产集群不可用。集群分步只有两种合法形态：① 全程 json 相位（pre.json → run.json → post）；② no-json pre 出产物后**跳过 workflow run**、经 `mat_exec` 补齐 `slurm.sh` 提交。中途换模式必须从 pre 重跑整链，不得拿旧产物续跑。

Slurm 脚本中的计算命令仍是：

```bash
g16 < input_file > output_file
```

不依赖 `g16_run.sh`、Apptainer、SIF 或外层 `srun`。Gaussian 并行由输入文件 `%nprocshared` 控制。

## 一站式路径（mat_gaussian，选项齐备的单发计算）

上述链路逐步走 `mat_exec` 的形态适用于需要逐步确认/核查的交互流程。当**任务类型、结构、工作目录、（可选）分区与参数覆盖都已确定**，且属于**单作业形态**（单步 task 或 `opt+freq` 单作业组合）时，优先用一站式工具 `mat_gaussian`，一次调用覆盖 prepare→pre→run→sbatch→监控→post：

```json
mat_gaussian({
  "cluster_id": "11250",
  "task": "opt+freq",
  "structure": "3\n\nO 0.000000 0.000000 0.117790\nH 0.000000 0.757160 -0.470790\nH 0.000000 -0.757160 -0.470790\n",
  "workdir": "$HOME/workspace/h2o-run1",
  "partition": "kshcnormal",
  "options": {"max_wait_seconds": 3600}
})
```

- **前提**：环境门禁已通过且 g16 已 bootstrap（与分步链路同一条门禁，见上文）；一站式命令使用与本 skill 相同的 `workflow_env`/`GAUSSIAN_ENV_SCRIPT` 默认值，可用 `options.workflow_env`/`options.g16_env` 覆盖。
- **确认闸（digest 协议，0.7.33 起）**：`mat_gaussian` 首次调用（不带 `confirmed_digest`，或参数已变导致摘要过期）返回 `CONFIRM_REQUIRED` + **计算参数摘要**（方法/基组/电荷/多重度、核数内存、分区/节点/任务数/walltime、预估核时）+ digest，**零集群副作用**。处置三步：① 把摘要**原样转述**给用户——向用户呈现时标题用「计算参数摘要」（**不得出现「投影」字样**，那是内部机制名），数字必须来自返回的摘要、禁止重新手打（抄写即篡改，用户签的字必须与提交的参数一致）；② **阻塞式**等待用户明确批准（O2 语义：选项带推荐与风险说明，禁"若无异议我就提交"式文本收尾）；③ 批准后**同参重调**并带 `confirmed_digest` = 返回的 digest。用户要改参数 → 改完重走闸（摘要随参数变化，旧 digest 自动失效——这是特性不是故障）；仅当用户已在**同一会话内明确批准过完全相同的配置**时，才允许 `options.confirmation_gate: 'off'` 免闸直提（应急回滚通道，禁作常规路径）。
- **参数默认**：pre.json 默认 B3LYP/6-31G(d)、charge 0/mult 1（闭壳层基线——奇电子体系必须改偶数 mult，见 pre.json 节奇偶硬校验）、32 核/64GB，**不含任何 task 路由关键字**——opt/freq/td/irc 等路由身份由 `task` 参数唯一决定，`pre_json` 携带的异 task 路由键会被 workflow 剥离（1.3.1+）；run.json 默认 kshcnormal/1 节点/32 核/00:30:00/64GB。需要不同方法基组或资源时，经 `options.pre_json`/`options.run_json` 传**完整** phase 配置（结构同上文 pre.json/run.json 节；注意 `resources.ncores ≤ slurm.ntasks_per_node`、`resources.memory ≤ slurm.mem` 校验仍生效；task 自身路由键可在 JSON 中精调选项，如 `-t opt` 传 `"opt": ["Tight"]`）。
- **硬警告：显式构造 `pre_json` 时，路由键要么不写，要么只写 task 自身键且写全（JSON 值整体替换默认 route，不与默认叠加）**。两层机制要分清，后者与远端部署版本无关：
  - **异 task 路由键**：workflow 1.3.1+ 会剥离 `pre_json` 里不属于当前 task 的路由键（opt/freq/td/irc/polar/force/scan）；但 **<1.3.1 的已部署集群没有这层剥离**，异 task 键直接混入 route——`-t tddft` 被 JSON 里的 `opt`/`freq` 混成 `opt freq td` 三合一（压测 P4 实证）。
  - **task 自身路由键**：以 JSON 为准，**任何 workflow 版本都如此**。`-t ts` 的路由键就是 `opt`（默认 `opt(TS,CalcFC,NoEigenTest) freq`）、`-t irc` 就是 `irc`（默认 `irc(CalcFC,MaxPoints=30,StepSize=10)`，1.4.2 起 MaxPoints 30、此前 5）——在 `pre_json` 里写普通 `opt`/`irc` 走的是自身键精调路径，1.3.1 的异 task 剥离**不拦**，结果是把 TS/IRC 语义**静默掩蔽成普通 opt/irc**。1.4.2 起 workflow 会对「丢了 QST2/QST3/TS 核心 token 的自身键覆盖」在 `warnings` 里点名提示，但那是最后防线，不要依赖。
  - **处置**：`ts`/`qst2`/`qst3`/`irc`/`aea` 的 `pre_json` **一律不写路由键**（自身键 JSON 权威本是精调机制，对这几个 task 是坑）；`opt`/`freq` 等要精调时只写 task 自身键且**写全**——JSON 值是整体替换不是叠加，只想加 `MaxCycle` 也必须重复完整值，如 `-t qst2` 传 `"opt": ["QST2","CalcFC","MaxCycle=100"]`（`ts` 用 `["TS","CalcFC","NoEigenTest","MaxCycle=100"]`）；只传 `["MaxCycle=100"]` 会把 QST2/TS 身份整个顶掉、退化成普通 opt。路由身份只由 `task` 参数决定，调用侧不感知远端部署版本，按此写法两层风险都不沾。
- **返回即离手**：工具返回 slurm job id 与后台作业 id 后本轮即可结束；后台 producer 服务端轮询 sacct（无模型请求），**终态后自动执行 post 并解析**，会话内收到完成通知。
- **组合链中断续跑（workflow 1.5.2 起）**：同参数直接重跑 `pre` 再 `run` 即推进 frontier（pre 幂等保留已就绪波，context 记 resumed）；改参自动全量重建；备选 standalone 等价路径（如 `irc` 单任务，输入=上游 `g16_optimized.xyz`+上游参数）。
- **过渡态搜索（`ts`/`qst2`/`qst3`）的 `structure` 是多帧 xyz 字符串**：`ts` 一帧（TS 初猜）、`qst2` 两帧（反应物+产物）、`qst3` 三帧（反应物+产物+TS 初猜）——帧序 = 分子节序，各帧原子数与元素序号逐位一致，元素列必须是纯元素符号（`H1`/`O1` 编号标签 pre 直接拒：1.4.2 起 VALIDATION_FAILED、更早裸 `KeyError('H1')`），帧数或序号不符 pre 直接结构化报错。会话内按 `原子数\n注释\n坐标行\n` 逐帧拼接成 `structure` 值即可（heredoc 原样落盘 molecule.xyz，workflow 多帧读取）；`ts`/`qst2`/`qst3` 属单作业形态，可走一站式。post 报 `frequencies_cm-1`/`imaginary_frequency_count`，一阶鞍点确认由验收 `{"imaginary_frequency_count": {"equals": 1}}` 表达。TS→IRC 联动是 `ts+irc` 多波组合，**不支持一站式**，走分步链路（`qst2+irc` / `qst3+irc` / `tsxtb+ts+irc` 同理；`tsxtb` 单作业可一站式，但 post 无频率/虚频——只出初猜几何，见「特殊 task」节）。IRC 步 post 报 `irc_point_count` 并产两图：`irc_profile`（Total energy along IRC 曲线，符号化反应坐标 / path 1 正 / path 2 负 / TS 在 0）与 `reaction_path`（Reactant→TS→Product 阶梯图，kcal/mol 垒高，R/P 取 IRC 两分支端点、TS 取 point 0；单向 irc 无 R/TS/P 三元组时跳过并在 context 说明）。
- **读结果**：通知后 `job_output({"job_id": "<background job id>"})` 一次拿到：`properties`（energy、converged、`frequencies_cm-1`、`imaginary_frequency_count`）、`files`（如 `g16_optimized.xyz`、`job.log`）与逐作业终态行、`plots`（绘图任务返回 `kind` + PNG/CSV 两路径的 JSON 行）。**无需再跑 `cat result.json`**——post 结果已由 producer 解析进输出；需要原始 result.json 或大文件时再经 `mat_exec`/`mat_download` 取。
- **`job_output` 即终点**：`properties` 与终态行已足够判定成败并向用户汇报；**不要为"呈现完整结果"主动 `cat` `files` 里的原始产物**（`g16_optimized.xyz`、`job.log`、几何坐标全文都算）——产物路径已列在 `files`，用户明确要看优化几何或原始输出时再按需取回。仅当需要 `properties` 之外的字段（`steps`、`warnings`、`science`、`error_detail`）或诊断失败时，才 `mat_exec` 执行 `cat {work_dir}/result.json`（`plots` 直读见下条，旧版部署才回退 result.json）。
- **图与绘图数据（`plots`）**：freq/tddft/fluorescence/opt/ts/qst2/qst3/opt+freq/irc 的 post 会生成 `plots` 数组（`{"kind", "image", "data"}`，图 PNG + 绘图数据 CSV 两类路径）。**本版本 dsh 起（0.7.9）`job_output` 输出直接带 `plots:` 行**（含全部路径；远端 1.3.0/1.3.1 均适用——该行来自 dsh 侧透传，与 workflow 版本无关），无需再读 `result.json`；仅当**绘图任务的** `job_output` 未带（旧 dsh 部署）时才 `cat {work_dir}/result.json` 取 `plots` 字段兜底。向用户报告图的类型与两个路径（PNG 给直觉、CSV 可复绘后处理），取回走 `mat_download`。`image=null` = 该环境缺 matplotlib、图未渲染，告知用户完整数据在 `data` 指向的 CSV；`result.json` 里 `plots` 为 `[]` 或无该键（纯数值任务、出错时被清空、或极旧部署）都**正常继续、不报错**。不要 `cat`/下载 PNG 内容做分析，不要通读 CSV 全文。
- **失败语义**：slurm 作业非 COMPLETED → 不跑 post，`job_output` 里带 `log_tail`（job.log 尾部 50 行）供诊断；COMPLETED 但 post 失败 → 作业仍按完成结算，输出里标注 `post failed` 与 log_tail。
- **边界**：多波组合（`opt+sp`、`aea` 等需要分波提交/二次 run 的形态）**不支持**一站式，仍走分步链路；每个 `mat_gaussian` 占用一个后台作业配额（owner 上限 10），批量独立计算 = 多次调用；`max_wait_seconds` 默认 1800，超时按 max-wait 结算、不跑 post——续盯或重新评估，不是错误。
- **全程异步，不碰调度器**：提交后**不要手动 `squeue`/`sacct` 轮询**（与分步链路同一红线）。`job_output` 返回的是**最近一次服务端轮询快照**——作业刚结束时它可能仍显示 running，这是正常竞态；完成通知（in-session notice）才是终态权威。非终态期间就地等待用 `job_output({"job_id": ..., "wait": true, "timeout_ms": 600000})`，不要为"确认状态"绕过监控去查调度器（压测 P6 教训：producer 轮询已默认封顶 30s，可见延迟有界）。
- **诊断不读 log 原文**：`job_output` 已内嵌 `properties`/`log_tail`/`plots`。对 `job.log` 施加 `cat`/`grep`/`awk`/`sed`/`tail`/`head` **都算读原文**，一律禁止；仅当 `result.json` 的 `status == "error"` 且结构化字段不足以定位问题时，才回退读 log 尾部（压测 P6 教训）。
- **task 即计算范围**：用户要 `freq` 就提交 `freq`，不擅自扩成 `opt+freq`；要 `sp` 不加 `opt`。需要更大计算范围（如先优化再算频率）时先向用户说明并确认（压测 P1 教训：范围漂移即使结果可用也属违约）。
- **重试 workdir 语义**：重跑同一计算优先复用原 workdir（phase state 幂等，重复调用会重建 `.calcflow-phase.json` 并覆盖同名产物）；确需换新 workdir（如排查 workdir 污染）时，在回复中明确告知新命名与理由，**禁止静默 `_v2`/`_v3` 后缀漂移**。

`aea` 保留其专用多步行为：

```text
01-neutral-opt → 02-neutral-scf
03-anion-opt  → 04-anion-scf
AEA = E(neutral) - E(anion)
```

## 环境与部署

### 快速定位：集群环境

执行本 skill 只需要下表两类集群环境；workflow 源码位置、CLI 模块路径、entry-point 映射属于开发机维护信息，**本 skill 不提供、执行时也不需要**——一切运行时问题（CLI 可用性、协议版本、task registry）都由环境门禁一次性回答：

| 角色 | 位置 / 入口 | 说明 |
|---|---|---|
| 集群 pre/post 环境 | `$HOME/workspace/demo/env.sh` | 部署在用户 workspace 的 workflow Python 环境；source 后 `gaussian-workflow` 进 PATH，无需上传源码或设 `PYTHONPATH` |
| g16 runtime | `$HOME/workspace/g16-hy/scripts/env.sh` | bootstrap 后的用户副本；**仅**经 `GAUSSIAN_ENV_SCRIPT` 由 `run` 写入 slurm.sh，pre/post 不 source |

两类环境互不混淆：pre/post 用部署的 workflow Python 环境（下文记作变量 `workflow_env`）；g16 计算用用户副本（仅 slurm 作业内 source，经 `GAUSSIAN_ENV_SCRIPT` 传入）。`workflow_env` 与 `GAUSSIAN_ENV_SCRIPT` 指代的是**两个不同的 env.sh**，不可互换。

### 协议判定

**协议由环境门禁的 `protocol` 字段判定**：返回 `"protocol":"new"` 即按本文档继续；`"protocol":"old"` 或 `protocol_not_new` 错误 → 部署版为**旧协议**，**立即停止**，告知用户：集群 gaussian-workflow 需**升级**到新协议版本后方可按本 skill 执行。**不要**为此读 workflow 源码、跑自定义 python 探针或做等价性试验——门禁已经给出答案；也**不得**用改 `slurm.sh`、挪 `manifest.json`、临时改 phase JSON 形态等手段把旧部署版硬适配成本文档流程——唯一正确处置是先升级部署版，再按本文档从头执行。

Gaussian 频率结果可通过 `properties.frequencies_cm-1` 和 `properties.imaginary_frequency_count` 消费；**热化学量**（workflow 1.6.3 起）带 freq 的 task（freq/opt+freq/ts/qst2/qst3）post 另报十键：`temperature_k`、`pressure_atm`、`zero_point_correction_hartree`、`thermal_correction_{energy,enthalpy,gibbs}_hartree`、`sum_electronic_{zpe,thermal,enthalpy,free_energy}_hartree`（Hartree，取 log 最后一个热化学段；external 路线无 freq 段则无这些键）；ΔG‡/ΔG_rxn 用 `sum_electronic_free_energy_hartree` 差值 ×627.5094740631 换算 kcal/mol；若请求 acceptance `imaginary_frequency_count.equals = 0` 失败，执行状态仍可为 completed，但 workflow 状态为 needs_review，必须检查虚频后再决定是否继续。

Gaussian 16 需要用户目录副本。首次使用时，通过 `mat_exec` 执行：

```bash
# bootstrap_g16.sh 是本机 skill 文件：先 read 全文，heredoc 落盘到 $HOME/workspace/.skill-gate/
# 再执行（heredoc 模式见「环境门禁」播种用法）：
mat_exec({"cluster_id": "{cluster_id}", "command": "bash $HOME/workspace/.skill-gate/bootstrap_g16.sh", "timeout_seconds": 600})
```

默认路径：

```text
源：/public/software/apps/sag-tool/qcsoft/g16-hy
目标：$HOME/workspace/g16-hy
环境：$HOME/workspace/g16-hy/scripts/env.sh
```

bootstrap 会按需复制公共包、收紧副本权限并修正 `env.sh` 的 `SCRIPTDIR`。将此 `env.sh` 的绝对路径设置为 `GAUSSIAN_ENV_SCRIPT`，供 `run` 写入 Slurm 脚本使用：

```bash
export GAUSSIAN_ENV_SCRIPT="$HOME/workspace/g16-hy/scripts/env.sh"
```

## CLI 与 phase JSON

`-t`、`-p`、`-i` 是一等路由参数；即使传入 `--json`，也必须显式提供。`--json` 是可选的、仅补充当前 phase 参数的二等入参：

```bash
gaussian-workflow \
  -t <task> -p <pre|run|post> -i <structure.xyz> \
  -w <absolute-workdir> [--json <phase.json>]
```

所有远程命令都必须显式使用同一个绝对 `{work_dir}`；远端 shell 调用之间没有持久 cwd。激活 workflow 用部署的 `workflow_env`（路径见上"快速定位"），`source` 后 `gaussian-workflow` 即在 PATH：

```bash
workflow_env=$HOME/workspace/demo/env.sh
cd "{work_dir}" && source "$workflow_env" && gaussian-workflow ...
```

不支持也不得使用：`--idempotency-id`、`-n/--ncores`、`-m/--memory`、`-j/--slurm-jobid`。跨 phase state 固定在：

```text
{work_dir}/<task>/.calcflow-phase.json
```

例如单 task `opt` 的典型目录是：

```text
{work_dir}/opt/
├── structure.xyz
├── job.gjf
├── job.log
├── slurm.sh
└── .calcflow-phase.json
```

### pre.json：Gaussian 输入参数

`pre.json` 是一个顶层对象，使用 `gaussian_workflow.pre.v1`：

```json
{
  "schema_version": "gaussian_workflow.pre.v1",
  "resources": {
    "ncores": 32,
    "memory": "64GB"
  },
  "generator": {"dialect": "ase"},
  "ase": {
    "calculator_kwargs": {
      "method": "B3LYP",
      "basis": "6-31G(d)",
      "charge": 0,
      "mult": 1,
      "opt": ["Tight", "CalcFC"],
      "ioplist": ["2/9=1"]
    }
  },
  "output": {"input_file": "job.gjf"}
}
```

> **适用范围**：上面这个示例带 `opt` 路由键，**仅适用 `-t opt` / `-t opt+freq`**（task 自身路由键的选项精调）；其他 task（sp/ts/tddft/irc/...）的 `pre.json` **不得携带任何路由键**——见「一站式路径」节的硬警告。

> **charge/mult 必须与体系电子数同奇偶（workflow 1.4.2 起 pre 硬校验）**：奇数电子体系（自由基，如 F+H₂ 11e、CH₃ 9e）必须用偶数 mult（二重态 `"mult": 2`），偶数电子体系用奇数 mult（闭壳层基线 `"mult": 1`）。不匹配时 pre 直接返回 `error_detail.code = "VALIDATION_FAILED"`（retryable，`suggested_actions` 给出正确 mult），照做重跑即可；不要放行到 g16——那边只会给不可读的 l101/l301 电子计数错误、烧掉整波作业（三会话取证 D14）。上例默认模板的 `"mult": 1` 仅适用于闭壳层。

`pre.json` 不得含 `task`、`structure`、`id` 或 `parameters` 包装；这些路由信息只能来自 CLI。`resources` 是 **Gaussian 专属** 输入字段，必须同时提供正整数 `ncores` 与带 `MB`、`GB` 或 `TB` 单位的正内存值：

```text
resources.ncores → %nprocshared
resources.memory → %mem
```

不得在 `ase.calculator_kwargs` 中提供旧的 `nprocshared` 或 `mem`。不传 `--json` 时使用 calculator 默认值（1.3.3 起与下例档位对齐：B3LYP/6-31G(d)、32 核、64GB）。

**资源档语义（r2 O1 对齐）**：`pre.json` 的 `resources` 是该次作业资源档的**唯一来源**——自定义 `pre.json`（例如只为改 method/basis）时**必须显式写 `resources`**，缺失会被 workflow 以结构化报错拒绝；上例的 32 核/64GB 是推荐档位，**不会自动继承**到自建 pre.json，小体系可自觉降档但须自己写明。一站式工具的内置默认档（32 核/64GB）仅在不传 `pre_json` 时生效；传了自建 `pre_json` 就以其中 `resources` 为准，报告作业资源时应引用实际值而非文档档位。

单步 task 中，`ase.calculator_kwargs` 是 Gaussian 输入的权威来源；task 语义路由（`opt`→opt、`freq`→freq、`tddft`→td(nstates=20) 等，对照「默认 route 参考」表）在 JSON **未写该键时缺省自动注入**——`pre.json` 不写 `opt`/`freq` 也照样产出优化/频率输入。JSON 显式写的键**以 JSON 为准**（如 `"opt": ["Tight", "CalcFC"]` 覆盖默认裸 opt）。带选项的关键词用列表（`["Tight"]`）、**裸关键词写 `[]` 或 `""`**；路由键的值**不得是布尔**（`"freq": true` 会被 workflow 直接拒绝报错——ASE 会渲染成非法的 `freq(True)`）。AEA 将该块作为多步共享配置，但仍强制每步 charge/mult 与 `opt`/`scf` route。

### run.json：Slurm 分配参数

`run.json` 同样是一个顶层对象，仅含 `slurm`：

```json
{
  "slurm": {
    "partition": "normal",
    "nodes": 1,
    "ntasks_per_node": 32,
    "time": "24:00:00",
    "mem": "64GB"
  }
}
```

允许的 `slurm` 字段为 `partition`、`nodes`、`ntasks_per_node`、`time`、`account`、`qos`、`mem`、`output`、`error`。`run` 要求 `GAUSSIAN_ENV_SCRIPT` 是无换行的绝对路径。

Gaussian 输入资源和 Slurm 分配是两层配置：`resources` 仅属于 `pre.json`，`slurm` 仅属于 `run.json`。同时指定时，workflow 会校验：

```text
resources.ncores <= slurm.ntasks_per_node
resources.memory <= slurm.mem
```

`run` 只生成或更新当前可执行步骤的 `slurm.sh`，绝不执行本地 `g16`；随后由 `mat_exec` 提交（sbatch），再由 `mat_job_watch` 异步批量监控到终态。`aea` 保留分波生成的专用行为：优化完成后再次调用 `pre`/`run` 生成后续 SCF 步骤。

### post.json：空对象

`post.json` 必须为：

```json
{}
```

`post` 从 `{work_dir}/<task>/.calcflow-phase.json` 恢复参数和结构副本，读取完成的 log。它只在正常终止且所需收敛存在时报告结果。每个 phase 均向 stdout 输出一个 JSON 对象，**同时写入 `{work_dir}/result.json`**——这是 `calcflow.result.v1` 规范化的结构化结果，agent 应**优先读取 `result.json`** 获取所有物性、状态和产物路径，而不是直接解析 `job.log`。

结果 JSON 至少包含 `software`、`task`、`phase`、`status`、`execution`、`workflow`、`science`、`properties`、`files`、`slurm`、`error`、`warnings`。错误结果仍保留 CLI 的完整 `task`，且 `files`/`images`/`plots` 为空。

`result.json` 关键字段速查：

| 字段 | 含义 |
|---|---|
| `status` | `"ok"` / `"error"` |
| `execution.status` | `"completed"` / `"failed"` / `"blocked"` |
| `workflow.status` | `"completed"` / `"needs_review"` / `"blocked"` / `"failed"` |
| `workflow.next_action` | 当 status 非 completed 时的建议动作 |
| `science.status` | `"not_evaluated"` / `"passed"` / `"failed"` |
| `properties` | 所有物性（energy、converged、frequencies_cm-1、imaginary_frequency_count 等） |
| `warnings` | 非致命警告列表 |
| `files` | 生成的所有产物文件绝对路径 |
| `plots` | 可可视化任务的图与绘图数据：`[{"kind", "image", "data"}]`（kind 与 task 对应：`ir_spectrum` / `uvvis_spectrum` / `emission_spectrum` / `scf_convergence` / `irc_profile` / `reaction_path`）；`image` 为 PNG 绝对路径、`data` 为 CSV 绝对路径（原始绘图数据，可复绘/后处理）；`image=null` = 该环境缺 matplotlib、图未渲染，数据仍在 CSV；**无 `plots` 键 = 旧版部署，属正常不报错**；sp/dipole/polar/resp/aea 纯数值任务本就没有 |
| `error` / `error_detail` | 错误信息与建议 |
| `steps` | 多步组合的每步详情（pre/run/post 状态） |

## Slurm 产物契约

`run` 阶段读取 `run.json` 的 `slurm` 字段和 `GAUSSIAN_ENV_SCRIPT` 环境变量，渲染或更新 `slurm.sh`，脚本内的计算命令恒为 `g16 < input > log`。**`run` 不执行 `g16`，也不提交作业**；它的唯一产物是 `slurm.sh` 文件，提交由 `mat_exec` 完成（sbatch），监控由 `mat_job_watch` 完成（异步批量）。

`run` 一次产出 `slurm.sh` 的份数取决于 task 形态，agent 据此决定提交次数：

| task 形态 | `run` 产出的脚本 | agent 提交 |
|---|---|---|
| 单步（`opt`/`sp`/`tddft`/...） | `{work_dir}/<task>/slurm.sh` **一份** | `submit-job` 一次 |
| `opt+freq`（单作业组合） | `{work_dir}/opt+freq/slurm.sh` **一份** | `submit-job` 一次 |
| 顺序组合（如 `opt+sp`） | 每个已就绪 step 子目录（`01-opt/`、`02-sp/`）**各一份** | 每个 step 各 `submit-job` 一次 |
| `aea` | 当前已就绪子目录（见下"两波"）**各一份** | 每个子目录各 `submit-job` 一次 |

脚本内的 `source` 行来自 `GAUSSIAN_ENV_SCRIPT`（g16 runtime，不是 `workflow_env`）；`partition`/`nodes`/`ntasks_per_node`/`mem` 等来自 `run.json.slurm`。若 `slurm.sh` 已存在：命令段（`source` 行与 `g16 < input > log` 命令行）与本次渲染不一致时 `run` **整体重写**脚本（workflow 1.3.3 起；result 的 `context` 会记 `>> slurm.sh command section re-rendered`），一致时仅更新 `#SBATCH` 指令。脚本固定含 `ulimit -c 0`（禁 core dump）。

提交前确认脚本数量：`find "{work_dir}/<task>" -maxdepth 2 -name slurm.sh`。脚本数即提交次数；不要在登录节点手动跑 `g16` 或改写脚本。

## 组合任务执行协议

用户请求"优化并算频率"（`opt+freq`）等组合目标时，**整个 workflow 是一个组合 task，不是多个独立计算**。三个 phase 必须复用**同一个完整 task 字符串**（`pre`/`run`/`post` 一律 `-t opt+freq`），一个 `{work_dir}`、一份 `.calcflow-phase.json` state。**禁止拆成** `-t opt` 和 `-t freq` 两次独立 workflow，**禁止 post 只跑第一个 task**。组合分两类：

### `opt+freq`：单作业组合（一波提交）

Gaussian 在同一作业内优化收敛后自动接频率分析（route `opt freq`），因此 `-t opt+freq` 生成**一个 Gaussian 作业**：`{work_dir}/opt+freq/` 平铺布局（无 `01-`/`02-` 子目录）、`pre` 产出一份 `job.gjf`（路由行含 `opt` 与 `freq`）、`run` 产出**一份** `slurm.sh`、**只需一波** `run → submit-job → 等完成 → post`。post 从单一 log 一次报出全部属性，**无步骤前缀**：`energy`、`converged`、`frequencies_cm-1`、`imaginary_frequency_count`，另附 `g16_optimized.xyz` 优化几何。核对：`frequencies_cm-1` 在 properties 中即完成；**缺 `frequencies_cm-1`** = 计算未完成或 log 异常，不得报告完成。

### 其它组合（`opt+sp` 等）：多波多步

1. **N 步组合 = N 波提交**。第一步（`01-opt/`）的输入在 `pre` 生成；后续步骤（`02-sp/`）的输入**依赖前一步的输出几何**，只有在前一步作业完成后才会由 `run` 自动生成。因此每波循环是：

   ```text
   run（渲染当前就绪 step 的 slurm.sh）
   → submit-job 提交该 step
   → 等作业完成（该 step job.log 落盘）
   → post（刷新 result.json，对已完成步骤做结构化门检，见第 2 条）
   → 门检通过才再次 run（自动读前一步 log，生成下一步输入与脚本）
   → 直到每个 step 都提交完成；链尾最终 post 定案
   ```

   提交波数 = 组合 step 数。最终 `find "{work_dir}/<task>" -maxdepth 2 -name slurm.sh` 的数量应等于 step 数。
2. **每波终态先 post 再门检，不把 post 留到链尾**：每个波次作业到终态（`mat_job_watch` 通知，COMPLETED 与 FAILED 都是）后、提交下一波**之前**，先跑一次 `post`——它会刷新 `result.json`，带出已完成步骤的分步前缀属性（`ts.converged`、`ts.imaginary_frequency_count`、`ts.frequencies_cm-1` 等）。波间验证一律读这些结构化字段，**不得中段 grep log 原文、不得手工 diff 几何**（正常终止/收敛/虚频数都在字段里；几何传递由 run 的推进机制保证）。典型门检：`ts` 波 = `ts.converged == true` 且 `ts.imaginary_frequency_count == 1`——0 个是极小点、≥2 是高阶鞍点，都不具备接 IRC 的资格；FAILED 终态则 post 的结构化错误（`error_detail`/kb 引用）直接驱动诊断。此时 post 报 `composition incomplete: pending steps [...]` 属**预期形态**（链未走完），继续下一波即可，不当错误处理。**机制化（M31 起）**：本门检已由工具层强制——`mat_sbatch` 带 `wave_gate={pkg_digest, wave_id}`（digest 来自 `mat_task_build`，其编译产物自动落盘）时，提交前自动校验前序波，不过门抛 `GATE_FAILED` 且零集群副作用；分步提交应一律携带。也可把整条链交给 `mat_pipeline_start` 代码循环（见下），门检/推进/失败环全部机制化。
3. **post 结果按步骤加前缀**：多步组合的 properties 带步骤前缀 `opt.` 与 `sp.`，形如 `opt.energy`、`sp.energy`。post 后必须核对结果 `steps` 数组中**每个 step 的 post 都是 ok**，且 properties 里出现所有步骤的前缀。
4. **后续步骤属性缺失即组合未完成**：若 post 结果 `workflow.status == "needs_review"`、`next_action == "rerun_run_phase"`，且 warnings 含 `composition incomplete: pending steps [...]`——说明还有 step 没跑（通常漏了第 2 波）。此时**不得向用户报告计算完成**，应补跑漏掉的波次后重新 post。（波间门检时看到同一签名属预期，见第 2 条。）

## 诊断-重试协议（workflow 1.6.0 起）

失败→诊断→重试的 custody 四件套由 workflow 自动落盘；agent 侧义务：

- **现场与台账**：失败现场快照在 `{step}/attempts/att-{NNN}/`（gjf/log/slurm + manifest），台账在 `{work_dir}/attempts.jsonl`（workflow 只写 `archived` 事实行）。**submitted 行由工具自动记账（M31 起）**：`mat_sbatch` 传 `attempts_ledger={file, task, step}` 即在提交成功后自动追加，不再手工 echo；走 `mat_pipeline_start` 时 driver 自带记账。
- **diag/ 目录契约（agent 所有，workflow 永不读写）**：`diag/att-{NNN}-{kb-id}/` 三件——`facts.md`（结构化事实，原料**优先取 workflow 导出的** `convergence_trace.csv`/`geometry_changes.csv`，禁止中段 grep log 原文）、`conclusion.md`（固定字段：facts 摘要 / prescription 出处（kb 条目 + 表中哪行哪级）/ diff（参数或初猜改动）/ 新 attempt 号）、`probe/`（梯进前探针实验，产物尺寸纪律沿用）。
- **对账协议**：sacct/监控看板出现**台账外的 jobid** ⇒ 场外人工干预（双写者）——**先问用户再动**，勿直接立缺陷或改现场。
- **标题行即索引**：gjf 标题行 `att-{NNN} <task> <step>` 可 grep，据此定位当前代次与对应归档档。
- **同参数 pre 的两种语义（勿混淆）**：standalone 任务（单 task / `opt+freq`）同参重跑 pre = **归档旧现场 + 开新代次**（attempt 递增）；组合任务 = **keep-live 零写入**（resume 保留现场待 run 重提）。改参则两者都全量重建（重建前归档）。

## HPC 完整执行链路

完整链路：**上传 → pre → run（生成 slurm.sh）→ sbatch 提交 → mat_job_watch 异步批量监控 → post → 下载**。其中 bootstrap、pre/run/post 与只读核查均经 `mat_exec` 执行业务命令；查询集群/队列、上传文件（heredoc 写入）、提交作业（sbatch）同样经 `mat_exec`，作业监控经 `mat_job_watch`（完成通知到达前不手动轮询）。**选项齐备的单作业计算（单步或 opt+freq）优先走上文「一站式路径（mat_gaussian）」，下述 Step 0–6 是分步/交互形态。** **HPC 凭据由 mat_exec 自管，本 skill 不写死任何 AK/SK/用户名/服务器地址。**

### 约定

- `{work_dir}`：本 skill 所涉计算的工作目录（系统给定，**绝对路径**）。存为变量后，**全流程 Step 0–6 用同一值、原样复用**——远端 shell 无持久 cwd，故每条远程命令前置 `cd "{work_dir}" &&`。子目录（`opt/`、`aea/01-neutral-opt/` 等）由 gaussian-workflow 自建。
- **重试 workdir 语义**：重跑同一计算优先复用原 `{work_dir}`（phase state 幂等，重复 `pre`/`run` 安全、同名产物覆盖）；确需换新 `{work_dir}` 时，在回复中明确告知新命名与理由，禁止静默 `_v2`/`_v3` 后缀漂移。
- `{cluster_id}`：HPC 集群 ID（示例 11250，华东一区昆山），从对话/上下文获取，**永久保存到上下文**，后续直接复用、不再询问。
- `{partition}`：SLURM 分区（队列），**涉及计费，不写死、不自动选**——Step 0 经 `sinfo` 采集、由用户确认后保存。它仅写进 `run.json.slurm.partition`，由 `run` 渲染进 `slurm.sh` 的 `#SBATCH -p`。
- `workflow_env`：部署的 workflow Python 环境（值见"环境与部署"，`$HOME/workspace/demo/env.sh`）。pre/run/post 命令前 `source "$workflow_env"` 拿到 `gaussian-workflow`。
- `GAUSSIAN_ENV_SCRIPT`：g16 runtime（bootstrap 后的 `$HOME/workspace/g16-hy/scripts/env.sh`），**仅**由 `run` 写进 slurm.sh 供作业内 source；pre/post 不 source 它。
- **所有命令经 `mat_exec` 在目标集群登录节点执行**，无 MAT_SANDBOX 路由概念，也无 access-key/secret-key/user 参数。
- **下载产物**：post 完成后优先读取 `{work_dir}/result.json`（`calcflow.result.v1` 结构化结果）；仅在用户明确要求或 `result.json` 不足以定位问题时，才经 `mat_exec` 执行 `cat`/`tail` 读取原始产物（log、优化结构、RESP 电荷、光谱文件等）。

### 0. 确认集群和队列（确定 `{cluster_id}` + `{partition}`，完成后永久保存）

经 `mat_exec` 采集，**完成后把 `{cluster_id}` 与用户选定的 `{partition}` 永久保存到上下文**，后续 1–6 步直接复用、不再询问：

```bash
# 集群：从对话/上下文获取（示例 11250，华东一区昆山），无需列出
# 队列：查询选定集群的可用队列，交用户确认（涉及计费，勿自动选）
mat_exec({"cluster_id": "{cluster_id}", "command": "sinfo -o '%P %a %l %D %t %N'", "timeout_seconds": 30})
```

输出字段依次为：分区（`%P`）、可用性（`%a` up/down）、时限（`%l`）、节点数（`%D`）、状态（`%t`）、节点列表（`%N`）。`%t` 常见值：`idle` 全空闲、`mix` 部分空闲、`alloc` 占满、`drain*` 故障。向用户呈报时按此解读：只有 `alloc` 的分区要提示排队等待，`drain*` 节点不计入可用；分区仍由用户确认，不自动选。

**无需任何 AK/SK/user 参数**——凭据由 `mat_exec` 自管，本 skill 不写死。

### 1. 上传结构和 phase JSON（经 `mat_exec`）

上传结构文件（molecule.xyz）以及需要使用的 phase JSON 文件（pre.json、run.json、post.json）。由于本 harness 无本地文件上传概念，文件内容需直接内嵌到 heredoc 中写入远程：

```bash
# 创建工作目录（如尚未存在）
mat_exec({"cluster_id": "{cluster_id}", "command": "mkdir -p {work_dir}", "timeout_seconds": 10})

# 写入结构文件（内容为用户提供的 XYZ 结构）
mat_exec({"cluster_id": "{cluster_id}", "command": "cat > {work_dir}/molecule.xyz <<'EOF'
<XYZ 结构内容，原子数行 + 每行元素符号与坐标（纯元素符号，禁止 H1/H2 编号标签）>
EOF", "timeout_seconds": 30})

# 写入 pre.json（如需自定义参数）
# 适用范围：下面的示例带 "opt" 路由键，仅适用 -t opt / -t opt+freq（task 自身路由键精调）；
# 其他 task（sp/ts/tddft/irc/...）的 pre.json 不得携带任何路由键——见「一站式路径」节硬警告。
mat_exec({"cluster_id": "{cluster_id}", "command": "cat > {work_dir}/pre.json <<'EOF'
{
  "schema_version": "gaussian_workflow.pre.v1",
  "resources": { "ncores": 32, "memory": "64GB" },
  "generator": {"dialect": "ase"},
  "ase": {
    "calculator_kwargs": {
      "method": "B3LYP",
      "basis": "6-31G(d)",
      "charge": 0,
      "mult": 1,
      "opt": ["Tight", "CalcFC"],
      "ioplist": ["2/9=1"]
    }
  },
  "output": {"input_file": "job.gjf"}
}
EOF", "timeout_seconds": 30})

# 写入 run.json（如需自定义 Slurm 参数）
mat_exec({"cluster_id": "{cluster_id}", "command": "cat > {work_dir}/run.json <<'EOF'
{
  "slurm": {
    "partition": "normal",
    "nodes": 1,
    "ntasks_per_node": 32,
    "time": "24:00:00",
    "mem": "64GB"
  }
}
EOF", "timeout_seconds": 30})

# 写入 post.json（固定为空对象）
mat_exec({"cluster_id": "{cluster_id}", "command": "cat > {work_dir}/post.json <<'EOF'
{}
EOF", "timeout_seconds": 30})
```

> `gaussian-workflow` 已随 `workflow_env` 部署（entry-point），无需上传源码或设 `PYTHONPATH`。

### 2. 远程执行 pre（经 `mat_exec`）

通过 `mat_exec` 执行 pre 命令：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": 'cd "{work_dir}" && source "$workflow_env" && gaussian-workflow -t opt -p pre -i molecule.xyz -w "{work_dir}" --json pre.json', "timeout_seconds": 300})
```

生成 `{work_dir}/opt/job.gjf` 与 `.calcflow-phase.json`。只读核查同样经 `mat_exec`：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": 'find "{work_dir}/opt" -maxdepth 1 -type f -printf "%p\n"', "timeout_seconds": 30})
mat_exec({"cluster_id": "{cluster_id}", "command": 'grep -nE "^%nprocshared|^%mem" "{work_dir}/opt/job.gjf"', "timeout_seconds": 30})
mat_exec({"cluster_id": "{cluster_id}", "command": 'head -n 6 "{work_dir}/opt/job.gjf"', "timeout_seconds": 30})
```

**提交前必须核对路由行**（组合任务核对每个步骤子目录的 `job.gjf`）：`head` 输出的 route 段必须含该步骤预期的 task 关键词（`-t opt` → `opt`、`-t freq`/`opt+freq` 第二步 → `freq`）。路由行只有 `#P method/basis` 意味着该步会退化成单点能——**不得提交**，改 `pre.json` 后重跑 `pre` 再核对。

**等待用户确认必须用阻塞式交互**：需要用户核对输入、选择选项或授权删除/提交时，发起一个等待应答的 question（宿主阻塞机制），**不得以文本收尾代替**——turn 结束 ≠ 用户已确认；队列/多 case 编排下后续 prompt 会直接越过文本等待点，等待形同虚设（demo r2 O2 教训）。

### 3. 生成 slurm.sh（经 `mat_exec` 调 `run`）

> calcflow 架构：`run` **只渲染/更新 `slurm.sh`，不执行 `g16`、不提交**。直接用 `gaussian-workflow -p run`，**不要用 sed 模板**替换本步（与老 orca 的 sed 注入不同）。

通过 `mat_exec` 执行 run 命令：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": 'cd "{work_dir}" && source "$workflow_env" && export GAUSSIAN_ENV_SCRIPT="$HOME/workspace/g16-hy/scripts/env.sh" && gaussian-workflow -t opt -p run -i molecule.xyz -w "{work_dir}" --json run.json', "timeout_seconds": 300})
```

`GAUSSIAN_ENV_SCRIPT` 必须与 `run` **同一条命令内联导出**：`mat_exec` 每次调用都是新 shell，先前命令里的 export 不持久；漏导出会得到 `JSON run requires GAUSSIAN_ENV_SCRIPT`，白费一次往返。续跑/推进组合链再次调用 `run` 时同样要带（一站式 `mat_gaussian` 路径不受影响——其 run 阶段命令本就内联导出）。

产物份数见"Slurm 产物契约"：单步一份 `{work_dir}/opt/slurm.sh`；组合/AEA 每个**已就绪子目录**各一份。提交前先 `find "{work_dir}/<task>" -maxdepth 2 -name slurm.sh`，脚本数即提交次数；不要在登录节点手动跑 `g16` 或改写脚本。

### 4. 提交（mat_exec）与监控（mat_job_watch）

对每份新生成的 `slurm.sh` 各提交一次，收集返回的 `<job_id>`（从 stdout 解析，通常格式为 `Submitted batch job <job_id>`）：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": 'cd {work_dir}/opt && sbatch slurm.sh', "timeout_seconds": 60})
```

**全部提交完后，把本轮所有 job_id 一次性注册异步批量监控**（多目录组合/AEA 也只此一个后台作业）：

```json
mat_job_watch({"cluster_id": "{cluster_id}", "job_ids": ["<job_id_1>", "<job_id_2>"]})
```

立即返回 `background job mat-watch-N`。此后**不要手动 squeue/sacct 轮询**：服务端按自适应间隔（10–300s）批量 sacct，无模型请求；全部作业到终态后，会话内自动收到完成通知（`background job mat-watch-N (kind: ...) finished [status: completed]`）。

等待方式二选一：

1. **默认**：注册后直接做别的事或结束当前轮次，等完成通知唤醒会话；
2. **必须就地等**（如 headless 单轮会话）：`job_output({"job_id": "mat-watch-N", "wait": true, "timeout_ms": 600000})` 阻塞至多 10 分钟；未终态可再调一次。

收到通知后读逐作业终态表（含每作业 `State exit elapsed` 与 `N/M settled (...)` 汇总行）：

```json
job_output({"job_id": "mat-watch-N"})
```

规则与边界：

- **只有全部作业终态后才执行 post。** 表里有 FAILED/CANCELLED/TIMEOUT 时，先执行 post（它可能仍能产出部分结果），再根据 `result.json` 的 `error` 和 `execution.status` 判断是否需要重提。
- `job_kill` 只取消**监控**，不会取消集群作业本身；要终止作业必须显式 `mat_exec` 执行 `scancel <job_id>`。
- `max_wait_seconds`（默认 86400）到点仍未全终态时监控按 `max-wait exceeded; still active: ...` 正常结束——再调一次 `mat_job_watch` 续盯即可，不是错误。
- 同一会话连续 3 次自动唤醒后，后续完成通知会转为注入（不再新开轮次）；收尾前用 `job_list` / `job_output` 对账一次。

### 5. 远程执行 post（经 `mat_exec`）

通过 `mat_exec` 执行 post 命令：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": 'cd "{work_dir}" && source "$workflow_env" && gaussian-workflow -t opt -p post -i molecule.xyz -w "{work_dir}" --json post.json', "timeout_seconds": 300})
```

`post` 的 stdout 即为结果 JSON，同时写入 `{work_dir}/result.json`。**agent 必须读取 `result.json` 作为结果权威来源**，无需再读 `job.log` 做解析：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/result.json", "timeout_seconds": 30})
```

从 `result.json` 获取所有信息：

- **计算是否成功**：`status`、`execution.status`、`workflow.status`
- **物性**：`properties.*`（energy、converged、frequencies_cm-1、imaginary_frequency_count 等）
- **产物文件**：`files` 数组列出所有生成文件的绝对路径
- **警告/错误**：`warnings`、`error`、`error_detail`
- **多步组合**：`steps` 数组，核对每步 `stages.post.status == "ok"`

对于 JSON 以外的默认参数，可省略 `--json`，但 `-t/-p/-i/-w` 仍必须提供。

### 6. 获取产物（经 `mat_exec`，优先 `result.json`）

**优先从 `result.json` 获取结果**：`result.json` 的 `properties` 包含所有物性，`files` 列出全部产物路径。仅当用户明确要求查看原始输出（log、结构等）时，才按需读取 `files` 中列出的文件：

```bash
# 始终先读 result.json——这是规范化的结构化结果
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/result.json", "timeout_seconds": 30})

# 仅在用户要求时，才按需读取单个产物（路径来自 result.json 的 files 列表）
# 例如：优化结构、RESP 电荷、光谱文件等
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/opt/g16_optimized.xyz", "timeout_seconds": 30})
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/opt/*_resp.chg", "timeout_seconds": 30})
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/opt/spectrum_curve.txt", "timeout_seconds": 30})
```

> **禁止**：post 完成后直接 `cat job.log` 或 `grep "Normal termination"` 来解析结果——这些信息已在 `result.json` 中结构化呈现（`execution.status`、`properties.converged` 等），重复解析浪费 token 且容易出错。仅当 `result.json` 的 `status == "error"` 且 `error_detail` 不足以定位问题时，才回退到读取原始 log 尾部。

## 特殊 task

### 过渡态搜索（ts / qst2 / qst3）

**方法选择（默认 `ts`；`qst2`/`qst3` 仅用户点名才采纳）**：

**输入要求前置披露（用户未提供所需结构时的硬性动作）**：用户表达过渡态意图（ts/tsxtb/qst2/qst3/垒高/IRC 链）而未附结构时，**第一条回复必须附下表并问清缺料**（阻塞式 question，选项带推荐与风险说明），**不得静默替用户编结构开跑**：

| task | 需要用户提供 | 用户没有时的路径 |
|---|---|---|
| `ts` / `tsxtb` | **TS 初猜结构**（单帧 xyz；反应坐标上应断/应成键已部分完成的几何） | 请用户描述反应（断哪些键/成哪些键）→ 按化学直觉构造粗猜 → `tsxtb` 秒级打磨 → `tsxtb+ts+irc`；或提供 R/P 走 `qst2` |
| `qst2` | **反应物 + 产物**两帧（原子数与元素序号逐位一致） | 无替代输入——这正是 qst2 的定义 |
| `qst3` | 反应物 + 产物 + TS 初猜三帧 | 同上（且 qst3 本就不主动引导） |

- **默认 `ts`，组合 `ts+irc` 收口**。初猜由用户给出或按化学直觉构造；初猜不够好时**优先改善初猜**——用 `tsxtb`（GFN2-xTB 经 g16 `external` 接口，秒级）先把初猜搜成 TS 几何，再走 `tsxtb+ts+irc` 让 DFT 层收敛；**不是**切换 QST——`opt=TS` 找不出来的过渡态，用 QST2 也绝无可能找到。
- **`qst2` 仅两个特例**：① TS 模样心里有数但几何变量太多、手摆初猜太费劲，且 R/P 结构明确、原子易逐位对齐；② 对反应毫无直觉、拿 QST2 碰运气。用户没点名时，即使手里已有 R/P 两帧也**不默认选 `qst2`**——先构造 TS 初猜走 `ts`，或向用户确认意图后再选。
- **`qst3` 不主动引导**：除 R/P 外还需额外一帧 TS 初猜，收敛成功率并不比 `opt=TS` 强，基本无实际价值；仅用户点名时执行。
- QST 的初猜由程序从 R/P 坐标机械插值产生，通常不如人工构造的合理，且 Gaussian 对 QST 输入更挑剔。（方法学依据：sobereva.com/460）

三个过渡态 task 共用**多帧 xyz 单文件**输入：`-i` 仍是**一个文件**（一站式即 `structure` 字符串多帧拼接），帧序 = Gaussian 分子节顺序，各帧原子数与元素序号必须逐位一致：

| task | 帧数 | route | 帧语义 |
|---|---|---|---|
| `ts` | 恰 1 | `opt(TS,CalcFC,NoEigenTest) freq` | 过渡态初猜（默认方法） |
| `qst2` | 恰 2 | `opt(QST2,CalcFC) freq` | 反应物、产物（各自先优化过）——仅特例，用户点名 |
| `qst3` | 恰 3 | `opt(QST3,CalcFC) freq` | 反应物、产物、TS 初猜——不主动引导 |

要点：

- **帧数或元素序号不符 → pre 直接结构化报错**，不静默截断；多帧文件交给单结构 task（如 `opt`）时取第 1 帧。
- **多帧输入缺失/帧数不符时，把 pre 的结构化报错原样透出，或向用户索要缺失帧——禁止从会话历史、旧 workdir 或先前 case 的产物"补帧"凑数**。用户说"就这一个结构"就是一帧，不得替用户脑补第二帧；科学结果正确不豁免输入保真度违约（demo 压测 C6 教训）。
- **原子序号必须严格一致**：反应物和产物的同一原子在两帧中必须同位（Gaussian QST 硬要求）；各几何节共用同一 `charge`/`mult`。
- post 报 `frequencies_cm-1`、`imaginary_frequency_count`，并导出 `g16_initial.xyz` 与 `g16_optimized.xyz`（优化后 TS 几何）。**一阶鞍点确认（恰好一个虚频）由验收声明表达**：`"acceptance": {"imaginary_frequency_count": {"equals": 1}}`；count≠1 时 post 只在 context 警示，不判失败。
- TS→IRC 联动用组合 `ts+irc`（多波，分步链路）：IRC 步消费 TS 的**优化后**几何（`g16_optimized.xyz`），不是初猜。

### tsxtb（GFN2-xTB 初猜层，workflow 1.5.0 起）

**定位：只产初猜几何，不产科学结论。** `tsxtb` 用 g16 的 `external` 接口——g16 当优化器跑 `opt(TS,CalcFC,NoEigenTest,Nomicro)`，能量与导数全部由 xtb（GFN2）提供，秒到分钟级出一个远好于手摆的 TS 几何（过渡金属/复杂体系优先此路径：GFN2 普适性强于 PM6/PM7）。

- **恰 1 帧输入**（TS 初猜），与 `ts` 同契约；`pre.json`/`options.pre_json` **一律不写路由键**（同 `ts`/`qst`/`irc`），json 模式下 `method`/`basis` 由 task 强制接管。
- **不产频率、不是验收步**：post 只报 `energy`（xtb 级）、`converged`、`scf_convergence` 图并导出 `g16_optimized.xyz`；**没有** `frequencies_cm-1`/`imaginary_frequency_count`——一阶鞍点确认只在 DFT `ts` 步。
- **标准链路 `tsxtb+ts+irc`（三波，多波组合不支持一站式）**：xtb 出猜 → DFT `opt(TS,CalcFC,NoEigenTest) freq` 收敛并验收 imfreq==1 → IRC 收口；DFT 步消费 `tsxtb` 的优化几何。
- **精度不替代 DFT**：xtb 几何只作起点，垒高/电子结构结论一律取 DFT 层。
- 集群依赖：xtb 二进制在 workflow `environment/` 目录（与 Multiwfn 同处）或 PATH；缺失时结构化报错点名配置位置（不读源码探测）。
- **作业 FAILED（步数超限/l9999 签名，workflow 1.5.1 起）**：先读 `{work_dir}/<task>/convergence_trace.csv`（能量/受力/位移逐步曲线，post 失败时自动产出），按 `references/errors/ts-step-limit.md`（→ `methods/ts-convergence.md`）诊断处置——**不要原样重提、不要只加 MaxCycle**。
- **引用义务（gau_xtb 作者要求）**：`tsxtb` 底层经 gau_xtb 接口驱动 xtb。凡实际研究中使用了此接口（tsxtb 初猜进入后续计算并体现于报告/论文），务必按以下格式引用：`Tian Lu, gau_xtb: A Gaussian interface for xtb code, http://sobereva.com/soft/gau_xtb (accessed month day, year)`——`accessed` 填实际访问日期。向用户报告 tsxtb 相关结果时应主动附上此引用。

### fluorescence

无 JSON 默认：`B3LYP/aug-cc-pVDZ` + `TD(nstates=10)`。post 解析最后一个 `Excited State 1`，报告：

```text
fluorescence_energy_ev
wavelength_nm
oscillator_strength
```

同时使用 `Multiwfn` 生成 `spectrum_curve.txt`、`spectrum_line.txt` 等光谱产物。Multiwfn 不可用或退出失败时，post 必须报告失败，不能伪装成完整光谱成功。

### dipole / polar（1.4.3 起带结构化物性）

post 除 `energy`/`converged` 外报告任务同名物性（1.4.2 及以前只有 energy/converged，偶极/极化率要从 log 里捞——r7 实证缺陷 D18）：

```text
dipole: dipole_moment_debye, dipole_x_debye, dipole_y_debye, dipole_z_debye
polar:  polarizability_iso_au（各向同性）+ polarizability_{xx,xy,yy,xz,yz,zz}_au（g16 下三角序）
tddft:  excitation_energies_ev, oscillator_strengths（与 uvvis CSV 同源同序）
```

消费纪律：直接读 properties 交付，**不得再 grep log 取数**。

### resp

无 JSON 默认：`B3LYP/def2TZVP`、溶剂/色散设置；轻元素体系追加 `pop=MK` 和对应 IOp。**1.4.3 起这些任务身份参数（含 `%chk=g16.chk`）在 json 模式自动注入**——显式 pre.json 不需要再手写 `pop(MK)`/IOp/chk。post 顺序：

```text
Gaussian log 正常终止
→ formchk g16.chk g16.fchk（自动从 GAUSSIAN_ENV_SCRIPT 推导并 source g16 环境；裸调会段错误）
→ Multiwfn RESP 菜单（自动经 GAUSSIAN_WORKFLOW_ENV 解析）
→ 解析 .chg
→ 写 *_resp.chg
```

依赖预检（1.4.3）：formchk/Multiwfn 任一不可解析时 post 报 `VALIDATION_FAILED`，**点名缺失二进制与配置位置**；按 `suggested_actions` 检查 `GAUSSIAN_ENV_SCRIPT`/`GAUSSIAN_WORKFLOW_ENV` 导出即可，**不要 find 全盘搜索**（r7 教训：无名 FileNotFoundError 让 agent 烧额度寻宝）。RESP 电荷数量必须等于原子数。缺 checkpoint、`formchk` 失败、Multiwfn 失败或数量不匹配都应报错。

### aea

AEA 使用两波提交，不能把四步塞进一个单一 Slurm 输入：

```text
第一轮：pre → run → 提交/监控 01-neutral-opt 和 03-anion-opt
第二轮：再次 pre/run，读取优化几何并生成 02-neutral-scf/04-anion-scf → 提交/监控
最后：post
```

目录：

```text
aea/01-neutral-opt/
aea/02-neutral-scf/
aea/03-anion-opt/
aea/04-anion-scf/
aea/aea_result.txt
```

结果：

```text
AEA = E(neutral relaxed) - E(anion relaxed)
AEA_eV = AEA_Eh * 27.2114
```

AEA 每个子步骤固定 charge/mult：中性为 `0/1`，阴离子为 `-1/2`。`pre.json` 使用同一 `gaussian_workflow.pre.v1` 和 top-level `resources`；JSON 的 charge/mult/`opt`/`scf` 不会覆盖 AEA 的四步不变量。

AEA 的 `pre`/`run` 是**幂等且自推进**的，重复调用安全，agent 无需判断"当前该生成哪几步"：

- `pre` 探测每个 opt 子目录是否已有正常收敛的 log；若有，则读其优化几何生成对应 SCF 输入（`01-neutral-opt → 02-neutral-scf`、`03-anion-opt → 04-anion-scf`）；已存在的输入不会被覆盖。
- `run` 只给"已有输入但尚无 slurm.sh"的子目录补脚本，不重写已提交步骤。

因此两波编排是确定的：第一波 `pre`+`run` → 提交 2 个 opt 脚本 → 等完成；第二波再次 `pre`+`run`（此时 `pre` 自动生成 2 个 SCF 输入，`run` 为它们各写一份脚本）→ 提交 2 个 SCF 脚本 → 等完成；最后 `post` 汇总。每波提交的脚本数等于该波 `run` 新生成的 `slurm.sh` 数。

## 默认 route 参考

| task | 默认 route/行为 |
|---|---|
| `sp` | 单点 |
| `opt` | `opt` |
| `freq` | `freq`（频率 + 虚频计数/热化学解析） |
| `opt+freq` | `opt freq` 单作业（一波提交，post 无前缀属性） |
| `dipole` | 单点语义 |
| `polar` | `polar` |
| `tddft` | `td(nstates=20)` |
| `fluorescence` | `td(nstates=10)` + S1 解析 |
| `resp` | ESP/MK + RESP post |
| `ts` | `opt(TS,CalcFC,NoEigenTest) freq`，恰 1 帧输入，需要合理 TS 初猜——过渡态默认方法 |
| `tsxtb` | `opt(TS,CalcFC,NoEigenTest,Nomicro) external='./xtb.sh'`，恰 1 帧输入，GFN2-xTB 初猜层（无 freq、无虚频计数）——workflow 1.5.0 起 |
| `qst2` | `opt(QST2,CalcFC) freq`，恰 2 帧输入（反应物+产物，原子序号一致）——仅特例，用户点名才用 |
| `qst3` | `opt(QST3,CalcFC) freq`，恰 3 帧输入（反应物+产物+TS 初猜）——不主动引导，用户点名才用 |
| `irc` | `irc(CalcFC,MaxPoints=30,StepSize=10)`（1.4.2 起 MaxPoints 30，此前 5），需要 TS 几何 |
| `aea` | 四步内建 recipe |

TS→IRC 联动用组合 `ts+irc`（IRC 消费 TS 的优化几何）；单独跑 `irc` 仍需精确 TS 起点，普通稳定分子不能直接作为 IRC 起点。**IRC 不收敛梯进处方**：l123 corrector 发散按 `references/errors/irc-l123-divergence.md` 三级梯进（① `"irc": ["CalcFC","MaxPoints=50","StepSize=5"]` 整体值覆盖（D15 实战）；② 仍发散换 `CalcAll`；③ 死亡点只后移不根治直接 `Steep` 兜底——sobereva/400；方法学见 `references/methods/irc-methods.md`）。

## 故障排查

**知识检索协议**：结构化错误消息带 `kb:<id>` 时直接 `Read references/**/<id>.md`；裸 log 先 `grep -m3 -nE` 拿签名再 `grep -ril` 命中 `references/` 条目（路由表见 `references/INDEX.md`）。

**优先检查 `result.json`**：`status`、`execution.status`、`workflow.status`、`error`、`warnings` 已涵盖绝大多数故障场景。仅当 `result.json` 信息不足时才回退到原始 log：

```bash
# 仅在 result.json 不足以定位问题时，才检查原始 log
mat_exec({"cluster_id": "{cluster_id}", "command": "grep -n \"Normal termination of Gaussian\" {work_dir}/<task>/*.log", "timeout_seconds": 30})
mat_exec({"cluster_id": "{cluster_id}", "command": "grep -n \"SCF Done:\" {work_dir}/<task>/*.log | tail", "timeout_seconds": 30})
```

- `g16` 找不到：确认 `GAUSSIAN_ENV_SCRIPT` 指向已 bootstrap 的 `$HOME/workspace/g16-hy/scripts/env.sh`。
- `run` 拒绝：确认 `GAUSSIAN_ENV_SCRIPT` 为无换行绝对路径，且 `resources.ncores`/`resources.memory` 不超过 Slurm 的 `ntasks_per_node`/`mem`。
- post 找不到 log：确认三阶段使用同一绝对 workdir、相同 CLI task 和结构输入；state 位于 `{work_dir}/<task>/.calcflow-phase.json`。
- `no pre phase state`：分步链模式混用（no-json pre 接了 json run）。按「分步链全程同模式」处置——整链从 pre 重跑，或改用 no-json pre 产物直接提交；不要把这个报错当 workflow 缺陷上报。
- l101 `Wanted an integer as input`（charge/mult 位读到字符串）：gjf 布局缺陷签名——route 段后出现双空行/空 route 行，标题被当电荷/多重读。1.3.5 前部署的已知缺陷（压测 D9）：停止使用该 pre 产物、如实向用户上报部署版本，**不要手改 gjf 掩盖**（原地修复还会销毁缺陷取证）。
- `error_detail.code = "VALIDATION_FAILED"`（输入契约类）：三种签名——① 结构文件元素标签带编号（`invalid element label 'H1'`）：xyz 元素列改纯元素符号后重跑 pre；② charge/mult 电子数奇偶不符（`gives N electrons … use mult=M`）：按 `suggested_actions` 设对 mult 重跑 pre；③ **phase JSON 路径落空**（`phase JSON payload not found: '<路径>'`，1.6.3 起）：`--json` 相对路径按 **cwd** 解析，按点名路径核对或补写（post 可用空对象 `echo '{}' > post.json`）——**禁止**未核对该路径前手改 gjf 或手工提取绕行（multistep-irc-0909 取证：standalone post 四连败全系此因）。均为 retryable，不需要换 workdir。
- tsxtb 作业 FAILED 且 job.out 出现 `xtb FAILED at this geometry` 守卫块（1.6.3 起）：xtb 在该几何点失败（常见 SCC 不收敛——`.sccnotconverged` 标记点名），直读其后 xtb stderr/xtbout 尾部取证，处方同 kb:ts-step-limit（改初猜/放弃 xtb 层直接进 DFT）；**不再解读** forrtl(24)/PGFIO-F-217——那是旧版网关无守卫时的级联签名（仍见于历史现场，根因同源）。
- 组合任务 run 阶段报引用旧时间戳的 `ConvergenceError`（读到上次失败作业残留的 job.log）：1.4.2 起 run 视其为上一波未完成——`warnings` 提示 stale/failed 并自动重渲染上一波 slurm.sh 供重提，**不需要再为解除阻塞手动清理残留 log**；「重跑同名额」的删除确认纪律不变。1.4.2 前部署：按删除边界列清单经用户确认后清理再重跑。
- fluorescence/resp 工具失败：检查 `Multiwfnpath`、`formchk` 和 checkpoint，不要吞错误。
- AEA 中间步骤缺失：按两波流程再次执行 `pre` 和 `run`，已完成步骤会复用/跳过。
- **一站式工具崩溃（`mat_gaussian` 报内部错误/无 job id 返回）**：远端动作可能**已经执行**（prepare→pre→run→sbatch 在工具返回前发生）。处置顺序：先用 `mat_job_status`（状态板）对账实际提交状态与 workdir 产物（必要时 `mat_exec` 查 `sacct`），再决定收尾方式——复用已产出 pre 产物的 workdir 走分步 `run`→`mat_sbatch`→`post`，或换新 workdir 重来。**禁止直接改 gjf / 手写输入文件绕过工具错误**（掩盖工具缺陷、绕开 workflow 输入契约）；向用户透明披露工具错误与对账结论，不静默降级（demo 压测 D1 教训）。
- **诊断实验约束**：格式定界/变体实验（空行格式、route 变体等）收敛到**单一 `diag/` 子目录**（`{work_dir}/diag/`）内逐个编号，不散落平级子目录；控制产物尺寸——诊断作业同样遵守 `ulimit -c 0`，不得在共享目录留下 core dump 或大体量中间物；结论得出后向用户报告并请求清理确认（tryA–J 十连目录 + 1.7GB core 教训）。
- **「重跑同名额」语境的删除边界**：用同名 workdir/task 重跑需要清掉旧产物（`g16.com`/`job.log`/`slurm-*.out` 等）时，仍先把将删路径列给用户确认——"我马上要重跑"不构成删除授权；只删确属本会话产物、且证据已从 result.json/log 取证的文件。
