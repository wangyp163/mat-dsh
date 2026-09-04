---
name: gaussian-calc
# description 禁半角冒号（技能开发指南 frontmatter 纪律）：裸标量遇 "冒号+空格" 会被 YAML
# 解析器拒掉、整个 skill 静默跳过——2026-08-28 e2e 排障定位，值里改用括号列举。
description: Use this skill for Gaussian 16 calculations through the calcflow-based gaussian-workflow CLI (sp, opt, freq, dipole, polar, tddft, fluorescence, resp, ts, qst2, qst3, irc, aea) and valid task compositions such as opt+sp, opt+freq and ts+irc. Generates Gaussian inputs, uses HPC tools to execute pre/post commands, upload files, submit and monitor Slurm jobs, and retrieves results.
version: 0.7.16-demo
metadata:
  adapted-for: mat-dsh
  source: ~/other-projects/vasp-matstream-agent/skills/debug-gaussian-calc@0.7.1-demo
  adaptation: 2026-08-28 将 mat-command-executor/mat-job-manager/mat-chat 的职责全部映射到 mat_exec；未随包 tests/ 与 scripts/check_skill_contract.py（其断言针对上游 SKILL.md 原文）；2026-08-28 M2 增补「一站式路径（mat_gaussian）」节与 mat_upload/mat_download 文件通道；2026-08-31 M3 门禁 heredoc 落盘模式 + 门禁黑盒/registry 探针禁令 + 一站式 job_output 终点收口（session c9d00865 排障）；2026-08-31 M4 rm/rm -rf/mv 全局用户确认 + 一站式/分步重试 workdir 语义（session f4f3d916 排障）；2026-09-01 M5 冗余精简：删 demo 直连节、协议判定旧协议史、快速定位部署配方；2026-09-01 M6 吸收 canonical v0.7.5 门禁版本锚（deployed/expected/newer_version），门禁改懒校验：远端常驻 .gaussian-calc/scripts 直达、heredoc 降级为播种/刷新（scripts/ 随包同步 canonical 并新增 env_profile.sh）；修正 bootstrap 命令块本机路径 bug；sinfo 输出 legend + 决策树 fallback 措辞修正；版本 0.7.7 为避免与 canonical v0.7.6（plots 契约，本血脉未含）撞号；2026-09-01 M7 吸收 canonical v0.7.6 plots 消费契约（result.json `plots` 数组：图+绘图数据两类路径报告、`image=null` 降级、无键向后兼容），速查表/一站式例外/决策树三处落地，配套远端 workflow 升 1.3.0（双 wheel force-reinstall + VERSION 锚，env_profile 三副本同步）；版本 0.7.8 续跳号；2026-09-02 M8 压测问题修复：默认 pre.json 去 task 路由键（路由身份由 task 决定，workflow 侧同步剥离异 task 键并升 1.3.1）、job_output 直读 plots（保留 result.json fallback）、producer 轮询默认封顶 30s（job_output 是轮询快照、完成通知才是终态权威）、一站式节内联纪律（不手动 squeue/sacct、不读 log 原文点名 grep/awk/sed/tail、task 即计算范围）；版本 0.7.9；2026-09-03 M9 吸收 canonical v0.7.8 过渡态搜索三件套（ts 补 freq 路由 + qst2/qst3 多帧 xyz 输入：structure/上传文件可含多帧、恰 1/2/3 帧语义、原子序号逐位一致、ts+irc 组合、imaginary_frequency_count equals=1 验收），配套远端 workflow 升 1.3.2；版本 0.7.10 续跳号避让 canonical v0.7.8；2026-09-03 M10 吸收 canonical v0.7.9 压测行为增补（多帧缺失禁历史补帧 C6、一站式崩溃先对账再分步收尾禁改 gjf D1、诊断实验收敛 diag/ 子目录 + 产物尺寸约束、重跑同名额删除边界）+ run 幂等新语义（命令段不一致整体重写、ulimit -c 0，D3/D2 配套 workflow 1.3.3），env_profile 三副本同步 1.3.3；版本 0.7.11-demo 续跳号避让 canonical v0.7.9；2026-09-03 M11 吸收 canonical v0.7.10（资源档语义 O1：resources 是作业资源档唯一来源、自建 pre.json 必填否则结构化报错、一站式内置默认档仅在不传 pre_json 时生效；确认闸必须阻塞式 question 禁文本收尾 O2——队列编排会越过文本等待点），配套远端 workflow 升 1.3.4（D8：post log 名从 phase state 解析，json pre + legacy post 混合模式不再找 g16.log），env_profile 同步 1.3.4；版本 0.7.12-demo 续跳号避让 canonical v0.7.10；2026-09-04 M12 吸收 canonical v0.7.13 分步链同模式纪律（D9：no-json pre 接 json run 的 no pre phase state 是契约报错、no-json run 为本地执行语义，集群分步只有全程 json 相位或 no-json pre 产物直接提交；l101 Wanted an integer 双空行布局签名禁手改 gjf 掩盖），description 去半角冒号（frontmatter 纪律），配套远端 workflow 升 1.3.5（D9 修复：空 extra 归一 None 杜绝空 route 行），env_profile 同步 1.3.5；版本 0.7.14-demo 续跳号避让 canonical v0.7.13；2026-09-04 M13 吸收 canonical v0.7.14 IRC 产物契约（irc_profile 升级为 Total energy along IRC 曲线——符号化反应坐标 path 1 正/path 2 负/TS=0、Link-123 逐点解析末次 SCF 为点能；新增 reaction_path R→TS→P 阶梯图 kcal/mol 垒高、IRC 分支端点+point 0 数据源、单向 irc 跳过语义；irc_point_count 属性；qst2+irc/qst3+irc 组合认证），配套远端 workflow 升 1.4.0（irc 专用解析器 read_irc_points + 两图渲染），env_profile 同步 1.4.0；版本 0.7.16-demo 续跳号避让 canonical v0.7.14
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
ts            过渡态优化（初猜结构 + 频率验证）
qst2          QST2 过渡态搜索（反应物+产物，两帧输入）
qst3          QST3 过渡态搜索（反应物+产物+TS 初猜，三帧输入）
irc           IRC
aea           绝热电子亲和能（多步）
```

也支持顺序组合 DSL，例如 `opt+sp`、`opt+freq`、`ts+irc`（IRC 消费 TS 的优化几何）。每个原子 task 必须已注册，组合不得含空项、重复项或未知项；最终结果 JSON 的 `task` 回显完整 DSL 字符串。`freq` 用于分子振动频率计算，不实现周期性 `phonon`。过渡态搜索三件套（`ts`/`qst2`/`qst3`）使用**多帧 xyz 单文件**输入，约定见「特殊 task」节。

所有集群操作统一通过 `mat_exec` 工具完成（在目标集群登录节点执行 shell 命令）。它是 JSON 参数工具，不是 shell 命令：调用形态为 `mat_exec({"cluster_id": "11250", "command": "<shell 命令>", "timeout_seconds": 30})`；下文代码块里的 `command` 值原样传给远端 shell。

- **破坏性命令必须先经用户确认**：任何 `rm`、`rm -rf`、`mv`（删除、覆盖或挪走既有文件/目录），以及清空 scratch、清理历史 workdir 等，**无论出现在哪个环节**（故障排查、磁盘空间不足、重试前清场）都一律先把目标路径列给用户、取得确认后再执行；未确认前只报告建议、不动手。非本会话创建的目录一律视为他人数据，同样不得自行删除。
- 环境门禁、`bootstrap`、workflow `pre/post`、只读检查：`mat_exec` 直接执行对应命令。
- 查询集群/队列（sinfo）、写输入文件（heredoc/cat）、提交 Slurm（sbatch）：同样经 `mat_exec`。
- **提交后的作业监控用 `mat_job_watch` 异步批量监控**：一次注册全部 job_id，不要手动 squeue/sacct 轮询（见"提交和监控"节）。
- **选项齐备的单作业计算优先 `mat_gaussian` 一站式**：一次调用完成输入落盘→pre→run→sbatch→监控→自动 post（见"一站式路径"节）；分步链路用于交互确认、多波组合与诊断。
- 需要读取集群上的文件时：`mat_exec` 执行 `cat`/`tail` 取回内容；需要把文件落到本机时用 `mat_download`（efile 通道，需 MAT 凭证环境变量），上传用 `mat_upload`。

HPC 凭据由工具管理，本 skill 不记录密码、AK/SK、服务器地址。

## 环境门禁（第一条业务命令）

不要分别搜索 Python、CLI、workflow 源码、协议、task registry 或 `g16` 路径。开始任何队列查询、上传、pre/run/post 前，先通过 `mat_exec` 在目标集群执行一次门禁脚本。

门禁脚本**常驻远端家目录**：`$HOME/workspace/.gaussian-calc/scripts/`（`check_environment.sh` + `env_profile.sh`，与本机 `<GAUSSIAN_CALC>/scripts/` 同版）。直达执行（冷启动可近 1 分钟，timeout 给足）：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": "bash $HOME/workspace/.gaussian-calc/scripts/check_environment.sh", "timeout_seconds": 180})
```

