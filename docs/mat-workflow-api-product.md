# HPC Workflow API 产品形态（提案）

> **状态声明**：本文定义的是 HPC Workflow API 的目标产品形态与建议契约，**不是对 HPC 当前已部署接口的确认**。截至本文编写时，mat-dsh 的 Gaussian 执行仍通过 MCP/remote-shell 调用远端 `gaussian-workflow` CLI 和 Slurm；正式 Workflow API 需要由 HPC 服务侧另行实现、发布和维护。

## 1. 产品目标

mat-dsh 采用“本地控制平面 + HPC 计算平面”的边界：

- **本地 dsh / Agent**：理解用户意图，选择 workflow，构造并校验声明式输入，生成 `pre.json` 等控制数据，决定哪些结果自动同步，并解释结果。
- **HPC**：提供 workflow 商品、科学软件、许可证、集群适配、调度和运行时，负责在远端执行计算并保存完整原始产物。
- **efile**：负责远端 artifact 的目录访问和文件传输，不承担 workflow 编排语义。
- **MCP API / remote-shell**：负责兼容性调用、诊断和尚未被正式 API 覆盖的运维操作，不应成为新 workflow 集成的主要业务契约。

目标是让本地 Agent 使用 HPC 上已有的 workflow，而不是把 workflow 实现或软件包上传到 HPC。大型 checkpoint、波函数、轨迹和中间文件默认保留在远端；本地保存结果摘要和 artifact 映射，按需下载。

## 2. 资源模型

### 2.1 Workflow

Workflow 是 HPC 侧发布的可执行科学计算商品，由稳定的 `id` 和不可变的 `version` 标识。版本发布方同时声明：

- 输入 schema；
- 结果 schema；
- artifact manifest schema；
- 支持的计算资源、分区和能力；
- 默认输出以及可请求的输出类别；
- 兼容性和弃用策略。

例如：

```json
{
  "id": "gaussian-opt-freq",
  "version": "1",
  "input_schema": "gaussian.pre.v1",
  "output_schema": "calcflow.result.v1",
  "artifact_manifest_schema": "mat.artifacts.v1"
}
```

### 2.2 Workflow run

一次用户请求对应一个异步 `workflow run`。run 是唯一的服务端资源，拥有独立的 `run_id`、生命周期状态、结果、artifact manifest 和审计元数据。服务端可以在内部创建一个或多个 Slurm job，但这些调度细节不应成为客户端业务契约。

### 2.3 Artifact

Artifact 是 workflow 产生的文件或目录。manifest 至少应包含稳定的 `artifact_id`、相对 workflow 工作目录的路径、大小、类型、校验和、生命周期状态及下载策略。客户端不能仅凭浏览器提交的任意远端路径获得访问权限；artifact 的路径和授权范围由 run 服务端派生。

## 3. 建议 API

以下路径是建议的版本化资源形态，具体域名、网关前缀和认证头由 HPC 服务侧确定。

### 3.1 能力发现

```http
GET /api/v1/workflows/{workflow_id}/capabilities
```

可选的 `version` 查询参数用于请求特定版本。响应示例：

```json
{
  "workflow": {
    "id": "gaussian-opt-freq",
    "version": "1",
    "status": "available",
    "input_schema": "gaussian.pre.v1",
    "output_schema": "calcflow.result.v1",
    "artifact_manifest_schema": "mat.artifacts.v1"
  },
  "capabilities": {
    "operations": ["opt", "freq"],
    "clusters": ["11250"],
    "partitions": ["Agent0"],
    "requested_outputs": ["properties", "artifact_manifest"],
    "max_input_bytes": 10485760,
    "supports_idempotency": true
  }
}
```

能力发现只描述可用性，不会上传或返回 workflow 源码、软件安装包或许可证内容。

### 3.2 创建 run

```http
POST /api/v1/workflow-runs
Idempotency-Key: local-calculation-abc-001
Content-Type: application/json
```

请求示例：

```json
{
  "workflow": {
    "id": "gaussian-opt-freq",
    "version": "1"
  },
  "cluster_id": "11250",
  "workdir": "$HOME/workspace/h2o-run1",
  "inputs": {
    "structure": {
      "format": "xyz",
      "content": "3\nh2o\nO 0 0 0\nH 0.75 0.58 0\nH -0.75 0.58 0\n"
    },
    "pre": {
      "schema_version": "gaussian_workflow.pre.v1",
      "resources": {"ncores": 32, "memory": "64GB"},
      "ase": {
        "calculator_kwargs": {
          "method": "B3LYP",
          "basis": "6-31G(d)",
          "opt": ["Tight", "CalcFC"],
          "freq": "HPModes"
        }
      }
    },
    "run": {
      "slurm": {
        "partition": "Agent0",
        "time": "00:30:00",
        "mem": "64GB"
      }
    }
  },
  "outputs": {
    "include": ["properties", "artifact_manifest"]
  }
}
```

