---
name: xtb-calc
description: Use this skill when the user asks to "run xtb calculation", "xtb single point", "GFN2-xTB", "GFN-FF", "semiempirical tight binding", "xtb geometry optimization", "xtb frequency/IR spectrum", "xtb thermochemistry", "xtb molecular dynamics", "xtb metadynamics", "xtb relaxed scan", "vertical IP/EA (delta SCC)", "Fukui indices", "xtb conformer search", "半经验紧束缚", "快速能量筛选", or mentions xtb workflow tasks (sp, grad, opt, hess, ohess, md, metadyn, scan, vipea, vfukui), or asks for lithium-ion-battery workflows such as solvent-molecule random packing (溶剂随机堆放/pack), auto-adsorption onto a slab surface (自动吸附, 吸附位筛选, adsorb molecule on Li surface, place solvent on surface), electrolyte or solvent on a surface (电解质/溶剂+表面, slab pre-optimization), fixed-atom / frozen-atom optimization (固定部分原子优化, freeze atoms). Renders xtb inputs (pre), submits to the cluster via the HPC platform, and parses results (post). Do NOT load when the user supplies a self-prepared xcontrol steering file next to their xyz and wants it run as-is (use xtb-external-input).
version: 1.3.2-demo
depends_on:
  - mat-chat
  - mat-job-manager
  - mat-command-executor
---

# xtb 工作流（常规路径）

xtb 半经验紧束缚（GFN0/1/2-xTB、GFN-FF）计算：`pre → run → sbatch → post` 三相链。锂电池场景（溶剂堆放预优化 / 电解质+表面 / 固定原子优化）的标准打法见文末。

## demo 部署环境（xtb-workflow 1.3.2）

- workflow CLI：`export PATH=$HOME/workspace/demo/bin:$PATH` 后 `xtb-workflow` 即在 PATH。
- run 内联导出：`export XTB_ENV_SCRIPT=$HOME/workspace/demo/environment/xtb-env.sh`（xtb 6.7.1 二进制 `$HOME/workspace/demo/environment/xtb`）。
- 版本锚：`cat $HOME/workspace/demo/xtb-workflow.VERSION` 应为 `1.3.2`；不符先停下报告，不要继续。
- 分区：`kshcnormal`（用户未指定时问一句，别自选）。

## 可用任务

| 任务 | `-t` | 说明 |
|------|------|------|
| 单点能 | `sp` | 能量 + HOMO-LUMO gap |
| 梯度 | `grad` | 单点 + gradient 文件 |
| 结构优化 | `opt` | 收敛几何 + 能量轨迹图；`constraints.freeze_atoms` 冻结原子 |
| 频率 | `hess` | 频率/IR/ZPE/焓/自由能 |
| 优化+频率 | `ohess` | 原生组合，勿拆两步 |
| 分子动力学 | `md` | `$md` 控参（pre.json `md` 键） |
| 元动力学 | `metadyn` | 构象采样 |
| 松弛扫描 | `scan` | pre.json `scan.elements` 必填 |
| 垂直 IP/EA | `vipea` | delta SCC |
| Fukui | `vfukui` | 逐原子 f+/f-/f0 |

任务细节（pre.json 全部键/产物/plots/单位）以仓库 `mat-aitool/skills/xtb-calc/references/task-reference.md` 为准（1.2.0）。

## 执行模型（分步）

```bash
# 1. pre（workdir 独立自建，不与他人共享）
cd {work_dir} && export PATH=$HOME/workspace/demo/bin:$PATH && \
  xtb-workflow -t opt -i {mol.xyz} -p pre -w {work_dir} --json pre.json

# 2. run
export XTB_ENV_SCRIPT=$HOME/workspace/demo/environment/xtb-env.sh && \
  xtb-workflow -t opt -i {mol.xyz} -p run -w {work_dir} --json run.json
# run.json：{"slurm": {"partition": "kshcnormal", "ntasks_per_node": 4}}
# ncores（pre.resources）必须 ≤ ntasks_per_node

# 3. 提交与监控：mat_sbatch / mat_job_watch（作业终态后才 post）。**sbatch 的作业 CWD=提交目录**：手工 sbatch 必须在 `<workdir>/<task>/` 任务子目录内执行（根目录提交会 fatal 且被 `echo $?` 掩码成假 COMPLETED）

# 4. post（post.json 恒为 {}）
xtb-workflow -t opt -i {mol.xyz} -p post -w {work_dir} --json post.json
```

结果只消费 post 输出的 result JSON（properties/plots/files）；失败分诊读 `error_detail`（VALIDATION_FAILED 按 suggested_actions 修输入重跑同相位；CONVERGENCE_FAILED/PARSE_FAILED 看消息里的日志尾）。

