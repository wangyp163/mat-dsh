# ABACUS 工作流任务详细参考

全部 15 个计算任务的详细说明，按类别分组。每个任务均遵循 pre/run/post 三阶段执行。

---

## 基础计算任务

### relax — 结构弛豫

- **工作流类**: `AbacusRelaxWorkflow`
- **计算类型**: `calculation='relax'`
- **默认参数**: `ecutwfc=60`, `basis_type='lcao'`, `relax_method='bfgs_trad'`, `force_thr_ev=2.0e-2`, `scf_thr=1e-6`, `gamma_only=1`, `kpts=(9,9,9)`
- **pre 阶段**: 读取结构文件，调用 `get_atoms()` 获取原子并复制赝势/基组，生成 `./relax/INPUT`、`STRU`、`KPT` 等输入文件
- **run 阶段**: 切换到 `./relax` 目录执行 `abacus`
- **post 阶段**:
  - `check_output()` 检查 `running_relax.log` 末尾是否包含 `Finish Time`
  - `relax_plot()` 解析 `running_relax.log` 中的 `final etot is` 行，绘制能量变化趋势图 `relax_plot.png`
- **输出文件**:
  - 优化后结构: `./relax/OUT.ABACUS/STRU_NOW.cif`
  - 能量变化图: `./relax/relax_plot.png`

### scf — 无独立任务（澄清）

**代码中没有独立的 `scf` 任务**（旧文档此处为漂移）。拓扑性质任务（ahc, anc, bc, bcd, chern, wl, surface_states）和光学任务（jdos, shg, shift）在各自 pre 阶段直接生成 SCF 输入（`calculation='scf'`），不依赖单独的 scf 任务结果。它们通过 `get_atoms()` 读取 relax 后的优化结构。

### hseband — HSE 杂化泛函能带

- **工作流类**: `AbacusHsebandWorkflow`
- **计算类型**: `calculation='scf'`（先 SCF，后用 pyatb 画能带）
- **依赖**: pyatb, pyatb_input
- **pre 阶段**: 读取结构，生成包含 HSE 参数的 SCF 输入文件到 `./hseband/`
- **run 阶段**: 执行 abacus SCF 计算
- **post 阶段**:
  1. `pyatb_input -i ./ --band` 生成 `pyatb/Input`
  2. `OMP_NUM_THREADS=32 pyatb` 计算能带
- **输出**: `./hseband/pyatb/Out/Band_Structure/`

### eos — 状态方程

- **工作流类**: `AbacusEosWorkflow`
- **用途**: 通过不同体积下的能量拟合确定平衡晶格常数
- **依赖**: phonopy（phthermo 复用），numpy
- **pre 阶段**: 生成多个体积变形后的结构目录
- **run 阶段**: 逐一执行 abacus 计算
- **post 阶段**: 收集各体积能量，拟合 EOS 曲线

---

## 光学性质任务

所有光学任务的后处理均使用 `pyatb` 工具。通用后处理模式：
1. `pyatb_input -i ./ --<option>` 生成 `pyatb/Input` 文件
2. 修改 Input 参数（部分任务需要）
3. `OMP_NUM_THREADS=32 pyatb > job.log 2> job.err` 执行计算

### jdos — 联合态密度

- **工作流类**: `AbacusJdosWorkflow`
- **计算类型**: `calculation='scf'`, `nspin=1`, `lspinorb=0`, `scf_thr=1e-8`
- **pre 阶段**: 读取结构，生成 SCF 输入到 `./jdos/`，开启 `out_chg=1`, `out_mat_hs2=1`, `out_mat_r=1`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./ --jdos`
  2. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./jdos/pyatb/Out/JDOS/jdos.pdf`

### shg — 二次谐波产生

- **工作流类**: `AbacusShgWorkflow`
- **计算类型**: `calculation='scf'`
- **依赖**: pyatb
- **pre 阶段**: 读取结构，生成含自旋轨道耦合参数的 SCF 输入
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./` 生成基础 Input
  2. 在 `pyatb/Input` 末尾追加 SHG 参数块
  3. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./shg/pyatb/Out/Second_Harmonic_Generation/shg.pdf`

### shift — 位移电流

