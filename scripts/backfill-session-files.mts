/**
 * 会话文件归档台账回填：扫描 DSH_HOME 会话日志（zstd JSONL）里历史的
 * write/edit/mat_download 调用，写入 <DSH_HOME>/mat-files/session-files.json
 * （同路径后写者覆盖；只收仍在磁盘上的文件）。一次性运维脚本——部署会话归档
 * 特性后让既有会话立即有档可看：
 *   npx tsx scripts/backfill-session-files.mts
 */
// 一次性回填：扫描 DSH_HOME 会话日志（zstd JSONL），把 write/edit/mat_download
// 的历史调用写入 session-files.json 台账（同路径后写者覆盖；只收仍在磁盘上的文件）。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const home = '~/.local/share/mat-dsh'
const outPath = join(home, 'mat-files', 'session-files.json')
const projcache = JSON.parse(readFileSync(join(home, 'storages', 'session_projcache.json'), 'utf8'))
const sessions = projcache.tables?.sessions ?? {}
const TOOL_ARGS: Record<string, string> = { write: 'file_path', edit: 'file_path', mat_download: 'local_path' }
// cwd → path → {sessionId, ts}
const byCwd = new Map<string, Map<string, { sessionId: string; ts: number }>>()
let scanned = 0, recorded = 0

for (const [sid, rec] of Object.entries(sessions) as Array<[string, any]>) {
  const cwd = rec?.identity?.cwd
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) continue
  if (!/^session-[A-Za-z0-9-]+$/.test(sid)) continue
  // projectKey（宿主 format.ts 语义）：连续分隔符压成一个 '-'，非法字符 ~HEX，
  // 去前导 '-'，两侧包 '--'。
  let readable = ''
  let separatorRun = false
  for (const ch of cwd) {
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  const projectDir = `--${slug.slice(0, 251)}--`
  const log = join(home, 'sessions', projectDir, sid, 'session.jsonl.zstd')
  const plain = join(home, 'sessions', projectDir, sid, 'session.jsonl')
  let text = ''
  try {
    text = existsSync(log) ? execFileSync('zstd', ['-dc', log], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8')
      : existsSync(plain) ? readFileSync(plain, 'utf8') : ''
  } catch { continue }
  if (text === '') continue
  scanned += 1
  for (const line of text.split('\n')) {
    if (!line.includes('tool/call')) continue
    let ev: any
    try { ev = JSON.parse(line) } catch { continue }
    if (ev?.type !== 'tool/call') continue
    const argKey = TOOL_ARGS[ev?.data?.name]
    if (argKey === undefined) continue
    let args: any
    try { args = JSON.parse(ev.data.arguments) } catch { continue }
    const raw = typeof args?.[argKey] === 'string' ? args[argKey].trim() : ''
    if (raw === '') continue
    const absolute = raw.startsWith('/') ? raw : `${cwd.replace(/\/$/, '')}/${raw}`
    const root = resolve(cwd)
    const target = resolve(absolute)
    const rel = relative(root, target)
    if (rel === '' || rel.startsWith('..')) continue
    try { if (!statSync(target).isFile()) continue } catch { continue }
    const bucket = byCwd.get(root) ?? new Map()
    bucket.set(rel, { sessionId: sid, ts: typeof ev.time === 'number' ? ev.time : Date.now() })
    byCwd.set(root, bucket)
    recorded += 1
  }
}

const files = [...byCwd.entries()].flatMap(([cwd, bucket]) =>
  [...bucket.entries()].map(([path, r]) => ({ cwd, path, sessionId: r.sessionId, ts: r.ts })))
mkdirSync(join(home, 'mat-files'), { recursive: true })
writeFileSync(outPath, JSON.stringify({ files }, null, 1))
console.log(`扫描会话 ${scanned}，记账调用 ${recorded}，台账条目 ${files.length} → ${outPath}`)
