# vasp-matstream-dsh M1 契约层（gateway MVP）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ 2026-08-25 已知环境限制：subagent 派发当前报 API 400（modelCode 不存在）。若仍不可用，执行选 Inline（superpowers:executing-plans）。

**Goal:** 在 `vasp-matstream-dsh` 实现自研 cordis 插件 `platform-gateway`，复刻旧栈平台 HTTP/SSE 契约（SSE chat + 会话 + 上传 + stop + health），并以契约回放测试证明投影输出与旧栈 SSE 流**语义等价**（设计文档 §9 M1 出口判据）。

**Architecture:** 独立 pnpm 仓库消费 npm 上已发布的 `@deepseek-ai/*@0.1.0-rc.8`（harness 克隆只读留作参照，不链接）。核心是一台**纯投影状态机**（dsh `SessionEvent[]` → 旧栈 SSE wire 行），HTTP 层是薄 transport（node:http + busboy），插件 `apply()` 负责装配（agent 生命周期、`session/event` 订阅、temperature 注入）。契约回放测试把手工编写的 dsh 事件日志喂给投影机，与旧栈实录 SSE fixture 做归一化等价断言。

**Tech Stack:** TypeScript（ESM、strict、相对导入带 `.ts` 后缀，经 tsx 加载）、Node ≥22.19（本机 22.22.0 ✓）、pnpm 10（本机 10.33.0 ✓）、vitest、`@deepseek-ai/*@0.1.0-rc.8` 全部精确 pin、`@deepseek-ai/cordis@4.0.1`、`@deepseek-ai/schemastery@3.18.1`、busboy。

---

## 0. 事实基线（执行者必读 —— 所有契约均从源码逐字提取）

### 0.1 旧栈 SSE wire 格式（`vasp-matstream-agent/src/api/routes/chat.py`）

