import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

export type DiagnosticKind =
  | 'invalid-json'
  | 'malformed-storage-row'
  | 'seq-gap'
  | 'duplicate-seq'
  | 'out-of-order-seq'
  | 'open-turn'
  | 'open-step'
  | 'unmatched-tool-result'
  | 'unmatched-tool-call'
  | 'tool-error'
  | 'error-event'
  | 'stale-skill-root'

export interface Diagnostic {
  kind: DiagnosticKind
  seq?: number
  detail: string
}

interface TurnReport {
  turn: number
  state: 'open' | 'closed'
  reason?: unknown
  userMessages: string[]
  durationMs: number | null
}

interface StepReport {
  turn: number
  step: number
  state: 'open' | 'closed'
  durationMs: number | null
}

interface ToolReport {
  name: string
  callId: string | null
  turn: number
  step: number
  state: 'matched' | 'failed' | 'unmatched-call' | 'unmatched-result'
  durationMs: number | null
  error?: { name: string; code: string }
  errorDetail?: string
}

export interface SessionReport {
  session: Record<string, unknown>
  storageRows: number
  eventCount: number
  timeSpanMs: number | null
  eventTypes: Record<string, number>
  turns: TurnReport[]
  steps: StepReport[]
  tools: ToolReport[]
  errors: Array<{ type: string; seq: number | null; detail: string }>
  diagnostics: Diagnostic[]
}

type AnyRecord = Record<string, any>

const execFileAsync = promisify(execFile)
const PACKED_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;}]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
]

export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value)
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const result: AnyRecord = {}
    for (const [key, child] of Object.entries(value as AnyRecord)) {
      result[key] = /^(?:authorization|cookie|apiKey|accessToken|refreshToken|password|secret)$/i.test(key)
        ? '[REDACTED]'
        : redact(child)
    }
    return result
  }
  return value
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (isRecord(content)) return textOf(content.content)
  if (!Array.isArray(content)) return ''
  return content.map((part: AnyRecord) => {
    if (typeof part?.text === 'string') return part.text
    return textOf(part?.content)
  }).join('')
}

function stepKey(turn: number, step: number): string {
  return `${turn}/${step}`
}

function packedLength(row: AnyRecord): number | undefined {
  if (!isRecord(row.data)) return undefined
  const values = row.type === 'tool-call-chunks' ? row.data.args : row.data.texts
  const dt = row.data.dt
  if (!Array.isArray(values) || values.length === 0 || values.some(value => typeof value !== 'string')) return undefined
  if (!Array.isArray(dt) || dt.length !== values.length - 1 || dt.some(value => !Number.isSafeInteger(value))) return undefined
  if (!Number.isSafeInteger(row.seq0) || !Number.isSafeInteger(row.time0)) return undefined
  if (!Number.isFinite(row.data.turn) || !Number.isFinite(row.data.step) || !Number.isFinite(row.data.index)) return undefined
  return values.length
}

function expandStorageRow(row: AnyRecord, line: number, diagnostics: Diagnostic[]): AnyRecord[] {
  if (!PACKED_TYPES.has(row.type)) return [row]
  const length = packedLength(row)
  if (length === undefined) {
    diagnostics.push({ kind: 'malformed-storage-row', detail: `line ${line} contains a malformed ${String(row.type)} row` })
    return []
  }
  const values = row.type === 'tool-call-chunks' ? row.data.args as string[] : row.data.texts as string[]
  const events: AnyRecord[] = []
  let time = row.time0 as number
  for (let index = 0; index < length; index++) {
    if (index > 0) time += row.data.dt[index - 1] as number
    const chunk = row.type === 'text-chunks'
      ? { type: 'text-delta', index: row.data.index, text: values[index] }
      : row.type === 'reasoning-chunks'
        ? { type: 'reasoning-delta', index: row.data.index, text: values[index] }
        : {
            type: 'tool-call-delta',
            index: row.data.index,
            id: row.data.id,
            ...(typeof row.data.name === 'string' ? { name: row.data.name } : {}),
            argumentsDelta: values[index],
          }
    events.push({
      type: 'assistant/chunk',
      seq: row.seq0 + index,
      time,
      data: { turn: row.data.turn, step: row.data.step, chunk },
    })
  }
  return events
}

