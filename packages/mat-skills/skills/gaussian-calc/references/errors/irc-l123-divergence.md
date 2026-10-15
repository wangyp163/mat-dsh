---
id: irc-l123-divergence
signature: "l123\\.exe|Delta-x Convergence NOT Met|corrector steps exceded|Corrector not converged"
task: [irc, ts+irc, tsxtb+ts+irc, qst2+irc, qst3+irc]
versions: [">=1.4.0"]
source: sobereva.com/400（IRC 方法学）+ 压测 r6 D15/r7 D17 + 真实会话 4bd8fec0（IRC 三连败：StepSize 减半与 CalcAll 均只让死亡点后移）
prescription: [{"level":1,"route":"irc(CalcFC,MaxPoints=50,StepSize=5)","when":"默认 30/10 失败的第一档：步长减半+点数加倍（D15 实战处方）"},{"level":2,"route":"irc(CalcAll,MaxPoints=50,StepSize=5)","when":"每点重算 Hessian，corrector 收敛的标准强化；小体系算得起"},{"level":3,"route":"irc(CalcFC,Steep,MaxPoints=50,StepSize=5)","when":"最速下降积分器绕开 predictor-corrector——最鲁棒兜底；1/2 级只让死亡点后移时直接跳此级"}]
---

## 症状

IRC 作业 FAILED，log 尾 `Error termination via Lnk1e … l123.exe`；上方可见 `CORRECTOR INTEGRATION CONVERGENCE: Delta-x Convergence NOT Met` / `Maximum number of corrector steps exceded`。

## 根因判别（先做，D17 双机理）

1. **PES 到头**：log 有 `PES minimum detected on this side of the pathway`（|grad| 低于驻点阈值）＝路径真到头，点数少是**真实一致数据**，不是缺陷——直接收口。
2. **积分发散**：corrector 迭代到 20 次上限不收敛（本条目）——少原子/平坦势面/大步长高发。注意死亡点位置：`grep -c "Point Number"` 与 corrector 块数对比（真实会话经验：49 块中 29 收敛、20 不收敛聚簇＝病理点，非全局发散）。

## 处方（梯进，每级一次提交）

| 级 | 参数 | 适用 |
|---|---|---|
| 1 | `irc(CalcFC,MaxPoints=50,StepSize=5)` | 默认 30/10 失败的第一档：步长减半+点数加倍（D15 实战处方） |
| 2 | `irc(CalcAll,MaxPoints=50,StepSize=5)` | 每点重算 Hessian，corrector 收敛的标准强化；小体系算得起 |
| 3 | `irc(CalcFC,Steep,MaxPoints=50,StepSize=5)` | **最速下降积分器，绕开 predictor-corrector 机制**——最鲁棒兜底（sobereva/400：Steepest Descent 是最稳健的 IRC 积分方式，不收敛体系的首选） |

要点：① 整体值覆盖（pre.json `irc` 键写全，不能只写增量）；② 若 1、2 级只让死亡点**后移**不根治（corrector 数据逐位相同/聚簇不变），直接跳 Steep——真实会话三连败的教训；③ 前置自检：TS 虚频方向是否真对应反应坐标（方向错了 IRC 必然走不通）。

## 处置后回写

按「诊断-重试协议」（SKILL.md）在 `diag/att-{NNN}-irc-l123-divergence/conclusion.md` 回写：facts（死亡点位置/聚簇形态）/ prescription（上表哪一级）/ diff（参数改动）/ 新 attempt 号。

## 禁止事项

- 原样重提（同参必复现）。
- 只加 MaxPoints 不动步长/积分器。
