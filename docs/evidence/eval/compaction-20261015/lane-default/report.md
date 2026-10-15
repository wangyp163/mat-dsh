# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/lane-default

- 轮次：2026-10-15T07:48:44.764Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**2/2**｜token：in 59683 / out 5906

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-composite | ✅ | 16 | 1 | 43486/3364 | 1sum+2prune/8.5k | 174 | mat_partitions×2, mat_exec×6, write×2, read×2, mat_upload×2, mat_env_gate×1, mat_sbatch×2, mat_job_watch×1, job_output×1 |
| long-gaussian-pair | ✅ | 9 | 1 | 16197/2542 | 0sum+1prune/7.7k | 116 | skill×1, mat_env_gate×1, mat_gaussian×4, job_output×2 |

## Compaction 取证明细

### long-composite（1 次摘要压缩 + 2 次剪枝，合计遮蔽 8543 token）
- #1 [prune]：遮蔽 1 条 surface（seq 143-143，~2121 tok）
- #2 [prune]：遮蔽 1 条 surface（seq 1241-1241，~2121 tok）
- #3 [summary]：遮蔽 3 条 surface（seq 7-9，~4301 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：6.7k → 3.8k → 1.1k → 0.4k → 0.5k → 1.0k → 1.5k → 0.8k → 6.2k → 1.1k → 0.2k → 0.3k → 0.7k → 1.0k → 1.2k → 17.0k

### long-gaussian-pair（0 次摘要压缩 + 1 次剪枝，合计遮蔽 7737 token）
- #1 [prune]：遮蔽 1 条 surface（seq 124-124，~7737 tok）
- 步级请求输入轨迹：6.7k → 3.2k → 0.4k → 1.2k → 0.6k → 1.1k → 0.4k → 1.0k → 1.5k
