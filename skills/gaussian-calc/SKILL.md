---
name: gaussian-calc
# description 必须整体加引号：值里含 "CLI: sp"（冒号+空格），裸标量会被 YAML frontmatter
# 解析器拒掉，整个 skill 静默跳过（2026-08-28 e2e 排障定位）。
description: 'Use this skill for Gaussian 16 calculations through the calcflow-based gaussian-workflow CLI: sp, opt, freq, dipole, polar, tddft, fluorescence, resp, ts, irc, aea, and valid task compositions such as opt+sp and opt+freq. Generates Gaussian inputs, uses HPC tools to execute pre/post commands, upload files, submit and monitor Slurm jobs, and retrieves results.'
version: 0.7.1-demo
metadata:
  adapted-for: mat-dsh
  source: ~/other-projects/vasp-matstream-agent/skills/debug-gaussian-calc@0.7.1-demo
  adaptation: 2026-08-28 将 mat-command-executor/mat-job-manager/mat-chat 的职责全部映射到 mat_exec；未随包 tests/ 与 scripts/check_skill_contract.py（其断言针对上游 SKILL.md 原文）
---

# Gaussian 工作流

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
ts            过渡态优化
irc           IRC
aea           绝热电子亲和能（多步）
```

也支持顺序组合 DSL，例如 `opt+sp`、`opt+freq`。每个原子 task 必须已注册，组合不得含空项、重复项或未知项；最终结果 JSON 的 `task` 回显完整 DSL 字符串。`freq` 用于分子振动频率计算，不实现周期性 `phonon`。

所有集群操作统一通过 `mat_exec` 工具完成（在目标集群登录节点执行 shell 命令）。它是 JSON 参数工具，不是 shell 命令：调用形态为 `mat_exec({"cluster_id": "11250", "command": "<shell 命令>", "timeout_seconds": 30})`；下文代码块里的 `command` 值原样传给远端 shell。

- 环境门禁、`bootstrap`、workflow `pre/post`、只读检查：`mat_exec` 直接执行对应命令。
- 查询集群/队列（sinfo）、写输入文件（heredoc/cat）、提交 Slurm（sbatch）：同样经 `mat_exec`。
- **提交后的作业监控用 `mat_job_watch` 异步批量监控**：一次注册全部 job_id，不要手动 squeue/sacct 轮询（见"提交和监控"节）。
- 需要读取集群上的文件时：`mat_exec` 执行 `cat`/`tail` 取回内容，不另行下载通道。

HPC 凭据由工具管理，本 skill 不记录密码、AK/SK、服务器地址。

## 环境门禁（第一条业务命令）

不要分别搜索 Python、CLI、workflow 源码、协议、task registry 或 `g16` 路径。开始任何队列查询、上传、pre/run/post 前，先通过 `mat_exec` 在目标集群执行一次：

```bash
bash <GAUSSIAN_CALC>/scripts/check_environment.sh
```

脚本只做无副作用检查，不运行 `g16`、不提交 Slurm，stdout 只返回一个 `gaussian-env-gate.v2` 单行 JSON。例如：

```json
{"schema":"gaussian-env-gate.v2","ok":true,"workflow":"/public/home/hpc-user-a/workspace/demo","python":".../workspace/demo/bin/python","cli":".../workspace/demo/bin/gaussian-workflow","module":".../workspace/demo/lib/python3.11/site-packages/gaussian_workflow/__init__.py","protocol":"new","required_tasks":["freq","opt"],"tasks":["freq","opt"],"missing_tasks":[],"task_count":2,"g16":"$HOME/workspace/g16-hy/scripts/env.sh","errors":[]}
```

`required_tasks` 是 skill 要求的公开 task 集，`missing_tasks` 是运行时实际缺失的 task；任何 `missing_tasks` 都会使 `ok=false`。

- `ok=true`：环境门禁通过；保存结果，本次会话不再查找环境或阅读源码，直接进入队列选择和计算。
- `ok=false`：立即停止。只根据 `errors` 报告缺失项；不得继续搜索源码、猜测 fallback、提交作业。若错误是 `g16_env_missing`/`g16_unavailable`，可按本文 bootstrap 指令修复一次，然后只重跑门禁。
- 可显式覆盖默认路径：`bash check_environment.sh <workflow_root> <g16_home>`。

## 最小决策树

为避免重复探测、重复上传和无必要的报告生成，按以下顺序执行：

1. 运行上述环境门禁一次；它已经合并 workflow env、CLI、import、协议、registry 和 g16 runtime 检查。不要再逐项探测，也不要先阅读源码猜测运行时能力。
2. 任务能力必须与部署一致：skill 声明支持 `freq` 时，若 registry 缺少 `freq`，立即停止并报告部署版本漂移，不能静默改用旧实现。
3. `opt+freq` 必须使用公开的 composition DSL；不得退化为 `-t opt` 加隐藏的 `calculator_kwargs.freq` route hack。只有用户明确要求兼容旧部署时，才可说明该差异，不得自动执行 fallback。
4. 结构或配置文件上传前先做一次远端存在性和内容校验；若共享文件系统已可见，跳过上传，不重复复制。
5. 计算完成后默认返回结构化结果和关键产物路径；只有用户明确要求正式报告时，才生成额外 Markdown 报告。
6. 队列查询只需一次。若返回不完整，使用一次明确的只读 fallback（例如 `sinfo`），仍无法确认时交给用户选择，不循环尝试。

## 执行模型

生产集群的 phase 生命周期由外部作业管理器串联：

```text
pre → run → mat_exec 提交（sbatch）→ mat_job_watch 批量异步监控 → post
```

- `pre`：读取结构和可选 `pre.json`，生成 Gaussian 输入及 task-local state；不提交作业，也不报告最终物性。
- `run`：读取 state 与可选 `run.json`，仅生成或更新 `slurm.sh`；**不在登录节点执行 `g16`**。
- `mat_exec`：提交（sbatch）已生成的 Slurm 脚本；集群检查、文件操作也经它。
- `mat_job_watch`：把本轮全部 job_id **一次**注册为后台批量监控（服务端自适应轮询 sacct，无模型请求），全终态后收到会内完成通知。
- `post`：验证 Gaussian 正常终止和任务所需收敛，解析完成的输出并返回结构化结果。

Slurm 脚本中的计算命令仍是：

```bash
g16 < input_file > output_file
```

不依赖 `g16_run.sh`、Apptainer、SIF 或外层 `srun`。Gaussian 并行由输入文件 `%nprocshared` 控制。

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
| 集群 pre/post 环境 | `$HOME/workspace/demo/env.sh` | **双 wheel 新协议部署（demo debug 环境）**：与 141 的 `/public` 公共部署不同，workflow 不放 public，而是**与 bootstrap 后的 g16 同在用户 workspace**。conda-pack 环境 + 两个独立 wheel（先装 `calcflow`，再装 `gaussian-workflow`）；source 后 `gaussian-workflow` 跑新协议（顶层对象 pre.json / 禁 `--idempotency-id` / AEA 子目录各份 slurm / post `{}`）。无需上传源码或手动设 `PYTHONPATH` |
| g16 runtime | `$HOME/workspace/g16-hy/scripts/env.sh` | bootstrap 后的用户副本；**仅**经 `GAUSSIAN_ENV_SCRIPT` 由 `run` 写入 slurm.sh，pre/post 不 source |

两类环境互不混淆：pre/post 用部署的 workflow Python 环境（下文记作变量 `workflow_env`）；g16 计算用用户副本（仅 slurm 作业内 source，经 `GAUSSIAN_ENV_SCRIPT` 传入）。`workflow_env` 与 `GAUSSIAN_ENV_SCRIPT` 指代的是**两个不同的 env.sh**，不可互换。

### demo debug 集群（直连，不走 HPC）

> **mat-dsh 适用范围（2026-08-28）**：以下为上游作者的 ssh 直连调试环境。本 harness 的集群通道是 mat_exec（HPC 集群，如 11250）；仅当用户明确要求操作 demo 调试机且本机已配 ssh 时才按下述直连方式执行。

本 debug skill 部署在 **demo**（`cancon.internal-hpc.example:65023`，user `hpc-user-a`，登录节点 login01，CentOS 7 / glibc 2.17，Slurm 在 `/opt/gridview/slurm/bin`）。开发机 `~/.ssh/config` 已配别名，**所有远程命令、部署更新、文件传输、作业提交监控一律直连 `ssh demo`**，HPC 工具链（mat-command-executor / mat-job-manager / mat-chat）在本集群不可用。与下文"HPC 完整执行链路"的对应关系：

| HPC 工具动作 | demo 直连等价命令 |
|---|---|
| `mat-command-executor` 执行远程命令 | `ssh demo '<command>'` |
| `mat-job-manager upload-file` | `scp <local> demo:{work_dir}/` |
| `mat-job-manager submit-job` | `ssh demo 'cd {work_dir}/<task> && sbatch slurm.sh'` |
| `mat-job-manager monitor-job` | `ssh demo 'squeue -j <job_id>'`（离开队列后用 `sacct -j <job_id>`） |
| `mat-chat` 下载产物 | `scp demo:<remote_path> <local>` |

布局约定（debug 环境命名 `demo`）：g16 副本与 workflow 同在用户 workspace，**不放 `/public` 公共目录**：

```text
$HOME/workspace/g16-hy/          # bootstrap 后的 g16 副本（scripts/env.sh）
$HOME/workspace/demo/           # 本 debug 环境：conda-pack + 双 wheel
├── env.sh                       # source 后 gaussian-workflow 进 PATH
├── bin/python                   # conda-pack Python 3.11
└── wheels/                      # calcflow + gaussian-workflow 双 wheel 离线副本
```

**更新 workflow（开发机 → demo）**：在 `mat-aitool` 仓库根构建双 wheel 并 conda-pack，scp 上传后解包到 `$HOME/workspace/demo`，用 `$HOME/workspace/demo/bin/python` 离线安装（`calcflow` 在前、`gaussian-workflow` 在后），再重跑环境门禁确认。日常 debug 迭代只需**轻量更新**（只换 wheel，不动 conda-pack 环境）：

```bash
# 开发机：重建 wheel → 传到集群 staging（注意用 $HOME 下的共享目录）
./scripts/build_workflow_wheels.sh gaussian-workflow /tmp/demo-wheels
scp /tmp/demo-wheels/*.whl demo:workspace/.demo-deploy/
# 集群：覆盖 wheels/ 副本并强制重装（CalcFlow 在前）
ssh demo 'set -e; cp ~/workspace/.demo-deploy/*.whl ~/workspace/demo/wheels/ &&
  ~/workspace/demo/bin/python -m pip install --no-index --no-deps --force-reinstall ~/workspace/demo/wheels/calcflow-*.whl &&
  ~/workspace/demo/bin/python -m pip install --no-index --no-deps --force-reinstall ~/workspace/demo/wheels/gaussian_workflow-*.whl'
```

**坑：cancon.internal-hpc.example 轮询解析多个登录节点（login01/03/09...），`/tmp` 是节点本地的**——两次 ssh 可能落在不同节点。任何要跨命令/跨会话存活的文件（上传、staging、工作目录）放 `$HOME`（共享存储），不要放 `/tmp`。

CLI 是否可用、支持哪些 task、是否新协议，都由环境门禁一次性回答，**不要**再用 `--help` 或试跑命令逐项探测。

### 协议判定

本文档描述的是 gaussian-workflow **新协议**：`pre.json` 顶层对象、`post.json` 空对象 `{}`、禁用 `--idempotency-id`、AEA 每个就绪子目录各一份 `slurm.sh`、无 manifest 缓存。**集群部署版可能滞后于此**（旧版为顶层列表、`post.json` 空列表 `[]`、需 `--idempotency-id`、AEA 顶层单脚本 + manifest 缓存）。两套协议不兼容——按新文档跑旧部署版会每一步报错（`must be a top-level list`、顶层 `slurm.sh` 指向不存在的 `job.gjf`、第二波被 manifest 挡住等）。

**协议由环境门禁的 `protocol` 字段判定**：`check_environment.sh` 返回 `"protocol":"new"` 即新协议，按本文档继续；`"protocol":"old"` 或 `protocol_not_new` 错误 → 部署版为**旧协议**，**立即停止**，告知用户：集群 gaussian-workflow 需**升级**到新协议版本后方可按本 skill 执行。**不要**为此读 workflow 源码、跑自定义 python 探针或做等价性试验——门禁已经给出答案。

**旧协议下禁止**：不得用 `edit_file` 改 `slurm.sh`、`mv manifest.json`、把 `pre.json`/`post.json` 临时改成顶层列表等手段把旧部署版**硬适配**成本文档流程——那只是掩盖协议漂移、结果不可复现。唯一正确处置是先升级部署版，再按本文档从头执行。

Gaussian 频率结果可通过 `properties.frequencies_cm-1` 和 `properties.imaginary_frequency_count` 消费；若请求 acceptance `imaginary_frequency_count.equals = 0` 失败，执行状态仍可为 completed，但 workflow 状态为 needs_review，必须检查虚频后再决定是否继续。

Gaussian 16 需要用户目录副本。首次使用时，通过 `mat_exec` 执行：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": "bash <GAUSSIAN_CALC>/scripts/bootstrap_g16.sh", "timeout_seconds": 600})
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

`pre.json` 不得含 `task`、`structure`、`id` 或 `parameters` 包装；这些路由信息只能来自 CLI。`resources` 是 **Gaussian 专属** 输入字段，必须同时提供正整数 `ncores` 与带 `MB`、`GB` 或 `TB` 单位的正内存值：

```text
resources.ncores → %nprocshared
resources.memory → %mem
```

不得在 `ase.calculator_kwargs` 中提供旧的 `nprocshared` 或 `mem`。不传 `--json` 时使用既有 calculator 默认值。

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

`post` 从 `{work_dir}/<task>/.calcflow-phase.json` 恢复参数和结构副本，读取完成的 log。它只在正常终止且所需收敛存在时报告结果。每个 phase 均向 stdout 输出一个 JSON 对象；其中至少包含 `software`、`task`、`phase`、`status`、`files`、`slurm`、`properties`、`error`。错误结果仍保留 CLI 的完整 `task`，且 `files`/`images` 为空。

## Slurm 产物契约

`run` 阶段读取 `run.json` 的 `slurm` 字段和 `GAUSSIAN_ENV_SCRIPT` 环境变量，渲染或更新 `slurm.sh`，脚本内的计算命令恒为 `g16 < input > log`。**`run` 不执行 `g16`，也不提交作业**；它的唯一产物是 `slurm.sh` 文件，提交由 `mat_exec` 完成（sbatch），监控由 `mat_job_watch` 完成（异步批量）。

`run` 一次产出 `slurm.sh` 的份数取决于 task 形态，agent 据此决定提交次数：

| task 形态 | `run` 产出的脚本 | agent 提交 |
|---|---|---|
| 单步（`opt`/`sp`/`tddft`/...） | `{work_dir}/<task>/slurm.sh` **一份** | `submit-job` 一次 |
| `opt+freq`（单作业组合） | `{work_dir}/opt+freq/slurm.sh` **一份** | `submit-job` 一次 |
| 顺序组合（如 `opt+sp`） | 每个已就绪 step 子目录（`01-opt/`、`02-sp/`）**各一份** | 每个 step 各 `submit-job` 一次 |
| `aea` | 当前已就绪子目录（见下"两波"）**各一份** | 每个子目录各 `submit-job` 一次 |

脚本内的 `source` 行来自 `GAUSSIAN_ENV_SCRIPT`（g16 runtime，不是 `workflow_env`）；`partition`/`nodes`/`ntasks_per_node`/`mem` 等来自 `run.json.slurm`。若 `slurm.sh` 已存在，`run` 仅更新 `#SBATCH` 指令，不改命令行。

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

完整链路：**上传 → pre → run（生成 slurm.sh）→ sbatch 提交 → mat_job_watch 异步批量监控 → post → 下载**。其中 bootstrap、pre/run/post 与只读核查均经 `mat_exec` 执行业务命令；查询集群/队列、上传文件（heredoc 写入）、提交作业（sbatch）同样经 `mat_exec`，作业监控经 `mat_job_watch`（完成通知到达前不手动轮询）。**HPC 凭据由 mat_exec 自管，本 skill 不写死任何 AK/SK/用户名/服务器地址。**

### 约定

- `{work_dir}`：本 skill 所涉计算的工作目录（系统给定，**绝对路径**）。存为变量后，**全流程 Step 0–6 用同一值、原样复用**——远端 shell 无持久 cwd，故每条远程命令前置 `cd "{work_dir}" &&`。子目录（`opt/`、`aea/01-neutral-opt/` 等）由 gaussian-workflow 自建。
- `{cluster_id}`：HPC 集群 ID（示例 11250，华东一区昆山），从对话/上下文获取，**永久保存到上下文**，后续直接复用、不再询问。
- `{partition}`：SLURM 分区（队列），**涉及计费，不写死、不自动选**——Step 0 经 `sinfo` 采集、由用户确认后保存。它仅写进 `run.json.slurm.partition`，由 `run` 渲染进 `slurm.sh` 的 `#SBATCH -p`。
- `workflow_env`：部署的 workflow Python 环境（值见"环境与部署"，`$HOME/workspace/demo/env.sh`，新协议双 wheel 部署）。pre/run/post 命令前 `source "$workflow_env"` 拿到跑新协议的 `gaussian-workflow`。
- `GAUSSIAN_ENV_SCRIPT`：g16 runtime（bootstrap 后的 `$HOME/workspace/g16-hy/scripts/env.sh`），**仅**由 `run` 写进 slurm.sh 供作业内 source；pre/post 不 source 它。
- **所有命令经 `mat_exec` 在目标集群登录节点执行**，无 MAT_SANDBOX 路由概念，也无 access-key/secret-key/user 参数。
- **下载产物**：需将 log、优化结构、RESP 电荷、光谱文件取回本地时，经 `mat_exec` 执行 `cat`/`tail` 读取内容（文本产物）。

### 0. 确认集群和队列（确定 `{cluster_id}` + `{partition}`，完成后永久保存）

经 `mat_exec` 采集，**完成后把 `{cluster_id}` 与用户选定的 `{partition}` 永久保存到上下文**，后续 1–6 步直接复用、不再询问：

```bash
# 集群：从对话/上下文获取（示例 11250，华东一区昆山），无需列出
# 队列：查询选定集群的可用队列，交用户确认（涉及计费，勿自动选）
mat_exec({"cluster_id": "{cluster_id}", "command": "sinfo -o '%P %a %l %D %t %N'", "timeout_seconds": 30})
```

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

- **只有全部作业终态后才执行 post。** 表里有 FAILED/CANCELLED/TIMEOUT 时先经 `mat_exec` 查 log（`grep "Normal termination"`），不要直接重提。
- `job_kill` 只取消**监控**，不会取消集群作业本身；要终止作业必须显式 `mat_exec` 执行 `scancel <job_id>`。
- `max_wait_seconds`（默认 86400）到点仍未全终态时监控按 `max-wait exceeded; still active: ...` 正常结束——再调一次 `mat_job_watch` 续盯即可，不是错误。
- 同一会话连续 3 次自动唤醒后，后续完成通知会转为注入（不再新开轮次）；收尾前用 `job_list` / `job_output` 对账一次。

### 5. 远程执行 post（经 `mat_exec`）

通过 `mat_exec` 执行 post 命令：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": 'cd "{work_dir}" && source "$workflow_env" && gaussian-workflow -t opt -p post -i molecule.xyz -w "{work_dir}" --json post.json', "timeout_seconds": 300})
```

读取 stdout 的结果 JSON。对于 JSON 以外的默认参数，可省略 `--json`，但 `-t/-p/-i/-w` 仍必须提供。

### 6. 下载产物（经 `mat_exec`）

需将 log、优化结构、RESP 电荷、光谱文件等取回本地时，通过 `mat_exec` 执行 `cat` 命令读取内容（文本产物）：

```bash
# 读取 log 文件（检查正常终止、SCF 收敛等）
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/opt/job.log", "timeout_seconds": 60})

# 读取优化后的结构
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/opt/g16_optimized.xyz", "timeout_seconds": 30})

# 读取 RESP 电荷文件
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/opt/*_resp.chg", "timeout_seconds": 30})

# 读取光谱文件
mat_exec({"cluster_id": "{cluster_id}", "command": "cat {work_dir}/opt/spectrum_curve.txt", "timeout_seconds": 30})
```

对于大文件，可使用 `tail` 读取末尾部分：

```bash
# 只读取 log 文件的末尾 100 行（通常包含收敛信息和正常终止标记）
mat_exec({"cluster_id": "{cluster_id}", "command": "tail -n 100 {work_dir}/opt/job.log", "timeout_seconds": 30})
```

## 特殊 task

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
| `ts` | `opt(ts)`，需要合理 TS 几何 |
| `irc` | `irc(calcfc)`，需要 TS 几何 |
| `aea` | 四步内建 recipe |

TS/IRC 不自动完成 TS→IRC；普通稳定分子不能直接作为 IRC 起点。

## 故障排查

```bash
grep -n "Normal termination of Gaussian" {work_dir}/<task>/*.log
grep -n "SCF Done:" {work_dir}/<task>/*.log | tail
```

- `g16` 找不到：确认 `GAUSSIAN_ENV_SCRIPT` 指向已 bootstrap 的 `$HOME/workspace/g16-hy/scripts/env.sh`。
- `run` 拒绝：确认 `GAUSSIAN_ENV_SCRIPT` 为无换行绝对路径，且 `resources.ncores`/`resources.memory` 不超过 Slurm 的 `ntasks_per_node`/`mem`。
- post 找不到 log：确认三阶段使用同一绝对 workdir、相同 CLI task 和结构输入；state 位于 `{work_dir}/<task>/.calcflow-phase.json`。
- fluorescence/resp 工具失败：检查 `Multiwfnpath`、`formchk` 和 checkpoint，不要吞错误。
- AEA 中间步骤缺失：按两波流程再次执行 `pre` 和 `run`，已完成步骤会复用/跳过。
