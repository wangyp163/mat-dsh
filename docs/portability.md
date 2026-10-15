# mat-dsh 可移植性指南（Cordis 插件化改造，2026-10-08）

本仓的全部 dsh 侧资产已重组为**可发布、可移植的 Cordis 插件族**：目标是任何
dsh 发行版（上游 API 稳定窗口内）一行声明装载，无需本机仓布局。

## 包族结构

```
packages/mat-core     纯 TS 库（零 dsh 依赖）——客户端/watch-loop/Slurm/producer/task-package/pipeline
packages/mat-tools    Cordis 插件——工具面 + 门禁钩子（Config schema 可配置）
packages/mat-skills   Cordis 插件——打包技能 provider（skills/ 15 个 SKILL.md 随包分发）
packages/mat-ui       Web UI 增强（可选层，兼容窗口窄，见其 README 兼容矩阵）
packages/mat-bundle   dsh profile bundle——环境无关行的组合层（一行安装入口）
```

依赖形态（发布面）：`@deepseek-ai/*` 走 npm 版本范围（`^0.1.0-rc.8`，cordis
`^4.0.1` peer，与上游 dsh-base 同约定）；内部包 `workspace:*`（`pnpm publish`
自动改写为真实版本）。开发面：根 package.json 的 `pnpm.overrides` 把全部
`@deepseek-ai/*` 重定向到兄弟目录 `deepseek-harness/` 宿主 TS 检出——与改造
前的 `link:` 直连完全同源，宿主 vendored cordis（含 18 条本地加固）始终单实例。

## 目标机安装（五步）

1. profile 声明：`$DSH_HOME/profiles/<name>/package.json` 的
   `dsh.profile.bundles` 追加 `"mat-bundle"`，`dependencies` 加
   `"mat-bundle": "<version>"`，随后对 profile 目录 install。
2. 用户级 patch 补环境行（模板 = 本仓 `profiles/mat.yml`）：
   `llm-pi-ai` 路由 / `agent-default-model` / `llm-deepseek` 三行族。
3. 凭证经环境变量（`env.example` 为模板）：`MAT_MCP_KEY`、
   `MAT_ACCESS_KEY/MAT_SECRET_KEY/MAT_USER`、`LLM_API_KEY/LLM_BASE_URL/LLM_PROVIDER_ID/LLM_MODEL_ID`。
4. matgen 隧道（如需材料筛选）：`scripts/matgen-tunnel.sh start`。
5. `dsh --profile <name> --dump-config` 验证组合树。

兼容窗口与可配置项（`MAT_UI_OFF` 等）见 `packages/mat-bundle/README.md`。

## 本地 dev 与目标机同构

`scripts/dsh-web.sh start` 的装载路径与目标机安装完全同构：把四个包软链进
`$DSH_HOME_DIR/profiles/web/node_modules`、幂等注入
`dsh.profile.bundles += "mat-bundle"`，`--patch profiles/mat.yml` 只叠环境行。
也就是说 **dev 环境每个启动周期都在验证 bundle 的可移植装载路径**，不是双轨。

## 技能分发的机制变化

- 旧：`dsh-skill-filesystem` 的 `customSkillDirs` 指向仓根 `skills/`，依赖
  `MAT_DSH_ROOT` 环境变量（dsh-web.sh 导出）。
- 新：`mat-skills` 插件注册 `ctx.skills` provider（source `bundled`、rank
  600、resourceBase 指向技能目录），技能根经 `import.meta.url` 从包内自解析。
  仓根 `skills` 保留为指向 `packages/mat-skills/skills` 的兼容软链
  （sops.yaml 登记路径 / kb-sync / 历史文档引用全部继续有效）。

## 不随包分发的部分（边界，与 README 产品边界一致）

| 资产 | 归属 | 入口 |
|---|---|---|
| Gaussian/VASP workflow（远端 1.7.x 双 wheel） | HPC 计算平面 | SOP 库发布 SOP（`~/dev/sops`） |
| matgen / OPTIMADE MCP 服务本体 | 常驻服务 | 隧道脚本 + bundle 内 mcp-client 引用行 |
| 运行时状态（task-packages/jobs.json/mat.db/锁） | 本机 `MAT_FILE_ROOT` | 环境变量/插件 `fileRoot` 配置 |
| SOP 登记表 + ZCode 侧 skill | 跨仓跨工具治理层 | `~/dev/sops/sops.yaml`（本包族只带指回，不复制） |

## 已知边界

- 上游 dsh 为 Developer Preview（`SESSION_FORMAT_VERSION=0`，无兼容承诺）：
  「任何 dsh 发行版」的可移植性边界 = 上游 seam/事件接口稳定范围。升级宿主
  = 一次适配窗口（对照 `packages/mat-bundle/README.md` 兼容矩阵）。
- 本包族发布物以 TS 源为 main（`src/index.ts`）——依赖 dsh 组合层原生 TS
  加载（dev 链路每周期验证）；若目标 dsh 要求编译产物，补 per-package build。
- scripts/ 下 `portfolio-cli.ts` 与 `probe-live-watch.ts` 存量类型错误
  （2026-10-08 记录，与本改造无关，未触碰）。
