---
name: vasp-external-input
description: Use this skill when the user provides a working directory that already contains self-prepared VASP input files (INCAR/POSCAR/KPOINTS/POTCAR) and wants them run as-is — trigger phrases include 自带 INCAR, 现成四件套, 已准备好的输入文件, 用户输入文件, external input, 不重新生成输入, 不要动我的 INCAR. Routes the agent into the vasp-workflow external mode (INCAR syntax check + task registration at pre, slurm rendering at run, registry-gated post). Do NOT load for regular VASP calculations from a POSCAR structure (use vasp-calc — that path generates INCAR/KPOINTS/POTCAR itself).
version: 0.1.0-demo
---

# VASP 自带输入（external 模式）

## 何时使用 / 何时不用

**使用**：用户的工作目录里有他自己准备的 VASP 四件套（INCAR/POSCAR/KPOINTS/POTCAR），要求"直接跑这套输入""不要动我的 INCAR"。workflow 不渲染输入，采纳用户文件。

**不用**：用户只给结构（POSCAR）+ 计算意图——常规流程走 `vasp-calc`（INCAR/KPOINTS/POTCAR 由 pymatgen 参数集 + vaspkit/matstream 生成）。

## demo 部署环境（本轮压测，版本 1.1.0）

- workflow CLI：`source $HOME/workspace/vasp-demo/env.sh`（venv @ qe_env python 3.11 + 自带 pymatgen，PYTHONPATH 已内置）。
- run 内联导出：`export VASP_ENV_SCRIPT=$HOME/workspace/vasp-hy/scripts/env.sh`；分区用 `kshcnormal`（Agent0 不存在）。
- 版本锚：`cat $HOME/workspace/vasp-demo/VERSION` 应为 `1.1.0`。

集群定位、mat-command-executor/mat-job-manager 设施与 `vasp-calc` 完全相同，先读该 skill 的对应章节再继续。

## 场景判定树（按序执行）

0. **环境锚检查（每会话一次，首条业务命令）**：`bash -lc 'cat $HOME/workspace/vasp-demo/VERSION; source $HOME/workspace/vasp-demo/env.sh >/dev/null && which vasp-workflow'`——版本非 `1.1.0` 或 CLI 不在部署根即停止并如实报告。

1. 目录里有用户自备 INCAR 且意图**原样执行**？否 → 走 `vasp-calc`。
2. **目录检查在集群侧做**（经 mat_exec），不要在本地解析 `~`。一次只处理一套四件套。
3. 兄弟文件快筛（POSCAR/POTCAR 在不在）可以目测，但**语法与契约校验以 pre 为权威**（INCAR 重复标签、KPOINTS 豁免规则只有它查）。
4. 进入三段式操作。`-t` 一律 `external`，`-i` 指向 INCAR（所在目录即工作目录）；**每套四件套用独立 workdir**。

## 执行模型

`pre`（INCAR 语法 + 兄弟文件契约 + task 登记）→ `run`（只生成 external/slurm.sh）→ job-manager 提交（**从 external/ 目录提交**）→ 终态后 `post`（仅 relax/scf 通用报告）。

### 1. pre

```bash
echo '{"schema_version": "vasp.external.v1"}' > "{work_dir}/pre.json"
cd "{work_dir}" && source {python_env} && \
  vasp-workflow -t external -p pre -i {work_dir}/INCAR --json pre.json
```

兄弟文件契约：**POSCAR、POTCAR 必需；KPOINTS 在 INCAR 无 KSPACING 时必需**。external 模式**绝不代生成赝势或 KPOINTS**——缺文件报 `VALIDATION_FAILED` 并指明缺哪个，让用户补齐。四件套逐字节拷进 `{work_dir}/external/`，原文件不动。

语法失败常见项：INCAR 行缺 `=`、空标签、空值、重复标签（VASP 只采用其一，易掩盖真实意图）。

### 2. run

```bash
cd "{work_dir}" && source {python_env} && \
  export VASP_ENV_SCRIPT="{vasp_env_sh}" && \
  vasp-workflow -t external -p run -i {work_dir}/INCAR --json run.json
```

slurm 命令 `srun --mpi=pmi2 vasp_std`，脚本内 `cd "$SLURM_SUBMIT_DIR"`——**提交必须从 `{work_dir}/external/` 目录执行 sbatch**（vasp_std 读提交目录的四件套）。v1 无 INCAR×Slurm 资源交叉校验（兼容性由提交参数负责）。

### 3. 提交与监控

经 mat-job-manager 在 `{work_dir}/external/` 下提交 `slurm.sh`，终态轮询。

### 4. post

```bash
echo '{}' > "{work_dir}/post.json"
cd "{work_dir}" && source {python_env} && \
  vasp-workflow -t external -p post -i {work_dir}/INCAR --json post.json
```

注册 task（relax/scf）报告 OUTCAR/vasprun.xml/CONTCAR/CHGCAR/DOSCAR + `energy`（Vasprun）+ `converged`；**未注册 task（如 ICHARG=11 的 dos/band 类）也要跑一次 post**——落结构化 skipped 事件。

## task 推断表（INCAR 标签 → 登记 task）

| INCAR 特征 | 推断 task | post |
|-----------|----------|------|
| `NSW > 0` 且 `IBRION != -1` | `relax` | 通用报告（文件 + 能量 + converged） |
| `ICHARG = 11`（非自洽后处理） | `dos` | **跳过**（多作业编排任务单一 INCAR 无法表达） |
| 其余（NSW 缺省/为 0 或 IBRION=-1） | `scf` | 通用报告 |

**post 跳过语义**：`post = {"status": "skipped", "reason": "task not registered"}` + warning，整体仍 ok；产物文件保留在 `external/` 供人工检查。预期行为，不是错误。

## 红线

1. **run 只生成 slurm.sh，绝不执行 vasp_std**；提交走 job-manager。
2. **作业终态后才 post**；结果只消费 result JSON，不 cat OUTCAR。
3. **用户输入是权威**：不改写用户的四件套（尤其 POTCAR/KPOINTS 不代生成）；要改先征得用户同意，由用户改原文件后重跑 pre。
4. **语法/缺文件失败先修复再推进**。
5. **未注册 task 的 post 跳过是预期行为**。

## 故障排查

| 症状 | 处置 |
|------|------|
| `缺少 external 模式必需文件` | 让用户补齐 POSCAR/KPOINTS/POTCAR（按报错点名的文件） |
| `VALIDATION_FAILED`（INCAR 行号） | 转告消息；修复后重跑 pre |
| `需要 -t external` | `-t` 固定 external，task 由 INCAR 推断 |
| 换了 INCAR 内容 | 重跑 pre：副本与 input_digest 刷新 |
| 作业跑错目录/找不到 INCAR | sbatch 必须从 `external/` 目录执行（SLURM_SUBMIT_DIR 契约） |
