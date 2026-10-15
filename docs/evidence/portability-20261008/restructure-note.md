# 2026-10-08 Cordis 插件化改造取证

## 变更

mat-dsh 全部 dsh 侧资产重组为可移植插件族（方案先行经用户批准）：

1. `skills/` → `packages/mat-skills/skills/`（git mv 43 文件），新增
   `ctx.skills` provider 插件（source `bundled`、rank 600、`import.meta.url`
   自解析技能根）——`MAT_DSH_ROOT` 环境变量依赖消除。
2. 新增 `packages/mat-bundle`：`dsh.bundle.patch` manifest，收编
   profiles/mat.yml 的全部环境无关行（工具面/技能/UI/mcp 引用/子代理四角色，
   角色 provider/model 改 env 回退默认）。
3. `profiles/mat.yml` 瘦身：只留 LLM 路由三行族 + dev 技能隔离行。
4. 四包发布就绪：`@deepseek-ai/*` 依赖改 npm 范围（`^0.1.0-rc.8`，cordis
   `^4.0.1` peer），内部 `workspace:*`；根 `pnpm.overrides` 把 dev 解析重定向
   宿主 TS 检出（vendored cordis 单实例保持）。
5. `dsh-web.sh`：软链四包 + 幂等注入 `dsh.profile.bundles += mat-bundle`
   ——dev 与目标机同构装载。
6. mat-tools 增 Config schema（mcpBaseUrl/mcpKeyEnv/transport/fileRoot，
   配置先行 env 兜底）。

## 验证

| 关 | 结果 |
|---|---|
| `pnpm typecheck` | `tsc -b` 全包通过；scripts/ 两处存量错误与本改造无关（portfolio-cli.ts / probe-live-watch.ts，改动前即存在） |
| `pnpm test` | 96 文件 / 861 测试全绿（含新增 skills-provider 5 例、profile-loader 新形态 4 例） |
| `npm pack --dry-run` | 四包均可打包：mat-core 39 文件 / mat-tools 11 / mat-skills 45（含 skills）/ mat-bundle 3 |
| `sop-lint` | 0 error 0 warning（仓根 skills 软链保住 sops.yaml 登记路径） |
| `--dump-config` | exit 0，685 行组合树：bundle 行（mat-tools/skills/ui/mcp×2/subagent×4）与环境行（llm×3 + skill-filesystem 隔离）全部就位，`tool-subagent disabled:false` 跨三层补丁正确收口（见 composed-dump-config.yml） |
| 服务重启 | dsh-web.sh restart 成功，HTTP 200，日志零 error/failed |
| 运行时 provider | 经 profile node_modules 解析路径加载：15 技能列出、gaussian-calc 在列 |

## 不随包分发（边界不变）

远端 workflow（SOP 库管理）、matgen/OPTIMADE 服务本体（隧道脚本）、运行时
状态（MAT_FILE_ROOT）、SOP 登记表与 ZCode 侧 skill（治理层，包内只带指回）。
