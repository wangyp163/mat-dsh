/**
 * mat-db —— D0 复用飞轮（落地计划 P1：结果可查询、KB 可检索）。
 *
 * 三表：runs（作业台账）/ results（结构化物性）/ kb（知识库索引——**md 是源，表是索引**，
 * references/ 的 grep 检索协议保持不变，本表只是加速层）。驱动经 SqliteConnection 注入
 * （生产：node:sqlite 的 DatabaseSync，Node ≥22.13；测试：同款内存库）——mat-core
 * 维持零运行时依赖纪律，不 import 宿主 API。写入拒绝一律结构化返回（非抛异常），
 * 与 budget.ts 的 BudgetDecision 形态对齐。
 *
 * P1 约定：structure 标签取 workdir 基名（calcflow result.json 无显式体系名字段，
 * goal.json 落地后由调用方显式传入覆盖）。
 */

/** 最小驱动接口——node:sqlite 的 DatabaseSync 原生满足（prepare/exec）。 */
export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  all(...params: unknown[]): Record<string, unknown>[]
  get(...params: unknown[]): Record<string, unknown> | undefined
}

export interface SqliteConnection {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

export interface RunRecord {
  /** 体系标签（P1 约定：workdir 基名）。 */
  structure: string
  task: string
  preset: string
  attempt: number
  jobId: string
  /** slurm 终态：completed / failed / ... */
  state: string
  coreHours: number | null
  /** epoch 毫秒。 */
  ts: number
}

/**
 * results 行的完整读取形态（所有 R7a 扩展字段一律 nullable）——
 * 老库补列后为 NULL，新库未产出时为 NULL，调用方不需要区分。
 */
export interface ResultRecord {
  structure: string
  task: string
  energy: number | null
  converged: boolean | null
  imaginaryFrequencyCount: number | null
  artifactsPath: string | null
  ts: number
  // R7a：热化学（workflow 1.6.3+，freq 系 task）
  zeroPointCorrection: number | null
  thermalCorrectionEnergy: number | null
  thermalCorrectionEnthalpy: number | null
  thermalCorrectionGibbs: number | null
  sumElectronicZpe: number | null
  sumElectronicThermal: number | null
  sumElectronicEnthalpy: number | null
  sumElectronicFreeEnergy: number | null
  temperatureK: number | null
  pressureAtm: number | null
  // R7a：振动/光谱/IRC
  frequenciesJson: string | null   // JSON.stringify(number[])，`frequencies_cm-1`
  ircPointCount: number | null
  dipoleMomentDebye: number | null
  // R7a：plots（PlotEntry[] JSON，当前完全不持久化）
  plotsJson: string | null
}

/**
 * recordResult 的入参：R7a 扩展字段**可选**。
 *
 * 为什么与 ResultRecord 分开：这些字段是 P1 之后新增的，若设为必填，每个
 * 既有调用点都被迫补 14 个 `null`——纯粹的噪声，且掩盖「这个调用点是否真的
 * 知道热化学数据」这一信息。入参可选 = 只说知道的，读取形态完整 = 调用方
 * 不必判 undefined。写入时 `?? null` 归一。
 */
export type ResultRecordInput = Omit<ResultRecord,
  | 'zeroPointCorrection' | 'thermalCorrectionEnergy' | 'thermalCorrectionEnthalpy'
  | 'thermalCorrectionGibbs' | 'sumElectronicZpe' | 'sumElectronicThermal'
  | 'sumElectronicEnthalpy' | 'sumElectronicFreeEnergy' | 'temperatureK' | 'pressureAtm'
  | 'frequenciesJson' | 'ircPointCount' | 'dipoleMomentDebye' | 'plotsJson'
> & Partial<Pick<ResultRecord,
  | 'zeroPointCorrection' | 'thermalCorrectionEnergy' | 'thermalCorrectionEnthalpy'
  | 'thermalCorrectionGibbs' | 'sumElectronicZpe' | 'sumElectronicThermal'
  | 'sumElectronicEnthalpy' | 'sumElectronicFreeEnergy' | 'temperatureK' | 'pressureAtm'
  | 'frequenciesJson' | 'ircPointCount' | 'dipoleMomentDebye' | 'plotsJson'
>>

/**
 * 结构化处方（审阅表 R5：重试按阶梯抓药）：梯进从 KB 散文升级为代码可消费的数据。
 * 有序梯 = {level, route, when}（每级一次提交，按 level 升序走）；
 * 决策行 = {match, route}（按事实/trace 形态选行，route 可为处置指令或转条目引用）。
 */
export interface PrescriptionStep {
  level?: number
  match?: string
  /** 可直接落 pre.json 的参数串，或处置指令（换初猜/转条目 kb:<id>）。 */
  route: string
  when?: string
}

export function formatPrescription(steps: PrescriptionStep[]): string {
  if (steps.every((s) => typeof s.level === 'number')) {
    const ordered = [...steps].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
    return `ladder ${ordered.map((s) => `L${s.level} ${s.route}`).join(' -> ')} (one submit per rung; exhausted => dead-letter)`
  }
  return `decision ${steps.map((s) => `IF ${s.match ?? '?'} THEN ${s.route}`).join(' | ')}`
}

export interface KbSeed {
  id: string
  /** 可对 log 直接 grep 的正则（frontmatter signature 字段，errors/ 必填）。 */
  signature: string
  task: string[]
  versions: string[]
  source: string
  /** 条目 md 文件路径（审计回链）。 */
  path: string
  bodyMd: string
  /** 结构化处方（frontmatter prescription 键，JSON 数组；缺省 = 无结构化梯进）。 */
  prescription?: PrescriptionStep[]
}

export interface PastResultsFilter {
  structure?: string
  task?: string
  limit?: number
}

export type DbWriteResult = { ok: true } | { ok: false; reason: string }

/**
 * calcflow.result.v1 的 properties 面（R7a 扩展）。
 *
 * 远端 gaussian-workflow 早已产出这些键（1.4.0 起 irc_point_count、1.4.3 起
 * dipole/激发能、1.6.3 起热化学十键），此前本地只落 3 个标量、其余全丢。
 * 这里只做「采集已有产出」，不要求远端任何改动。
 *
 * 键名一律取远端原样（snake_case + 单位后缀），不在映射层改名——远端字段名
 * 是跨进程契约，改名会让日后对账无从追溯。
 */
export interface CalcflowProperties {
  energy?: number
  converged?: boolean
  imaginary_frequency_count?: number
  // 振动/光谱/IRC
  'frequencies_cm-1'?: number[]
  irc_point_count?: number
  dipole_moment_debye?: number
  // 热化学十键（freq 系）
  temperature_k?: number
  pressure_atm?: number
  zero_point_correction_hartree?: number
  thermal_correction_energy_hartree?: number
  thermal_correction_enthalpy_hartree?: number
  thermal_correction_gibbs_hartree?: number
  sum_electronic_zpe_hartree?: number
  sum_electronic_thermal_hartree?: number
  sum_electronic_enthalpy_hartree?: number
  sum_electronic_free_energy_hartree?: number
  /** 步骤前缀形态（opt.energy / ts.converged …）与未来新增键。 */
  [key: string]: unknown
}

export interface CalcflowResultV1 {
  schema_version?: string
  task?: string
  workdir?: string
  execution?: { status?: string } | null
  properties?: CalcflowProperties | null
  artifact_manifest?: string | null
  /** 图谱通道（PlotEntry[]：kind/image/data；CSV 是权威数据）。 */
  plots?: unknown[] | null
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  structure TEXT NOT NULL,
  task TEXT NOT NULL,
  preset TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 1,
  job_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  core_hours REAL,
  ts INTEGER NOT NULL,
  dead_letter INTEGER NOT NULL DEFAULT 0,
  dead_reason TEXT,
  dead_kb TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_lookup ON runs(structure, task, ts DESC);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  structure TEXT NOT NULL,
  task TEXT NOT NULL,
  energy REAL,
  converged INTEGER,
  imaginary_frequency_count INTEGER,
  artifacts_path TEXT,
  ts INTEGER NOT NULL,
  -- R7a：热化学（workflow 1.6.3+，freq 系 task）
  zero_point_correction REAL,
  thermal_correction_energy REAL,
  thermal_correction_enthalpy REAL,
  thermal_correction_gibbs REAL,
  sum_electronic_zpe REAL,
  sum_electronic_thermal REAL,
  sum_electronic_enthalpy REAL,
  sum_electronic_free_energy REAL,
  temperature_k REAL,
  pressure_atm REAL,
  -- R7a：振动/光谱/IRC
  frequencies_json TEXT,
  irc_point_count INTEGER,
  dipole_moment_debye REAL,
  -- R7a：plots（PlotEntry[] JSON，当前完全不持久化）
  plots_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_results_lookup ON results(structure, task, ts DESC);

CREATE TABLE IF NOT EXISTS kb (
  id TEXT PRIMARY KEY,
  signature TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '[]',
  versions TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  prescription TEXT NOT NULL DEFAULT '[]'
);
`

function text(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function nullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function nullableBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/** calcflow.result.v1 → {run, result} 两条入库记录（纯映射，不写库）。 */
export function fromCalcflowResult(
  parsed: CalcflowResultV1,
  identity: { structure?: string; preset?: string; jobId?: string; coreHours?: number | null; attempt?: number; ts?: number },
): { run: RunRecord; result: ResultRecord } {
  const structure = identity.structure ?? text(parsed.workdir).split('/').filter(Boolean).pop() ?? ''
  const ts = identity.ts ?? Date.now()
  const props = parsed.properties ?? {}
  const freqs = props['frequencies_cm-1']
  return {
    run: {
      structure,
      task: text(parsed.task),
      preset: identity.preset ?? '',
      attempt: identity.attempt ?? 1,
      jobId: identity.jobId ?? '',
      state: text(parsed.execution?.status) || 'unknown',
      coreHours: identity.coreHours ?? null,
      ts,
    },
    result: {
      structure,
      task: text(parsed.task),
      energy: nullableNumber(props.energy),
      converged: nullableBool(props.converged),
      imaginaryFrequencyCount: nullableNumber(props.imaginary_frequency_count),
      artifactsPath: parsed.artifact_manifest ?? null,
      ts,
      // R7a：热化学十键
      zeroPointCorrection: nullableNumber(props.zero_point_correction_hartree),
      thermalCorrectionEnergy: nullableNumber(props.thermal_correction_energy_hartree),
      thermalCorrectionEnthalpy: nullableNumber(props.thermal_correction_enthalpy_hartree),
      thermalCorrectionGibbs: nullableNumber(props.thermal_correction_gibbs_hartree),
      sumElectronicZpe: nullableNumber(props.sum_electronic_zpe_hartree),
      sumElectronicThermal: nullableNumber(props.sum_electronic_thermal_hartree),
      sumElectronicEnthalpy: nullableNumber(props.sum_electronic_enthalpy_hartree),
      sumElectronicFreeEnergy: nullableNumber(props.sum_electronic_free_energy_hartree),
      temperatureK: nullableNumber(props.temperature_k),
      pressureAtm: nullableNumber(props.pressure_atm),
      // R7a：振动/光谱/IRC
      frequenciesJson: Array.isArray(freqs) && freqs.length > 0 ? JSON.stringify(freqs) : null,
      ircPointCount: nullableNumber(props.irc_point_count),
      dipoleMomentDebye: nullableNumber(props.dipole_moment_debye),
      // R7a：plots
      plotsJson: Array.isArray(parsed.plots) && parsed.plots.length > 0 ? JSON.stringify(parsed.plots) : null,
    },
  }
}

export interface MatDb {
  migrate(): void
  recordRun(entry: RunRecord): DbWriteResult
  recordResult(entry: ResultRecordInput): DbWriteResult
  upsertKbEntries(entries: KbSeed[]): DbWriteResult
  queryPastResults(filter: PastResultsFilter): Array<ResultRecord & { ts: number }>
  /** 报错文本 → 命中的 KB 条目（signature 为正则，逐条 try 容错坏模式；空签名跳过）。 */
  kbLookupByError(errorText: string): KbSeed[]
  /** 死信收口：未知错误/梯进耗尽的重试终止标记（no-workaround——不盲目烧机时）。 */
  markDeadLetter(jobId: string, reason: string, kbId?: string): DbWriteResult & { updated: number }
}

export function createMatDb(conn: SqliteConnection): MatDb {
  return {
    migrate() {
      conn.exec(SCHEMA_SQL)
      // 兼容旧库：守卫式补列（CREATE TABLE IF NOT EXISTS 不会改已有表）
      const runCols = conn.prepare('PRAGMA table_info(runs)').all().map((r) => text(r['name']))
      if (!runCols.includes('dead_letter')) {
        conn.exec('ALTER TABLE runs ADD COLUMN dead_letter INTEGER NOT NULL DEFAULT 0')
      }
      if (!runCols.includes('dead_reason')) {
        conn.exec('ALTER TABLE runs ADD COLUMN dead_reason TEXT')
      }
      if (!runCols.includes('dead_kb')) {
        conn.exec('ALTER TABLE runs ADD COLUMN dead_kb TEXT')
      }
      // R5：kb 表守卫式补列
      const kbCols = conn.prepare('PRAGMA table_info(kb)').all().map((r) => text(r['name']))
      if (!kbCols.includes('prescription')) {
        conn.exec("ALTER TABLE kb ADD COLUMN prescription TEXT NOT NULL DEFAULT '[]'")
      }
      // R7a：results 表守卫式补列（热化学/振动/plots）
      const resCols = conn.prepare('PRAGMA table_info(results)').all().map((r) => text(r['name']))
      const r7Cols: [string, string][] = [
        ['zero_point_correction', 'REAL'],
        ['thermal_correction_energy', 'REAL'],
        ['thermal_correction_enthalpy', 'REAL'],
        ['thermal_correction_gibbs', 'REAL'],
        ['sum_electronic_zpe', 'REAL'],
        ['sum_electronic_thermal', 'REAL'],
        ['sum_electronic_enthalpy', 'REAL'],
        ['sum_electronic_free_energy', 'REAL'],
        ['temperature_k', 'REAL'],
        ['pressure_atm', 'REAL'],
        ['frequencies_json', 'TEXT'],
        ['irc_point_count', 'INTEGER'],
        ['dipole_moment_debye', 'REAL'],
        ['plots_json', 'TEXT'],
      ]
      for (const [col, type] of r7Cols) {
        if (!resCols.includes(col)) {
          conn.exec(`ALTER TABLE results ADD COLUMN ${col} ${type}`)
        }
      }
    },

    recordRun(entry) {
      if (!entry.structure || !entry.task || !entry.state) {
        return { ok: false, reason: `recordRun 需要非空 structure/task/state（收到 ${entry.structure}/${entry.task}/${entry.state}）` }
      }
      conn.prepare(
        `INSERT INTO runs (structure, task, preset, attempt, job_id, state, core_hours, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(entry.structure, entry.task, entry.preset ?? '', entry.attempt ?? 1, entry.jobId ?? '', entry.state, entry.coreHours ?? null, entry.ts)
      return { ok: true }
    },