**仅当脚本缺失或代数旧时播种/刷新一次**：`mat_upload` 依赖 MAT 凭证不能作主通道，heredoc 是唯一无凭证内容通道。判旧标准：报 `SCRIPT_NOT_FOUND`，或 stdout JSON 不是 `gaussian-env-gate.v2`、缺 `deployed_version`/`expected_version`/`newer_version` 字段——字段集即脚本代数。刷新时 read 取本机 `<GAUSSIAN_CALC>/scripts/` 两个文件全文（仅为原样传输），heredoc 落到同一远端目录后重跑：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": "mkdir -p $HOME/workspace/.gaussian-calc/scripts && cat > $HOME/workspace/.gaussian-calc/scripts/env_profile.sh <<'GATE_EOF'
<env_profile.sh 全文，原样粘贴，不改一行>
GATE_EOF
cat > $HOME/workspace/.gaussian-calc/scripts/check_environment.sh <<'GATE_EOF'
<check_environment.sh 全文，原样粘贴，不改一行>
GATE_EOF
bash $HOME/workspace/.gaussian-calc/scripts/check_environment.sh", "timeout_seconds": 180})
```

脚本只做无副作用检查，不运行 `g16`、不提交 Slurm，stdout 只返回一个 `gaussian-env-gate.v2` 单行 JSON。例如：

```json
{"schema":"gaussian-env-gate.v2","ok":true,"workflow":"/public/home/hpc-user-a/workspace/demo","python":".../workspace/demo/bin/python","cli":".../workspace/demo/bin/gaussian-workflow","module":".../workspace/demo/lib/python3.11/site-packages/gaussian_workflow/__init__.py","protocol":"new","deployed_version":"1.3.5","expected_version":"1.3.5","newer_version":"","required_tasks":["aea",...,"qst2","qst3",...,"ts"],"tasks":["aea",...,"ts"],"missing_tasks":[],"task_count":14,"g16":"/public/home/hpc-user-a/workspace/g16-hy/scripts/env.sh","errors":[]}
```

`required_tasks` 是 skill 要求的公开 task 集，`missing_tasks` 是运行时实际缺失的 task；任何 `missing_tasks` 都会使 `ok=false`。

`deployed_version`/`expected_version` 是部署版本锚：前者读部署侧 `<workflow_root>/VERSION`，后者是 skill 侧 `env_profile.sh` 的期望。二者不等 → `errors` 含 `version_mismatch`；期望非空而部署侧无 VERSION → `version_unpinned`。两者都说明「本文档 vs 实际部署」已漂移：立即停止，先对齐再执行，不得带着版本漂移继续干活。

`newer_version` 是新鲜度提醒（warning，不影响 `ok`）：非空说明旁边有部署完整的更高版本而 skill 期望仍锚在旧版——当前会话继续按本文档执行，但把该提醒原样转告用户，由用户决定是否升级期望。

- `ok=true`：环境门禁通过；保存结果，本次会话不再查找环境或阅读源码，直接进入队列选择和计算。
- `ok=false`：立即停止。只根据 `errors` 报告缺失项；不得继续搜索源码、猜测 fallback、提交作业。若错误是 `g16_env_missing`/`g16_unavailable`，可按本文 bootstrap 指令修复一次，然后只重跑门禁。
- 可显式覆盖默认路径：`bash $HOME/workspace/.gaussian-calc/scripts/check_environment.sh <workflow_root> <g16_home>`。

门禁是黑盒，只看 stdout 的单行 JSON：

- **不要读脚本内容来理解它检查什么**——read 全文只为 heredoc 传输；判定一律以输出 JSON 为准，不复刻脚本内部的逐项检查（`--help`、python 探针、`inspect.getsource` 都算违规探测）。
- 远端报找不到脚本（如 `SCRIPT_NOT_FOUND`）或 JSON 缺版本字段时，唯一动作是按上述播种步骤 heredoc 落盘重跑门禁；不是降级为手工逐项检查环境。
- **不要用 python 探针自查 task registry**：task 注册是 `import gaussian_workflow` 的副作用，裸 `from calcflow.task.registry import list_tasks` **恒返回 `[]`**，据此判定"部署缺 task"必然误判。task 集只能信门禁 JSON 的 `tasks`/`missing_tasks`。

## 最小决策树

为避免重复探测、重复上传和无必要的报告生成，按以下顺序执行：

1. 运行上述环境门禁一次；它已经合并 workflow env、CLI、import、协议、registry 和 g16 runtime 检查。不要再逐项探测，也不要先阅读源码猜测运行时能力。
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
- `mat_job_watch`：把本轮全部 job_id **一次**注册为后台批量监控（服务端自适应轮询 sacct，无模型请求），全终态后收到会内完成通知。
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
  "partition": "Agent0",
  "options": {"max_wait_seconds": 3600}
})
```

