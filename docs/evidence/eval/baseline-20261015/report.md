# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/baseline-20261015

- 轮次：2026-10-15T04:16:20.538Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**5/5**｜token：in 91699 / out 8755

| task | pass | steps | turns | tok in/out | wall(s) | 工具面 |
|---|---|---|---|---|---|---|
| partitions-lookup | ✅ | 2 | 1 | 25921/675 | 18 | mat_partitions×1 |
| sleep-watch | ✅ | 13 | 1 | 18459/2711 | 104 | mat_partitions×1, mat_env_gate×1, mat_exec×6, write×2, mat_upload×2, mat_sbatch×2, mat_job_watch×1, job_output×1 |
| gaussian-onestop | ✅ | 5 | 1 | 10614/1600 | 59 | mat_env_gate×1, mat_gaussian×2, job_output×1 |
| gaussian-fail-diagnosis | ✅ | 5 | 1 | 25763/2788 | 89 | skill×1, mat_env_gate×1, mat_gaussian×2, job_output×1 |
| cancel-job | ✅ | 6 | 1 | 10942/981 | 32 | mat_env_gate×1, mat_partitions×1, mat_exec×1, mat_sbatch×1, mat_cancel×1, mat_job_status×1 |