帧格式（chat.py:86-88 `_sse_json`）：每事件一行 `data: {json}\n\n`，`json.dumps(..., ensure_ascii=False)`（即 UTF-8 原文，不转义非 ASCII），**每个 payload 末尾合并 `conversationId` 字段**。流结尾哨兵 `data: [DONE]\n\n`。SSE 响应头（chat.py:865-869）：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`。

事件全集（type → 字段，{}内为构造点行号）：

| type | 字段 | 行号 |
|---|---|---|
| `start` | `messageId`（`asst_{uuid4().hex}`，:293）、`time`（**用户请求时间**归一化，非服务器时钟）、`debugTrace?` | 449 |
| `text-start` | `id`（`text_N`） | 489/641 |
| `text-delta` | `id`、`delta` | 489/646 |
| `text-end` | `id`、`prompt_tokens?`、`completion_tokens?`、`total_tokens?`（usage 合并进 text-end payload） | 381 |
| `reasoning-start` | `id`（`reasoning_N`） | 621 |
| `reasoning-delta` | `id`、`delta` | 624 |
| `reasoning-end` | `id` | 372 |
| `tool-input-start` | `toolCallId`、`toolName` | 405 |
| `tool-input-delta` | `toolCallId`、`inputTextDelta` | 421 |
| `tool-input-available` | `toolCallId`、`toolName`、`input`（**已 JSON.parse 的对象**，解析失败保留字符串）、`toolCallDescription?` | 437 |
| `tool-output-available` | `toolCallId`、`toolName`、`output`（**字符串**） | 552/788 |
| `error` | `errorText` | 751/797/806 |
| `finish` | `finishReason` | 836 |

关键顺序语义：
- reasoning 开始前关 text（:612-616）；text 开始前关 reasoning（:633-635）；工具消息到达前关 reasoning 再关 text（:512-517）。
- **usage 进最后一个 text-end**：`serialize_usage` 产出 `{prompt_tokens, completion_tokens, total_tokens}`（chat_stream.py:26-39，total 缺失时 = prompt+completion）。
- `finishReason` 初值 `"stop"`（:313），可被模型 response_metadata 覆盖（:702）或工具 handoff 覆盖（:523）。
- **stop/取消：静默断流**。CancelledError 路径（:715-744）`return`，**无 finish、无 error、无 [DONE]**。
- 错误路径：普通错误 `error` + `[DONE]`（:806-807）；工具失败 → `tool-output-available`（错误文本作 output）+ `error`（`"Tool {name} ({id}) failed: {text}"`）+ `[DONE]`（:786-807）。
- 分片 id 分配（`utils/stream_part_ids.py`）：`{kind}_{N}`，N 从 1 起，每 (user, conversation, kind) 独立计数；进程内单调递增，冷启动种子 = 扫描持久化会话消息里 assistant 记录 id 的最大 N。
- 上传/预览/资源卡片附加事件（preview-file 等 :559-595）：**M1 不投影**（迁移矩阵 M2/M3 行）。

### 0.2 旧栈 HTTP 面（挂载前缀 `/api`，router 前缀 `/user/agent`）

| 方法+路径 | 请求 | 成功响应 |
|---|---|---|
| POST `/api/user/agent/chat` | JSON `{conversationId, messages:[{role, content}], time?, context:{userId, efile?, oss?, cards?}}`（model.py:85-101；userId 必填，conversationId 别名兼容 snake/camel） | SSE 流（上述头） |
| POST `/api/user/agent/stop` | JSON `{conversationId}` | `{"code":0,"msg":"success","data":{"status":"stopped"\|"stop_requested"}}`（chat.py:890-891） |
| GET `/api/user/agent/sessions?userId=` | query | `{"code":0,"msg":"success","data":[{conversationId,createAt,updatedAt,title,messageCount}]}`（按文件 mtime 降序，session_store.py:421-447） |
| GET `/api/user/agent/sessions/{id}?userId=` | query | `{"code":0,"msg":"success","data":<session>}`；不存在 `{"code":1,"msg":"conversation not found","data":null}` |
| DELETE `/api/user/agent/sessions/{id}?userId=` | query | `{"code":0,...,"data":{"deleted":true}}`；不存在 code 1 |
| POST `/api/user/agent/files` | multipart form：`conversationId` + `file` | `{"code":0,"msg":"success","data":{name,path,clusterId:"",type(小写扩展名),size(十进制字符串),content:""}}`（general.py:333-357） |
| GET `/api/user/agent/health` | — | `{"code":0,"msg":"success","data":{"status":"ok"}}` |
| GET `/config`、PUT `/config` | — | **M1 不实现**（设计 §9 M1 范围外；返回 code 1 占位） |

会话记录形状（session_store.py:52-59）：`{userId, conversationId, createAt, updatedAt, title, messages:[...]}`，时间戳为上海时区 ISO 毫秒（`+08:00`）。消息四种：
- user：`{role:"user", text, time, files?}`
- reasoning：`{role:"assistant", id, type:"reasoning", reasoning}`
- text：`{role:"assistant", id, type:"text", text}`
- tool：`{role:"assistant", type:"tool", tool:{toolCallId, name, input(已解析), output}}`（chat_stream.py:180-201 `serialize_tool_records`）

标题：默认 `"New conversation"`；首条用户消息后回填 `_title_from_user` = 空白归一并截 40 字符（session_store.py:110-114, 260-261）。（旧栈另有 LLM 生成标题 :280-285 —— **M1 只做回填**，LLM 标题记 M2。）

校验规则：userId 与 conversationId 均须匹配 `^[A-Za-z0-9._-]+$`（workspace.py:8-9）。上传文件名：取 basename、非法字符换 `_`、去首尾 `._`、空则 `"upload"`；重名加 `_1.._999` 后缀（general.py:30-50）。`time` 归一化：空/非法 → 上海当前时间 `%Y-%m-%d %H:%M:%S`（session_store.py:130-142）。

### 0.3 dsh 侧输入词汇（投影机的输入，全部已从 rc.8 源码核实）

- 事件订阅：根上下文 `ctx.on('session/event', (session, event) => ...)`（post-commit、fire-and-forget、根监听收全部 session）。`ctx.get('sessions').flush(session)` 为持久化检查点。`session.id` 即 `SessionId`。
- `SessionEventMap`（`@deepseek-ai/dsh-session`）：`turn/start{turn}`、`turn/end{turn,reason}`、`step/start`、`step/end`、`user/message`、`assistant/chunk{turn,step,chunk}`、`assistant/message{turn,step,message,usage?,interrupted?}`、`tool/call{turn,step,callId,name,arguments(JSON字符串)}`、`tool/result{turn,step,message,error?,meta?}`、`request/header`、`todo/write` 等。事件信封 `{type, seq, time, data}`。
- `StreamChunk`（`@deepseek-ai/dsh-llm` types.ts:312-324，判别字段 `type`）：`block-start{index,blockType}` / `text-delta{index,text}` / `reasoning-delta{index,text}` / `tool-call-delta{index,id,name?,argumentsDelta}` / `block-end{index,block}` / `usage{usage}` / `finish{reason,replayState?}`。`TokenUsage{inputTokens,outputTokens,cacheReadTokens?,cacheWriteTokens?,reasoningTokens?}`。
- `ToolResultMessage.source = {kind:'tool', callId}`；content 为 `[ToolResultBlock]`，block.content 是文本/图片块数组（output 取文本块 join）。
- agent 驱动（headless runner 原样模式，packages/bundle/headless/src/index.ts:107-127）：
  ```ts
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')!, defaultModel = ctx.get('agentDefaultModel')!, sessions = ctx.get('sessions')!
  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: SessionId(`chat-${conversationId}`),
    meta: { cwd: config.workspaceRoot },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => { installModelSelection(agentCtx, { current: selection, assembled: undefined }) },
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle(); await sessions.flush(agent.session)
  ```
  `agent.cancel({kind:'user'})` 中止活动 turn；`agent.status` `'idle'|'running'`。
- **temperature 无 AgentOptions 字段**（runtime-types.ts:24-31 只有 provider/model/maxTokens）；唯一注入口是 `agent/request` waterfall（waterfall 必须调 `next()`，返回替换配置）：
  ```ts
  ctx.on('agent/request', async (payload, next) => {
    const base = await next()
    return config.temperature === undefined ? base : { ...base, temperature: config.temperature }
  })
  ```
- boot：`boot(binName, absoluteConfigPath)` from `@deepseek-ai/dsh-app-boot`；**相对插件名从配置文件旁解析**（profiles/ 里的 `../packages/...`），裸包名从仓库 node_modules 解析；`ctx.baseUrl` = 配置文件目录。bin 模板仿 jsonrpc-demo runner（DSH_CORDIS_CONFIG env 优先于 argv[2]；stdin end→exit 0；SIGTERM→0；SIGINT→130）。
- 组合模板 = `examples/jsonrpc-agent/cordis.yml`（已逐行核实），llm 层换成 spike.yml 已验证的 mat provider。

### 0.4 已定决策与显式分歧（记入代码注释与 PROVENANCE）

1. **`cancelled` 事件为设计 §6.2 明定的新增行为**：旧栈 stop 是静默断流（0.1 节）。M1 在用户 stop 时发 `{"type":"cancelled"}` + `[DONE]`。回放比较器把旧栈「无 finish 无 [DONE] 的截断」与新栈「cancelled+[DONE]」视为等价终态。
2. LLM 生成会话标题 → M2（M1 回填 40 字符标题）。
3. `toolCallDescription`（旧栈从 arguments 尾部注释拆出）→ M1 不产出（旧 wire 本就是可选字段）。
4. preview-file/folder/assets、job-monitor、资源卡片事件 → M2/M3。
5. 上传文件的 system-prompt 注入（prompt_context 中间件）→ M2；M1 只落盘 + 返回记录。
6. 同会话并发 chat：M1 返回 HTTP 409 `{"code":1,"msg":"conversation busy","data":null}`（旧栈未防护；前端本就串行）。
7. **DSH_HOME 隔离**（M0 教训：用户级 `~/.dsh/settings.yaml` 的 matx 会静默顶掉 profile 路由）：bin 在 boot 前设 `DSH_HOME=<repo>/run/dsh-home`（env 已设则尊重）；启动后打印 `agentDefaultModel.currentSelection()`，路由必须显式可见。
8. provider 命名统一 `mat`（matx 不再出现）。
9. `maxTokens: 8192` 沿用 spike 猜测值（已验证可跑）；HPC 网关限额文档到位后修正。
10. bash 超时 120000ms（对齐旧 shell backend 默认，旧 CLAUDE.md）。
11. persona：M1 用最小占位系统提示（`DSH_SYSTEM_PROMPT` env 可覆盖）；旧栈完整提示迁移属 M2/M3 提示组装。

### 0.5 投影映射表（project.ts 的规格）

| dsh 输入 | 动作（SSE 输出 + 会话记录） |
|---|---|
| 流开始（chat 请求受理） | `start{messageId,time}` |
| chunk `block-start{text}` | 若 reasoning 开 → `reasoning-end`；分配 `text_N`，`text-start` |
| chunk `text-delta` | `text-delta{id,text}` |
| chunk `block-start{reasoning}` | 若 text 开 → `text-end`；分配 `reasoning_N`，`reasoning-start` |
| chunk `reasoning-delta` | `reasoning-delta{id,text}` |
| chunk `tool-call-delta`（新 id） | 若 text/reasoning 开先关；`tool-input-start{toolCallId:id, toolName:name ?? ''}` |
| chunk `tool-call-delta`（续） | `tool-input-delta{toolCallId, inputTextDelta}` |
| chunk `usage` | 暂存 usage（映射 inputTokens→prompt_tokens、outputTokens→completion_tokens、total=两者和） |
| chunk `block-end{text块}` | `text-end{id,+暂存usage}`，清 usage 暂存与文本缓冲；记录 `{role:assistant,id,type:text,text}` |
| chunk `block-end{reasoning块}` | `reasoning-end{id}`；记录 `{role:assistant,id,type:reasoning,reasoning}` |
| `tool/call` | `tool-input-available{toolCallId,name,input:JSON.parse(arguments)}`（解析失败保留字符串） |
| `tool/result` | 关开着的 text/reasoning；output=文本块 join（有 `error` 时 output=`{error.code}: {error.message}`）；`tool-output-available`；记录 `{role:assistant,type:tool,tool:{toolCallId,name,input,output}}` |
| `turn/end{completed}` | 关开着的部分；`finish{finishReason:"stop"}`；`[DONE]`；终态 |
| `turn/end{max-tokens}` | `finish{finishReason:"length"}`；`[DONE]` |
| `turn/end{blocked}` | `finish{finishReason:"stop"}`；`[DONE]`（M1 简化，注释标注） |
| `turn/end{error{error}}` | `error{errorText:error.message}`；`[DONE]` |
| `turn/end{aborted\|interrupted\|legacy}` | `cancelled`；`[DONE]`（分歧 1） |
| 其余事件 | 不产出 SSE（turn/start、step/*、user/message、request/*、todo/write、assistant/message 只用于记录兜底） |

---

## 文件结构（先定分解，再定任务）

```
vasp-matstream-dsh/
├── package.json                    # 根：全部 @deepseek-ai/* 精确 pin + dev 工具链
├── pnpm-workspace.yaml             # packages/* + apps/*
├── tsconfig.base.json / tsconfig.json
├── vitest.config.ts
├── packages/platform-gateway/
│   ├── package.json
│   └── src/
│       ├── events.ts               # 平台 SSE 事件类型 + 帧序列化（wire 契约）
│       ├── part-ids.ts             # text_N/reasoning_N 会话级分配器（种子扫描）
│       ├── project.ts              # 投影状态机（纯核心，无 IO）
│       ├── conversation.ts         # 会话记录形状 + JSON 存取 + 标题回填 + 时间工具
│       ├── core.ts                 # GatewayCore：agent 缓存/创建、活跃流注册表、事件分发、stop
│       ├── http.ts                 # node:http 路由 + SSE 写出 + busboy multipart（薄 transport）
│       └── index.ts                # cordis 插件（name/inject/Config/apply）
├── apps/gateway/
│   ├── package.json
│   └── src/bin.ts                  # boot bin（DSH_HOME 隔离 + 失败即崩 + 信号处理）
├── profiles/gateway.cordis.yml     # 组合（jsonrpc-agent 模板 + mat provider + 本插件）
├── tests/contract/
│   ├── fixtures/PROVENANCE.md      # fixture 来源与分歧记录
│   ├── fixtures/old/*.sse          # 旧栈实录（或降级手写，见 PROVENANCE 标注）
│   ├── fixtures/dsh/*.json         # 手写 dsh SessionEvent[]（与旧 fixture 文本逐字对齐）
│   └── replay.spec.ts              # 归一化等价断言
└── docs/evidence/m1-*.txt          # 证据归档
```

单测放 `packages/platform-gateway/test/*.spec.ts`（vitest 根配置收进来）。

---

### Task 1: 仓库脚手架

**Files:**
- Create: `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.json`、`vitest.config.ts`、`packages/platform-gateway/package.json`、`apps/gateway/package.json`、`packages/platform-gateway/test/hello.spec.ts`

- [ ] **Step 1.1: 建分支**

```bash
cd ~/mat-harness/vasp-matstream-dsh && git checkout -b m1-contract
```

- [ ] **Step 2.1: 写根 `package.json`**

```json
{
  "name": "vasp-matstream-dsh",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "gateway": "node --import tsx/esm apps/gateway/src/bin.ts"
  },
  "dependencies": {
    "@deepseek-ai/cordis": "4.0.1",
    "@deepseek-ai/cordis-plugin-group": "^1.0.1",
    "@deepseek-ai/cordis-plugin-include": "^1.0.6",
    "@deepseek-ai/cordis-plugin-loader": "^1.0.2",
    "@deepseek-ai/cordis-plugin-hmr": "^1.0.16",
    "@deepseek-ai/cordis-plugin-timer": "1.1.3",
    "@deepseek-ai/schemastery": "3.18.1",
    "@deepseek-ai/dsh-app-boot": "0.1.0-rc.8",
    "@deepseek-ai/dsh-launch-environment": "0.1.0-rc.8",
    "@deepseek-ai/dsh-invariants": "0.1.0-rc.8",
    "@deepseek-ai/dsh-home-paths": "0.1.0-rc.8",
    "@deepseek-ai/dsh-system-prompt": "0.1.0-rc.8",
    "@deepseek-ai/dsh-llm": "0.1.0-rc.8",
    "@deepseek-ai/dsh-session": "0.1.0-rc.8",
    "@deepseek-ai/dsh-agent": "0.1.0-rc.8",
    "@deepseek-ai/dsh-agent-default-model": "0.1.0-rc.8",
    "@deepseek-ai/dsh-agent-spine-demo": "0.1.0-rc.8",
    "@deepseek-ai/dsh-llm-pi-ai": "0.1.0-rc.8",
    "@deepseek-ai/dsh-session-persistence-jsonl": "0.1.0-rc.8",
    "@deepseek-ai/dsh-session-checkpoint-policy": "0.1.0-rc.8",
    "@deepseek-ai/dsh-subagent": "0.1.0-rc.8",
    "@deepseek-ai/dsh-subagent-spawn-in-process": "0.1.0-rc.8",
    "@deepseek-ai/dsh-tool-subagent": "0.1.0-rc.8",
    "@deepseek-ai/dsh-tool-todo": "0.1.0-rc.8",
    "@deepseek-ai/dsh-subprocess-local": "0.1.0-rc.8",
    "@deepseek-ai/dsh-bash-local": "0.1.0-rc.8",
    "@deepseek-ai/dsh-fs-local": "0.1.0-rc.8",
    "@deepseek-ai/dsh-fs-observation-policy": "0.1.0-rc.8",
    "@deepseek-ai/dsh-tool-fs": "0.1.0-rc.8",
    "@deepseek-ai/dsh-token-meter": "0.1.0-rc.8",
    "@deepseek-ai/dsh-compaction-basic": "0.1.0-rc.8",
    "@deepseek-ai/dsh-mcp-client": "0.1.0-rc.8",
    "js-yaml": "^4.2.0",
    "busboy": "^1.6.0"
  },
  "devDependencies": {
    "@types/busboy": "^1.5.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

（dsh rc.8 精确 pin + app-boot 的 peer 全显式声明，pnpm store 去重保证单实例。）

- [ ] **Step 2.2: `pnpm-workspace.yaml`**

```yaml
packages:
  - packages/*
  - apps/*
```

- [ ] **Step 2.3: `tsconfig.base.json` + 根 `tsconfig.json`**

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

```jsonc
// tsconfig.json
{
  "extends": "./tsconfig.base.json",
  "include": ["packages/**/*.ts", "apps/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 2.4: `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/*.spec.ts', 'tests/contract/*.spec.ts'],
    testTimeout: 30000,
  },
})
```

- [ ] **Step 2.5: `packages/platform-gateway/package.json`**

