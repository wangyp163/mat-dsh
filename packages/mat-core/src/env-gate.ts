/**
 * 环境门禁判定（constraint-decoupling A1，纯逻辑层）。
 *
 * 背景：门禁判据此前是 gaussian-calc SKILL.md 里约 40 行散文，packages/ 零代码——
 * 约束归位判别式里的「唯一强制型病灶」：投影在（skill 写得很细），权威缺（没有
 * 任何结构可判定的强制）。模型照散文执行时，一次漏判就是一批注定失败的作业。
 *
 * 本模块把散文原文逐条迁成谓词。判定规则照 SKILL.md 门禁节原文：
 *   ok===true && protocol==='new' && missing_tasks 空
 *   && deployed_version===expected_version && errors 空
 * `newer_version` 非空 → warning 透传（新鲜度提醒，不影响 pass）。
 *
 * 三态而非二态：'pass' / 'fail' / 'seed-needed'。seed-needed 是「脚本代数旧或不在」
 * 的形态——SKILL.md 的判旧标准原样迁移：非 JSON、schema 不是 gaussian-env-gate.v2、
 * 或缺 deployed_version/expected_version/newer_version 任一字段（字段集即脚本代数）。
 * 这三种情况下处置动作是播种/刷新脚本，而不是报告环境缺陷——区分它们，模型才不会
 * 把「脚本旧」误报成「环境坏」。
 *
 * 零 IO：远端执行与缓存登记在工具层（env-gate-registry.ts）。
 */

/** 门禁脚本的输出契约 schema（版本即脚本代数锚）。 */
export const ENV_GATE_SCHEMA = 'gaussian-env-gate.v2'

/** VASP 门禁脚本契约（vasp-calc skill 播种；v2 = 家目录部署真探代）。 */
export const VASP_ENV_GATE_SCHEMA = 'vasp-env-gate.v2'

/**
 * 引擎 → 门禁期望 schema（工具层按 engine 选定后再调 parseEnvGateStdout）。
 * abacus 脚本早已 emit abacus-env-gate.v1——此前解析器只认 gaussian schema，
 * engine=abacus 的门禁永远落 seed-needed（documentedOnly 未暴露）；在此一并归位。
 */
export function envGateSchemaFor(engine: string): string {
  if (engine === 'vasp') return VASP_ENV_GATE_SCHEMA
  if (engine === 'abacus') return 'abacus-env-gate.v1'
  return ENV_GATE_SCHEMA
}

/**
 * 脚本代数字段集：三者齐备才算 v2 代脚本。缺任一 → seed-needed。
 * 照 SKILL.md「judged-old 标准」原文：`缺 deployed_version/expected_version/
 * newer_version 字段——字段集即脚本代数`。
 */
export const ENV_GATE_GENERATION_FIELDS = ['deployed_version', 'expected_version', 'newer_version'] as const

/** 门禁脚本单行 JSON 的结构化投影（只取判定要用的字段；其余原样留在 raw）。 */
export interface EnvGateVerdict {
  schema: string
  ok: boolean
  protocol: string
  deployedVersion: string
  expectedVersion: string
  /** 非空 = 旁边有更高版本部署（warning，不影响 pass）。 */
  newerVersion: string
  /** 运行时实际缺失的 task（非空必然 ok=false）。 */
  missingTasks: string[]
  /** 部署侧报的结构化错误码（version_mismatch / g16_env_missing / ...）。 */
  errors: string[]
  /** 部署侧实际注册的 task 集。 */
  tasks: string[]
  /** workflow 根路径（摘要呈现用）。 */
  workflow?: string
  /** g16 runtime env 脚本路径（摘要呈现用）。 */
  g16?: string
}

export type EnvGateStatus = 'pass' | 'fail' | 'seed-needed'

export interface EnvGateParseResult {
  status: EnvGateStatus
  /** status==='pass'|'fail' 时在场（seed-needed 无可信投影）。 */
  verdict?: EnvGateVerdict
  /** status!=='pass' 时的一句话原因（结构化拒绝消息的载荷）。 */
  reason?: string
  /** 非阻塞提醒（newer_version 等），pass 时也可能非空——必须原样转告用户。 */
  warnings: string[]
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 从门禁脚本 stdout 提取首个可解析的单行 JSON。
 *
 * 脚本保证 stdout 只有一行 JSON，但远端 shell 可能混入 source 的噪声行或 MOTD，
 * 故按「首个以 { 开头且可 parse 的行」提取——与 parsePostOutput 同款保守口径。
 */
function extractGateJson(stdout: string): Record<string, unknown> | undefined {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // 非法 JSON 行继续找（与 parsePostOutput 同语义）
    }
  }
  return undefined
}

/**
 * 判定门禁脚本 stdout。
 *
 * @param stdout 远端 `check_environment.sh` 的原始输出（可含噪声行）。
 * @param expectedSchema 期望的 schema 锚（缺省 gaussian v2；vasp 经 envGateSchemaFor 选定）。
 * @returns 三态判定。'pass' 才允许放行集群提交；'fail' 报 errors 原样；
 *          'seed-needed' 指向播种/刷新罕见路径（SKILL.md heredoc 步骤）。
 */
