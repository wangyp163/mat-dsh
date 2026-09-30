/**
 * probe-matgen —— matgen MCP 接线前/后的只读探针（probe-before-wiring）。
 *
 * 用法：
 *   scripts/matgen-tunnel.sh start          # 隧道先行（pod 8080 无直连通路）
 *   set -a; source env.local; set +a; tsx scripts/probe-matgen.ts
 *
 * 探针项（全部只读，零副作用）：
 *   P1 /metrics 可达（隧道 + 常驻服务存活，prometheus 文本）
 *   P2 initialize 握手（serverInfo name/version）
 *   P3 tools/list（期望 9 工具：server_info/search_plan/structure_screen/
 *      structure_generate/…/structure_export——2026-09-28 新增导出工具）
 *   P4 tools/call server_info（version / device / queue / upstream providers）
 *
 * 证据落 docs/evidence/（探针先行纪律）。端点可经 env.local 的
 * MATGEN_MCP_URL 覆写（默认隧道 http://127.0.0.1:18080/mcp）。
 */

const URL_ = process.env.MATGEN_MCP_URL || 'http://127.0.0.1:18080/mcp'
const BASE = URL_.replace(/\/mcp\/?$/, '')

let failures = 0
const ok = (label: string, detail: string) => console.log(`[${label}] OK  ${detail}`)
const fail = (label: string, detail: string) => { failures += 1; console.log(`[${label}] FAIL ${detail}`) }

/** streamable-http 的 SSE 响应里取第一条 data: 行的 JSON-RPC result。 */
async function rpc(method: string, params: unknown, sessionId?: string): Promise<{ result?: unknown; session?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  }
  const response = await fetch(URL_, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!(response.status >= 200 && response.status < 300)) {
    throw new Error(`status ${response.status}`)
  }
  const session = response.headers.get('mcp-session-id') ?? undefined
  for (const line of (await response.text()).split('\n')) {
    if (line.startsWith('data: ')) {
      const parsed = JSON.parse(line.slice(6))
      if (parsed.error) throw new Error(JSON.stringify(parsed.error))
      return { result: parsed.result, session }
    }
  }
  return { session }
}

async function main(): Promise<void> {
  console.log(`probe-matgen → ${URL_}\n`)

  // P1 /metrics
  try {
    const r = await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(5_000) })
    const text = await r.text()
    const gauges = [...text.matchAll(/^matgen_(\w+) (\d+)$/gm)].map((m) => `${m[1]}=${m[2]}`).join(' ')
    r.ok && text.includes('matgen_queue_running')
      ? ok('P1', `/metrics 200，${gauges}`)
      : fail('P1', `/metrics rc=${r.status}`)
  } catch (err) {
    fail('P1', `隧道未起？${err instanceof Error ? err.message : err}`)
  }

  // P2 initialize
  let session: string | undefined
  try {
    const { result, session: sid } = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'probe-matgen', version: '0' },
    })
    session = sid
    const info = (result as { serverInfo?: { name?: string; version?: string } }).serverInfo
    info?.name === 'matgen-mcp' && info.version
      ? ok('P2', `serverInfo ${info.name} ${info.version}，session ${sid?.slice(0, 8)}…`)
      : fail('P2', `serverInfo 异常：${JSON.stringify(info)}`)
  } catch (err) {
    fail('P2', err instanceof Error ? err.message : String(err))
  }

  // P3 tools/list
  try {
    if (!session) throw new Error('无会话（P2 未通过）')
    const { result } = await rpc('tools/list', {}, session)
    const tools = ((result as { tools?: Array<{ name: string; description?: string }> }).tools ?? []).map((t) => t.name)
    tools.length === 9
      ? ok('P3', `9 工具：${tools.join(', ')}`)
      : fail('P3', `工具数 ${tools.length}（期望 9）：${tools.join(', ') || '(空)'}`)
  } catch (err) {
    fail('P3', err instanceof Error ? err.message : String(err))
  }

  // P4 tools/call server_info
  try {
    if (!session) throw new Error('无会话（P2 未通过）')
    const { result } = await rpc('tools/call', { name: 'server_info', arguments: {} }, session)
    const raw = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}'
    const info = JSON.parse(raw) as {
      version?: string; device?: { cuda_available?: boolean }; queue?: Record<string, number>
      upstream?: { providers?: string[] }
    }
    info.version && info.device?.cuda_available
      ? ok('P4', `v${info.version} cuda=${info.device.cuda_available} queue=${JSON.stringify(info.queue)} providers=${(info.upstream?.providers ?? []).join('/')}`)
      : fail('P4', `server_info 异常：${raw.slice(0, 200)}`)
  } catch (err) {
    fail('P4', err instanceof Error ? err.message : String(err))
  }

  console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
