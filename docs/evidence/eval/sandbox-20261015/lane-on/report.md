# Golden Eval Report — ~/mat-harness/mat-dsh/docs/evidence/eval/sandbox-20261015/lane-on

- 轮次：2026-10-15T06:38:43.217Z｜泳道：replay｜模型：mat/deepseek-v4-pro
- 通过：**6/6**｜token：in 87198 / out 13041
- 基线对比（~/mat-harness/mat-dsh/docs/evidence/eval/sandbox-20261015/lane-off/metrics.json）：通过 100% → 100%｜token in 110060 → 87198（-22862）

| task | pass | steps | turns | tok in/out | wall(s) | 工具面 |
|---|---|---|---|---|---|---|
| partitions-lookup | ✅ | 2 | 1 | 7495/641 | 17 | mat_partitions×1 |
| sleep-watch | ✅ | 7 | 1 | 19087/1345 | 62 | mat_env_gate×1, mat_partitions×1, mat_exec×2, mat_sbatch×2, mat_job_watch×1, job_output×1 |
| gaussian-onestop | ✅ | 5 | 1 | 6644/1229 | 57 | mat_env_gate×1, mat_gaussian×2, job_output×1 |
| gaussian-fail-diagnosis | ✅ | 40 | 1 | 43984/8584 | 315 | mat_env_gate×1, mat_gaussian×2, job_output×2, mat_exec×31, mat_download×2, mat_job_status×1 |
| cancel-job | ✅ | 7 | 1 | 6663/976 | 43 | mat_env_gate×1, mat_partitions×1, mat_exec×1, mat_sbatch×1, mat_cancel×1, mat_job_status×1 |
| local-bash | ✅ | 2 | 1 | 3325/266 | 13 | bash×1 |
