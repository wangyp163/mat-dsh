# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/lane-fat-r2

- 轮次：2026-10-15T08:31:59.445Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**1/2**｜token：in 36821 / out 4138

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-composite | ❌ | 10 | 1 | 29378/1960 | 1sum+2prune/8.4k | 321 | mat_partitions×2, mat_exec×2, mat_sbatch×4, mat_env_gate×1, mat_job_watch×1, job_output×1 |
| long-gaussian-pair | ✅ | 5 | 1 | 7443/2178 | 0sum+1prune/7.7k | 155 | skill×1, mat_env_gate×1, mat_gaussian×4, job_output×2 |

## Compaction 取证明细

### long-composite（1 次摘要压缩 + 2 次剪枝，合计遮蔽 8413 token）
- #1 [prune]：遮蔽 1 条 surface（seq 110-110，~2121 tok）
- #2 [prune]：遮蔽 1 条 surface（seq 693-693，~2121 tok）
- #3 [summary]：遮蔽 2 条 surface（seq 7-8，~4171 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：6.7k → 2.3k → 0.5k → 0.8k → 1.1k → 0.3k → 0.5k → 3.9k → 1.0k → 12.2k

### long-gaussian-pair（0 次摘要压缩 + 1 次剪枝，合计遮蔽 7737 token）
- #1 [prune]：遮蔽 1 条 surface（seq 163-163，~7737 tok）
- 步级请求输入轨迹：1.6k → 2.1k → 1.1k → 0.8k → 1.8k

## 失败明细

### long-composite
- finalMustMatch 未命中: /(?:退出码|exit\s*code)[^\n]{0,30}?\b0\b|0:0/i
