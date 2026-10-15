# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/compaction-20261015/smoke2

- 轮次：2026-10-15T07:03:20.312Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**0/1**｜token：in 1592 / out 2

| task | pass | steps | turns | tok in/out | comp | wall(s) | 工具面 |
|---|---|---|---|---|---|---|---|
| long-composite | ❌ | 1 | 1 | 1592/2 | — | 4 | — |

## 失败明细

### long-composite
- 进程 exit=1
- finalMustMatch 未命中: /GOLDEN-7F3K/
- finalMustMatch 未命中: /20/
- finalMustMatch 未命中: /COMPLETED/
- finalMustMatch 未命中: /900001/
- finalMustMatch 未命中: /900002/
- finalMustMatch 未命中: /(?:退出码|exit\s*code)[^\n]{0,30}?\b0\b|0:0/i
- toolsAnyOf 全组未出现: [mat_partitions]（实调: 无）
- toolsAnyOf 全组未出现: [mat_job_watch]（实调: 无）