- **工作流类**: `AbacusShiftWorkflow`
- **计算类型**: `calculation='scf'`
- **依赖**: pyatb
- **pre 阶段**: 读取结构，生成 SCF 输入到 `./shift/`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./ --shift` 生成 Input
  2. 修改 `pyatb/Input` 中 SHIFT_CURRENT 参数块
  3. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./shift/pyatb/Out/Shift_Current/`

---

## 拓扑性质任务

所有拓扑任务的后处理均使用 `pyatb`。拓扑任务的 SCF 输入通常设置 `nspin=4`（非共线磁性）和 `lspinorb=1`（自旋轨道耦合），并通过 `get_wl_nspin_lso()` 自动检测磁性元素。

**磁性元素集合**: Fe, Co, Ni, Mn, Cr, V, Cu, Gd, Eu, Tb, Dy, Er, Ho, Nd, Sm, Pr, Ce（**不含 O**：氧化物磁性来自其中的金属，把 O 列入会误判非磁性氧化物强开 SOC）

**参数自动设置规则**:
- 含磁性元素: `nspin=4`, `lspinorb=1`
- 无磁性元素: `nspin=1`, `lspinorb=0`

### bc — Berry 曲率

- **工作流类**: `AbacusBcWorkflow`
- **计算类型**: `calculation='scf'`
- **依赖**: pyatb
- **pre 阶段**: 读取结构，生成 SCF 输入
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input --berry > running_pyatb_input_output.log`
  2. `pyatb > running_pyatb_output.log`
- **输出**: `./bc/pyatb/Out/Berry_Curvature/`（PDF 图）

### bcd — Berry 曲率偶极矩

- **工作流类**: `AbacusBcdWorkflow`
- **计算类型**: `calculation='scf'`
- **依赖**: pyatb
- **pre 阶段**: 读取结构，生成 SCF 输入到 `./bcd/`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./ --bcd` 生成 Input
  2. 修改 `pyatb/Input` 中 BERRY_CURVATURE_DIPOLE 参数块
  3. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./bcd/pyatb/Out/Berry_Curvature_Dipole/bcd.dat`

### ahc — 反常霍尔电导

- **工作流类**: `AbacusAhcWorkflow`
- **计算类型**: `calculation='scf'`, `nspin=4`, `lspinorb=1`（默认）
- **依赖**: pyatb
- **pre 阶段**: 读取结构，自动检测磁性元素设置 nspin/lspinorb，生成 SCF 输入到 `./ahc/`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./ --ahc`
  2. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./ahc/pyatb/Out/AHC/ahc.dat`

### anc — 反常能斯特系数

- **工作流类**: `AbacusAncWorkflow`
- **计算类型**: `calculation='scf'`
- **依赖**: pyatb
- **pre 阶段**: 读取结构，自动检测磁性元素，生成 SCF 输入到 `./anc/`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./ --anc`
  2. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./anc/pyatb/Out/ANC/ahc_anc.png`

### wl — Wilson 环

- **工作流类**: `AbacusWlWorkflow`
- **计算类型**: `calculation='scf'`
- **依赖**: pyatb
- **特点**: 最复杂的拓扑任务，需要在 6 个 k 方向分别运行 pyatb
- **pre 阶段**: 读取结构，生成 SCF 输入到 `./wl/`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./ --wl` 生成基础 Input
  2. 创建 6 个子目录: `pyatb_kx=0.0`, `pyatb_kx=0.5`, `pyatb_ky=0.0`, `pyatb_ky=0.5`, `pyatb_kz=0.0`, `pyatb_kz=0.5`
  3. 复制 Input 到各子目录并修改 k 方向参数
  4. 各目录分别运行 `OMP_NUM_THREADS=32 pyatb`
  5. 收集 6 组 Wilson Loop 数据绘图
- **输出**: `./wl/pyatb/Out/Wilson_Loop/wilson_loop.dat`（每个方向）

### chern — Chern 数

