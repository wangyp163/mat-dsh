/**
 * attempts.jsonl 自动记账（审阅表 R3：台账自动记账）。
 *
 * 语义：mat_sbatch 传 attempts_ledger = {file, task, step, attempt?} 即激活——
 * 提交成功拿到 jobId 后自动向远端台账追加一行 submitted JSON（此前是 skill 义务、
 * 靠 agent 手工 echo，忘记账即对账缺口）。写失败旁路不阻塞提交成功返回
 * （对齐 manifest-hook 的旁路范式：记账缺位不连坐计算主链）。
 * 行形状与既有 skill 契约逐字一致：
 *   {"event":"submitted","task":"tsxtb+ts+irc","step":"02-ts","attempt":1,"jobid":1210042}
 */

export interface AttemptsLedgerRef {
  file: string
  task: string
  step: string
  attempt: number
}

/** 工具面 attempts_ledger 参数解析；undefined = 不记账（现有用法零影响）。 */
export function parseAttemptsLedgerRef(raw: unknown): AttemptsLedgerRef | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('attempts_ledger must be an object {file, task, step, attempt?}')
  }
  const o = raw as Record<string, unknown>
  for (const key of ['file', 'task', 'step'] as const) {
    if (typeof o[key] !== 'string' || (o[key] as string).length === 0) {
      throw new Error(`attempts_ledger requires non-empty ${key}`)
    }
  }
  const attempt = o.attempt === undefined ? 1 : o.attempt
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempts_ledger.attempt must be a positive integer (default 1)')
  }
  return { file: o.file as string, task: o.task as string, step: o.step as string, attempt }
}

export function attemptsLedgerLine(ref: AttemptsLedgerRef, jobId: string): string {
  return JSON.stringify({ event: 'submitted', task: ref.task, step: ref.step, attempt: ref.attempt, jobid: jobId })
}

/** 单引号安全化后 printf 追加（JSON 体内的 ' 转义为 '\''）。 */
export function appendAttemptsLineCommand(ref: AttemptsLedgerRef, jobId: string): string {
  const safe = attemptsLedgerLine(ref, jobId).replace(/'/g, `'\\''`)
  return `printf '%s\\n' '${safe}' >> ${ref.file}`
}
