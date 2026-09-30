/**
 * 层间结构化契约——batch-subagent spike 工程件 P2。
 *
 * 三个裁决 schema（制备/分诊/解读）：子 agent 文本回传先 extractJson 剥围栏，
 * 再过对应 parse；不过即拒收（上层退回重试一次，防日志与散文倒灌主会话——H5）。
 * 零依赖手写校验（与 mat-core 其它模块同风格，不引入 zod）。
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] }

export interface PrepVerdict {
  schema: 'mat.prep-verdict.v1'
  taskId: string
  ok: boolean
  /** ok=false 必填：制备缺陷一句话。 */
  problem?: string
  /** 制备出的结构描述（xyz 摘要等）。 */
  structure?: string
}

export type TriageFailureClass =
  | 'input'
  | 'convergence'
  | 'resource'
  | 'node'
  | 'infra'
  | 'unknown'

export interface TriageVerdict {
  schema: 'mat.triage-verdict.v1'
  taskId: string
  failureClass: TriageFailureClass
  /** 证据行 ≤5 行、每行 ≤200 字符（日志污染的契约面）。 */
  evidence: string[]
  retryable: boolean
  /** retryable=true 必填：可执行的重试计划。 */
  retryPlan?: string
  estimatedCoreHours?: number
}

export interface InterpretVerdict {
  schema: 'mat.interpret-verdict.v1'
  taskId: string
  converged: boolean
  imaginaryFrequencies: number
  scientificallyUsable: boolean
  /** 一行头条（能量/虚频/判定）。 */
  headline: string
  /** converged=false 而 scientificallyUsable=true 时必填理由；≤5 行。 */
  concerns?: string[]
}

const MAX_EVIDENCE_LINES = 5
const MAX_EVIDENCE_CHARS = 200
const MAX_CONCERNS = 5

/** 剥 ```json 围栏/前后杂文的 JSON 提取；解析失败原样抛出由上层判拒。 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const candidate = fenced !== null ? fenced[1].trim() : text.trim()
  return JSON.parse(candidate)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function expectStringList(v: unknown, name: string, max: number, maxChars: number, issues: string[]): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) {
    issues.push(`${name} must be an array`)
    return undefined
  }
  if (v.length > max) issues.push(`${name} exceeds ${max} entries`)
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') {
      issues.push(`${name} entries must be strings`)
      return undefined
    }
    if (item.length > maxChars) issues.push(`${name} entry exceeds ${maxChars} chars`)
    out.push(item)
  }
  return out
}

export function parsePrepVerdict(input: unknown): ParseResult<PrepVerdict> {
  const issues: string[] = []
  if (!isRecord(input)) return { ok: false, issues: ['payload must be an object'] }
  if (input.schema !== 'mat.prep-verdict.v1') issues.push('schema must be mat.prep-verdict.v1')
  if (typeof input.taskId !== 'string' || input.taskId.length === 0) issues.push('taskId must be non-empty string')
  if (typeof input.ok !== 'boolean') issues.push('ok must be boolean')
  if (input.ok === false && (typeof input.problem !== 'string' || input.problem.length === 0)) {
    issues.push('problem is required when ok=false')
  }
  if (issues.length > 0) return { ok: false, issues }
  const v = input as unknown as PrepVerdict
  return { ok: true, value: { ...v, problem: v.problem, structure: v.structure } }
}

export function parseTriageVerdict(input: unknown): ParseResult<TriageVerdict> {
  const issues: string[] = []
  if (!isRecord(input)) return { ok: false, issues: ['payload must be an object'] }
  if (input.schema !== 'mat.triage-verdict.v1') issues.push('schema must be mat.triage-verdict.v1')
  if (typeof input.taskId !== 'string' || input.taskId.length === 0) issues.push('taskId must be non-empty string')
  const classes: readonly string[] = ['input', 'convergence', 'resource', 'node', 'infra', 'unknown']
  if (typeof input.failureClass !== 'string' || !classes.includes(input.failureClass)) {
    issues.push(`failureClass must be one of ${classes.join('|')}`)
  }
  const evidence = expectStringList(input.evidence, 'evidence', MAX_EVIDENCE_LINES, MAX_EVIDENCE_CHARS, issues)
  if (evidence === undefined && input.evidence !== undefined) return { ok: false, issues }
  if (!Array.isArray(input.evidence)) issues.push('evidence is required')
  if (typeof input.retryable !== 'boolean') issues.push('retryable must be boolean')
  if (input.retryable === true && (typeof input.retryPlan !== 'string' || input.retryPlan.length === 0)) {
    issues.push('retryPlan is required when retryable=true')
  }
  if (input.estimatedCoreHours !== undefined && (typeof input.estimatedCoreHours !== 'number' || input.estimatedCoreHours < 0)) {
    issues.push('estimatedCoreHours must be a non-negative number')
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: input as unknown as TriageVerdict }
}

export function parseInterpretVerdict(input: unknown): ParseResult<InterpretVerdict> {
  const issues: string[] = []
  if (!isRecord(input)) return { ok: false, issues: ['payload must be an object'] }
  if (input.schema !== 'mat.interpret-verdict.v1') issues.push('schema must be mat.interpret-verdict.v1')
  if (typeof input.taskId !== 'string' || input.taskId.length === 0) issues.push('taskId must be non-empty string')
  if (typeof input.converged !== 'boolean') issues.push('converged must be boolean')
  if (
    typeof input.imaginaryFrequencies !== 'number'
    || !Number.isInteger(input.imaginaryFrequencies)
    || input.imaginaryFrequencies < 0
  ) {
    issues.push('imaginaryFrequencies must be a non-negative integer')
  }
  if (typeof input.scientificallyUsable !== 'boolean') issues.push('scientificallyUsable must be boolean')
  if (typeof input.headline !== 'string' || input.headline.length === 0) issues.push('headline must be non-empty string')
  const concerns = expectStringList(input.concerns, 'concerns', MAX_CONCERNS, MAX_EVIDENCE_CHARS, issues)
  if (concerns === undefined && input.concerns !== undefined) return { ok: false, issues }
  if (input.converged === false && input.scientificallyUsable === true && !Array.isArray(input.concerns)) {
    issues.push('concerns is required when converged=false but scientificallyUsable=true')
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: input as unknown as InterpretVerdict }
}

/** 按 payload 自带的 schema 字串路由到对应 parse（update 落库前的统一校验口）。 */
export function parseVerdictBySchema(
  input: unknown,
): ParseResult<PrepVerdict | TriageVerdict | InterpretVerdict> {
  if (typeof input !== 'object' || input === null || !('schema' in input)) {
    return { ok: false, issues: ['payload must be an object with a schema field'] }
  }
  const schema = (input as Record<string, unknown>).schema
  if (schema === 'mat.prep-verdict.v1') return parsePrepVerdict(input)
  if (schema === 'mat.triage-verdict.v1') return parseTriageVerdict(input)
  if (schema === 'mat.interpret-verdict.v1') return parseInterpretVerdict(input)
  return { ok: false, issues: [`unknown verdict schema '${String(schema)}'`] }
}

