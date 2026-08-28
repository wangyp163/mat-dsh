# mat-dsh

HPC 科学计算 harness（基于 DeepSeek Harness 0.1.0-rc.8，树外组合，不改宿主源码）。

- 设计：`../docs/superpowers/specs/2026-08-27-mat-dsh-design.md`
- M0 spike 计划：`../docs/superpowers/plans/2026-08-27-mat-dsh-m0-spike.md`

## 启动（M0）

```bash
cp env.example env.local   # 填入真实凭证
set -a; source env.local; set +a
pnpm install
pnpm --dir ../deepseek-harness dsh web --no-open --patch "$PWD/profiles/mat.yml"
```

## M1：异步作业监控 + FetchTransport

**工具面**（`packages/mat-tools`）：

- `mat_exec` —— 远程 shell（不变）。
- `mat_job_watch` —— **批量异步监控**：一次注册全部 Slurm job_id，挂宿主后台作业
  （kind `mat-watch`，job id 形如 `mat-watch-1`）。服务端自适应轮询 sacct
  （10/60/120/300s 档，`poll_seconds` 可封顶，下限 10s），每 tick 一条批量命令，
  零模型请求；全终态/超时/连续 5 次传输异常/取消四路结算，宿主自动向会话投递完成通知，
  `job_output` 读逐作业终态表（增量流语义）。`job_kill` 只取消监控，不动集群作业。

**核心库**（`packages/mat-core`）：

- `job-state.ts` —— sacct 批量行解析、终态判定、自适应间隔档位。
- `watch-loop.ts` —— `createWatchLoop()`，依赖全注入（定时器/execCommand），
  返回宿主 `JobHooks` 同形句柄 `{cancel, done, readOutput}`。
- `fetch-transport.ts` —— `FetchMcpTransport`：原生 fetch 传输 + **非 2xx 状态码显式检查**
  （406 等会话失效场景抛错含状态码并重建会话）。`MatClient` 选配：
  `transportKind` 或环境变量 `MAT_TRANSPORT`（`curl` 默认 / `fetch` opt-in，
  实弹 fetch 往返约 2s vs curl 约 10s）。
- 每次 watch 使用独立 `MatClient` 实例，与 `mat_exec` 单例会话隔离。

证据：`docs/evidence/m1/`（格式探测、fetch 探针、headless e2e ×2、web gaussian e2e）。

