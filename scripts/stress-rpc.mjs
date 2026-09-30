#!/usr/bin/env node
/**
 * stress-rpc —— 压测投放驱动（dsh webserver /api RPC 的最小客户端）。
 *
 * 与浏览器前端同一条黑盒链路：session.create / session.prompt / session.list /
 * session.history。用法（子命令）：
 *   node scripts/stress-rpc.mjs create [cwd]                 → 打印 sessionId
 *   node scripts/stress-rpc.mjs prompt <sid> <text> [queue|steer]
 *   node scripts/stress-rpc.mjs wait <sid> [maxMin=30]       → 轮询至 running=false
 *   node scripts/stress-rpc.mjs history <sid> <out.json>     → 全量事件落盘
 *   node scripts/stress-rpc.mjs tail <sid> [n=40]            → 可读轨迹（事件/工具/文本截断）
 *   node scripts/stress-rpc.mjs running <sid>                → 打印 running 状态
 * 环境：DSH_WEB_URL 默认 http://127.0.0.1:3080
 */
const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
let rpcSeq = 0

async function rpc(method, payload = {}) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `r${++rpcSeq}`, method, payload }),
  })
  const frame = await res.json()
  if (frame.result?.ok !== true) {
    throw new Error(`rpc ${method} failed: ${JSON.stringify(frame.result?.error ?? frame).slice(0, 300)}`)
  }
  return frame.result.value
}

async function isRunning(sid) {
  const v = await rpc('session.list', {})
  const row = v.items.find((s) => s.sessionId === sid)
  if (!row) throw new Error(`session not found: ${sid}`)
  return row.running
}

function renderEvent(e, n) {
  const t = e.type ?? '?'
  const out = []
  const m = e.message ?? e
  const text = m?.content?.map((c) => c.text ?? `[${c.type}]`).join('') ?? ''
  if (t === 'assistant/chunk') return null
  if (String(text).trim()) out.push(String(text).replace(/\n/g, ' ').slice(0, n))
  if (m?.toolCalls) for (const tc of m.toolCalls) out.push(`→ ${tc.name}(${JSON.stringify(tc.args ?? {}).slice(0, 160)})`)
  if (t.includes('tool') && m?.content !== undefined && !String(text).trim()) {
    out.push(`tool result: ${JSON.stringify(m.content).slice(0, 120)}`)
  }
  return out.length ? `[${t}] ${out.join(' | ')}` : `[${t}]`
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'create') {
    const v = await rpc('session.create', rest[0] ? { cwd: rest[0] } : {})
    console.log(v.sessionId)
  } else if (cmd === 'prompt') {
    const [sid, text, mode = 'queue'] = rest
    await rpc('session.prompt', { sessionId: sid, mode, content: [{ type: 'text', text }] })
    console.log('prompt accepted')
  } else if (cmd === 'wait') {
    const [sid, maxMin = '30'] = rest
    const deadline = Date.now() + Number(maxMin) * 60_000
    for (;;) {
      if (!(await isRunning(sid))) { console.log('idle'); return }
      if (Date.now() > deadline) { console.error('TIMEOUT waiting idle'); process.exit(2) }
      await new Promise((r) => setTimeout(r, 5_000))
    }
  } else if (cmd === 'running') {
    console.log(await isRunning(rest[0]))
  } else if (cmd === 'history') {
    const [sid, out] = rest
    const v = await rpc('session.history', { sessionId: sid, maxMessages: 500 })
    const fs = await import('node:fs')
    fs.writeFileSync(out, JSON.stringify(v, null, 1))
    console.log(`events=${v.events.length} -> ${out}`)
  } else if (cmd === 'tail') {
    const [sid, nArg = '40'] = rest
    const v = await rpc('session.history', { sessionId: sid, maxMessages: 500 })
    const lines = v.events.map((e) => renderEvent(e.event ?? e, 200)).filter(Boolean)
    console.log(lines.slice(-Number(nArg)).join('\n'))
  } else {
    console.error('unknown command'); process.exit(1)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
