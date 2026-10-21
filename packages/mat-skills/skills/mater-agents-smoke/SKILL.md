---
name: mater-agents-smoke
description: Use this skill to smoke-test the mater_agents software tree on cluster 141 (node141) as user helei01948 via the mat remote-shell MCP — readiness gate plus a tree-resident E2E runner that submits real Slurm jobs for vasp, abacus, quantum-espresso, cp2k, orca, gaussian and lammps, monitors them, verifies artifacts and writes report.md. Trigger phrases include 测试 mater_agents, 141 新环境冒烟, 用户态冒烟, smoke mater_agents, 端到端验证新树.
version: 0.2.0
metadata:
  adapted-for: mat-dsh
  scope: 141 /public/software/apps/mater_agents（97G 自包含树；2026-10-13 E2E 实测 7/7 PASS）
  changelog: |
    0.1.0 手工分步流程（Step1 备料/Step2 渲染提交/Step3 监控）。
    0.2.0 E2E 机制化：树自带 tests/e2e_smoke.sh（七软件备料→渲染→test-only→sbatch→等终态→验收→report.md），
    skill 改两段式（异步启动+轮询）；实战修复回写：QE I_MPI_FABRICS=shm（shm:tcp 触发 OFI fi_getinfo，与
    HPC 同坑）、LAMMPS 改 srun --mpi=pmi2（mpirun hydra+PMI 拉起异常：单 rank 网格+heap corruption）、
    cp2k 冒烟输入内老树绝对路径由 runner 自动改写；输出文件名速查（qe-*.out / lmp-*.out，非 slurm-*）。
---

# mater_agents 用户态冒烟（141）

## 产品边界

以真实计算用户 **helei01948** 在 141 上验证 `/public/software/apps/mater_agents/`（下称 **MA 树**）
的可用性：环境门禁 + 每软件一个真实 Slurm 作业 + 产物验收。不做生产计算；MA 树与 sag-tool 老树
对用户只读；所有写入只落 `$HOME/workspace/mater_agents_smoke/`。树自描述：`MA/README.md`、
`MA/registry/`、每条目 `manifest.yaml`；不确定的路径先查树（`$MA/bin/ma-list`），不要猜。

## 访问通道（mat remote-shell MCP）

MCP server 名 `mat`（配置由 dsh profile 注入，**sk 密钥不进任何仓库文件**）：

| 工具 | 参数 | 用途 |
|---|---|---|
| `list_remote_shell_clusters` | 无 | 核验集群开通状态 |
| `remote_shell_execute` | `clusterId`、`command`、`timeoutSeconds`（可省） | 执行 shell 命令 |

- **clusterId 固定 `200108`**（cluster_node141，helei01948）。
- **硬超时 180 秒**（传更大值也被压回；code 10012 command_timeout）。单条命令必须 180s 内返回。
- **每条命令全新 shell**：source/export/cd 不延续，复合命令写全。
- **沙箱语义**：跑在 `sandbox-*` 命名空间，共享 FS（/public/software、/public/home）完整可见；
  **/tmp 不跨命令**——跨命令文件一律放 `$HOME`。
- **长命令异步范式**（实测可用，后台进程跨调用存活）：
  ```
  cd $HOME/workspace/mater_agents_smoke && (setsid nohup bash <长命令> > x.log 2>&1 < /dev/null &) ; echo launched
  ```
  之后轮询 `tail x.log`。
- **pkill 自杀坑**：命令文本含目标模式串时 `pkill -f` 会杀掉自己（exitCode 143）——模式用字符类
  （`run_al[l].sh`）或杀/启分两次调用。

## Step 0 —— 环境门禁（每会话先跑，~90s）

```
cd $HOME/workspace/mater_agents_smoke && (setsid nohup bash $MA/tests/run_all.sh --quick > gate-quick.log 2>&1 < /dev/null &) ; echo launched
tail -3 $HOME/workspace/mater_agents_smoke/gate-quick.log     # 轮询到 PASS=NN FAIL=0
```

