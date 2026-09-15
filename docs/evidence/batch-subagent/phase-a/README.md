# Phase A 前置核对与工程件（2026-09-15）

batch-subagent spike 的 Phase A 证据。计划：`~/mat-harness/docs/superpowers/plans/2026-09-15-mat-batch-subagent-spike.md`。

## Task 0a：组合核实（零 LLM 成本）

`task0a-composed-dump-config.yml`——`dsh --profile web --patch profiles/mat.yml --dump-config`
全量组合转印（586 行）。结论：

1. **subagent 家族在位**：`subagent`（registry）、`subagent-spawn-in-process`/`subagent-fork-in-process`
   （providers，providerName `spawn`/`fork`）、`tool-subagent`/`tool-subagent-fork`（模型工具）、
   `tool-subagent-report`、`ui-subagent`、`tool-jobs`；我们的 `mat-tools`/`mat-ui` overlay 行生效。
2. **但 web-app patch 层默认 `disabled: true`**（tool-subagent 行）——运行时在、模型工具关。
   overlay 已补 `disabled: false` + 三个角色实例挂载（P4，见下）。
3. **每次调用参数只有 `description`/`prompt`/`run_in_background`**；`outputSchema`/`toolFilter`/
   `agentOptions`（provider/model/maxTokens 模型路由）都是**插件行 config**——角色化只能靠
   多实例挂载（每角色一个 toolName），结构化回传靠 prompt 契约 + 父侧 contracts.ts 校验拒收。
   这是对计划 P2/P4 落地形态的修正：`outputSchema` 不可按次传。
4. 模型侧工具名核实（toolFilter 白名单用）：`read`/`write`/`str_replace_editor`/`bash`/`skill`/
   `job_output`/`mat_exec` 等。

## Task 0b：集群门禁（零 LLM 成本）

`task0b-gate-check.txt`——直连 mat-core（`scripts/probe-batch-gate.ts`，不经 LLM）。
`ok=true`，`deployed_version=1.7.3=expected`，`missing_tasks=[]`（14 required 全在 + opt+freq
组合），g16 env 就位。elapsed 55s（冷启动级）。

## Task 0c-1：基线提取（既有压测取证，不重跑）

来源 `docs/evidence/gw-merge-stress/`（2026-09-01，20 会话，deepseek-v4-flash effort=high，
11250 Agent0）。token 剖面提取（usage 事件，未去重的近似值）：

| 会话 | task | 墙钟 | LLM 调用 | sum_out | 最终上下文（末次 input+cacheRead） |
|---|---|---|---|---|---|
| a1 | opt（3 轮挣扎） | 966s | 24 | 8618 | ≈31.1k |
| a4 | opt+freq（直通） | 211s | 14 | 6778 | ≈27.6k |

**基线操作化**：单体系单作业会话最终上下文 ≈28–31k tokens。10 体系外推 solo 基线
≈280k+（或触发压缩）。H1 判据据此定：Phase B–E 走 fan-out 后主会话最终上下文
≤100k（外推基线的 1/3）。

### 环境破损发现与修复（前置核对的直接收益）

**skill-filesystem 被 bundle 层 `disabled: true`**：服务 2026-09-15 22:03 重启后所有会话
`gaussian-calc` 报 unknown skill（第一次 V1 尝试 session-b16b0dca 即死于此后乱翻文件系统）。
我们 overlay 原来只 patch 该行 config、没管 disabled 位。修复：overlay 补 `disabled: false`
（profiles/mat.yml），重启服务，V1 重发（session-87aef794）后 skill 正常加载。

## Task 0c-2：V1 校准点（skill 修复后）

`task0c-v1-calibration.md`——单体系（H2O opt+freq）单 agent 直通，同 a4 prompt 形态。
目的：当前栈（skill 0.7.32 + workflow 1.7.3）的校准数，供 Phase B–E 对照。

## Task 1：工程件 TDD（先红后绿）

- 红：3 测试文件加载失败（模块不存在）——vitest 3 failed。
- 绿：`pnpm exec vitest run` 全仓 **63 文件 474 测试全过**，`pnpm typecheck` 干净。
- 新增（全部纯逻辑零 IO，依赖注入风格对齐 watch-loop）：
  - `mat-core/src/portfolio.ts`——P1 manifest：相位只进不退（retry 走 resetForRetry
    记账）、JSON 往返严格校验、diffPortfolio 增量行（对齐 watch-loop readOutput 语义）。
  - `mat-core/src/contracts.ts`——P2 层间契约：prep/triage/interpret 三裁决手写校验
    （零依赖，不引 zod）；evidence ≤5 行×200 字符（日志污染的契约面）；
    extractJson 剥围栏；verdictToLines ≤10 行渲染。计划中的 `src/contracts/` 目录
    落成单文件 `src/contracts.ts`（与包内平铺风格一致）。
  - `mat-core/src/budget.ts`——P3 预算闸：maxSbatch/maxRetriesPerTask/maxCoreHours，
    check 纯查询、record sbatch 成功后记、checkThenRecord 原子；结构化拒绝非异常。
    **与 exec-gate 正交**（那是串行闸，这是预算闸）。工具入口接线推迟到 Phase B
    （需 manifest 路径约定，见计划 P3）。
- 测试：`test/portfolio.test.ts`（12）、`test/contracts.test.ts`（15）、`test/budget.test.ts`（8）。

## Task 1b：P4 角色档案 + 挂载

- `skills/batch-roles/SKILL.md`——三角色协议（prep/triage/analyst）：输入、纪律边界
  （门禁继承、破坏性命令禁令、不提交、不读大文件）、三个契约 JSON 的字段语义。
- `profiles/mat.yml` 新增：`tool-subagent` enable + 三角色实例
  （`subagent_prep`/`subagent_triage`/`subagent_analyst`，provider spawn，one-shot，
  toolFilter 白名单分别是 [skill,read,bash] / [skill,read,mat_exec] /
  [skill,read,bash,job_output]，agentOptions 一律 deepseek-v4-flash/8192）。
- `task1b-composed-dump-config.yml`：组合转印验证（角色行在位、tool-subagent
  disabled: false）。**待 V1 结束后重启服务生效**。

## Phase B 前核对项（本相位发现的待验证假设）

1. `agentOptions.provider: 'mat'` 的路由 id 语义——子 agent 创建是否接受该 provider 名
   （dump 只能验证组合，语义要实弹）。
2. toolFilter 运行时强制力（H8）。
3. 子 agent 会话对 batch-roles skill 的可见性（skill-filesystem customSkillDirs 对子
   agent 生效路径）。