- **前提**：环境门禁已通过且 g16 已 bootstrap（与分步链路同一条门禁，见上文）；一站式命令使用与本 skill 相同的 `workflow_env`/`GAUSSIAN_ENV_SCRIPT` 默认值，可用 `options.workflow_env`/`options.g16_env` 覆盖。
- **参数默认**：pre.json 默认 B3LYP/6-31G(d)、charge 0/mult 1、32 核/64GB，**不含任何 task 路由关键字**——opt/freq/td/irc 等路由身份由 `task` 参数唯一决定，`pre_json` 携带的异 task 路由键会被 workflow 剥离（1.3.1+）；run.json 默认 Agent0/1 节点/32 核/00:30:00/64GB。需要不同方法基组或资源时，经 `options.pre_json`/`options.run_json` 传**完整** phase 配置（结构同上文 pre.json/run.json 节；注意 `resources.ncores ≤ slurm.ntasks_per_node`、`resources.memory ≤ slurm.mem` 校验仍生效；task 自身路由键可在 JSON 中精调选项，如 `-t opt` 传 `"opt": ["Tight"]`）。
- **硬警告：显式构造 `pre_json` 时，路由键要么不写，要么只写 task 自身键且写全（JSON 值整体替换默认 route，不与默认叠加）**。两层机制要分清，后者与远端部署版本无关：
  - **异 task 路由键**：workflow 1.3.1+ 会剥离 `pre_json` 里不属于当前 task 的路由键（opt/freq/td/irc/polar/force/scan）；但 **<1.3.1 的已部署集群没有这层剥离**，异 task 键直接混入 route——`-t tddft` 被 JSON 里的 `opt`/`freq` 混成 `opt freq td` 三合一（压测 P4 实证）。
  - **task 自身路由键**：以 JSON 为准，**任何 workflow 版本都如此**。`-t ts` 的路由键就是 `opt`（默认 `opt(TS,CalcFC,NoEigenTest) freq`）、`-t irc` 就是 `irc`（默认 `irc(CalcFC,…)`）——在 `pre_json` 里写普通 `opt`/`irc` 走的是自身键精调路径，1.3.1 的异 task 剥离**不拦**，结果是把 TS/IRC 语义**静默掩蔽成普通 opt/irc**。
  - **处置**：`ts`/`qst2`/`qst3`/`irc`/`aea` 的 `pre_json` **一律不写路由键**（自身键 JSON 权威本是精调机制，对这几个 task 是坑）；`opt`/`freq` 等要精调时只写 task 自身键且写全，如 `-t opt` 传 `"opt": ["Tight","CalcFC"]`。路由身份只由 `task` 参数决定，调用侧不感知远端部署版本，按此写法两层风险都不沾。
