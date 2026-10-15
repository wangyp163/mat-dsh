---
id: irc-wrong-direction
signature: "IRC direction check failed|forward branch not monotonically downhill|reverse branch not monotonically downhill|no irc_profile entry"
task: [irc, ts+irc, tsxtb+ts+irc, qst2+irc, qst3+irc]
versions: [">=1.4.0"]
source: irc-methods.md 前置条件（「TS 必须先验证：恰好 1 个虚频且振动方向对应反应坐标——只数个数不够，方向错误是 IRC 走不通的最常见上游原因」）+ R8b 方向门代码化（wave-gate.checkIrcDirectionGate 解析 irc_profile CSV 判两分支单调性）
prescription: [{"level":1,"route":"freq","when":"先验证 TS 虚频模式方向：对 TS 几何单跑 freq，检查唯一虚频对应的简正模式是否指向目标反应坐标（应断的键在拉长、应成的键在缩短）。方向不对则 TS 本身是错的鞍点——不要调 IRC 参数，回 ts 波换初猜"},{"level":2,"route":"irc(CalcFC,MaxPoints=50,StepSize=5)","when":"虚频方向正确但分支非单调：先按 kb:irc-l123-divergence 的积分器梯进走一档（步长减半+点数加倍），多数「回升」其实是 corrector 残差而非真实上坡"},{"level":3,"route":"irc(CalcAll,Steep,MaxPoints=50,StepSize=5)","when":"每点重算 Hessian + 最速下降积分器：既排除 Hessian 陈旧导致的方向漂移，又绕开 predictor-corrector。此档仍失败则判定 TS 不可用，dead-letter 并回 ts 波"}]
---

# IRC 方向性失败（分支非单调下坡 / 缺 irc_profile）

## 触发

R8b 方向门（`checkIrcDirectionGate`）解析 `irc_profile` CSV 后判定：

- **两分支之一（或都）不是从 TS 单调下坡**——能量在离开 TS 的过程中回升，超出抖动容忍（默认 0.001 Hartree ≈ 0.6 kcal/mol）；
- 或 `result.json` 的 `plots` 里**没有 `irc_profile` 条目**（IRC 波本应产此图）。

与 [`irc-l123-divergence`](./irc-l123-divergence.md) 的分工：那条是**积分器收敛**失败（l123 报错、corrector 不收敛，作业本身 FAILED）；本条是**作业成功但路径形态不对**——门检拦下的，log 里没有报错签名。

## 判读

IRC 的物理含义是从鞍点沿最陡下降路径滚向两侧极小点。**能量必须单调下降**。回升只有三种可能：

1. **TS 虚频方向错误**（最常见，irc-methods.md 点名的首要原因）——虚频对应的简正模式不是目标反应坐标，IRC 沿着一个错误的自由度出发，很快撞上别的势能面特征。只数虚频**个数**发现不了这个问题，必须看**模式方向**。
2. **corrector 残差**——数值噪声造成的微小回升，不是真实上坡。抖动容忍就是为它设的；超出容忍说明不止是噪声。
3. **Hessian 陈旧**——`CalcFC` 只在起点算一次 Hessian，路径走远后方向估计漂移。

## 处方梯

见 frontmatter `prescription`（三档）。要点：

- **L1 是诊断不是重试**——先跑 `freq` 看虚频模式方向。方向错了就不是 IRC 的问题，调多少 IRC 参数都没用，回 `ts` 波换初猜（参考 [`ts-l103-formbx`](./ts-l103-formbx.md) 的初猜处置）。
- L2/L3 与 `irc-l123-divergence` 的梯子有重叠是**有意的**：那条从「作业崩了」进入，本条从「路径形态不对」进入，但中段处置手段相同。
- L3 失败即 dead-letter：TS 不可用，继续烧核时没有意义。

## 处置后回写

诊断结论写入 `diag/att-{NNN}-irc-wrong-direction/conclusion.md`，固定字段：facts 摘要（引 `irc_profile` CSV 的回升位置与幅度，不 grep log 原文）/ prescription 出处 / diff / 新 attempt 号。
