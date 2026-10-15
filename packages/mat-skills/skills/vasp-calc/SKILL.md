---
name: vasp-calc
# description 禁半角冒号（frontmatter 纪律，同 gaussian-calc）。
description: Use this skill for VASP first-principles periodic calculations through the matstream workflow engine (relax, scf, band, pdos, unfold, phonon, magmom, born, spincharge, DFT+U variants) on HPC clusters. The whole task chain runs inside one Slurm job via the home-deployed matstream workflow env — this skill covers structure preparation (including OPTIMADE retrieval), task-chain semantics, precision presets, spin modes, one-stop mat_vasp submission with the digest confirmation gate, and result interpretation with convergence checks.
version: 0.2.0-demo
metadata:
  adapted-for: mat-dsh
  source: ~/dev/vasp-matstream-agent/skills/matstream-calc + 引擎源码 ~/dev/agent-workflow/src/matstream@0.1.3
  adaptation: 2026-09-24 v0.2.0 运行时切换——apptainer sif 退役，改为家目录自部署双件套（对齐 gaussian 的 demo+g16-hy 运维模型）：$HOME/workspace/matstream（公共 conda-pack py3.11 基座 + matstream 0.1.3 wheel + spglib2.6/xmltodict1.0.4，--no-deps 保基座 numpy1.26 ABI，VERSION 自锚）+ $HOME/workspace/vasp-hy（公共区 5.4.4-iOptCell 109M 拷贝，bootstrap_vasp.sh 幂等重建）；VASP 经 CALCULATOR_VASP_COMMAND=srun --mpi=pmi2 vasp_std 启动（作业 122895612 真实 scf 实证）；门禁升 vasp-env-gate.v2（登录节点真探 import 版本+任务表）；vasp-hy env.sh 带 mpi/* 卸载循环（作业环境预载 mpi/hpcx 与 intelmpi 冲突，作业 122895517 发现）。2026-09-23 首版 dsh 适配——执行形态定为「作业内整链」（链数据交接只在单个 matstream run 进程内成立，与 gaussian 登录节点三阶段不同构，见 ENGINE_BOUNDARY_NOTES.vaspNotes）；mat-job-manager/mat-remote-shell 职责映射到 mat_exec + mat_vasp 一站式（prepare/sbatch 单往返压缩）+ producer 终态自动收割；环境门禁 vasp-env-gate.v1（sif sha256 锚 8d4f4071b114b809，探针作业 122832841 实证）；分区别名勘误 kshcnormal（Agent0 在 11250 已不存在，探针 2026-09-23）；收敛探针为 dsh 侧补偿（引擎自身无收敛检查）；OPTIMADE 结构检索经 mcp__optimade__* 工具直连（CIF 免转换）；preset 数值表按引擎源码 vasp.py 校正（matstream-agent 文档的 300/500 ENCUT 为旧值）
---

# VASP 工作流（matstream 引擎）

## 产品边界：本地 skill 与 HPC 远端商品

本 skill 是本地 dsh 插件的一部分，负责理解用户意图、准备结构、选定任务链与精度档、
经确认闸提交、以及解释收割结果。远端是**家目录自部署双件套**（对齐 gaussian 的
demo + g16-hy 运维模型，2026-09-24 从公共区 apptainer sif 切换）：
`$HOME/workspace/matstream`（conda-pack py3.11 基座 + matstream wheel + 内置 PAW
PBE_54 赝势库）+ `$HOME/workspace/vasp-hy`（公共区 5.4.4-iOptCell 拷贝）+ Slurm。
版本自锚（VERSION 文件），部署可幂等重建——这是与 sif 时代（平台侧漂移不可控）
的本质差异。

## 执行模型（先读，与 gaussian 不同构）

**整链在一个 Slurm 作业内跑完**。`matstream run -c vasp -t '<链>'` 在作业内依次执行
每个任务的 pre（生成 INCAR/KPOINTS/POSCAR/POTCAR）→ VASP 运行 → post（解析
vasprun.xml、出 dat/PNG）。理由（引擎设计约束，2026-09-24 家目录部署后依然成立）：

1. 链数据交接（relax 后结构传播、scf 的 WAVECAR/CHGCAR 复用）只在**单个 matstream
   run 进程内**成立（引擎经内存中的 StructureInfo 传递，拆进程跑会断交接）；
2. POTCAR 由引擎内置 PAW PBE_54 库生成（wheel 内 `potpaw_pbe_54.dat`），无需本地准备；
3. VASP 经 `CALCULATOR_VASP_COMMAND='srun --mpi=pmi2 vasp_std'` 由 Slurm 原生启动
   （引擎 env 覆盖点；np 跟 --ntasks-per-node 走，作业 122895612 真实 scf 实证）。

时序：

```
本地                     集群登录节点                计算节点（Slurm 作业内）
mat_vasp ──────────► prepare(heredoc 结构+slurm.sh)
                        sbatch slurm.sh ──────► source 双 env → srun vasp_std（matstream run 编排）
producer(sacct 轮询)                              ├─ Task.1.Relax/{INCAR,KPOINTS,POSCAR,POTCAR} → vasp → post
   零模型请求                                      ├─ Task.2.Scf/...（CONTCAR→POSCAR、WAVECAR/CHGCAR 复用）
   │                                              └─ Task.3.Band/...（ICHARG=11 读 WAVECAR）
终态 ◄────────────────────────────────────────── matstream.json + Task.*/ + ms-job.out
producer harvest ──► job_output 首读：energy_per_task_eV / converged / files / plots
```

## 环境与门禁（先于一切提交）

| 项 | 值 |
|---|---|
| workflow 环境 | `$HOME/workspace/matstream/env.sh`（conda-pack py3.11 + ase3.29/numpy1.26/scipy/matplotlib + matstream 0.1.3 + spglib/xmltodict；VERSION 自锚） |
| VASP 环境 | `$HOME/workspace/vasp-hy/scripts/env.sh`（公共区 5.4.4-iOptCell 拷贝；SCRIPTDIR 家目录化 + mpi/* 卸载循环） |
| VASP 启动 | `CALCULATOR_VASP_COMMAND='srun --mpi=pmi2 vasp_std'`（作业内生效） |
| 分区 | 11250 唯一可见分区 `kshcnormal`（时限 333 天；计费相关，仍需用户确认） |
| 门禁 | `mat_env_gate(cluster_id, engine='vasp')`——脚本常驻 `$HOME/workspace/.vasp-calc/scripts/` |
| 版本锚 | `matstream/__version__`（import 真探）对 `env_profile.sh` 的 WORKFLOW_VERSION；vasp-hy 的 VERSION 首词对 VASP_VERSION_ANCHOR |

门禁 v2 是**登录节点真探**：source workflow env → python import 拿版本 + 任务注册表
（对齐 gaussian 门禁探测面）；vasp 侧验 vasp_std 可执行 + VERSION 锚（MPI 运行时由
作业内首跑 fail-fast 兜底，作业 122895612 已实证）。

**部署（新账号/重建）**：
1. workflow 件——基座拷贝 `cp -a /public/software/apps/sag-tool/qcsoft/gaussian-workflow/v1.0.0 $HOME/workspace/matstream`
   → `rm -f $HOME/workspace/matstream/.conda-unpack-done`（公共源带陈旧标记）→
   shebang 重写（`grep -rl <公共路径> bin/ | xargs sed -i 's|<公共路径>|<家目录>|g'`）→
   wheel 上传安装（matstream + spglib + xmltodict，**--no-deps**——spglib 会拖 numpy2
   砸基座 scipy ABI）→ 写 env.sh（镜像 demo 形态）+ VERSION；
2. VASP 件——`bash <本skill>/scripts/bootstrap_vasp.sh`（幂等：拷贝 + env.sh 改写 +
   VERSION + 自检）。

**播种（ENV_GATE_SEED_NEEDED 时）**：读本 skill 本地
`skills/vasp-calc/scripts/{check_environment.sh,env_profile.sh}` 内容，经 `mat_exec`
heredoc 落到 `$HOME/workspace/.vasp-calc/scripts/`（quoted 定界符），再重跑门禁。

## 任务链语义

任务以 `;` 串联，目录按 `Task.<序号>.<名称>` 生成（`Task.1.Relax`、`Task.2.Scf`…）。

**依赖与数据交接**（引擎行为，改不了——链序必须自己排对）：

| 任务 | 需要 | 产出/交接 |
|---|---|---|
| `relax` / `relaxdftu` | 初始结构 | 弛豫后结构在进程内传给下一任务；CONTCAR 在 Task 目录 |
| `scf` / `scfdftu` | （通常）relax 后结构 | 静态总能；**保留 WAVECAR/CHGCAR** 供 band/pdos/unfold |
| `band` / `banddftu` / `pdos` / `unfold` | scf 的 WAVECAR（ICHARG=11 非自洽） | 能带/DOS dat+PNG、带隙与 VBM/CBM（进 context）、unfold_result.json |
| `magmom` | scf 体系 | OUTCAR → magnetization.dat（逐原子磁矩） |
| `born` | 弛豫后结构 | Born 有效电荷（IBRION=18 + LEPSILON） |
| `spincharge` | scf 的 CHGCAR | CHGCAR_tot / CHGCAR_mag 自旋密度差 |
| `phonon` | 弛豫后结构 | 有限位移（phonopy，wheel 依赖栈内置）；disp-* 子目录 + phonon_result.json |

常用链：`relax;scf;band`（能带全流程）、`relax;scf;pdos`、`relax;scf;magmom`
（磁性）、`relax;scf;spincharge`、`relax;phonon`、`relax;scf;unfold`（超胞展开）。
**先 relax 再 scf**是默认纪律（除非用户明确给的就是平衡结构——此时可 `scf` 直跑）。

**重任务告示**：`phonon`（超胞×位移作业，核时数倍放大）、`unfold`、`born` 首次使用
时向用户点名成本；`spincharge`/`magmom` 需 `-m spin` 语义才有效（见下）。

## 精度档 preset（引擎源码权威值）

| preset | PREC | ENCUT | EDIFF | NELM | SIGMA | ALGO | NSW | EDIFFG | LREAL |
|---|---|---|---|---|---|---|---|---|---|
| veryfast | Normal | 400 | 1E-4 | 60 | 0.1 | Fast | 50 | -0.05 | Auto |
| fast | Normal | 500 | 1E-5 | 80 | 0.1 | Fast | 100 | -0.03 | Auto |
| **medium（默认）** | Accurate | 600 | 1E-6 | 100 | 0.05 | Fast | 200 | -0.01 | Auto |
| slow | Accurate | 700 | 1E-7 | 120 | 0.03 | Normal | 300 | -0.01 | .FALSE. |
| veryslow | Accurate | 800 | 1E-8 | 200 | 0.01 | Normal | 500 | -0.001 | .FALSE. |

k-spacing 按任务档内定（relax 0.44 / scf 0.22 / band·pdos 0.05 Å⁻¹ 量级）。
逐任务 INCAR 细节见 [`references/task-reference.md`](references/task-reference.md)。

## 自旋模式 mode

| mode | 语义 |
|---|---|
| `nospin`（默认） | ISPIN=1 |
| `spin` | ISPIN=2 + 内置 MAGMOM 启发式（Fe 4.0/Co 3.0/Ni 2.0/Mn 5.0/Cr 3.0/V 3.0/Ti 2.0/Cu 1.0/Mo 2.0/W 2.0/稀土 5~7 μB） |
| `soc` | LSORBIT=.TRUE. + LNONCOLLINEAR + LMAXMIX=4（SAXIS 0 0 1） |

已知怪癖（引擎 0.1.3）：部分具体任务在生成 INCAR 时内部固定 `spin=True`，`-m` 主要
影响标签与部分任务——**用户关心磁性时显式传 `mode='spin'` 并在结果里核对
magnetization 数值**，不要依赖默认。

## 一站式路径：mat_vasp（默认）

选项已知时优先 `mat_vasp`。参数面：`cluster_id / tasks / structure /
workdir` 必填；`preset / mode / partition / time / structure_format` 常用；
`options` 透传 `workflow_env / vasp_env / calculator_vasp_command / nodes /
ntasks_per_node / poll_seconds / max_wait_seconds / confirmation_gate`；`task_ref` 走预算闸。

**确认摘要闸（两段式，零集群副作用）**：首次调用不带 `confirmed_digest` 返回
`CONFIRM_REQUIRED` + 参数投影 + digest——投影必须**逐字**呈给用户（分区/核数/核时
是计费信息），获批后带 digest 重调。缺省投影：medium / nospin / kshcnormal /
1 节点×32 核 / 24h（≈768 核时）——**链长与体系大小决定是否调 time**，默认值只在
用户未表态时用且必须出现在投影里。

结构格式：`structure_format='poscar'`（默认，写 `POSCAR`）/ `'cif'`（写
`structure.cif`）/ `'xyz'`——引擎经 ASE 按文件名嗅探，**格式与文件名配对由工具
保证，不要手工混用**。

提交成功后：返回 slurm job id + 后台 job id；producer 服务端轮询 sacct（零模型
请求），终态自动收割；完成通知进会话后用 `job_output` 读结果。

## 结构来源

1. **用户提供**（最常见）：POSCAR/CIF 文本直接进 `structure` 参数。
2. **OPTIMADE 检索**（用户说「取/查 MoS2、mp-xxxx」）：`mcp__optimade__query_structures`
   （自然语言/化学式/过滤）→ 选中条目后 `mcp__optimade__download_structure`（format=cif）
   → CIF 内容直接作 `structure` + `structure_format='cif'`（免转换）。
   检索结果**必须先呈给用户确认**（同构多形体、二维材料的真空层与维度是科学决策）。
3. 上游弛豫续算：`mat_download` 拉 `Task.N.Relax/CONTCAR` 作下一链的 POSCAR。

## 收割判读协议（job_output 输出契约）

终态首读包含：

| 行 | 语义 |
|---|---|
| `slurm_state: COMPLETED` | Slurm 作业层面成功 |
| `context_tail: …` | 引擎累积的中文摘要尾段（各任务的费米能级/带隙/VBM-CBM 等） |
| `energy_per_task_eV: {"Task.2.Scf": -12.4, …}` | 分任务能量（OUTCAR TOTEN，不含熵） |
| `converged: true/false` | **relax 族**是否达到离子收敛（OSZICAR accuracy 标记） |
| `task_dirs: …` / `files: …` / `plots: …` | 产物清单与 PNG 图集 |

**红线：Slurm COMPLETED ≠ 物理收敛**（引擎自身无收敛检查，`converged` 探针是 dsh
侧补偿）。判读次序：

1. 无 relax 族任务（纯 scf/band 链）→ 无 `converged` 行属正常，看 `context_tail`
   的能量是否合理；
2. `converged: false` → 读该任务 OSZICAR 尾（`mat_download` 或 `mat_exec tail`）
   定位：电子步不收敛 vs 离子步震荡 vs NSW 耗尽，按 [`references/INDEX.md`](references/INDEX.md)
   的 KB 条目处方处理（升 preset / 调 ALGO / 换 IBRION），**向用户报告时必须写明
   「未收敛」而不是只报能量**；
3. 非 COMPLETED → `engine_error:` / `log_tail:` 行是诊断载荷，先 grep KB 再看
   `ms-job.out` 尾部。

深度数据（能带图、DOS 图、CONTCAR、磁矩）在 `Task.*/` 下：小文件 `mat_download`
拉回，图像可拉回后交给用户。

## 分步 fallback（一站式不可用时）

`mat_exec` 手动驱动（等价命令序列，模板抄 [`templates/matstream_slurm.sh`](templates/matstream_slurm.sh)）：

1. `mat_exec`: heredoc 写 POSCAR + slurm.sh（占位符 `<TASKS>/<PRESET>/<MODE>/<PARTITION>/<TIME>`）；
2. `mat_sbatch`: 于 workdir 提交（**作业根目录提交**，不是任务子目录——与 gaussian 不同）；
3. `mat_job_watch` 注册监控；完成后 `mat_exec` 收割（`cat matstream.json` +
   `ls Task.*` + OSZICAR/OUTCAR 探针）。

## 已知坑与边界

- **引擎无收敛检查**（README TODO）：收敛判读全靠 dsh 探针 + 本协议，未收敛作业
  不会自己报错；
- **部署物自管**（家目录无平台备份）：workflow 件按部署 SOP、vasp 件按
  `bootstrap_vasp.sh` 幂等重建；wheel 升级后同步更新 `env_profile.sh` 的
  WORKFLOW_VERSION 锚（门禁 fail-closed 会点名漂移）；
- **登录节点无 module 命令**（非交互 shell，vasp-hy env.sh 已加守卫）：手动命令需要
  module/MPI 时一律「在作业内」做；**作业环境会预载 mpi/hpcx**，与 intelmpi 冲突——
  vasp-hy env.sh 的卸载循环已处理，不要绕过它直接 module load；
- **同 workdir 串行**：重复提交同一 workdir 会与在跑链互相覆写文件——换 workdir
  或等前链终态；
- **phonon/unfold/born 重任务**：首次使用先向用户点名核时成本；
- matstream `search` 子命令是 stub（引擎 0.1.3 不可用）。

## 知识沉淀协议

排障闭环后提炼 `references/errors/` 或 `references/methods/` 条目（签名/根因/处方/
版本锚/来源），经 review 合入；现有种子条目来自 VASP 通用排障知识，**未经本仓集群
实证——首次命中后回写实证来源与真实签名**。检索与条目 schema 见
[`references/INDEX.md`](references/INDEX.md)。
