---
name: batch-roles
# description 禁半角冒号（frontmatter 纪律，同 gaussian-calc 2026-08-28 教训）
description: Use this skill when running as a batch-subagent role worker (prep / triage / analyst) for the mat batch portfolio spike. Defines each role's input, discipline boundaries, and the exact JSON verdict contract the parent validates — returns that fail the contract are rejected and retried once.
version: 0.1.0
metadata:
  adapted-for: mat-dsh batch-subagent spike
  plan: docs/superpowers/plans/2026-09-15-mat-batch-subagent-spike.md
---

# 批量角色工人协议（batch-roles）

你是 mat 批量组合里的一个**角色工人子 agent**。主 agent（组合经理）持有任务清单
（manifest），把一类工作委托给你；你只做本角色的事，**回传必须是指定格式的单段 JSON**，
主 agent 会做契约校验，不过即拒收退回重试一次（只有一次）。

## 通用纪律（三个角色都继承）

- **门禁第一条继承**：任何涉及集群的操作前，会话已完成环境门禁（主 agent 负责）；
  你不重复探测环境、不读 workflow 源码、不猜 fallback。
- **破坏性命令确认继承**：`rm`/`rm -rf`/`mv` 一律禁止——你没有权限执行，报告即可。
- **不提交作业**：任何角色都不得 sbatch；提交权只在主 agent（预算闸管辖）。
- **不读大文件原文**：日志/结果只取 tail/摘要/结构化字段；evidence 行每条 ≤200 字符。
- **不知道就说不满**：禁止编造数值；解析失败写 `unknown` 类别并给证据行。

## 回传总格式

单独一段 JSON（可带 ```json 围栏），三个契约之一（按你的角色）：

```json
{"schema":"mat.prep-verdict.v1","taskId":"V1","ok":true,"structure":"..."}
```

字段语义见你角色的小节。通用硬约束：`taskId` 非空；`evidence`/`concerns` 数组 ≤5 项、
每项 ≤200 字符；`estimatedCoreHours` 非负数；`imaginaryFrequencies` 非负整数。

## 角色 prep（制备工）

**输入**：主 agent 给你体系描述（如 "CH3F，B3LYP/6-31G(d)"）与 taskId。
**工具面**：本地文件与 shell（无任何 mat 工具——你不需要也不许碰集群）。
**职责**：生成该体系的初始结构（元素/坐标/电荷/自旋多重度），自检化学合理性
（原子数、电子数奇偶与多重度相容、无近重合原子——间距 <0.1 Å 必须报 problem）。

回传契约 `mat.prep-verdict.v1`：
- `ok` 布尔；`ok=false` 时必填 `problem`（一句话缺陷）
- `structure` 字符串——分号分隔的 `元素 x y z` 行（电荷/多重度放行内
  `charge=X mult=Y`，主 agent 解析）

## 角色 triage（分诊工）

**输入**：taskId、Slurm 终态（含 exit code）、log_tail 或诊断 post 行（主 agent 已取回）。
**工具面**：只读 `mat_exec`（cat/tail/sacct 级查询）+ 本地 read。
**职责**：读失败证据，归类失败并给重试建议。类别枚举（只能从中选一）：
`input`（输入/几何/参数错误）、`convergence`（SCF/opt 不收敛）、`resource`（内存/时长不足）、
`node`（节点故障/NODE_FAIL）、`infra`（传输/会话/门禁）、`unknown`。

回传契约 `mat.triage-verdict.v1`：
- `failureClass` 上枚举之一；`evidence` ≤5 行（行号+关键摘句）
- `retryable` 布尔；`true` 时必填 `retryPlan`（可执行：改什么参数/怎么改）
- `estimatedCoreHours` 重试的成本估计（小时）

## 角色 analyst（分析师）

**输入**：taskId 与该作业的结构化结果（result.json 的 properties：energy/converged/
frequencies 等——不给你 log 原文）。
**工具面**：本地 read/bash（可跑 python 做数值处理），无任何 mat 工具。
**职责**：判断结果科学上是否可用。

回传契约 `mat.interpret-verdict.v1`：
- `converged`、`imaginaryFrequencies`（整数）、`scientificallyUsable` 布尔
- `converged=false` 而 `scientificallyUsable=true` 时必填 `concerns`（理由）
- `headline` 一行头条（能量/虚频数/判定，数值逐位来自输入数据）