- **工作流类**: `AbacusChernWorkflow`
- **计算类型**: `calculation='scf'`, `nspin=4`, `lspinorb=1`（默认）
- **依赖**: pyatb
- **pre 阶段**: 读取结构，自动检测磁性元素，支持 DFT+U 参数（`dft_plus_u=1`, `orbital_corr`, `hubbard_u`），生成 SCF 输入到 `./chern/`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./ --chern` 生成 Input
  2. 修改 `pyatb/Input` 中 CHERN_NUMBER 参数块（设置 `method=0`, `occ_band`, `integrate_mode=Grid`, `integrate_grid=45 45 45`, k 向量等）
  3. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./chern/pyatb/Out/Chern_Num/chern_number.dat`

### surface_states — 表面态

- **工作流类**: `AbacusSurfaceStatesWorkflow`
- **计算类型**: `calculation='scf'`
- **依赖**: pyatb
- **工作目录**: `./surface-states/`（注意连字符）
- **pre 阶段**: 读取结构，生成 SCF 输入
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. `pyatb_input -i ./` 生成基础 Input
  2. 在 `pyatb/Input` 末尾追加 SURFACE_STATE 参数块
  3. `OMP_NUM_THREADS=32 pyatb`
- **输出**: `./surface-states/pyatb/Out/Surface_State/`

---

## 磁性与热力学任务

### mei — 磁性交换相互作用

- **工作流类**: `AbacusMeiWorkflow`
- **计算类型**: `calculation='scf'`, `nspin=2`（共线磁性）, `symmetry=0`, `out_mat_hs2=1`
- **依赖**: TB2J（后处理），HamiltonIO（隐式依赖）
- **pre 阶段**:
  - 读取结构，生成 SCF 输入到 `./mei/`
  - 设置 `nspin=2`, `noncolin=0`, `lspinorb=0`, `out_mul=1`, `out_mat_hs2=1`
- **run 阶段**: 执行 abacus SCF
- **post 阶段**:
  1. 检查 TB2J 是否可用
  2. 创建 `./mei/2_J/` 目录和 `2_J/OUT.ABACUS/` 子目录
  3. 复制必要文件: STRU, Orbital, `*.csr`, `running_scf.log`
  4. 自动识别结构中的磁性元素（Fe, Co, Ni, Mn, Cr, V, Cu, Gd, Eu, Tb, Dy, Er, Ho, Nd, Sm, Pr, Ce；不含 O）
  5. 执行 `abacus2J.py --path . --suffix ABACUS --elements <elements> --kmesh 7 7 7 --rcut 8.0 --nz 50 --output_path TB2J_results`
- **输出**: `./mei/2_J/TB2J_results/`
- **注意**: 若未检测到磁性元素，会使用所有元素进行计算

### phthermo — 声子热力学性质

- **工作流类**: `AbacusPhthermoWorkflow`
- **用途**: 准谐近似（QHA）计算声子态密度和热力学性质
- **依赖**: phonopy, phonopy-qha
- **特点**: 计算量最大的任务，需要多个体积的超胞计算
- **pre 阶段**:
  1. 读取结构，创建 `./phthermo/` 工作目录
  2. 复制赝势/基组文件到 phthermo 目录
  3. `generate_qha_directories()`: 创建多个体积变形目录（`vol_0.95`, `vol_0.96`, ..., `vol_1.05`）
  4. 在每个体积目录中生成超胞位移（`phonopy --dim="dim1 dim2 dim3" -d`）
  5. 为每个位移生成 ABACUS 输入文件
- **run 阶段**:
  1. 遍历所有 `vol_*` 目录
  2. 每个 volume 下的 `disp-*` 子目录逐一执行 abacus
  3. 计算量 = 体积数 x 位移数
- **post 阶段**:
  1. 检查 `./phthermo/vol_1.00/` 中 ABACUS 计算是否完成
  2. `run_phonopy_for_vol()`: 每个体积运行 `phonopy -f` + `phonopy --dos -t`（默认 mesh=48,48,48）
  3. 收集各体积的热力学数据
  4. 执行 `phonopy-qha` 拟合热力学性质曲线
  5. 生成多张 PDF 图表（EOS、热容、自由能等）
- **输出**: `./phthermo/` 下各体积目录和 phonopy-qha 生成的 PDF
- **额外 CLI 参数**: `--mesh` / `-m` 设置 phonopy mesh（默认 `48 48 48`）

---

## 伪势库来源

