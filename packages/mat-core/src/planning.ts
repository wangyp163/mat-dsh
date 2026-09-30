/**
 * aimater 规划引擎原型（D0 P3a：agent 侧先行，纯模块 + 零宿主依赖）。
 *
 * 契约（D2）：agent(LLM) 产 goal.json（意图→结构化目标）；本引擎【无 LLM】
 * plan(goal) → plan.json（展开的波次 DAG + 关键参数 + 复用标记）+ questions[]
 * （结构化澄清项）。澄清环协议：questions 是结构化选项（O2 形态——选项带推荐与
 * 风险、阻塞式），agent 转述 → 用户答 → 修 goal → re-plan；确认后的 plan 交
 * engine 执行（E1 托管）。
 *
 * 落进本模块的生产纪律（出处见 gaussian-calc SKILL.md）：
 * - 波间门：ts 波 = converged 且 imaginary_frequency_count==1 才许接 IRC（M22）；
 * - 初猜不足先 tsxtb（M16：ts 找不到的过渡态用 QST2 也绝无可能找到）；
 * - 奇电子必须偶数 mult（M15 硬校验前移到规划期，pre 之前就问清）；
 * - partition 计费相关不自动选（Step 0/O2）；
 * - qst2/qst3 不主动引导，用户点名才采纳（M16）。
 *
 * 复用决策：deps.past 查询（P1 mat-db 的 results 查询注入）。P3a 匹配语义 =
 * (label, waveTask, converged==true) 精确命中；方法/基组级匹配待 goal 时代
 * db schema 扩列后升级（TODO-P3b）。
 *
 * 参数模板承载面（task 构建器，2026-09-19）：method.route_kwargs（并入
 * calculator_kwargs；路由键仅 task 自身路由集放行，其余编译期拒绝）+
 * resources.ncores/memory/walltime（覆盖默认资源档；ncores 同步 slurm 槽位，
 * walltime 优先于 accuracy 档位）。
 */

import { estimateCoreHoursFromRunJson } from './confirmation.ts'
import { defaultPreJson, defaultRunJson } from './gaussian.ts'

// ---------------------------------------------------------------------------
// goal（输入契约；JSON Schema 见 goal-schema.json，此处为运行时类型+手工校验）
// ---------------------------------------------------------------------------

export type GoalWant =
  | 'optimize' | 'frequencies' | 'energy' | 'spectrum-ir' | 'dipole'
  | 'polarizability' | 'td' | 'fluorescence' | 'resp-charges' | 'aea'
  | 'ts' | 'irc' | 'reaction-path'

export interface Goal {
  schema_version?: string
  structure?: { label?: string; xyz?: string; source?: string }
  intent: { want: string[]; reaction?: { reactants_xyz?: string; products_xyz?: string; description?: string } }
  method?: { method?: string; basis?: string; route_kwargs?: Record<string, unknown> }
  charge?: number
  mult?: number
  accuracy?: 'fast' | 'medium' | 'slow'
  resources?: { partition?: string; max_core_hours?: number; ncores?: number; memory?: string; walltime?: string }
  context?: { prior_result_ref?: string }
}

// ---------------------------------------------------------------------------
// plan（输出契约）
// ---------------------------------------------------------------------------

export interface PlanWave {
  id: number
  task: string
  dependsOn: number[]
  /** 波间结构化门（settle 后判，不满足不进下一波）。字段语义见 TaskPackageWave.gate。 */
  gate: {
    converged: boolean
    imaginary_frequency_count?: number
    min_real_frequency_cm1?: number
    irc_direction_check?: boolean
  } | null
  reusable: boolean
  reuseRef?: { task: string; energy: number | null; artifactsPath: string | null }
}

export interface PlanQuestionOption {
  label: string
  value: string
  note?: string
}

export interface PlanQuestion {
  id: string
  kind: 'structure' | 'mult' | 'partition'
  prompt: string
  options: PlanQuestionOption[]
  blocking: boolean
}

export interface AimaterPlan {
  schema_version: 'aimater.plan.v1'
  status: 'ready' | 'needs_clarification'
  task: string
  waves: PlanWave[]
  concurrency: { max_parallel: number }
  preJson: Record<string, unknown>
  runJson: Record<string, unknown>
  estimatedCoreHours: number | null
  assumptions: string[]
  questions: PlanQuestion[]
}

