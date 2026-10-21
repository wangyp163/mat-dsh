# vasp-matstream-dsh M0（Spike 验证）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验证 DeepSeek Harness（0.1.0-rc.8）能以纯配置组合跑通 VASP 智能体的四块地基——HPC-MAX 模型路由、两个 streamable-http MCP、技能目录加载、会话持久化/并发——每项留下可复查的证据，最终产出 GO/PIVOT 决策。

**Architecture:** 不写产品代码。所有验证通过「patch overlay 文件 + `pnpm dsh --profile headless --patch <file> "<task>"`」完成，产物（overlay、脚本、结论）落进新仓库 `vasp-matstream-dsh`。设计依据：`docs/superpowers/specs/2026-08-21-vasp-matstream-dsh-refactor-design.md`。

**Tech Stack:** Node v22.22 + pnpm（本机已装）、deepseek-harness 源码克隆（`~/mat-harness/deepseek-harness`）、bash + jq。

**前置条件（人工）：** 需要拿到 4 个部署环境值：`UA_BASE_URL`、`UA_API_KEY`（HPC-MAX 网关）、`MAT_MCP_BASE_URL`、`MCP_API_KEY`（HPC MCP）。本机当前只有 `MAT_USER`。拿不到 UA_* 时走 Task 3 的 DEEPSEEK_API_KEY 降级路径（四问中 Q1 的 HPC-MAX 专属部分标记 PARTIAL）。

**事实基础（写计划前已核实）：**
- dsh CLI：`pnpm dsh` = `node --import tsx/esm apps/cli/src/bin.ts`，支持 `--profile`、`--patch`（`packages/boot/cmdline/src/index.ts:5`）
- patch 语法：既有行写 `- id: <row-id>` + `config:` 即整体替换该行 config；新行用 `- insert:` 列表（`packages/bundle/headless/cordis.patch.yml` 实例）
- base 层 `llm-pi-ai` 行默认休眠，配 `providers:` 即激活（`packages/bundle/base/cordis.patch.yml:95-97`）
- HPC-MAX（旧 `model.json`）：contextWindow 1000000，maxInputTokens 991000，reasoning true，input text+image，temperature 0 / top_p 0
- headless 退出码：末个 `turn/end` 完成 → 0，否则 1；最后一条非空 assistant 文本进 stdout，错误进 stderr
- 旧 5 个技能 frontmatter 均含 kebab-case `name` + `description`，符合 skill-filesystem 格式
- 会话持久化是 JSONL（`$DSH_HOME/sessions`），SQLite 仅作可选检索索引（默认 `:memory:` + `openAt: never`，不落盘）
- deepseek-harness 克隆当前**未** `pnpm install`（无 node_modules/lib）
- **真实运行需要 `pnpm run build:lib:host`**（Task 3 实测发现）：`--dump-config` 在完整插件树启动前退出故不触发；真跑 headless 时 typert-loader 需要生成的 `lib/typert.host.js`（226 包均不含，属构建产物）
- **证据纪律（Task 3 质量审查后立规）**：证据快照入仓库 `docs/evidence/`（勿放 /tmp，会被轮转清除）；失败尝试同样保留原始捕获；每次 patch 后用 dump-config 的 `# == ... patched by` 标记行确认行 id 命中（patch 引擎对未命中 id 只告警跳过，行 id 笔误会静默降级）

---

### Task 1: 安装并冒烟 dsh 克隆

**Files:** 无新建（只操作 `~/mat-harness/deepseek-harness`）

- [ ] **Step 1: 安装依赖**

```bash
cd ~/mat-harness/deepseek-harness && pnpm install
```

预期：成功结束，无 peer 冲突错误。若网络受限换镜像重试一次：`pnpm config set registry https://registry.npmmirror.com && pnpm install`。

- [ ] **Step 2: 无 key 冒烟——打印 headless 组合树**

```bash
cd ~/mat-harness/deepseek-harness && pnpm dsh --profile headless --dump-config
```

预期：YAML 列出全部插件行（含 `llm-pi-ai`、`skill-filesystem`、`agent-default-model`），退出码 0。若报缺 `lib/`，先 `pnpm run build` 再重试。

- [ ] **Step 3: 确认 CLI 旗标清单**

```bash
cd ~/mat-harness/deepseek-harness && pnpm dsh --help
```

预期：帮助文本含 `--profile` 与 `--patch`。记录输出到证据文件（Task 2 建立）。

### Task 2: 建立 vasp-matstream-dsh 仓库骨架与凭据文件

