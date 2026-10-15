# 任务参考（引擎 0.1.3 源码核对版）

> 权威来源：`~/dev/agent-workflow/src/matstream`（`calculator/vasp/vasp.py`、
> `calculator/vasp/incar.py`、`task/`、`methods/`）。本表是引擎行为的投影快照，
> 引擎升级时按源码重核。

## 任务注册表（12 任务）

| 任务 | 一句话 | 关键 INCAR 差异 | 产物 |
|---|---|---|---|
| `relax` | 离子弛豫（晶胞+原子，ISIF=3） | IBRION=2、NSW 按 preset | CONTCAR、弛豫轨迹 |
| `scf` | 静态自洽 | ISIF=2、NSW=0、ICHARG=0、LWVE/LCHG=.TRUE.（保 WAVECAR/CHGCAR） | 总能、WAVECAR、CHGCAR |
| `band` | 能带（非自洽读 WAVECAR） | ICHARG=11、LORBIT=11、Explicit K 路径 | band_*.dat/PNG、带隙与 VBM/CBM 进 context |
| `pdos` | 投影态密度 | ICHARG=11、LORBIT=11 | pdos_{total,atom,symbol,orbital}.dat/PNG |
| `unfold` | 超胞能带展开 | ICHARG=11 + 展开变换 | unfold_result.json、展开谱 PNG |
| `phonon` | 声子（有限位移） | 超胞 + IBRION=6 位移族、phonopy 后处理 | 声子带/DOS 图、phonon_result.json |
| `magmom` | 逐原子磁矩 | ISPIN=2（配合 -m spin） | magnetization.dat |
| `born` | Born 有效电荷 | IBRION=18、LEPSILON=.TRUE. | born_effective_charge.dat |
| `spincharge` | 自旋密度差 | 读 CHGCAR | CHGCAR_tot / CHGCAR_mag |
| `relaxdftu` / `scfdftu` / `banddftu` | DFT+U 版三件套 | LDAU=.TRUE.、LDAUTYPE=2、内置 U 值 | 同 relax/scf/band |

DFT+U 内置 U 值（eV）：Fe 4.0、Co 3.4、Ni 6.0、Mn 3.9、Cu 4.0（`methods/relaxdftu.py`）。

## 基础 INCAR 模块（preset 与任务模板的合成底座）

- PREC 见 preset 表；LREAL：veryfast/fast/medium 用 Auto，slow/veryslow 用 .FALSE.
- ADDGRID=.TRUE.、ISMEAR=0（金属体系引擎自动换 1）、SIGMA 见 preset 表
- ALGO：veryfast/fast/medium=Fast，slow/veryslow=Normal；NELM 见 preset 表
- LORBIT=11、IVDW=12、NPAR=4 为模块默认
- KPOINTS：mesh 模式按 kspacing 自动定；band/pdos 用 spglib 对称化显式 K 路径（真空方向剪枝）

## 数据交接的实现语义（引擎行为）

- relax→后续任务：**进程内存传递**（post 解析 vasprun.xml 覆写 cell/positions）——
  拆开跑即断；CONTCAR 文件是给人/续算用的；
- band/pdos/unfold 的 pre：扫 `structure.extra` 里**名字含 `Scf` 的最近任务目录**，
  拷 WAVECAR/CHGCAR/CHG 进本任务目录，并置 ICHARG=11；
- 没找到 scf 前驱时引擎只 warning 不报错——**链序排错会静默降级**，排链责任在本地。

## POTCAR

引擎内置 PAW PBE_54 压缩库（wheel 内 `matstream/data/potpaw_pbe_54.dat`），按 POSCAR
元素序自动拼接。本地**永远不生成、不上传 POTCAR**（许可与一致性都由远端商品负责）。

## CLI 速查（分步 fallback 用）

```sh
# 作业内执行（先 source $HOME/workspace/vasp-hy/scripts/env.sh 与
# $HOME/workspace/matstream/env.sh，再 export CALCULATOR_VASP_COMMAND='srun --mpi=pmi2 vasp_std'）
matstream run -c vasp -t 'relax;scf;band' -f POSCAR -p medium -m nospin
# 登录节点可跑（纯 python，输入生成/结果解析）：
matstream pre  -c vasp -t relax -f POSCAR -p medium -m nospin   # 单任务 pre（链交接会断，仅调试）
matstream post -c vasp -t relax -f POSCAR                        # 单任务 post（解析 Task.Relax/）
```

`-o key=value,...` 可覆盖 INCAR 键与少量配置（phonon_dim/unfold_repeat/kspacing/mesh）；
一站式 v1 不透传 `-o`（保持投影面最小）——确需覆盖时分步 fallback 手动驱动。

## 输出 JSON 契约（matstream.json）

成功：`{"context": <中文累积摘要>, "files": [绝对路径], "image": [PNG 路径],
"slurm_path": ...}`；失败：`{"error": "错误: ..."}` + 退出码 1（作业 FAILED）。
stdout 末行同源单行 JSON。**无 properties 结构化通道**——能量/收敛由 dsh 收割探针
补（OSZICAR accuracy 标记 + OUTCAR TOTEN）。
