---
id: vasp-electronic-unconverged
signature: "electronic convergence not achieved|convergence not achieved within NELM|aborting loop EDIFF|EDWM is larger than EDIFF"
task: [relax, scf, relaxdftu, scfdftu, magmom, born]
versions: ["0.1.3"]
source: seed（VASP 通用排障知识，未经本仓集群实证——首次命中后回写实证来源与真实签名）
prescription: [{"match":"金属/小带隙体系（ISMEAR 自动换 1 场景）","route":"SIGMA 适当加大（0.05→0.1~0.2）或 ISMEAR=1/2，先于调混合"},{"match":"ALGO=Fast 上震荡（OSZICAR 能量摆动）","route":"ALGO=Normal；仍不收敛升 preset（slow 档自带 Normal）或 ALGO=All（贵但稳）"},{"match":"难收敛体系（表面/磁性/金属）","route":"AMIX/BMIX 减小（如 AMIX=0.1 BMIX=0.01）或 AMIX_MAG 调整；预设自洽初猜（先 nospin 的 CHGCAR 续算 spin）"},{"match":"结构本身病态（原子过近/晶胞异常）","route":"查 POSCAR——参数救不了坏结构"}]
---

## 症状

- OSZICAR 电子步能量震荡不达 EDIFF， stdout/stderr 报电子步不收敛；
- 收割探针里该任务无收敛标志、`energy_per_task_eV` 数值异常或缺失；
- 常伴随 NSW 内多次电子重启（relax 链每步 SCF 重来）。

## 根因

SCF 迭代不收敛：混合参数与体系电子结构不匹配（金属/磁性/表面最难）、SIGMA 过小、
ALGO 不适配、或结构病态。

## 处方（决策表）

| 场景 | 判定 | 处方 |
|---|---|---|
| 金属/小带隙 | ISMEAR 相关 | SIGMA 加大或 ISMEAR=1/2——先于调混合 |
| ALGO=Fast 震荡 | OSZICAR 能量摆动 | ALGO=Normal；升 preset（slow 自带 Normal）或 ALGO=All |
| 难收敛体系 | 表面/磁性/金属 | AMIX/BMIX 减小；nospin CHGCAR 续算 spin |
| 结构病态 | 原子距离异常 | 查 POSCAR，参数救不了坏结构 |

## 禁止事项

- 不要盲目加 NELM 掩盖震荡（震荡加步数只是多烧核时）；
- 不要在未收敛时把能量报给用户当结果（收割红线）。
