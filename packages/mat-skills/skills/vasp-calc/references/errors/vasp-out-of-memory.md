---
id: vasp-out-of-memory
signature: "OUT_OF_MEMORY|out of memory|not enough memory|MemoryError|oom-kill|Killed"
task: [scf, band, pdos, unfold, phonon, spincharge]
versions: ["0.1.3"]
source: seed（VASP 通用排障知识，未经本仓集群实证——首次命中后回写实证来源与真实签名）
prescription: [{"match":"sacct 状态 OUT_OF_MEMORY（作业级）","route":"NCORE 或 KPAR 并行重排；KPOINTS 降密度（band/pdos 显式路径点数）"},{"match":"大体系（>200 原子）单节点爆","route":"options.nodes 扩节点（ntasks_per_node 保持 32）——注意 apptainer+MPICH 多节点未在本仓实证，首次扩节点先跑 smoke"},{"match":"unfold/phonon 后处理阶段 MemoryError（Python 侧）","route":"降体系规模或分任务跑（unfold 单独链）"},{"match":"反复爆且体系合理","route":"换集群分区/节点规格前先向用户确认成本"}]
---

## 症状

- sacct 终态 `OUT_OF_MEMORY`（producer 的 `slurm_state:` 行直读）；
- 或 `ms-job.out` 尾部 Python MemoryError / 被 kill 痕迹。

## 根因

单节点 32 核内存上限装不下平面波基组（K 点密、体系大）或后处理数组（unfold/phonon）。

## 处方（决策表）

| 场景 | 判定 | 处方 |
|---|---|---|
| 作业级 OOM | sacct 状态 | NCORE/KPAR 重排；降 K 密度 |
| 大体系 | >200 原子 | 扩节点（多节点路径未实证，先 smoke） |
| 后处理 OOM | Python MemoryError | 分任务跑、降规模 |
| 反复爆 | 体系合理 | 与用户确认换节点规格 |

## 禁止事项

- 不要用「降 preset」硬压内存（ENCUT 降会连精度一起丢——只在该任务的物理精度
  允许时才动 preset，向用户明示权衡）。