export interface PlanningDeps {
  /** 复用查询（注入 mat-db 的 queryPastResults 投影；缺省=无历史可用）。 */
  past?: (structureLabel: string, task: string) => Array<{ task: string; converged: boolean | null; energy: number | null; artifactsPath: string | null }>
}

export interface PlanResult {
  status: 'ready' | 'needs_clarification' | 'invalid'
  plan?: AimaterPlan
  errors: string[]
}

// ---------------------------------------------------------------------------
// 原子 task 注册表（单一真相源；组合 task 由此推导，无需手写条目）
// ---------------------------------------------------------------------------

/**
 * TS 波的最小真实振动频率下限（cm⁻¹，R7b）。
 *
 * 10 cm⁻¹ 的依据：低于此量级的"真实"频率通常是残留平动/转动模式或平台区
 * 的数值噪声，不是可信的振动自由度。一个干净的一阶鞍点应当只有一个虚频、
 * 其余全是量级正常的实频。
 *
 * 缺 `frequencies_cm-1` 数组时此门自动跳过（旧版 workflow 不产此键）。
 */
export const TS_MIN_REAL_FREQ_CM1 = 10

type KbCoverage = 'ladder' | 'decision' | 'none'

interface AtomicTaskSpec {
  /**
   * 几帧 xyz 输入（0 = 不需要结构帧；1 = 单帧；2/3 = QST 多帧）。
   * 多波链使用首波原子 task 的值——链的第一步决定上游需要几帧初猜。
   */
  framesNeeded: number
  /**
   * 允许在 route_kwargs 里传入的路由键（task 自身路由集）。
   * 空数组 = 该 task 不允许任何路由键旁路。
   */
  ownRouteKeys: readonly string[]
  /**
   * 失败环的 KB 覆盖档（诚实化标记，与 references/errors/ 的实际条目对齐）。
   *
   * - 'ladder'：有带 level 的有序处方梯 → pipeline driver 可自动换档重试；
   * - 'decision'：只有决策表（{match, route}）→ 失败停在 needs_llm 由 LLM 按 trace 选行；
   * - 'none'：无 KB 签名条目 → 失败必然 needs_llm，LLM 全权裁量。
   *
   * 为什么要显式标注：SKILL.md 宣称支持 20 个 task，而 errors/ 只有 4 条条目。
   * 不标注会让使用者以为系统会自动处理所有失败，实际上多数 task 失败时
   * 系统只是在等人。needs_llm 对 'none' 档是预期行为，不是系统故障。
   */
  kbCoverage: KbCoverage
  /**
   * 本波通过门检的条件（null = 无门，直接放行）。
   * 门在 wave-gate.ts 的 checkSettledWave 里强制执行。
   */
  gate: PlanWave['gate']
  /**
   * 本 task 是否必须分作业提交（= 判 stepwise 而非 one-stop）。
   *
   * true：workflow 会渲染出多个 slurm.sh，须逐个 sbatch——或因为前后步之间要等
   * 几何收敛（ts/qst2/qst3/irc），或因为 recipe 本身分多个子目录（opt+sp/aea）。
   * false：整个 task 渲染成单个作业一次提交（sp/opt/opt+freq 等）。
   *
   * 多波链（COMPOSITE_TASKS 里 waves.length > 1）恒为 stepwise，不看此字段；
   * 此字段决定的是**单波 task** 走 one-stop 还是 stepwise（见 isStepwiseTask）。
   */
  separateSubmit: boolean
}

/**
 * 原子 task 注册表。每个条目是一个不可再拆的提交单元。
 *
 * 复合 task DSL（如 ts+irc、tsxtb+ts+irc）的波次列表由 COMPOSITE_TASKS 声明；
 * 各波的属性从此表按原子 task 名查找，不再手写重复的组合条目。
 *
 * 新增 task：在此加一个条目即可，无需改动其他任何地方。
 */
