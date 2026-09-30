/**
 * task 构建器编译层（LLM + workflow adaptor 的 adaptor 半边；D0 P3 工具接线）。
 *
 * 契约：agent(LLM) 产 goal.json（aimater.goal.v1，参数模板 + 最小流程描述的结构化
 * 形态）→ compileTaskPackage(goal)【无 LLM、无集群副作用】→ aimater.taskpackage.v1
 * task 包：波次 DAG + 每波 pre/run/post.json + 摘要投影 digest + 执行 runbook
 * （one-stop / stepwise 判定与逐条指令）。
 *
 * digest 兼容性（关键设计）：one-stop 模式的 digest 与 mat_gaussian 确认闸同源
 * （summarizePre → confirmationDigest，同一对 preJson/runJson）——用户批准后首次
 * 调用即可带 confirmed_digest 直提，无二次 CONFIRM_REQUIRED 往返；若被拒说明构建
 * 后参数变动，回本层重建。stepwise 模式为全链规范摘要（各波 digest + 门 + task 链）。
 *
 * 执行边界（SKILL.md 一站式节）：单作业形态（单步 task 与 opt+freq 单作业组合）走
 * one-stop；多波组合（ts+irc / qst2+irc / qst3+irc / tsxtb+ts+irc）与需分波提交的
 * opt+sp / aea 走 stepwise——三个 phase 一律复用完整 task DSL 字符串与同一 workdir，
 * 逐波 run(渲染前沿)→sbatch→watch→post→门检（带步骤前缀的结构化字段）循环。
 */

import { createHash } from 'node:crypto'
import { confirmationDigest, formatConfirmationSummary, summarizePre } from './confirmation.ts'
import {
  DEFAULT_G16_ENV,
  DEFAULT_WORKFLOW_ENV,
  postPhaseCommand,
  prePhaseCommand,
  prepareInputsCommand,
  runPhaseCommand,
} from './gaussian.ts'
import { kbCoverageOf, planFromGoal, isStepwiseTask } from './planning.ts'
import type { EngineId } from './engine.ts'
import type { Goal, PlanQuestion, PlanningDeps } from './planning.ts'

// ---------------------------------------------------------------------------
// task 包契约
// ---------------------------------------------------------------------------

export interface TaskPackageWave {
  id: number
  task: string
  dependsOn: number[]
  /**
   * 波间结构化门（settle 后判，不满足不进下一波）。
   *
   * - converged / imaginary_frequency_count：R4 原有标量门（M22 的代码面）
   * - min_real_frequency_cm1（R7b）：最小真实振动频率下限（cm⁻¹）。TS 只数虚频
   *   个数不够——极低的真实频率意味着平台区/残留平动转动，几何并非干净的
   *   一阶鞍点。需要 properties 带 `frequencies_cm-1` 数组才生效。
   * - irc_direction_check（R8b）：要求 irc_profile 两分支均从 TS 单调下坡。
   *   irc-methods.md 写明「方向错误是 IRC 走不通的最常见上游原因」，此前完全
   *   不验证。需要注入 readCsvFile 才生效（见 checkIrcDirectionGate）。
   */
  gate: {
    converged: boolean
    imaginary_frequency_count?: number
    min_real_frequency_cm1?: number
    irc_direction_check?: boolean
  } | null
  preJson: Record<string, unknown>
  runJson: Record<string, unknown>
  postJson: Record<string, unknown>
  reusable: boolean
  reuseRef?: { task: string; energy: number | null; artifactsPath: string | null }
}

export interface TaskPackage {
  schema_version: 'aimater.taskpackage.v1'
  /**
   * V1 引擎面只有 gaussian；取值域与已知边界见 engine.ts
   * （ENGINE_BOUNDARY_NOTES 列出硬编码假设——"支持新引擎"须先更新那里）。
   */
  engine: EngineId
  status: 'ready' | 'needs_clarification'
  task: string
  waves: TaskPackageWave[]
  questions: PlanQuestion[]
  assumptions: string[]
  estimatedCoreHours: number | null
  /** ready 时非空；needs_clarification 时为空串（参数未定稿，摘要无意义）。 */
  digest: string
  execution: { mode: 'one-stop' | 'stepwise'; instructions: string[] }
}

export interface TaskPackageResult {
  status: 'ready' | 'needs_clarification' | 'invalid'
  pkg?: TaskPackage
  errors: string[]
}

