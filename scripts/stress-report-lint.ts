import { readFileSync } from 'node:fs'

/**
 * 压测报告 lint（SOP 固化第 3 层：工具化验收）——把 §8.2 报告模板与 §6.7 收口
 * 要求从散文变成检查器：缺收口要件（session-debug 摘要表、L0 anomalies 证据、
 * 回滚判定等）报 error 并退出码 1；记录粒度不足（PNG 大小/数据行数等）报 warning。
 * 用法：pnpm stress:report-lint docs/<date>-<slug>-demo-stress-report.md [--json] [--strict]
 */

export interface LintResult {
  errors: string[]
  warnings: string[]
}

interface MarkdownTable {
  headerCells: string[]
  dataRows: string[][]
  raw: string
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const normalize = (cell: string): string => cell.replace(/\s+/g, '').toLowerCase()

const matchesAny = (cells: string[], pattern: RegExp): boolean =>
  cells.some((cell) => pattern.test(normalize(cell)))

/** 解析连续的 `|` 行为 markdown 表；全 `-` 行是分隔行，不计入数据行。 */
function parseTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split('\n')
  const tables: MarkdownTable[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length < 2) {
      current = []
      return
    }
    const toCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    const isSeparator = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s+/g, '')))
    const headerCells = toCells(current[0])
    const dataRows = current.slice(1).map(toCells).filter((cells) => !isSeparator(cells))
    tables.push({ headerCells, dataRows, raw: current.join('\n') })
    current = []
  }
  for (const line of lines) {
    if (/^\s*\|/.test(line)) current.push(line)
    else flush()
  }
  flush()
  return tables
}

function findTable(tables: MarkdownTable[], headerMatch: (cells: string[]) => boolean): MarkdownTable | undefined {
  return tables.find((t) => headerMatch(t.headerCells.map(normalize)))
}

/** case 矩阵与摘要表的必备列：显示名 → 归一化表头匹配模式。 */
const CASE_COLUMNS: Array<[string, RegExp]> = [
  ['case', /case|用例/],
  ['prompt', /prompt/],
  ['session(会话)', /session|会话/],
  ['链路', /链路|chain/],
  ['workdir', /workdir|工作目录/],
  ['job id', /job|作业/],
  ['plots', /plots|图/],
  ['verdict(验收)', /verdict|验收|结论/],
]

const SUMMARY_COLUMNS: Array<[string, RegExp]> = [
  ['session_id', /session/],
  ['turns', /turn/],
  ['未闭合 turn(归因)', /未闭合|闭合/],
  ['tool 失败(fatal/benign)', /fatal|失败/],
  ['errors', /error|错误/],
  ['读数时效', /读数|时效/],
  ['L1 升级与否', /l1|升级/],
  ['轨迹层结论', /结论/],
]