**Files:**
- Create: `~/mat-harness/vasp-matstream-dsh/`（git 仓库）
- Create: `profiles/spike.yml`（内容在 Task 3 Step 2 写入）
- Create: `env.example`、`env.local`（gitignored）
- Create: `docs/spike-results.md`（证据与结论累积处）
- Create: `.gitignore`

- [ ] **Step 1: 建骨架并初始化 git**

```bash
mkdir -p ~/mat-harness/vasp-matstream-dsh/{profiles,docs,scripts}
cd ~/mat-harness/vasp-matstream-dsh && git init
```

- [ ] **Step 2: 写 .gitignore 与 env.example**

`.gitignore` 内容：

```
env.local
node_modules/
```

`env.example` 内容（值从部署环境获取，`env.local` 是真实文件、绝不入库）：

```
# HPC-MAX OpenAI 兼容网关（旧仓库 src/llm/model.json providers.mat）
UA_BASE_URL=
UA_API_KEY=
# HPC 远程 shell MCP（旧仓库 agent.json mcp[0].servers.mat.url 的两段占位符）
MAT_MCP_BASE_URL=
MCP_API_KEY=
# 已在本机环境：MAT_USER
```

- [ ] **Step 3: 生成 env.local 并填入真实值**

```bash
cp env.example env.local
# 人工向 env.local 填入 4 个真实值（来源：旧 agent 部署环境）
```

- [ ] **Step 4: 建证据文档骨架**

`docs/spike-results.md` 初始内容：

```
# M0 Spike 结果（四问验证）

| # | 问题 | 判定（PASS/PARTIAL/FAIL） | 证据小节 |
|---|------|--------------------------|----------|
| Q1 | HPC-MAX 经 pi-ai：流式/reasoning/工具调用 | 待测 | §Q1 |
| Q2 | mcp-client 接 mat_remote_shell + optimade | 待测 | §Q2 |
| Q3 | 会话 JSONL 持久化、并发、容器 | 待测 | §Q3 |
| Q4 | skill-filesystem 加载 5 个旧技能 | 待测 | §Q4 |

## §Q1
（命令 + 观察逐条追加）

## §Q2
## §Q3
## §Q4
```

- [ ] **Step 5: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git add .gitignore env.example docs/spike-results.md && git commit -m "chore: M0 spike 仓库骨架与证据文档"
```

### Task 3: Q1a — HPC-MAX 路由激活与基本对话

**Files:**
- Create: `vasp-matstream-dsh/profiles/spike.yml`（patch overlay，随任务逐步长全）

- [ ] **Step 1: 写最小 overlay（仅模型路由）**

`profiles/spike.yml` 内容：

```yaml
# M0 Spike overlay：骑在 headless profile 之上（--patch）
- id: llm-pi-ai
  config:
    providers:
      mat:
        displayName: HPC
        apiKeyEnv: UA_API_KEY
        api: openai-completions
        baseURL: !!js process.env.UA_BASE_URL
        models:
          - id: HPC-MAX
            name: HPC-MAX
            contextWindow: 1000000
            maxTokens: 8192
            reasoningEfforts:
              off:
              high: high

- id: agent-default-model
  config:
    provider: mat
    model: HPC-MAX
```

- [ ] **Step 2: 校验组合树包含新路由**

```bash
cd ~/mat-harness/deepseek-harness && set -a && . ../vasp-matstream-dsh/env.local && set +a && pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml --dump-config
```

预期：`llm-pi-ai` 行的 config 出现 `mat` 路由；`agent-default-model` 行为 `provider: mat, model: HPC-MAX`。失败则按 stderr 修正 overlay（常见：`!!js` 必须双叹号）。

- [ ] **Step 3: 跑通第一轮真实对话**

```bash
cd ~/mat-harness/deepseek-harness && set -a && . ../vasp-matstream-dsh/env.local && set +a && pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml "用一句中文话确认你能听到我，并说出你的模型名。"
```

预期：stdout 打印一句中文回复；退出码 0。把 stdout/stderr 原文追加进 `docs/spike-results.md §Q1`。

- [ ] **Step 4:（降级路径，仅当 UA_* 拿不到）用 DEEPSEEK_API_KEY 验证同一条链**

把 overlay 中 mat 路由整段删掉，`agent-default-model` 改回 `provider: deepseek-official, model: deepseek-v4-flash`，`export DEEPSEEK_API_KEY=<key>` 后重跑 Step 2/3。预期同上；§Q1 记「HPC-MAX 专属项 PARTIAL：凭据未取得」。

- [ ] **Step 5: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git add profiles/spike.yml docs/spike-results.md && git commit -m "spike(Q1a): HPC-MAX pi-ai 路由激活，headless 基本对话通过"
```

