---
name: abacus-external-input
description: Use this skill when the user provides a self-prepared ABACUS INPUT file (with its STRU, next to it) and wants it run as-is — trigger phrases include 自带 INPUT, 现成 INPUT/STRU, 已准备好的输入文件, 用户输入文件, external input, 不重新生成输入. Routes the agent into the abacus-workflow external mode (INPUT syntax check + runtime-path validation + task registration at pre, slurm rendering at run, registry-gated post). Do NOT load for regular ABACUS calculations from a structure file (use abacus-calc).
version: 0.1.0-demo
depends_on:
  - mat-chat
  - mat-job-manager
  - mat-command-executor
---

# ABACUS 自带输入（external 模式）

## 何时使用 / 何时不用

**使用**：用户给出他自己写的 ABACUS `INPUT`（同目录有对应 `STRU`），要求"直接跑这个 INPUT""不要重新生成输入"。

**不用**：用户给的是结构文件（poscar 等）——常规流程走 `abacus-calc`。

## demo 部署环境（本轮压测，版本 1.1.2）

- workflow CLI：`source $HOME/workspace/demo-abacus/env.sh`（standing 部署：公共 abacus conda 底座 + venv 叠加 + OPAL_PREFIX 清毒）后 `abacus-workflow` 即在 PATH。
- run 内联导出：`export ABACUS_ENV_SCRIPT=$HOME/workspace/demo-abacus/env.sh`（清毒版 env；**勿用公共裸 env.sh，勿覆盖 ABACUS_MPI_LAUNCHER**——默认 mpirun 是实证形态，srun 会 MPI_Init 失败）；分区 `kshcnormal`。
- 版本锚：`cat $HOME/workspace/demo-abacus/VERSION` 应为 `1.1.2`。

环境激活、集群定位与 `abacus-calc` 完全相同，先读该 skill 的环境/集群两节再继续。

## 场景判定树（按序执行）

0. **环境锚检查（每会话一次，首条业务命令）**：`bash -lc 'cat $HOME/workspace/demo-abacus/VERSION; source $HOME/workspace/demo-abacus/env.sh >/dev/null 2>&1 && which abacus-workflow'`——版本非 `1.1.2` 或 CLI 不在部署根即停止并如实报告。

1. 有用户自备 INPUT 且意图**原样执行**？否 → 走 `abacus-calc`。
2. **目录检查在集群侧做**（经 mat_exec）。一次只处理一套输入。
3. 兄弟/引用文件以 pre 为权威：stru_file 引用的结构必须存在；`kspacing`/`gamma_only` 豁免 KPT；pseudo_dir/orbital_dir 按作业视角（external/）解析。
4. 进入三段式操作。`-t` 一律 `external`，`-i` 指向 INPUT（所在目录即工作目录）；**每套输入用独立 workdir**。

## 执行模型

`pre`（语法 + 运行期路径 + task 登记）→ `run`（只生成 external/slurm.sh）→ job-manager 提交 → 终态后 `post`（仅 relax/scf 通用报告）。

### 1. pre

```bash
echo '{"schema_version": "abacus.external.v1"}' > "{work_dir}/pre.json"
cd "{work_dir}" && source {env_sh} && \
  abacus-workflow -t external -p pre -i {work_dir}/INPUT --json pre.json
```

- INPUT 逐字节拷进 `{work_dir}/external/`；stru_file/kpt 引用的**相对文件**随副本一同拷贝（绝对引用原位直读）。
- **pseudo_dir/orbital_dir 相对目录不会随副本拷贝**：按 external/ 视角解析不到就报错——让用户写绝对路径。这是防作业死跑的显式契约。
- 语法失败（`VALIDATION_FAILED`）转告行号消息：常见项为 INPUT 行缺 `=`、空键、空值。

### 2. run

```bash
cd "{work_dir}" && source {env_sh} && \
  export ABACUS_ENV_SCRIPT="{env_sh}" && \
  abacus-workflow -t external -p run -i {work_dir}/INPUT --json run.json
```

（集群 MPI 启动差异大时按 `abacus-calc` 的说明设 `ABACUS_MPI_LAUNCHER`。）命令体 `mpirun -np N abacus > abacus.out 2>&1`，作业在 external/ 内执行。

### 3. 提交与监控 / 4. post

与 `abacus-calc` 相同（job-manager 提交 `external/slurm.sh`；终态后 `post.json` = `{}` 跑 post）。

## task 推断表（INPUT calculation → 登记 task）

| calculation | 推断 task | post |
|-------------|----------|------|
| `relax` | `relax` | 通用报告（OUT.ABACUS 日志 + Finish Time 收敛 + final etot + scf_convergence/relax_energy plots） |
| `scf`（缺省值） | `scf` | 通用报告（文件 + converged，无能量键） |
| `md`/`nscf` 等 | 原值登记 | **跳过** |

**post 跳过语义**：steps 的 post 记 `{"status": "skipped", "reason": "task not registered"}` + warning，整体仍 ok；日志留盘供人工检查。预期行为，不是错误。post 对未收敛作业（日志无 Finish Time）报 `CONVERGENCE_FAILED`——这是非静默契约。

## 红线

1. **run 只生成 slurm.sh，绝不执行 abacus**；提交走 job-manager。
2. **作业终态后才 post**；结果只消费 result JSON。
3. **用户输入是权威**：不改写用户的 INPUT/STRU；要改先征得同意。
4. **语法/路径校验失败先修复再推进**。
5. **未注册 task 的 post 跳过是预期行为**。

## 故障排查

| 症状 | 处置 |
|------|------|
| `stru 文件 ... 不存在` | stru_file 引用的文件放进 INPUT 同目录 |
| `pseudo_dir 目录 ... 不存在` | 相对目录不随副本拷贝——让用户写绝对路径 |
| `VALIDATION_FAILED`（INPUT 行号） | 转告消息；修复后重跑 pre |
| post `CONVERGENCE_FAILED` | 日志无 Finish Time——作业未完成/失败，查 log 尾 |
| 换了 INPUT 内容 | 重跑 pre：副本与 input_digest 刷新 |
