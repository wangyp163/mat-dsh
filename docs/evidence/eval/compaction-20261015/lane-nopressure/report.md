# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/lane-nopressure

- 轮次：2026-10-15T07:51:45.392Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**1/2**｜token：in 48030 / out 4585

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-composite | ❌ | 8 | 1 | 26689/2252 | — | 90 | mat_env_gate×1, mat_partitions×2, mat_exec×2, mat_sbatch×2, mat_job_watch×1, job_output×1 |
| long-gaussian-pair | ✅ | 6 | 1 | 21341/2333 | — | 80 | skill×1, mat_env_gate×1, mat_gaussian×3, job_output×2 |

## 失败明细

### long-composite
- finalMustMatch 未命中: /(?:退出码|exit\s*code)[^\n]{0,30}?\b0\b|0:0/i