```json
{
  "name": "@vasp/platform-gateway",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@deepseek-ai/cordis": "4.0.1",
    "@deepseek-ai/schemastery": "3.18.1",
    "@deepseek-ai/dsh-llm": "0.1.0-rc.8",
    "@deepseek-ai/dsh-session": "0.1.0-rc.8",
    "@deepseek-ai/dsh-agent": "0.1.0-rc.8",
    "busboy": "^1.6.0"
  }
}
```

- [ ] **Step 2.6: `apps/gateway/package.json`**

```json
{
  "name": "@vasp/gateway-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@deepseek-ai/dsh-app-boot": "0.1.0-rc.8",
    "@vasp/platform-gateway": "workspace:*"
  }
}
```

- [ ] **Step 2.7: 冒烟单测 `packages/platform-gateway/test/hello.spec.ts`**

```ts
import { describe, expect, it } from 'vitest'

describe('scaffold', () => {
  it('vitest runs', () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 3: 安装并验证**

```bash
cd ~/mat-harness/vasp-matstream-dsh
pnpm install
pnpm test
```

Expected: `Test Files  1 passed (1)`；无 peer 警告缺失 `@deepseek-ai/*`（有则补根依赖）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(m1): scaffold pnpm workspace with pinned dsh rc.8 deps

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 旧栈 SSE fixture 实录（契约回放的旧侧真值）

**Files:**
- Create: `tests/contract/fixtures/old/text-only.sse`、`reasoning-text.sse`、`tool-round.sse`
- Create: `tests/contract/fixtures/PROVENANCE.md`

设计 §8.1「旧 SSE fixture」照字面执行：**能实录就实录**；实录失败才降级手写，且 PROVENANCE 必须如实标注。

- [ ] **Step 1: 检查旧栈可启动性**

```bash
cd ~/mat-harness/vasp-matstream-agent
uv sync 2>&1 | tail -3; echo "EXIT=${PIPESTATUS[0]}"
rg -n "UA_BASE_URL|UA_API_KEY|UA_MODEL" src/llm/model.json | head
```

Expected: `EXIT=0`；model.json 显示 env 占位符名。对照 `vasp-matstream-dsh/env.local`（**不打印值**）确认变量名一致；不一致则在启动前 `export UA_<OLD_NAME>="$UA_BASE_URL"` 适配（只在 shell 里做，不写文件）。

- [ ] **Step 2: 启动旧栈并实录三条流**

```bash
cd ~/mat-harness/vasp-matstream-agent
set -a && . ../vasp-matstream-dsh/env.local && set +a
uv run python server.py --port 8010 > /tmp/old-server.log 2>&1 &
sleep 8 && curl -s http://127.0.0.1:8010/api/user/agent/health; echo " EXIT=$?"
```

Expected: `{"code":0,...,"data":{"status":"ok"}}`、`EXIT=0`。失败 → 跳到 Step 4 降级。

三条实录（`FIX=~/mat-harness/vasp-matstream-dsh/tests/contract/fixtures`，会话 id 每条不同）：

```bash
curl -sN -X POST http://127.0.0.1:8010/api/user/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"fix-text-01","messages":[{"role":"user","content":"用一句话回答：1+1等于几？"}],"time":"2026-08-25 10:00:00","context":{"userId":"fixture"}}' \
  > $FIX/old/text-only.sse; echo "EXIT=$?"
```

- `reasoning-text.sse`：conversationId `fix-rt-01`，内容 `"先思考再回答：9.11 和 9.9 哪个大？"`（触发 reasoning + text）。
- `tool-round.sse`：conversationId `fix-tool-01`，内容 `"列出当前目录下的文件"`（触发 shell 工具轮 + 二段文本）。

每条后检查：`grep -c '^data:' <file>` ≥ 3 且 `tail -1 <file>` 为 `data: [DONE]` 空行结尾。

- [ ] **Step 3: 停服并写 PROVENANCE**

```bash
kill %1 2>/dev/null; rg -c '^data:' $FIX/old/*.sse
```

`PROVENANCE.md` 记录：实录命令全文、日期、旧栈 git rev（`git -C .. rev-parse HEAD`，在 vasp-matstream-agent 下）、每条流的会话 id。

- [ ] **Step 4（条件降级，仅在 Step 2 失败）: 手写 fixture**

按 §0.1 表逐字段手写三条 `.sse` 文件，**每个事件上方加 `# chat.py:<行号>` 注释行**（SSE 允许注释行，解析器须跳过 `:` 前缀非 `data` 的行——回放解析器 Task 10 实现这一点）。PROVENANCE 标注「手写降级 + 待实录重采」，并在交付报告中明确告知用户。

- [ ] **Step 5: Commit**

```bash
cd ~/mat-harness/vasp-matstream-dsh
git add tests/contract/fixtures && git commit -m "test(m1): record old-stack SSE fixtures for contract replay

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: events.ts — SSE 事件类型与帧序列化

**Files:**
- Create: `packages/platform-gateway/src/events.ts`
- Test: `packages/platform-gateway/test/events.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { SSE_DONE, sseFrame } from '../src/events.ts'

describe('sseFrame', () => {
  it('frames an event with conversationId merged last', () => {
    expect(sseFrame({ type: 'text-start', id: 'text_1' }, 'c1'))
      .toBe('data: {"type":"text-start","id":"text_1","conversationId":"c1"}\n\n')
  })
  it('keeps non-ASCII literal (ensure_ascii=False parity)', () => {
    expect(sseFrame({ type: 'text-delta', id: 'text_1', delta: '你好' }, 'c1'))
      .toBe('data: {"type":"text-delta","id":"text_1","delta":"你好","conversationId":"c1"}\n\n')
  })
  it('usage fields sit inside text-end', () => {
    expect(sseFrame({ type: 'text-end', id: 'text_1', prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }, 'c1'))
      .toBe('data: {"type":"text-end","id":"text_1","prompt_tokens":3,"completion_tokens":5,"total_tokens":8,"conversationId":"c1"}\n\n')
  })
  it('DONE sentinel', () => { expect(SSE_DONE).toBe('data: [DONE]\n\n') })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/platform-gateway/test/events.spec.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

```ts
/** 平台 SSE 事件载荷 —— 旧栈 wire 契约（chat.py 提取，见 M1 计划 §0.1）。 */
export type PlatformSseEvent =
  | { type: 'start'; messageId: string; time: string; debugTrace?: { traceId: string; path: string } }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-output-available'; toolCallId: string; toolName: string; output: string }
  | { type: 'error'; errorText: string }
  /** 设计 §6.2 新增：旧栈 stop 为静默断流，本事件是唯一有意分歧（计划 §0.4-1）。 */
  | { type: 'cancelled' }
  | { type: 'finish'; finishReason: string }

/** 序列化一帧：conversationId 合并在末尾（对齐 _sse_json 的 {**payload, conversationId}）。 */
export function sseFrame(event: PlatformSseEvent, conversationId: string): string {
  return `data: ${JSON.stringify({ ...event, conversationId })}\n\n`
}

/** 流终止哨兵。 */
export const SSE_DONE = 'data: [DONE]\n\n'
```

- [ ] **Step 4: 跑测试确认通过** → `pnpm vitest run packages/platform-gateway/test/events.spec.ts` PASS

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(m1): platform SSE event wire types"`

---

### Task 4: part-ids.ts — 分片 id 分配器

**Files:**
- Create: `packages/platform-gateway/src/part-ids.ts`
- Test: `packages/platform-gateway/test/part-ids.spec.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { createPartIdAllocator, seedFromMessages } from '../src/part-ids.ts'

describe('part id allocator', () => {
  it('allocates text_1.. text_2 and independent reasoning counters', () => {
    const a = createPartIdAllocator({ text: 0, reasoning: 0 })
    expect(a.next('text')).toBe('text_1')
    expect(a.next('text')).toBe('text_2')
    expect(a.next('reasoning')).toBe('reasoning_1')
  })
  it('seeds from persisted assistant records', () => {
    const seed = seedFromMessages([
      { role: 'user', text: 'q', time: '2026-08-25 10:00:00' },
      { role: 'assistant', id: 'text_2', type: 'text', text: 'a' },
      { role: 'assistant', id: 'reasoning_5', type: 'reasoning', reasoning: 'r' },
      { role: 'assistant', type: 'tool', tool: { toolCallId: 't', name: 'n', input: {}, output: 'o' } },
    ] as never[])
    expect(seed).toEqual({ text: 2, reasoning: 5 })
  })
  it('empty history seeds zero', () => {
    expect(seedFromMessages([])).toEqual({ text: 0, reasoning: 0 })
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**（类型从 conversation.ts 前向声明 —— 本任务先定义最小本地类型，Task 6 换成正式导入）

```ts
/** 分片种类（旧栈 next_stream_part_id 的 part_type 全集）。 */
export type PartKind = 'text' | 'reasoning'

/** 旧栈 stream_part_ids.py 语义：每 (会话, kind) 独立单调计数，冷启动由持久化记录播种。 */
export interface PartIdAllocator {
  next(kind: PartKind): string
}

/** 扫描会话消息，取各 kind 已用的最大下标（对齐 max_session_part_index）。 */
export function seedFromMessages(messages: readonly unknown[]): { text: number; reasoning: number } {
  const max = { text: 0, reasoning: 0 }
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const record = message as { role?: unknown; id?: unknown }
    if (record.role !== 'assistant' || typeof record.id !== 'string') continue
    for (const kind of ['text', 'reasoning'] as const) {
      if (!record.id.startsWith(`${kind}_`)) continue
      const suffix = record.id.slice(kind.length + 1)
      if (/^\d+$/.test(suffix)) max[kind] = Math.max(max[kind], Number(suffix))
    }
  }
  return max
}

/** 创建分配器（进程内单调；跨进程连续性由 seed 保证）。 */
export function createPartIdAllocator(seed: { text: number; reasoning: number }): PartIdAllocator {
  const counters = { ...seed }
  return {
    next(kind: PartKind): string {
      counters[kind] += 1
      return `${kind}_${counters[kind]}`
    },
  }
}
```

- [ ] **Step 4: 确认通过** → `pnpm vitest run packages/platform-gateway/test/part-ids.spec.ts` PASS（测试里 `as never[]` 去掉，改 `as unknown[]`）

- [ ] **Step 5: Commit** `git commit -am "feat(m1): conversation-scoped SSE part id allocator"`

---

### Task 5: project.ts — 投影状态机（M1 心脏，六个红绿循环）

**Files:**
- Create: `packages/platform-gateway/src/project.ts`
- Test: `packages/platform-gateway/test/project.spec.ts`

接口（一次定死，六个子任务共用）：

```ts
export interface TurnProjectorOptions {
  messageId: string
  time: string
  conversationId: string
  allocator: PartIdAllocator
  /** 会话记录投影回调（持久化由 conversation.ts 承接）。 */
  onRecord?: (message: unknown) => void
}
export interface TurnProjector {
  /** 喂一个 dsh 事件，返回 0..n 帧（含终态 [DONE]）。终态后调用为 no-op。 */
  step(event: SessionEvent): string[]
  done(): boolean
}
export function createTurnProjector(options: TurnProjectorOptions): TurnProjector
```

测试辅助（文件顶部）：手写 dsh 事件的工厂，全部字段来自 §0.3 已核实类型：

```ts
import type { SessionEvent } from '@deepseek-ai/dsh-session'