### Task 4: Q1b — 流式细节、reasoning 透传、工具调用

**Files:** 无新建（读 `$DSH_HOME/sessions`）

- [ ] **Step 1: 跑一个必须调用工具的任务**

```bash
cd ~/mat-harness/deepseek-harness && set -a && . ../vasp-matstream-dsh/env.local && set +a && pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml "在当前目录创建文件 spike-probe.txt，内容为 hello-from-mat-max，然后读回来并原样告诉我内容。"
```

预期：stdout 复述 `hello-from-mat-max`；`spike-probe.txt` 出现在 cwd；退出码 0。这证明：工具调用闭环（bash/fs 工具）、多步 turn、结果回流。

- [ ] **Step 2: 从会话 JSONL 检查事件结构与 reasoning**

```bash
ls -t ~/.dsh/sessions | head -3          # 找到最新会话目录/文件
NEWEST=$(ls -td ~/.dsh/sessions/*/ | head -1); ls "$NEWEST"
jq -r 'select(.type != null) | .type' "$NEWEST"/*.jsonl 2>/dev/null | sort | uniq -c | sort -rn | head -15
```

预期：事件类型计数中出现 `assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`turn/start`、`turn/end`。再执行：

```bash
jq -c 'select(.type == "assistant/chunk")' "$NEWEST"/*.jsonl 2>/dev/null | head -20
```

判定记录进 §Q1：chunk 载荷里**是否出现 reasoning 类字段**（如 `reasoning`/`reasoning_content`）。出现 → reasoning 透传 PASS；不出现但模型有思考行为 → 记「HPC-MAX 经 pi-ai 不吐 reasoning 字段」，M1 需评估 compat.thinkingFormat 或自写薄 adapter。

- [ ] **Step 3: 记录与旧配置的参数差异**

在 §Q1 追加三行事实核对：① 旧栈显式 `temperature: 0, top_p: 0`；pi-ai 路由层无 temperature 字段，dsh 请求不显式携带 → 网关默认值生效，记录实际回复风格是否明显偏随机；② `maxTokens: 8192` 是本 spike 猜测值，旧栈未限制输出——M1 按 HPC 网关实际限额修正；③ 旧 `model.json` 声明 HPC-MAX 输入模态 text+image，overlay 未迁 `input:` 字段——纯文本 M0 无影响，M1 对齐清单收录（质量审查 2026-08-24 补充）。

- [ ] **Step 4: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git add docs/spike-results.md && git commit -m "spike(Q1b): 工具调用闭环与 reasoning 透传观察记录"
```

### Task 5: Q4 — 旧技能目录加载

**Files:**
- Modify: `vasp-matstream-dsh/profiles/spike.yml`（追加 skill-filesystem 覆盖行）

- [ ] **Step 1: overlay 追加技能根**

在 `profiles/spike.yml` 末尾追加（与既有行同缩进，作为新的列表项）：

```yaml
- id: skill-filesystem
  config:
    customSkillDirs:
      - ~/mat-harness/vasp-matstream-agent/skills
```

- [ ] **Step 2: 跑技能盘点任务**

```bash
cd ~/mat-harness/deepseek-harness && set -a && . ../vasp-matstream-dsh/env.local && set +a && pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml "用你的技能目录工具列出当前可用的技能（skill catalog），逐个给出名称与一句话描述。"
```

预期：输出包含 `matstream-calc`、`mat-command-executor`、`mat-job-manager`、`academic-research-skills`、`paper-workflow` 全部 5 个名字。缺哪个记哪个（skill-filesystem 对 frontmatter 违规技能是「告警并跳过」，stderr 可见原因）。

- [ ] **Step 3: 检查占位符语义**

```bash
grep -rn 'MAT_SANDBOX\|\${MAT_USER}\|\${HOME}' ~/mat-harness/vasp-matstream-agent/skills/*/SKILL.md | head -10
```

判定记录进 §Q4：SKILL.md 正文以纯文本进入模型上下文，`MAT_SANDBOX` 等环境变量名**按字面**呈现（旧栈同样不展开正文里的环境变量；`agent.json` 的 `${file:...}` 占位符只存在于 system_prompt 引用，不在技能里）——若 grep 证实正文只引用变量名而非期望展开值，则 Q4 无迁移障碍；列出所有被引用变量名供 M3 决定注入方式（如 system-prompt section）。

- [ ] **Step 4: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git add profiles/spike.yml docs/spike-results.md && git commit -m "spike(Q4): 5 个旧技能经 skill-filesystem 加载验证"
```

### Task 6: Q2 — 两个 MCP 接入

