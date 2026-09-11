---
name: gaussian-external-input
description: Use this skill when the user provides a working directory that already contains self-prepared Gaussian 16 input files (.gjf/.com) and wants them run as-is — trigger phrases include 自带输入, 现成 gjf, 已准备好的输入文件, 用户输入文件, external input, 不重新生成输入. Routes the agent into the gaussian-workflow external mode (-t external; syntax check + task registration at pre, slurm rendering at run, registry-gated post). Do NOT load for regular calculations from a structure file (use gaussian-calc), or for release/stress testing.
version: 0.1.0-demo
metadata:
  adapted-for: mat-dsh
  source: ~/dev/mat-aitool/skills/gaussian-external-input@0.1.0
  adaptation: 2026-09-11 M29 首版入 dsh 血脉（配套远端 workflow 1.7.0 external 模式）——工具链适配 mat_exec（JSON 参数工具，cluster_id 11250）+ mat_job_watch 异步监控；门禁协议沿用 gaussian-calc 同款（新会话第一条业务命令 = 远端 check_environment.sh，跨轮产物不得诱发 pre-gate 取证）；提交/下载/删除类纪律与 gaussian-calc 一致。
---

# Gaussian 自带输入（external 模式）

## 何时使用 / 何时不用

**使用**：用户给出一个工作目录，里面有他自己写好的 `.gjf`/`.com` 输入文件，要求"直接跑这个""不要改我的输入""帮我提交这个 gjf"。workflow 不从结构渲染输入，而是采纳用户文件。

**不用**：

- 用户给的是结构文件（xyz 等）或只描述计算意图——那是常规流程，走 `gaussian-calc`（workflow 负责渲染 gjf）。
- 单纯本地检查一个 gjf 语法（无提交意图）——可以用本流程的 pre，但先向用户确认。

环境激活、集群定位、`bootstrap_g16.sh`、`GAUSSIAN_ENV_SCRIPT` 等通用设施与 `gaussian-calc` 完全相同，先读该 skill 的「环境激活」「环境门禁」两节再继续。

## 环境门禁（第一条业务命令）

与 `gaussian-calc` 同款门禁铁律：开始任何队列查询、文件检查、pre/run/post 前，先执行一次门禁——**即使对话/prompt 携带现成 gjf 文件引用，门禁仍是第一条**，不得先做任何 pre-gate 取证：

```
mat_exec({"cluster_id": "11250", "command": "bash $HOME/workspace/.gaussian-calc/scripts/check_environment.sh", "timeout_seconds": 180})
```

要求 `ok=true`、`protocol=new`、`deployed_version == expected_version`、`missing_tasks=[]`。`REQUIRED_TASKS` 不含 `external`（它是模式标识非注册 task，属预期）。门禁失败立即停止本轮。

## 场景判定树（按序执行）

1. 用户是否给出了包含 `.gjf`/`.com` 的工作目录，且意图是**原样执行**这些输入？否 → 走 `gaussian-calc`。
2. 目录里有几个输入文件？**一次只处理一个**：向用户确认目标文件（或按用户点名）；多个文件 = 多次独立调用本流程，互不影响。
3. 输入是笛卡尔坐标吗？（`head` 看 geometry 块，每行应为 `符号 x y z`。）Z-matrix 输入 external 模式**暂不支持**——告知用户转笛卡尔后再来。
4. 进入三段式操作（下节）。`-t` 一律用 `external`，`-i` 指向用户文件，`-w` 用绝对路径。

## 执行模型

`pre`（语法检查 + task 登记，不动用户文件）→ 用户确认语法报告 → `run`（只生成 slurm.sh，不提交）→ `mat_exec` sbatch 提交 + `mat_job_watch` 异步监控 → 作业终态后 `post`（仅注册表内 task 解析）。

以下命令均经 `mat_exec` 执行（`command` 值原样传给远端 shell；`{work_dir}` 用绝对路径）。

### 1. pre——语法检查 + task 类型登记

```
mat_exec({"cluster_id": "11250", "command": "echo '{\"schema_version\": \"gaussian.external.v1\"}' > \"{work_dir}/pre.json && source $HOME/workspace/demo/env.sh && gaussian-workflow -t external -p pre -i {input.gjf} -w \"{work_dir}\" --json \"{work_dir}/pre.json\"", "timeout_seconds": 60})
```

产物：`{work_dir}/external/` 下有输入**副本**、`structure.xyz`、`.calcflow-phase.json`。用户原文件不动。结果 JSON 的 `context` 里有推断报告（`route infers task '...'`），未注册 task 会带 `post will skip` 的 warning——**这是预告，不是失败**。

语法检查失败（`error_detail.code == "VALIDATION_FAILED"`）：把 `error_detail.message`（带行号）与 `error_detail.suggested_actions` 原样转告用户，修复后重跑 pre。常见项：无 route 段、charge/mult 缺失或自旋奇偶不符、几何行不是 `符号 x y z`、Z-matrix（不支持）、qst2/qst3 节数不符、多节原子不一致。**修复前不推进 run。**

