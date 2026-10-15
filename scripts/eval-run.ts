/**
 * eval-run：P0.5 golden task 跑批器（回放泳道）。
 *
 * 每个任务的执行单元（全部本地，零集群/零核时）：
 *   1. 拉起 eval-fake-mat（独立端口、独立场景）；
 *   2. headless dsh 会话跑任务原文——env 把 HPC 指向 fake：
 *        MAT_MCP_BASE_URL=http://127.0.0.1:<port>/api
 *        MAT_MCP_KEY=sk-eval-<随机>（客户端要求 sk- 前缀，fake 不校验）
 *        MAT_FILE_ROOT=<out>/file-root/<task>（mat.db 等按任务隔离，
 *          防复用飞轮的跨任务状态污染判定）
 *   3. 快照对比 $DSH_HOME/sessions 收集本任务新产生的会话日志；
 *   4. stdout 与会话日志归档到输出目录，manifest 供 eval-report 判定。
 *
 * headless profile 装载（对齐 scripts/dsh-web.sh 的 dev 注入方式）：
 *   首次对空 DSH_HOME 跑一条平凡任务完成 profile 引导（装宿主依赖），
 *   随后幂等注入：node_modules 软链四包 + package.json bundles += mat-bundle。
 *
 * 用法：
 *   pnpm eval:run -- --tasks all --out docs/evidence/eval/smoke
 *   pnpm eval:run -- --tasks partitions-lookup,gaussian-onestop --provider mat --model deepseek-v4-flash
 * 选项：--dsh-home <dir>（缺省 /tmp/mat-eval-home，跨轮复用省引导）；
 *       --keep-failed-dsh-home 调试时保留。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync, cpSync, type Dirent } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOLDEN_TASKS, type GoldenTask } from './eval-golden-tasks.ts'

const MAT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_REPO = resolve(MAT_ROOT, '..', 'deepseek-harness')
const ENV_LOCAL = join(MAT_ROOT, 'env.local')
const OVERLAY_MAT = join(MAT_ROOT, 'profiles', 'mat.yml')
const OVERLAY_EVAL = join(MAT_ROOT, 'profiles', 'eval.yml')

// ── 参数 ────────────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : String(process.argv[i + 1] ?? '')
}
function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const tasksArg = argValue('tasks') ?? 'all'
const outDir = resolve(MAT_ROOT, argValue('out') ?? 'docs/evidence/eval/run')
const provider = argValue('provider') ?? 'mat'
const model = argValue('model') ?? 'deepseek-v4-pro'
const dshHome = resolve(argValue('dsh-home') ?? '/tmp/mat-eval-home')
const timeoutCap = Number(argValue('timeout-cap') ?? 600)

// --env KEY=VAL（可重复）：注入每个 dsh 会话环境（A/B 泳道开关用，如
// DSH_PERMISSION_MODE=danger-full-access 关沙箱）
const extraEnv: Record<string, string> = {}
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--env') {
    const kv = process.argv[i + 1] ?? ''
    const eq = kv.indexOf('=')
    if (eq > 0) extraEnv[kv.slice(0, eq)] = kv.slice(eq + 1)
  }
}
// --overlay <path>（可重复）：追加 dsh --patch 栈（实验泳道用，如
// profiles/eval-compaction.yml 小窗口 / eval-compact-tuned.yml 调参）
const extraOverlays: string[] = []
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] === '--overlay') {
    const p = process.argv[i + 1]
    if (p && !p.startsWith('-')) extraOverlays.push(resolve(MAT_ROOT, p))
  }
}
const overlays = [OVERLAY_MAT, OVERLAY_EVAL, ...extraOverlays]

const tasks: GoldenTask[] = tasksArg === 'all'
  ? GOLDEN_TASKS
  : tasksArg.split(',').map((id) => {
    const t = GOLDEN_TASKS.find((x) => x.id === id.trim())
    if (!t) throw new Error(`unknown golden task id: ${id}`)
    return t
  })

// ── env.local 解析（KEY=VALUE，注释行跳过；值不去引号——dsh-web.sh 同款语义） ──

function parseEnvLocal(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  return env
}
const baseEnv = parseEnvLocal(ENV_LOCAL)

// ── 工具函数 ────────────────────────────────────────────────────────────────

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => res(port))
    })
    srv.on('error', rej)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function listSessionFiles(root: string): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.jsonl') || e.name.endsWith('.zstd') || e.name.endsWith('.zst')) out.add(p)
    }
  }
  walk(root)
  return out
}

interface ProcOutcome { code: number | null; timedOut: boolean; stdout: string; stderr: string }

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return
  try { process.kill(-pid, 'SIGKILL') } catch { /* 组已消亡 */ }
}