> **路由键说明**：示例 `pre` 块里的 `opt`/`freq` 是 `gaussian-opt-freq` 这个 task **自身的路由键精调**（声明式请求须与 workflow id 一致）。路由键必须与 task 匹配——**异 task 路由键在 workflow 1.3.1+ 会被剥离，旧版部署则会污染 route**；因此声明式请求里不要携带与 task 无关的路由键（opt/freq/td/irc/polar/force/scan），路由身份只由 `workflow.id` 决定。

重要约束：`inputs` 是声明式控制数据，不是 workflow 包。请求不得要求服务端执行客户端上传的任意脚本，也不得绕过 workflow 的 schema、资源策略和路径策略。

成功创建时建议返回 `202 Accepted`：

```json
{
  "run_id": "wfr_01JXYZ...",
  "workflow": {"id": "gaussian-opt-freq", "version": "1"},
  "state": "queued",
  "created_at": "2026-09-01T10:00:00Z",
  "links": {
    "self": "/api/v1/workflow-runs/wfr_01JXYZ...",
    "result": "/api/v1/workflow-runs/wfr_01JXYZ.../result",
    "artifacts": "/api/v1/workflow-runs/wfr_01JXYZ.../artifacts"
  }
}
```

### 3.3 查询生命周期

```http
GET /api/v1/workflow-runs/{run_id}
```

响应示例：

```json
{
  "run_id": "wfr_01JXYZ...",
  "workflow": {"id": "gaussian-opt-freq", "version": "1"},
  "state": "running",
  "cluster_id": "11250",
  "workdir": "$HOME/workspace/h2o-run1",
  "progress": {"phase": "run"},
  "created_at": "2026-09-01T10:00:00Z",
  "started_at": "2026-09-01T10:00:08Z",
  "updated_at": "2026-09-01T10:03:12Z"
}
```

建议状态：

```text
queued → preparing → running → postprocessing → completed
                                      └───────→ failed
queued/preparing/running/postprocessing ─────→ cancelled
completed ───────────────────────────────────→ needs_review（可选人工复核态）
```

终态响应应包含稳定的错误对象（`code`、`message`、`phase`、可选 `retryable` 和 `details`）。不得要求客户端解析 Slurm 原始文本来判断业务结果。取消操作如未来提供，应是显式的 `POST .../cancel`，并清楚说明是否只取消 workflow run、是否会取消底层调度任务。

### 3.4 获取结构化结果

```http
GET /api/v1/workflow-runs/{run_id}/result
```

响应示例：

```json
{
  "run_id": "wfr_01JXYZ...",
  "schema": "calcflow.result.v1",
  "state": "completed",
  "result": {
    "energy": -76.4211,
    "converged": true,
    "frequencies_cm-1": [1595.2, 3657.1, 3755.3],
    "imaginary_frequency_count": 0
  },
  "artifacts": {
    "manifest_url": "/api/v1/workflow-runs/wfr_01JXYZ.../artifacts"
  }
}
```

结果 schema 应可独立演进。无法生成完整结果时，服务端应返回明确的 `result-unavailable` 或 `partial-result` 状态，而不是伪造成功结果。

### 3.5 查询和获取 artifact

```http
GET /api/v1/workflow-runs/{run_id}/artifacts
GET /api/v1/workflow-runs/{run_id}/artifacts/{artifact_id}
```

manifest 示例：

```json
{
  "run_id": "wfr_01JXYZ...",
  "schema": "mat.artifacts.v1",
  "artifacts": [
    {
      "artifact_id": "result-json",
      "path": "result.json",
      "kind": "file",
      "size": 4821,
      "sha256": "...",
      "local_policy": "sync",
      "downloadable": true
    },
    {
      "artifact_id": "checkpoint",
      "path": "opt+freq/wfn.chk",
      "kind": "file",
      "size": 2147483648,
      "sha256": "...",
      "local_policy": "remote-only",
      "downloadable": true
    }
  ]
}
```

小型结构化产物可以由 dsh 自动同步到受控本地映射目录；大型产物默认只保存 manifest 和远端引用。获取接口可以直接流式返回，也可以返回短时效、绑定 run 权限的 signed URL。下载仍由 efile 或 HPC 受控传输层完成，必须支持大小/校验和验证与失败重试。

## 4. 版本、schema 与兼容性

