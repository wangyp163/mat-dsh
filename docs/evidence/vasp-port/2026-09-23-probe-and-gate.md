# VASP/matstream 接入探针与环境门禁实证（2026-09-23）

集群 11250（账号 hpc-user-b）。工具：`scripts/probe-vasp-matstream.ts`（只读 +
`--smoke` 显式选入）。复现：`set -a; source env.local; set +a; tsx
scripts/probe-vasp-matstream.ts 11250 [--smoke]`。

## P1 sif（版本锚）

```
/public/software/apps/sag-tool/matsoft/vasp/matstream/matstream.sif
3.0G，sha256 头 16 位 = 8d4f4071b114b809  ← env_profile.sh 锚
```

## P2/P3 分区与运行时勘误

- **11250 唯一可见分区是 `kshcnormal`**（sinfo 全量核对；时限 333-08:00:00）。
  gaussian 缺省的 Agent0 在该集群已不存在（近期 sacct 记录均为 kshcnormal）。
  → vasp.ts `DEFAULT_VASP_PARTITION = 'kshcnormal'`。
- 登录节点非交互 shell **无 `module` 命令**（source /etc/profile 后仍无）；作业内
  有效（见 smoke）。→ 门禁只查 modulefile 文件树
  `/public/software/modules/apps/apptainer/<ver>`（条目是**文件**不是目录——
  `*/` 匹配不到，2026-09-23 实证修正）。

## smoke 作业（作业内 apptainer + matstream 链路实证）

作业 122832841（kshcnormal，1 核，10 秒 COMPLETED）：

```
node: a03r4n13
Conda environment initialized successfully
/opt/miniconda3/bin/matstream
usage: MatStream [-h] {run,pre,post,search} ...
SMOKE_DONE
```

结论：`source /etc/profile → module load apps/apptainer/1.2.4 → apptainer exec
$sif matstream ...` 在计算节点成立；CLI 子命令与引擎源码（本地
`~/dev/agent-workflow/src/matstream` v0.1.3）一致。

## 环境门禁（vasp-env-gate.v1）集群实跑

播种至 `$HOME/workspace/.vasp-calc/scripts/` 后 `bash check_environment.sh`：

```
{"schema":"vasp-env-gate.v1","ok":true,"workflow":"0.1.3","sif":"…matstream.sif",
 "sif_size":"3.0G","modulefile":"…apptainer/1.2.4","protocol":"new",
 "deployed_version":"8d4f4071b114b809","expected_version":"8d4f4071b114b809",
 "newer_version":"1.3.4", …,"errors":[]}
```

本地 `parseEnvGateStdout(stdout, envGateSchemaFor('vasp'))` 判定 **pass**，
warning：apptainer modulefile 旁边有更高版本 1.3.4（与 sif 锚无关，透传用户）。

## 遗留作业目录（探针副产物）

`$HOME/workspace/vasp-probe-1790154419695/`（smoke 证据，可清理）。

---

# 2026-09-24 追记：运行时切换 sif → 家目录双件套（对齐 gaussian 运维模型）

用户决策：不用 sif，workflow + VASP 软件自部署到家目录（版本自控）。

## 部署物（全部实证）

| 件 | 路径 | 内容 |
|---|---|---|
| workflow | `$HOME/workspace/matstream` | 公共 conda-pack py3.11 基座（602M 源，硬链接物化后 ~1.2G）+ matstream 0.1.3 wheel（本地 uv/py3.12 构建，7.7M）+ spglib 2.6.0 + xmltodict 1.0.4（**--no-deps** 安装——spglib 依赖解析拖 numpy2 会砸基座 scipy/matplotlib ABI；实测 numpy1.26.4 × spglib2.6.0 兼容）+ env.sh（镜像 demo 形态）+ VERSION=0.1.3 |
| VASP | `$HOME/workspace/vasp-hy` | 公共区 `5.4.4-ioptcell_intelmpi2017_hdf5_libxc` 109M 拷贝；env.sh 改写：SCRIPTDIR 家目录化 + module 守卫 + **mpi/* 卸载循环**（作业环境 /etc/profile 预载 mpi/hpcx 与 intelmpi 冲突，作业 122895517 发现）+ VERSION |

部署坑（已修，bootstrap_vasp.sh/SKILL.md 固化）：公共基座自带陈旧 `.conda-unpack-done`（源位置已 unpack，占位前缀不存）→ conda-unpack 失败 → sed 重写 bin/ shebang 烧死的公共路径；wheel 经 efile 上传（center 发现 404 已知坑，直用 `https://ksefile.internal-hpc.example:65241/efile`；单文件 ≤8M 免分片）。

## 验证链（作业号可溯）

1. 登录节点 import 冒烟：`numpy 1.26.4 / spglib 2.6.0 / ase 3.29.0 / matstream 0.1.3` 全通；
2. 登录节点 `matstream pre -c vasp -t relax`（Si8）真跑：Task.Relax/{INCAR,KPOINTS Γ3×3×3,POTCAR(potpaw_pbe_54),slurm.sh} + matstream.json 契约 ✓；
3. 作业内环境链（作业 122895517，kshcnormal，61s COMPLETED）：双 source 后 vasp_std/srun/matstream 在场 + pre 作业内 OK；暴露 mpi/hpcx 冲突（已修）；
4. **真实 VASP scf**（作业 122895612，4 核，80s COMPLETED）：`matstream run -c vasp -t scf` 整链 pre→`srun --mpi=pmi2 vasp_std`→post，vasprun.xml 解析出 energy -45.8977 eV / efermi 6.11 / DOS；目录 `Task.1.Scf`（run 带序号前缀，收割解析器兼容）；
5. 门禁 v2（vasp-env-gate.v2）集群实跑 PASS：import 真探版本 0.1.3 比锚 + 任务注册表 15 项（12 具体 + 3 基类）+ vasp_std/VERSION 锚。

## sif 时代（2026-09-23，已退役）

保留历史：公共区 sif（sha256 头 8d4f4071b114b809）+ apptainer 路线曾全链验证通过（作业 122832841）。
