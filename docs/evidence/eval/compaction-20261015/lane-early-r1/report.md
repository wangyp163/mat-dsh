# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/lane-early-r1

- 轮次：2026-10-15T08:01:21.406Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**2/2**｜token：in 72472 / out 4563

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-composite | ✅ | 10 | 1 | 38302/1918 | 5sum+2prune/18.6k | 307 | mat_partitions×2, mat_exec×2, mat_sbatch×4, mat_env_gate×1, mat_job_watch×1, job_output×1 |
| long-gaussian-pair | ✅ | 5 | 1 | 34170/2645 | 4sum+1prune/26k | 258 | skill×1, mat_env_gate×1, mat_gaussian×4, job_output×2 |

## Compaction 取证明细

### long-composite（5 次摘要压缩 + 2 次剪枝，合计遮蔽 18582 token）
- #1 [prune]：遮蔽 1 条 surface（seq 103-103，~2121 tok）
- #2 [summary]：遮蔽 3 条 surface（seq 7-9，~4301 tok）｜摘要模型 deepseek-v4-pro
- #3 [summary]：遮蔽 6 条 surface（seq 253-249，~4164 tok）｜摘要模型 deepseek-v4-pro
- #4 [summary]：遮蔽 1 条 surface（seq 413-413，~445 tok）｜摘要模型 deepseek-v4-pro
- #5 [prune]：遮蔽 1 条 surface（seq 642-642，~2121 tok）
- #6 [summary]：遮蔽 5 条 surface（seq 417-420，~4892 tok）｜摘要模型 deepseek-v4-pro
- #7 [summary]：遮蔽 1 条 surface（seq 648-648，~538 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：1.6k → 3.8k → 10.5k → 7.6k → 0.7k → 0.8k → 1.1k → 0.2k → 0.5k → 11.5k

### long-gaussian-pair（4 次摘要压缩 + 1 次剪枝，合计遮蔽 25952 token）
- #1 [prune]：遮蔽 1 条 surface（seq 167-167，~7737 tok）
- #2 [summary]：遮蔽 3 条 surface（seq 7-9，~4318 tok）｜摘要模型 deepseek-v4-pro
- #3 [summary]：遮蔽 5 条 surface（seq 175-169，~4608 tok）｜摘要模型 deepseek-v4-pro
- #4 [summary]：遮蔽 2 条 surface（seq 451-180，~4944 tok）｜摘要模型 deepseek-v4-pro
- #5 [summary]：遮蔽 9 条 surface（seq 772-766，~4345 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：1.6k → 9.2k → 7.5k → 8.4k → 7.5k
