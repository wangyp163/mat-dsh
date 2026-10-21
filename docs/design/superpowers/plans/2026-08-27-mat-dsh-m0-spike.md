# mat-dsh M0 Spike 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建仓 `~/mat-harness/mat-dsh/`，打通最小端到端链路——dsh web（OpenAI 兼容 LLM）里一句话让模型经 `mat_exec` 工具（TS 移植的 curl→MCP 链路）在真集群 11250 上执行远程命令。

**Architecture:** 树外 pnpm workspace（packages/mat-core 纯库 + packages/mat-tools 插件包），经 `--patch` overlay（绝对路径引用本地插件源码）组合到**不改源码**的 deepseek-harness 0.1.0-rc.8 宿主上。传输层照抄已验证 Python 插件的 curl 三级容错模式。

**Tech Stack:** TypeScript（NodeNext/strict）、vitest、pnpm workspace、@deepseek-ai/cordis@4.0.1 + @deepseek-ai/dsh-tools@0.1.0-rc.8（精确 pin，与宿主同版本）、curl 子进程。

**设计文档:** `docs/superpowers/specs/2026-08-27-mat-dsh-design.md`（本计划实现其 §9 M0 行）。

**执行约定（所有任务）:**
- 命令默认在 `~/mat-harness/mat-dsh/`（下称 `$REPO`）执行；涉及宿主的命令单独注明。
- 宿主 clone：`~/mat-harness/deepseek-harness/`（下称 `$DSH`）。**铁律：任何任务不得修改 `$DSH` 内被 git 跟踪的文件；每个动过宿主的任务末尾验证 `git -C $DSH status --short` 输出为空。**
- 证据保真：真集群/真服务验证的原始输出（含命令与退出码）落盘 `$REPO/docs/evidence/m0/`，随后 commit。
- TDD 铁律（CLAUDE.md）：先写失败测试、亲见失败；再最小实现、亲见通过。
- 真实凭证一律走环境变量或 `env.local`（gitignored），严禁写进被跟踪文件。

---

### Task 1: 仓库骨架与依赖锁定

**Files:**
- Create: `$REPO/package.json`、`$REPO/pnpm-workspace.yaml`、`$REPO/tsconfig.base.json`、`$REPO/tsconfig.json`、`$REPO/.gitignore`、`$REPO/env.example`、`$REPO/README.md`

- [ ] **Step 1: 创建目录与 git 仓库**

```bash
mkdir -p ~/mat-harness/mat-dsh && cd ~/mat-harness/mat-dsh
git init -b master
```

- [ ] **Step 2: 写 `pnpm-workspace.yaml`**

```yaml
packages:
  - packages/*
```

- [ ] **Step 3: 写根 `package.json`**

```json
{
  "name": "mat-dsh",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "dsh": "pnpm --dir ~/mat-harness/deepseek-harness dsh"
  }
}
```

- [ ] **Step 4: 写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "noEmit": true
  }
}
```

- [ ] **Step 5: 写根 `tsconfig.json`（solution style，引用各包）**

```json
{
  "files": [],
  "references": [
    { "path": "packages/mat-core" },
    { "path": "packages/mat-tools" }
  ]
}
```

- [ ] **Step 6: 写 `.gitignore`**

```
node_modules/
dist/
*.tsbuildinfo
.env
env.local
run/
```

- [ ] **Step 7: 写 `env.example`（凭证模板；`env.local` 由用户复制填写，不进 git）**

```bash
# HPC remote-shell 密钥（sk- 开头，HPC 密钥中心创建）—— Gaussian 全流程唯一必需凭证
MAT_MCP_KEY=sk-xxxxxxxx
# 可选：MCP 网关覆盖（默认 https://mcp-gateway.example.internal/api；开发网关如 http://mcp-dev-gw.internal:32399）
MAT_MCP_BASE_URL=
# OpenAI 兼容 LLM 端点（如 HPC 网关；vasp-matstream-dsh spike 已验证该模式）
LLM_BASE_URL=
LLM_API_KEY=
# 模型 id（须为网关真实 id；spike 实测 HPC 网关为 deepseek-v4-pro / deepseek-v4-flash）
LLM_MODEL_ID=deepseek-v4-pro
```

- [ ] **Step 8: 写 `README.md`**

```markdown
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
```

- [ ] **Step 9: 安装根依赖并验证工具链**

```bash
pnpm add -D -w typescript@~5.8 vitest@^3 @types/node@^22
pnpm exec tsc --version && pnpm exec vitest --version
```

Expected: 两个版本号正常打印，退出码 0。

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "chore: mat-dsh 仓库骨架（pin dsh 0.1.0-rc.8 树外组合）"
```

---

### Task 2: mat-core 包骨架 + vitest 就绪（TDD 起步）

**Files:**
- Create: `$REPO/packages/mat-core/package.json`、`$REPO/packages/mat-core/tsconfig.json`、`$REPO/packages/mat-core/src/index.ts`、`$REPO/packages/mat-core/test/sanity.test.ts`、`$REPO/vitest.config.ts`

- [ ] **Step 1: 写 `packages/mat-core/package.json`**

```json
{
  "name": "mat-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "devDependencies": {
    "@types/node": "^22"
  }
}
```

- [ ] **Step 2: 写 `packages/mat-core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: 写 `packages/mat-core/src/index.ts`（先空壳）**

```ts
export const MAT_CORE_VERSION = '0.1.0'
```

- [ ] **Step 4: 写失败测试 `test/sanity.test.ts`**

```ts
import { expect, it } from 'vitest'
import { MAT_CORE_VERSION } from '../src/index'

it('sanity: 包可导入且导出版本', () => {
  expect(MAT_CORE_VERSION).toBe('0.1.0')
})
```

- [ ] **Step 5: 写根 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 6: 运行验证（红→绿一次性确认：先临时改断言值确认会红，再改回确认绿）**

```bash
pnpm install   # 链接 workspace 包
pnpm test
```

Expected: `1 passed`。临时把断言改为 `'0.0.0'` 再跑应 FAIL（确认测试真的在测），改回后 PASS。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test: mat-core 骨架与 vitest 就绪"
```

