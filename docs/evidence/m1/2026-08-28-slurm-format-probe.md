# M1 Step0 实弹探测：squeue/sacct 批量查询格式钉死（2026-08-28，cluster 11250）

方法：tsx 探针直连 `MatClient`（不烧模型 token），env 来自 `env.local`。
脚本：`/tmp/probe-slurm.mts`、`/tmp/probe-slurm2.mts`（临时件，不入库；本文留存原始输出）。

## 结论（写进 job-state.ts 解析器的依据）

1. **watch 每 tick 只用一条 sacct**：`sacct -j <id1>,<id2>,... -P -n -o JobID,State,ExitCode,ElapsedRaw`
   ——sacct 对 PENDING/RUNNING/终态**全部实时可见**（见下），而 squeue 对 RUNNING 作业曾返回空输出（不可靠），
   且 squeue 查不到的 id 会报错（见 2）。混查不存在的 id：sacct 静默丢弃（code 0 只回存在的行）。
2. **squeue 全部 id 不存在时**：`code 10020`，`stderr: "slurm_load_jobs error: Invalid job id specified"`，
   `exitCode 1`——这是"全部离队"信号，不是传输故障（既然设计改用 sacct，此语义仅作参考）。
3. **子行必须过滤**：sacct 对每个作业输出 3 行——`<id>`、`<id>.batch`、`<id>.extern`，只取主 id 行。
4. **ExitCode 格式 `0:0`**（exit:signal），取冒号前数字。
5. **ElapsedRaw 直接是秒**（`26`），不用解析 `HH:MM:SS`（Elapsed 仍保留在输出里做人读）。
6. **状态串实测**：`PENDING`、`RUNNING`、`COMPLETED`、`CANCELLED by 31561`（取消带 uid 后缀）。
   FAILED/TIMEOUT/NODE_FAIL/OUT_OF_MEMORY 未实采，按 Slurm 标准串解析。
7. **Agent0 分区 20 台 idle，sbatch 秒级起跑**——M1 e2e 用 Agent0；kshctest 深队列（283 alloc）
   会把探测作业挂起（probe1 的 40s 作业 PENDING >90s 未跑，已 scancel 清理）。
8. **execCommand 单次往返约 10s**（提交后本地 sleep 5s，sacct 已见 elapsed 15s）——
   watch 轮询间隔下限 10s 合理（每次 tick 本身就耗 ~10s）。

## 原始输出（节选自两轮探针，rc 内嵌）

### sinfo（选分区用）

```
$ sinfo -o '%P %a %l %D %t %N'
code=0
kshctest up 3-00:00:00 ... 283 alloc ...（深队列）
kshdtest up 3-00:00:00 ... 69 alloc ... 2 idle
kshdAI up 2:00:00 ... 35 alloc ...
kshdsctest up 3-00:00:00 ... 23 alloc ...
Agent0 up 1-00:00:00 20 idle i03r4n[00-19]
```

### sbatch（Agent0）

```
$ sbatch -p Agent0 --wrap='sleep 25' -J mat-watch-probe2
{"code":0,"data":"Submitted batch job 120269511","message":"success"}
```

### sacct RUNNING（含子行）

```
$ sacct -j 120269511 -P -n -o JobID,State,ExitCode,Elapsed,ElapsedRaw
{"code":0,"data":"120269511|RUNNING|0:0|00:00:15|15\n120269511.batch|RUNNING|0:0|00:00:15|15\n120269511.extern|RUNNING|0:0|00:00:15|15","message":"success"}
```

### squeue 对该 RUNNING 作业返回空（不可靠佐证）

```
$ squeue -j 120269511 -h -o '%i|%T|%M'
{"code":0,"data":"","message":"success"}
```

### sacct COMPLETED 终态 + 混查不存在 id

```
$ sacct -j 120269511,999999998 -P -n -o JobID,State,ExitCode,Elapsed,ElapsedRaw
{"code":0,"data":"120269511|COMPLETED|0:0|00:00:26|26\n120269511.batch|COMPLETED|0:0|00:00:26|26\n120269511.extern|COMPLETED|0:0|00:00:26|26","message":"success"}
```

### sacct PENDING（刚提交即可见）

```
$ sacct -j 120268907 -P -n -o JobID,State,ExitCode,Elapsed,ElapsedRaw
{"code":0,"data":"120268907|PENDING|0:0|00:00:00|0","message":"success"}
```

### sacct CANCELLED（scancel 后）

```
$ scancel 120268907
{"code":0,"data":"","message":"success"}
$ sacct -j 120268907 -P -n -o JobID,State,ExitCode,Elapsed,ElapsedRaw
{"code":0,"data":"120268907|CANCELLED by 31561|0:0|00:00:00|0","message":"success"}
```

### squeue 全部 id 不存在（语义参考）

```
$ squeue -j 999999998 -h -o '%i|%T|%M'
{"code":10020,"data":{"stdout":"","stderr":"slurm_load_jobs error: Invalid job id specified","exitCode":1,"truncated":false},"message":"remote shell command failed"}
```

### squeue 混查（真实 PENDING + 不存在）

```
$ squeue -j 120268907,999999998 -h -o '%i|%T|%M'
{"code":0,"data":"120268907|PENDING|0:00","message":"success"}
```