绿线 **PASS=90 FAIL=0**（结构/自包含/9 软件+4 utils 激活/8 workflow import/registry 一致性）。
有 `[FAIL]`：对照 `MA/README.md`「已知遗留」节，登记过的例外可继续，新问题停下报告，不要动树。

## Step 1 —— E2E 冒烟（树自带 runner，两段式）

runner 在树上：`$MA/tests/e2e_smoke.sh`（备料→ma-render 渲染→sbatch --test-only 预检→提交→
等终态→逐软件验收→`report.md`）。用法：

```
# 全量（7 软件，整场约 2-5 分钟）
cd $HOME/workspace/mater_agents_smoke && (setsid nohup bash $MA/tests/e2e_smoke.sh --partition debug > e2e.log 2>&1 < /dev/null &) ; echo launched
# 重跑个别软件
... bash $MA/tests/e2e_smoke.sh --partition debug --only qe,lammps > e2e2.log ...
# 轮询
tail -20 $HOME/workspace/mater_agents_smoke/e2e.log
# 终态读报告
cat $HOME/workspace/mater_agents_smoke/report.md
```

- 输入源 `sag-tool/_smoketest/`（只读），runner 自动改名对齐模板假定（espresso.pwi/cp2k.inp/
  orca.inp/input.com/input.lammps）并**自动改写 cp2k 输入里的老树 BASIS/POTENTIAL 绝对路径**；
- 重跑前自动清理上一轮产物（含 core.*，仅限 `$WORK/<软件>/`，保留 slurm.sh）；
- 分区 debug（默认）/normal；operation drain、agent2 饱和勿用。

## Step 2 —— 结果解读与失败排查

`report.md` 表格：每软件 jobid / sacct 终态 / 验收行；**全部 COMPLETED+PASS = 环境可用性验证通过**。

失败排查速查（作业输出文件名是 `<前缀>-ma-<软件>.out`，**不是** `slurm-*`：vasp-/qe-/abacus-/
cp2k-/orca-/g16-/lmp-）：

| 现象 | 已知成因与处置 |
|---|---|
| QE `OFI fi_getinfo() failed` | shm:tcp 的 tcp provider 探测炸（与 HPC 同坑）——模板已内置 `export I_MPI_FABRICS=shm`（2026-10-13 实测修复）；勿改回 shm:tcp |
| LAMMPS `corrupted size vs. prev_size` / 单 rank 网格 | mpirun(hydra+PMI) 拉起异常——模板已改 `srun --mpi=pmi2`（2026-10-13 实测修复） |
| cp2k 找不到 BASIS_MOLOPT | 输入内老树绝对路径——runner 已自动改写；自备输入请指向 `$MA/software/cp2k/2024.2/cpu-intelmpi2021/app/data/` |
| g16 失败 | 确认走的是用户级副本（env.sh 自动优先 `$HOME/workspace/g16-hy`；站点副本为兜底） |
| orca 输出乱码/卡死 | 并行由输入 %pal nprocs 控制，勿外层包 mpirun；wrapper 已内置（模板勿改） |

排查只读：`cat $WORK/<软件>/<前缀>-ma-<软件>.out`、`sacct -j <jobid> -o State,ExitCode,Elapsed`。
**修复一律走模板/输入层，两棵树（mater_agents、sag-tool）只读不改**；模板属于仓库
`mat-aitool/mater_agents/`，改后经部署脚本增量上树。

## 纪律红线

- 任何 `rm`/`rm -rf`/`mv`（含清理 $WORK）先列目标等用户确认；非本会话目录视为他人数据。
  （例外：runner 自身的重跑清理在 `$WORK/<软件>/` 内，属工具内建行为。）
- 单命令 180s 内返回；超了拆分或转异步范式。
- 全部跑完把 `report.md` 内容呈给用户，并对照 `$MA/registry/installations.yaml` 核对覆盖的条目版本；
  大规模改树/迁移不属本 skill 范围。