- **返回即离手**：工具返回 slurm job id 与后台作业 id 后本轮即可结束；后台 producer 服务端轮询 sacct（无模型请求），**终态后自动执行 post 并解析**，会话内收到完成通知。
- **过渡态搜索（`ts`/`qst2`/`qst3`）的 `structure` 是多帧 xyz 字符串**：`ts` 一帧（TS 初猜）、`qst2` 两帧（反应物+产物）、`qst3` 三帧（反应物+产物+TS 初猜）——帧序 = 分子节序，各帧原子数与元素序号逐位一致，帧数或序号不符 pre 直接结构化报错。会话内按 `原子数\n注释\n坐标行\n` 逐帧拼接成 `structure` 值即可（heredoc 原样落盘 molecule.xyz，workflow 多帧读取）；`ts`/`qst2`/`qst3` 属单作业形态，可走一站式。post 报 `frequencies_cm-1`/`imaginary_frequency_count`，一阶鞍点确认由验收 `{"imaginary_frequency_count": {"equals": 1}}` 表达。TS→IRC 联动是 `ts+irc` 多波组合，**不支持一站式**，走分步链路（`qst2+irc` / `qst3+irc` 同理）。IRC 步 post 报 `irc_point_count` 并产两图：`irc_profile`（Total energy along IRC 曲线，符号化反应坐标 / path 1 正 / path 2 负 / TS 在 0）与 `reaction_path`（Reactant→TS→Product 阶梯图，kcal/mol 垒高，R/P 取 IRC 两分支端点、TS 取 point 0；单向 irc 无 R/TS/P 三元组时跳过并在 context 说明）。
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