/**
 * 负裁决阻塞相位推进（R1：契约通过≠工作成功——V9 教训，契约合法但 ok:false
 * 的裁决曾把缺陷任务误推进 prepared）。返回 null=放行；string=阻塞原因。
 * prep ok=false 阻塞；interpret scientificallyUsable=false 阻塞
 * （converged=false 但 usable=true 且带 concerns 是合法形态，不拦）；
 * triage 无成败语义（分类即产出），不拦。
 */
export function negativeVerdictReason(
  v: PrepVerdict | TriageVerdict | InterpretVerdict,
): string | null {
  if (v.schema === 'mat.prep-verdict.v1' && v.ok === false) {
    return `prep ok=false: ${v.problem ?? 'unspecified problem'}`
  }
  if (v.schema === 'mat.interpret-verdict.v1' && v.scientificallyUsable === false) {
    return `interpret scientificallyUsable=false: ${v.headline}`
  }
  return null
}

/** ≤10 行紧凑渲染（主会话消费形态；每类裁决远低于上限）。 */
export function verdictToLines(v: PrepVerdict | TriageVerdict | InterpretVerdict): string[] {
  const lines: string[] = [`${v.schema} ${v.taskId}`]
  if (v.schema === 'mat.prep-verdict.v1') {
    lines.push(v.ok ? 'ok: prepared' : `problem: ${v.problem ?? ''}`)
    if (v.structure !== undefined) lines.push(`structure: ${v.structure}`)
  } else if (v.schema === 'mat.triage-verdict.v1') {
    lines.push(`failureClass: ${v.failureClass}`)
    lines.push(`retryable: ${v.retryable}${v.retryPlan !== undefined ? ` (${v.retryPlan})` : ''}`)
    if (v.estimatedCoreHours !== undefined) lines.push(`estimatedCoreHours: ${v.estimatedCoreHours}`)
    for (const e of v.evidence.slice(0, MAX_EVIDENCE_LINES)) lines.push(`  evidence: ${e}`)
  } else {
    lines.push(`converged: ${v.converged} imaginaryFrequencies: ${v.imaginaryFrequencies} usable: ${v.scientificallyUsable}`)
    lines.push(`headline: ${v.headline}`)
    for (const c of v.concerns ?? []) lines.push(`  concern: ${c}`)
  }
  return lines
}