const ATOMIC_TASKS: Record<string, AtomicTaskSpec> = {
  // ── 单点 / 光谱类（无需几何收敛门）──────────────────────────────────────
  'sp':           { framesNeeded: 0, ownRouteKeys: [],        kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: false },
  'dipole':       { framesNeeded: 0, ownRouteKeys: [],        kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: false },
  'polar':        { framesNeeded: 0, ownRouteKeys: ['polar'], kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: false },
  'tddft':        { framesNeeded: 0, ownRouteKeys: ['td'],    kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: false },
  'fluorescence': { framesNeeded: 0, ownRouteKeys: ['td'],    kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: false },
  'resp':         { framesNeeded: 0, ownRouteKeys: [],        kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: false },
  // ── 几何优化类（有收敛门）──────────────────────────────────────────────
  'opt':          { framesNeeded: 0, ownRouteKeys: ['opt'],   kbCoverage: 'decision', gate: { converged: true },                                                                    separateSubmit: false },
  'freq':         { framesNeeded: 0, ownRouteKeys: ['freq'],  kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: false },
  // opt+sp：opt 收敛后再跑一次 SP，两步分作业提交（stepwise）
  'opt+sp':       { framesNeeded: 0, ownRouteKeys: ['opt'],   kbCoverage: 'decision', gate: { converged: true },                                                                    separateSubmit: true },
  // opt+freq：opt 与 freq 合成单作业一次提交（one-stop）
  'opt+freq':     { framesNeeded: 0, ownRouteKeys: ['opt', 'freq'], kbCoverage: 'decision', gate: null,                                                                             separateSubmit: false },
  // aea：workflow 内建四步 recipe，按已就绪子目录分次提交（stepwise）
  'aea':          { framesNeeded: 0, ownRouteKeys: [],        kbCoverage: 'none',     gate: null,                                                                                   separateSubmit: true },
  // ── 过渡态搜索类（有虚频门）──────────────────────────────────────────────
  'ts':           { framesNeeded: 1, ownRouteKeys: ['opt'],   kbCoverage: 'decision', gate: { converged: true, imaginary_frequency_count: 1, min_real_frequency_cm1: TS_MIN_REAL_FREQ_CM1 }, separateSubmit: true },
  // tsxtb：xTB 初猜层，无 freq 步骤、无虚频计数门（workflow 1.5.3+）
  'tsxtb':        { framesNeeded: 1, ownRouteKeys: ['opt'],   kbCoverage: 'decision', gate: null,                                                                                   separateSubmit: true },
  'qst2':         { framesNeeded: 2, ownRouteKeys: ['opt'],   kbCoverage: 'decision', gate: { converged: true, imaginary_frequency_count: 1, min_real_frequency_cm1: TS_MIN_REAL_FREQ_CM1 }, separateSubmit: true },
  'qst3':         { framesNeeded: 3, ownRouteKeys: ['opt'],   kbCoverage: 'decision', gate: { converged: true, imaginary_frequency_count: 1, min_real_frequency_cm1: TS_MIN_REAL_FREQ_CM1 }, separateSubmit: true },
  // ── IRC 类（有方向门；必须在 TS 波之后独立提交）────────────────────────
  'irc':          { framesNeeded: 0, ownRouteKeys: ['irc'],   kbCoverage: 'ladder',   gate: { converged: true, irc_direction_check: true },                                         separateSubmit: true },
}

/**
 * 复合 task DSL → 原子 task 波次列表。
 *
 * 单原子 task（如 'ts'）不需要在这里声明——按原子表查 framesNeeded 等属性时
 * 直接命中；只有「多波展开」或「单次提交的组合 DSL」需要在此声明波次。
 */
const COMPOSITE_TASKS: Record<string, readonly string[]> = {
  // 单作业组合（waves=[task 自身]，separateSubmit 由原子表决定）
  'opt+sp':   ['opt+sp'],
  'opt+freq': ['opt+freq'],
  'aea':      ['aea'],
  // 多波链（逐波独立提交）
  'ts+irc':       ['ts',    'irc'],
  'qst2+irc':     ['qst2',  'irc'],
  'qst3+irc':     ['qst3',  'irc'],
  'tsxtb+ts+irc': ['tsxtb', 'ts', 'irc'],
}

/**
 * 解析 task DSL → 原子 task 名列表。
 * 未注册的 task 按单波原样返回（与旧 `TASK_PLANS[task] ?? { waves: [task] }` 同语义）。
 */
function waveTasksOf(task: string): readonly string[] {
  return COMPOSITE_TASKS[task] ?? [task]
}

/** 首波原子 task 的帧数需求（决定上游需要提供几帧初猜结构）。 */
function framesNeededFor(task: string): number {
  const waves = waveTasksOf(task)
  return ATOMIC_TASKS[waves[0]!]?.framesNeeded ?? 0
}

/** 多波链是否需要分波独立提交（任意一波 separateSubmit=true，则整链是 stepwise）。 */
export function isStepwiseTask(task: string): boolean {
  const waves = waveTasksOf(task)
  if (waves.length > 1) return true
  return ATOMIC_TASKS[waves[0]!]?.separateSubmit === true
}

