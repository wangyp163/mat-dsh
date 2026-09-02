# mat-dsh

HPC 科学计算 harness（基于 DeepSeek Harness 0.1.0-rc.8，树外组合，不改宿主源码）。

## 产品边界

mat-dsh 采用本地控制平面、HPC 计算平面的混合架构：本地 dsh 插件维护 skill、输入 schema、validator、声明式控制文件生成、结果解释器与 artifact 同步策略；HPC 维护并执行 workflow 商品、科学软件与许可证、集群适配和 Slurm 运行时。本地只发送结构及 `pre.json`/`run.json`/`post.json` 等控制数据，不上传 workflow 实现。

远端保存完整原始结果，本地默认同步结构化结果与轻量重要文件；大型 checkpoint、波函数、轨迹和中间文件保持 `remote-only` 映射，需要时再按 Job 上下文同步。当前 Gaussian 命令链通过 `RemoteWorkflowAdapter` 作为兼容执行后端，待 HPC 提供统一的 workflow API 后可替换后端而不改变 skill 和工具调用面。

- HPC Workflow API 产品形态（提案）：[`docs/mat-workflow-api-product.md`](docs/mat-workflow-api-product.md)
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

## M2：工具面补全 + mat_gaussian 一站式 + 文件传输 + 回放契约

**新增工具**（`packages/mat-tools`）：

- `mat_partitions` / `mat_sbatch` / `mat_job_status` / `mat_cancel` —— 四薄工具，
  对齐 Python 时代语义（sinfo 五列、sbatch 解析、squeue→sacct 兜底、scancel）。
- `mat_gaussian` —— **一站式 Gaussian**：一次调用 prepare（单命令打包 mkdir/heredoc/
  三 json/落盘校验）→ pre → run → sbatch 秒级返回 slurm job id + 后台作业 id（kind
  `mat-slurm`）。后台 producer 服务端监控至终态，**COMPLETED 自动 post 并解析物性**
  （energy/converged/frequencies_cm-1/imaginary_frequency_count + files 进 `job_output`）；
  非 COMPLETED 跳过 post 带 log_tail 诊断；post 失败不判作业失败。默认 B3LYP/6-31G(d)、
  32 核/64GB、Agent0；`options` 透传 pre_json/run_json/workflow_env/g16_env/poll_seconds/
  max_wait_seconds（默认 1800s）。多波组合（opt+sp、aea）不适用，走分步链路。
- `mat_upload` / `mat_download` —— 文件传输。首选 OpenAPI：AK/SK HMAC-SHA256
  换取集群 token → `/ac/openapi/v2/center` 发现启用的 efile 地址 → curl multipart 上传 /
  content-type 分流下载；凭证为 `MAT_ACCESS_KEY` / `MAT_SECRET_KEY` / `MAT_USER`。
  当目标集群未获 OpenAPI token/efile 权限时，自动改走已有 `MAT_MCP_KEY` 授权的
  remote-shell 分块通道，校验字节数后原子替换目标。凭证均只放 gitignored `env.local`。

**核心库新增**（`packages/mat-core`）：

- `slurm.ts` —— sinfo/sbatch/单作业状态命令构造与解析。
- `gaussian.ts` —— 同步段 `runGaussianSync`、post 解析 `parsePostOutput`（首个可解析 `{` 行）、
  producer `createGaussianProducerHooks`。
- `watch-loop.ts` —— 新增 `onAllSettled` 钩子（仅全部终态路径触发；detailSuffix/extraLines
  并入结算；钩子抛错吞入诊断行不炸结算）。
- `token.ts` / `efile.ts` —— 开放 API token 客户端与 efile 客户端（runner/fetch 全注入可测）。

**回放契约**（`packages/mat-core/test/contract/`）：真实录制 fixtures（M1 evidence 逐字
转录）回放进解析器与 watch 全链路，行为漂移即红；来源与 synthetic 标注见
`PROVENANCE.md`（sinfo 5 列与 gaussian/exec fixtures 待实弹回填）。

证据：`docs/evidence/m2/`。

