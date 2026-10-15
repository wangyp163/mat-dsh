/**
 * eval-report：P0.5 评测报告器（零 token：全部从会话日志离线提取）。
 *
 * 输入：eval-run 的输出目录（run.json + sessions/<task>/*.jsonl[.zstd] + stdout）
 * 判定：golden task 的 expect 断言（最终答复 + 工具面），指标从事件溯源日志提取：
 *   - steps（step/start 计数，即模型请求数）/ turns / 工具调用按名计数
 *   - token：assistant/chunk 的 usage 求和（inputTokens 每请求全量计）
 *   - 成败底色：turn/end reason.kind（stop=正常收尾）+ 进程 exitCode/超时
 * 输出：<run>/report.md（人读）+ <run>/metrics.json（机读，可作下一轮 --baseline）
 *
 * 用法：pnpm eval:report -- --run docs/evidence/eval/baseline [--baseline <metrics.json>]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { taskById, type GoldenTask } from './eval-golden-tasks.ts'
import { readInput } from './session-debug.ts'

const MAT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : String(process.argv[i + 1] ?? '')
}
const runDir = resolve(MAT_ROOT, argValue('run') ?? 'docs/evidence/eval/run')
const baselinePath = argValue('baseline') ? resolve(MAT_ROOT, argValue('baseline')!) : undefined

// ── 会话日志解析（防御式：字段形态以实测为准，缺字段降级不炸） ─────────────

interface SessionMetrics {
  turns: number
  steps: number
  toolCalls: Record<string, number>
  inputTokens: number
  outputTokens: number
  wallMs: number
  errored: boolean
  errorMessages: string[]
  finalAssistantText: string
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  // 只取 text 块（reasoning/tool-call 块不进最终答复断言）；无 text 块时兜底全取
  const blocks = content.filter((b) => b && typeof b === 'object')
  const textBlocks = blocks.filter((b) => (b as { type?: string }).type === 'text' || (b as { type?: string }).type === undefined)
  const use = textBlocks.length > 0 ? textBlocks : blocks
  return use.map((b) => String((b as { text?: unknown }).text ?? '')).join('')
}

function toolCallName(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  const nested = (d.tool ?? d.call ?? {}) as Record<string, unknown>
  return String(d.name ?? nested.name ?? d.toolName ?? '(unknown)')
}

export function parseSessionMetrics(lineStream: string): SessionMetrics {
  const m: SessionMetrics = {
    turns: 0, steps: 0, toolCalls: {}, inputTokens: 0, outputTokens: 0,
    wallMs: 0, errored: false, errorMessages: [], finalAssistantText: '',
  }
  let firstTime: number | undefined
  let lastTime: number | undefined
  for (const line of lineStream.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let e: { type?: string; time?: number; data?: unknown }
    try {
      e = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof e.time === 'number') {
      firstTime ??= e.time
      lastTime = e.time
    }
    const d = (e.data ?? {}) as Record<string, unknown>
    switch (e.type) {
      case 'turn/start': m.turns += 1; break
      case 'step/start': m.steps += 1; break
      case 'tool/call': {
        const name = toolCallName(d)
        m.toolCalls[name] = (m.toolCalls[name] ?? 0) + 1
        break
      }
      case 'assistant/chunk': {
        const chunk = (d.chunk ?? {}) as Record<string, unknown>
        const usage = chunk.usage as { inputTokens?: number; outputTokens?: number } | undefined
        if (usage) {
          m.inputTokens += usage.inputTokens ?? 0
          m.outputTokens += usage.outputTokens ?? 0
        }
        const reason = chunk.reason as { kind?: string; failure?: { message?: string }; error?: { message?: string } } | undefined
        if (reason?.kind === 'error') {
          m.errored = true
          m.errorMessages.push(String(reason.failure?.message ?? reason.error?.message ?? 'llm error'))
        }
        break
      }
      case 'assistant/message': {
        // 实测形态：data.message.content 块数组（text/reasoning/tool-call 混排）
        const msg = d.message as { content?: unknown; text?: unknown } | undefined
        const text = contentToText(msg?.content ?? d.content ?? d.text)
        if (text.trim() !== '') m.finalAssistantText = text
        break
      }
      case 'turn/end': {
        const reason = d.reason as { kind?: string; error?: { message?: string } } | undefined
        if (reason?.kind === 'error') {
          m.errored = true
          m.errorMessages.push(String(reason.error?.message ?? 'turn error'))
        }
        break
      }
      default: break
    }
  }
  if (firstTime !== undefined && lastTime !== undefined) m.wallMs = lastTime - firstTime
  // 断言前的排版归一化：模型实测会用 Unicode 减号（U+2212）与全角减号（U+FF0D）
  // 写负数（2026-10-15 沙箱 A/B 轮实锤：能量"−76.4090"被 /-76\.40/ 漏判）。
  m.finalAssistantText = m.finalAssistantText.replace(/[\u2212\uFF0D]/g, '-')
  return m
}

// ── 断言引擎 ────────────────────────────────────────────────────────────────

interface AssertionOutcome { pass: boolean; failures: string[] }

function runExpect(task: GoldenTask, m: SessionMetrics, timedOut: boolean, exitCode: number | null): AssertionOutcome {
  const failures: string[] = []
  if (timedOut) failures.push('任务超时被杀')
  if (exitCode !== 0 && exitCode !== null) failures.push(`进程 exit=${exitCode}`)
  if (m.errored) failures.push(`会话报错: ${m.errorMessages[0]?.slice(0, 160)}`)
  if (!m.finalAssistantText.trim()) failures.push('无最终 assistant 答复')

  const final = m.finalAssistantText
  for (const re of task.expect.finalMustMatch ?? []) {
    if (!re.test(final)) failures.push(`finalMustMatch 未命中: ${re}`)
  }
  for (const re of task.expect.finalMustNotMatch ?? []) {
    if (re.test(final)) failures.push(`finalMustNotMatch 命中(不应出现): ${re}`)
  }
  const calledTools = Object.keys(m.toolCalls)
  for (const group of task.expect.toolsAnyOf ?? []) {
    if (!group.some((t) => calledTools.some((c) => c.includes(t)))) {
      failures.push(`toolsAnyOf 全组未出现: [${group.join(' | ')}]（实调: ${calledTools.join(',') || '无'}）`)
    }
  }
  for (const t of task.expect.toolsMustNotAppear ?? []) {
    if (calledTools.some((c) => c.includes(t))) failures.push(`toolsMustNotAppear 出现: ${t}`)
  }
  return { pass: failures.length === 0, failures }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as {
  ranAt: string; provider: string; model: string; lane: string
  results: Array<{ id: string; prompt: string; exitCode: number | null; timedOut: boolean; sessionFiles: string[]; wallSec: number }>
}

interface TaskReport {
  id: string
  pass: boolean
  failures: string[]
  steps: number
  turns: number
  toolCalls: Record<string, number>
  inputTokens: number
  outputTokens: number
  wallSec: number
  sessionFound: boolean
}

const reports: TaskReport[] = []
for (const r of manifest.results) {
  const task = taskById(r.id)
  if (!task) throw new Error(`run.json 里的 ${r.id} 不在 golden task 集中`)
  const sessDir = join(runDir, 'sessions', r.id)
  const files = existsSync(sessDir) ? readdirSync(sessDir).filter((f) => f.includes('.jsonl')) : []
  // 一个任务可能派生子代理会话；主会话取最大的日志（子代理日志更小）
  let metrics: SessionMetrics | undefined
  if (files.length > 0) {
    let best: SessionMetrics | undefined
    let bestSize = -1
    for (const f of files) {
      const text = await readInput(join(sessDir, f))
      const m = parseSessionMetrics(text)
      const size = JSON.stringify(m.toolCalls).length + m.finalAssistantText.length + m.steps
      if (size > bestSize) { bestSize = size; best = m }
    }
    metrics = best
  }
  if (!metrics) {
    metrics = { turns: 0, steps: 0, toolCalls: {}, inputTokens: 0, outputTokens: 0, wallMs: r.wallSec * 1000, errored: true, errorMessages: ['未找到会话日志'], finalAssistantText: '' }
  }
  const outcome = runExpect(task, metrics, r.timedOut, r.exitCode)
  reports.push({
    id: r.id, pass: outcome.pass, failures: outcome.failures,
    steps: metrics.steps, turns: metrics.turns, toolCalls: metrics.toolCalls,
    inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens,
    wallSec: metrics.wallMs ? Math.round(metrics.wallMs / 1000) : r.wallSec,
    sessionFound: files.length > 0,
  })
}

const passCount = reports.filter((x) => x.pass).length
const totalIn = reports.reduce((s, x) => s + x.inputTokens, 0)
const totalOut = reports.reduce((s, x) => s + x.outputTokens, 0)
const metricsJson = {
  ranAt: manifest.ranAt, provider: manifest.provider, model: manifest.model, lane: manifest.lane,
  passRate: reports.length > 0 ? passCount / reports.length : 0,
  totalInputTokens: totalIn, totalOutputTokens: totalOut,
  tasks: reports,
}
writeFileSync(join(runDir, 'metrics.json'), JSON.stringify(metricsJson, null, 2) + '\n')

// ── markdown 报告 ───────────────────────────────────────────────────────────

const lines: string[] = []
lines.push(`# Golden Eval Report — ${runDir}`)
lines.push('')
lines.push(`- 轮次：${manifest.ranAt}｜泳道：${manifest.lane}｜模型：${manifest.provider}/${manifest.model}`)
lines.push(`- 通过：**${passCount}/${reports.length}**｜token：in ${totalIn} / out ${totalOut}`)
if (baselinePath) {
  const base = JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof metricsJson
  lines.push(`- 基线对比（${baselinePath}）：通过 ${base.passRate === undefined ? '?' : `${Math.round(base.passRate * 100)}%`} → ${Math.round(metricsJson.passRate * 100)}%｜token in ${base.totalInputTokens} → ${totalIn}（${totalIn - base.totalInputTokens >= 0 ? '+' : ''}${totalIn - base.totalInputTokens}）`)
}
lines.push('')
lines.push('| task | pass | steps | turns | tok in/out | wall(s) | 工具面 |')
lines.push('|---|---|---|---|---|---|---|')
for (const t of reports) {
  const tools = Object.entries(t.toolCalls).map(([n, c]) => `${n}×${c}`).join(', ') || '—'
  lines.push(`| ${t.id} | ${t.pass ? '✅' : '❌'} | ${t.steps} | ${t.turns} | ${t.inputTokens}/${t.outputTokens} | ${t.wallSec} | ${tools} |`)
}
const failed = reports.filter((t) => !t.pass)
if (failed.length > 0) {
  lines.push('')
  lines.push('## 失败明细')
  for (const t of failed) {
    lines.push('')
    lines.push(`### ${t.id}`)
    for (const f of t.failures) lines.push(`- ${f}`)
    if (!t.sessionFound) lines.push('- （未找到会话日志——查 stdout 排查启动失败）')
  }
}
writeFileSync(join(runDir, 'report.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