/**
 * 某 task（原子或复合）的 KB 覆盖档。
 * 复合 task 取各波中最强的覆盖档（ladder > decision > none）。
 * 未注册的 task 视为无覆盖（fail-safe）。
 */
export function kbCoverageOf(task: string): KbCoverage {
  const RANK: Record<KbCoverage, number> = { none: 0, decision: 1, ladder: 2 }
  let best: KbCoverage = 'none'
  for (const wt of waveTasksOf(task)) {
    const c = ATOMIC_TASKS[wt]?.kbCoverage ?? 'none'
    if (RANK[c] > RANK[best]) best = c
  }
  return best
}

/** 某 task 允许的 route_kwargs 路由键集合（各波取并集）。 */
function ownRouteKeysOf(task: string): ReadonlySet<string> {
  const result = new Set<string>()
  for (const wt of waveTasksOf(task)) {
    for (const k of ATOMIC_TASKS[wt]?.ownRouteKeys ?? []) result.add(k)
  }
  return result
}

/** 意图 → task DSL（确定性映射；多波链自动按 M16 前缀 tsxtb 改善初猜）。 */
export function intentToTask(want: string[]): string {
  const has = (...keys: string[]) => keys.some((k) => want.includes(k))
  if (has('irc', 'reaction-path')) {
    return 'tsxtb+ts+irc' // 初猜质量未知 → 按纪律先走 xTB 初猜层（assumption 记录）
  }
  if (has('ts')) {
    return 'ts'
  }
  if (has('aea')) {
    return 'aea'
  }
  if (has('frequencies', 'spectrum-ir')) {
    return has('optimize') ? 'opt+freq' : 'freq'
  }
  if (has('optimize')) {
    return has('energy') ? 'opt+sp' : 'opt'
  }
  if (has('energy')) {
    return 'sp'
  }
  if (has('td')) {
    return 'tddft'
  }
  if (has('fluorescence')) {
    return 'fluorescence'
  }
  if (has('resp-charges')) {
    return 'resp'
  }
  if (has('dipole')) {
    return 'dipole'
  }
  if (has('polarizability')) {
    return 'polar'
  }
  return 'opt' // 兜底（goal 校验已要求 want 非空且枚举内）
}

// ---------------------------------------------------------------------------
// xyz 解析：帧切分 + 电子数（奇偶校验用）
// ---------------------------------------------------------------------------

const ATOMIC_NUMBERS: Record<string, number> = {
  H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10,
  Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18,
  K: 19, Ca: 20, Ti: 22, V: 23, Cr: 24, Mn: 25, Fe: 26, Co: 27, Ni: 28,
  Cu: 29, Zn: 30, Ga: 31, Ge: 32, As: 33, Se: 34, Br: 35, Kr: 36,
  Rb: 37, Sr: 38, Y: 39, Zr: 40, Nb: 41, Mo: 42, Ru: 44, Rh: 45, Pd: 46,
  Ag: 47, Cd: 48, In: 49, Sn: 50, Sb: 51, Te: 52, I: 53, Xe: 54,
}

/** xyz 单文件多帧切分（约定：`原子数\n注释\n坐标行` 重复；ts/qst2/qst3 用）。 */
export function parseXyzFrames(xyz: string): string[][] {
  const lines = xyz.split('\n').map((l) => l.trim())
  const frames: string[][] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i] === '') {
      i += 1
      continue
    }
    const count = Number.parseInt(lines[i], 10)
    if (!Number.isFinite(count) || count <= 0) {
      break // 尾部杂项
    }
    const frame = [lines[i]]
    i += 1
    if (i < lines.length) {
      frame.push(lines[i]) // 注释行
      i += 1
    }
    for (let a = 0; a < count && i < lines.length; a += 1) {
      frame.push(lines[i])
      i += 1
    }
    frames.push(frame)
  }
  return frames
}

function electronCount(frame: string[]): { electrons: number | null; unknownElement: boolean } {
  let electrons = 0
  let unknown = false
  for (const line of frame.slice(2)) {
    const symbol = /^[A-Za-z]{1,2}/.exec(line)?.[0]
    const z = symbol ? ATOMIC_NUMBERS[symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase()] : undefined
    if (z === undefined) {
      unknown = true
    } else {
      electrons += z
    }
  }
  return { electrons: unknown ? null : electrons, unknownElement: unknown }
}