function resultCallId(data: AnyRecord): string | undefined {
  if (typeof data.callId === 'string') return data.callId
  if (typeof data.message?.source?.callId === 'string') return data.message.source.callId
  const block = Array.isArray(data.message?.content)
    ? data.message.content.find((item: AnyRecord) => typeof item?.toolCallId === 'string')
    : undefined
  return block?.toolCallId
}

function resultFailed(data: AnyRecord): boolean {
  if (isRecord(data.error)) return true
  return Array.isArray(data.message?.content)
    && data.message.content.some((item: AnyRecord) => item?.type === 'tool-result' && item.isError === true)
}

function staleSkillRoot(content: string): { name: string; path: string } | undefined {
  const name = content.match(/<skill_content\s+name=["']([^"']+)["']/)?.[1]
  const path = content.match(/Base directory for this skill:\s*(\/tmp\/[^\s<]*\/skills\/[^\s<]+)/)?.[1]
  return name && path ? { name, path } : undefined
}

export function analyzeSession(input: string): SessionReport {
  const diagnostics: Diagnostic[] = []
  const events: AnyRecord[] = []
  let session: AnyRecord = {}
  let storageRows = 0

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    storageRows++
    try {
      const value: unknown = JSON.parse(line)
      if (!isRecord(value)) {
        diagnostics.push({ kind: 'invalid-json', detail: `line ${index + 1} is not a JSON object` })
      } else if (value.type === 'session' && !Object.hasOwn(value, 'seq')) {
        session = redact(value) as AnyRecord
      } else {
        events.push(...expandStorageRow(value, index + 1, diagnostics))
      }
    } catch {
      diagnostics.push({ kind: 'invalid-json', detail: `line ${index + 1} is not valid JSON` })
    }
  }

  const eventTypes: Record<string, number> = {}
  const turns = new Map<number, AnyRecord>()
  const steps = new Map<string, AnyRecord>()
  const calls = new Map<string, AnyRecord>()
  const results = new Map<string, AnyRecord>()
  const errors: SessionReport['errors'] = []
  let activeTurn: number | undefined
  let previousSeq: number | undefined
  let firstTime: number | undefined
  let lastTime: number | undefined

  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : '<missing-type>'
    eventTypes[type] = (eventTypes[type] ?? 0) + 1
    const seq = Number.isSafeInteger(event.seq) ? event.seq as number : undefined
    const time = Number.isSafeInteger(event.time) ? event.time as number : undefined
    if (time !== undefined && type !== 'session/end-seed') {
      firstTime ??= time
      lastTime = time
    }
    if (seq !== undefined) {
      if (previousSeq !== undefined) {
        if (seq === previousSeq) diagnostics.push({ kind: 'duplicate-seq', seq, detail: `sequence ${seq} occurs more than once` })
        else if (seq < previousSeq) diagnostics.push({ kind: 'out-of-order-seq', seq, detail: `sequence ${seq} follows ${previousSeq}` })
        else if (seq > previousSeq + 1) diagnostics.push({ kind: 'seq-gap', seq, detail: `missing sequences ${previousSeq + 1}-${seq - 1}` })
      }
      previousSeq = seq
    }

    const data = isRecord(event.data) ? event.data : {}
    const turn = typeof data.turn === 'number' ? data.turn : activeTurn
    if (type === 'turn/start' && typeof data.turn === 'number') {
      activeTurn = data.turn
      turns.set(data.turn, { start: time, end: undefined, reason: undefined, userMessages: [] })
    } else if (type === 'turn/end' && typeof data.turn === 'number') {
      const item = turns.get(data.turn) ?? { start: undefined, userMessages: [] }
      item.end = time
      item.reason = redact(data.reason)
      turns.set(data.turn, item)
      if (activeTurn === data.turn) activeTurn = undefined
    } else if (type === 'user/message' && turn !== undefined && data.source?.kind === 'user') {
      const item = turns.get(turn) ?? { start: undefined, end: undefined, reason: undefined, userMessages: [] }
      const text = textOf(data.content)
      if (text) item.userMessages.push(redact(text) as string)
      turns.set(turn, item)
    } else if (type === 'step/start' && typeof data.turn === 'number' && typeof data.step === 'number') {
      steps.set(stepKey(data.turn, data.step), { start: time, end: undefined })
    } else if (type === 'step/end' && typeof data.turn === 'number' && typeof data.step === 'number') {
      const item = steps.get(stepKey(data.turn, data.step)) ?? { start: undefined }
      item.end = time
      steps.set(stepKey(data.turn, data.step), item)
    } else if (type === 'tool/call' && typeof data.turn === 'number' && typeof data.step === 'number') {
      const callId = typeof data.callId === 'string' ? data.callId : `anonymous-call:${calls.size}`
      calls.set(callId, { ...data, time, callId })
    } else if (type === 'tool/result' && typeof data.turn === 'number' && typeof data.step === 'number') {
      const callId = resultCallId(data) ?? `anonymous-result:${results.size}`
      results.set(callId, { ...data, time, seq, callId, failed: resultFailed(data) })
    }

    if (/^(?:error|aborted|turn\/error|step\/error)/i.test(type)) {
      const detail = redact(textOf(data.message) || JSON.stringify(data)) as string
      errors.push({ type, seq: seq ?? null, detail })
      diagnostics.push({ kind: 'error-event', seq, detail: `${type}: ${detail}` })
    }
    if (type === 'tool/result') {
      const content = textOf(data.message)
      const stale = staleSkillRoot(content)
      if (stale) diagnostics.push({ kind: 'stale-skill-root', seq, detail: `skill ${stale.name} resolved from temporary path ${stale.path}` })
    }
  }

  const tools: ToolReport[] = []
  for (const [callId, call] of calls) {
    const result = results.get(callId)
    const error = isRecord(result?.error) && typeof result.error.name === 'string' && typeof result.error.code === 'string'
      ? redact({ name: result.error.name, code: result.error.code }) as { name: string; code: string }
      : undefined
    const errorDetail = result?.message ? redact(textOf(result.message)) as string : undefined
    const state: ToolReport['state'] = result ? result.failed ? 'failed' : 'matched' : 'unmatched-call'
    tools.push({
      name: String(call.name ?? '<unknown>'),
      callId: callId.startsWith('anonymous-') ? null : callId,
      turn: call.turn,
      step: call.step,
      state,
      durationMs: result?.time != null && call.time != null ? result.time - call.time : null,
      ...(error ? { error } : {}),
      ...(errorDetail ? { errorDetail } : {}),
    })
    if (!result) diagnostics.push({ kind: 'unmatched-tool-call', detail: `tool call ${callId} (${call.name ?? '<unknown>'}) has no result` })
    else if (result.failed) diagnostics.push({ kind: 'tool-error', seq: result.seq, detail: `tool call ${callId} (${call.name ?? '<unknown>'}) failed${error ? `: ${error.name}/${error.code}` : ''}` })
  }
  for (const [callId, result] of results) {
    if (calls.has(callId)) continue
    tools.push({
      name: '<unknown>',
      callId: callId.startsWith('anonymous-') ? null : callId,
      turn: result.turn,
      step: result.step,
      state: 'unmatched-result',
      durationMs: null,
    })
    diagnostics.push({ kind: 'unmatched-tool-result', detail: `tool result ${callId} has no call` })
  }

  const turnReport: TurnReport[] = []
  for (const [turn, item] of turns) {
    const closed = item.end !== undefined
    if (!closed) diagnostics.push({ kind: 'open-turn', detail: `turn ${turn} has no turn/end` })
    turnReport.push({
      turn,
      state: closed ? 'closed' : 'open',
      ...(item.reason !== undefined ? { reason: item.reason } : {}),
      userMessages: item.userMessages,
      durationMs: item.start != null && item.end != null ? item.end - item.start : null,
    })
  }

  const stepReport: StepReport[] = []
  for (const [identity, item] of steps) {
    const closed = item.end !== undefined
    if (!closed) diagnostics.push({ kind: 'open-step', detail: `step ${identity} has no step/end` })
    const [turn, step] = identity.split('/').map(Number) as [number, number]
    stepReport.push({
      turn,
      step,
      state: closed ? 'closed' : 'open',
      durationMs: item.start != null && item.end != null ? item.end - item.start : null,
    })
  }

  return {
    session,
    storageRows,
    eventCount: events.length,
    timeSpanMs: firstTime != null && lastTime != null ? lastTime - firstTime : null,
    eventTypes,
    turns: turnReport,
    steps: stepReport,
    tools,
    errors,
    diagnostics,
  }
}

