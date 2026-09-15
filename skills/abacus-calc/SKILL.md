---
name: abacus-calc
# description 禁半角冒号（frontmatter 纪律，同 gaussian-calc）。
description: Use this skill for ABACUS first-principles calculations through the calcflow-based abacus-workflow CLI (relax, jdos, shg, shift, bcd, anc, ahc, wl, mei, chern, surface_states, hseband, eos, phthermo, bc). Generates ABACUS inputs (INPUT/STRU/KPT plus pseudopotentials), uses HPC tools to execute pre/run/post commands, submit and monitor Slurm jobs, and retrieves structured results.
version: 0.2.1-demo
metadata:
  adapted-for: mat-dsh
  source: ~/dev/mat-aitool/skills/abacus-calc@0.2.1
  adaptation: 2026-09-05 首版 dsh 适配（镜像 gaussian-calc 范式）——mat-command-executor/mat-job-manager/mat-chat 职责全部映射到 mat_exec + mat_partitions + mat_sbatch + mat_job_watch + mat_upload/mat_download；环境门禁先行（$HOME/workspace/.abacus-calc/scripts/check_environment.sh，abacus-env-gate.v1）；主链路改 --json 三阶段协议（run 阶段由 workflow 渲染 slurm.sh，替代 skill 模板 sed）；无一站式工具（abacus 无 mat_abacus），一律分步链路；新增 demo OPAL_PREFIX 毒丸与 ABACUS_MPI_LAUNCHER 两条已知坑；pyatb 二阶段后处理暂不在 dsh 链路覆盖（templates 保留参考）；2026-09-07 v0.2.1 吸收 plots 契约（relax → scf_convergence + relax_energy 两图，CSV 权威/image 可降级 null/artifacts+events/steps 进 result.json，配套远端 workflow 升 0.2.1），结果消费节按 post-plotting-standard §6 改写（abacus 无 producer 透传，直读 result.json plots 键为唯一通道）
---

# ABACUS 工作流

## 产品边界：本地 skill 与 HPC 远端 workflow

本 skill 是本地 dsh 插件的一部分，负责理解用户意图、校验并生成声明式的 `pre.json`/`run.json`/`post.json` 控制数据，以及解释 `result.json`。ABACUS workflow 的执行包、软件环境、赝势库和 Slurm 运行时属于 HPC 一侧的商品，**不得把 workflow 源码或执行包上传到远端**。

ABACUS（Atomic-orbital Based Ab-initio Computation at UStc）第一性原理计算工作流，15 种计算任务（结构弛豫、电子结构、光学与拓扑性质、磁性与声子热力学），v0.2.0 起 calcflow 化：`--json` 三阶段协议（stdout 末行恒为 calcflow.result.v1 结果 JSON）+ 任务注册表。

## 环境激活（先读）

执行任何命令前，先激活环境。ABACUS 与 gaussian 不同，**只有一个环境**——workflow CLI（`abacus-workflow`）与 `abacus` 二进制、SG15 赝势库、OpenMPI 都在同一个 env：

| 环境 | 作用 | 激活方式 |
|---|---|---|
| **workflow_env** | 提供 `abacus-workflow` 命令 + `abacus` 二进制 + 赝势库 + MPI | 登录节点执行 `source $HOME/workspace/demo-abacus/env.sh` |

要点：

- **每条 `abacus-workflow -p ...` 命令前都要 source workflow_env**（同一 shell 一次即可；`mat_exec` 每次调用都是新 shell，所以每条都要带）。
- **run 阶段（渲染 slurm.sh）需要 `ABACUS_ENV_SCRIPT`** 指向同一 env.sh 的绝对路径：`export ABACUS_ENV_SCRIPT="$HOME/workspace/demo-abacus/env.sh"`。slurm 作业内由它激活 abacus 运行时；agent 永不在登录节点直接跑 `abacus` 计算命令。
- agent 无需定位 `abacus` 可执行文件路径——env.sh 全部搞定。
- **集群毒丸**：demo 的集群 profile 会注入 hpcx 的 `OPAL_PREFIX`，污染 conda OpenMPI 组件加载（表象 `mpirun: Error: unknown option "-np"`）。env.sh 已内置清毒；若你在任意 shell 里看到该表象，说明绕过了 env.sh，回到 env.sh 激活即可，不要自行排查 MPI。

## 可用任务（15 个，无 scf）