**Files:**
- Modify: `vasp-matstream-dsh/profiles/spike.yml`（追加两个 mcp-client 插入行）

- [ ] **Step 1: 先探活两个端点（与 dsh 无关的独立事实）**

```bash
set -a && . ~/mat-harness/vasp-matstream-dsh/env.local && set +a
curl -sS -o /dev/null -w 'mat remote shell MCP: %{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"spike","version":"0"}}}' "${MAT_MCP_BASE_URL}/mcp/${MCP_API_KEY}/7552849000000000000/mcp" || true
curl -sS -o /dev/null -w 'optimade MCP: %{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"spike","version":"0"}}}' 'https://c-2076488383597109249.ksai.example.internal:58043/mcp/' || true
```

预期：MCP over streamable-http 对 initialize 应回 200。**旧配置里这两个服务当前都标 `available: false`（ConnectError / 404）**——若仍不可达，Q2 判定只评估 dsh 侧的降级行为（Step 3 照跑），外部服务恢复后补测，并在结论文档单独立「外部阻塞项」。

（2026-08-24 决策：用户确认暂无法提供 MCP 凭据——`MAT_MCP_BASE_URL`/`MCP_API_KEY` 留空，mat remote shell 的 curl 探活跳过、overlay 里的 mat 行保留以实测 dsh 对不可达 MCP 的降级行为；optimade 探活无需凭据、照跑。Q2 按「dsh 侧 PASS + 外部阻塞：凭据与服务本体」记录，M1 前补测。）

- [ ] **Step 2: overlay 追加两个 MCP 行**

在 `profiles/spike.yml` 末尾追加：

```yaml
- insert:
    - id: mcp-mat-remote-shell
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: mat
        transport: streamable-http
        url: !!js '`${process.env.MAT_MCP_BASE_URL}/mcp/${process.env.MCP_API_KEY}/7552849000000000000/mcp`'
        toolCallTimeoutMs: 300000

    - id: mcp-optimade
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: optimade
        transport: streamable-http
        url: https://c-2076488383597109249.ksai.example.internal:58043/mcp/
```

- [ ] **Step 3: 跑 MCP 工具盘点任务**

```bash
cd ~/mat-harness/deepseek-harness && set -a && . ../vasp-matstream-dsh/env.local && set +a && pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml "列出你当前全部可用工具名，特别标出以 mcp__ 开头的工具。不要调用任何 mcp 工具。"
```

预期与判定（记入 §Q2）：
- 两 MCP 可达：输出含 `mcp__mat__*` 与 `mcp__optimade__*` 前缀工具名 → PASS。可选加测一次安全调用：`"用 optimade 工具检索 Si 的晶体结构，只报告找到几个候选，不要下载。"`
- MCP 不可达：进程**不崩**（`failOnStartupError` 默认 false），模型能列出非 MCP 工具且知道自己没有被 MCP 工具 → dsh 降级行为 PASS（记「外部阻塞：服务本体不可用」）。
- 进程崩溃或 stderr 出现未捕获异常 → FAIL，原样贴 stderr。

- [ ] **Step 4: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git add profiles/spike.yml docs/spike-results.md && git commit -m "spike(Q2): mcp-client 双服务接入与降级行为验证"
```

### Task 7: Q3 — 会话持久化、并发与容器冒烟

**Files:** 无新建

- [ ] **Step 1: 并发两会话互不干扰**

```bash
cd ~/mat-harness/deepseek-harness && set -a && . ../vasp-matstream-dsh/env.local && set +a && \
(pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml "记住暗号：阿尔法。只回复'已记住'。" > /tmp/s1.out 2>/tmp/s1.err & \
 pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml "记住暗号：贝塔。只回复'已记住'。" > /tmp/s2.out 2>/tmp/s2.err & \
 wait); echo "s1: $(cat /tmp/s1.out)"; echo "s2: $(cat /tmp/s2.out)"; head -5 /tmp/s1.err /tmp/s2.err
```

预期：两会话各自正常退出（0），stderr 为空或仅告警；`~/.dsh/sessions/--root-aiagent-mat-harness-deepseek-harness--/` 下新增两个 `session-<uuid>/` 目录（Task 4 已证实实际布局为「顶层按 cwd 分组、会话目录在第二层」，2026-08-24 修正）。

- [ ] **Step 2: 验证 JSONL 完整性（恢复的原料）**

```bash
# Task 4 修正：顶层按 cwd 分组，会话目录在第二层，唯一文件为 zstd 压缩——
# 原命令的两点假设（顶层即会话、裸 *.jsonl 可直接 jq）均不成立，会空输出/跨 cwd 误取。
GRP=~/.dsh/sessions/--root-aiagent-mat-harness-deepseek-harness--
for d in $(ls -td $GRP/session-*/ | head -2); do
  echo "== $d"; zstd -dc "$d/session.jsonl.zstd" | jq -r 'select(.type != null) | .type' | sort | uniq -c | sort -rn | head -8
