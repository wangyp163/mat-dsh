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
| `sbatch-ok.envelope.json` | format-probe §"sbatch（Agent0）" MCP 业务信封（code/data/message）逐字转录 |
| `squeue-empty.envelope.json` | format-probe §"squeue 对该 RUNNING 作业返回空"（本集群 squeue 对 RUNNING 常空 → sacct 兜底的实证依据） |
| `squeue-invalid-10020.envelope.json` | format-probe §"squeue 全部 id 不存在"（code 10020 + slurm_load_jobs error） |
| `sinfo-5col.txt` | **synthetic**：行数据来自 format-probe §"sinfo" 的真实 `%P %a %l %D %t %N` 宽格式输出（kshctest 283 alloc / kshdtest 69 alloc+2 idle / kshdAI 35 / kshdsctest 23 / Agent0 20 idle），转置为本工具 5 列管道格式；`Agent0*` 的 `*` 保留用于剥离断言。**待 Step 7 实弹录制 `sinfo -o '%P|%a|%l|%D|%t'` 原始输出回填** |

### 录制格式说明（5 列 → 生产 4 列）

探测脚本 sacct 请求了 `JobID,State,ExitCode,Elapsed,ElapsedRaw`（多一列人读 Elapsed）；
生产 watch 命令只请求 `JobID,State,ExitCode,ElapsedRaw`。回放测试中 `toProductionSacct()`
机械裁掉第 4 列（Elapsed）喂给解析器；列语义与录制出处一一对应，不虚构数据。
`sacct-completed-4col.txt` 是无需裁剪的生产格式真实输出。

## efile/（synthetic，2026-08-28）

凭证（MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER）尚未到位，无法实弹录制；
结构按 plugin.py `_get_tokens`(§199-237)/`upload_file`(§591)/`download_file`(§623)
的响应处理逻辑构造（字段名 code/msg/data、clusterId/token/hpcUrls/efileUrls、data.path）。
token 值为占位（synthetic-token-*）。**凭证到位实弹后回填真实响应**（去敏保留结构）。

| fixture | 结构依据 |
|---|---|
| `token-ok.json` | token 接口 `code==='0'` → `data[]`（含 11250 有 efile / 11100 无 efile 两分支） |
| `upload-ok.json` | upload `code==='0'` → `data.path` |
| `upload-error.json` | upload `code!=='0'` → msg |
| `download-error.json` | download JSON 错误体（Content-Type application/json 分支） |

## gaussian/ 与 exec/（待 Step 7 回填）

- `gaussian/`：pre_ok / MISSING / run_ok / post_ok（含 properties 行）——首次 mat_gaussian
  实弹时录制原始 stdout 回填。
- `exec/`：MCP SSE 报文（initialize / tools/call ok / code 10020）——tsx 探针录制
  （M0 task12 只留存了 initialize 截断行，不足以作 verbatim fixture）。

回填后在本文件补表，并在对应回放测试解除 skip / 替换 synthetic 断言。