## 自动吸附 / 自动堆放构建器（1.3.0，零作业零算力）

锂电池场景 1、2 的结构准备（pre 相位本地完成；run 对构建器拒投并提示 opt 链）：

```bash
# 吸附：slab 传 -i（周期用 extxyz 含 Lattice=，cluster 用纯 xyz），多候选落盘
xtb-workflow -t adsorb -p pre -i <slab> -w {work_dir} --json adsorb.json
# adsorb.json = {"schema_version": "xtb.adsorb.v1",
#   "molecule": {"file": "ec.xyz", "anchor_atoms": [1]},    # 锚=贴表面原子，缺省取极性原子
#   "sites": {"include_top": true, "include_bridge": true}}

# 堆放：空周期盒 + 分子文件，seed 可复现
xtb-workflow -t pack -p pre -i <box.extxyz> -w {work_dir} --json pack.json
```

- 产物 `<work_dir>/adsorb|pack/`：`structure.xyz`（最优候选）、`candidates/`、`*.result.json`（证据链）、`next_opt.pre.json`（推荐 opt 骨架——金属 slab 自动 gfn 1、周期自动 periodic、cluster 自动冻底层）、`refs/`（E_ads 参考）。
- **标准链**：adsorb pre → 选 `candidates/` 结构 → `-t opt -p pre -i <候选> --json adsorb/next_opt.pre.json` → run/sbatch/post。
- E_ads 参考的两个 sp 骨架**必须各自独立 workdir**（同为 -t sp，同目录会互相覆盖）：`-w refs-slab` / `-w refs-mol`；三体系同一 gfn。
- 内置分子库（1.3.2）：H2O/EC/FEC/DMC/DEC/EMC（真机 GFN2 优化+0 虚频固化，锚=羰基 O/F）；gfn 自动处方按金属占比（≥0.5→gfn1，分子簇→gfn2）。run 相位拒投构建器是预期行为，按 suggested_actions 转 opt 链。

## 锂电池场景标准打法

1. **溶剂随机堆放预优化**：上游把 N 个溶剂分子随机摆进立方区（分子间留 2-3 Å）输出单帧 xyz；`-t opt` + `{"gfn": "ff", "opt_level": "crude"}`（GFN-FF 闭壳层 mult=1，数百原子稳；≤150 原子温和构型可用 gfn 2）；产物 `xtbopt.xyz` 喂下游 DFT。
2. **固定部分原子优化**：`-t opt` + `{"constraints": {"freeze_atoms": [1基原子号], "force_constant": 100.0}}` → `$constrain` 谐波约束到初始位置（xtb 6.7.1 优化器**忽略** man 页的 `$fix` 精确冻结块——demo 真机取证；fc=1 太软漂 0.033 Å、1000 发散、100 实证可用）。post 校验冻结漂移并报 `frozen_max_drift_angstrom`，超 0.1 Å 即 CONVERGENCE_FAILED。仅 opt/ohess；越界/全冻结/与 scan 组合会被 pre 拒；md 不支持。
3. **电解质+表面**：cluster 路线 = 冻结 slab 底层（场景 2）；周期路线 = extxyz（`Lattice=`，2D slab `pbc="T T F"`，z 真空 ≥15 Å）+ `{"periodic": true}`（仅 sp/grad/opt；GFN-FF 拒收）。**周期优化不能冻结原子**（6.7.1 周期优化器连 `$constrain atoms:` 都忽略——真机取证，pre 直接拒收组合）；周期作业 post 已真机验证（能量/收敛/轨迹图）。
   金属 slab（Li 等）GFN2 SCC 易振荡甚至能量坍塌——**首选直接换 `gfn: 1`**（实证：GFN1+Li slab 缺省 etemp 即收敛 72 圈；GFN2 的 etemp 1000/2000 在 opt 端全崩、sp 端收敛不保证 opt 端）。周期优化的 `xtbopt.xyz` 不带晶胞块（固定晶胞 cell 未变）——下游周期使用需恢复输入的 `Lattice=` 头（可做带晶胞副本，勿改 xtb 原始产物）。

## 红线

- `-i` 单帧 xyz（周期场景是 extxyz）；元素列裸符号。
- run 只渲染 slurm.sh 绝不执行 xtb；提交/监控走 mat 工具。
- 作业终态后才 post；结果读 result JSON，不 cat 裸日志（必要时只看消息里引用的日志尾）。
- GFN-FF：mult 必须 1、不支持周期。
- `periodic` 与 `constraints` 互斥（周期优化冻结在 6.7.1 不可用）；结构带晶胞必须显式 `"periodic": true`。
- pre.json 结构带晶胞（Lattice）必须显式 `"periodic": true`，否则 pre 拒收（防静默按 cluster 跑）。
- workdir 每任务独立自建；失败保留现场先分诊。