export function parseEnvGateStdout(stdout: string, expectedSchema: string = ENV_GATE_SCHEMA): EnvGateParseResult {
  const warnings: string[] = []

  // SCRIPT_NOT_FOUND 是脚本不在的显式信号——播种路径，不是环境缺陷。
  if (stdout.includes('SCRIPT_NOT_FOUND')) {
    return {
      status: 'seed-needed',
      reason: 'gate script not found on the cluster (SCRIPT_NOT_FOUND) — seed it with the heredoc step, then re-run the gate',
      warnings,
    }
  }

  const raw = extractGateJson(stdout)
  if (raw === undefined) {
    return {
      status: 'seed-needed',
      reason: 'gate stdout carries no single-line JSON — the script is missing or of an older generation; seed/refresh it, then re-run',
      warnings,
    }
  }

  if (raw.schema !== expectedSchema) {
    return {
      status: 'seed-needed',
      reason: `gate JSON schema is '${asString(raw.schema) || '(absent)'}', expected '${expectedSchema}' — older script generation; refresh it, then re-run`,
      warnings,
    }
  }

  // 字段集即脚本代数：三个版本字段缺任一即旧代脚本（SKILL.md 判旧标准原文）。
  const missingFields = ENV_GATE_GENERATION_FIELDS.filter((f) => typeof raw[f] !== 'string')
  if (missingFields.length > 0) {
    return {
      status: 'seed-needed',
      reason: `gate JSON is missing ${missingFields.join('/')} — the field set is the script generation marker; refresh the script, then re-run`,
      warnings,
    }
  }

  const verdict: EnvGateVerdict = {
    schema: asString(raw.schema),
    ok: raw.ok === true,
    protocol: asString(raw.protocol),
    deployedVersion: asString(raw.deployed_version),
    expectedVersion: asString(raw.expected_version),
    newerVersion: asString(raw.newer_version),
    missingTasks: asStringArray(raw.missing_tasks),
    errors: asStringArray(raw.errors),
    tasks: asStringArray(raw.tasks),
    ...(typeof raw.workflow === 'string' ? { workflow: raw.workflow } : {}),
    ...(typeof raw.g16 === 'string' ? { g16: raw.g16 } : {}),
  }

  // newer_version 是新鲜度提醒（warning，不影响 ok）——pass 也要透传给用户。
  if (verdict.newerVersion !== '') {
    warnings.push(
      `newer_version=${verdict.newerVersion} is deployed alongside, while this skill expects ${verdict.expectedVersion}. ` +
      'Continue with this document, but report the notice to the user verbatim so they can decide on an upgrade.',
    )
  }

  // 判定五条（SKILL.md 门禁节原文），逐条收集失败原因而不是首条即返回——
  // 一次门禁跑完应把全部缺陷报齐，避免修一条再跑一轮的往返。
  const failures: string[] = []
  if (!verdict.ok) failures.push('ok=false')
  if (verdict.protocol !== 'new') failures.push(`protocol='${verdict.protocol || '(absent)'}' (expected 'new')`)
  if (verdict.missingTasks.length > 0) failures.push(`missing_tasks=[${verdict.missingTasks.join(', ')}]`)
  if (verdict.deployedVersion !== verdict.expectedVersion) {
    failures.push(`version drift: deployed=${verdict.deployedVersion || '(none)'} expected=${verdict.expectedVersion || '(none)'}`)
  }
  if (verdict.errors.length > 0) failures.push(`errors=[${verdict.errors.join(', ')}]`)

  if (failures.length > 0) {
    return {
      status: 'fail',
      verdict,
      reason: failures.join('; '),
      warnings,
    }
  }

  return { status: 'pass', verdict, warnings }
}

/** 缓存条目：一次 pass 的登记（per host process × cluster × engine）。 */
export interface EnvGateEntry {
  clusterId: string
  engine: string
  verdict: EnvGateVerdict
  /** 登记时刻（epoch ms）。 */
  registeredAt: number
}

/**
 * 新鲜度判定：门禁从 per-session 语义升级为 per-(host 进程, cluster, engine) + TTL。
 *
 * 这个升级本身是一条纪律的机制化：batch 子代理此前靠 batch-roles 的「门禁第一条继承」
 * 散文纪律共享主会话门禁，现在变成进程级缓存的事实——子代理自动继承，无需纪律。
 */
export function isEnvGateFresh(entry: EnvGateEntry | undefined, nowMs: number, maxAgeMs: number): boolean {
  if (entry === undefined) return false
  const age = nowMs - entry.registeredAt
  // 时钟回拨（age<0）保守视为不新鲜：宁可多跑一次零副作用的门禁。
  if (age < 0) return false
  return age <= maxAgeMs
}

/** 单行摘要（pass 时的工具输出形态；键值紧凑，便于模型直读）。 */
export function formatEnvGateSummary(verdict: EnvGateVerdict, engine: string): string {
  const parts = [
    `env gate PASS (${engine})`,
    `version=${verdict.deployedVersion}`,
    `protocol=${verdict.protocol}`,
    `tasks=${verdict.tasks.length}`,
  ]
  if (verdict.workflow !== undefined) parts.push(`workflow=${verdict.workflow}`)
  if (verdict.g16 !== undefined) parts.push(`g16=${verdict.g16}`)
  return parts.join(' ')
}