Gaussian 频率结果可通过 `properties.frequencies_cm-1` 和 `properties.imaginary_frequency_count` 消费；若请求 acceptance `imaginary_frequency_count.equals = 0` 失败，执行状态仍可为 completed，但 workflow 状态为 needs_review，必须检查虚频后再决定是否继续。

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
   → 等作业完成（前一步 job.log 落盘）
   → 再次 run（自动读前一步 log，生成下一步输入与脚本）
   → 直到每个 step 都提交完成
   ```

   提交波数 = 组合 step 数。最终 `find "{work_dir}/<task>" -maxdepth 2 -name slurm.sh` 的数量应等于 step 数。
2. **post 结果按步骤加前缀**：多步组合的 properties 带步骤前缀 `opt.` 与 `sp.`，形如 `opt.energy`、`sp.energy`。post 后必须核对结果 `steps` 数组中**每个 step 的 post 都是 ok**，且 properties 里出现所有步骤的前缀。
3. **后续步骤属性缺失即组合未完成**：若 post 结果 `workflow.status == "needs_review"`、`next_action == "rerun_run_phase"`，且 warnings 含 `composition incomplete: pending steps [...]`——说明还有 step 没跑（通常漏了第 2 波）。此时**不得向用户报告计算完成**，应补跑漏掉的波次后重新 post。

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
<XYZ 结构内容，原子数行 + 每行元素符号与坐标>
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
mat_exec({"cluster_id": "{cluster_id}", "command": 'cd "{work_dir}" && source "$workflow_env" && gaussian-workflow -t opt -p run -i molecule.xyz -w "{work_dir}" --json run.json', "timeout_seconds": 300})
```

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

三个过渡态 task 共用**多帧 xyz 单文件**输入：`-i` 仍是**一个文件**（一站式即 `structure` 字符串多帧拼接），帧序 = Gaussian 分子节顺序，各帧原子数与元素序号必须逐位一致：

| task | 帧数 | route | 帧语义 |
|---|---|---|---|
| `ts` | 恰 1 | `opt(TS,CalcFC,NoEigenTest) freq` | 过渡态初猜 |
| `qst2` | 恰 2 | `opt(QST2,CalcFC) freq` | 反应物、产物（各自先优化过） |
| `qst3` | 恰 3 | `opt(QST3,CalcFC) freq` | 反应物、产物、TS 初猜 |

要点：

