# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/smoke

- 轮次：2026-10-15T03:32:19.181Z｜泳道：replay｜模型：mat/deepseek-v4-flash
- 通过：**0/1**｜token：in 0 / out 0

| task | pass | steps | turns | tok in/out | wall(s) | 工具面 |
|---|---|---|---|---|---|---|
| partitions-lookup | ❌ | 1 | 1 | 0/0 | 48 | — |

## 失败明细

### partitions-lookup
- 进程 exit=1
- 会话报错: 503: {"message":"ServiceUnavailableError: ServiceUnavailableError: OpenAIException - The request could not be completed. Contact support with the call ID.","typ
- 无最终 assistant 答复
- finalMustMatch 未命中: /Agent0/
- finalMustMatch 未命中: /20/
- toolsAnyOf 全组未出现: [mat_partitions]（实调: 无）