function oneLine(value: string, limit = 160): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`
}

function formatDuration(value: number | null): string {
  if (value == null) return 'n/a'
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(1)} s`
}

export function formatTextReport(report: SessionReport): string {
  return [
    'Session:',
    `  id: ${report.session.id ?? '<unknown>'}`,
    `  cwd: ${report.session.cwd ?? '<unknown>'}`,
    `  storage rows / events: ${report.storageRows} / ${report.eventCount}`,
    `  activity span: ${formatDuration(report.timeSpanMs)}`,
    '',
    `Turns (${report.turns.length}):`,
    ...report.turns.map(turn => `  ${turn.turn}: ${turn.state}, ${formatDuration(turn.durationMs)}${turn.userMessages[0] ? ` — ${oneLine(turn.userMessages[0])}` : ''}`),
    '',
    `Steps (${report.steps.length}):`,
    ...report.steps.map(step => `  ${step.turn}/${step.step}: ${step.state}, ${formatDuration(step.durationMs)}`),
    '',
    `Tools (${report.tools.length}):`,
    ...report.tools.map(tool => `  ${tool.name} [${tool.callId ?? 'no-id'}]: ${tool.state}${tool.durationMs == null ? '' : `, ${formatDuration(tool.durationMs)}`}`),
    '',
    `Diagnostics (${report.diagnostics.length}):`,
    ...(report.diagnostics.length ? report.diagnostics.map(diagnostic => `  [${diagnostic.kind}] ${oneLine(diagnostic.detail, 240)}`) : ['  none']),
  ].join('\n')
}

