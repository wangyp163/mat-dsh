# mat-bundle

HPC 科学计算 harness 的 **dsh profile bundle**：一个 npm 包把 HPC 的工具面
（mat-tools）、打包技能（mat-skills）、Web UI 增强（mat-ui）、OPTIMADE/matgen
MCP 引用与批量子代理四角色收编为一层组合，供任何 dsh 发行版以一行声明装载。

## 安装（目标机）

```bash
# 1) profile 声明（$DSH_HOME/profiles/<name>/package.json）：
#    "dependencies": { "mat-bundle": "<version>" }
#    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base",
#                                     "@deepseek-ai/dsh-web-app",
#                                     "mat-bundle"] } }
dsh plugin add mat-bundle        # 或对 profile 目录 pnpm/npm install

# 2) 用户级 patch 只补环境相关行（LLM 路由/默认模型/网关地址）——
#    模板见仓 profiles/mat.yml（llm-pi-ai / agent-default-model / llm-deepseek 三行族）。

# 3) 凭证经环境变量注入（env.local 模板见仓根 env.example）：
#    MAT_MCP_KEY / MAT_ACCESS_KEY / MAT_SECRET_KEY / MAT_USER /
#    LLM_API_KEY / LLM_BASE_URL / LLM_PROVIDER_ID / LLM_MODEL_ID

# 4) 验证组合树：
dsh --profile <name> --dump-config
```

## 兼容矩阵

| 组件 | 兼容窗口 | 说明 |
|---|---|---|
| 本 bundle 全体 | dsh `0.1.0-rc.8`（npm `^0.1.0-rc.8` / cordis `^4.0.1`） | 依赖的上游 seam/事件接口以此版为准；dsh 为 Developer Preview，升级宿主＝一次适配窗口 |
| mat-tools / mat-skills / mat-core | 宽 | 只消费公开 seam（tools/system-prompt/jobs/session/llm/skills），不依赖 loop 实现 |
| mat-ui | 窄 | harmony Source Patches 打在特定 web-app 源码上（`dsh.harmony.patches`）；宿主 web-app 变更可能失配。失配时 `MAT_UI_OFF=1` 整行禁用，核心能力不受影响 |

## 可配置项

| 开关 | 默认 | 作用 |
|---|---|---|
| `MAT_UI_OFF=1` | 关 | 禁用 mat-ui 行（UI 增强/Source Patches 失配逃生口） |
| `LLM_PROVIDER_ID` / `LLM_MODEL_ID` | `mat` / `deepseek-v4-flash` | 四个子代理角色的模型路由 |
| `OPTIMADE_MCP_URL` / `MATGEN_MCP_URL` | HPC 部署实例 / 本地隧道 | 两个 MCP 引用端点 |

## 不随包分发的部分（各归其位）

- **HPC 远端 workflow**（Gaussian 1.7.x 双 wheel、集群 HOME 部署）：计算平面，
  由 SOP 库的发布/部署 SOP 管理（`~/dev/sops`，见下）。
- **matgen / OPTIMADE MCP 服务本体**：包内只带 mcp-client 引用行；matgen 需先起
  隧道（仓 `scripts/matgen-tunnel.sh start`）。
- **运行时状态**（`MAT_FILE_ROOT` 下 task-packages/jobs.json/remote-homes、
  mat.db、exec-gate 文件锁）：经环境变量指向，不随包走。
- **SOP 与 ZCode 侧 skill**：跨仓跨工具的治理层（SOP 登记表 `~/dev/sops/sops.yaml`
  + `~/.zcode/skills/`），编排部署/压测工作流，不属于 dsh 会话内行为——本包只带
  指回链接，不复制内容。
