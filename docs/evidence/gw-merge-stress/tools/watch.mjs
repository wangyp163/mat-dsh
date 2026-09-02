#!/usr/bin/env node
/**
 * Stress-test interaction watchdog.
 * - Connects to the dsh web instance mux WebSocket (server-request frames).
 * - Auto-answers question/requested + approval/requested per fixed policy.
 * - Audit log: ~/stress-run/interactions.jsonl
 */
import WebSocket from '~/.local/share/mat-dsh/profiles/node_modules/ws/index.js'
import { appendFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:3080'
const WS_URL = 'ws://127.0.0.1:3080/api/events.mux'
const LOG = '~/stress-run/interactions.jsonl'

function log(entry) {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry })
  appendFileSync(LOG, line + '\n')
  console.log(line)
}

async function respond(rpcId, result) {
  const body = JSON.stringify({ type: 'client-response', rpcId, result })
  const p = await fetch(`${BASE}/api/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
  const text = await p.text()
  log({ kind: 'respond', rpcId, http: p.status, body: text.slice(0, 200), sent: result })
  return p.ok
}

function pickOption(options, ...needles) {
  for (const n of needles) {
    const hit = options.find(o => (o.label || '').includes(n) || (o.description || '').includes(n))
    if (hit) return hit
  }
  return undefined
}

/** Fixed answer policy. Returns answers array or null (leave for manual). */
function answerQuestion(sessionId, questions) {
  const answers = []
  for (const q of questions) {
    const opts = q.options || []
    // Classify by id+question+header together, language/id agnostic.
    const sig = `${q.id || ''} ${q.question || ''} ${q.header || ''}`
    // cluster choice: id mentions cluster, or text asks which cluster / confirm cluster
    if (/cluster|集群/i.test(sig)) {
      const o = pickOption(opts, '11250', '昆山')
      if (o) { answers.push({ id: q.id, selected: [o.label] }); continue }
    }
    // output dir semantics: which side does ~/workspace/stress/<x>/ mean
    if (/outdir|dir|目录|路径|folder|where/i.test(sig) && /stress|workspace|~\/|哪里|本机|集群|store|save|put/i.test(sig)) {
      const o = pickOption(opts, '集群', 'HOME', 'cluster')
      if (o) { answers.push({ id: q.id, selected: [o.label] }); continue }
    }
    // partition choice
    if (/partition|分区|队列|queue/i.test(sig)) {
      const o = pickOption(opts, 'Agent0')
      if (o) { answers.push({ id: q.id, selected: [o.label] }); continue }
    }
    // how to get the random/disturbed structure
    if (/structure|构型|结构|geometry|坐标/.test(sig) && /随机|random|扰动|怎么|哪个|how|which|提供|生成|generate|provide/i.test(sig)) {
      answers.push({ id: q.id, selected: [], custom: '由你自行生成一个合理的（随机扰动的）构型即可。' })
      continue
    }
    if (/删除|rm|清理|覆盖|挪|mv|delete|remove|overwrite/i.test(sig)) {
      answers.push({ id: q.id, selected: [], custom: '允许，仅限本会话在 ~/workspace/stress/ 下的工作目录内操作。' })
      continue
    }
    if (/核|内存|资源|resource|core|cpu|memory/i.test(sig) && /256|超|确认|over|exceed|limit/i.test(sig)) {
      answers.push({ id: q.id, selected: [], custom: '请按你的建议修正到集群允许的范围后继续，并在最终汇报里说明调整。' })
      continue
    }
    // unmatched -> leave unanswered (manual review)
    log({ kind: 'question-unmatched', sessionId, question: q })
    return null
  }
  return answers
}

function approvalDecision(sessionId, payload) {
  const reason = `${payload.reason || ''} ${payload.toolName || ''}`
  // Allow sandbox escalations that target the stress dirs only.
  if (/escalate sandbox/i.test(reason) || /danger-full-access/.test(reason)) {
    if (/stress|workspace\/stress/.test(reason)) return 'allowed-once'
    // agent wants full access for other paths: reject, force course-correct
    return 'rejected'
  }
  // default for destructive: reject (skill says get confirmation; we are the confirmation)
  return 'rejected'
}

function handleFrame(msg) {
  let frame
  try { frame = JSON.parse(msg) } catch { return }
  if (frame.type !== 'server-request') return
  const { rpcId, method, payload } = frame
  if (method === 'question/requested') {
    const questions = payload?.questions || []
    log({ kind: 'question', sessionId: payload?.sessionId, rpcId, questions })
    const answers = answerQuestion(payload?.sessionId, questions)
    if (answers) {
      respond(rpcId, { ok: true, value: { sessionId: payload.sessionId, answer: { answers } } })
    }
  } else if (method === 'approval/requested') {
    log({ kind: 'approval', sessionId: payload?.sessionId, rpcId, payload })
    const outcome = approvalDecision(payload?.sessionId, payload)
    respond(rpcId, { ok: true, value: { sessionId: payload.sessionId, approvalId: payload.id, outcome } })
  } else if (method && /requested/.test(method)) {
    log({ kind: 'other-request', method, rpcId, payload: JSON.stringify(payload).slice(0, 300) })
  }
}

function connect() {
  const ws = new WebSocket(WS_URL, { headers: { host: '127.0.0.1:3080' } })
  ws.on('open', () => log({ kind: 'ws-open', url: WS_URL }))
  ws.on('message', (data) => { try { handleFrame(data.toString()) } catch (e) { log({ kind: 'error', error: String(e) }) } })
  ws.on('error', (e) => log({ kind: 'ws-error', error: String(e) }))
  ws.on('close', () => {
    log({ kind: 'ws-close' })
    setTimeout(connect, 3000)
  })
}

connect()
