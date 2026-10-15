# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/sandbox-20261015/lane-off

- 轮次：2026-10-15T06:29:50.119Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**6/6**｜token：in 110060 / out 9314

| task | pass | steps | turns | tok in/out | wall(s) | 工具面 |
|---|---|---|---|---|---|---|
| partitions-lookup | ✅ | 2 | 1 | 50518/587 | 15 | mat_partitions×1 |
| sleep-watch | ✅ | 6 | 1 | 11092/1280 | 60 | mat_env_gate×1, mat_partitions×1, mat_exec×1, mat_sbatch×2, mat_job_watch×1, job_output×1 |
| gaussian-onestop | ✅ | 5 | 1 | 10085/1659 | 62 | mat_env_gate×1, mat_gaussian×2, job_output×1 |
| gaussian-fail-diagnosis | ✅ | 5 | 1 | 10948/2219 | 75 | mat_env_gate×1, mat_gaussian×2, job_output×1 |
| cancel-job | ✅ | 20 | 1 | 20035/3216 | 127 | mat_partitions×1, bash×1, write×1, mat_upload×2, mat_exec×10, mat_env_gate×1, mat_sbatch×1, mat_cancel×1, mat_job_status×1 |
| local-bash | ✅ | 2 | 1 | 7382/353 | 13 | bash×1 |