### 2. run——生成 slurm.sh

`GAUSSIAN_ENV_SCRIPT` 必须与 run **同一条命令内联导出**（`mat_exec` 每条命令都是新 shell）：

```
mat_exec({"cluster_id": "11250", "command": "source $HOME/workspace/demo/env.sh && export GAUSSIAN_ENV_SCRIPT=\"$HOME/workspace/g16-hy/scripts/env.sh\" && gaussian-workflow -t external -p run -i {input.gjf} -w \"{work_dir}\" --json \"{work_dir}/run.json\"", "timeout_seconds": 60})
```

`run.json` 只含 `{"slurm": {...}}`，字段白名单与 `gaussian-calc` 相同。资源守卫沿用：gjf 的 `%nprocshared`/`%mem` 不得超过 Slurm `ntasks_per_node`/`mem`，超出报错时调大 Slurm 配额或改小 gjf 的 Link 0（后者需用户同意）。**注册表外的 task 照常 run**——post 跳过不影响执行。

### 3. 提交与监控

```
mat_exec({"cluster_id": "11250", "command": "cd \"{work_dir}/external\" && sbatch slurm.sh", "timeout_seconds": 30})
mat_job_watch({"cluster_id": "11250", "job_ids": ["<jobid>"], "label": "gaussian external @{input} #<jobid>"})
```

不手动 `squeue`/`sacct` 轮询。提交前可核对命令行（`grep "g16 <" slurm.sh` 应为 `g16 < {input}.gjf > {input}.log`）。

### 4. post——注册表内 task 才解析

```
mat_exec({"cluster_id": "11250", "command": "echo '{}' > \"{work_dir}/post.json && source $HOME/workspace/demo/env.sh && gaussian-workflow -t external -p post -i {input.gjf} -w \"{work_dir}\" --json \"{work_dir}/post.json\"", "timeout_seconds": 60})
```

结果消费契约与 `gaussian-calc` 一致：只消费 result JSON（`status`/`properties`/`warnings`/`error_detail`），**禁止读取 log 原文**（`cat`/`head`/`tail`/`grep`/`awk`/`sed`、下载后本地读都算）。

## task 推断表（route → 登记 task）

| route 特征 | 推断 task | post |
|-----------|----------|------|
| `opt=TS` + `external=` | `tsxtb` | 解析 |
| `opt=TS` / `opt=QST2` / `opt=QST3` | `ts` / `qst2` / `qst3` | 解析 |
| `opt` 与 `freq` 同 route | `opt+freq` | 解析 |
| `opt`（含 `opt=modredundant`） | `opt` | 解析 |
| `freq` / `irc` / `td` / `polar` | `freq` / `irc` / `tddft` / `polar` | 解析 |
| 无计算关键词（单点） | `sp` | 解析 |
| `scan` / `force` 等 | 原样登记（如 `scan`） | **跳过** |

**post 跳过语义**：注册表外 task 的 post 记 `stages.post = "skipped"` 并给 warning，整体结果仍 ok；log 留在 `{work_dir}/external/` 供人工检查。**这是预期行为，不是错误**——不要重试、不要报障，向用户说明"该计算类型无自动解析，log 已就绪可自行分析/下载"（下载经 `mat_download`）。

## 红线

1. **run 只生成 slurm.sh，绝不执行 g16**；提交走 `mat_exec` sbatch。
2. **作业终态后才 post**；未完成就 post 是误用。
3. **结果只消费 result JSON**；log 原文红线与 `gaussian-calc` 一致。
4. **用户输入是权威**：不改写用户的 gjf（副本仅用于与 slurm 同目录的执行契约）；需要改（资源超限、语法错误）先征得用户同意，由用户改原文件后重跑 pre。
5. **语法检查失败先修复再推进**：不带着 VALIDATION_FAILED 进 run。
6. **未注册 task 的 post 跳过是预期行为**，不是故障。
7. **rm/mv/清理类操作一律先经用户确认**（与 gaussian-calc M4 纪律同源）。

## 故障排查

第一步永远读 result JSON 的 `error_detail.code` + `suggested_actions`：

| 症状 | 处置 |
|------|------|
| `VALIDATION_FAILED`（语法/帧数/奇偶） | 转告用户带行号的消息与建议；修复后重跑 pre |
| `JSON run requires GAUSSIAN_ENV_SCRIPT` | 与 run 同一条命令内联 export（见上） |
| `resources.ncores must not exceed ...` | gjf `%nprocshared` 超 Slurm 核数——调 Slurm 或经用户同意改 gjf |
| `-t` 不是 `external` 的报错 | external 模式 `-t` 固定为 `external`，task 类型由 route 推断，CLI 不指定 |
| post `skipped` | 未注册 task 的预期行为，见「post 跳过语义」 |
| 换了 gjf 内容想重跑 | 直接重跑 pre：副本与 `input_digest` 自动刷新，run 会按新命令行重写 slurm.sh |