// ---------------------------------------------------------------------------
// 执行模式判定 + digest
// ---------------------------------------------------------------------------

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** stepwise 全链 digest：各波 digest + 门 + task 链的固定键序规范 JSON → sha256。 */
export function taskPackageDigest(
  engine: string,
  task: string,
  waves: Array<{ id: number; task: string; gate: TaskPackageWave['gate'] }>,
  waveDigests: string[],
): string {
  const canonical = JSON.stringify({
    engine,
    task,
    waves: waves.map((w, i) => ({ id: w.id, task: w.task, digest: waveDigests[i], gate: w.gate })),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

// ---------------------------------------------------------------------------
// runbook 生成
// ---------------------------------------------------------------------------

const WORKDIR = '{work_dir}'
const STRUCTURE_PLACEHOLDER = '__STRUCTURE_XYZ__'

function gateLine(wave: TaskPackageWave): string {
  if (wave.gate === null) {
    return `      门检：本波无结构化门——post 报 composition incomplete: pending steps [...] 属预期（链未走完），继续下一波`
  }
  const imag = wave.gate.imaginary_frequency_count
  const minFreq = wave.gate.min_real_frequency_cm1
  const dirCheck = wave.gate.irc_direction_check === true
  const parts = [
    `      门检：读 {work_dir}/result.json properties——${wave.task}.converged == true`,
    imag === undefined ? '' : ` 且 ${wave.task}.imaginary_frequency_count == ${imag}（一阶鞍点验收）`,
    // R7b：频率下限（只数虚频个数不足以验收干净的一阶鞍点）
    minFreq === undefined ? '' : ` 且 ${wave.task}.frequencies_cm-1 的最小正频 ≥ ${minFreq} cm⁻¹（低于此值=平台区/残留平动转动，不是干净鞍点）`,
    `；不过不进下一波（0 个虚频=极小点、≥2=高阶鞍点，均无接 IRC 资格）`,
    // R8b：方向门（代码强制，非文字提醒）
    dirCheck
      ? `\n      方向门（代码自动执行）：解析 plots 里 irc_profile 的 CSV，要求两分支均从 TS 单调下坡；不过停链并指向 kb:irc-wrong-direction（先验证 TS 虚频模式方向，不要先调 IRC 参数）`
      : '',
  ]
  return parts.join('')
}

function reuseLine(wave: TaskPackageWave, mode: 'one-stop' | 'stepwise'): string | null {
  if (!wave.reusable || wave.reuseRef === undefined) return null
  const ref = wave.reuseRef
  const adoption = mode === 'one-stop'
    ? '采纳=不提交新作业，直接引用历史产物并向用户报告（须用户明示同意）'
    : '采纳=跳过该波提交、直接引用历史产物；组合链跳波必须用户明示同意'
  return `  波 ${wave.id}（${wave.task}）命中复用（历史 converged，energy=${ref.energy ?? '-'}，artifacts=${ref.artifactsPath ?? '-'}）——${adoption}`
}

function oneStopInstructions(pkg: TaskPackage): string[] {
  const wave = pkg.waves[0]!
  const reuse = reuseLine(wave, 'one-stop')
  return [
    ...(reuse !== null ? [reuse] : []),
    '1. CONFIRM：向用户逐字转述上方「计算参数摘要」并阻塞式征求确认（O2；数字只来自摘要，不得改写）。',
    `2. SUBMIT（确认后一次调用，digest 与确认闸同源可直提）：mat_gaussian({cluster_id: <集群>, task: ${JSON.stringify(pkg.task)}, ` +
      `structure: <goal.structure.xyz 原文>, workdir: <绝对路径>, options: {pre_json: ${JSON.stringify(wave.preJson)}, ` +
      `run_json: ${JSON.stringify(wave.runJson)}}, confirmed_digest: ${JSON.stringify(pkg.digest)}})`,
    '3. 若返回 CONFIRM_REQUIRED：构建后参数已变动——回 mat_task_build 重建，不要手改参数重试。',
    '4. 提交后等会话完成通知（PENDING 排队数分钟属正常，状态板可见排队/运行相位）；终态后 job_output 读 properties/plots 报告用户。',
  ]
}

function stepwiseInstructions(pkg: TaskPackage): string[] {
  const first = pkg.waves[0]!
  const lines: string[] = [
    '1. CONFIRM：向用户逐字转述上方计算参数摘要与预估核时，阻塞式确认后执行（O2）。',
    '2. 全程同一个 {work_dir}（绝对路径）与完整 task 字符串 ' + JSON.stringify(pkg.task) +
      '——pre/run/post 一律 -t 同一 DSL，禁止拆成单 task 独立链、禁止 post 只跑首 task。',
    `3. 输入落盘（一次，mat_exec）：
${prepareInputsCommand(WORKDIR, STRUCTURE_PLACEHOLDER, first.preJson, first.runJson)}`,
    `4. pre（一次，mat_exec）：${prePhaseCommand(WORKDIR, pkg.task, DEFAULT_WORKFLOW_ENV)}`,
  ]
  for (const wave of pkg.waves) {
    const reuse = reuseLine(wave, 'stepwise')
    if (reuse !== null) lines.push(reuse)
    lines.push(`5.${wave.id} 波 ${wave.id}/${pkg.waves.length}（${wave.task}）：`)
    lines.push(`      a) run 渲染当前就绪 step（mat_exec）：${runPhaseCommand(WORKDIR, pkg.task, DEFAULT_WORKFLOW_ENV, DEFAULT_G16_ENV)}`)
    lines.push(`      b) 提交本波（mat_sbatch）：workdir={work_dir}/${pkg.task}/<本波 step 目录>（如 0${wave.id}-${wave.task}/），filename=slurm.sh，wave_gate={pkg_digest: ${JSON.stringify(pkg.digest)}, wave_id: ${wave.id}}——工具在提交前自动校验前序波门检（不过返回 GATE_FAILED，零集群副作用）；` +
      `已提交波数应等于 find "{work_dir}/${pkg.task}" -maxdepth 2 -name slurm.sh 计数`)
    lines.push(`      c) attempts 台账自动记账（R3）：mat_sbatch 传 attempts_ledger={file: "{work_dir}/attempts.jsonl", task: ${JSON.stringify(pkg.task)}, step: "<本波 step 目录名>"}——提交成功后工具自动追加 submitted 行，不再手工 echo`)
    lines.push(`      d) 监控：mat_job_watch({cluster_id, job_ids: [<本波 job id>], label: "gaussian ${pkg.task} @<cluster_id>"})——不手动 squeue/sacct`)
    lines.push(`      e) 终态后先 post 再门检（mat_exec，每波必做，不把 post 留到链尾）：${postPhaseCommand(WORKDIR, pkg.task, DEFAULT_WORKFLOW_ENV)}`)
    lines.push(gateLine(wave))
    lines.push('      f) 门检不过或 FAILED 终态：停链——post 的结构化错误（error_detail/kb 引用）驱动诊断，不提交下一波')
  }
  lines.push(`6. 链尾定案：末波 post 后核对 result.json 的 steps 数组每步 post 都 ok、properties 带全部步骤前缀（如 ${pkg.waves.map((w) => `${w.task}.`).join(' ')}）；workflow.status == needs_review / composition incomplete ⇒ 还有波未跑，不得报告完成`)
  lines.push('7. 结果消费：properties/plots 直读报告（不 grep log 原文）；每核时对账 {work_dir}/attempts.jsonl。')
  lines.push(`8. 反应能学不要手算：能量差/垒高走 mat_reaction_energy（自动选一致的能量基准、换算 kcal/mol、缺热化学时明确告知报出的不是自由能垒）。`)
  lines.push(kbCoverageLine(pkg.task))
  return lines
}

/**
 * 失败处置能力的诚实披露（KB 覆盖率）。
 *
 * 为什么写进 runbook：执行者需要知道「这个 task 失败时系统会自动重试，还是
 * 会停下来等我诊断」。不写的话，'none' 档的 needs_llm 会被误读成系统故障。
 */
function kbCoverageLine(task: string): string {
  const coverage = kbCoverageOf(task)
  if (coverage === 'ladder') {
    return '9. 失败处置：本 task 有**有序处方梯**（kb 条目带 level）——pipeline 会自动换档重试，梯尽才死信。手动链路同样按梯级逐档走，一档一次提交。'
  }
  if (coverage === 'decision') {
    return '9. 失败处置：本 task 的 kb 条目是**决策表**（按 trace 形态选行），没有自动换档——失败会停在 needs_llm 等你按 convergence_trace.csv 选行，这是预期行为不是系统故障。'
  }
  return '9. 失败处置：本 task **无 kb 签名条目**——失败必然停在 needs_llm 由你全权裁量（预期行为，不是系统故障）。诊断走 references/ 的 grep 协议，结论有复用价值时补一条 errors/ 条目。'
}

// ---------------------------------------------------------------------------
// 编译 + 格式化
// ---------------------------------------------------------------------------

export function compileTaskPackage(goal: Goal, deps: PlanningDeps = {}): TaskPackageResult {
  const planned = planFromGoal(goal, deps)
  if (planned.status === 'invalid' || planned.plan === undefined) {
    return { status: 'invalid', errors: planned.errors }
  }
  const plan = planned.plan
  const waves: TaskPackageWave[] = plan.waves.map((w) => ({
    id: w.id,
    task: w.task,
    dependsOn: [...w.dependsOn],
    gate: w.gate === null ? null : { ...w.gate },
    preJson: cloneJson(plan.preJson),
    runJson: cloneJson(plan.runJson),
    postJson: {},
    reusable: w.reusable,
    ...(w.reuseRef === undefined ? {} : { reuseRef: { ...w.reuseRef } }),
  }))
  const mode: 'one-stop' | 'stepwise' =
    isStepwiseTask(plan.task) ? 'stepwise' : 'one-stop'
  const ready = plan.status === 'ready'
  let digest = ''
  if (ready) {
    const waveDigests = waves.map((w) => confirmationDigest(summarizePre(w.preJson, w.runJson)))
    digest = mode === 'one-stop'
      ? waveDigests[0]!
      : taskPackageDigest('gaussian', plan.task, waves, waveDigests)
  }
  const pkg: TaskPackage = {
    schema_version: 'aimater.taskpackage.v1',
    engine: 'gaussian',
    status: plan.status,
    task: plan.task,
    waves,
    questions: plan.questions,
    assumptions: plan.assumptions,
    estimatedCoreHours: plan.estimatedCoreHours,
    digest,
    execution: { mode, instructions: [] },
  }
  // runbook 生成放在对象组装后（指令文本引用 pkg 自身字段）
  pkg.execution.instructions = ready
    ? (mode === 'one-stop' ? oneStopInstructions(pkg) : stepwiseInstructions(pkg))
    : []
  return { status: plan.status, pkg, errors: [] }
}

export function formatTaskPackage(result: TaskPackageResult, maxCoreHours?: number): string {
  if (result.status === 'invalid') {
    return ['INVALID_GOAL — 修订 goal_json 后重新构建：', ...result.errors.map((e) => `- ${e}`)].join('\n')
  }
  const pkg = result.pkg!
  const header = [
    `engine      : ${pkg.engine}`,
    `task        : ${pkg.task}`,
    `mode        : ${pkg.execution.mode}${pkg.waves.length > 1 ? ` (${pkg.waves.length} waves)` : ''}`,
    `waves       : ${pkg.waves.map((w) => `${w.id})${w.task}${w.reusable ? '[reuse]' : ''}`).join(' → ')}`,
    `estimated core-hours : ${pkg.estimatedCoreHours ?? '-'}`,
  ]
  if (pkg.status === 'needs_clarification') {
    const qs = pkg.questions.map((q) => {
      const opts = q.options.map((o) => `  - ${o.label} (${o.value})${o.note === undefined ? '' : ` — ${o.note}`}`)
      return [`[${q.id}] ${q.prompt}`, ...opts].join('\n')
    })
    return [
      'NEEDS_CLARIFICATION — 逐条阻塞式向用户转述以下问题（选项原样列出），按答复修订 goal_json 后重新调用 mat_task_build：',
      '',
      ...qs,
    ].join('\n')
  }
  const wave = pkg.waves[0]!
  const summary = formatConfirmationSummary(summarizePre(wave.preJson, wave.runJson), pkg.digest)
  const budgetWarning = maxCoreHours !== undefined && pkg.estimatedCoreHours !== null && pkg.estimatedCoreHours > maxCoreHours
    ? [`BUDGET_WARNING: 预估 ${pkg.estimatedCoreHours} 核时 > max_core_hours ${maxCoreHours}——确认时必须向用户明示超出并获得接受`]
    : []
  const assumptions = pkg.assumptions.map((a) => `  - ${a}`)
  return [
    'TASK_PACKAGE_READY — aimater.taskpackage.v1',
    ...header,
    'assumptions :',
    ...assumptions,
    '',
    '── 计算参数摘要（各波同参数，V1）──',
    summary,
    ...(pkg.execution.mode === 'stepwise'
      ? ['（stepwise 模式：digest 为全链摘要；摘要内 estimated core-hours 是单波档位，全链总预估以上方 header 为准；每波提交仍逐波门检）']
      : []),
    ...budgetWarning,
    '',
    '── 执行 runbook ──',
    ...pkg.execution.instructions,
  ].join('\n')
}