`core/pp_gen.py` 从下列环境变量解析赝势/基组库路径（由 env.sh 设置，指向自带 SG15 库目录）：

- **赝势库** `$ABACUS_PP_PATH`：SG15 ONCV PBE 目录
- **基组库** `$ABACUS_ORBITAL_PATH`：SG15 轨道目录

两个变量均由 env.sh 设置，指向自带的 SG15 库目录。

### 文件命名约定

- **赝势**: `{Element}_ONCV_PBE-1.0.upf`（如 `Fe_ONCV_PBE-1.0.upf`）
- **基组**: `{Element}_*.orb`（如 `Fe_sg15jy.onorb`，匹配元素名开头的第一个）

`copy(work_path, atoms)` 自动：
1. 在 `work_path` 下创建 `pseudo/` 和 `basis/` 目录
2. 提取 `atoms` 中的唯一元素符号集合
3. 逐元素复制对应文件，跳过已存在的文件

---

## 执行模式说明

> 工作目录用 `{work_dir}`（**平台为本作业分配的 `.../workspace/<job-id>/`**，绝对路径，**非 `project/`**；pre/post/upload/submit 每条命令统一前置 `cd "{work_dir}" &&`）、分区 `<PARTITION>` 先查 `mat-job-manager queues` 再注入——详见 SKILL.md 的"环境"与"执行流程（HPC 平台）"节及"已知坑"中的"工作目录校验"。

### 环境说明

ABACUS 的 `env.sh`（硬编码 `/public/software/apps/sag-tool/matsoft/abacus/v3.9.0.2/env.sh`）是**完整环境**，包含：
- Python 3.10 + 必要 Python 包（ase, numpy, matplotlib, pymatgen）
- ABACUS 可执行文件
- pyatb + pyatb_input
- phonopy + phonopy-qha
- TB2J + HamiltonIO
- SG15 赝势/基组库（由 `$ABACUS_PP_PATH`/`$ABACUS_ORBITAL_PATH` 指向）

无需额外的 conda 环境激活。

### 三阶段业务命令（经 HPC 平台远程执行）

pre/post 业务命令格式（详见 SKILL.md）：

```bash
# pre
cd "{work_dir}" && source {env_sh} && \
  abacus-workflow -i Fe.poscar -t relax -p pre

# post（轻量任务：relax/scf/eos/mei/phthermo）
cd "{work_dir}" && source {env_sh} && \
  abacus-workflow -i Fe.poscar -t relax -p post
```

> pyatb post 任务（jdos/shg/shift/bc/bcd/ahc/anc/wl/chern/surface_states/hseband）**不走登录节点**，提交第二个 slurm 作业跑（`abacus_pyatb_slurm.sh`，见 SKILL.md Step 6a）。

run 阶段由 HPC 提交 SLURM 作业执行 abacus 二进制。

### KPT 补丁（gamma_only=1 / kspacing>0 时 pre 生成空 KPT）

**已代码自愈**：`AbacusBaseWorkflow.write_input` 在 `write_inputfiles` 之后检测空 KPT 并按模式自动补写——`gamma_only=1` 补 `1 1 1`，`kspacing>0` 补显式 kpts 网格（默认 `9 9 9`，绝不会写 `1 1 1` 以免静默退化为单 k 点）。根因：ASE `write_kpt` 对 `gamma_only==1`/`kspacing>0` 故意 `return` 不写内容，但调用方已用 `"w"` 打开 KPT → 0 字节，ABACUS 3.9.0.2 解析报 `Something wrong while reading KPOINTS`。pre 后正常情况下 KPT 已非空，**无需手工干预**。

**Fallback**（仅当部署的是旧版、KPT 仍为 0 字节时）：提交前手工补最小 gamma KPT。
```bash
# gamma_only 任务（relax）
printf 'K_POINTS\n0\nGamma\n1 1 1 0 0 0\n' > relax/KPT
# kspacing 任务（anc/ahc 等）——补显式网格，不要补 1 1 1
printf 'K_POINTS\n0\nGamma\n9 9 9 0 0 0\n' > anc/KPT
```

### 工作目录校验（避免生成到 project/）

