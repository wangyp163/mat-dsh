# 新 PC 部署指南（mat-dsh Gaussian 能力）

目标形态：**换一台 PC，填好凭证，跑一次自检，即用**。本文覆盖前提、四步部署、
凭证矩阵，以及"新 AK/SK"最容易被忽略的一个变量——它对应的是不是同一个集群账号。

## 前提（一次性）

- Node ≥18（本仓实测 22.x）、pnpm、curl（mat-core 默认传输依赖 curl 二进制；
  `MAT_TRANSPORT=fetch` 可免）
- 两个仓**兄弟布局**放好（父目录任意）：
  ```
  <任意父目录>/
  ├── deepseek-harness/     # 宿主仓（建议与本仓当前用同一版本/commit；mat-ui 的
  │                         #   Harmony patch 对宿主版本有指纹，跨版本可能静默失效）
  └── mat-dsh/            # 本仓（或移植包解压后重命名）
  ```
  布局不同时设 `DEEPSEEK_HARNESS_REPO` 指向宿主仓。
- dsh web profile 已初始化：`pnpm --dir ../deepseek-harness install && pnpm --dir ../deepseek-harness dsh web --no-open`（按 README M0 流程，在 `~/.local/share/mat-dsh/profiles/web/` 建立 harmony 安装；首次初始化后即可 stop）。

## 四步部署

```bash
cd mat-dsh
pnpm install                                   # 1 依赖（link: 已是兄弟相对路径，免改）
cp env.example env.local && vim env.local      # 2 填凭证（见下表）
set -a; source env.local; set +a
pnpm tsx scripts/deploy-check.ts               # 3 自检（六项，全绿才算就绪）
scripts/dsh-web.sh start                       # 4 起服务 → http://127.0.0.1:3080
```

位置无关性说明：`dsh-web.sh` 从自身位置推导仓根并导出 `MAT_DSH_ROOT`，
`profiles/mat.yml` 的插件/skill 路径由该环境变量解析——profile 与脚本里
**没有本机绝对路径**，换 PC 不需要改任何文件。手动（不经 dsh-web.sh）启动时先
`export MAT_DSH_ROOT=$PWD`（本仓根）。

## 凭证矩阵（env.local）

| 变量 | 必需性 | 用途 | 缺省行为 |
|---|---|---|---|
| `MAT_MCP_KEY` | **必需** | remote-shell（exec/sbatch/文件后备通道） | 无则全部远端工具不可用 |
| `MAT_MCP_BASE_URL` | 可选 | MCP 网关覆盖 | 默认 mcp-gateway.example.internal |
| `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL_ID`（+`LLM_PROVIDER_ID`） | 会话模型必需 | dsh 会话的 LLM 路由 | 无则 web 会话无模型 |
| `MAT_ACCESS_KEY`/`MAT_SECRET_KEY`/`MAT_USER` | 可选 | efile 文件传输 | 自动回落 remote-shell 分块通道 |
| `BIGMODEL_API_KEY` | 可选 | glm-5.3-flash 多模态（图像自检） | 不配则 read_image 不可用 |

## 远端侧：新 AK/SK 的关键变量——是不是同一个集群账号

- **同一 HPC 账号（只是换 PC 操作）**：零远端工作，填 `MAT_MCP_KEY` 即用。
  状态（jobs.json 状态板、remote-homes.json 缓存）是本机局部的，新 PC 从空白开始，
  不影响远端作业。
- **新 HPC 账号**：集群 `$HOME` 是新的，需在该账号下备齐两样：
  1. **g16 环境**：自动化——skill 门禁会引导 `bootstrap_g16.sh` 从公共软件包
     幂等拷贝到 `$HOME/workspace/g16-hy`；
  2. **demo gaussian-workflow**：**非 skill 自动化**——按 gaussian-release-stress
     的部署 SOP（Phase A 双 wheel force-reinstall）把 workflow 部到
     `$HOME/workspace/demo`，版本须对上 skill 的锚（当前 1.6.2，权威源
     `skills/gaussian-calc/scripts/env_profile.sh`，改版本三处同步）。
  另需该账号有计算分区权限（Agent0 等，计费相关）。

  自检第 6 项会明确指出缺哪个：workflow 缺 → 跑 Phase A；g16 缺 → bootstrap 自动。

## 验收（部署后冒烟）

1. web 会话里 `mat_exec` 跑 `hostname`（deploy-check 已含等价项）；
2. 让模型加载 gaussian-calc skill，走一次 `mat_gaussian` 一站式 opt（乙醇小分子，
   默认档 Agent0/32 核/30 分钟内），`job_output` 读到 energy/converged/plots 即通。