async function readInput(path: string): Promise<string> {
  if (!path.endsWith('.zstd') && !path.endsWith('.zst')) return readFile(path, 'utf8')
  const result = await execFileAsync('zstd', ['-dc', '--', path], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })
  return result.stdout
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const commands = new Set(['inspect', 'timeline', 'tools', 'anomalies', 'report'])
  const command = commands.has(args[0] ?? '') ? args[0] : 'inspect'
  const path = (command === 'inspect' ? args : args.slice(1)).find(arg => !arg.startsWith('-'))
  if (!path || args.includes('--help')) {
    const stream = path ? process.stdout : process.stderr
    stream.write('Usage: session-debug [inspect|timeline|tools|anomalies|report] <session.jsonl|session.jsonl.zstd> [--json]\n')
    process.exitCode = path ? 0 : 2
    return
  }
  const report = analyzeSession(await readInput(path))
  const output = command === 'timeline' ? { session: report.session, turns: report.turns, steps: report.steps }
    : command === 'tools' ? { session: report.session, tools: report.tools }
      : command === 'anomalies' ? { session: report.session, diagnostics: report.diagnostics, errors: report.errors }
        : report
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(output, null, 2)}\n` : `${formatTextReport(report)}\n`)
}

if (process.argv[1]?.endsWith('session-debug.ts')) void main()
