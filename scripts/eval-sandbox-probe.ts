/**
 * eval-sandbox-probe：P1 沙箱越权探针 + 开销微基准（零 token）。
 *
 * 对照两泳道（包裹命令与 dsh-bash-sandbox 同源：sandbox-local/src/profiles.ts）：
 *   confined  —— bwrap workspace-write 档（base bundle 默认档；本机后端经
 *               功能探针仲裁选中 bwrap / full enforcement）
 *   plain     —— danger-full-access 档语义（provider 永不被咨询 = 直接 spawn）
 *
 * 安全边界（v3，吸取 v2 教训——plain 泳道曾真改宿主 /etc/hosts 与 $HOME 权限）：
 *   - confined 泳道可对真目标发起（预期被拒，零副作用）；
 *   - plain 泳道对破坏性命令使用**安全替代目标**（同命令类，探针自管路径）；
 *   - 断言以文件系统终态为准（比退出码强：被删的文件必须仍在、被拒写的
 *     文件必须不存在）。
 *
 * 用法：pnpm exec tsx scripts/eval-sandbox-probe.ts [--out docs/evidence/eval/sandbox-20261015]
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// 宿主真实 profile 构造器（与 sandbox-local provider confine() 同源，不复制实现）
import { bwrapProfileArgs } from '../../deepseek-harness/packages/sandbox/sandbox-local/src/profiles.ts'

const MAT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : String(process.argv[i + 1] ?? '')
}
const outDir = resolve(MAT_ROOT, argValue('out') ?? 'docs/evidence/eval/sandbox-20261015')

interface SandboxPolicyShape { mode: 'read-only' | 'workspace-write'; workspaceRoot: string }

/** workspace 模拟：隔离的临时 workspace 目录（不污染真仓库）。 */
const workspaceRoot = mkdtempSync(join(tmpdir(), 'sbx-probe-ws-'))
const policy: SandboxPolicyShape = { mode: 'workspace-write', workspaceRoot }
const WRAP = [...bwrapProfileArgs(policy as never), '--']

const HOME = process.env.HOME ?? '/root'

function run(lane: 'plain' | 'confined', command: string): { code: number | null; stdout: string; stderr: string } {
  const argv = lane === 'confined' ? ['bwrap', ...WRAP, 'bash', '-c', command] : ['bash', '-c', command]
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 15_000 })
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ── 越权矩阵（每泳道显式命令 + 文件系统终态断言） ──────────────────────────

interface ProbeCase {
  id: string
  note: string
  confinedCmd: string
  /** plain 泳道命令；破坏性命令用安全替代目标（同命令类）。 */
  plainCmd: string
  confinedExpect: 'allowed' | 'denied'
  plainExpect: 'allowed' | 'denied'
  /** 终态断言（可选）：run 后必须存在 / 必须不存在的绝对路径。 */
  mustExistAfter?: string[]
  mustNotExistAfter?: string[]
}

// 探针自有目标（宿主侧预建/预清）
const targets = {
  confinedHome: join(HOME, 'sbx-escape.marker'),
  plainHome: join(HOME, 'sbx-plain.marker'),
  rmConfined: join(HOME, 'sbx-rm-confined.marker'),
  rmPlain: join(HOME, 'sbx-rm-plain.marker'),
  tmpUsr: '/tmp/sbx-plain-usr.marker',
  tmpHosts: '/tmp/sbx-hosts-append.marker',
  tmpProbe: '/tmp/sbx-probe-tmp.txt',
  wsFile: join(workspaceRoot, 'w.txt'),
}
// 预清 + 预建（rm 探针需要真实存量文件）
for (const p of Object.values(targets)) if (existsSync(p)) rmSync(p, { force: true })
writeFileSync(targets.rmConfined, 'confined target\n')
writeFileSync(targets.rmPlain, 'plain target\n')
/** plain 泳道 chmod 的安全替代目标（探针自有目录，结束还原 755）。 */
const chmodDir = mkdtempSync(join(tmpdir(), 'sbx-probe-chmod-'))

