# Task 0c-2：V1 校准点（H2O opt+freq 单体系直通）

session-87aef794-0808-49e2-9ab1-f262c3bb126c（workspace ~/workspace/batch-subagent，
skill-filesystem 修复后；skill gaussian-calc 0.7.32-demo + workflow 1.7.3）。

- prompt（同 a4 形态）：`对水分子做"先优化再频率分析"的计算，B3LYP/6-31G(d)，目录 ~/workspace/batch-subagent/v1-h2o/，完成后汇报最优构型能量和虚频数。`
- 轨迹：skill(gaussian-calc) → mat_exec(门禁) → mat_gaussian(一站式提交) →
  job_output(阻塞等待) → 汇报。**5 步 1 轮直通**，无挣扎、无越界工具。
- Slurm：job 122189533 @11250，COMPLETED exit 0，elapsed 18s，
  workdir `$HOME/workspace/batch-subagent/v1-h2o/opt+freq`。
- 结果：E = −76.4089539325 Ha（与 2026-09-01 压测 a1/a4 的 −76.4089539792 前 7 位
  一致），converged，**0 虚频**，三实频 1713.5/3727.3/3848.9 cm⁻¹，ZPE 0.021163 Ha。
  agent 主动报告了产物清单并提议按需下载——未自动拉大文件，符合 artifact 纪律。

## token 剖面（usage 事件）

| 指标 | V1 校准（本次） | a4 基线（09-01） |
|---|---|---|
| LLM 调用 | 5 | 14 |
| sum_output | 1810 | 6778 |
| 最终上下文（input+cacheRead） | ≈30.7k | ≈27.6k |
| 墙钟 | ≈6 min（含队列等待） | 211s |

注：本次 5 次调用（fewer steps，直通形态）而最终上下文与 a4 同量级——
单体系直通的主上下文主要被 skill 全文+门禁 JSON+一站式输入占据，
这是 Phase B fan-out 想压缩的基线构成。

## 第一次尝试的废案（保留作证据）

session-b16b0dca：skill-filesystem disabled 破损的受害者——`skill gaussian-calc`
报 unknown 后 agent 乱翻本机文件系统找 skill 目录。该会话被放弃，根因与修复见
phase-a README「环境破损发现与修复」。