let seq = 0
const ev = (type: string, data: unknown): SessionEvent =>
  ({ type, seq: ++seq, time: '2026-08-25T10:00:00.000+08:00', data }) as SessionEvent
const opts = () => ({
  messageId: 'asst_fix', time: '2026-08-25 10:00:00', conversationId: 'c1',
  allocator: createPartIdAllocator({ text: 0, reasoning: 0 }),
})
```

- [ ] **Step 5a: 纯文本轮**（🔴 测试）

```ts
it('text-only turn: start → text-start/delta/end(+usage) → finish → DONE', () => {
  const p = createTurnProjector(opts())
  const out = [
    p.step(ev('turn/start', { turn: 1 })),
    p.step(ev('step/start', { turn: 1, step: 1 })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '你好' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '！' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '你好！' } } })),
    p.step(ev('assistant/message', { turn: 1, step: 1, message: { id: 'm', role: 'assistant', content: [{ type: 'text', text: '你好！' }], source: { kind: 'model', provider: 'mat', model: 'deepseek-v4-pro' } }, usage: { inputTokens: 3, outputTokens: 5 } })),
    p.step(ev('turn/end', { turn: 1, reason: { kind: 'completed' } })),
  ].flat()
  expect(out.join('')).toBe([
    'data: {"type":"start","messageId":"asst_fix","time":"2026-08-25 10:00:00","conversationId":"c1"}\n\n',
    'data: {"type":"text-start","id":"text_1","conversationId":"c1"}\n\n',
    'data: {"type":"text-delta","id":"text_1","delta":"你好","conversationId":"c1"}\n\n',
    'data: {"type":"text-delta","id":"text_1","delta":"！","conversationId":"c1"}\n\n',
    'data: {"type":"text-end","id":"text_1","prompt_tokens":3,"completion_tokens":5,"total_tokens":8,"conversationId":"c1"}\n\n',
    'data: {"type":"finish","finishReason":"stop","conversationId":"c1"}\n\n',
    'data: [DONE]\n\n',
  ].join(''))
  expect(p.done()).toBe(true)
})
```

🟢 实现要点（写最小代码）：状态 `textOpen/textId/textBuf`、`reasoningOpen/...`、`usageBuf`；`turn/end` 终态映射；`start` 帧在**首个事件 step 时**先于其他帧输出（用 `started` 标志）。run：`pnpm vitest run test/project.spec.ts -t 'text-only'` 确认 🔴→🟢。

- [ ] **Step 5b: reasoning→text 交错与关闭顺序**（🔴）

```ts
it('reasoning then text: closes are interleaved exactly like chat.py', () => {
  const p = createTurnProjector(opts())
  const out = [
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '想想' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 1, blockType: 'text' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: '答：42' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: '想想' } } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 1, block: { type: 'text', text: '答：42' } } })),
    p.step(ev('turn/end', { turn: 1, reason: { kind: 'completed' } })),
  ].flat().join('')
  expect(out).toBe([
    sseFrame({ type: 'start', messageId: 'asst_fix', time: '2026-08-25 10:00:00' }, 'c1'),
    sseFrame({ type: 'reasoning-start', id: 'reasoning_1' }, 'c1'),
    sseFrame({ type: 'reasoning-delta', id: 'reasoning_1', delta: '想想' }, 'c1'),
    sseFrame({ type: 'reasoning-end', id: 'reasoning_1' }, 'c1'),
    sseFrame({ type: 'text-start', id: 'text_1' }, 'c1'),
    sseFrame({ type: 'text-delta', id: 'text_1', delta: '答：42' }, 'c1'),
    sseFrame({ type: 'text-end', id: 'text_1' }, 'c1'),
    sseFrame({ type: 'finish', finishReason: 'stop' }, 'c1'),
    SSE_DONE,
  ].join(''))
})
```

（text 的 block-start 先关 reasoning；block-end 按块自身关。）🟢 后同样模式补：reasoning 在 text 之后开始的反向用例（关 text 开 reasoning）。

- [ ] **Step 5c: 工具轮**（🔴）

```ts
it('tool round: input start/delta/available, output, second text is text_2', () => {
  const p = createTurnProjector(opts())
  const out = [
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '我看下目录' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '我看下目录' } } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 1, id: 'call_a', name: 'bash', argumentsDelta: '{"command' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 1, id: 'call_a', argumentsDelta: '":"ls"}' } })),
    p.step(ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call_a', name: 'bash', arguments: '{"command":"ls"}' } } })),
    p.step(ev('tool/call', { turn: 1, step: 1, callId: 'call_a', name: 'bash', arguments: '{"command":"ls"}' })),
    p.step(ev('tool/result', { turn: 1, step: 1, message: { id: 'r', role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_a', content: [{ type: 'text', text: 'a.txt\nb.txt' }] }], source: { kind: 'tool', callId: 'call_a' } } })),
    p.step(ev('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })),
    p.step(ev('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '有两个文件' } })),
    p.step(ev('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 6 } } })),
    p.step(ev('assistant/chunk', { turn: 2, step: 1, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '有两个文件' } } })),
    p.step(ev('turn/end', { turn: 2, reason: { kind: 'completed' } })),
  ].flat().join('')
  expect(out).toBe([
    sseFrame({ type: 'start', messageId: 'asst_fix', time: '2026-08-25 10:00:00' }, 'c1'),
    sseFrame({ type: 'text-start', id: 'text_1' }, 'c1'),
    sseFrame({ type: 'text-delta', id: 'text_1', delta: '我看下目录' }, 'c1'),
    sseFrame({ type: 'text-end', id: 'text_1' }, 'c1'),
    sseFrame({ type: 'tool-input-start', toolCallId: 'call_a', toolName: 'bash' }, 'c1'),
    sseFrame({ type: 'tool-input-delta', toolCallId: 'call_a', inputTextDelta: '{"command' }, 'c1'),
    sseFrame({ type: 'tool-input-delta', toolCallId: 'call_a', inputTextDelta: '":"ls"}' }, 'c1'),
    sseFrame({ type: 'tool-input-available', toolCallId: 'call_a', toolName: 'bash', input: { command: 'ls' } }, 'c1'),
    sseFrame({ type: 'tool-output-available', toolCallId: 'call_a', toolName: 'bash', output: 'a.txt\nb.txt' }, 'c1'),
    sseFrame({ type: 'text-start', id: 'text_2' }, 'c1'),
    sseFrame({ type: 'text-delta', id: 'text_2', delta: '有两个文件' }, 'c1'),
    sseFrame({ type: 'text-end', id: 'text_2', prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 }, 'c1'),
    sseFrame({ type: 'finish', finishReason: 'stop' }, 'c1'),
    SSE_DONE,
  ].join(''))
})
```

🟢 实现要点：`toolStreams: Map<callId, {name, started}>`；`tool/call` 时 `JSON.parse` 失败保留字符串（补一个非 JSON arguments 用例）；`tool/result` 先关开着的 text/reasoning、output 取 `tool-result` 块 content 的文本子块 join；`toolName` 从 toolStreams 取，缺省 `'tool'`。

- [ ] **Step 5d: 终态矩阵**（🔴 表驱动）

```ts
it.each([
  [{ kind: 'max-tokens' }, 'data: {"type":"finish","finishReason":"length","conversationId":"c1"}\n\n'],
  [{ kind: 'error', error: { message: 'boom', code: 'UPSTREAM' } }, 'data: {"type":"error","errorText":"boom","conversationId":"c1"}\n\n'],
  [{ kind: 'aborted', reason: { kind: 'user' } }, 'data: {"type":"cancelled","conversationId":"c1"}\n\n'],
])('terminal %j maps to its frame + DONE', (reason, expected) => {
  const p = createTurnProjector(opts())
  p.step(ev('turn/start', { turn: 1 }))
  const out = p.step(ev('turn/end', { turn: 1, reason })).join('')
  expect(out).toContain(expected)
  expect(out.endsWith(SSE_DONE)).toBe(true)
  expect(p.done()).toBe(true)
})
```

🟢 后补用例：`turn/end{error}` 时若 text 开着 → 先 `text-end` 再 `error`；工具失败 `tool/result{error:{name,code}}` → output 为 `"{code}"` 前缀错误文本（`tool_error_output` 对齐：`output = \`${error.code}: ${error.message}\``，errorText 无 Tool 包装——旧栈包装文案只在异常路径，dsh 的错误已在 result 里结构化）。

- [ ] **Step 5e: 会话记录回调**（🔴）

```ts
it('emits conversation records for reasoning/text/tool in close order', () => {
  const records: unknown[] = []
  const p = createTurnProjector({ ...opts(), onRecord: (m) => records.push(m) })
  // …喂 5b + 5c 的完整事件序列…
  expect(records).toEqual([
    { role: 'assistant', id: 'reasoning_1', type: 'reasoning', reasoning: '想想' },
    { role: 'assistant', id: 'text_1', type: 'text', text: '我看下目录' },
    { role: 'assistant', type: 'tool', tool: { toolCallId: 'call_a', name: 'bash', input: { command: 'ls' }, output: 'a.txt\nb.txt' } },
    { role: 'assistant', id: 'text_2', type: 'text', text: '有两个文件' },
  ])
})
```

- [ ] **Step 5f: no-op 与防重**（🔴）：终态后 `step` 返回 `[]`；非流式兜底（只有 `assistant/message` 无 chunk）时从 message.content 合成 text 事件（简测一条）。

- [ ] **Step 5g: 全量跑 + typecheck + Commit**

```bash
pnpm vitest run packages/platform-gateway/test && pnpm typecheck
git add -A && git commit -m "feat(m1): session-event to platform SSE projection state machine"
```

---

### Task 6: conversation.ts — 会话记录存储

**Files:**
- Create: `packages/platform-gateway/src/conversation.ts`
- Test: `packages/platform-gateway/test/conversation.spec.ts`

- [ ] **Step 1: 失败测试**（用临时目录）

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationStore } from '../src/conversation.ts'

const store = () => new ConversationStore(mkdtempSync(join(tmpdir(), 'gw-')))

describe('ConversationStore', () => {
  it('appendUser creates the record with fallback title and Shanghai timestamps', () => {
    const s = store()
    s.appendUser('u1', 'c1', { text: '  计算\nSi 的   能带  与   一段很长的标题超过四十字符就是这样还要更长一点才行啊', time: '2026-08-25 10:00:00' })
    const record = s.read('u1', 'c1')!
    expect(record.conversationId).toBe('c1')
    expect(record.title).toBe('计算 Si 的能带 与 一段很长的标题超过四十字符就是这样还要更长一点' .slice(0, 40))
    expect(record.createAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/)
    expect(record.messages[0]).toEqual({ role: 'user', text: '  计算\nSi 的   能带  与   一段很长的标题超过四十字符就是这样还要更长一点才行啊', time: '2026-08-25 10:00:00' })
  })
  it('appendMessage bumps updatedAt; list sorts by updatedAt desc and counts messages', () => {
    const s = store()
    s.appendUser('u1', 'a', { text: 'q1', time: '2026-08-25 10:00:00' })
    s.appendUser('u1', 'b', { text: 'q2', time: '2026-08-25 10:01:00' })
    s.append('u1', 'a', { role: 'assistant', id: 'text_1', type: 'text', text: 'r' })
    const rows = s.list('u1')
    expect(rows.map((r: { conversationId: string }) => r.conversationId)).toEqual(['b', 'a'])
    expect(rows[1].messageCount).toBe(2)
  })
  it('delete removes and reports', () => {
    const s = store()
    s.appendUser('u1', 'c', { text: 'q', time: '2026-08-25 10:00:00' })
    expect(s.delete('u1', 'c')).toBe(true)
    expect(s.delete('u1', 'c')).toBe(false)
    expect(s.read('u1', 'c')).toBeNull()
  })
  it('rejects invalid ids', () => {
    const s = store()
    expect(() => s.appendUser('bad/id', 'c', { text: 'q', time: '' })).toThrow(/invalid userId/)
    expect(() => s.appendUser('u', 'x y', { text: 'q', time: '' })).toThrow(/invalid conversationId/)
  })
  it('part-id seed reflects stored records', () => {
    const s = store()
    s.appendUser('u1', 'c1', { text: 'q', time: '' })
    s.append('u1', 'c1', { role: 'assistant', id: 'text_2', type: 'text', text: 'a' })
    expect(s.allocator('u1', 'c1').next('text')).toBe('text_3')
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**

```ts
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPartIdAllocator, seedFromMessages, type PartIdAllocator } from './part-ids.ts'

/** 与旧栈一致的 id 字符集（workspace.py:8-9）。 */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/

/** 会话记录消息（旧栈 session_store 消息形状，见计划 §0.2）。 */
export type ConversationMessage = unknown

/** 旧栈会话记录形状。 */
export interface ConversationRecord {
  userId: string
  conversationId: string
  createAt: string
  updatedAt: string
  title: string
  messages: ConversationMessage[]
}

/** 上海时区 "%Y-%m-%d %H:%M:%S"（旧 _MESSAGE_TIME_FORMAT）。 */
export function shanghaiTime(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}

/** 上海时区 ISO 毫秒（旧 _now_iso）。 */
function shanghaiIso(date = new Date()): string {
  return new Date(date.getTime() + 8 * 3600_000).toISOString().replace('Z', '+08:00')
}

/** 旧 normalize_message_time：空/不可解析 → 当前时间；本格式原样通过。 */
export function normalizeMessageTime(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return shanghaiTime()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())) return value.trim()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? shanghaiTime() : shanghaiTime(parsed)
}

function validateId(kind: 'userId' | 'conversationId', value: string): string {
  if (!ID_PATTERN.test(value)) throw new Error(`invalid ${kind}`)
  return value
}

/** 旧 _title_from_user：空白归一 + 截 40。 */
function titleFromUser(text: string): string {
  const title = text.trim().split(/\s+/).join(' ')
  return title === '' ? 'New conversation' : title.slice(0, 40)
}

/** 会话记录 JSON 存取 + 标题回填 + 分配器种子。 */
export class ConversationStore {
  constructor(private readonly dataRoot: string) {}

  private file(userId: string, conversationId: string): string {
    return join(this.dataRoot, 'sessions', userId, `${conversationId}.json`)
  }

  read(userId: string, conversationId: string): ConversationRecord | null {
    validateId('userId', userId); validateId('conversationId', conversationId)
    const path = this.file(userId, conversationId)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as ConversationRecord
  }

  private load(userId: string, conversationId: string): ConversationRecord {
    const existing = this.read(userId, conversationId)
    if (existing !== null) return existing
    const now = shanghaiIso()
    return { userId, conversationId, createAt: now, updatedAt: now, title: 'New conversation', messages: [] }
  }

  private write(record: ConversationRecord): void {
    const path = this.file(record.userId, record.conversationId)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(record), 'utf8')
  }

  /** 落一条用户消息（标题回填在此时发生，对齐旧 append_session_message）。 */
  appendUser(userId: string, conversationId: string, message: { text: string; time: string; files?: unknown }): void {
    const record = this.load(userId, conversationId)
    record.messages.push({ role: 'user', ...message })
    if (record.title === 'New conversation') record.title = titleFromUser(message.text)
    record.updatedAt = shanghaiIso()
    this.write(record)
  }

  /** 落一条投影消息（assistant reasoning/text/tool）。 */
  append(userId: string, conversationId: string, message: ConversationMessage): void {
    const record = this.load(userId, conversationId)
    record.messages.push(message)
    record.updatedAt = shanghaiIso()
    this.write(record)
  }

  /** 概要行（旧 list_sessions 形状，updatedAt 降序）。 */
  list(userId: string): Array<{ conversationId: string; createAt: string; updatedAt: string; title: string; messageCount: number }> {
    validateId('userId', userId)
    const dir = join(this.dataRoot, 'sessions', userId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => this.read(userId, name.slice(0, -5)))
      .filter((record): record is ConversationRecord => record !== null)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((record) => ({
        conversationId: record.conversationId, createAt: record.createAt, updatedAt: record.updatedAt,
        title: record.title, messageCount: record.messages.length,
      }))
  }

  delete(userId: string, conversationId: string): boolean {
    const path = this.file(userId, conversationId)
    if (!existsSync(path)) return false
    rmSync(path)
    return true
  }

  /** 为会话创建分片 id 分配器（种子来自已存记录）。 */
  allocator(userId: string, conversationId: string): PartIdAllocator {
    const record = this.read(userId, conversationId)
    return createPartIdAllocator(seedFromMessages(record?.messages ?? []))
  }
}
```

- [ ] **Step 4: 确认通过** → `pnpm vitest run packages/platform-gateway/test/conversation.spec.ts` PASS
- [ ] **Step 5: Commit** `git commit -am "feat(m1): conversation record store with old-stack shapes"`

---

### Task 7: http.ts — HTTP/SSE transport

**Files:**
- Create: `packages/platform-gateway/src/http.ts`
- Test: `packages/platform-gateway/test/http.spec.ts`

核心接口（行为由 core.ts 提供，本文件只做解析/格式化）：

```ts
export interface SseSink { write(frame: string): void; end(): void }
export interface ChatHandler {
  (request: { conversationId: string; messages: Array<{ role: string; content: unknown }>; time?: string; userId: string }, sink: SseSink): void | { error: 'busy' }
}
export interface GatewayRoutes {
  health(): { status: 'ok' } | { status: 'error'; reasons: string[] }
  chat: ChatHandler
  stop(conversationId: string): { status: 'stopped' | 'stop_requested' } | { error: 'busy' } | { error: 'invalid' }
  listSessions(userId: string): unknown[]
  readSession(userId: string, id: string): unknown
  deleteSession(userId: string, id: string): boolean
  saveUpload(conversationId: string, filename: string, stream: NodeJS.ReadableStream): Promise<{ name: string; path: string; type: string; size: number }>
}
export function startGatewayServer(routes: GatewayRoutes, listen: { host: string; port: number }): Promise<{ url: string; close(): Promise<void> }>
```

- [ ] **Step 1: 失败测试**（真启 server 于 port 0，fetch 断言）

```ts
import { describe, expect, it } from 'vitest'
import { startGatewayServer, type GatewayRoutes } from '../src/http.ts'

const okRoutes = (): GatewayRoutes => ({
  health: () => ({ status: 'ok' }),
  chat: (req, sink) => { sink.write('data: {"type":"start"}\n\n'); sink.end() },
  stop: () => ({ status: 'stop_requested' }),
  listSessions: () => [{ conversationId: 'c1' }],
  readSession: () => null,
  deleteSession: () => true,
  saveUpload: async (_c, filename) => ({ name: filename, path: '/tmp/x', type: 'txt', size: 3 }),
})

describe('gateway http', () => {
  it('health envelope', async () => {
    const s = await startGatewayServer(okRoutes(), { host: '127.0.0.1', port: 0 })
    const res = await fetch(`${s.url}/api/user/agent/health`)
    expect(await res.json()).toEqual({ code: 0, msg: 'success', data: { status: 'ok' } })
    await s.close()
  })
  it('chat responds with SSE headers and streams frames', async () => {
    const s = await startGatewayServer(okRoutes(), { host: '127.0.0.1', port: 0 })
    const res = await fetch(`${s.url}/api/user/agent/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c1', messages: [{ role: 'user', content: 'hi' }], context: { userId: 'u1' } }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    expect(await res.text()).toBe('data: {"type":"start"}\n\n')
    await s.close()
  })
  it('sessions endpoints carry the envelope; delete reports missing', async () => {
    const s = await startGatewayServer({ ...okRoutes(), readSession: () => null, deleteSession: () => false }, { host: '127.0.0.1', port: 0 })
    const list = await (await fetch(`${s.url}/api/user/agent/sessions?userId=u1`)).json()
    expect(list).toEqual({ code: 0, msg: 'success', data: [{ conversationId: 'c1' }] })
    const one = await (await fetch(`${s.url}/api/user/agent/sessions/c9?userId=u1`)).json()
    expect(one).toEqual({ code: 1, msg: 'conversation not found', data: null })
    const del = await (await fetch(`${s.url}/api/user/agent/sessions/c9?userId=u1`, { method: 'DELETE' })).json()
    expect(del).toEqual({ code: 1, msg: 'conversation not found', data: { deleted: false } })
    await s.close()
  })
  it('files upload parses multipart and returns the record', async () => {
    const s = await startGatewayServer(okRoutes(), { host: '127.0.0.1', port: 0 })
    const form = new FormData()
    form.set('conversationId', 'c1')
    form.set('file', new File([new Uint8Array([97, 98, 99])], 'a.txt'))
    const res = await fetch(`${s.url}/api/user/agent/files`, { method: 'POST', body: form })
    expect(await res.json()).toEqual({ code: 0, msg: 'success', data: { name: 'a.txt', path: '/tmp/x', clusterId: '', type: 'txt', size: '3', content: '' } })
    await s.close()
  })
  it('unknown path 404s with envelope; invalid chat body 400s', async () => {
    const s = await startGatewayServer(okRoutes(), { host: '127.0.0.1', port: 0 })
    expect((await fetch(`${s.url}/api/nope`)).status).toBe(404)
    const bad = await fetch(`${s.url}/api/user/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(bad.status).toBe(400)
    await s.close()
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现**

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import Busboy from 'busboy'

/** 单位 MB 上限的请求体保护。 */
const MAX_JSON_BODY = 10 * 1024 * 1024

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok(data: unknown): unknown { return { code: 0, msg: 'success', data } }
function fail(msg: string, data: unknown = null): unknown { return { code: 1, msg, data } }

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_JSON_BODY) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sseStart(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream', 'cache-control': 'no-cache',
    connection: 'keep-alive', 'x-accel-buffering': 'no',
  })
}

export interface SseSink { write(frame: string): void; end(): void }
// …GatewayRoutes / startGatewayServer 按 Step 1 前的接口定义…

export async function startGatewayServer(routes: GatewayRoutes, listen: { host: string; port: number }): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => { void handle(routes, req, res) })
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(listen.port, listen.host, resolvePromise)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('unexpected listen address')
  return {
    url: `http://${listen.host}:${address.port}`,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  }
}

async function handle(routes: GatewayRoutes, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  if (!path.startsWith('/api/user/agent/')) { json(res, 404, fail('not found')); return }
  const route = path.slice('/api/user/agent/'.length)
  try {
    if (req.method === 'GET' && route === 'health') { json(res, 200, ok(routes.health())); return }
    if (req.method === 'POST' && route === 'chat') {
      const body = await readJsonBody(req)
      const userId = readUserId(body)
      const messages = body.messages
      if (!Array.isArray(messages) || messages.length === 0) { json(res, 400, fail('messages must not be empty')); return }
      if (userId === undefined || typeof body.conversationId !== 'string') { json(res, 400, fail('conversationId and context.userId are required')); return }
      // busy 判定是同步返回值：core.chat 不写任何帧就返回 {error:'busy'}，
      // 因此必须先调用、后开 SSE 头，409 才写得出去（SSE 一旦开头就无法回退 JSON）。
      const outcome = routes.chat(
        {
          conversationId: body.conversationId, messages: messages as Array<{ role: string; content: unknown }>,
          time: typeof body.time === 'string' ? body.time : undefined, userId,
        },
        { write: (frame) => res.write(frame), end: () => res.end() },
      )
      if (outcome !== undefined && 'error' in outcome) { json(res, 409, fail('conversation busy')); return }
      sseStart(res)
      return
    }
    if (req.method === 'POST' && route === 'stop') {
      const body = await readJsonBody(req)
      const outcome = typeof body.conversationId === 'string' ? routes.stop(body.conversationId) : { error: 'invalid' as const }
      if ('error' in outcome) json(res, outcome.error === 'busy' ? 409 : 400, fail(outcome.error === 'busy' ? 'conversation busy' : 'invalid conversationId'))
      else json(res, 200, ok(outcome))
      return
    }
    if (req.method === 'GET' && route === 'sessions') {
      const userId = url.searchParams.get('userId')
      if (userId === null) { json(res, 400, fail('userId is required')); return }
      json(res, 200, ok(routes.listSessions(userId))); return
    }
    if (req.method === 'GET' && route.startsWith('sessions/')) {
      const userId = url.searchParams.get('userId')
      const id = decodeURIComponent(route.slice('sessions/'.length))
      if (userId === null) { json(res, 400, fail('userId is required')); return }
      const record = routes.readSession(userId, id)
      if (record === null) json(res, 200, fail('conversation not found'))
      else json(res, 200, ok(record))
      return
    }
    if (req.method === 'DELETE' && route.startsWith('sessions/')) {
      const userId = url.searchParams.get('userId')
      const id = decodeURIComponent(route.slice('sessions/'.length))
      if (userId === null) { json(res, 400, fail('userId is required')); return }
      json(res, 200, routes.deleteSession(userId, id) ? ok({ deleted: true }) : fail('conversation not found', { deleted: false }))
      return
    }
    if (req.method === 'POST' && route === 'files') {
      const bb = Busboy({ headers: req.headers })
      let conversationId = ''
      let uploaded: { name: string; path: string; type: string; size: number } | null = null
      bb.on('field', (name, value) => { if (name === 'conversationId') conversationId = value })
      bb.on('file', (_name, stream, info) => {
        uploaded = routes.saveUpload(conversationId, info.filename, stream) as never
      })
      req.pipe(bb)
      await new Promise((resolvePromise) => bb.on('close', resolvePromise))
      const result = uploaded !== null ? await (uploaded as unknown as Promise<{ name: string; path: string; type: string; size: number }>) : null
      if (result === null) { json(res, 400, fail('file field is required')); return }
      json(res, 200, ok({ ...result, clusterId: '', size: String(result.size), content: '' }))
      return
    }
    json(res, 404, fail('not found'))
  } catch (error) {
    json(res, 500, fail(error instanceof Error ? error.message : 'internal error'))
  }
}

function readUserId(body: Record<string, unknown>): string | undefined {
  const context = body.context
  if (typeof context !== 'object' || context === null) return undefined
  const userId = (context as Record<string, unknown>).userId
  return typeof userId === 'string' && userId.trim() !== '' ? userId : undefined
}
```

（补充一条 busy 路由测试：`chat: () => ({ error: 'busy' })` 的 routes → `res.status === 409` 且 body 为 `{"code":1,"msg":"conversation busy","data":null}`。）

- [ ] **Step 4: 确认通过** → `pnpm vitest run packages/platform-gateway/test/http.spec.ts` PASS
- [ ] **Step 5: Commit** `git commit -am "feat(m1): HTTP/SSE transport for platform contract"`

---

### Task 8: core.ts + index.ts — 插件装配

**Files:**
- Create: `packages/platform-gateway/src/core.ts`、`packages/platform-gateway/src/index.ts`
- Test: `packages/platform-gateway/test/core.spec.ts`

- [ ] **Step 1: 失败测试**（对 core 用**伪造的** agents/sessions 服务，不发真 LLM 请求；真组合在 Task 9 冒烟）

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGatewayCore } from '../src/core.ts'

function fakeDsh() {
  let listener: ((session: { id: string }, event: unknown) => void) | undefined
  const agent = {
    followup: () => { setTimeout(() => listener?.({ id: 'chat-c1' }, { type: 'turn/start', seq: 1, time: '', data: { turn: 1 } }), 0) },
    cancel: () => { listener?.({ id: 'chat-c1' }, { type: 'turn/end', seq: 2, time: '', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } }) },
    status: 'idle' as const,
  }
  return {
    on: (_name: string, fn: never) => { listener = fn },
    get: (name: string) => name === 'agents' ? { create: async () => ({ agent }) }
      : name === 'sessions' ? { flush: async () => {} }
      : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'mat', model: 'deepseek-v4-pro' }) }
      : undefined,
  }
}

describe('gateway core', () => {
  it('chat drives a full turn: start → (events) → cancelled on stop', async () => {
    const ctx = fakeDsh() as never
    const core = createGatewayCore(ctx, { dataRoot: mkdtempSync(join(tmpdir(), 'core-')), workspaceRoot: process.cwd(), temperature: 0 })
    const frames: string[] = []
    core.chat({ conversationId: 'c1', userId: 'u1', messages: [{ role: 'user', content: 'hi' }] }, { write: (f) => frames.push(f), end: () => frames.push('END') })
    await new Promise((r) => setTimeout(r, 10))
    core.stop('c1')
    expect(frames.join('')).toContain('"type":"start"')
    expect(frames.join('')).toContain('"type":"cancelled"')
    expect(frames.join('')).toContain('data: [DONE]')
    expect(frames[frames.length - 1]).toBe('END')
    expect(core.stop('c1')).toEqual({ status: 'stop_requested' })
  })
  it('busy conversation is rejected and session record got the user message', async () => {
    // 同上：chat 后未结束再 chat → {error:'busy'}；store.read('u1','c1').messages[0].role === 'user'
  })
})
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现 core.ts**

```ts
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ConversationStore, normalizeMessageTime } from './conversation.ts'
import { SSE_DONE, sseFrame } from './events.ts'
import { createTurnProjector, type TurnProjector } from './project.ts'
import type { SseSink } from './http.ts'

/** 插件配置（index.ts 的 Config 转发到这里）。 */
export interface CoreConfig {
  dataRoot: string
  workspaceRoot: string
  temperature?: number
}

interface ActiveStream {
  sink: SseSink
  projector: TurnProjector
  agent: Agent
}

/** 网关行为核心：agent 缓存、活跃流注册表、事件分发、stop。 */
export interface GatewayCore {
  chat(request: { conversationId: string; userId: string; messages: Array<{ role: string; content: unknown }>; time?: string }, sink: SseSink): void | { error: 'busy' }
  stop(conversationId: string): { status: 'stopped' | 'stop_requested' }
}

export function createGatewayCore(ctx: Context, config: CoreConfig): GatewayCore {
  const store = new ConversationStore(config.dataRoot)
  const active = new Map<string, ActiveStream>()
  const inFlight = new Set<string>() // 已受理但 agent 尚未就绪的会话（补上异步窗口的 busy 拦截）
  const agentsByConversation = new Map<string, Agent>()

  ctx.on('session/event', (session, event: SessionEvent) => {
    if (!session.id.startsWith('chat-')) return
    const stream = active.get(session.id.slice('chat-'.length))
    if (stream === undefined || stream.projector.done()) return
    for (const frame of stream.projector.step(event)) stream.sink.write(frame)
    if (stream.projector.done()) {
      stream.sink.end()
      active.delete(session.id.slice('chat-'.length))
      void ctx.get('sessions')?.flush(session)
    }
  })
  ctx.on('agent/disposed', ({ agent }) => {
    for (const [id, cached] of agentsByConversation) if (cached === agent) agentsByConversation.delete(id)
  })

  async function obtainAgent(conversationId: string): Promise<Agent> {
    const cached = agentsByConversation.get(conversationId)
    if (cached !== undefined) return cached
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) throw new Error('platform-gateway: agents/agentDefaultModel services missing (agent-spine not mounted?)')
    const selection = defaultModel.currentSelection()
    const { agent } = await agents.create({
      sessionId: SessionId(`chat-${conversationId}`),
      meta: { cwd: config.workspaceRoot },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: (agentCtx) => { installModelSelection(agentCtx, { current: selection, assembled: undefined }) },
    })
    agentsByConversation.set(conversationId, agent)
    return agent
  }

  function lastUserText(messages: Array<{ role: string; content: unknown }>): string {
    const last = messages[messages.length - 1]
    if (typeof last?.content === 'string') return last.content
    if (Array.isArray(last?.content)) {
      return last.content.filter((p): p is { type: string; text: string } => typeof p === 'object' && p !== null && (p as { type: string }).type === 'text').map((p) => p.text).join('')
    }
    return ''
  }

  return {
    chat(request, sink) {
      if (active.has(request.conversationId) || inFlight.has(request.conversationId)) return { error: 'busy' }
      inFlight.add(request.conversationId)
      const time = normalizeMessageTime(request.time)
      store.appendUser(request.userId, request.conversationId, { text: lastUserText(request.messages), time })
      void obtainAgent(request.conversationId).then((agent) => {
        const projector = createTurnProjector({
          messageId: `asst_${randomUUID().replaceAll('-', '')}`,
          time,
          conversationId: request.conversationId,
          allocator: store.allocator(request.userId, request.conversationId),
          onRecord: (message) => store.append(request.userId, request.conversationId, message),
        })
        active.set(request.conversationId, { sink, projector, agent })
        inFlight.delete(request.conversationId)
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: lastUserText(request.messages) }],
          source: { kind: 'user' },
        }))
      }).catch((error: unknown) => {
        // agent 创建失败：对齐旧栈普通错误路径（error + [DONE]），不让客户端挂着等死流。
        inFlight.delete(request.conversationId)
        sink.write(sseFrame({ type: 'error', errorText: error instanceof Error ? error.message : String(error) }, request.conversationId))
        sink.write(SSE_DONE)
        sink.end()
      })
      return undefined
    },
    stop(conversationId) {
      const stream = active.get(conversationId)
      if (stream === undefined) return { status: 'stop_requested' }
      stream.agent.cancel({ kind: 'user' })
      return { status: 'stopped' }
    },
  }
}
```

（start 帧由 projector 在首个 session 事件 step 时输出（§0.5 表首行），core.chat 同步阶段不写任何帧——这是 http 层能把 busy 回成 409 的前提。）

- [ ] **Step 4: index.ts 插件**

```ts
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createGatewayCore, type GatewayCore } from './core.ts'
import { startGatewayServer, type GatewayRoutes } from './http.ts'

export const name = 'platform-gateway'
export const inject = ['agents', 'sessions', 'agentDefaultModel']

export interface Config {
  host: string
  port: number
  dataRoot: string
  workspaceRoot: string
  /** 旧栈路由要求 temperature 0（设计 §6.4）；经 agent/request waterfall 注入。 */
  temperature?: number
}

export const Config: z<Config> = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().default(8010),
  dataRoot: z.string().default('./run/data'),
  workspaceRoot: z.string().default('./run/workspace'),
  temperature: z.number().optional(),
})

