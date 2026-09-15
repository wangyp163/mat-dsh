# 远端命令输出串扰修复（exec-gate + exec-guard）

日期：2026-09-04 · 归属：`packages/mat-core` · 状态：已修复，离线全量验证

## 事故（压测轮 15:19，三并发会话 S1/S2/S3）

HPC remote-shell 通道对同一 (mcpKey, clusterId) 的并发命令无输出路由隔离，五例实锤：

| # | 位置 | 现象 |
|---|---|---|
| 1 | S3 seq 62103 | 乙醇 `sbatch slurm.sh` → 返回 S1 目录的 stat/ls 文件列表，job id 丢失 |
| 2 | S1 seq 50395 | `mat_download` 的 `stat -c %s` 解析到同一份列表 → `remote-shell stat returned invalid size` |
| 3 | S2 seq 59243 | 甲醇 post → 返回另一目录 ls 列表（应输出 calcflow.result.v1 JSON） |
| 4 | S2 seq 59245 | 乙烷 grep 的 stderr 混入 S1 的 `find: … irc/irc: No such file or directory` |
| 5 | S3 seq 75780 | squeue/sacct 查询被污染（assistant 自述异常输出） |

定性：服务端按 (密钥, 集群) 复用 shell，与本侧 MCP 会话 id 无关——本侧「每个
MatClient 独立会话」的隔离在服务端无效。修复只能落在本仓（双层防护，见下）。

## 修复设计

1. **exec-gate（串行闸，防发生）** `src/exec-gate.ts`
   - 进程内 FIFO 链按 (mcpKey, clusterId) 串行——覆盖单例（mat_exec）、watch 专属、
     gaussian 同步段/producer 全部实例（模块级注册表）；
   - 跨进程文件锁（tmpdir `mat-exec-locks/`，`O_CREAT|O_EXCL` + mtime 保活/过期
     抢占），多 dsh 进程共用密钥时仍串行；任何文件系统异常/等待超时 fail-open，
     可用性优先。
2. **exec-guard（标记校验，防漏网）** `src/exec-guard.ts`
   - 每次调用随机 token，命令包裹为
     `printf '\nSCNXS:<token>\n'; <cmd>` + `__scnx_rc=$?` + `printf '\nSCNXE:<token> rc=%s' >&2` + `test … -eq 0`；
   - 逐语句独立成行，不破坏 heredoc（gaussian prepare）/尾注释/续行；
   - 结束标记走 stderr（成功信封只回 stdout，不占 1MiB 通道预算），rc 透传保精确值
     （`test` 会把非零压成 1）；
   - 响应缺本调用标记 → `RemoteShellCrosstalkError` → `execCommand` 既有 3 次重试
     换新标记重发——「静默拿错数据」变「可检测失败」，事故 #1–#4 全部会被拦截。
   - `MatClient.execCommand` 每次尝试独立过闸 + 独立 token，退避期间不占闸。

环境开关：`MAT_EXEC_GATE=off`（整闸旁路）、`MAT_EXEC_FILE_LOCK=off`（只留
进程内链）、`MAT_EXEC_LOCK_DIR`（自定义锁目录）。

## 验证

- 单元：`test/exec-gate.test.ts`（8）、`test/exec-guard.test.ts`（10）、
  `test/client.test.ts`（11，含事故回归：多实例并发串行、串扰重试换标记、
  持续串扰显式失败留证）；
- 全量：`pnpm vitest run` 57 文件 397 测试全绿；`pnpm typecheck` 通过；
- 跨进程：两个真实并发 tsx 进程各 20 段共享日志，文件锁下 40 段零交错；
- 包裹形状实弹：bash 下 heredoc/尾注释/失败命令（rc=127 精确保留）/无尾换行输出
  四例逐字节验证。

## 遗留与追偿（2026-09-04 当日闭环）

**数据层追偿（sacct 实查，cluster 11250，全部经修复后的 guarded client）**：

- **S3 乙醇 job id 已找回**：seq 62103 的 sbatch 实际提交成功——job **120898931**，
  4 秒后 FAILED（同窗口 dh/ 组三个会话的首次 qst2 提交 120898895/120898914/120898931
  全部 ≤5s 失败，与登录节点瞬态工具链故障时段吻合），会话随后重提的 120900192
  COMPLETED（00:02:23）。无失联作业残留。
- **S2 甲醇 post 无需重跑**：串扰只污染了响应，post 实际已执行——远端
  `dehyd/methanol/03-qst2irc/result.json`（15:30，status ok / execution completed /
  workflow completed）在案，且会话日志 seq 60075 显示模型后续拿到了正确结果（会话自愈）。
  乙烷同形：result.json ok（15:29），seq 59242 捕获结果与 workdir 自洽。
- **read_image 模型能力**：HPC 网关 deepseek-v4-flash/pro 对 image_url 静默丢图
  （两模型 reasoning 均自述"no image attached"）——网关侧确无图像输入，非 harness 缺陷。
  解法：接入 BigModel glm-5.3-flash（原生多模态），见 `profiles/mat.yml` bigmodel 段
  与 `scripts/probe-bigmodel.ts`。

**仍开放**：服务端 (密钥, 集群) 级 shell 复用是根因，反馈稿见同目录
`2026-09-04-mat-server-feedback.md`，待提交 HPC；本侧双层防护在服务端修复后仍保留
（纵深防御，开销可忽略）。