`{work_dir}` 必须是平台分配的作业目录 `.../workspace/<job-id>/`，**不是** `.../project/`。远端 shell 无持久 cwd，**每条** pre/post/upload/submit 命令必须前置 `cd "{work_dir}" &&`——漏掉则 `main.py` 按 `-i` 解析出的 work_path 会落到默认 `project/` 目录。pre 之后立即校验：
```bash
ls "{work_dir}/<task>/INPUT"   # 必须存在；缺失说明 {work_dir} 取错或漏 cd 前缀，停并纠正
```

---

## 拓扑分析任务依赖关系

拓扑性质任务遵循统一的执行模式：

1. **SCF 前处理** → 生成 `calculation='scf'` 的输入文件，开启 `out_chg=1`, `out_mat_hs2=1`, `out_mat_r=1`
2. **ABACUS SCF 运行** → 产生电荷密度、哈密顿量矩阵等中间文件
3. **pyatb 后处理** → 从 ABACUS 输出读取数据，计算拓扑性质

任务之间的差异主要在于：
- **SCF 参数**: 是否需要自旋轨道耦合（`lspinorb`）、非共线磁性（`nspin=4`）、DFT+U 等
- **pyatb_input 选项**: `--ahc`, `--anc`, `--bcd`, `--chern`, `--wl`, `--shift`, `--jdos` 等
- **Input 文件修改**: 部分任务需要修改或追加参数块（chern, shg, surface_states, bcd, shift）

### 不需要单独 scf 任务

所有拓扑/光学任务在 pre 阶段自行生成 SCF 输入，不依赖 `scf` 任务的输出。它们通过 `get_atoms()` 获取结构，优先使用 `./relax/OUT.ABACUS/STRU_NOW.cif`（若存在），否则使用 `-i` 指定的输入文件。

### 典型执行顺序

```
# Step 1: 结构弛豫（必需，后续任务需要优化后结构）
abacus-workflow -i POSCAR -t relax -p pre
abacus-workflow -i POSCAR -t relax -p run
abacus-workflow -i POSCAR -t relax -p post

# Step 2: 拓扑性质（自动使用 relax 后的结构）
abacus-workflow -i POSCAR -t ahc -p pre    # 生成 SCF 输入
abacus-workflow -i POSCAR -t ahc -p run     # 执行 SCF
abacus-workflow -i POSCAR -t ahc -p post    # pyatb 后处理
```

---

## pyatb 使用详情

### pyatb_input 命令

```bash
# 通用格式
pyatb_input -i ./ [--option]

# 各任务对应的选项
pyatb_input -i ./ --jdos      # JDOS
pyatb_input -i ./ --ahc       # 反常霍尔电导
pyatb_input -i ./ --anc       # 反常能斯特系数
pyatb_input -i ./ --bcd       # Berry 曲率偶极矩
pyatb_input -i ./ --chern     # Chern 数
pyatb_input -i ./ --wl        # Wilson 环
pyatb_input -i ./ --shift     # 位移电流
pyatb_input -i ./ --band      # 能带结构
pyatb_input --berry           # Berry 曲率（bc 任务）
pyatb_input -i ./             # SHG、表面态（无选项，手动追加参数）
```

### pyatb 执行（OpenMP 并行，post 走 slurm）

pyatb 是 **OpenBLAS 的 OpenMP 线程并行**——`OMP_NUM_THREADS` 实测线性生效（4→6、16→18 线程），直接 `pyatb` 无 segfault、不需 mpirun 包。核数由 `OMP_NUM_THREADS=32` 控制，故 slurm 用 `--ntasks=1 --cpus-per-task=32`（与 abacus 的 MPI 模板不同）。

11 个 pyatb 任务的 post **不在登录节点跑**，提交第二个 slurm 作业（模板 `abacus_pyatb_slurm.sh`，流程见 SKILL.md Step 6a）。模板内执行：

```bash
# abacus_pyatb_slurm.sh 核心（post 内部自动 cd ./<task>/pyatb 跑 pyatb）
export OMP_NUM_THREADS=32
abacus-workflow -i <INPUT> -t <TASK> -p post   # 内部 subprocess: OMP_NUM_THREADS=32 pyatb
```

### 输出目录结构

