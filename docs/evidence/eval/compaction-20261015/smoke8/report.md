# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/smoke8

- 轮次：2026-10-15T07:43:02.514Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**1/1**｜token：in 53822 / out 2223

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-gaussian-pair | ✅ | 5 | 1 | 53822/2223 | 4sum+1prune/21.7k | 203 | skill×1, mat_env_gate×1, mat_gaussian×4, job_output×2 |

## Compaction 取证明细

### long-gaussian-pair（4 次摘要压缩 + 1 次剪枝，合计遮蔽 21678 token）
- #1 [prune]：遮蔽 1 条 surface（seq 112-112，~7737 tok）
- #2 [summary]：遮蔽 3 条 surface（seq 7-9，~4318 tok）｜摘要模型 deepseek-v4-pro
- #3 [summary]：遮蔽 1 条 surface（seq 120-120，~641 tok）｜摘要模型 deepseek-v4-pro
- #4 [summary]：遮蔽 5 条 surface（seq 124-114，~4232 tok）｜摘要模型 deepseek-v4-pro
- #5 [summary]：遮蔽 2 条 surface（seq 635-127，~4750 tok）｜摘要模型 deepseek-v4-pro
- 步级请求输入轨迹：25.2k → 9.8k → 1.8k → 8.0k → 9.0k
