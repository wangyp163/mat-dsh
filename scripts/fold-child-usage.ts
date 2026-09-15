/**
 * 子会话 token 用量折叠（shepherd spike 工程修正 C3）。
 *
 * per-child usage 不在任何 subagent API/job 面上（rc.8 探针结论），但逐事件记在
 * 子会话日志的 assistant/message.usage——本脚本按会话 id 折叠（去重相邻重复事件，
 * 与主会话提取口径一致）。
 *
 * 用法：fold-child-usage.ts <session-id>...   （会话在 $DSH_HOME/sessions 下按根目录分桶搜索）
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const SESSIONS_ROOT = `${process.env.DSH_HOME ?? `${process.env.HOME}/.local/share/dsh`}/sessions`

function findSessionDir(sessionId: string): string | undefined {
  if (!existsSync(SESSIONS_ROOT)) return undefined
  for (const root of readdirSync(SESSIONS_ROOT)) {
    const dir = join(SESSIONS_ROOT, root, sessionId)
    if (existsSync(join(dir, 'session.jsonl.zstd'))) return dir
  }
  return undefined
}

function fold(sessionId: string): void {
  const dir = findSessionDir(sessionId)
  if (dir === undefined) {
    console.log(`${sessionId} NOT_FOUND`)
    return
  }
  const jsonl = execFileSync('zstd', ['-dc', join(dir, 'session.jsonl.zstd')], { maxBuffer: 64 * 1024 * 1024 }).toString()
  const usages: Array<[number, number, number]> = []
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"usage"')) continue
    const m = line.match(/"inputTokens":(\d+),"outputTokens":(\d+),"cacheReadTokens":(\d+)/)
    if (m === null) continue
    const u: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const last = usages[usages.length - 1]
    if (last === undefined || last[0] !== u[0] || last[1] !== u[1] || last[2] !== u[2]) usages.push(u)
  }
  const sumOut = usages.reduce((a, u) => a + u[1], 0)
  const last = usages[usages.length - 1]
  const finalCtx = last === undefined ? 0 : last[0] + last[2]
  console.log(`${sessionId} llm_calls=${usages.length} sum_out=${sumOut} final_ctx≈${finalCtx}`)
}

for (const id of process.argv.slice(2)) fold(id)