done
```

预期：两个会话各有一套完整事件流（含 `user/message`、`assistant/*`、`turn/end`）。记入 §Q3：JSONL 位于 `$DSH_HOME/sessions`（每会话一个 `session.jsonl.zstd`，zstd 压缩、解压后每行一个事件），为副本故障恢复与 M1 会话投影的原料；SQLite 检索索引默认关闭（`session-query-sqlite` 行 `:memory:` + `openAt: never`），M1 需要全文检索时再开启并配持久化 path。

- [ ] **Step 3: 容器冒烟（可 DEFERRED）**

先查 docker 可用性（`docker --version && docker info >/dev/null && echo OK`）；不可用直接记 DEFERRED。

```bash
docker run --rm -v ~/mat-harness:/w:ro \
  -e UA_BASE_URL -e UA_API_KEY node:22-bookworm bash -lc '
    mkdir /app && tar -C /w --exclude=node_modules -cf - . | tar -C /app -xf - &&
    cd /app/deepseek-harness && corepack enable &&
    pnpm install --frozen-lockfile 2>&1 | tail -1 &&
    pnpm run build:lib:host 2>&1 | tail -1 &&
    pnpm dsh --profile headless --patch ../vasp-matstream-dsh/profiles/spike.yml "回复 ok 两个字母即可。"'
```

（2026-08-24 修正：原命令 `-v ...:/w` 可写挂载 + 容器内 `pnpm install` 会重写宿主克隆的 node_modules——跨设备硬链接降级为拷贝、bookworm glibc 产物污染宿主环境。改为只读挂载 + 容器内 scratch 拷贝（tar 排除 node_modules），宿主克隆零接触。容器内 install+build 约需数分钟。）

预期：容器内输出版 `ok`，且宿主 `git -C ~/mat-harness/deepseek-harness status --short` 仍干净、宿主 `pnpm dsh --version` 仍可用。若本机无 docker 或网络受限，在 §Q3 标 `DEFERRED（原因）`——不阻塞 GO 判定，但 M1 前必须补。

- [ ] **Step 4: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git add docs/spike-results.md && git commit -m "spike(Q3): 并发会话、JSONL 完整性与容器冒烟"
```

### Task 8: 汇总结论与 GO/PIVOT 决策

**Files:**
- Modify: `vasp-matstream-dsh/docs/spike-results.md`（判定表收口 + 决策段）

- [ ] **Step 1: 收口判定表**

`docs/spike-results.md` 顶部表格每行填 PASS/PARTIAL/FAIL（以各小节命令输出为据），表下新增：

```
## 决策

- GO 判据：Q1 至少 PARTIAL（降级路径跑通且 HPC-MAX 阻塞仅因凭据）、Q4 PASS、Q2 至少「dsh 侧降级 PASS」、Q3 无 FAIL。
- 结论：GO / PIVOT-B（转绞杀者混合：dsh 经 Python SDK 子进程）/ PIVOT-C（不迁移只借模式）。
- 遗留问题清单（带去向里程碑）：reasoning 透传 → M1；temperature/args 对齐 → M1；MCP 外部可用性 → 平台侧推动 + M1 补测；容器冒烟（若 DEFERRED）→ M1 前。
```

- [ ] **Step 2: 向用户汇报并取得决策确认**（人工关卡：结论与决策表须用户过目）

- [ ] **Step 3: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git add docs/spike-results.md && git commit -m "spike: 四问结论收口与 GO/PIVOT 决策"
```

---

## 自审记录

- **Spec 覆盖**：设计文档 §11 四问 ↔ Task 3/4（Q1）、Task 6（Q2）、Task 7（Q3）、Task 5（Q4）；§9 M0 出口（「Spike 四问全绿」）↔ Task 8 判定表；退路（PIVOT-B/C）↔ Task 8 决策段。M1-M5 不在本计划范围（按设计 §9 各自另立计划）。
- **占位符扫描**：所有命令、overlay、文件内容均为完整可执行文本；唯一外部依赖（4 个凭据值）在计划头部「前置条件」显式声明并有 Task 3 Step 4 降级路径。
- **类型/命名一致性**：overlay 中行 id（`llm-pi-ai`、`agent-default-model`、`skill-filesystem`）与 base bundle 现有行 id 一一对应；mcp 插入行字段名取自 `dsh-mcp-client` README 配置表。
