/**
 * kb-sync —— D0 P1.2：references/ 知识库 → mat.db 的 kb 索引同步。
 *
 * 纪律对齐 INDEX.md：**md 是源，表是索引**——本脚本可重复执行（upsert），
 * grep 检索协议不变。frontmatter 只解析已知 schema（id/signature/task/versions/source），
 * 无 frontmatter 或缺 id 的文件（INDEX.md、task-reference.md）跳过并报告。
 *
 * 用法：
 *   pnpm tsx scripts/kb-sync.ts [--db <sqlite路径>] [--references <目录>]
 * 默认：db = ${MAT_FILE_ROOT:-.}/mat.db；references = skills/gaussian-calc/references
 *
 * 程序化调用：import { syncKbToDb }（接线测试用，不经过子进程）。
 */

import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createMatDb, type KbSeed, type PrescriptionStep, type SqliteConnection } from '../packages/mat-core/src/db.ts'

export interface KbSyncReport {
  dbPath: string
  entries: KbSeed[]
  skipped: string[]
}

interface Frontmatter {
  id?: string
  signature?: string
  task?: string[]
  versions?: string[]
  source?: string
  /** R5 结构化处方（单行 JSON 数组：有序梯 {level,route,when} 或决策行 {match,route}）。 */
  prescription?: PrescriptionStep[]
}

/** 仅解析已知 schema 的行式 frontmatter；非 `---` 开头的文件返回 null。 */
export function parseFrontmatter(md: string): Frontmatter | null {
  const lines = md.split('\n')
  if (lines[0]?.trim() !== '---') {
    return null
  }
  const end = lines.indexOf('---', 1)
  if (end === -1) {
    return null
  }
  const fm: Frontmatter = {}
  const unquote = (v: string): string => {
    const t = v.trim()
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
      return t.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"')
    }
    return t
  }
  const parseList = (v: string): string[] => {
    const t = unquote(v).trim()
    if (!t.startsWith('[') || !t.endsWith(']')) {
      return []
    }
    return t.slice(1, -1).split(',').map((s) => unquote(s)).filter((s) => s.length > 0)
  }
  const parsePrescription = (v: string): PrescriptionStep[] | undefined => {
    try {
      const parsed = JSON.parse(v.trim()) as unknown
      if (!Array.isArray(parsed)) return undefined
      const steps = parsed.filter(
        (s): s is PrescriptionStep => typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).route === 'string',
      )
      return steps.length > 0 ? steps : undefined
    } catch {
      return undefined // 坏 JSON 忽略——md 仍是源，正文里的处方表不受影响
    }
  }
  for (const line of lines.slice(1, end)) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (!m) {
      continue
    }
    const [, key, raw] = m
    if (key === 'id') fm.id = unquote(raw)
    else if (key === 'signature') fm.signature = unquote(raw)
    else if (key === 'task') fm.task = parseList(raw)
    else if (key === 'versions') fm.versions = parseList(raw)
    else if (key === 'source') fm.source = unquote(raw)
    else if (key === 'prescription') fm.prescription = parsePrescription(raw)
  }
  return fm
}

function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...collectMarkdownFiles(p))
    } else if (name.endsWith('.md')) {
      out.push(p)
    }
  }
  return out
}

/** 同步 references/ → kb 表（幂等 upsert）。目录不存在抛错，由 CLI 层转退出码。 */
export function syncKbToDb(dbPath: string, refsDir: string, cwd: string): KbSyncReport {
  if (!existsSync(refsDir)) {
    throw new Error(`references 目录不存在: ${refsDir}`)
  }
  if (!existsSync(dirname(dbPath))) {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const conn = new DatabaseSync(dbPath) as unknown as SqliteConnection
  const db = createMatDb(conn)
  db.migrate()

  const entries: KbSeed[] = []
  const skipped: string[] = []
  for (const file of collectMarkdownFiles(refsDir)) {
    const md = readFileSync(file, 'utf8')
    const fm = parseFrontmatter(md)
    if (!fm || !fm.id) {
      skipped.push(file)
      continue
    }
    entries.push({
      id: fm.id,
      signature: fm.signature ?? '',
      task: fm.task ?? [],
      versions: fm.versions ?? [],
      source: fm.source ?? '',
      path: relative(cwd, file),
      bodyMd: md,
      ...(fm.prescription !== undefined ? { prescription: fm.prescription } : {}),
    })
  }

  const result = db.upsertKbEntries(entries)
  if (!result.ok) {
    throw new Error(`kb upsert 失败: ${result.reason}`)
  }
  return { dbPath, entries, skipped }
}

function main(): void {
  const args = process.argv.slice(2)
  const readArg = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const dbPath = readArg('--db') ?? join(process.env.MAT_FILE_ROOT ?? '.', 'mat.db')
  // 默认扫全部已实现引擎（engine.ts implemented）的 references/；--references
  // 可逗号分隔覆盖（单目录用法向后兼容）。
  const refsArg = readArg('--references')
  const refsDirs = refsArg !== undefined
    ? refsArg.split(',')
    : ['gaussian-calc', 'vasp-calc'].map((s) => join(import.meta.dirname ?? '.', '..', 'skills', s, 'references'))

  for (const refsDir of refsDirs) {
    try {
      const report = syncKbToDb(dbPath, refsDir, process.cwd())
      console.log(`[kb-sync] db=${report.dbPath} refs=${refsDir.split('/').slice(-2).join('/')}`)
      console.log(`[kb-sync] 同步 ${report.entries.length} 条:`)
      for (const e of report.entries) {
        console.log(`  ✓ ${e.id}  (task: ${e.task.join(',') || '-'}; signature ${e.signature ? '有' : '空(methods类)'})`)
      }
      if (report.skipped.length) {
        console.log(`[kb-sync] 跳过 ${report.skipped.length} 个无 frontmatter 文件: ${report.skipped.map((f) => f.split('/').pop()).join(', ')}`)
      }
    } catch (err) {
      console.error(`[kb-sync] ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }
}

// 仅在作为脚本直接执行时跑 main（测试 import 时副作用为零）
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
}