const CASES: ProbeCase[] = [
  {
    id: 'write-workspace',
    note: '合法写：workspace 内（bind rw）',
    confinedCmd: `echo ok > "${targets.wsFile}"`,
    plainCmd: `echo ok > "${targets.wsFile}"`,
    confinedExpect: 'allowed', plainExpect: 'allowed',
    mustExistAfter: [targets.wsFile],
  },
  {
    id: 'write-tmp',
    note: '合法写：/tmp（bwrap tmpfs）',
    confinedCmd: `echo ok > ${targets.tmpProbe}`,
    plainCmd: `echo ok > ${targets.tmpProbe}`,
    confinedExpect: 'allowed', plainExpect: 'allowed',
    mustExistAfter: [targets.tmpProbe],
  },
  {
    id: 'write-home',
    note: '越权写：家目录（生产事故面：env.local 凭据在此）',
    confinedCmd: `echo escape > "${targets.confinedHome}"`,
    plainCmd: `echo escape > "${targets.plainHome}"`,
    confinedExpect: 'denied', plainExpect: 'allowed',
    mustNotExistAfter: [targets.confinedHome],
  },
  {
    id: 'write-usr-local',
    note: '越权写：系统路径（plain 泳道用 /tmp 替代目标，同命令类）',
    confinedCmd: `echo escape > /usr/local/sbx-escape.marker`,
    plainCmd: `echo escape > ${targets.tmpUsr}`,
    confinedExpect: 'denied', plainExpect: 'allowed',
    mustNotExistAfter: ['/usr/local/sbx-escape.marker'],
  },
  {
    id: 'append-etc-hosts',
    note: '越权改写 /etc/hosts·DNS 劫持面（plain 泳道用 /tmp 替代目标）',
    confinedCmd: `echo "0.0.0.0 evil.example" >> /etc/hosts`,
    plainCmd: `echo "0.0.0.0 evil.example" >> ${targets.tmpHosts}`,
    confinedExpect: 'denied', plainExpect: 'allowed',
  },
  {
    id: 'rm-home-file',
    note: '越权删除：家目录预存文件（两泳道各自预建目标）',
    confinedCmd: `rm -f "${targets.rmConfined}"`,
    plainCmd: `rm -f "${targets.rmPlain}"`,
    confinedExpect: 'denied', plainExpect: 'allowed',
    mustExistAfter: [targets.rmConfined],
  },
  {
    id: 'chmod-bypass',
    note: '绕过尝试：chmod 提权后写（EROFS 不可 chmod 解；plain 对自有目录）',
    confinedCmd: `chmod 777 "$HOME" && touch "$HOME/sbx-w.marker"`,
    plainCmd: `chmod 777 "${chmodDir}" && touch "${chmodDir}/w.marker"`,
    confinedExpect: 'denied', plainExpect: 'allowed',
    mustNotExistAfter: [join(HOME, 'sbx-w.marker')],
  },
]

const matrix = CASES.map((c) => {
  const confR = run('confined', c.confinedCmd)
  const plainR = run('plain', c.plainCmd)
  const confDenied = confR.code !== 0
  const plainDenied = plainR.code !== 0
  const confinedAsExpected = c.confinedExpect === 'denied' ? confDenied : !confDenied
  const plainAsExpected = c.plainExpect === 'denied' ? plainDenied : !plainDenied
  const stateOk = (c.mustExistAfter ?? []).every((p) => existsSync(p))
    && (c.mustNotExistAfter ?? []).every((p) => !existsSync(p))
  // 内容级校验：/etc/hosts 不得混入探针行
  const hostsClean = !readFileSync('/etc/hosts', 'utf8').includes('evil.example')
  const pass = confinedAsExpected && plainAsExpected && stateOk && hostsClean
  return {
    id: c.id, note: c.note,
    plain: { code: plainR.code, denied: plainDenied, stderrTail: plainR.stderr.trim().slice(-120) },
    confined: { code: confR.code, denied: confDenied, stderrTail: confR.stderr.trim().slice(-120) },
    stateOk, pass,
  }
})

// ── 开销微基准（workspace 必须仍存在——bwrap --bind 挂载点） ────────────────