---

### Task 3: `buildMcpUrl`（TDD）

**Files:**
- Create: `$REPO/packages/mat-core/src/url.ts`
- Modify: `$REPO/packages/mat-core/src/index.ts`
- Test: `$REPO/packages/mat-core/test/url.test.ts`

- [ ] **Step 1: 写失败测试 `test/url.test.ts`**

```ts
import { expect, it } from 'vitest'
import { buildMcpUrl, DEFAULT_MCP_BASE_URL, REMOTE_SHELL_SERVICE_ID } from '../src/url'

it('默认网关构造 remote-shell MCP URL', () => {
  expect(buildMcpUrl('sk-TEST')).toBe(
    `${DEFAULT_MCP_BASE_URL}/mcp/sk-TEST/${REMOTE_SHELL_SERVICE_ID}/mcp`,
  )
})

it('自定义 base_url 与 service_id 生效', () => {
  expect(buildMcpUrl('sk-K', 'http://mcp-dev-gw.internal:32399', 'svc1')).toBe(
    'http://mcp-dev-gw.internal:32399/mcp/sk-K/svc1/mcp',
  )
})

it('base_url 尾部斜杠被归一', () => {
  expect(buildMcpUrl('sk-K', 'http://gw:1/')).toBe('http://gw:1/mcp/sk-K/svc1/mcp'.replace('svc1', REMOTE_SHELL_SERVICE_ID))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL，报 `Cannot find module '../src/url'`。

- [ ] **Step 3: 最小实现 `src/url.ts`**

```ts
export const DEFAULT_MCP_BASE_URL = 'https://mcp-gateway.example.internal/api'
export const REMOTE_SHELL_SERVICE_ID = '7552849000000000000'

export function buildMcpUrl(mcpKey: string, baseUrl?: string, serviceId?: string): string {
  const base = (baseUrl || DEFAULT_MCP_BASE_URL).replace(/\/+$/, '')
  const svc = serviceId || REMOTE_SHELL_SERVICE_ID
  return `${base}/mcp/${mcpKey}/${svc}/mcp`
}
```

- [ ] **Step 4: `src/index.ts` 增加导出**

```ts
export * from './url'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部 PASS（url 3 例 + sanity 1 例）。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): buildMcpUrl 与 remote-shell 服务常量"
```

---

### Task 4: curl 参数构造与响应解析纯函数（TDD）

**Files:**
- Create: `$REPO/packages/mat-core/src/curl.ts`
- Modify: `$REPO/packages/mat-core/src/index.ts`
- Test: `$REPO/packages/mat-core/test/curl.test.ts`

**移植不变量（来自 MIGRATE_PROMPT §3.1，不得"优化"）:**
- `curl -k -s --noproxy *`；双头 `Content-Type: application/json` + `Accept: application/json, text/event-stream`（缺 Accept 对则 406）
- `-D /dev/stderr` 把响应头导到 stderr；`mcp-session-id` 头大小写不敏感匹配
- 响应为 SSE，取 `data: ` 行解析 JSON；MCP 外层 `result.content[0].text` 里才是 HPC 业务 JSON

- [ ] **Step 1: 写失败测试 `test/curl.test.ts`**

```ts
import { expect, it } from 'vitest'
import { buildCurlArgs, extractSessionId, parseToolCallResponse } from '../src/curl'

it('buildCurlArgs: 含全部不变量参数', () => {
  const args = buildCurlArgs({ url: 'https://x/mcp', body: '{"a":1}', maxTimeSec: 30 })
  expect(args).toEqual([
    'curl', '-k', '-s', '--noproxy', '*',
    '-H', 'Content-Type: application/json',
    '-H', 'Accept: application/json, text/event-stream',
    '-D', '/dev/stderr',
    '-d', '{"a":1}',
    '--max-time', '30',
    'https://x/mcp',
  ])
})

it('buildCurlArgs: 带 session 时插入 Mcp-Session-Id 头（单元素 "Name: value" 形式）', () => {
  const args = buildCurlArgs({ url: 'https://x/mcp', body: '{}', maxTimeSec: 40, sessionId: 'sid-1' })
  expect(args).toContain('Mcp-Session-Id: sid-1')
})

it('extractSessionId: 小写头名可提取', () => {
  const headers = 'HTTP/1.1 200 OK\r\nmcp-session-id: abc-123\r\ncontent-type: text/event-stream\r\n\r\n'
  expect(extractSessionId(headers)).toBe('abc-123')
})

it('extractSessionId: 驼峰头名也可提取（大小写不敏感）', () => {
  const headers = 'HTTP/1.1 200 OK\r\nMcp-Session-Id: XYZ9\r\n\r\n'
  expect(extractSessionId(headers)).toBe('XYZ9')
})

it('extractSessionId: 无头返回 null', () => {
  expect(extractSessionId('HTTP/1.1 200 OK\r\n\r\n')).toBeNull()
})

it('parseToolCallResponse: SSE data 行 → HPC 业务 JSON', () => {
  const inner = JSON.stringify({ code: 0, data: 'compute-01', message: 'success' })
  const mcp = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: inner }] } })
  const body = `event: message\ndata: ${mcp}\n\n`
  expect(parseToolCallResponse(body)).toEqual({ code: 0, data: 'compute-01', message: 'success' })
})

it('parseToolCallResponse: 忽略非 data 行与坏 JSON', () => {
  const body = ': ping\ndata: not-json\ndata: ' + JSON.stringify({
    jsonrpc: '2.0', id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify({ code: 0, data: 'x', message: 'success' }) }] },
  }) + '\n'
  expect(parseToolCallResponse(body)).toEqual({ code: 0, data: 'x', message: 'success' })
})