export function lintStressReport(markdown: string): LintResult {
  const errors: string[] = []
  const warnings: string[] = []
  const tables = parseTables(markdown)

  // —— 总体结构与结论（§8.2 第 1 条）
  if (!/总体结论|总结论/.test(markdown) && !/\n#{1,6}[^\n]*结论/.test(markdown)) {
    errors.push('缺总体结论(§8.2:报告须给出总体结论)')
  }
  if (!/版本|version/i.test(markdown)) {
    errors.push('未记录 workflow/skill 版本及版本一致性结论')
  }

  // —— 门禁与链路（§8.2 第 3/4 条、§3.2）
  if (!/门禁|gate/i.test(markdown)) {
    errors.push('缺门禁结论(§8.2:须记录 gate ok/protocol/版本/missing_tasks)')
  }
  const hasOneShot = /一站式/.test(markdown)
  const hasStepwise = /分步/.test(markdown)
  if (!hasOneShot || !hasStepwise) {
    errors.push('链路覆盖说明不全:须同时说明一站式与分步(仅适合其一时显式记录原因,§8.2/§3.2)')
  }

  // —— case 矩阵（§8.2 第 2 条）
  const summaryTable = findTable(tables, (cells) =>
    matchesAny(cells, /session/) && matchesAny(cells, /turn|轮次/) && matchesAny(cells, /结论/))
  const caseMatrix = findTable(tables, (cells) =>
    matchesAny(cells, /case|用例/) && matchesAny(cells, /verdict|验收|结论/))
  const matrixTable = caseMatrix !== summaryTable ? caseMatrix : undefined
  if (!matrixTable) {
    errors.push('缺 case 矩阵(§8.2:case × session × chain × workdir × job id × plots × verdict)')
  } else {
    const missing = CASE_COLUMNS.filter(([, re]) => !matchesAny(matrixTable.headerCells, re)).map(([name]) => name)
    if (missing.length > 0) errors.push(`case 矩阵缺必备列:${missing.join('、')}`)
  }

  if (!/plots/i.test(markdown)) {
    errors.push('缺 plots 产物与数据抽查结果(§8.2)')
  }
  if (!/失败现场|失败与重试|失败/.test(markdown)) {
    errors.push('缺失败现场/重试历史说明(§8.2:零失败也须显式写"无")')
  }

  // —— 问题三分法（§8.2 第 8 条）
  const missingCategories: string[] = []
  if (!/skill|agent/i.test(markdown)) missingCategories.push('skill / agent')
  if (!/workflow/i.test(markdown)) missingCategories.push('workflow')
  if (!/deployment|provider/i.test(markdown)) missingCategories.push('deployment / provider')
  if (missingCategories.length > 0) {
    errors.push(`问题分类缺:${missingCategories.join('、')}(§8.2:三类须逐一给结论)`)
  }

  // —— session-debug 收口（§6.7/§8.2 第 9 条）
  if (!summaryTable) {
    errors.push('压测未收口:未找到 session-debug 摘要表(§6.7:没有摘要表的报告视为未完成)')
  } else {
    const missing = SUMMARY_COLUMNS.filter(([, re]) => !matchesAny(summaryTable.headerCells, re)).map(([name]) => name)
    if (missing.length > 0) errors.push(`session-debug 摘要表缺必备列:${missing.join('、')}`)
    if (summaryTable.dataRows.length === 0) errors.push('session-debug 摘要表无数据行(全部 session 各一行)')
  }
  if (!/anomalies/i.test(markdown)) {
    errors.push('未见 L0 anomalies 轻扫证据(§6.7:全部 session 必跑 anomalies --json)')
  }

  // —— 摘要表覆盖 cross-check：case 矩阵里出现的 session 必须进摘要表
  if (matrixTable && summaryTable) {
    const matrixSessions = [...new Set(matrixTable.raw.match(UUID_RE) ?? [])]
    for (const id of matrixSessions) {
      if (!summaryTable.raw.toLowerCase().includes(id.toLowerCase())) {
        errors.push(`session-debug 摘要表缺 case 矩阵中出现的 session:${id}(§6.7:全部 session 各一行)`)
      }
    }
  }

  // —— 修复建议与回滚判定（§8.2 第 10/11 条）
  if (!/修复建议|回归/.test(markdown)) {
    errors.push('缺修复建议与回归 case(§8.2)')
  }
  if (!/回滚/.test(markdown)) {
    errors.push('缺回滚判定(§8.2:即使不回滚也要显式写判定)')
  }

  // —— 记录粒度（§8.1:PNG 大小 / CSV 数据行数）
  if (!/\d+\s*(kb|mb)/i.test(markdown) && !/数据行/.test(markdown)) {
    warnings.push('建议记录 PNG 大小与 CSV 数据行数(§8.1 每 case 必填)')
  }

  return { errors, warnings }
}

function main(): number {
  const argv = process.argv.slice(2)
  const paths = argv.filter((a) => a !== '--json' && a !== '--strict')
  const asJson = argv.includes('--json')
  const strict = argv.includes('--strict')
  if (paths.length !== 1) {
    console.error('用法:pnpm stress:report-lint <report.md> [--json] [--strict]')
    return 2
  }
  let markdown: string
  try {
    markdown = readFileSync(paths[0]!, 'utf8')
  } catch (error) {
    console.error(`无法读取报告:${(error as Error).message}`)
    return 2
  }
  const result = lintStressReport(markdown)
  const ok = result.errors.length === 0 && (!strict || result.warnings.length === 0)
  if (asJson) {
    console.log(JSON.stringify({ file: paths[0], ok, errors: result.errors, warnings: result.warnings }, null, 2))
  } else {
    if (result.errors.length === 0 && result.warnings.length === 0) console.log('OK:报告满足收口要件')
    for (const message of result.errors) console.log(`[错误] ${message}`)
    for (const message of result.warnings) console.log(`[警告] ${message}`)
    console.log(`${result.errors.length} error, ${result.warnings.length} warning`)
  }
  return ok ? 0 : 1
}

if (process.argv[1]?.endsWith('stress-report-lint.ts')) process.exitCode = main()
