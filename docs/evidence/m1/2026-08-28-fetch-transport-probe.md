# M1 FetchTransport 实弹探针 + headless e2e ×2（2026-08-28）

## 1. FetchTransport 实弹（MAT_TRANSPORT=fetch）

探针 `/tmp/probe-fetch.mts`（MatClient 直连，走 `packages/mat-core/src/index.ts`）：

```bash
$ set -a; source env.local; set +a
$ MAT_TRANSPORT=fetch tsx /tmp/probe-fetch.mts
MAT_TRANSPORT=fetch elapsed=2076ms
{
  "code": 0,
  "data": "120269511|COMPLETED|0:0|26\n",
  "message": "success"
}
```

对照：同命令 curl 传输（M0 实证路径）往返约 10s（子进程 curl + 三层退避逻辑更重）。
结论：**fetch 走 mcp-gateway.example.internal → 11250 真链路可用且显著更快**；作为 opt-in
（`MAT_TRANSPORT=fetch` 或 `transportKind: 'fetch'`），默认仍 curl。

## 2. headless e2e ×2（2×sleep30 on Agent0，任务原文）

> 在 11250 集群的 Agent0 分区提交 2 个 sleep 30 的作业，然后用 mat_job_watch 工具
> 把两个作业一次性注册异步监控，等它们全部完成后把每个作业的最终状态表原样告诉我

命令模板（host repo 根目录）：

```bash
DSH_HOME=/tmp/mat-dsh-m0-home timeout 300 pnpm dsh --profile headless \
  --patch ~/mat-harness/mat-dsh/profiles/mat.yml '<任务>'
# ② 加 export MAT_TRANSPORT=fetch
```

### ① curl 默认传输（session-5f4df49d，exit=0，14:0x）

```text
CALL mat_exec      sinfo -p Agent0                     -> 20 idle
CALL mat_exec      sbatch -p Agent0 --wrap "sleep 30"  -> 120272033
CALL mat_exec      sbatch -p Agent0 --wrap "sleep 30"  -> 120272116
CALL mat_job_watch {"cluster_id":"11250","job_ids":["120272033","120272116"]}
                     -> watching 2 Slurm job(s) ... background job mat-watch-1 registered
CALL job_output      {"job_id":"mat-watch-1","wait":true,"timeout_ms":120000}
  RES: 120272033 UNKNOWN (not observed)
       120272116 UNKNOWN (not observed)
       120272033 COMPLETED exit=0 elapsed=32s
       120272116 COMPLETED exit=0 elapsed=31s
       2/2 settled (2 COMPLETED)
       [status: completed...]
CALL job_output      {"job_id":"mat-watch-1"}          -> (no new output) [status: completed]
```

### ② MAT_TRANSPORT=fetch（session-53c395a1，exit=0）

```text
CALL mat_exec      sinfo -p Agent0                     -> 20 idle
CALL mat_exec      sbatch --partition=Agent0 --wrap="sleep 30" -> 120272702
CALL mat_exec      sbatch --partition=Agent0 --wrap="sleep 30" -> 120272720
CALL mat_job_watch {"cluster_id":"11250","job_ids":["120272702","120272720"]}
                     -> background job mat-watch-1 registered
CALL job_output      {"job_id":"mat-watch-1","wait":true,"timeout_ms":120000}
  RES: 120272702 UNKNOWN (not observed)
       120272720 UNKNOWN (not observed)
       120272702 RUNNING exit=0 elapsed=18s        <- fetch 链路下中间增量可见
       120272720 RUNNING exit=0 elapsed=7s
       120272702 RUNNING exit=0 elapsed=29s
       120272720 RUNNING exit=0 elapsed=18s
       120272702 COMPLETED exit=0 elapsed=32s
       ... 2/2 settled (2 COMPLETED) [status: completed]
CALL job_output      {"job_id":"mat-watch-1"}          -> (no new output)
```

## 3. 判定（对照验证成功标准）

| 标准 | 结果 |
|---|---|
| 监控段模型往返 ≤3 | ✅ 恰好 3：watch 注册 1 + job_output(wait) 1 + 对账 1 |
| 零手动 squeue/sacct 轮询 | ✅ 轨迹中无任何 LLM 发起的 squeue/sacct |
| 终态表正确 | ✅ `2/2 settled (2 COMPLETED)`，逐作业 `exit=0 elapsed` |
| 增量 readOutput 语义 | ✅ UNKNOWN → RUNNING(增量) → COMPLETED → 汇总+全表 |
| 双传输（curl/fetch） | ✅ 两轮均 exit=0 |
| 宿主仓零写入 | ✅ `git -C deepseek-harness status --short` 空 |

成本对比（估算）：同步轮询路径一个 30s 作业约需 6-10 轮 squeue/sacct 模型往返
（每轮含系统提示+历史重放）；异步路径固定 3 次往返且与作业时长、作业数无关
（批量 job_id 一条命令查全部）。
