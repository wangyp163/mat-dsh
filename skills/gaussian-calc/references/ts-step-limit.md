---
id: ts-step-limit
signature: "Optimization stopped\\.|Number of steps exceeded|Error termination request processed by link 9999"
task: [tsxtb, ts, opt, irc]
versions: [">=1.5.0"]
source: 压测 r9（集群 121236068 NStep=57 / tsxtb-quad NStep=54 / H3 smoke NStep=20）/ sobereva.com/164
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

**先诊断后动手：读 `convergence_trace.csv`（或 GaussView 优化曲线）区分三类**——震荡 / 单调逼近未达阈值 / 发散。诊断法与解法全表见 [`methods/ts-convergence.md`](../methods/ts-convergence.md)。

## 禁止事项

- **不要原样重提**（同输入必复现）。
- **不要只加 MaxCycle**（164 明言：震荡时加步数几乎无效，只烧机时）。