export function apply(ctx: Context, config: Config): void {
  const core = createGatewayCore(ctx, config)
  if (config.temperature !== undefined) {
    ctx.on('agent/request', async (_payload, next) => ({ ...(await next()), temperature: config.temperature }))
  }
  ctx.effect(() => {
    const server: GatewayCore = core
    void server // core 直接作为路由行为源
    const routes: GatewayRoutes = {
      health: () => {
        const selection = ctx.get('agentDefaultModel')?.currentSelection()
        return selection === undefined ? { status: 'error', reasons: ['no default model route'] } : { status: 'ok' }
      },
      chat: (request, sink) => core.chat(request, sink),
      stop: core.stop,
      listSessions: (userId) => new ConversationStoreRoutes(config).list(userId),
      readSession: (userId, id) => new ConversationStoreRoutes(config).read(userId, id),
      deleteSession: (userId, id) => new ConversationStoreRoutes(config).delete(userId, id),
      saveUpload: (conversationId, filename, stream) => saveUpload(config, conversationId, filename, stream),
    }
    const dispose = startGatewayServer(routes, { host: config.host, port: config.port }).then((running) => {
      ctx.logger?.info?.(`platform-gateway listening on ${running.url}`)
      return () => running.close()
    })
    return () => { void dispose.then((close) => close()) }
  })
}
```

（`ConversationStoreRoutes`/`saveUpload` 为薄包装：复用 Task 6 store + Task 7 的上传落盘——文件名安全化/去重按 §0.2 规则实现为 `safeUploadFilename`/`uniqueUploadPath` 两个纯函数放 http.ts 或 core.ts，**实现时收敛到 core.ts 并各配单测**；上面 index.ts 的包装类写法仅示意，落地为模块级函数，避免类样板。）

- [ ] **Step 5: 确认通过 + typecheck** → `pnpm vitest run packages/platform-gateway/test && pnpm typecheck`
- [ ] **Step 6: Commit** `git commit -am "feat(m1): platform-gateway cordis plugin assembling core, routes, temperature"`

---

### Task 9: profiles/gateway.cordis.yml + bin + 启动冒烟

**Files:**
- Create: `profiles/gateway.cordis.yml`、`apps/gateway/src/bin.ts`、`docs/evidence/m1-boot-smoke.txt`

- [ ] **Step 1: 写 `profiles/gateway.cordis.yml`**

```yaml
# vasp-matstream-dsh M1 网关组合（jsonrpc-agent 模板 + spike 验证过的 mat 路由）。
# DSH_HOME 由 bin 隔离到 ./run/dsh-home，用户级 ~/.dsh/settings.yaml 不再参与（M0 教训）。
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      mat:
        displayName: HPC
        apiKeyEnv: UA_API_KEY
        api: openai-completions
        baseURL: !!js process.env.UA_BASE_URL
        compat:
          thinkingFormat: deepseek
        models:
          - id: deepseek-v4-pro
            name: HPC-MAX
            contextWindow: 1000000
            maxTokens: 8192        # spike 猜测值，HPC 限额文档到位后修正
            reasoningEfforts:
              off:
              high: high
              max: max

- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: mat
    model: deepseek-v4-pro

- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'

- id: bash
  name: '@deepseek-ai/dsh-bash-local'
  config:
    cwd: !!js process.env.DSH_CWD ?? process.cwd()
    timeoutMs: 120000            # 旧 shell backend 默认

- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    persona: !!js process.env.DSH_SYSTEM_PROMPT ?? 'You are the VASP calculation assistant (M1 gateway MVP).'
    workspaceContext: false
    skills:
      enabled: true
      filesystem:
        customSkillDirs:
          - ~/mat-harness/vasp-matstream-agent/skills
    toolBash:
      enableRunInBackground: false
    toolJobs: false

- id: sessions
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js process.env.DSH_SESSION_ROOT ?? './run/sessions'
    compression: none            # M1 保留明文 JSONL 便于检视

- id: session-checkpoints
  name: '@deepseek-ai/dsh-session-checkpoint-policy'

- id: subagent
  name: '@deepseek-ai/dsh-subagent'

- id: subagent-spawn-in-process
  name: '@deepseek-ai/dsh-subagent-spawn-in-process'
  config:
    providerName: spawn

- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
    enableRunInBackground: false

- id: tool-todo
  name: '@deepseek-ai/dsh-tool-todo'
  config:
    allowParallelInProgress: true