/** detached 进程组运行，超时杀整组（pnpm 会派生 node 孙进程，只杀子进程会漏）。 */
function runGroup(cmd: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutSec: number; onStdout?: (chunk: string) => void }): Promise<ProcOutcome> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const t = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid!, 'SIGTERM') } catch { /* 已退出 */ }
      setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* 已退出 */ } }, 5000)
    }, opts.timeoutSec * 1000)
    child.stdout.on('data', (c: Buffer) => {
      stdout += c
      opts.onStdout?.(c.toString())
    })
    child.stderr.on('data', (c: Buffer) => { stderr += c })
    child.on('exit', (code) => {
      clearTimeout(t)
      res({ code, timedOut, stdout, stderr })
    })
    child.on('error', (err) => {
      clearTimeout(t)
      res({ code: null, timedOut, stdout, stderr: stderr + String(err) })
    })
  })
}

// ── headless profile 引导 + mat-bundle 注入（dsh-web.sh 同款，幂等） ───────

function injectBundleIntoProfile(): void {
  const profileDir = join(dshHome, 'profiles', 'headless')
  const nm = join(profileDir, 'node_modules')
  mkdirSync(nm, { recursive: true })
  for (const pkg of ['mat-bundle', 'mat-tools', 'mat-skills', 'mat-ui']) {
    const link = join(nm, pkg)
    const target = join(MAT_ROOT, 'packages', pkg)
    if (existsSync(link)) continue
    symlinkSync(target, link, 'dir')
  }
  const pkgPath = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
  pkg.dsh ??= {}
  pkg.dsh.profile ??= {}
  pkg.dsh.profile.bundles ??= []
  if (!pkg.dsh.profile.bundles.includes('mat-bundle')) {
    pkg.dsh.profile.bundles.push('mat-bundle')
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }
}

async function ensureProfile(): Promise<void> {
  if (existsSync(join(dshHome, 'profiles', 'headless', 'package.json'))) return
  console.log('[eval-run] 引导 headless profile（首次，装宿主依赖，一条平凡任务）…')
  const r = await runGroup('pnpm', ['dsh', '--profile', 'headless', '--patch', OVERLAY_MAT, '请只回复两个字：就绪'], {
    cwd: HOST_REPO,
    env: dshEnv('__bootstrap__'),
    timeoutSec: 420,
  })
  if (!existsSync(join(dshHome, 'profiles', 'headless', 'package.json'))) {
    throw new Error(`profile 引导失败（exit=${r.code}）:\n${(r.stdout + r.stderr).slice(-2000)}`)
  }
}

