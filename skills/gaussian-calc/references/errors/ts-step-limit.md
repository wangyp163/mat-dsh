---
id: ts-step-limit
signature: "Optimization stopped\\.|Number of steps exceeded|Error termination request processed by link 9999"
task: [tsxtb, ts, opt, irc]
versions: [">=1.5.0"]
source: 压测 r9（集群 121236068 NStep=57 / tsxtb-quad NStep=54 / H3 smoke NStep=20）/ sobereva.com/164
prescription: [{"match":"受力/几何周期性往复（震荡，最常见）","route":"稳 Hessian 族：recalc=N / calcall（TS 最敏感）或 gdiis maxstep=N notrust；加步数无效"},{"match":"单调下降但 force/displacement 不达阈值（临界收敛）","route":"MaxCycle 加预算 / loose 放宽 / 取受力最低帧续算——加步数唯一有效的场景"},{"match":"能量不降反升、位移发散（初猜在错误势面）","route":"换初猜（或 tsxtb 预优化），不是调参问题"},{"match":"log 无步数块、l103 起步即摔（内坐标崩塌）","route":"转条目 kb:ts-l103-formbx"}]
---

## 症状

- 作业 FAILED，log 尾为两句格言 + `Error termination request processed by link 9999`（无其他错误说明）。
- 往上找必有（external 与普通 opt 皆然）：

```text
 Optimization stopped.
    -- Number of steps exceeded,  NStep=  57
    -- Flag reset to prevent archiving.
```

- workflow 1.5.1 起 `tsxtb` post 会命中此签名：报「did not converge within the step limit (NStep=…)」并在 `{workdir}/tsxtb/` 落 `convergence_trace.csv`（每步 energy/max_force/rms_force/max_displacement/rms_displacement）。

## 根因

**优化不收敛、步数上限耗尽**（不是「收尾缺陷」）。`Flag reset to prevent archiving` 使 l9999 归档路径死在 external 模式下。绝大多数是**震荡**（受力/几何周期性往复）；少数是「临界收敛」（能量变化已极小但受力/位移阈值未达——H3 案例 NStep=20 耗尽时 ΔE=4.4e-7）。

## 处方

## 处方（决策表：读 convergence_trace.csv 趋势列定行）

| trace 形态（能量/受力/位移列） | 判定 | 处方 |
|---|---|---|
| 受力/几何周期性往复 | 震荡（最常见） | 「稳 Hessian」族：`recalc=N`/`calcall`（TS 最敏感）；`gdiis maxstep=N notrust`；**加步数无效** |
| 单调下降但 force/displacement 不达阈值 | 临界收敛 | `MaxCycle` 加预算 / `loose` 放宽 / 取受力最低帧续算——加步数唯一有效的场景 |
| 能量不降反升、位移发散 | 初猜在错误势面 | **换初猜**（或 tsxtb 预优化），不是调参问题 |
| log 无步数块、l103 起步即摔 | 内坐标崩塌 | 转条目 [`ts-l103-formbx`](ts-l103-formbx.md) |

诊断法与完整解法清单见 [`methods/ts-convergence.md`](../methods/ts-convergence.md)。

## 处置后回写

按「诊断-重试协议」（SKILL.md）在 `diag/att-{NNN}-ts-step-limit/conclusion.md` 回写：facts（trace 摘要一行）/ prescription（上表哪一行）/ diff（参数/初猜改动）/ 新 attempt 号。

## 禁止事项

- **不要原样重提**（同输入必复现）。
- **不要只加 MaxCycle**（164 明言：震荡时加步数几乎无效，只烧机时）。
