import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMatDb, type SqliteConnection } from '../packages/mat-core/src/db.ts'

import { parseFrontmatter, syncKbToDb } from './kb-sync.ts'

/**
 * R5：frontmatter 的 prescription 键（单行 JSON 数组）解析与同步——
 * 梯进从 KB 散文升级为 kb 表结构化列。
 */

const LADDER_MD = `---
id: irc-l123-divergence
signature: "l123\\\\.exe|Delta-x Convergence NOT Met"
task: [irc, ts+irc]
versions: [">=1.4.0"]
source: test
prescription: [{"level":1,"route":"irc(CalcFC,MaxPoints=50,StepSize=5)","when":"第一档"},{"level":2,"route":"irc(CalcAll,MaxPoints=50,StepSize=5)","when":"重算 Hessian"},{"level":3,"route":"irc(CalcFC,Steep,MaxPoints=50,StepSize=5)","when":"兜底"}]
---

# 正文
`

const DECISION_MD = `---
id: ts-step-limit
signature: "Number of steps exceeded"
task: [ts]
versions: [">=1.5.0"]
source: test
prescription: [{"match":"震荡","route":"recalc=N / calcall"},{"match":"临界收敛","route":"MaxCycle 加预算"}]
---

# 正文
`

const NO_PRESCRIPTION_MD = `---
id: ts-l103-formbx
signature: "FormBX had a problem"
task: [ts]
versions: [">=1.6.0"]
source: test
---

# 正文
`

const BAD_JSON_MD = `---
id: bad-entry
signature: "whatever"
task: []
versions: []
source: test
prescription: [{broken json
---

# 正文
`

describe('parseFrontmatter prescription', () => {
  it('有序梯解析为 {level, route, when}', () => {
    const fm = parseFrontmatter(LADDER_MD)
    expect(fm?.prescription).toEqual([
      { level: 1, route: 'irc(CalcFC,MaxPoints=50,StepSize=5)', when: '第一档' },
      { level: 2, route: 'irc(CalcAll,MaxPoints=50,StepSize=5)', when: '重算 Hessian' },
      { level: 3, route: 'irc(CalcFC,Steep,MaxPoints=50,StepSize=5)', when: '兜底' },
    ])
  })

  it('决策行解析为 {match, route}', () => {
    const fm = parseFrontmatter(DECISION_MD)
    expect(fm?.prescription).toEqual([
      { match: '震荡', route: 'recalc=N / calcall' },
      { match: '临界收敛', route: 'MaxCycle 加预算' },
    ])
  })

  it('无 prescription 键 → undefined；坏 JSON 忽略（md 仍是源）', () => {
    expect(parseFrontmatter(NO_PRESCRIPTION_MD)?.prescription).toBeUndefined()
    expect(parseFrontmatter(BAD_JSON_MD)?.prescription).toBeUndefined()
    expect(parseFrontmatter(BAD_JSON_MD)?.id).toBe('bad-entry')
  })
})

describe('syncKbToDb prescription 同步', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp('/tmp/mat-kb-sync-')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('同步后 kbLookupByError 命中携带处方', async () => {
    const refs = join(root, 'refs')
    await mkdir(refs)
    await writeFile(join(refs, 'irc-l123-divergence.md'), LADDER_MD)
    await writeFile(join(refs, 'ts-step-limit.md'), DECISION_MD)
    await writeFile(join(refs, 'ts-l103-formbx.md'), NO_PRESCRIPTION_MD)
    const report = syncKbToDb(join(root, 'mat.db'), refs, root)
    expect(report.entries).toHaveLength(3)
    expect(report.entries.filter((e) => e.prescription !== undefined)).toHaveLength(2)

    const conn = new DatabaseSync(join(root, 'mat.db')) as unknown as SqliteConnection
    const db = createMatDb(conn)
    const hits = db.kbLookupByError('log 尾 Delta-x Convergence NOT Met')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.prescription?.[0]).toEqual({ level: 1, route: 'irc(CalcFC,MaxPoints=50,StepSize=5)', when: '第一档' })
    expect(db.kbLookupByError('FormBX had a problem')[0]!.prescription).toBeUndefined()
  })
})
