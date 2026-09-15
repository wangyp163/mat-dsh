# HPC 服务端问题反馈稿（待提交）

日期：2026-09-04 · 状态：草稿，证据齐备，待通过支持渠道提交

> 提交时可附本目录 `2026-09-04-exec-channel-crosstalk-fix.md` 与对应 session 日志片段。

## 问题 1（严重）：并发 remote_shell_execute 响应路由错乱

**环境**：MCP 网关 `https://mcp-gateway.example.internal/api/gw`，remote-shell 工具 `remote_shell_execute`，
集群 11250（华东一区【昆山】），时间 2026-09-04 15:19 前后，三个并发会话（各自独立
MCP session id）。

**现象**：同一密钥对同一集群的并发命令，响应内容串台——五例实锤：

| # | 调用 | 收到的响应 |
|---|---|---|
| 1 | `cd …/dh/ethanol/qst2-irc/qst2+irc/01-qst2 && sbatch slurm.sh` | 另一会话 `find -printf` 的目录列表（molecule.xyz 309 …） |
| 2 | `stat -c %s -- <file>`（下载前置） | 同上同一份列表（同字节数同时间戳），stat 解析失败 |
| 3 | `gaussian-workflow -t qst2+irc -p post …`（甲醇） | 另一目录 `find` 列表（job.out/job.log/…） |
| 4 | `grep … job.log`（乙烷） | stderr 混入第三会话 `find: '…/ts-irc/F_H2_TS_IRC_v2/irc/irc': No such file or directory` |
| 5 | squeue/sacct 查询 | 输出污染（会话内自述异常） |

**定性**：服务端疑似按 (API 密钥, 集群) 维度复用登录节点 shell 会话，MCP session id
未参与路由；并发请求读到彼此的输出。客户端无法从响应本身分辨归属（本次事故靠输出
内容特征定位）。

**请求**：确认 remote-shell 执行通道的并发路由隔离粒度；若为已知限制，请明确并发
使用约束（如每密钥每集群串行）。客户端已按"同 (密钥, 集群) 串行 + 输出标记校验"
自防（mat-harness 仓 mat-core exec-gate/exec-guard），不影响复现排查。

## 问题 2（中）：登录节点 Slurm 工具链瞬态故障

时间约 15:19 同窗口：`scontrol` exit 127（`libreadline.so.6` 缺失）、`sinfo`/`sbatch`
一度不可寻，三次重试自愈。同窗口三个 Slurm 作业提交后 ≤5s FAILED（120898895/
120898914/120898931，均重提成功）。疑似登录节点环境/模块瞬态漂移，建议核查该时段
登录节点运维记录。