// ---------------------------------------------------------------------------
// 校验 + 规划
// ---------------------------------------------------------------------------

const KNOWN_WANTS = new Set<string>([
  'optimize', 'frequencies', 'energy', 'spectrum-ir', 'dipole', 'polarizability',
  'td', 'fluorescence', 'resp-charges', 'aea', 'ts', 'irc', 'reaction-path',
])

// 路由键纪律（gaussian.ts defaultPreJson 注释三段事实的同款 TS 侧落地）：
// 路由身份由 -t task 决定；route_kwargs 里的路由键只在「task 自身路由集」内放行
// （选项级精调，如 -t opt 带 opt:["Tight","CalcFC"]），其余一律拒绝。
// 此集合仅用于识别"这是一个路由键"（参与路由的关键字）；允不允许由 ownRouteKeysOf 决定。
const COMPUTATION_ROUTE_KEYS = new Set(['opt', 'freq', 'td', 'irc', 'polar', 'force', 'scan'])
/** route_kwargs 中不许经旁路覆盖的一等字段（各有显式 goal 字段）。 */
const ROUTE_KWARGS_PROTECTED = new Set(['method', 'basis', 'charge', 'mult'])

const WALLTIME_PATTERN = /^\d+:[0-5]\d:[0-5]\d$/

/** 手工结构校验（零依赖；schema 文件为契约文档）。 */
export function validateGoal(goal: Goal): string[] {
  const errors: string[] = []
  if (goal.schema_version !== undefined && goal.schema_version !== 'aimater.goal.v1') {
    errors.push(`schema_version 应为 aimater.goal.v1（收到 ${String(goal.schema_version)}）`)
  }
  if (!Array.isArray(goal.intent?.want) || goal.intent.want.length === 0) {
    errors.push('intent.want 必须是非空数组')
  } else {
    for (const w of goal.intent.want) {
      if (!KNOWN_WANTS.has(String(w))) {
        errors.push(`intent.want 含未知意图 ${String(w)}`)
      }
    }
  }
  return errors
}

