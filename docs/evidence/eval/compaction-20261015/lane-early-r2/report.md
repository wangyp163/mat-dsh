# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/lane-early-r2

- 轮次：2026-10-15T08:16:02.008Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**0/2**｜token：in 120973 / out 7197

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-composite | ❌ | 10 | 1 | 61369/2766 | 7sum+2prune/30.8k | 394 | mat_partitions×2, todo_write×1, write×2, mat_env_gate×1, mat_exec×3, mat_upload×2, mat_sbatch×2, mat_job_watch×1, job_output×1 |
| long-gaussian-pair | ❌ | 9 | 1 | 59604/4431 | 9sum+1prune/37.4k | 469 | skill×1, mat_env_gate×1, todo_write×7, mat_gaussian×4, job_output×2 |

## Compaction 取证明细

### long-composite（7 次摘要压缩 + 2 次剪枝，合计遮蔽 30809 token）
- #1 [prune]：遮蔽 1 条 surface（seq 138-138，~2121 tok）
- #2 [summary]：遮蔽 3 条 surface（seq 7-9，~4301 tok）｜摘要模型 deepseek-v4-pro
- #3 [summary]：遮蔽 6 条 surface（seq 320-316，~4347 tok）｜摘要模型 deepseek-v4-pro
- #4 [summary]：遮蔽 2 条 surface（seq 533-325，~4561 tok）｜摘要模型 deepseek-v4-pro
- #5 [summary]：遮蔽 15 条 surface（seq 913-909，~3803 tok）｜摘要模型 deepseek-v4-pro
- #6 [summary]：遮蔽 1 条 surface（seq 977-977，~596 tok）｜摘要模型 deepseek-v4-pro
- #7 [prune]：遮蔽 1 条 surface（seq 1043-1043，~2121 tok）
- #8 [summary]：遮蔽 5 条 surface（seq 981-973，~4813 tok）｜摘要模型 deepseek-v4-pro
- #9 [summary]：遮蔽 6 条 surface（seq 1050-1055，~4146 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：6.7k → 3.8k → 9.8k → 6.8k → 0.9k → 1.2k → 7.9k → 7.6k → 9.7k → 6.9k

### long-gaussian-pair（9 次摘要压缩 + 1 次剪枝，合计遮蔽 37431 token）
- #1 [prune]：遮蔽 1 条 surface（seq 165-165，~7737 tok）
- #2 [summary]：遮蔽 3 条 surface（seq 7-9，~4318 tok）｜摘要模型 deepseek-v4-pro
- #3 [summary]：遮蔽 5 条 surface（seq 173-167，~4056 tok）｜摘要模型 deepseek-v4-pro
- #4 [summary]：遮蔽 1 条 surface（seq 389-389，~595 tok）｜摘要模型 deepseek-v4-pro
- #5 [summary]：遮蔽 6 条 surface（seq 393-396，~5274 tok）｜摘要模型 deepseek-v4-pro
- #6 [summary]：遮蔽 10 条 surface（seq 1212-1217，~4380 tok）｜摘要模型 deepseek-v4-pro
- #7 [summary]：遮蔽 1 条 surface（seq 1525-1525，~847 tok）｜摘要模型 deepseek-v4-pro
- #8 [summary]：遮蔽 2 条 surface（seq 1693-1218，~4934 tok）｜摘要模型 deepseek-v4-pro
- #9 [summary]：遮蔽 1 条 surface（seq 1850-1850，~904 tok）｜摘要模型 deepseek-v4-pro
- #10 [summary]：遮蔽 12 条 surface（seq 1854-1846，~4386 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：6.7k → 9.0k → 8.2k → 1.9k → 8.9k → 7.3k → 8.1k → 9.5k

## 失败明细

### long-composite
- finalMustMatch 未命中: /GOLDEN-7F3K/
- finalMustMatch 未命中: /(?:退出码|exit\s*code)[^\n]{0,30}?\b0\b|0:0/i

### long-gaussian-pair
- 任务超时被杀