- id: fs-local
  name: '@deepseek-ai/dsh-fs-local'
  config:
    cwd: !!js process.env.DSH_CWD ?? process.cwd()

- id: fs-observation-policy
  name: '@deepseek-ai/dsh-fs-observation-policy'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: token-meter
  name: '@deepseek-ai/dsh-token-meter'

- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    maxTokens: 8192
    compactionRetries: 1

- id: mcp-mat-remote-shell
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: mat
    transport: streamable-http
    url: !!js '`${process.env.MAT_MCP_BASE_URL ?? ''}/mcp/${process.env.MCP_API_KEY ?? ''}/7552849000000000000/mcp`'
    toolCallTimeoutMs: 300000

- id: mcp-optimade
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: optimade
    transport: streamable-http
    url: https://c-2076488383597109249.ksai.example.internal:58043/mcp/

- id: platform-gateway
  name: ../packages/platform-gateway/src/index.ts
  config:
    host: 0.0.0.0
    port: 8010
    dataRoot: ./run/data
    workspaceRoot: ./run/workspace
    temperature: 0
```

（`skills.filesystem.customSkillDirs` 键名若 boot 报校验错，以 `dsh-skill-filesystem` 的 Config 为准就地修正并记入 evidence——spine 把 `skills.filesystem` 透传给 skill-filesystem。）

- [ ] **Step 2: 写 `apps/gateway/src/bin.ts`**（jsonrpc-demo runner 模式）

```ts
#!/usr/bin/env node
/** vasp 网关 bin：DSH_HOME 隔离 → boot → 信号驱动的干净退出。 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'

const NAME = 'vasp-gateway'

process.on('unhandledRejection', (error) => { console.error(`${NAME}: unhandled rejection`, error); process.exit(1) })
process.on('uncaughtException', (error) => { console.error(`${NAME}: uncaught exception`, error); process.exit(1) })

// M0 教训：用户级 ~/.dsh/settings.yaml 的 matx 曾静默顶掉 profile 路由。
// 网关进程必须用自有 DSH_HOME（env 显式给出则尊重，便于远端部署覆盖）。
process.env.DSH_HOME ??= resolve('run/dsh-home')

const configArg = process.env.DSH_CORDIS_CONFIG !== undefined && process.env.DSH_CORDIS_CONFIG !== ''
  ? process.env.DSH_CORDIS_CONFIG
  : process.argv[2] ?? 'profiles/gateway.cordis.yml'
const configPath = resolve(configArg)

const ctx = await boot(NAME, configPath)
const selection = ctx.get('agentDefaultModel')?.currentSelection()
console.log(`${NAME}: config=${configPath} dshHome=${process.env.DSH_HOME} route=${selection ? `${selection.provider}/${selection.model}` : 'MISSING'}`)

const disposeAndExit = (code: number): void => { void ctx.dispose().then(() => process.exit(code)) }
process.stdin.on('end', () => disposeAndExit(0))
process.stdin.resume()
process.on('SIGTERM', () => disposeAndExit(0))
process.on('SIGINT', () => disposeAndExit(130))
```

- [ ] **Step 3: 无 key 冒烟（假端点，验证全链路与错误路径）**

```bash
cd ~/mat-harness/vasp-matstream-dsh
UA_BASE_URL=http://127.0.0.1:9 UA_API_KEY=dummy node --import tsx/esm apps/gateway/src/bin.ts 2>&1 | tee docs/evidence/m1-boot-smoke.txt &
sleep 12
curl -s http://127.0.0.1:8010/api/user/agent/health; echo " EXIT=$?"
curl -sN -m 60 -X POST http://127.0.0.1:8010/api/user/agent/chat -H 'Content-Type: application/json' \
  -d '{"conversationId":"smoke-1","messages":[{"role":"user","content":"ping"}],"context":{"userId":"smoke"}}' ; echo "EXIT=$?" | tee -a docs/evidence/m1-boot-smoke.txt
```

Expected：health `{"code":0,...}`；chat 流包含 `start`、`error`（模型不可达）、`[DONE]`；route 行显示 `mat/deepseek-v4-pro`（**不是 matx**）。kill %1。

- [ ] **Step 4: 有 key 冒烟（env 门控，一次真对话 + reasoning 验证 thinkingFormat）**

```bash
set -a && . env.local && set +a
node --import tsx/esm apps/gateway/src/bin.ts > docs/evidence/m1-live-chat.txt 2>&1 &
sleep 12
curl -sN -m 180 -X POST http://127.0.0.1:8010/api/user/agent/chat -H 'Content-Type: application/json' \
  -d '{"conversationId":"live-1","messages":[{"role":"user","content":"先思考再回答：9.11 和 9.9 哪个大？只回答一行。"}],"context":{"userId":"live"}}' \
  | tee /tmp/m1-live.sse; echo "EXIT=${PIPESTATUS[0]}" | tee -a docs/evidence/m1-live-chat.txt
kill %1
rg -c 'reasoning-start|text-start|finish' /tmp/m1-live.sse
```

Expected：流含 `reasoning-start/delta/end`（**M0 遗留 thinkingFormat 验证就此闭合**）、`text-*`、`finish`、`[DONE]`；`docs/evidence/m1-live-chat.txt` 留档（**先 `grep -v` 过滤任何含 key 的行再落盘**；本命令输出不含密钥，但落盘前必须目检）。

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(m1): gateway composition profile, boot bin, boot/live smokes"`

---

### Task 10: 契约回放测试（M1 出口判据）

**Files:**
- Create: `tests/contract/replay.spec.ts`
- Create: `tests/contract/fixtures/dsh/text-only.json`、`reasoning-text.json`、`tool-round.json`

- [ ] **Step 1: 编写 dsh 侧 fixture**（三个 JSON，`SessionEvent[]`；**assistant 文本与旧 fixture 逐字相同**——从 Task 2 的实录里拷贝文本/增量切分；tool 轮的 callId 用 `call_a`，回放归一化器做同构映射）

- [ ] **Step 2: 写回放测试**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createPartIdAllocator } from '../../packages/platform-gateway/src/part-ids.ts'
import { createTurnProjector } from '../../packages/platform-gateway/src/project.ts'

const FIX = join(import.meta.dirname, 'fixtures')

/** 解析旧/新 SSE 原文为事件数组；跳过注释行（手写 fixture 的 # 行号标注）。 */
function parseSse(raw: string): Array<Record<string, unknown>> {
  return raw.split('\n\n')
    .filter((block) => block.startsWith('data: ') && block !== 'data: [DONE]')
    .map((block) => JSON.parse(block.slice('data: '.length)) as Record<string, unknown>)
}