| 类别 | 任务 `-t` | 后处理 |
|---|---|---|
| 基础 | `relax`（结构弛豫）、`hseband`（HSE 能带）、`eos`（状态方程） | relax 画能量图；hseband 用 pyatb |
| 光学 | `jdos`、`shg`、`shift` | pyatb（二阶段 slurm，暂不在本链路） |
| 拓扑 | `bc`、`bcd`、`ahc`、`anc`、`wl`、`chern`、`surface_states` | pyatb（同上） |
| 磁性/热力学 | `mei`（TB2J）、`phthermo`（phonopy） | 外部工具链 |

> **无独立 `scf` 任务**：拓扑/光学任务各自 pre 阶段直接生成 SCF 输入。任务目录名例外：`surface_states` 的产物目录是 `surface-states/`（连字符）。

全部集群操作统一通过 `mat_exec` 工具完成。它是 JSON 参数工具，不是 shell 命令：调用形态 `mat_exec({"cluster_id": "{cluster_id}", "command": "<shell>", "timeout_seconds": 60})`。

- **破坏性命令必须先经用户确认**：任何 `rm`、`rm -rf`、`mv`、清空 scratch，无论哪个环节，先把目标路径列给用户确认。非本会话创建的目录一律视为他人数据。
- 上传结构文件用 `mat_upload`（或小文件经 `mat_exec` heredoc 落盘）；取回结果用 `mat_download` 或 `mat_exec cat`。
- **提交后作业监控用 `mat_job_watch`**（一次注册全部 job id，异步批量），不要手动 squeue/sacct 轮询；终态后用一次 `job_output` 读结果。
- 凭据由工具管理，本 skill 不记录任何密钥、AK/SK、服务器地址。

## 环境门禁（第一条业务命令）

不要分别搜索 Python、CLI、registry、赝势路径。开始任何队列查询、上传、pre/run/post 前，先执行一次门禁：

```bash
mat_exec({"cluster_id": "{cluster_id}", "command": "bash $HOME/workspace/.abacus-calc/scripts/check_environment.sh", "timeout_seconds": 180})
```

通过条件：stdout 单行 JSON `abacus-env-gate.v1` 的 `ok=true`、`protocol=new`、`deployed_version == expected_version`、`missing_tasks == []`。失败立即停止本轮，先修复（部署/环境/版本漂移三类），不试跑任何任务。仅当远端报 `SCRIPT_NOT_FOUND` 或 JSON 缺 `deployed_version` 字段时，读本机 `<ABACUS_CALC>/scripts/` 两文件 heredoc 播种一次后重跑（仅一次）。

## 标准链路（分步，--json 三阶段协议）

`pre → run → sbatch → mat_job_watch → post`，全程 `{work_dir}` 为绝对路径且每条命令带 `cd "{work_dir}" &&` 前缀（远端 shell 无持久 cwd）：

1. **上传结构**（POSCAR/.cif/STRU）到 `{work_dir}`。
2. **pre**：
   ```bash
   cd "{work_dir}" && source $HOME/workspace/demo-abacus/env.sh && \
     printf '%s' '<pre.json 内容>' > pre.json && \
     abacus-workflow -t <task> -p pre -i <结构文件> --json pre.json
   ```
   `pre.json` 只放 `{"input": {ABACUS INPUT 键: 标量}}` 覆盖（可空 `{}`）；禁路由键 task/structure/id/parameters；phthermo 不支持覆盖。
   **pre 后必校验**：`ls "{work_dir}/<task>/INPUT"` 存在；同时确认 stdout 末行 JSON `status=ok`。
3. **run**（只渲染 slurm.sh，不执行计算）：
   ```bash
   cd "{work_dir}" && source $HOME/workspace/demo-abacus/env.sh && \
     export ABACUS_ENV_SCRIPT=$HOME/workspace/demo-abacus/env.sh && \
     printf '%s' '{"slurm":{"partition":"<队列>"}}' > run.json && \
     abacus-workflow -t <task> -p run -i <结构文件> --json run.json
   ```
   slurm 字段白名单 partition/nodes/ntasks_per_node/time/account/qos/mem/output/error；默认 1 节点 32 核。
