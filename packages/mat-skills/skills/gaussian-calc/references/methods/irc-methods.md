---
id: irc-methods
signature: ""
task: [irc, ts+irc, tsxtb+ts+irc, qst2+irc, qst3+irc]
versions: [">=1.4.0"]
source: sobereva.com/400《在Gaussian中实现IRC计算的方法和技巧》全文 + 压测 r4-r7 IRC 契约实证
---

# IRC 计算方法学

## 前置（做 IRC 前必查）

- **TS 必须先验证**：恰好 1 个虚频且**振动方向对应反应坐标**（只数个数不够）——方向错误是 IRC 走不通的最常见上游原因。
- IRC 起点 = TS **优化后**几何（workflow 组合链自动传递 `g16_optimized.xyz`；standalone 时输入必须取优化几何，普通稳定分子不能当起点）。

## 关键字与参数（G16）

| 参数 | 语义 | 实践 |
|---|---|---|
| `MaxPoints=N` | **每个方向**的最大点数（默认 workflow 30） | 路径长度 ≈ MaxPoints×StepSize；加长路径要同比调两者 |
| `StepSize=S` | 每步弧长（默认 10，单位 0.01 bohr·amu^0.5） | 不收敛第一档：减半至 5 |
| `CalcFC`/`CalcAll` | 起点 Hessian / **每个点重算 Hessian** | CalcAll 强化 corrector 收敛，小体系代价可接受 |
| `Steep` | **最速下降积分器** | predictor-corrector 反复失败的最鲁棒兜底（400：最稳健的积分方式） |
| `recalcn=N` | 每 N 步重算 Hessian | CalcAll 与 CalcFC 之间的折中 |
| `forward`/`reverse` | 单向 IRC | 无 R/P 三元组时 `reaction_path` 图自动跳过（workflow 既有语义） |

## 积分器与收敛

- 默认 HPC（Hessian-based predictor-corrector）：corrector 收敛判据 `delta-x`（默认 0.01）；失败签名与梯进处方见 [`errors/irc-l123-divergence.md`](../errors/irc-l123-divergence.md)。
- 判读技巧：数 `Point Number` 块与 corrector 块的比例——多数点收敛、个别点聚簇失败＝病理点（换 Steep）；全部早期失败＝TS 方向或初猜问题。

## 产物与消费（workflow 契约）

- post 报 `irc_point_count`（Link-123 实际点数）+ 两图：`irc_profile`（Total energy along IRC，path 1 正/path 2 负/TS=0）与 `reaction_path`（R→TS→P 阶梯，kcal/mol，R/P 取 IRC 两分支端点、TS 取 point 0）。
- **端点精修**：IRC 端点是接近但未严格优化的极小（末段仍缓降）——发表级垒高应把两端点几何各做一次 `opt+freq` 重算（能量更低、垒高略升）。

## 禁止事项

- 普通 minima 直接当 IRC 起点；TS 方向未验证就跑 IRC。
- 不收敛时盲目堆 MaxPoints。
