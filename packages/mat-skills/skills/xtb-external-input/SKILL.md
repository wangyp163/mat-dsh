---
name: xtb-external-input
description: Use this skill when the user provides a self-prepared xtb xcontrol steering file (next to their xyz) and wants it run as-is — trigger phrases include 自带 xcontrol, 现成 xcontrol, 用户操控文件, 自带输入, external input, 不重新生成输入, 按我的 xcontrol 跑. Routes the agent into the xtb-workflow external mode (section check + task registration at pre, slurm rendering with -I xcontrol at run, registry-gated post). Do NOT load for regular xtb calculations from a structure file without a user xcontrol (use xtb-calc).
version: 1.2.0-demo
depends_on:
  - mat-chat
  - mat-job-manager
  - mat-command-executor
---

# xtb 自带 xcontrol（external 模式）

## 何时使用 / 何时不用

**使用**：用户的 xyz 旁边有他自己写的 `xcontrol` 操控文件（约束/扫描/MD 参数），要求"按我的 xcontrol 跑""不要重新生成操控文件"。

**不用**：只有 xyz、操控由参数描述——常规流程走 `xtb-calc`（xcontrol 由 pre.json 渲染）。**没有 xcontrol 就不是 external 场景**（pre 会明确报错指出这一点）。

## demo 部署环境（本轮压测，xtb-workflow 1.1.2）

- workflow CLI：`export PATH=$HOME/workspace/demo/bin:$PATH` 后 `xtb-workflow` 即在 PATH。
- run 内联导出：`export XTB_ENV_SCRIPT=$HOME/workspace/demo/environment/xtb-env.sh`（xtb 二进制 `$HOME/workspace/demo/environment/xtb`）。
- 版本锚：`cat $HOME/workspace/demo/xtb-workflow.VERSION` 应为 `1.1.2`。

## 执行模型

`pre`（xcontrol 语法检查 + task 登记）→ `run`（命令 `xtb <xyz> <推断 task 的 runtype 旗标> -I xcontrol`——xcontrol 节只**配置** runtype，runtype 本身由 CLI 旗标触发）→ job-manager 提交/监控 → `post`（按推断 task 解析）。

### 1. pre

```bash
echo '{"schema_version": "xtb.external.v1"}' > "{work_dir}/pre.json"
cd "{work_dir}" && source {python_env} && \
  xtb-workflow -t external -p pre -i {mol.xyz} -w "{work_dir}" --json pre.json
```

`-i` 指向用户 xyz，兄弟文件 `xcontrol`（固定名）必须存在。xyz+xcontrol 都拷进 `{work_dir}/external/`，原文件不动。语法失败（`VALIDATION_FAILED`）转告行号消息与建议；常见项：`$节` 未闭合 `$end`、重复节、`$chrg`/`$mult` 非整数、charge/mult 对 xyz 的电子奇偶不符、多帧 xyz（xtb 单几何）。

### 2. run

```bash
cd "{work_dir}" && source {python_env} && \
  export XTB_ENV_SCRIPT="{xtb_env_sh}" && \
  xtb-workflow -t external -p run -i {mol.xyz} -w "{work_dir}" --json run.json
```

slurm 命令：`export OMP_NUM_THREADS=1 ...; xtb <xyz> --gfn 2 --chrg N <runtype 旗标> -I xcontrol > xtb.out 2>&1; echo $? > xtb.exit`——旗标按推断 task 注入（`$opt`→`--opt`、`$md`→`--md`、`$metadyn`→`--metadyn`、`$scan`→**`--opt`**，xtb 无 `--scan` 旗标；sp 不注）。只写 `$opt` 节不注旗标会跑成单点（demo C1 实证），参数仍全部走 `-I xcontrol`。

### 3. 提交与监控 / 4. post

与 `xtb-calc` 相同（job-manager 提交 `external/slurm.sh`；终态后 `post.json` = `{}` 跑 post）。

## task 推断表（xcontrol 节 → 登记 task）

| xcontrol 特征 | 推断 task | post |
|---------------|----------|------|
| `$scan` 节（配 `$constrain`） | `scan` | 解析 |
| `$md` 节 | `md` | 解析 |
| `$metadyn` 节 | `metadyn` | 解析 |
| `$opt` 节 | `opt` | 解析 |
| 无 runtype 节（仅 `$chrg`/`$write` 等） | `sp` | 解析 |

v1 推断目标全部在注册表内；若 state 显示 `registered=false`（非 v1 推断路径），post 记 skipped + warning，整体仍 ok——预期行为。

## 红线

1. **run 只生成 slurm.sh，绝不执行 xtb**；提交走 job-manager。
2. **作业终态后才 post**；结果只消费 result JSON，不 cat log。
3. **用户输入是权威**：不改写用户的 xcontrol/xyz；要改先征得同意。
4. **语法检查失败先修复再推进**。
5. xcontrol 里的 `$chrg`/`$mult` 会同步进命令行（--chrg/--uhf），保证一致。

## 故障排查

| 症状 | 处置 |
|------|------|
| `requires a user-prepared 'xcontrol'` | 没有兄弟 xcontrol——这就是常规路径，改走 xtb-calc 或让用户补 xcontrol |
| `VALIDATION_FAILED`（节闭合/整数/奇偶） | 转告消息；修复后重跑 pre |
| `requires -t external` | `-t` 固定 external |
| 换了 xcontrol 内容 | 重跑 pre：副本与 input_digest 刷新 |
