# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/lane-fat-r1

- 轮次：2026-10-15T08:23:55.424Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**1/2**｜token：in 52117 / out 4784

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-composite | ❌ | 10 | 1 | 29688/2415 | 2sum+2prune/9.2k | 281 | mat_partitions×2, mat_env_gate×1, write×2, mat_upload×2, mat_exec×3, mat_sbatch×2, mat_job_watch×1, job_output×1 |
| long-gaussian-pair | ✅ | 5 | 1 | 22429/2369 | 1sum+1prune/11.9k | 176 | skill×1, mat_env_gate×1, mat_gaussian×4, job_output×2 |

## Compaction 取证明细

### long-composite（2 次摘要压缩 + 2 次剪枝，合计遮蔽 9189 token）
- #1 [prune]：遮蔽 1 条 surface（seq 192-192，~2121 tok）
- #2 [prune]：遮蔽 1 条 surface（seq 889-889，~2121 tok）
- #3 [summary]：遮蔽 3 条 surface（seq 7-9，~4301 tok）｜摘要模型 deepseek-v4-pro
- #4 [summary]：遮蔽 1 条 surface（seq 895-895，~646 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：6.7k → 2.5k → 1.0k → 0.3k → 0.5k → 4.0k → 1.1k → 0.3k → 0.5k → 12.7k

### long-gaussian-pair（1 次摘要压缩 + 1 次剪枝，合计遮蔽 11925 token）
- #1 [prune]：遮蔽 1 条 surface（seq 119-119，~7737 tok）
- #2 [summary]：遮蔽 2 条 surface（seq 7-8，~4188 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：6.7k → 2.0k → 2.1k → 1.0k → 10.6k

## 失败明细

### long-composite
- finalMustMatch 未命中: /(?:退出码|exit\s*code)[^\n]{0,30}?\b0\b|0:0/i
