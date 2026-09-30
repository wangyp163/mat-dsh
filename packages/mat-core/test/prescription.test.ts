import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createMatDb, formatPrescription, type SqliteConnection } from '../src/db'

/**
 * R5 结构化处方：KbSeed.prescription 入库/回读往返 + 渲染形态
 * （kb_hint 消费的 ladder/decision 两种文本）。
 */

function openDb() {
  const conn = new DatabaseSync(':memory:') as unknown as SqliteConnection
  const db = createMatDb(conn)
  db.migrate()
  return db
}

const IRC_LADDER = [
  { level: 1, route: 'irc(CalcFC,MaxPoints=50,StepSize=5)', when: '第一档' },
  { level: 2, route: 'irc(CalcAll,MaxPoints=50,StepSize=5)', when: '重算 Hessian' },
  { level: 3, route: 'irc(CalcFC,Steep,MaxPoints=50,StepSize=5)', when: '兜底' },
]

describe('formatPrescription', () => {
  it('有序梯渲染为 L1 -> L2 -> L3 并标注每级一次提交', () => {
    expect(formatPrescription(IRC_LADDER))
      .toBe('ladder L1 irc(CalcFC,MaxPoints=50,StepSize=5) -> L2 irc(CalcAll,MaxPoints=50,StepSize=5) -> L3 irc(CalcFC,Steep,MaxPoints=50,StepSize=5) (one submit per rung; exhausted => dead-letter)')
  })

  it('决策行渲染为 IF ... THEN ...', () => {
    const text = formatPrescription([
      { match: '震荡', route: 'recalc=N / calcall' },
      { match: '临界收敛', route: 'MaxCycle 加预算' },
    ])
    expect(text).toBe('decision IF 震荡 THEN recalc=N / calcall | IF 临界收敛 THEN MaxCycle 加预算')
  })
})

describe('kb prescription 入库回读', () => {
  it('upsert 带 prescription → kbLookupByError 命中时携带梯级', () => {
    const db = openDb()
    expect(db.upsertKbEntries([{
      id: 'irc-l123-divergence',
      signature: 'l123\\.exe|Delta-x Convergence NOT Met',
      task: ['irc'],
      versions: ['>=1.4.0'],
      source: 'test',
      path: 'skills/gaussian-calc/references/errors/irc-l123-divergence.md',
      bodyMd: '# x',
      prescription: IRC_LADDER,
    }]).ok).toBe(true)
    const hits = db.kbLookupByError('log: Delta-x Convergence NOT Met')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.prescription).toEqual(IRC_LADDER)
  })

  it('无 prescription 的条目回读为 undefined（不产生空数组噪音）', () => {
    const db = openDb()
    db.upsertKbEntries([{
      id: 'plain', signature: 'fixed', task: [], versions: [], source: '', path: '', bodyMd: '',
    }])
    expect(db.kbLookupByError('has fixed')[0]!.prescription).toBeUndefined()
  })

  it('upsert 幂等覆盖 prescription（md 是源）', () => {
    const db = openDb()
    const seed = {
      id: 'e1', signature: 'fixed', task: [], versions: [], source: '', path: '', bodyMd: '',
      prescription: [{ level: 1, route: 'A' }],
    }
    db.upsertKbEntries([seed])
    db.upsertKbEntries([{ ...seed, prescription: [{ level: 1, route: 'B' }] }])
    expect(db.kbLookupByError('has fixed')[0]!.prescription).toEqual([{ level: 1, route: 'B' }])
  })
})