    recordResult(entry: ResultRecordInput) {
      if (!entry.structure || !entry.task) {
        return { ok: false, reason: `recordResult 需要非空 structure/task（收到 ${entry.structure}/${entry.task}）` }
      }
      conn.prepare(
        `INSERT INTO results (
           structure, task, energy, converged, imaginary_frequency_count, artifacts_path, ts,
           zero_point_correction, thermal_correction_energy, thermal_correction_enthalpy,
           thermal_correction_gibbs, sum_electronic_zpe, sum_electronic_thermal,
           sum_electronic_enthalpy, sum_electronic_free_energy, temperature_k, pressure_atm,
           frequencies_json, irc_point_count, dipole_moment_debye, plots_json
         ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?, ?,?,?,?)`,
      ).run(
        entry.structure, entry.task,
        entry.energy ?? null,
        entry.converged == null ? null : entry.converged ? 1 : 0,
        entry.imaginaryFrequencyCount ?? null,
        entry.artifactsPath ?? null,
        entry.ts,
        entry.zeroPointCorrection ?? null,
        entry.thermalCorrectionEnergy ?? null,
        entry.thermalCorrectionEnthalpy ?? null,
        entry.thermalCorrectionGibbs ?? null,
        entry.sumElectronicZpe ?? null,
        entry.sumElectronicThermal ?? null,
        entry.sumElectronicEnthalpy ?? null,
        entry.sumElectronicFreeEnergy ?? null,
        entry.temperatureK ?? null,
        entry.pressureAtm ?? null,
        entry.frequenciesJson ?? null,
        entry.ircPointCount ?? null,
        entry.dipoleMomentDebye ?? null,
        entry.plotsJson ?? null,
      )
      return { ok: true }
    },