```
<task>/pyatb/Out/
├── AHC/                    # ahc 任务
│   └── ahc.dat
├── ANC/                    # anc 任务
│   └── ahc_anc.png
├── Band_Structure/         # hseband 任务
├── Berry_Curvature/        # bc 任务
├── Berry_Curvature_Dipole/ # bcd 任务
│   └── bcd.dat
├── Chern_Num/              # chern 任务
│   └── chern_number.dat
├── JDOS/                   # jdos 任务
│   └── jdos.pdf
├── Second_Harmonic_Generation/  # shg 任务
│   └── shg.pdf
├── Shift_Current/          # shift 任务
├── Surface_State/          # surface_states 任务
└── Wilson_Loop/            # wl 任务
    └── wilson_loop.dat
```

---

## TB2J 使用详情

### mei 任务后处理流程

1. 检查 SCF 计算输出完整性
2. 创建 `./mei/2_J/` 和 `./mei/2_J/OUT.ABACUS/` 目录
3. 复制文件:
   - `STRU` → `2_J/STRU`
   - `OUT.ABACUS/Orbital` → `2_J/OUT.ABACUS/Orbital`
   - `OUT.ABACUS/*.csr` → `2_J/OUT.ABACUS/`
   - `OUT.ABACUS/running_scf.log` → `2_J/OUT.ABACUS/`
4. 从 STRU 文件中自动提取磁性元素
5. 执行 `abacus2J.py`

### abacus2J.py 命令

```bash
abacus2J.py --path . --suffix ABACUS \
  --elements <element1> <element2> ... \
  --kmesh 7 7 7 --rcut 8.0 --nz 50 \
  --output_path TB2J_results
```

参数说明:
- `--path .`: 当前目录（2_J/）
- `--suffix ABACUS`: 使用 ABACUS 输出文件
- `--elements`: 磁性元素列表（自动检测）
- `--kmesh 7 7 7`: k 点网格
- `--rcut 8.0`: 截断半径（Angstrom）
- `--nz 50`: z 方向积分点数
- `--output_path TB2J_results`: 输出目录

---

## phonopy 使用详情

### phthermo 任务的 phonopy 流程

#### 超胞位移生成（pre 阶段）

```bash
phonopy --dim="dim1 dim2 dim3" -d
```

生成 `disp-001/`, `disp-002/` 等位移目录，每个包含变形后的 STRU 文件。

#### 力常数提取（post 阶段）

```bash
phonopy -f disp-001/OUT.ABACUS/running_scf.log disp-002/OUT.ABACUS/running_scf.log ...
```

#### 声子 DOS 和热性质

```bash
phonopy --dos -t --tmax 2600 -ps --mesh 48 48 48
```

参数说明:
- `--dos`: 计算声子态密度
- `-t`: 计算热力学性质
- `--tmax 2600`: 最高温度（K）
- `-ps`: 绘图
- `--mesh`: q 点网格

#### QHA 拟合

```bash
phonopy-qha e-v.dat dos-parameters.dat [options]
```

生成多张热力学性质图表（自由能、热容、熵等随温度变化曲线）。

---

## 关键 ABACUS 参数速查

拓扑和光学任务常用的 SCF 参数：

| 参数 | 值 | 说明 |
|------|---|------|
| `ecutwfc` | 100 | 截断能（Ry） |
| `basis_type` | `lcao` | 线性组合原子轨道 |
| `ks_solver` | `genelpa` | 本征值求解器 |
| `scf_thr` | `1e-7` ~ `1e-8` | SCF 收敛阈值 |
| `scf_nmax` | 200 | SCF 最大迭代步数 |
| `nspin` | 1 或 4 | 自旋设置（1=非磁性, 4=非共线磁性） |
| `lspinorb` | 0 或 1 | 自旋轨道耦合 |
| `noncolin` | 0 | 非共线磁性标记 |
| `smearing_method` | `gauss` | 展宽方法 |
| `smearing_sigma` | `5e-4` ~ `0.02` | 展宽宽度 |
| `mixing_type` | `pulay` | 电荷混合方法 |
| `out_chg` | 1 | 输出电荷密度 |
| `out_mat_hs2` | 1 | 输出哈密顿量和重叠矩阵 |
| `out_mat_r` | 1 | 输出位置矩阵 |