/** 语义等价归一化：messageId/time/用量数值/跨侧 id 值不同构但引用一致。 */
function normalize(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const ids = new Map<string, string>()
  const canon = (kind: string, value: string): string => {
    const key = `${kind}:${value}`
    if (!ids.has(key)) ids.set(key, `${kind}#${ids.size}`)
    return ids.get(key)!
  }
  return events.map((event) => {
    const copy: Record<string, unknown> = { ...event }
    delete copy.conversationId
    if (typeof copy.messageId === 'string') copy.messageId = '<messageId>'
    if (typeof copy.time === 'string') copy.time = '<time>'
    for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
      if (typeof copy[key] === 'number') copy[key] = '<int>'
    }
    if (typeof copy.id === 'string' && /^(text|reasoning)_\d+$/.test(copy.id)) {
      copy.id = canon('part', copy.id)
    }
    if (typeof copy.toolCallId === 'string') copy.toolCallId = canon('call', copy.toolCallId)
    return copy
  })
}

const scenarios = ['text-only', 'reasoning-text', 'tool-round'] as const

describe('M1 contract replay: dsh projection ≡ old-stack SSE', () => {
  for (const name of scenarios) {
    it(name, () => {
      const events = JSON.parse(readFileSync(join(FIX, 'dsh', `${name}.json`), 'utf8')) as SessionEvent[]
      const projector = createTurnProjector({
        messageId: 'asst_replay', time: '<time>', conversationId: 'replay',
        allocator: createPartIdAllocator({ text: 0, reasoning: 0 }),
      })
      const produced = events.flatMap((event) => projector.step(event)).join('')
      const old = readFileSync(join(FIX, 'old', `${name}.sse`), 'utf8')
      expect(produced.endsWith('data: [DONE]\n\n')).toBe(true)
      expect(normalize(parseSse(produced))).toEqual(normalize(parseSse(old)))
    })
  }
})
```

- [ ] **Step 3: 红→绿**：先跑确认差异（fixture 缺口或投影偏差），逐项修**投影或 dsh fixture 的切分**（旧实录不可改）；手写降级 fixture 若有 `#` 注释行确认被跳过。全绿后：

```bash
pnpm test
```

Expected: 全部 spec PASS（含 scaffold/events/part-ids/project/conversation/http/core/replay）。

- [ ] **Step 4: Commit** `git add -A && git commit -m "test(m1): contract replay — projection semantically equivalent to old-stack SSE"`

---

### Task 11: 收尾——证据、文档、全量验证

- [ ] **Step 1: 全量验证**

```bash
cd ~/mat-harness/vasp-matstream-dsh
pnpm typecheck && pnpm test
git status --porcelain
```

Expected: typecheck 0 错；测试全绿；工作区只剩本任务文件。

- [ ] **Step 2: 密钥泄漏终检（仓库 public，硬门）**

```bash
rg -n "UA_API_KEY|UA_BASE_URL|MAT_MCP_BASE_URL|MCP_API_KEY|sk-[A-Za-z0-9]" --glob '!env.local' --glob '!docs/evidence/*' . ; echo "EXIT=$?"
ls run/ 2>/dev/null; rg -n "run/" .gitignore || echo "MISSING run/ ignore"
```

Expected: 第一步无真值命中（EXIT=1）；`.gitignore` 含 `run/`、`env.local`、`node_modules/`（缺则补）。evidence 文件逐个目检无密钥后再 add。

- [ ] **Step 3: 更新 `docs/spike-results.md`** 追加 M1 小节：出口判据达成情况（契约回放 3 场景绿）、M0 遗留闭合项（thinkingFormat 实测）、分歧清单（§0.4）与 M2 移交项。

- [ ] **Step 4: Commit + 汇报**

```bash
git add -A && git commit -m "docs(m1): evidence, leak check, milestone results

Co-Authored-By: Claude <noreply@anthropic.com>"
```

向用户汇报：分支 `m1-contract`、契约回放绿、M2 移交清单；**push 需用户明确指示**。用 superpowers:finishing-a-development-branch 收尾选项。

---

## 自审记录（写完即查，问题当场修）

1. **规格覆盖**：设计 §9 M1 = 「SSE chat + 会话 + 上传」→ Task 7/8/9（chat、sessions 三端点、files 上传）✓；出口「契约回放通过」→ Task 2+10 ✓；§6.2 投影表逐行落在 §0.5/Task 5（`tool_call`/`tool_result`/`error`/`cancelled`/`finish`/start/文本/reasoning 全有任务；「资源卡片/文件图片预览」两行是 M2/M3 迁移矩阵行，已在 §0.4-4 显式出范围）✓；§6.1 主链路 6 步全在 core.ts 流程 ✓；部署硬要求（settings.yaml 隔离 §0.4-7、mat 统一 -8、thinkingFormat Task 9 Step 4、temperature §0.3/Task 8）✓。
2. **占位符扫描**：无 TBD/TODO。两处有意为之的写法：① Task 8 Step 4 的 `ConversationStoreRoutes` 类示意已标注「落地为模块级函数并配单测」（收敛指令，非留白）；② Task 5 投影机不给整段实现代码，以「完整测试代码（6 组红绿循环，期望输出逐帧写死）+ §0.5 逐行映射表」为规格——测试即规格，映射表无歧义；实现者照测试与表写最小实现。
3. **类型一致性**（自审发现 3 处，已当场修入上文）：① http.ts 原 example 先 `sseStart` 再调 `routes.chat`，busy 时 409 写不出去 → 已改为「先调 chat（同步返回 busy）→ 后开 SSE 头」，`ChatHandler` 签名同步改为 `void | {error:'busy'}`，并补 busy 路由测试要求；② core.ts 原 `active.set` 在 `obtainAgent` 异步解析后才发生，异步窗口内第二个 chat 不被拦 → 加 `inFlight` 同步集合 + `obtainAgent` 失败走旧栈错误路径（error+[DONE]+end，不让客户端挂死流）；③ core.spec.ts 补 `node:fs`/`node:os`/`node:path` 导入。`sseFrame`/`SSE_DONE`（Task 3）在 core/project/replay 复用一致；`PartIdAllocator`（Task 4）被 project/conversation/core 引用一致；`createTurnProjector` 签名 Task 5 定义、Task 8/10 使用一致；`SessionEvent`/`createUserMessage`/`agents.create` 均与 rc.8 源码核实形状一致（§0.3）。