function dshEnv(taskId: string, fakePort?: number): Record<string, string> {
  const env: Record<string, string> = { ...baseEnv, ...process.env as Record<string, string> }
  env.DSH_HOME = dshHome
  env.LLM_PROVIDER_ID = provider
  env.LLM_MODEL_ID = model
  env.MAT_TRANSPORT = 'fetch'
  if (fakePort !== undefined) {
    env.MAT_MCP_BASE_URL = `http://127.0.0.1:${fakePort}/api`
    env.MAT_MCP_KEY = `sk-eval-${taskId}`
  }
  env.MAT_FILE_ROOT = join(outDir, 'file-root', taskId)
  Object.assign(env, extraEnv)
  return env
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

interface TaskResult {
  id: string
  prompt: string
  provider: string
  model: string
  exitCode: number | null
  timedOut: boolean
  fakePort: number
  fakeScenario: GoldenTask['fake']['scenario']
  sessionFiles: string[]
  stdoutFile: string
  wallSec: number
}

mkdirSync(outDir, { recursive: true })
await ensureProfile()
injectBundleIntoProfile()

const results: TaskResult[] = []
for (const task of tasks) {
  const port = await freePort()
  console.log(`[eval-run] ${task.id}：fake=:${port} scenario=${task.fake.scenario}`)

  // 1. fake 服务器（本任务独立实例与状态；detached 进程组——pnpm→tsx→node 链，
  //    只杀直接子进程会漏孙进程，2026-10-15 基线轮实锤泄漏后修正）
  const fake = spawn('pnpm', ['exec', 'tsx', join('scripts', 'eval-fake-mat.ts'),
    '--port', String(port), '--scenario', task.fake.scenario,
    '--pending-ms', String(task.fake.pendingMs), '--run-ms', String(task.fake.runMs),
    ...(task.fake.padSinfo ? ['--pad-sinfo', String(task.fake.padSinfo)] : []),
    ...(task.fake.padGaussian ? ['--pad-gaussian', String(task.fake.padGaussian)] : [])], {
    cwd: MAT_ROOT, env: { ...process.env } as Record<string, string>, stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let fakeReady = false
  let fakeLog = ''
  fake.stdout.on('data', (c: Buffer) => {
    fakeLog += c
    if (fakeLog.includes(`FAKE_MAT_LISTENING ${port}`)) fakeReady = true
  })
  fake.stderr.on('data', (c: Buffer) => { fakeLog += c })
  fake.on('error', () => { /* spawn 失败由就绪检查兜底 */ })
  fake.on('exit', () => { /* 提前退出由就绪检查兜底 */ })
  for (let i = 0; i < 100 && !fakeReady; i += 1) await sleep(100)
  if (!fakeReady) {
    killGroup(fake.pid)
    throw new Error(`fake 服务器未就绪:\n${fakeLog.slice(-1000)}`)
  }

  // 2. 会话日志快照 → 跑任务 → 差集归档
  const sessionsRoot = join(dshHome, 'sessions')
  const before = listSessionFiles(sessionsRoot)
  const startedAt = Date.now()
  const limit = Math.min(task.timeoutSec, timeoutCap)
  const r = await runGroup('pnpm', ['dsh', '--profile', 'headless',
    ...overlays.flatMap((o) => ['--patch', o]), task.prompt], {
    cwd: HOST_REPO, env: dshEnv(task.id, port), timeoutSec: limit,
  })
  const wallSec = Math.round((Date.now() - startedAt) / 1000)
  killGroup(fake.pid)

  const stdoutFile = join(outDir, `${task.id}.stdout.txt`)
  writeFileSync(stdoutFile, r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : ''))
  const newFiles = [...listSessionFiles(sessionsRoot)].filter((f) => !before.has(f))
  const sessionDir = join(outDir, 'sessions', task.id)
  mkdirSync(sessionDir, { recursive: true })
  for (const f of newFiles) cpSync(f, join(sessionDir, f.split('/').pop()!), { force: true })

  results.push({
    id: task.id, prompt: task.prompt, provider, model,
    exitCode: r.code, timedOut: r.timedOut, fakePort: port, fakeScenario: task.fake.scenario,
    sessionFiles: newFiles.map((f) => f.split('/').pop()!), stdoutFile: `${task.id}.stdout.txt`, wallSec,
  })
  console.log(`[eval-run] ${task.id}：exit=${r.code}${r.timedOut ? '(TIMEOUT)' : ''} wall=${wallSec}s sessions=${newFiles.length}`)
}

/** 实验指纹：git 状态 + 任务集哈希（P2 纪律——实验数据必须对得上代码版本）。 */
function gitInfo(dir: string): { commit: string; dirty: number } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split('\n').filter(Boolean).length
    return { commit, dirty }
  } catch {
    return { commit: 'unknown', dirty: -1 }
  }
}
const harnessFingerprint = {
  matDsh: gitInfo(MAT_ROOT),
  host: gitInfo(resolve(MAT_ROOT, '..', 'deepseek-harness')),
  tasksHash: createHash('sha256')
    .update(readFileSync(join(MAT_ROOT, 'scripts', 'eval-golden-tasks.ts')))
    .digest('hex').slice(0, 16),
  overlays: overlays.map((o) => basename(o)),
}

const manifest = {
  ranAt: new Date().toISOString(),
  dshHome,
  provider, model,
  lane: 'replay',
  env: extraEnv,
  harnessFingerprint,
  results,
}
writeFileSync(join(outDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`[eval-run] 完成：${results.length} 任务 → ${outDir}/run.json`)
console.log(`[eval-run] 下一步：pnpm eval:report -- --run ${outDir}`)