    upsertKbEntries(entries) {
      // signature 仅 errors/ 条目必填（INDEX.md schema）；methods 类允许为空——
      // kbLookupByError 对空签名跳过，不会误匹配
      for (const e of entries) {
        if (!e.id) {
          return { ok: false, reason: `kb 条目需要非空 id（收到 ${e.id}）` }
        }
      }
      for (const e of entries) {
        conn.prepare(
          `INSERT INTO kb (id, signature, task, versions, source, path, body_md, prescription)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             signature = excluded.signature, task = excluded.task,
             versions = excluded.versions, source = excluded.source,
             path = excluded.path, body_md = excluded.body_md,
             prescription = excluded.prescription`,
        ).run(e.id, e.signature, JSON.stringify(e.task ?? []), JSON.stringify(e.versions ?? []), e.source ?? '', e.path ?? '', e.bodyMd ?? '', JSON.stringify(e.prescription ?? []))
      }
      return { ok: true }
    },

    queryPastResults(filter) {
      const where: string[] = []
      const params: unknown[] = []
      if (filter.structure) {
        where.push('structure = ?')
        params.push(filter.structure)
      }
      if (filter.task) {
        where.push('task = ?')
        params.push(filter.task)
      }
      const limit = typeof filter.limit === 'number' && filter.limit > 0 ? filter.limit : 50
      const sql = `SELECT * FROM results ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC LIMIT ?`
      return conn.prepare(sql).all(...params, limit).map(rowToResult)
    },

