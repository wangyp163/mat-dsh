# 回放契约 fixtures 来源（PROVENANCE）

每条 fixture 记录来源：真实录制（verbatim，含集群/日期/出处）或 synthetic（结构来源 + 回填计划）。
回放测试只做语义断言；时间戳/session id 之类的归一化只出现在断言侧，fixture 文件本身不改写录制原文。

## slurm/（真实录制：cluster 11250，2026-08-28）

| fixture | 来源 |
|---|---|
| `sacct-running-with-sublines.txt` | `docs/evidence/m1/2026-08-28-slurm-format-probe.md` §"sacct RUNNING（含子行）"，job 120269511 逐字转录 |
| `sacct-completed-mixed-id.txt` | 同上 §"sacct COMPLETED 终态 + 混查不存在 id"（混查 999999998 被静默丢弃，仅回 120269511 主行+子行） |
| `sacct-pending.txt` | 同上 §"sacct PENDING"，job 120268907 |
| `sacct-cancelled-by-uid.txt` | 同上 §"sacct CANCELLED（scancel 后）"，`CANCELLED by 31561` 原样保留 uid 后缀 |
| `sacct-completed-4col.txt` | `docs/evidence/m1/2026-08-28-fetch-transport-probe.md` §1 —— 与生产命令完全同列集（`JobID,State,ExitCode,ElapsedRaw`）的真实输出 |
| `sacct-completed-workdir-5col.txt` | **真实录制**（2026-09-04，cluster 11250，smoke-exec 直查）：`sacct -j 120865157 -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir` 原始输出 —— 生产命令加 WorkDir 列的实证（主行绝对路径，`.batch`/`.extern` 子行 WorkDir 为空） |
| `sbatch-ok.envelope.json` | format-probe §"sbatch（Agent0）" MCP 业务信封（code/data/message）逐字转录 |
| `squeue-empty.envelope.json` | format-probe §"squeue 对该 RUNNING 作业返回空"（本集群 squeue 对 RUNNING 常空 → sacct 兜底的实证依据） |
| `squeue-invalid-10020.envelope.json` | format-probe §"squeue 全部 id 不存在"（code 10020 + slurm_load_jobs error） |
| `sinfo-5col.txt` | **真实录制**（M2 探针，2026-08-28，cluster 11250）：`sinfo -o '%P|%a|%l|%D|%t' | tail -n +2` 原始输出，16 行（同名分区多状态行：drain*/drng/mix/alloc/idle） |

### 录制格式说明（5 列 → 生产 4 列）

探测脚本 sacct 请求了 `JobID,State,ExitCode,Elapsed,ElapsedRaw`（多一列人读 Elapsed）；
生产 watch 命令只请求 `JobID,State,ExitCode,ElapsedRaw`。回放测试中 `toProductionSacct()`
机械裁掉第 4 列（Elapsed）喂给解析器；列语义与录制出处一一对应，不虚构数据。
`sacct-completed-4col.txt` 是无需裁剪的生产格式真实输出。

## efile/（synthetic，2026-08-28）

2026-08-28 脱敏探针确认 AK/SK 签名成功，但该账号对真实计算集群未获 OpenAPI token/efile
授权，无法录制成功传输；结构按 plugin.py `_get_tokens`(§199-237)、center discovery
(§240-262)、`upload_file`(§591)/`download_file`(§623) 构造（字段名 code/msg/data、
clusterId/token、center.data.efileUrls、data.path）。token 值为占位（synthetic-token-*）。
**账号获得 OpenAPI 文件权限后回填真实响应**（去敏保留结构）。

| fixture | 结构依据 |
|---|---|
| `token-ok.json` | token 接口 `code==='0'` → `data[]`（含 11250 有 efile / 11100 无 efile 两分支） |
| `upload-ok.json` | upload `code==='0'` → `data.path` |
| `upload-error.json` | upload `code!=='0'` → msg |
| `download-error.json` | download JSON 错误体（Content-Type application/json 分支） |

## gaussian/（真实录制：M2 探针，2026-08-28，cluster 11250，水 opt+freq B3LYP/6-31G(d)）

`scripts/probe-m2.ts`（MAT_TRANSPORT=fetch，MatClient 直连，零模型 token）录制，
workdir `/public/home/hpc-user-a/workspace/h2o-m2-probe`，slurm job 120283614（Agent0，elapsed 13s）。
基准值交叉验证（Python 时代实测）：E=-76.4089539792 vs -76.408954、
freqs=[1713.1206, 3727.1534, 3849.0866] vs [1713.13, 3727.17, 3849.10]、imag=0。

| fixture | 来源 |
|---|---|
| `pre-ok.stdout.txt` | `gaussian-workflow -t opt+freq -p pre` 原始 stdout（环境加载行 + 单行 calcflow.result.v1） |
| `run-ok.stdout.txt` | `-p run` 原始 stdout（slurm 块回显 Agent0/1/32/00:30:00/64GB） |
| `post-ok.stdout.txt` | `-p post` 原始 stdout（properties 含 energy/frequencies_cm-1/imaginary_frequency_count；files 绝对路径） |

## exec/（真实录制：M2 探针，2026-08-28）

MCP 业务信封（remote_shell_execute 返回的 code/data/message 原样；SSE 层解析由
curl.test.ts / fetch-transport.test.ts 单测覆盖，信封层即 ExecResult 契约）。

| fixture | 来源 |
|---|---|
| `sbatch-ok.envelope.json` | `cd /tmp && sbatch -p Agent0 --wrap='sleep 30' -J m2-probe` → job 120283480 |
| `squeue-pending.envelope.json` | `squeue -j 120283480 -h -o '%T'` → PENDING（本集群 squeue 对 PENDING 可见、RUNNING 常空的补充实证） |

探针顺带实证：scancel 后 queryJobStatus 返回 `COMPLETING`（sacct 过渡态，squeue 不可见）——
单作业查询工具原样透传该串，归一判定只用于批量 watch。