- **帧数或元素序号不符 → pre 直接结构化报错**，不静默截断；多帧文件交给单结构 task（如 `opt`）时取第 1 帧。
- **多帧输入缺失/帧数不符时，把 pre 的结构化报错原样透出，或向用户索要缺失帧——禁止从会话历史、旧 workdir 或先前 case 的产物"补帧"凑数**。用户说"就这一个结构"就是一帧，不得替用户脑补第二帧；科学结果正确不豁免输入保真度违约（demo 压测 C6 教训）。
- **原子序号必须严格一致**：反应物和产物的同一原子在两帧中必须同位（Gaussian QST 硬要求）；各几何节共用同一 `charge`/`mult`。
- post 报 `frequencies_cm-1`、`imaginary_frequency_count`，并导出 `g16_initial.xyz` 与 `g16_optimized.xyz`（优化后 TS 几何）。**一阶鞍点确认（恰好一个虚频）由验收声明表达**：`"acceptance": {"imaginary_frequency_count": {"equals": 1}}`；count≠1 时 post 只在 context 警示，不判失败。
- TS→IRC 联动用组合 `ts+irc`（多波，分步链路）：IRC 步消费 TS 的**优化后**几何（`g16_optimized.xyz`），不是初猜。

### fluorescence

无 JSON 默认：`B3LYP/aug-cc-pVDZ` + `TD(nstates=10)`。post 解析最后一个 `Excited State 1`，报告：

```text
fluorescence_energy_ev
wavelength_nm
oscillator_strength
```

同时使用 `Multiwfn` 生成 `spectrum_curve.txt`、`spectrum_line.txt` 等光谱产物。Multiwfn 不可用或退出失败时，post 必须报告失败，不能伪装成完整光谱成功。

### resp

无 JSON 默认：`B3LYP/def2TZVP`、溶剂/色散设置；轻元素体系追加 `pop=MK` 和对应 IOp。post 顺序：

```text
Gaussian log 正常终止
→ formchk g16.chk g16.fchk
→ Multiwfn RESP 菜单
→ 解析 .chg
→ 写 *_resp.chg
```

RESP 电荷数量必须等于原子数。缺 checkpoint、`formchk` 失败、Multiwfn 失败或数量不匹配都应报错。

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
| `ts` | `opt(TS,CalcFC,NoEigenTest) freq`，恰 1 帧输入，需要合理 TS 初猜 |
| `qst2` | `opt(QST2,CalcFC) freq`，恰 2 帧输入（反应物+产物，原子序号一致） |
| `qst3` | `opt(QST3,CalcFC) freq`，恰 3 帧输入（反应物+产物+TS 初猜） |
| `irc` | `irc(calcfc)`，需要 TS 几何 |
| `aea` | 四步内建 recipe |

TS→IRC 联动用组合 `ts+irc`（IRC 消费 TS 的优化几何）；单独跑 `irc` 仍需精确 TS 起点，普通稳定分子不能直接作为 IRC 起点。

## 故障排查

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
- fluorescence/resp 工具失败：检查 `Multiwfnpath`、`formchk` 和 checkpoint，不要吞错误。
- AEA 中间步骤缺失：按两波流程再次执行 `pre` 和 `run`，已完成步骤会复用/跳过。
- **一站式工具崩溃（`mat_gaussian` 报内部错误/无 job id 返回）**：远端动作可能**已经执行**（prepare→pre→run→sbatch 在工具返回前发生）。处置顺序：先用 `mat_job_status`（状态板）对账实际提交状态与 workdir 产物（必要时 `mat_exec` 查 `sacct`），再决定收尾方式——复用已产出 pre 产物的 workdir 走分步 `run`→`mat_sbatch`→`post`，或换新 workdir 重来。**禁止直接改 gjf / 手写输入文件绕过工具错误**（掩盖工具缺陷、绕开 workflow 输入契约）；向用户透明披露工具错误与对账结论，不静默降级（demo 压测 D1 教训）。
- **诊断实验约束**：格式定界/变体实验（空行格式、route 变体等）收敛到**单一 `diag/` 子目录**（`{work_dir}/diag/`）内逐个编号，不散落平级子目录；控制产物尺寸——诊断作业同样遵守 `ulimit -c 0`，不得在共享目录留下 core dump 或大体量中间物；结论得出后向用户报告并请求清理确认（tryA–J 十连目录 + 1.7GB core 教训）。
- **「重跑同名额」语境的删除边界**：用同名 workdir/task 重跑需要清掉旧产物（`g16.com`/`job.log`/`slurm-*.out` 等）时，仍先把将删路径列给用户确认——"我马上要重跑"不构成删除授权；只删确属本会话产物、且证据已从 result.json/log 取证的文件。