4. **提交**：`mat_sbatch` 提交 `{work_dir}/<task>/slurm.sh`（workdir 指向任务目录）；记下 job id。
5. **监控**：`mat_job_watch` 一次注册全部 job id；等终态通知。
6. **post**：
   ```bash
   cd "{work_dir}" && source $HOME/workspace/demo-abacus/env.sh && \
     printf '%s' '{}' > post.json && \
     abacus-workflow -t <task> -p post -i <结构文件> --json post.json
   ```
   `post.json` 必须空对象。

**结果消费**：stdout 末行 + `{work_dir}/result.json` 为 calcflow.result.v1（19 字段恒存在）——`status`、`properties`（relax 有 `converged`、`energy_ry`）、`files`（INPUT/STRU/KPT/running_*.log/STRU_NOW.cif 等）、`steps`（各阶段状态数组）、`artifact_manifest`/`event_log`（指向 `<task>/artifacts.json` 与 `<task>/events.jsonl`）、`plots`。失败时非零退出、`files/images/plots` 清空、`error_detail={code,message,retryable,suggested_actions}`；载荷契约类失败 `code=VALIDATION_FAILED`、`retryable=true`，修正后重跑同一 phase 即可。

**plots 通道（v0.2.1 起，post-plotting-standard §6 消费契约）**：abacus 无一站式 producer 透传，**直读 `{work_dir}/result.json` 的 `plots` 键是唯一通道**。每条 `{kind, image, data}`：向用户报告图类型与 PNG、CSV 两个路径（图给直觉，CSV 给复绘/后处理）；`image: null` 时明确告知缺 matplotlib、完整数据在 CSV；无 `plots` 键或 `plots: []`（旧部署/不产图任务）正常继续、不报错。当前 kind：relax → `scf_convergence`（SCF 迭代/Ry）+ `relax_energy`（离子步 final etot/Ry）。

**赝势/基组**：pre 自动按元素复制 SG15（workdir 根 `pseudo/` + `basis/`，INPUT 里 `../pseudo` 相对引用）——提交目录是任务目录时路径自洽，无需手工干预。

## 已知坑

| 问题 | 原因 | 处置 |
|------|------|------|
| `mpirun: Error: unknown option "-np"` | 集群 profile 注入 hpcx `OPAL_PREFIX` 污染 conda OpenMPI（未走 env.sh 或 env.sh 被绕过） | 一律经 `source .../demo-abacus/env.sh` 执行；env.sh 已内置清毒，勿自行修 MPI |
| `OMP_NUM_THREADS setting is invalid` | OMP 与 MPI 核数乘积超物理核 | slurm.sh 已固定 `OMP_NUM_THREADS=1`，勿改 |
| 空 KPT 报 `Something wrong while reading KPOINTS` | ASE 对 gamma_only/kspacing 写 0 字节 KPT | 已代码自愈（pre 自动补写）；旧部署 fallback 手工补最小 gamma KPT |
| post 报无 Finish Time | 计算未完成/失败 | 看 `OUT.ABACUS/running_*.log` 尾部与 slurm 输出；失败现场保留，先诊断后重试 |
| 启动器差异集群 | 个别集群无可用 mpirun | `ABACUS_MPI_LAUNCHER` 环境变量覆盖（如 `srun -n {nprocs} abacus`），默认 mpirun 不变；demo 已修复无需覆盖 |

## 特殊任务说明

- **relax**：post 产出 `OUT.ABACUS/STRU_NOW.cif`（优化结构）+ `relax_plot.png`（能量收敛图）+ `converged`/`energy_ry` 属性；后续任务在同一 workdir 会自动优先读 `relax/OUT.ABACUS/STRU_NOW.cif`。
- **pyatb 后处理任务**（jdos/shg/shift/bc/bcd/ahc/anc/wl/chern/hseband/surface_states）：post 内部跑 pyatb（OpenMP 32 线程），**计算量大，需第二个 slurm 作业**（模板 `templates/abacus_pyatb_slurm.sh`）——本 dsh 链路暂只覆盖其 abacus SCF 阶段（pre/run/提交），pyatb 二阶段暂不在覆盖范围，用户要求时明确说明并参考模板。
- **mei/phthermo/eos**：依赖 TB2J/phonopy，post 链路较重，按需人工跟进。

## Reference 文件

- **`references/task-reference.md`** — 15 个任务的详细参考（pre/post 细节、参数速查）
- **`templates/`** — abacus_slurm.sh / abacus_pyatb_slurm.sh（--json run 渲染已取代 sed 模板，保留作参考）