1. API 路径使用 `/api/v1`；不兼容的资源语义进入新的 API major version。
2. Workflow `id + version` 固定执行版本，不能在同一版本中静默改变科学含义。
3. `input_schema`、`output_schema` 和 `artifact_manifest_schema` 使用独立版本号；服务端在创建 run 时记录实际采用的 schema。
4. 能力发现应返回弃用时间、支持窗口和可选迁移提示。
5. 客户端必须在提交前校验 schema，并在服务端再次校验；服务端拒绝未知字段、越界资源和不支持的输出类别。
6. 结果解释器应按 schema 分派，不依据字段碰巧存在与否猜测版本。

## 5. 幂等、重试与审计

- 创建 run 使用 `Idempotency-Key`。同一租户、同一 key 和同一请求指纹应返回同一个 run；请求内容冲突时返回 `409`。
- 网络超时后客户端可以安全重试创建请求，但不能因此产生重复计算。
- 查询、结果和 manifest 获取应为幂等读操作。
- 服务端应保留创建者、workflow 版本、输入摘要、资源选择、状态变迁和 artifact 校验信息；敏感输入按 HPC 数据保留策略处理。
- 重试策略应区分传输失败、临时调度失败和输入/科学计算失败，不能自动重跑所有 `failed` run。

## 6. 认证与凭证隔离

正式 API 应使用 HPC 规定的用户/租户认证方式，并由服务端完成 workflow、cluster 和 artifact 授权。mat-dsh 的 AK/SK、MCP key 等凭证只存在于本地受保护配置或服务端安全存储中：

- 不写入 `pre.json`、run 请求日志、Job 输出或 artifact 内容；
- 不发送给 workflow 实现作为普通输入；
- 不暴露给浏览器端；
- efile 下载凭证和 signed URL 采用最小权限、短时效策略。

浏览器只能提交 run ID 和服务允许的 artifact ID。服务端从持久化 Job/run 记录派生 cluster 与工作目录，禁止浏览器通过任意路径越权访问远端文件。

## 7. Workflow API、MCP API 与 efile 的关系

```text
本地 Agent / dsh plugin
          │  声明式 inputs + workflow/version
          ▼
HPC Workflow API（目标业务契约）
          │  内部编排、授权、Slurm、postprocess
          ▼
HPC workflow runtime / cluster
          │
          ├── 结构化 result
          └── artifact manifest ── efile ──► 本地受控映射

MCP API / remote-shell：兼容调用、诊断、探针和迁移期后备通道
```

Workflow API 负责“运行什么、输入是否合法、结果是什么”；efile 负责“如何列出和传输已授权的产物”；MCP/remote-shell 负责兼容性和运维。三者不应互相替代。

## 8. 从当前 Gaussian 实现迁移

当前代码已经建立本地 `RemoteWorkflowAdapter` 边界，并使用：

```text
mat_gaussian
  → declarative RemoteWorkflowRequest
  → compatibility adapter
  → MCP remote-shell
  → gaussian-workflow CLI
  → sbatch / watch / postprocess
```

迁移到正式 API 时：

1. 保留 `mat_gaussian` 的 skill、参数和本地 schema 校验。
2. 将 adapter 的 `execute` 实现替换为 Workflow API client。
3. 用返回的 `run_id` 作为本地 Job 追踪主键；底层 Slurm ID 仅作为诊断元数据。
4. 用 API result 和 artifact manifest 填充现有 StatusBoard 与文件管理器。
5. 继续使用本地 `sync` / `remote-only` 策略；不因 API 上线而启用 live mount。
6. 在过渡期按能力发现结果选择正式 API 或当前兼容后端，并在 Job 记录中保存 backend 类型，保证重启后可追踪。

这样可以替换远端执行实现，而不改变本地 skill、用户输入面和文件同步体验。

## 9. 非目标与边界

- 不把 workflow 源码、运行包或本地插件打包上传到 HPC。
- 不让浏览器取得任意远端路径 authority。
- 不提供 FUSE、WebDAV 或其他 live filesystem mount。
- 不把完整原始输出默认复制到本地。
- 不要求客户端依赖 Slurm 命令输出作为稳定 API。
- 不把 MCP/remote-shell 的当前兼容路径描述为正式 Workflow API。

## 10. 实现状态

| 能力 | 当前状态 |
| --- | --- |
| 本地 `RemoteWorkflowAdapter` 抽象 | 已实现 |
| Gaussian 声明式请求与 artifact policy 类型 | 已实现 |
| 当前 MCP/remote-shell + CLI 兼容后端 | 已实现 |
| Job 持久化、受控文件映射、efile 优先传输 | 已实现 |
| 本文所述统一 HPC Workflow API | **提案，待 HPC 服务侧提供** |
| 统一能力发现、run ID 与 signed artifact URL | **目标能力** |
