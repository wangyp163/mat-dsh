---
name: qe-external-input
description: Use this skill when the user provides a self-prepared pw.x input file (espresso.pwi) and wants it run as-is — trigger phrases include 自带 pwi, 现成 espresso 输入, 已准备好的输入文件, 用户输入文件, external input, 不重新生成输入, 按我的 pwi 跑. Routes the agent into the qe-workflow external mode (payload-routed, syntax check + pseudo_dir validation + task registration at pre, slurm rendering at run, registry-gated post). Do NOT load for regular QE calculations from a structure file (use qe-calc).
version: 0.1.0-demo
---

# QE 自带输入（external 模式）

## 何时使用 / 何时不用

**使用**：用户给出他自己写的 pw.x 输入（`espresso.pwi`），要求"按我的 pwi 跑""不要重新生成输入"。

**不用**：用户给的是结构文件（POSCAR 等）——常规流程走 `qe-calc`。用户给的是 bands.x/dos.x 等后处理工具输入——v1 只支持 pw.x 输入，明确告知并拒收。

## demo 部署环境（本轮压测，版本 1.1.2）

- workflow CLI：`source $HOME/workspace/qe-demo/env.sh`（venv @ qe_env python + pylibs pymatgen 前置）后 `qe-workflow` 即在 PATH。
- run 内联导出：`export QE_ENV_SCRIPT=/public/software/apps/sag-tool/qe/7.0-intel2021/scripts/env.sh`（QE 二进制 env）；分区 `kshcnormal`。
- 版本锚：`cat $HOME/workspace/qe-demo/VERSION` 应为 `1.1.2`。

集群定位、mat-command-executor/mat-job-manager 设施与 `qe-calc` 完全相同，先读该 skill 的对应章节再继续。

## 场景判定树（按序执行）

0. **环境锚检查（每会话一次，首条业务命令）**：`bash -lc 'cat $HOME/workspace/qe-demo/VERSION; source $HOME/workspace/qe-demo/env.sh >/dev/null && which qe-workflow'`——版本非 `1.1.2` 或 CLI 不在部署根即停止并如实报告。

## 与其它引擎的差异：路由

**qe 无 `-t` 标志**：external 由 pre.json 的 `schema_version` 路由（任务 flags 忽略），结果 JSON 的 task 回显 `external`；run/post 不带任务 flag，workflow 发现在位的 external state 即自动续链。

## 执行模型

`pre`（pwi 语法 + pseudo_dir 作业视角校验 + task 登记）→ `run`（只生成 external/slurm.sh）→ job-manager 提交 → 终态后 `post`（仅 relax/scf/nscf 读 pwscf.xml 通用报告）。

### 1. pre

```bash
echo '{"schema_version": "qe.external.v1"}' > "{work_dir}/pre.json"
cd "{work_dir}" && source {python_env} && \
  qe-workflow -i {work_dir}/espresso.pwi --pre --json pre.json
```

`-i` 指向 pwi（所在目录即工作目录）；pwi 逐字节拷为 `{work_dir}/external/espresso.pwi`，原文件不动。

- 语法检查：至少一个 `&namelist`（&CONTROL/&SYSTEM/...）、ATOMIC_POSITIONS 卡片必需（几何内联）；`&BANDS`/`&DOS` 等后处理 namelist 拒收（v1 只支持 pw.x 输入）。
- **pseudo_dir 按作业视角（external/）解析**：相对目录（如 `../pseudo`）不随副本拷贝，解析不到就报错——让用户写绝对路径。

### 2. run

```bash
cd "{work_dir}" && source {python_env} && \
  export QE_ENV_SCRIPT="{qe_env_sh}" && \
  qe-workflow -i {work_dir}/espresso.pwi --json run.json
```

（不带任务 flag；环境差异沿用 qe-calc 的 IntelMPI 2017 回退说明。）slurm 命令 `mpirun -np N pw.x -in espresso.pwi > espresso.pwo`，作业从 external/ 提交。

### 3. 提交与监控 / 4. post

与 `qe-calc` 相同（job-manager 提交 `external/slurm.sh`；`post.json` = `{}`，`--post` 跑 post——同样不带任务 flag）。

## task 推断表（&CONTROL calculation → 登记 task）

| calculation | 推断 task | post |
|-------------|----------|------|
| `relax` / `vc-relax` | `relax` | pwscf.xml 收敛 + total energy (Ry) |
| `scf`（缺省值） | `scf` | 同上 |
| `nscf` | `nscf` | 同上 |
| `md` 等 | 原值登记 | **跳过** |

**post 跳过语义**：`post = {"status": "skipped", "reason": "task not registered"}` + warning，整体仍 ok；pwi/pwo 保留在 `external/` 供人工检查。预期行为，不是错误。未收敛作业报 `converged=false`（不报错），能量键缺席。

## 红线

1. **run 只生成 slurm.sh，绝不执行 pw.x**；提交走 job-manager。
2. **作业终态后才 post**；结果只消费 result JSON。
3. **用户输入是权威**：不改写用户的 pwi；要改先征得同意。
4. **语法/路径校验失败先修复再推进**。
5. **未注册 task 的 post 跳过是预期行为**。

## 故障排查

| 症状 | 处置 |
|------|------|
| `只支持 pw.x 输入` | 后处理工具输入（&BANDS 等）不适用——告知用户自行执行对应 .x 或改供 pw.x 输入 |
| `pseudo_dir ... 不存在` | 相对目录不随副本拷贝——让用户写绝对路径 |
| `VALIDATION_FAILED`（语法） | 转告消息；修复后重跑 pre |
| run/post 报"必须指定一个任务 flag" | 忘了先跑 pre（external state 不在位）——先 pre |
| 换了 pwi 内容 | 重跑 pre：副本与 input_digest 刷新 |