export function planFromGoal(goal: Goal, deps: PlanningDeps = {}): PlanResult {
  const errors = validateGoal(goal)
  if (errors.length > 0) {
    return { status: 'invalid', errors }
  }

  const questions: PlanQuestion[] = []
  const assumptions: string[] = []
  const task = intentToTask(goal.intent.want)
  const waveTasks = waveTasksOf(task)

  // ---- 参数模板硬校验（编译期快败，不进澄清环）----
  const routeKwargs = goal.method?.route_kwargs ?? {}
  const ownRoutes = ownRouteKeysOf(task)
  const routeViolations = Object.keys(routeKwargs)
    .filter((k) => COMPUTATION_ROUTE_KEYS.has(k) && !ownRoutes.has(k))
  if (routeViolations.length > 0) {
    const allowed = [...ownRoutes]
    return {
      status: 'invalid',
      errors: [
        `route_kwargs 路由键 ${routeViolations.join(', ')} 不属于 task ${task} 的自身路由集${allowed.length > 0 ? `（允许：${allowed.join(', ')}）` : '（该 task 不允许任何路由键）'}——路由身份由 -t task 决定，异 task 路由键会污染 route`,
      ],
    }
  }
  const walltime = goal.resources?.walltime?.trim() ?? ''
  if (walltime !== '' && !WALLTIME_PATTERN.test(walltime)) {
    return { status: 'invalid', errors: [`resources.walltime 应为 HH:MM:SS（收到 ${walltime}）`] }
  }
  const ncores = goal.resources?.ncores
  if (ncores !== undefined && (!Number.isInteger(ncores) || ncores <= 0)) {
    return { status: 'invalid', errors: [`resources.ncores 应为正整数（收到 ${String(ncores)}）`] }
  }

  // ---- 结构与多帧语义 ----
  const xyz = goal.structure?.xyz?.trim() ?? ''
  const frames = xyz !== '' ? parseXyzFrames(xyz) : []
  // 帧数从首波原子 task 查注册表——复合链也能正确判断（修复：tsxtb+ts+irc 首波=tsxtb，需 1 帧）
  const framesNeeded = framesNeededFor(task)
  if (framesNeeded > 0 && frames.length !== framesNeeded) {
    // 前置披露表语义：缺料必问，禁静默编结构
    const frameHint = framesNeeded === 1
      ? 'TS 初猜一帧'
      : framesNeeded === 2 ? '反应物+产物两帧' : '反应物+产物+TS 初猜三帧'
    questions.push({
      id: 'structure-frames',
      kind: 'structure',
      prompt: `task ${task} 需要 ${framesNeeded} 帧 xyz（${frameHint}），当前 ${frames.length} 帧。`,
      options: [
        { label: '我来描述反应（断哪些键/成哪些键）', value: 'describe-reaction', note: '按化学直觉构造粗猜 → tsxtb 打磨' },
        { label: '我上传结构文件', value: 'upload', note: `${framesNeeded === 1 ? '单帧初猜' : String(framesNeeded) + ' 帧'} xyz/POSCAR` },
      ],
      blocking: true,
    })
  } else if (xyz === '') {
    questions.push({
      id: 'structure-missing',
      kind: 'structure',
      prompt: '缺少体系结构（xyz）。',
      options: [
        { label: '我上传结构文件', value: 'upload' },
        { label: '我描述体系组成', value: 'describe', note: '按描述构造粗猜' },
      ],
      blocking: true,
    })
  }

  // ---- 电子奇偶 → mult（M15 硬校验前移）----
  let charge = goal.charge ?? 0
  let mult = goal.mult
  if (mult === undefined && frames.length > 0) {
    const { electrons } = electronCount(frames[0])
    if (electrons !== null) {
      const parity = (electrons - charge) % 2
      if (parity !== 0) {
        questions.push({
          id: 'mult-odd-electron',
          kind: 'mult',
          prompt: `体系电子数 ${electrons}（charge=${charge}）为奇数，必须显式给偶数多重度。`,
          options: [
            { label: 'mult=2（双重态，多数奇电子体系的基态推荐）', value: '2' },
            { label: 'mult=4（若已知是三重以上激发组型）', value: '4' },
            { label: 'charge 填错了，我改 charge', value: 'fix-charge' },
          ],
          blocking: true,
        })
      } else {
        mult = 1
        assumptions.push('mult 未指定且电子数为偶 → 取闭壳层 mult=1')
      }
    } else {
      assumptions.push('存在无法识别的元素符号，电子奇偶未能判定——mult 未写入，pre 侧硬校验兜底')
    }
  } else if (mult !== undefined) {
    assumptions.push(`charge/mult 显式给定（${charge}/${mult}）`)
  }

  // ---- 分区（计费，不自动选——O2/Step 0）----
  const partition = goal.resources?.partition?.trim() ?? ''
  if (partition === '') {
    questions.push({
      id: 'partition',
      kind: 'partition',
      prompt: '缺少 Slurm 分区（计费相关，不自动选择）。',
      options: [
        { label: '使用本会话已确认的分区', value: 'from-context', note: '会话上下文已有则回填 goal.resources.partition' },
        { label: '我来指定分区', value: 'specify', note: '可先用 mat_partitions 查询空闲情况辅助决策' },
      ],
      blocking: true,
    })
  }

  // ---- 方法/资源档 ----
  const preJson = defaultPreJson()
  if (goal.method?.method || goal.method?.basis) {
    const calc = (preJson as { ase?: { calculator_kwargs?: Record<string, unknown> } }).ase!.calculator_kwargs!
    if (goal.method.method) {
      calc.method = goal.method.method
    }
    if (goal.method.basis) {
      calc.basis = goal.method.basis
    }
    assumptions.push(`方法/基组显式给定（${String(goal.method.method ?? '默认')} / ${String(goal.method.basis ?? '默认')}）`)
  } else {
    assumptions.push('方法/基组未指定 → 默认档 B3LYP/6-31G(d)（需要更高级别请显式给 method/basis）')
  }
  if (charge !== 0 || mult !== undefined) {
    const calc = (preJson as { ase?: { calculator_kwargs?: Record<string, unknown> } }).ase!.calculator_kwargs!
    calc.charge = charge
    if (mult !== undefined) {
      calc.mult = mult
    }
  }

  // ---- 参数模板附加键（route_kwargs）→ calculator_kwargs ----
  const extraKeys = Object.keys(routeKwargs).filter((k) => !ROUTE_KWARGS_PROTECTED.has(k))
  if (extraKeys.length > 0) {
    const calc = (preJson as { ase?: { calculator_kwargs?: Record<string, unknown> } }).ase!.calculator_kwargs!
    for (const key of extraKeys) {
      calc[key] = routeKwargs[key]
    }
    assumptions.push(`route_kwargs 附加键并入 calculator_kwargs（${extraKeys.join(', ')}）`)
  }
  const bypassedKeys = Object.keys(routeKwargs).filter((k) => ROUTE_KWARGS_PROTECTED.has(k))
  if (bypassedKeys.length > 0) {
    assumptions.push(`route_kwargs 含一等字段（${bypassedKeys.join(', ')}）——已忽略，须用 goal 顶层 method/basis/charge/mult 字段`)
  }

  // ---- 资源档覆盖（pre.resources 是作业资源档唯一来源，O1）----
  const resourcesOverride = goal.resources ?? {}
  if (ncores !== undefined || goal.resources?.memory) {
    const resources = (preJson as { resources?: Record<string, unknown> }).resources!
    if (ncores !== undefined) {
      resources.ncores = ncores
    }
    if (goal.resources?.memory) {
      resources.memory = goal.resources.memory
    }
    assumptions.push(`资源档显式给定（${ncores !== undefined ? `${ncores} 核` : ''}${ncores !== undefined && goal.resources?.memory ? ' / ' : ''}${goal.resources?.memory ?? ''}）`)
  }

  const runJson = defaultRunJson(partition !== '' ? partition : undefined)
  const slurm = (runJson as { slurm?: Record<string, unknown> }).slurm!
  // ncores ≤ slurm.ntasks_per_node 约束：显式核数时同步槽位（默认档两者同为 32）
  if (ncores !== undefined) {
    slurm.ntasks_per_node = ncores
  }
  if (goal.resources?.memory) {
    slurm.mem = goal.resources.memory
  }
  // 精度偏好 → 资源档（P3a 只调 walltime；方法级别需显式 method/basis）；显式 walltime 优先
  if (walltime !== '') {
    slurm.time = walltime
    assumptions.push(`walltime 显式给定（${walltime}，优先于 accuracy 档位）`)
  } else if (goal.accuracy === 'fast') {
    slurm.time = '00:15:00'
    assumptions.push('accuracy=fast → walltime 收紧至 15 分钟')
  } else if (goal.accuracy === 'slow') {
    slurm.time = '02:00:00'
    assumptions.push('accuracy=slow → walltime 放宽至 2 小时')
  }

  // ---- 波次 DAG（含波间门）+ 复用标记 ----
  const label = goal.structure?.label?.trim() || ''
  const waves: PlanWave[] = []
  let estimated = 0
  let estimateKnown = true
  waveTasks.forEach((waveTask, index) => {
    const past = label !== '' && deps.past ? deps.past(label, waveTask) : []
    const hit = past.find((p) => p.converged === true)
    // 门从注册表读取：每个原子 task 的验收条件在 ATOMIC_TASKS 里集中声明
    const gate = ATOMIC_TASKS[waveTask]?.gate ?? null
    waves.push({
      id: index + 1,
      task: waveTask,
      dependsOn: index > 0 ? [index] : [],
      gate,
      reusable: hit !== undefined,
      ...(hit !== undefined ? { reuseRef: { task: hit.task, energy: hit.energy, artifactsPath: hit.artifactsPath } } : {}),
    })
    if (hit === undefined) {
      const coreHours = estimateCoreHoursFromRunJson(runJson)
      if (coreHours === null) {
        estimateKnown = false
      } else {
        estimated += coreHours
      }
    }
  })
  if (waveTasks.length > 1) {
    assumptions.push(`多波链 ${waveTasks.join(' → ')}（不支持一站式；逐波终态先 post 再门检后进下一波）`)
    if (task === 'tsxtb+ts+irc') {
      assumptions.push('初猜质量未知 → 按 M16 纪律自动前缀 tsxtb（xTB 秒级初猜层），非切换 QST')
    }
  }

  const blocking = questions.filter((q) => q.blocking)
  const plan: AimaterPlan = {
    schema_version: 'aimater.plan.v1',
    status: blocking.length > 0 ? 'needs_clarification' : 'ready',
    task,
    waves,
    concurrency: { max_parallel: 1 }, // gaussian 波次串行；字段为批量形态预留
    preJson,
    runJson,
    estimatedCoreHours: estimateKnown ? Math.round(estimated * 100) / 100 : null,
    assumptions,
    questions,
  }
  return { status: plan.status, plan, errors: [] }
}