    markDeadLetter(jobId, reason, kbId) {
      if (!jobId || !reason) {
        return { ok: false, updated: 0, reason: `markDeadLetter 需要非空 jobId/reason（收到 ${jobId}/${reason}）` }
      }
      const r = conn.prepare(
        'UPDATE runs SET dead_letter = 1, dead_reason = ?, dead_kb = ? WHERE job_id = ?',
      ).run(reason, kbId ?? null, jobId)
      if (r.changes === 0) {
        return { ok: false, updated: 0, reason: `runs 表中不存在 job_id=${jobId}（先经 producer 结算入库再标死信）` }
      }
      return { ok: true, updated: r.changes }
    },

    kbLookupByError(errorText) {
      const rows = conn.prepare('SELECT * FROM kb').all()
      const hits: KbSeed[] = []
      for (const row of rows) {
        const signature = text(row['signature'])
        if (!signature) {
          continue // methods 类条目 signature 为空——空正则会匹配一切，必须跳过
        }
        let matched = false
        try {
          matched = new RegExp(signature).test(errorText)
        } catch {
          matched = false
        }
        if (matched) {
          hits.push(rowToKb(row))
        }
      }
      return hits
    },
  }
}

function rowToResult(row: Record<string, unknown>): ResultRecord & { ts: number } {
  return {
    structure: text(row['structure']),
    task: text(row['task']),
    energy: nullableNumber(row['energy']),
    converged: row['converged'] == null ? null : Number(row['converged']) === 1,
    imaginaryFrequencyCount: nullableNumber(row['imaginary_frequency_count']),
    artifactsPath: row['artifacts_path'] == null ? null : text(row['artifacts_path']),
    ts: nullableNumber(row['ts']) ?? 0,
    // R7a：老库补列后这些键存在但为 NULL，nullableNumber 一律回落 null
    zeroPointCorrection: nullableNumber(row['zero_point_correction']),
    thermalCorrectionEnergy: nullableNumber(row['thermal_correction_energy']),
    thermalCorrectionEnthalpy: nullableNumber(row['thermal_correction_enthalpy']),
    thermalCorrectionGibbs: nullableNumber(row['thermal_correction_gibbs']),
    sumElectronicZpe: nullableNumber(row['sum_electronic_zpe']),
    sumElectronicThermal: nullableNumber(row['sum_electronic_thermal']),
    sumElectronicEnthalpy: nullableNumber(row['sum_electronic_enthalpy']),
    sumElectronicFreeEnergy: nullableNumber(row['sum_electronic_free_energy']),
    temperatureK: nullableNumber(row['temperature_k']),
    pressureAtm: nullableNumber(row['pressure_atm']),
    frequenciesJson: row['frequencies_json'] == null ? null : text(row['frequencies_json']),
    ircPointCount: nullableNumber(row['irc_point_count']),
    dipoleMomentDebye: nullableNumber(row['dipole_moment_debye']),
    plotsJson: row['plots_json'] == null ? null : text(row['plots_json']),
  }
}

