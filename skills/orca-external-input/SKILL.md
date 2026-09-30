---
name: orca-external-input
description: Use this skill when the user provides self-prepared ORCA input files (.inp) and wants them run as-is — trigger phrases include 自带输入, 现成 inp, 已准备好的输入文件, 用户输入文件, external input, 不重新生成输入, 直接跑这个 inp. Routes the agent into the orca-workflow external mode (syntax check + task registration at pre, slurm rendering at run, registry-gated post). Do NOT load for regular ORCA calculations from a structure file (use orca-calc).
version: 0.1.0-demo
depends_on:
  - mat-chat
  - mat-job-manager
  - mat-command-executor
---

# ORCA 自带输入（external 模式）

## 何时使用 / 何时不用

**使用**：用户给出一个工作目录，里面有他自己写好的 `.inp` 输入文件，要求"直接跑这个""不要改我的输入""帮我提交这个 inp"。workflow 不从结构渲染输入，而是采纳用户文件。

**不用**：用户给的是结构文件（xyz 等）或只描述计算意图——走 `orca-calc`。

## demo 部署环境（本轮压测，版本 1.1.3）

- workflow 环境：`source $HOME/workspace/orca-demo/env.sh`（orca-workflow 命令 + ORCA 二进制一并就绪）。
- run 阶段内联导出：`export ORCA_ENV_SCRIPT=/public/software/apps/sag-tool/qcsoft/orca/6.1.0-f.0/env.sh`（与 run 同一条命令）。
- 版本锚：`cat $HOME/workspace/orca-demo/VERSION` 应为 `1.1.3`。

## 场景判定树（按序执行）

0. **环境锚检查（每会话一次，首条业务命令）**：`bash -lc 'cat $HOME/workspace/orca-demo/VERSION; source $HOME/workspace/orca-demo/env.sh >/dev/null && which orca-workflow'`——VERSION 非 `1.1.3` 或 CLI 不在部署根即停止并如实报告，不试跑、不改环境。
1. 用户给出了包含 `.inp` 的工作目录且意图是**原样执行**？否 → 走 `orca-calc`。
2. **目录检查在集群侧做**（经 mat_exec），不要在本地解析 `~`。一次只处理一个文件；多个文件 = 多次独立调用本流程。
3. 不要目测诊断代替 pre——pre 的语法检查器是权威（自旋奇偶、块闭合、几何行规范只有它查得全）。
4. 进入三段式操作。`-t` 一律 `external`，`-i` 指向用户文件。

## 执行模型

`pre`（语法检查 + task 登记，不动用户文件）→ 用户确认报告 → `run`（只生成 slurm.sh，不提交）→ 外部提交/监控（mat-job-manager）→ 作业终态后 `post`（仅注册表内 task 解析）。

### 1. pre

```bash
echo '{"schema_version": "orca.external.v1"}' > "{work_dir}/pre.json"
cd "{work_dir}" && source {python_env} && \
  orca-workflow -t external -p pre -i {input.inp} -w "{work_dir}" --json pre.json
```

产物在 `{work_dir}/external/`（输入副本、structure.xyz、.calcflow-phase.json）。原文件不动。语法失败（`VALIDATION_FAILED`）：把带行号的 message 与 suggested_actions 原样转告用户，修复后重跑 pre。常见项：无 `!` 关键字行、无 `* xyz` 几何块、几何非内联笛卡尔（`* xyzfile` 拒收）、几何块内有空行、`%` 块未闭合 `end`、自旋奇偶不符。**修复前不推进 run。**

### 2. run

```bash
cd "{work_dir}" && source {python_env} && \
  export ORCA_ENV_SCRIPT="{orca_env_sh}" && \
  orca-workflow -t external -p run -i {input.inp} -w "{work_dir}" --json run.json
```

`ORCA_ENV_SCRIPT` 必须与 run 同一条命令内联导出。资源守卫：`%pal nprocs`/`%maxcore`（总量 = nprocs×maxcore）不得超过 Slurm `ntasks_per_node`/`mem`；超出时调大 Slurm 或经用户同意改输入。命令行为 `orca <副本.inp> > orca.out`——**输出名固定 orca.out**，输入文件不得叫 `orca.out`（pre 拒收）。

### 3. 提交与监控

与 `orca-calc` 相同（mat-job-manager 提交 `{work_dir}/external/slurm.sh`，终态轮询）。

### 4. post

```bash
echo '{}' > "{work_dir}/post.json"
cd "{work_dir}" && source {python_env} && \
  orca-workflow -t external -p post -i {input.inp} -w "{work_dir}" --json post.json
```

**未注册 task（如 freq）终态后也要跑一次 post**——落结构化 skipped 事件，不要以 pre 预告口头代替。

## task 推断表（关键字/块 → 登记 task）

| 输入特征 | 推断 task | post |
|----------|----------|------|
| `Opt` 关键字（含 Opt+Freq） | `opt` | 解析（能量/收敛/优化几何） |
| `ECD` 关键字 | `ecd` | 解析 |
| `TD`/`TDDFT` 关键字或 `%tddft` 块 | `tddft` | 解析 |
| `Polar` 关键字或 `%elprop` 块 | `polar` | 解析 |
| 无计算关键词（单点） | `sp` | 解析 |
| `Freq` 关键字 | `freq` | **跳过**（注册表无 freq recipe） |

**post 跳过语义**：`post = {"status": "skipped", "reason": "task not registered"}` + warning，整体仍 ok；log 留在 `external/` 供人工分析。这是预期行为，不是错误。

## 红线

1. **run 只生成 slurm.sh，绝不执行 orca**；提交永远走 job-manager。
2. **作业终态后才 post**。
3. **结果只消费 result JSON**（末行 stdout）；对 log 原文施加 cat/head/tail/grep、Read 工具、下载后本地读都算违规。
4. **用户输入是权威**：不改写用户的 inp；要改（资源超限、语法错误）先征得用户同意，由用户改原文件后重跑 pre。
5. **语法检查失败先修复再推进**。
6. **未注册 task 的 post 跳过是预期行为**。

## 故障排查

| 症状 | 处置 |
|------|------|
| `VALIDATION_FAILED`（语法/奇偶） | 转告带行号的消息与建议；修复后重跑 pre |
| `requires -t external` | external 模式 `-t` 固定 external，task 由关键字推断 |
| `resources.ncores`/`resources.memory` 超限 | 调大 Slurm 配额或经用户同意改 `%pal`/`%maxcore` |
| `must not be named 'orca.out'` | 让用户重命名输入文件 |
| post `skipped` | 未注册 task 的预期行为 |
| 换了 inp 内容想重跑 | 直接重跑 pre：副本与 input_digest 自动刷新 |
