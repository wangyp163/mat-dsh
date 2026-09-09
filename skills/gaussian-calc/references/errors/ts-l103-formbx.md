---
id: ts-l103-formbx
signature: "FormBX had a problem|Tors failed for dihedral|Error termination via Lnk1e in.*l103\\.exe"
task: [ts, tsxtb, qst2, qst3]
versions: [">=1.6.0"]
source: 压测 r13（集群 121466872/121467926：粗初猜默认参数 194s 稳定复现，同参重提原样再撞）
---

## 症状

TS 搜索作业 FAILED，log 尾 `Error termination via Lnk1e … l103.exe`；上方可见成串的：

```text
 Tors failed for dihedral     1 -     2 -     9 -    10
 Tors failed for dihedral     1 -     2 -     9 -    11
 FormBX had a problem.
```

`FormBX` 是 l103 为优化构建**冗余内坐标（B 矩阵）**的环节——崩塌即坐标基本身坏了，优化从未真正开始。与 [`ts-step-limit`](ts-step-limit.md) 的区别：那是"跑满步数"，这是"起步就摔"（梯度步数少、耗时短，r13 实测 57 步/194s 内死亡）。

## 根因

**初猜几何质量差**：键连关系极端（原子过近/过远/断裂中的键造成的二面角病态），内坐标构造失败。默认参数即可稳定复现（同参重提原样再撞，确定性复现器）——**不是收敛参数问题**。

## 处方（决策表）

| 事实 | 处方 |
|---|---|
| 初猜是平衡几何手摆直改 | **换初猜**：把反应坐标上应断/应成的键拉到过渡值（参考同反应族 TS 或文献键长） |
| 有粗猜但质量存疑 | `tsxtb` 预优化（GFN2 秒级）拉成合理 TS 几何再走 DFT——标准 `tsxtb+ts+irc` 路径 |
| qst2/qst3 报此错 | 检查各帧几何合理性（键长极端、原子重叠、断键过头） |
| 初猜看似合理仍崩 | 微调涉及二面角的键长 ±0.1–0.2 Å 换一套内坐标基；仍失败换初猜 |

## 禁止事项

- **不要调 MaxCycle/步数类参数**（不是收敛问题，重提必复现）。
- 不要原样重提。

## 处置后回写

按「诊断-重试协议」（SKILL.md）在 `diag/att-{NNN}-ts-l103-formbx/conclusion.md` 回写：facts（签名+涉及二面角）/ prescription（上表哪行）/ diff（初猜或链路改动）/ 新 attempt 号。
