---
id: ts-convergence
signature: ""
task: [tsxtb, ts, opt, irc, qst2, qst3]
versions: [">=1.5.0"]
source: sobereva.com/164《量子化学计算中帮助几何优化收敛的常用方法》全文 + 压测 r9 实证 + tsxtb 特化
---

# 几何优化不收敛：诊断与解法

## 第一步永远是诊断（别急着换关键词）

读**能量、受力、位移随步数的变化曲线**——workflow 1.5.1 起 `tsxtb` 失败时自动产出 `convergence_trace.csv`（普通 opt 用 GaussView 的 Results→Optimization，或 `geom(check,step=n)` 逐帧看受力）：

| 曲线形态 | 结论 | 对策方向 |
|---|---|---|
| 受力/几何**周期性往复** | 震荡（最常见） | 下表「稳 Hessian」「限步长」两族 |
| 单调下降但 **Max/RMS Force 或 Displacement 死活不达阈值** | 临界收敛 | `loose` 放宽阈值 / 续算 |
| 能量不降反升、位移发散 | 初猜在错误势面上 | 检查初猜/体系设定，不是调参问题 |

震荡时取**受力/能量最低的帧**续算（`geom(check,step=n)`）常比重头再优化快。

## 解法清单（按 164 原文归纳；G16 默认已含 `int=ultrafine`）

1. **积分精度**：`int=ultrafine`（G16 默认已是；IEFPCM 显式溶剂常自带帮助）。
2. **Hessian 质量（TS 优化最敏感，优先试）**：`calcfc` → **`calcall`**（每步精确 Hessian）或 **`recalc=N`**（每 N 步重算）——TS 搜索对初始/中途 Hessian 质量远比极小值优化敏感。
3. **GDIIS**：`gdiis`；震荡场景用 **`gdiis maxstep=N notrust`**（配合小步长）。
4. **收敛限**：`loose`（热化学精度不需要 tight 时）。
5. **步长控制**：`maxstep=N`（配合 3）。
6. **TS 特有**：
   - 初猜离真实 TS 太远/太近——看**结构变化量**（每步位移）即知；太远时改初猜比任何关键词都有效；
   - QST2 插值初猜不行就换 opt=TS 手工构造（sobereva/460）；
   - 收敛后核对虚频**振动方向**是否对应反应坐标（只数虚频个数不够）。

## tsxtb（GFN2-xTB external 层）特化

- **external 数值 Hessian 便宜**：g16 的 CalcFC 靠差分梯度（每步多次 xtb 秒级调用），`recalc`/`calcall` 类策略在 xtb 层代价完全可接受——震荡时优先。
- **初猜太差别硬搜**：r9 C3 范本——高能非经典鞍点（1,3-H 迁移）上 xtb 层 57 步不收敛，改**化学四中心环状初猜直接 DFT ts 一步收敛**。xtb 层的价值是「好初猜的快速精修」，不是硬搜器。
- **临界收敛形态**（NStep 耗尽但 ΔE~1e-7）：看 trace 判定后可 `loose`/取末帧续算，不必重猜初猜。
- 消费纪律：诊断数据以 `convergence_trace.csv` 为准（workflow 产物），不要去通读 raw log。

## 禁止事项

- 盲目加大 `MaxCycle`（震荡场景几乎无效）。
- 原样重提（同输入必复现同失败）。
