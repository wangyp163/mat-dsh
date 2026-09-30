import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  createMatDb,
  frequenciesOf,
  fromCalcflowResult,
  type SqliteConnection,
} from '../src/db'

/**
 * 驱动用 node:sqlite 内存库（DatabaseSync 原生满足 SqliteConnection）。
 * 真实数据取自 contract 回放 fixture——沿 gaussian-replay.test.ts 的
 * 「真实录制优先」纪律（post-ok.stdout.txt 为集群实录）。
 */

function openDb() {
  const conn = new DatabaseSync(':memory:') as unknown as SqliteConnection
  const db = createMatDb(conn)
  db.migrate()
  return db
}

/** 从 post 输出 fixture 提取 calcflow.result.v1 的 JSON 行。 */
function loadFixtureResult(): Record<string, unknown> {
  const raw = readFileSync(new URL('./contract/fixtures/gaussian/post-ok.stdout.txt', import.meta.url), 'utf8')
  const jsonLine = raw.split('\n').find((l) => l.trimStart().startsWith('{'))
  if (!jsonLine) throw new Error('fixture 缺少 result.json 行')
  return JSON.parse(jsonLine) as Record<string, unknown>
}

describe('mat-db（P1 复用飞轮）', () => {
  it('migrate 幂等（重复执行不炸）', () => {
    const conn = new DatabaseSync(':memory:') as unknown as SqliteConnection
    const db = createMatDb(conn)
    db.migrate()
    expect(() => db.migrate()).not.toThrow()
  })

  it('真实 calcflow fixture 入库再查询（h2o-m2-probe / opt+freq / E=-76.409）', () => {
    const db = openDb()
    const parsed = loadFixtureResult()
    const { run, result } = fromCalcflowResult(parsed, { preset: 'medium', jobId: 'slurm-10001', ts: 1_700_000_000_000 })
    expect(run.structure).toBe('h2o-m2-probe')
    expect(db.recordRun(run)).toEqual({ ok: true })
    expect(db.recordResult(result)).toEqual({ ok: true })

    const hits = db.queryPastResults({ structure: 'h2o-m2-probe' })
    expect(hits).toHaveLength(1)
    expect(hits[0].energy).toBeCloseTo(-76.4089539792, 10)
    expect(hits[0].converged).toBe(true)
    expect(hits[0].imaginaryFrequencyCount).toBe(0)
    expect(hits[0].task).toBe('opt+freq')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // R7a：物性扩展字段
  // ─────────────────────────────────────────────────────────────────────────

  it('R7a: fixture 里的 frequencies_cm-1 进 DB，读回为 frequenciesJson', () => {
    const db = openDb()
    const parsed = loadFixtureResult()
    const { result } = fromCalcflowResult(parsed, { ts: 1 })
    // fixture: [1713.1206, 3727.1534, 3849.0866]
    expect(result.frequenciesJson).toBe(JSON.stringify([1713.1206, 3727.1534, 3849.0866]))
    expect(db.recordResult(result)).toEqual({ ok: true })
    const hits = db.queryPastResults({ structure: 'h2o-m2-probe' })
    expect(hits[0].frequenciesJson).toBe(JSON.stringify([1713.1206, 3727.1534, 3849.0866]))
    // frequenciesOf 辅助函数正确解析
    expect(frequenciesOf(hits[0])).toEqual([1713.1206, 3727.1534, 3849.0866])
  })

  it('R7a: 热化学字段从 properties 正确映射（有值时存入，无值时为 null）', () => {
    const db = openDb()
    // 构造一个带完整热化学键的 properties（模拟 workflow 1.6.3+ 输出）
    const parsed = {
      schema_version: 'calcflow.result.v1',
      task: 'opt+freq',
      workdir: '/w/thermo-mol',
      execution: { status: 'completed' },
      properties: {
        energy: -76.41,
        converged: true,
        imaginary_frequency_count: 0,
        'frequencies_cm-1': [1600.0, 3500.0, 3700.0],
        temperature_k: 298.15,
        pressure_atm: 1.0,
        zero_point_correction_hartree: 0.020823,
        thermal_correction_energy_hartree: 0.023637,
        thermal_correction_enthalpy_hartree: 0.024581,
        thermal_correction_gibbs_hartree: 0.001512,
        sum_electronic_zpe_hartree: -76.389177,
        sum_electronic_thermal_hartree: -76.386363,
        sum_electronic_enthalpy_hartree: -76.385419,
        sum_electronic_free_energy_hartree: -76.408488,
      },
    }
    const { result } = fromCalcflowResult(parsed, { ts: 2 })
    expect(result.zeroPointCorrection).toBeCloseTo(0.020823, 6)
    expect(result.thermalCorrectionGibbs).toBeCloseTo(0.001512, 6)
    expect(result.sumElectronicFreeEnergy).toBeCloseTo(-76.408488, 6)
    expect(result.temperatureK).toBe(298.15)
    expect(result.pressureAtm).toBe(1.0)
    expect(db.recordResult(result)).toEqual({ ok: true })
    const hits = db.queryPastResults({ structure: 'thermo-mol' })
    expect(hits[0].zeroPointCorrection).toBeCloseTo(0.020823, 6)
    expect(hits[0].sumElectronicFreeEnergy).toBeCloseTo(-76.408488, 6)
    // 无热化学键时应全为 null（旧版 workflow / 非 freq task）
    const plain = fromCalcflowResult(
      { task: 'sp', workdir: '/w/sp-mol', execution: { status: 'completed' }, properties: { energy: -10.0 } },
      { ts: 3 },
    ).result
    expect(plain.zeroPointCorrection).toBeNull()
    expect(plain.sumElectronicFreeEnergy).toBeNull()
    expect(plain.frequenciesJson).toBeNull()
  })

  it('R7a: plots_json 从 CalcflowResultV1.plots 映射，无 plots 时为 null', () => {
    const db = openDb()
    const withPlots = {
      task: 'opt+freq',
      workdir: '/w/plots-mol',
      execution: { status: 'completed' },
      properties: { energy: -10.0 },
      plots: [{ kind: 'ir_spectrum', image: '/w/plots-mol/ir.png', data: '/w/plots-mol/ir.csv' }],
    }
    const { result } = fromCalcflowResult(withPlots, { ts: 4 })
    expect(result.plotsJson).not.toBeNull()
    const plots = JSON.parse(result.plotsJson!) as unknown[]
    expect(plots).toHaveLength(1)
    expect((plots[0] as Record<string, unknown>).kind).toBe('ir_spectrum')
    expect(db.recordResult(result)).toEqual({ ok: true })
    const hits = db.queryPastResults({ structure: 'plots-mol' })
    expect(hits[0].plotsJson).not.toBeNull()
    // 无 plots 时
    const noPlots = fromCalcflowResult(
      { task: 'sp', workdir: '/w/noplots', execution: { status: 'completed' }, properties: {} },
      { ts: 5 },
    ).result
    expect(noPlots.plotsJson).toBeNull()
  })

  it('R7a: irc_point_count 与 dipole_moment_debye 映射', () => {
    const db = openDb()
    const irc = {
      task: 'irc',
      workdir: '/w/irc-mol',
      execution: { status: 'completed' },
      properties: { converged: true, irc_point_count: 42, dipole_moment_debye: 1.85 },
    }
    const { result } = fromCalcflowResult(irc, { ts: 6 })
    expect(result.ircPointCount).toBe(42)
    expect(result.dipoleMomentDebye).toBeCloseTo(1.85, 5)
    expect(db.recordResult(result)).toEqual({ ok: true })
    const hits = db.queryPastResults({ structure: 'irc-mol' })
    expect(hits[0].ircPointCount).toBe(42)
  })

  it('R7a: migrate 对旧库守卫式补列（R7a 新列在旧库里为 NULL，不影响旧行查询）', () => {
    const conn = new DatabaseSync(':memory:') as unknown as SqliteConnection
    // 模拟 P1 旧库：只有原始 5 列
    conn.exec(`CREATE TABLE results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      structure TEXT NOT NULL, task TEXT NOT NULL,
      energy REAL, converged INTEGER, imaginary_frequency_count INTEGER,
      artifacts_path TEXT, ts INTEGER NOT NULL)`)
    conn.prepare('INSERT INTO results (structure, task, energy, converged, ts) VALUES (?,?,?,?,?)')
      .run('old-mol', 'opt', -10.0, 1, 1)
    // 同时模拟 runs 已有死信列（跳过 runs 补列），kb 表不存在
    conn.exec(`CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, structure TEXT NOT NULL, task TEXT NOT NULL,
      preset TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 1,
      job_id TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, core_hours REAL, ts INTEGER NOT NULL,
      dead_letter INTEGER NOT NULL DEFAULT 0, dead_reason TEXT, dead_kb TEXT)`)
    conn.exec(`CREATE TABLE kb (
      id TEXT PRIMARY KEY, signature TEXT NOT NULL,
      task TEXT NOT NULL DEFAULT '[]', versions TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '',
      body_md TEXT NOT NULL DEFAULT '', prescription TEXT NOT NULL DEFAULT '[]')`)
    const db = createMatDb(conn)
    expect(() => db.migrate()).not.toThrow()
    // 旧行仍在，R7a 新列为 NULL
    const hits = db.queryPastResults({ structure: 'old-mol' })
    expect(hits).toHaveLength(1)
    expect(hits[0].energy).toBeCloseTo(-10.0, 5)
    expect(hits[0].zeroPointCorrection).toBeNull()
    expect(hits[0].frequenciesJson).toBeNull()
    // 新行可正常写入含扩展字段的 result
    expect(db.recordResult({
      structure: 'new-mol', task: 'opt+freq', energy: -20.0, converged: true,
      imaginaryFrequencyCount: 0, artifactsPath: null, ts: 2,
      frequenciesJson: JSON.stringify([1600.0, 3500.0]),
      zeroPointCorrection: 0.02,
    })).toEqual({ ok: true })
    const newHits = db.queryPastResults({ structure: 'new-mol' })
    expect(newHits[0].frequenciesJson).toBe(JSON.stringify([1600.0, 3500.0]))
    expect(newHits[0].zeroPointCorrection).toBeCloseTo(0.02, 5)
  })

  it('frequenciesOf: 坏 JSON/null/非数组 一律返回 []', () => {
    expect(frequenciesOf({ frequenciesJson: null })).toEqual([])
    expect(frequenciesOf({ frequenciesJson: '{bad}' })).toEqual([])
    expect(frequenciesOf({ frequenciesJson: '"notarray"' })).toEqual([])
    expect(frequenciesOf({ frequenciesJson: '[1, "x", 2]' })).toEqual([1, 2]) // 过滤非数字
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 原有测试（保持不变）
  // ─────────────────────────────────────────────────────────────────────────

  it('查询过滤 task 与 limit', () => {
    const db = openDb()
    for (const [task, energy] of [['opt', -10.1], ['opt', -10.2], ['ts', -9.9]] as const) {
      expect(db.recordResult({
        structure: 'MoS2', task, energy, converged: true,
        imaginaryFrequencyCount: 0, artifactsPath: null, ts: 1,
      })).toEqual({ ok: true })
    }
    expect(db.queryPastResults({ structure: 'MoS2', task: 'opt' })).toHaveLength(2)
    expect(db.queryPastResults({ structure: 'MoS2', limit: 1 })).toHaveLength(1)
    expect(db.queryPastResults({ structure: '不存在的体系' })).toHaveLength(0)
  })

  it('非法记录结构化拒绝（不抛异常）', () => {
    const db = openDb()
    const badRun = db.recordRun({ structure: '', task: 'opt', preset: '', attempt: 1, jobId: '', state: 'completed', coreHours: null, ts: 1 })
    expect(badRun.ok).toBe(false)
    if (!badRun.ok) expect(badRun.reason).toMatch(/structure/)
    const badResult = db.recordResult({ structure: 'MoS2', task: '', energy: null, converged: null, imaginaryFrequencyCount: null, artifactsPath: null, ts: 1 })
    expect(badResult.ok).toBe(false)
  })

  it('死信：结算入库后按 job_id 标记，reason/kb 落列（D0 P4）', () => {
    const db = openDb()
    db.recordRun({ structure: 'tsx-att1', task: 'ts', preset: '', attempt: 3, jobId: 'j-9', state: 'failed', coreHours: null, ts: 1 })
    const r = db.markDeadLetter('j-9', 'ladder-exhausted', 'ts-step-limit')
    expect(r).toMatchObject({ ok: true, updated: 1 })
    expect(db.markDeadLetter('不存在', 'x').ok).toBe(false)
    expect(db.markDeadLetter('', '').ok).toBe(false)
  })

  it('死信列迁移：P1 旧库（无死信列）migrate 后补列且旧行保留', () => {
    const conn = new DatabaseSync(':memory:') as unknown as SqliteConnection
    conn.exec(`CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, structure TEXT NOT NULL, task TEXT NOT NULL,
      preset TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 1,
      job_id TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, core_hours REAL, ts INTEGER NOT NULL)`)
    conn.prepare('INSERT INTO runs (structure, task, state, ts) VALUES (?, ?, ?, ?)').run('old', 'opt', 'completed', 1)
    const db = createMatDb(conn)
    expect(() => db.migrate()).not.toThrow()
    db.markDeadLetter // 迁移后方法可用
    expect(db.recordRun({ structure: 'new', task: 'opt', preset: '', attempt: 1, jobId: 'j-x', state: 'failed', coreHours: null, ts: 2 })).toEqual({ ok: true })
    expect(db.markDeadLetter('j-x', 'no-kb').updated).toBe(1)
    const rows = conn.prepare('SELECT COUNT(*) AS c FROM runs').all() as Array<{ c: number }>
    expect(rows[0]!.c).toBe(2) // 旧行仍在
  })

  it('kb 索引：真实 ts-step-limit 签名（正则）命中报错文本', () => {
    const db = openDb()
    const seeded = db.upsertKbEntries([{
      id: 'ts-step-limit',
      signature: 'Optimization stopped\\.|Number of steps exceeded|Error termination request processed by link 9999',
      task: ['tsxtb', 'ts', 'opt', 'irc'],
      versions: ['>=1.5.0'],
      source: '压测 r9 / sobereva.com/164',
      path: 'skills/gaussian-calc/references/ts-step-limit.md',
      bodyMd: '# ts-step-limit',
    }])
    expect(seeded).toEqual({ ok: true })

    const hits = db.kbLookupByError('…log 尾部出现 Error termination request processed by link 9999')
    expect(hits.map((h) => h.id)).toEqual(['ts-step-limit'])
    expect(hits[0].task).toContain('ts')
    expect(db.kbLookupByError('无关文本')).toHaveLength(0)
  })

  it('kb 坏正则容错 + 空签名跳过 + upsert 幂等', () => {
    const db = openDb()
    expect(db.upsertKbEntries([{ id: 'bad-regex', signature: '([unclosed', task: [], versions: [], source: '', path: '', bodyMd: '' }]).ok).toBe(true)
    expect(db.upsertKbEntries([{ id: 'method-entry', signature: '', task: [], versions: [], source: '', path: '', bodyMd: '' }]).ok).toBe(true)
    // 坏正则与空签名（methods 类条目）都不得命中任何文本
    expect(db.kbLookupByError('任何文本')).toHaveLength(0)

    expect(db.upsertKbEntries([{ id: 'bad-regex', signature: 'fixed', task: [], versions: [], source: '', path: '', bodyMd: 'v2' }]).ok).toBe(true)
    const hits = db.kbLookupByError('has fixed inside')
    expect(hits).toHaveLength(1)
    expect(hits[0].bodyMd).toBe('v2')
  })
})