function cleanup(): void {
  for (const p of [...Object.values(targets), join(HOME, 'sbx-w.marker'), '/usr/local/sbx-escape.marker']) {
    if (existsSync(p)) rmSync(p, { force: true })
  }
  try { chmodSync(chmodDir, 0o755) } catch { /* 目录可能已被删除 */ }
  rmSync(chmodDir, { recursive: true, force: true })
  rmSync(workspaceRoot, { recursive: true, force: true })
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}
const N = Number(argValue('bench-n') ?? 15)
function bench(lane: 'plain' | 'confined'): number {
  const samples: number[] = []
  let failure: string | undefined
  for (let i = 0; i < N; i += 1) {
    const t0 = process.hrtime.bigint()
    const argv = lane === 'confined' ? ['bwrap', ...WRAP, 'bash', '-c', 'true'] : ['bash', '-c', 'true']
    const r = spawnSync(argv[0], argv.slice(1), { timeout: 15_000 })
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    if (r.status === 0) samples.push(ms)
    else failure ??= `status=${r.status} err=${String(r.error?.message ?? r.stderr ?? '')}`.slice(0, 160)
  }
  if (samples.length === 0) throw new Error(`bench(${lane}) 无有效样本（${N} 次全部失败）：${failure ?? '未知'}`)
  return Math.round(median(samples) * 100) / 100
}
const benchPlainMs = bench('plain')
const benchConfinedMs = bench('confined')
cleanup()

// ── 输出 ────────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true })
const allPass = matrix.every((m) => m.pass)
const result = {
  ranAt: new Date().toISOString(),
  backend: 'bwrap (workspace-write profile, full enforcement)',
  matrix,
  bench: {
    n: N, plainMedianMs: benchPlainMs, confinedMedianMs: benchConfinedMs,
    overheadMs: Math.round((benchConfinedMs - benchPlainMs) * 100) / 100,
    overheadRatio: benchPlainMs > 0 ? Math.round(((benchConfinedMs / benchPlainMs) - 1) * 100) / 100 : null,
  },
  allPass,
}
writeFileSync(join(outDir, 'sandbox-probe.json'), JSON.stringify(result, null, 2) + '\n')

const md: string[] = []
md.push('# 沙箱越权探针 + 开销微基准（P1，零 token）')
md.push('')
md.push(`- 轮次：${result.ranAt}｜后端：${result.backend}`)
md.push(`- 判定总览：${allPass ? '✅ 全部符合预期（含文件系统终态校验）' : '❌ 存在不符合预期的探针'}`)
md.push('- 方法：confined 泳道对真目标发起（预期被拒零副作用）；plain 泳道对破坏性命令使用安全替代目标（同命令类）；断言含文件系统终态。')
md.push('')
md.push('| # | 探针 | plain | confined | 终态 | 判定 |')
md.push('|---|---|---|---|---|---|')
for (const m of matrix) {
  md.push(`| ${m.id} | ${m.note} | ${m.plain.denied ? '被拒' : '成功'} (${m.plain.code}) | ${m.confined.denied ? '被拒' : '成功'} (${m.confined.code}) | ${m.stateOk ? '✅' : '❌'} | ${m.pass ? '✅' : '❌'} |`)
}
md.push('')
md.push('## 每 bash 调用沙箱开销（bash -c true，N=' + N + ' 取中位）')
md.push('')
md.push(`- plain：${benchPlainMs} ms`)
md.push(`- confined（bwrap 包裹）：${benchConfinedMs} ms`)
md.push(`- 固定开销：+${result.bench.overheadMs} ms/调用（${result.bench.overheadRatio !== null ? `×${(1 + result.bench.overheadRatio).toFixed(1)}` : '?'} 启动比）`)
md.push('')
md.push('拒绝方言样例（bash-sandbox 执行器按此分类 result.sandbox.denied）：')
const deniedSample = matrix.find((m) => m.confined.denied)
if (deniedSample) md.push('> `' + deniedSample.confined.stderrTail.replace(/\n/g, ' ⏎ ') + '`')
writeFileSync(join(outDir, 'sandbox-probe.md'), md.join('\n') + '\n')
console.log(md.join('\n'))
if (!allPass) process.exitCode = 1