it('parseToolCallResponse: 空流抛错（网络故障信号）', () => {
  expect(() => parseToolCallResponse('')).toThrow(/empty MCP stream/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL（`Cannot find module '../src/curl'`）。

- [ ] **Step 3: 最小实现 `src/curl.ts`**

```ts
export interface CurlArgsInput {
  url: string
  body: string
  maxTimeSec: number
  sessionId?: string
}

export function buildCurlArgs(input: CurlArgsInput): string[] {
  const args = [
    'curl', '-k', '-s', '--noproxy', '*',
    '-H', 'Content-Type: application/json',
    '-H', 'Accept: application/json, text/event-stream',
  ]
  if (input.sessionId) args.push('-H', `Mcp-Session-Id: ${input.sessionId}`)
  args.push('-D', '/dev/stderr', '-d', input.body, '--max-time', String(input.maxTimeSec), input.url)
  return args
}

export function extractSessionId(headersText: string): string | null {
  for (const line of headersText.split('\n')) {
    if (line.toLowerCase().includes('mcp-session-id')) {
      const value = line.split(':', 2)[1]
      if (value) return value.trim()
    }
  }
  return null
}

/** 解析 MCP SSE 响应，返回 remote_shell_execute 的 HPC 业务 JSON（code/data/message）。 */
export function parseToolCallResponse(stdout: string): Record<string, unknown> {
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const mcp = JSON.parse(line.slice(6)) as {
        result?: { content?: Array<{ type: string; text: string }> }
      }
      const text = mcp.result?.content?.[0]?.text
      if (typeof text === 'string') return JSON.parse(text) as Record<string, unknown>
    } catch {
      // 坏行（心跳/半截 JSON）跳过，继续找下一个 data 行
    }
  }
  throw new Error('empty MCP stream (likely network fault)')
}
```

- [ ] **Step 4: `src/index.ts` 增加导出**

```ts
export * from './curl'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): curl 参数构造/SSE 解析/session 头提取（移植不变量）"
```

---

### Task 5: 命令执行器与 `curlWithRetry`（HTTP 000 检测，TDD）

**Files:**
- Modify: `$REPO/packages/mat-core/src/curl.ts`
- Modify: `$REPO/packages/mat-core/src/index.ts`
- Test: `$REPO/packages/mat-core/test/runner.test.ts`

**移植不变量:** 网关断连时 curl **正常退出（rc=0）但 body 为空**（HTTP 000 连接重置）——除 rc≠0 外必须检测空 body；重试 3 次，退避 5s/15s/30s（测试注入 0）。

- [ ] **Step 1: 写失败测试 `test/runner.test.ts`**

```ts
import { expect, it } from 'vitest'
import { curlWithRetry, type CommandResult } from '../src/curl'

function seq(results: CommandResult[]) {
  let i = 0
  return async (): Promise<CommandResult> => results[Math.min(i++, results.length - 1)]
}

it('rc=0 且有 body: 直接成功', async () => {
  const r = await curlWithRetry(seq([{ rc: 0, stdout: 'ok', stderr: '' }]), ['curl'], { delays: [0, 0, 0] })
  expect(r.stdout).toBe('ok')
})

it('HTTP 000: rc=0 但 body 空 → 重试后成功', async () => {
  let calls = 0
  const run = async () => {
    calls += 1
    return calls === 1 ? { rc: 0, stdout: '', stderr: '' } : { rc: 0, stdout: 'data', stderr: '' }
  }
  const r = await curlWithRetry(run, ['curl'], { delays: [0, 0, 0], requireBody: true })
  expect(r.stdout).toBe('data')
  expect(calls).toBe(2)
})

it('rc!=0 → 重试；3 次皆失败 → 抛错并带诊断信息', async () => {
  let calls = 0
  const run = async () => { calls += 1; return { rc: 7, stdout: '', stderr: 'boom' } }
  await expect(
    curlWithRetry(run, ['curl', '--max-time', '30', 'u'], { delays: [0, 0, 0], requireBody: true }),
  ).rejects.toThrow(/curl failed: rc=7 body_len=0/)
  expect(calls).toBe(3)
})

it('requireBody=false 时 rc=0 空 body 不触发重试', async () => {
  let calls = 0
  const run = async () => { calls += 1; return { rc: 0, stdout: '', stderr: 'h' } }
  await curlWithRetry(run, ['curl'], { delays: [0, 0, 0] })
  expect(calls).toBe(1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL（`curlWithRetry` 未导出）。

- [ ] **Step 3: 在 `src/curl.ts` 追加实现**

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CommandResult {
  rc: number
  stdout: string
  stderr: string
}

export type CommandRunner = (argv: string[]) => Promise<CommandResult>

/** 生产执行器：curl 子进程（Node 原生网络栈对 mcp-gateway.example.internal 有 SSL 风险，curl 为实测稳定路径）。 */
export const defaultRunner: CommandRunner = async (argv) => {
  try {
    const { stdout, stderr } = await execFileAsync('curl', argv, {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { rc: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return { rc: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e.message ?? err) }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface CurlRetryOptions {
  delays?: [number, number, number]
  requireBody?: boolean
}

/** 三级容错第一级：curl 层重试（rc≠0 或 requireBody 时 body 空 → 5s/15s/30s 三次）。 */
export async function curlWithRetry(
  run: CommandRunner,
  argv: string[],
  opts: CurlRetryOptions = {},
): Promise<CommandResult> {
  const delays = opts.delays ?? [5, 15, 30]
  const requireBody = opts.requireBody ?? false
  let last: Error | undefined
  for (let i = 0; i < 3; i += 1) {
    try {
      const result = await run(argv)
      if (result.rc !== 0 || (requireBody && !result.stdout.trim())) {
        throw new Error(`curl failed: rc=${result.rc} body_len=${result.stdout.length}`)
      }
      return result
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err))
      if (i < 2) await sleep(delays[i] ?? 30)
    }
  }
  throw last ?? new Error('curl failed')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): 命令执行器与 curl 层重试（HTTP 000 空 body 检测）"
```

---

### Task 6: `CurlMcpTransport`（会话建立 + callTool，TDD）

**Files:**
- Create: `$REPO/packages/mat-core/src/transport.ts`
- Modify: `$REPO/packages/mat-core/src/index.ts`
- Test: `$REPO/packages/mat-core/test/transport.test.ts`

**行为（对齐 plugin.py `_mcp_init/_mcp_exec/_mcp_init_retry`）:**
- `initSession()`：发 initialize 请求（protocolVersion 2024-11-05），从 stderr 头提取 session id；自带 3 次退避重试
- `callTool(name, args, timeoutSeconds)`：需会话（无则先 init）；发 tools/call；解析 SSE；失败使会话失效并抛错
- 会话缓存于实例；`invalidate()` 供上层重建

- [ ] **Step 1: 写失败测试 `test/transport.test.ts`**

```ts
import { expect, it } from 'vitest'
import { CurlMcpTransport } from '../src/transport'
import type { CommandRunner } from '../src/curl'

const INIT_HEADERS = 'HTTP/1.1 200 OK\r\nmcp-session-id: sess-1\r\n\r\n'

function sseBody(payload: unknown) {
  const inner = JSON.stringify(payload)
  const mcp = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: inner }] } })
  return `data: ${mcp}\n\n`
}

it('initSession 从响应头提取会话 id，且 initialize 请求体正确', async () => {
  let seenBody = ''
  const run: CommandRunner = async (argv) => {
    const i = argv.indexOf('-d')
    seenBody = argv[i + 1]
    return { rc: 0, stdout: 'data: {}\n', stderr: INIT_HEADERS }
  }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  await expect(t.initSession()).resolves.toBe('sess-1')
  const body = JSON.parse(seenBody)
  expect(body.method).toBe('initialize')
  expect(body.params.protocolVersion).toBe('2024-11-05')
})

it('callTool 携带 Mcp-Session-Id 并返回 HPC 业务 JSON', async () => {
  const seen: string[] = []
  const run: CommandRunner = async (argv) => {
    const h = argv.find((a) => a.startsWith('Mcp-Session-Id: '))
    seen.push(h?.slice('Mcp-Session-Id: '.length) ?? '(none)')
    const d = argv.indexOf('-d')
    seen.push(argv[d + 1])
    if (h === undefined) return { rc: 0, stdout: 'data: {}\n', stderr: INIT_HEADERS }
    return { rc: 0, stdout: sseBody({ code: 0, data: 'compute-01', message: 'success' }), stderr: '' }
  }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  const out = await t.callTool('remote_shell_execute', { clusterId: '11250', command: 'hostname' }, 30)
  expect(out).toEqual({ code: 0, data: 'compute-01', message: 'success' })
  expect(seen[0]).toBe('(none)') // 第一次是 initialize（无会话头）
  const callBody = JSON.parse(seen[3]) // 第二次请求体
  expect(callBody.method).toBe('tools/call')
  expect(callBody.params.name).toBe('remote_shell_execute')
  expect(callBody.params.arguments.clusterId).toBe('11250')
})

it('callTool 失败后 会话失效，下次调用重新 initialize', async () => {
  let calls = 0
  let initCount = 0
  const run: CommandRunner = async (argv) => {
    if (!argv.some((a) => a.startsWith('Mcp-Session-Id: '))) {
      initCount += 1
      return { rc: 0, stdout: 'data: {}\n', stderr: INIT_HEADERS }
    }
    calls += 1
    // 第一次 callTool：curlWithRetry 内部 3 次尝试全部空 body（HTTP 000）→ 抛错并使会话失效
    if (calls <= 3) return { rc: 0, stdout: '', stderr: '' }
    return { rc: 0, stdout: sseBody({ code: 0, data: 'ok', message: 'success' }), stderr: '' }
  }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  await expect(t.callTool('remote_shell_execute', {}, 5)).rejects.toThrow()
  await expect(t.callTool('remote_shell_execute', {}, 5)).resolves.toEqual({ code: 0, data: 'ok', message: 'success' })
  expect(initCount).toBe(2)
  expect(calls).toBe(4)
})

it('initSession 连续失败 3 次后抛错', async () => {
  let calls = 0
  const run: CommandRunner = async () => { calls += 1; return { rc: 0, stdout: '', stderr: '' } }
  const t = new CurlMcpTransport({ mcpUrl: 'https://x/mcp', run, delays: [0, 0, 0] })
  await expect(t.initSession()).rejects.toThrow(/session|curl/i)
  expect(calls).toBe(3)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/transport.ts`**

```ts
import { buildCurlArgs, curlWithRetry, defaultRunner, extractSessionId, parseToolCallResponse } from './curl'
import type { CommandRunner } from './curl'

export interface TransportOptions {
  mcpUrl: string
  run?: CommandRunner
  delays?: [number, number, number]
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 三级容错第二级载体：MCP 会话（建立/复用/失效重建）。 */
export class CurlMcpTransport {
  private readonly mcpUrl: string
  private readonly run: CommandRunner
  private readonly delays: [number, number, number]
  private sessionId: string | null = null

  constructor(opts: TransportOptions) {
    this.mcpUrl = opts.mcpUrl
    this.run = opts.run ?? defaultRunner
    this.delays = opts.delays ?? [5, 15, 30]
  }

  invalidate(): void {
    this.sessionId = null
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId
    // 会话层：init 自带 3 次退避（对齐 _mcp_init_retry）
    let last: Error | undefined
    for (let i = 0; i < 3; i += 1) {
      try {
        return (this.sessionId = await this.initSession())
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err))
        if (i < 2) await sleep(this.delays[i] ?? 30)
      }
    }
    throw new Error(`MCP session init failed after 3 attempts: ${last?.message ?? last}`)
  }

  async initSession(): Promise<string> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mat-dsh', version: '0.1.0' },
      },
    })
    const result = await curlWithRetry(
      this.run,
      buildCurlArgs({ url: this.mcpUrl, body, maxTimeSec: 30 }),
      { delays: this.delays, requireBody: true },
    )
    const sid = extractSessionId(result.stderr)
    if (!sid) throw new Error('no mcp-session-id in response headers')
    return sid
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutSeconds = 30): Promise<Record<string, unknown>> {
    const sessionId = await this.ensureSession()
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    })
    try {
      const result = await curlWithRetry(
        this.run,
        buildCurlArgs({ url: this.mcpUrl, body, maxTimeSec: timeoutSeconds + 10, sessionId }),
        { delays: this.delays, requireBody: true },
      )
      return parseToolCallResponse(result.stdout)
    } catch (err) {
      this.invalidate() // 会话可疑，置空促上层重建
      throw err instanceof Error ? err : new Error(String(err))
    }
  }
}
```

- [ ] **Step 4: `src/index.ts` 增加导出**

```ts
export * from './transport'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(core): CurlMcpTransport（会话建立/复用/失效重建）"
```

---

### Task 7: `MatClient.execCommand`（三级容错 + 返回归一化，TDD）

**Files:**
- Create: `$REPO/packages/mat-core/src/client.ts`
- Modify: `$REPO/packages/mat-core/src/index.ts`
- Test: `$REPO/packages/mat-core/test/client.test.ts`

**移植不变量:**
- exec 整体 3 次尝试；每次失败会话置空重建；退避 5s/15s（测试注入 0）——对应 plugin.py `exec_command`
- 返回归一化：`code:0` → `data` 为 stdout 字符串；`code:10020` → `data` 为 `{stdout, stderr, exitCode}`（可能 str/dict）

- [ ] **Step 1: 写失败测试 `test/client.test.ts`**

```ts
import { expect, it } from 'vitest'
import { MatClient, outputText } from '../src/client'

function fakeTransport(script: Array<{ ok: boolean; payload?: unknown }>) {
  let i = 0
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      const step = script[Math.min(i++, script.length - 1)]
      if (!step.ok) throw new Error('network down')
      return step.payload as Record<string, unknown>
    },
    invalidate: () => {},
  }
}

it('code:0 且 data 为字符串 → outputText 取 stdout 文本', async () => {
  const t = fakeTransport([{ ok: true, payload: { code: 0, data: 'cn01\n', message: 'success' } }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never })
  const r = await c.execCommand('11250', 'hostname', 30)
  expect(r).toEqual({ code: 0, data: 'cn01\n', message: 'success' })
  expect(outputText(r)).toBe('cn01\n')
  expect(t.calls[0].args).toEqual({ clusterId: '11250', command: 'hostname', timeoutSeconds: 30 })
})

it('code:10020 → data 为 dict，outputText 拼接 stdout/stderr/exitCode', async () => {
  const t = fakeTransport([{
    ok: true,
    payload: { code: 10020, data: { stdout: '', stderr: 'sbatch: error', exitCode: 1 }, message: 'remote shell command failed' },
  }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never })
  const r = await c.execCommand('11250', 'sbatch x', 30)
  expect(outputText(r)).toContain('sbatch: error')
  expect(outputText(r)).toContain('exitCode=1')
})

it('前两次网络故障、第三次成功 → 整体成功（会话重建重试）', async () => {
  const t = fakeTransport([
    { ok: false }, { ok: false },
    { ok: true, payload: { code: 0, data: 'host', message: 'success' } },
  ])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never, retryDelays: [0, 0] })
  await expect(c.execCommand('11250', 'hostname', 30)).resolves.toMatchObject({ code: 0, data: 'host' })
})

it('三次皆失败 → 抛 MatExecError 且信息含末次错误', async () => {
  const t = fakeTransport([{ ok: false }])
  const c = new MatClient({ mcpKey: 'sk-K', transport: t as never, retryDelays: [0, 0] })
  await expect(c.execCommand('11250', 'hostname', 30)).rejects.toThrow(/exec_command failed after 3 retries: network down/)
})

it('未提供 mcp_key → 构造/调用时报凭证错误', async () => {
  const c = new MatClient({ mcpKey: '' })
  await expect(c.execCommand('11250', 'hostname', 30)).rejects.toThrow(/MAT_MCP_KEY/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/client.ts`**

```ts
import { CurlMcpTransport } from './transport'
import { buildMcpUrl } from './url'

export interface ExecResult {
  code: number
  data: string | { stdout: string; stderr: string; exitCode: number }
  message: string
}

export class MatExecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatExecError'
  }
}

export interface MatClientOptions {
  mcpKey: string
  baseUrl?: string
  transport?: { callTool(name: string, args: Record<string, unknown>, timeoutSeconds?: number): Promise<Record<string, unknown>>; invalidate(): void }
  retryDelays?: [number, number]
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** HPC remote-shell 客户端（M0 范围：execCommand）。 */
export class MatClient {
  private readonly transport: NonNullable<MatClientOptions['transport']>

  constructor(private readonly opts: MatClientOptions) {
    if (!opts.transport) {
      if (!opts.mcpKey || !opts.mcpKey.startsWith('sk-')) {
        // 凭证缺失在首次使用时报清晰错误（构造仍允许，便于早暴露于 UI 提示）
      }
      this.transport = new CurlMcpTransport({ mcpUrl: buildMcpUrl(opts.mcpKey, opts.baseUrl) })
    } else {
      this.transport = opts.transport
    }
  }

  /** 三级容错第三级宿主：exec 整体重试 3 次，每次失败置空会话促重建（对齐 plugin.py exec_command）。 */
  async execCommand(clusterId: string, command: string, timeoutSeconds = 30): Promise<ExecResult> {
    const key = this.opts.mcpKey || process.env.MAT_MCP_KEY || ''
    if (!key.startsWith('sk-')) {
      throw new MatExecError(
        '[mat] 缺少有效凭证：请设置 MAT_MCP_KEY（sk- 开头，HPC 密钥中心创建的 remote-shell 密钥）',
      )
    }
    const delays = this.opts.retryDelays ?? [5, 15]
    let last: Error | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const payload = await this.transport.callTool('remote_shell_execute', { clusterId, command, timeoutSeconds }, timeoutSeconds)
        return normalizeExec(payload)
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err))
        this.transport.invalidate()
        if (attempt < 2) await sleep(delays[attempt] ?? 15)
      }
    }
    throw new MatExecError(`exec_command failed after 3 retries: ${last?.message ?? last}`)
  }
}

function normalizeExec(payload: Record<string, unknown>): ExecResult {
  return {
    code: typeof payload.code === 'number' ? payload.code : Number(payload.code ?? -1),
    data: (payload.data ?? '') as ExecResult['data'],
    message: String(payload.message ?? ''),
  }
}

/** 归一化输出为纯文本（code:0 → stdout；10020 → stdout/stderr/exitCode 拼接）。 */
export function outputText(r: ExecResult): string {
  if (r.code === 0) {
    return typeof r.data === 'string' ? r.data : (r.data?.stdout ?? '')
  }
  if (typeof r.data === 'string') return r.data || r.message
  const d = r.data ?? { stdout: '', stderr: '', exitCode: -1 }
  return `[remote failed exitCode=${d.exitCode}]\nstdout:\n${d.stdout}\nstderr:\n${d.stderr}`
}
```

- [ ] **Step 4: `src/index.ts` 增加导出**

```ts
export * from './client'
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test`
Expected: 全部 PASS（累计 21 例左右，全绿）。

- [ ] **Step 6: typecheck + Commit**

（根 solution tsconfig 引用的 mat-tools 要到 Task 8 才创建，故此处对 mat-core 单包做类型检查）

```bash
pnpm exec tsc -p packages/mat-core/tsconfig.json && git add -A && git commit -m "feat(core): MatClient.execCommand（三级容错+返回归一化）"
```

---

### Task 8: mat-tools 插件包（`mat_exec` 工具）

**Files:**
- Create: `$REPO/packages/mat-tools/package.json`、`$REPO/packages/mat-tools/tsconfig.json`、`$REPO/packages/mat-tools/src/index.ts`

**说明:** 无单测（薄封装，逻辑全在 mat-core；行为验证在 Task 10/11 的真集群冒烟）。`defineTool` 契约来自 dsh 官方 cookbook（`docs/cookbook/adding-a-tool.md`）。

- [ ] **Step 1: 写 `packages/mat-tools/package.json`（link: 宿主 workspace 实例，规避双实例风险）**

> **执行期偏差（2026-08-27，controller 裁定）:** 原计划 pin npm 版本 `cordis@4.0.1 + dsh-tools@0.1.0-rc.8`，但实测 npm 上 `@deepseek-ai/dsh-tools` 只有陈旧的 `0.0.1-rc.1`；宿主实际通过 workspace 消费 `packages/core/tools`（0.1.0-rc.8）与 `vendor/cordis`（4.0.1），两者均为已构建包（lib/index.js + lib/types）。触发改任务的 stop-clause 预案：改用 `link:` 绝对路径直连宿主实例——与宿主运行时共享同一包实例，双实例风险归零，且不触碰宿主仓库。

```json
{
  "name": "mat-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@deepseek-ai/cordis": "link:~/mat-harness/deepseek-harness/vendor/cordis",
    "@deepseek-ai/dsh-tools": "link:~/mat-harness/deepseek-harness/packages/core/tools",
    "mat-core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22"
  }
}
```

- [ ] **Step 2: 写 `packages/mat-tools/tsconfig.json`**

（与 mat-core 同模式：base 的 noEmit/无 declaration 与 composite 冲突（TS6304），包内覆写并只产声明到 gitignore 的 dist/）

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "emitDeclarationOnly": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 `src/index.ts`（dsh 工具插件）**

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MatClient, outputText } from 'mat-core'

export const name = 'mat-tools'
export const inject = ['tools']

let client: MatClient | undefined

function getClient(): MatClient {
  if (!client) {
    const mcpKey = process.env.MAT_MCP_KEY ?? ''
    client = new MatClient({ mcpKey, baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
  }
  return client
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'mat_exec',
    description:
      'Execute a shell command on a remote HPC HPC cluster via remote-shell. ' +
      'Returns stdout, or stdout/stderr/exitCode when the remote command fails. ' +
      'Use for cluster inspection (sinfo, squeue, ls) and lightweight commands; ' +
      'long-running compute must go through Slurm submission, not this tool.',
    parameters: {
      cluster_id: { type: 'string', required: true, description: 'HPC cluster id, e.g. 11250 (华东一区【昆山】)' },
      command: { type: 'string', required: true, description: 'Shell command to run on the cluster login node' },
      timeout_seconds: { type: 'number', description: 'Remote timeout in seconds (default 30)' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await getClient().execCommand(
        args.cluster_id,
        args.command,
        args.timeout_seconds ?? 30,
      )
      return outputText(result)
    },
  }))
}
```

- [ ] **Step 4: 安装依赖并 typecheck**

```bash
pnpm install && pnpm typecheck
```

Expected: 退出码 0（若 `@deepseek-ai/dsh-tools` 拉不到或类型不匹配，**停下**：把报错原文贴进任务记录并升级为计划偏差——不得改宿主代码绕过）。

- [ ] **Step 5: 跑全部测试确认未破坏**

Run: `pnpm test`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(tools): mat_exec 模型工具（dsh defineTool 注册）"
```

---

### Task 9: profile overlay 与宿主组合

**Files:**
- Create: `$REPO/profiles/mat.yml`

**说明:** LLM 配置行复制自 vasp-matstream-dsh spike 已验证模式（`profiles/spike.yml`：llm-pi-ai + `!!js process.env` + compat.thinkingFormat）。插件行用绝对路径引用本地源码（dsh 教程 `docs/user/develop/basic/index.md`：本地插件经 `--patch` overlay 以绝对 `name` 路径插入）。

- [ ] **Step 1: 写 `profiles/mat.yml`**

```yaml
# mat-dsh M0 overlay：骑在 web profile 之上（--patch）
# LLM 路由模式复制自 vasp-matstream-dsh profiles/spike.yml（2026-08-24 已验证）：
#   自定义 baseURL + apiKeyEnv + compat.thinkingFormat: deepseek
# 注意：llm-pi-ai 行是"替换"（同 id 覆盖 dsh-base 默认行），插件行是 insert。
- id: llm-pi-ai
  config:
    providers:
      mat:
        displayName: HPC LLM
        apiKeyEnv: LLM_API_KEY
        api: openai-completions
        baseURL: !!js process.env.LLM_BASE_URL
        compat:
          thinkingFormat: deepseek
        models:
          - id: !!js process.env.LLM_MODEL_ID
            name: HPC LLM
            contextWindow: 128000
            maxTokens: 8192

- id: agent-default-model
  config:
    provider: mat
    model: !!js process.env.LLM_MODEL_ID

- insert:
    - id: mat-tools
      name: '~/mat-harness/mat-dsh/packages/mat-tools/src/index.ts'
```

- [ ] **Step 2: 确认宿主可运行（spike 已装已建；幂等复查）**

```bash
cd ~/mat-harness/deepseek-harness && pnpm install --frozen-lockfile && pnpm run build
```

Expected: 安装与构建成功（已有产物则快速通过）。若报错，原文记录，勿改宿主源码。

- [ ] **Step 3: 干净 DSH_HOME 组合树自检（不真启动服务）**

```bash
cd ~/mat-harness/deepseek-harness
set -a; source ~/mat-harness/mat-dsh/env.local; set +a
DSH_HOME=/tmp/mat-dsh-m0-home pnpm dsh --profile web --patch ~/mat-harness/mat-dsh/profiles/mat.yml --dump-config > /tmp/mat-dsh-m0-dump.txt 2>&1; echo "exit=$?"
grep -c "mat-tools" /tmp/mat-dsh-m0-dump.txt
```

Expected: `exit=0`；grep 计数 ≥1（插件行出现在组合树）。若 `--dump-config` 不适用于 web profile，改用 `pnpm dsh --profile web --patch ... --no-open` 启动后看启动日志含插件加载（下一步覆盖）。

- [ ] **Step 4: 宿主干净性检查**

```bash
git -C ~/mat-harness/deepseek-harness status --short
```

Expected: 空输出。

- [ ] **Step 5: Commit**

```bash
cd ~/mat-harness/mat-dsh
mkdir -p docs/evidence/m0 && cp /tmp/mat-dsh-m0-dump.txt docs/evidence/m0/task9-dump-config.txt
git add -A && git commit -m "feat(profile): mat overlay（pi-ai 路由 + 本地插件绝对路径加载）"
```

---

### Task 10: 真集群传输冒烟（不经 LLM，先证明 curl 链路）

**Files:**
- Create: `$REPO/scripts/smoke-exec.ts`
- Create（证据）: `$REPO/docs/evidence/m0/task10-smoke-exec.txt`

- [ ] **Step 1: 写 `scripts/smoke-exec.ts`（直接调 mat-core，隔离验证传输层）**

```ts
import { MatClient, outputText } from '../packages/mat-core/src/index'

async function main() {
  const clusterId = process.argv[2] ?? '11250'
  const command = process.argv[3] ?? 'hostname && whoami'
  const client = new MatClient({
    mcpKey: process.env.MAT_MCP_KEY ?? '',
    baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
  })
  const t0 = Date.now()
  const result = await client.execCommand(clusterId, command, 30)
  console.log(`elapsed_ms=${Date.now() - t0}`)
  console.log(`code=${result.code} message=${result.message}`)
  console.log('--- output ---')
  console.log(outputText(result))
}

main().catch((err) => {
  console.error(`SMOKE_FAIL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
```

- [ ] **Step 2: 凭证预检**

```bash
cd ~/mat-harness/mat-dsh
set -a; source env.local; set +a
[ -n "$MAT_MCP_KEY" ] && echo "MAT_MCP_KEY present (len=${#MAT_MCP_KEY})" || echo "MAT_MCP_KEY MISSING"
```

Expected: `present`。若 MISSING：向用户索取（sk- 开头），填入 env.local 后重跑。**不得使用他人密钥。**

- [ ] **Step 3: 冒烟执行并落盘证据**

```bash
pnpm exec tsx scripts/smoke-exec.ts 11250 'hostname && whoami' 2>&1 | tee docs/evidence/m0/task10-smoke-exec.txt; echo "exit=${PIPESTATUS[0]}" | tee -a docs/evidence/m0/task10-smoke-exec.txt
```

Expected: `code=0`，输出含集群主机名与用户名（如 `cn01` / `hpc-user-a`），`exit=0`。失败则按错误分类记录（凭证/网络/网关），证据照落。

> **执行期偏差（2026-08-27，controller 实证裁定）:** 首次冒烟失败 `curl rc=23 body_len=0`。根因：`-D /dev/stderr` 依赖 stderr 可被以写模式打开——Linux 下 stderr 为管道（Node execFile 恒为管道）时 `/proc/self/fd/2` 打开失败，curl 写响应头即中止。Python 原版验证运行时 stderr 为 tty 故未暴露；shell 手测 `2>` 到普通文件同样正常（rc=0，session id 可提取）。**修法：`-D -`（响应头写 stdout 头部）**，Node 实测通过（stdout 575B，session id 与 data 行俱在）。连带：`extractSessionId` 输入从 `result.stderr` 改为 `result.stdout`（头在前，首个匹配即头）；HTTP-000（完全无响应）stdout 仍为空，requireBody 检测不变。相关测试同步更新。

（若 tsx 未装：`pnpm add -D -w tsx` 后重试。）

- [ ] **Step 4: 宿主干净性检查 + Commit**

```bash
git -C ~/mat-harness/deepseek-harness status --short   # 期望空
git add -A && git commit -m "test(smoke): 真集群 exec 冒烟通过（11250 hostname）"
```

---

### Task 11: 端到端验收（web UI 一句话 → 模型调工具 → 真集群执行）+ M0 判定

> **执行期偏差（2026-08-27，用户裁定"不需要我确认"）：** Step 2 的浏览器用户关卡替换为 **headless profile 自动化端到端**（`dsh --profile headless --patch ... "<任务>"` 一次性执行并打印结果——宿主 CLI 自带能力）。web profile 仍按 Step 1 做启动自检（监听 + 无插件加载错误）。证据文件相应更名 `task11-e2e-transcript.md`（同时含 web 启动日志与 headless 端到端记录）。

**Files:**
- Create（证据）: `$REPO/docs/evidence/m0/task11-e2e-transcript.md`
- Create: `$REPO/docs/evidence/m0/m0-verdict.md`

- [ ] **Step 1: 启动 web（干净 DSH_HOME，隔离用户级配置干扰——spike 教训）**

```bash
cd ~/mat-harness/deepseek-harness
set -a; source ~/mat-harness/mat-dsh/env.local; set +a
DSH_HOME=/tmp/mat-dsh-m0-home pnpm dsh web --no-open --patch ~/mat-harness/mat-dsh/profiles/mat.yml
```

后台运行；Expected: 启动日志无插件加载错误，监听 `http://127.0.0.1:3080`。若报 defineTool/cordis 双实例类错误（树外依赖风险）：记录原文，降级路径 = 按 `docs/user/develop/basic/publish.md` 把 mat-tools 装进 `$DSH_HOME/profiles/mat/`（profile 依赖由 pnpm 管理），更新 `profiles/mat.yml` 后重试。

- [ ] **Step 2: UI 验证（用户关卡）**

浏览器打开 `http://127.0.0.1:3080`，输入：

```
用 mat_exec 工具在 11250 集群上执行 hostname && whoami，把结果原样告诉我
```

Expected: 模型调用 `mat_exec`（工具卡片可见），回复包含集群主机名/用户名（与 Task 10 证据一致）。把对话关键截图/文本复制进 `docs/evidence/m0/task11-web-transcript.md`。

若模型未调工具：检查 LLM 路由（启动日志实际使用的 provider/model）、工具是否在 schema 列表（`--dump-config` 组合树），记录后重试一次。

- [ ] **Step 3: 宿主干净性终检**

```bash
git -C ~/mat-harness/deepseek-harness status --short   # 期望空
```

- [ ] **Step 4: 写 M0 判定 `$REPO/docs/evidence/m0/m0-verdict.md`（对照 spec §9 M0 出口判据）**

```markdown
# M0 Spike 判定（日期：执行当日）

| 出口判据 | 结果 | 证据 |
|---|---|---|
| web UI 一句话让模型执行远程命令成功 | PASS/FAIL | docs/evidence/m0/task11-web-transcript.md |
| 传输冒烟（11250 hostname） | PASS/FAIL | docs/evidence/m0/task10-smoke-exec.txt |
| 宿主 git 干净 | PASS/FAIL | `git -C ../deepseek-harness status --short` 输出为空 |
| 全部单测绿 | PASS/FAIL | `pnpm test` 输出（贴末尾摘要） |

## 判定：GO / NO-GO（进入 M1）

## 遗留与发现（进 M1 计划输入）
- （如：树外依赖双实例是否出现及处置；LLM 网关模型 id；断连重试实测表现）
```

- [ ] **Step 5: 全量测试 + Commit**

```bash
cd ~/mat-harness/mat-dsh && pnpm test && pnpm typecheck
git add -A && git commit -m "docs(evidence): M0 端到端验收与 GO/NO-GO 判定"
```

---

### Task 12（可选，不阻塞 GO）: FetchTransport 对 mcp-gateway.example.internal 探测

**Files:**
- Create: `$REPO/scripts/probe-fetch.ts`
- Create（证据）: `$REPO/docs/evidence/m0/task12-probe-fetch.txt`

- [ ] **Step 1: 写探测脚本**

```ts
const url = process.env.MCP_PROBE_URL ?? ''
const key = process.env.MAT_MCP_KEY ?? ''
const full = url || `https://mcp-gateway.example.internal/api/mcp/${key}/7552849000000000000/mcp`

async function main() {
  for (let i = 1; i <= 3; i += 1) {
    const t0 = Date.now()
    try {
      const res = await fetch(full, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const sid = res.headers.get('mcp-session-id')
      const text = (await res.text()).slice(0, 200)
      console.log(`try=${i} status=${res.status} session=${sid ? 'yes' : 'no'} elapsed_ms=${Date.now() - t0} body=${text}`)
    } catch (err) {
      console.log(`try=${i} FETCH_FAIL elapsed_ms=${Date.now() - t0} err=${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

void main()
```

- [ ] **Step 2: 执行并落盘（Node 原生 fetch × 3 次采样）**

```bash
set -a; source env.local; set +a
pnpm exec tsx scripts/probe-fetch.ts 2>&1 | tee docs/evidence/m0/task12-probe-fetch.txt
```

- [ ] **Step 3: 结论记入 m0-verdict.md 遗留节 + Commit**

判定标准（写入 verdict）：3/3 成功 → FetchTransport 可作为 M1 传输备选；否则维持 CurlTransport 唯一路径。

```bash
git add -A && git commit -m "test(spike): Node fetch 对 mcp-gateway.example.internal 探测采样"
```

---

## 自查记录（writing-plans Self-Review）

1. **Spec 覆盖（对照 spec §9 M0 行）:** 仓库骨架+profile+web（Task 1/2/8/9/11）✅；最小 mat_exec 经 CurlTransport 对 11250（Task 3–7 实现、Task 10 直连冒烟、Task 11 经 LLM 端到端）✅；FetchTransport 可选探测（Task 12，标可选）✅；出口判据（Task 11 Step 4 表格逐条对照）✅。
2. **占位符扫描:** 无 TBD/TODO；所有代码步骤含完整代码；验证步骤含确切命令与期望输出。
3. **类型一致性:** `CommandResult`/`CommandRunner`（curl.ts 定义，transport.ts/测试引用一致）；`ExecResult`（client.ts）；`outputText` 签名在 Task 7 定义、Task 8/10 引用一致；`buildCurlArgs` 参数 `{url, body, maxTimeSec, sessionId?}` 各处一致；mat-core 的 `main: ./src/index.ts` 与 workspace 导入一致。
4. **已知不确定点（已在计划内标注处置路径）:** ① `@deepseek-ai/dsh-tools` npm 可得性与类型（Task 8 Step 4 停止条款）；② 树外插件自带依赖的双实例风险（Task 11 Step 1 降级路径）；③ `--dump-config` 对 web profile 的适用性（Task 9 Step 3 备选）；④ LLM_MODEL_ID 须为网关真实 id（env.example 注明 + Task 11 Step 2 排查项）。