/** 解析 results 行的 frequencies_json 为数字数组（坏 JSON/非数组一律空数组）。 */
export function frequenciesOf(record: Pick<ResultRecord, 'frequenciesJson'>): number[] {
  if (record.frequenciesJson == null) return []
  try {
    const parsed = JSON.parse(record.frequenciesJson) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []
  } catch {
    return []
  }
}

function rowToKb(row: Record<string, unknown>): KbSeed {
  const parseList = (v: unknown): string[] => {
    try {
      const parsed = JSON.parse(text(v))
      return Array.isArray(parsed) ? parsed.map(text) : []
    } catch {
      return []
    }
  }
  let prescription: PrescriptionStep[] | undefined
  try {
    const parsed = JSON.parse(text(row['prescription']))
    if (Array.isArray(parsed)) {
      const steps = parsed.filter(
        (s): s is PrescriptionStep => typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).route === 'string',
      )
      prescription = steps.length > 0 ? steps : undefined
    }
  } catch {
    prescription = undefined
  }
  return {
    id: text(row['id']),
    signature: text(row['signature']),
    task: parseList(row['task']),
    versions: parseList(row['versions']),
    source: text(row['source']),
    path: text(row['path']),
    bodyMd: text(row['body_md']),
    ...(prescription !== undefined ? { prescription } : {}),
  }
}
