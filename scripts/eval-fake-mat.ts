/**
 * eval-fake-mat：本地回放泳道的 fake HPC remote-shell MCP 服务器（P0.5）。
 *
 * 复刻 HPC MCP 网关的最小协议面（与 mat-core 的 curl 传输一一对应）：
 *   POST <任意路径>  JSON-RPC initialize → 响应头 Mcp-Session-Id
 *                    JSON-RPC tools/call remote_shell_execute → SSE 信封
 *                    data: {"result":{"content":[{"type":"text","text":"<业务 JSON>"}]}}
 *   业务 JSON：{code:0, data:"\nSCNXS:<token>\n<stdout>", message:"success"}
 *   —— data 内嵌 exec-guard 标记（token 从被包裹命令里反向提取），否则客户端判串扰。
 *
 * 命令路由（按子串匹配被包裹命令，顺序即优先级）：
 *   printf %s "$HOME"            → /public/home/eval（workdir-resolver 家目录探测）
 *   sinfo -o                     → 契约夹具 sinfo-5col.txt（真实录制）
 *   sacct -j                     → 有状态 Slurm 模拟（sbatch 发号，墙钟推进状态机）
 *   squeue -j                    → 空输出（本集群对 RUNNING 作业常为空，实测行为）
 *   scancel <id>                 → 标记取消
 *   sbatch                       → Submitted batch job <id>（登记新作业）
 *   check_environment.sh         → 环境门禁 pass JSON（gaussian-env-gate.v2）
 *   echo PREP_READY（prepare 链）→ PREP_READY
 *   gaussian-workflow -p pre|run → 契约夹具 pre-ok / run-ok stdout（真实录制）
 *   gaussian-workflow -p post    → 按 scenario：post-ok 夹具 / failed 结果 JSON
 *   tail … job.log               → 按 scenario：正常结束尾 / 收敛失败尾
 *   其余                          → 空成功
 *
 * 用法：tsx scripts/eval-fake-mat.ts --port 18765 --scenario completed \
 *        --pending-ms 6000 --run-ms 15000
 * 由 scripts/eval-run.ts 按任务场景拉起，一般不手跑。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(scriptDir, '..', 'packages', 'mat-core', 'test', 'contract', 'fixtures')

// ── CLI 参数 ────────────────────────────────────────────────────────────────

function argNumber(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return dflt
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : dflt
}
function argString(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? dflt : String(process.argv[i + 1] ?? dflt)
}

const PORT = argNumber('port', 0)
const SCENARIO = argString('scenario', 'completed') as 'completed' | 'failed'
const PENDING_MS = argNumber('pending-ms', 5000)
const RUN_MS = argNumber('run-ms', 12000)
// P2 长会话填充：撑大工具输出（配合小 contextWindow 声明触发 compaction）。
// sinfo 追加合成分区行；gaussian 三相位输出前插 banner 行（parsePostOutput
// 取首个 '{' 行，前置非 JSON 行安全）。
const PAD_SINFO = argNumber('pad-sinfo', 0)
const PAD_GAUSSIAN = argNumber('pad-gaussian', 0)

function padSinfo(base: string): string {
  if (PAD_SINFO <= 0) return base
  const rows: string[] = []
  for (let i = 0; i < PAD_SINFO; i += 1) {
    rows.push(`evalpad-${String(i).padStart(5, '0')}|up|1-00:00:00|64|idle`)
  }
  return `${base}${rows.join('\n')}\n`
}
function padGaussian(base: string): string {
  if (PAD_GAUSSIAN <= 0) return base
  const lines: string[] = []
  for (let i = 0; i < PAD_GAUSSIAN; i += 1) {
    lines.push(`[GAUSSIAN-WORKFLOW-KSYZQ] eval padding line ${i} 0123456789abcdefghijklmnopqrstuvwxyz`)
  }
  return `${lines.join('\n')}\n${base}`
}

// ── 夹具（真实录制，PROVENANCE 见 test/contract/PROVENANCE.md） ─────────────

async function loadFixtures(): Promise<Record<string, string>> {
  const read = (p: string) => readFile(join(FIXTURES, p), 'utf8')
  const [sinfo, pre, run, post] = await Promise.all([
    read('slurm/sinfo-5col.txt'),
    read('gaussian/pre-ok.stdout.txt'),
    read('gaussian/run-ok.stdout.txt'),
    read('gaussian/post-ok.stdout.txt'),
  ])
  return { sinfo, pre, run, post }
}
const fixtures = await loadFixtures()

// ── 有状态 Slurm 模拟 ───────────────────────────────────────────────────────

interface FakeJob {
  id: string
  submittedAt: number
  cancelledAt?: number
  workdir: string
}
const jobs = new Map<string, FakeJob>()
let jobCounter = 900_000

function submitJob(): string {
  jobCounter += 1
  const id = String(jobCounter)
  jobs.set(id, { id, submittedAt: Date.now(), workdir: `/public/home/eval/job-${id}` })
  return id
}

/** 与 watch-loop 实际命令同列集：JobID,State,ExitCode,ElapsedRaw,WorkDir,Timelimit。 */
function sacctRows(requestedIds: string[]): string {
  const lines: string[] = []
  for (const id of requestedIds) {
    const job = jobs.get(id)
    if (!job) continue // 不存在的 id 静默不出行（实测行为）
    const age = Date.now() - job.submittedAt
    let state: string
    let exit = '0:0'
    let elapsed = 0
    if (job.cancelledAt !== undefined) {
      state = 'CANCELLED'
      elapsed = Math.max(0, Math.floor((job.cancelledAt - job.submittedAt) / 1000))
    } else if (age < PENDING_MS) {
      state = 'PENDING'
    } else if (age < PENDING_MS + RUN_MS) {
      state = 'RUNNING'
      elapsed = Math.floor((age - PENDING_MS) / 1000)
    } else {
      state = SCENARIO === 'failed' ? 'FAILED' : 'COMPLETED'
      exit = SCENARIO === 'failed' ? '1:0' : '0:0'
      elapsed = Math.ceil(RUN_MS / 1000)
    }
    const main = `${id}|${state}|${exit}|${elapsed}|${job.workdir}|`
    lines.push(main)
    if (state !== 'PENDING' && state !== 'RUNNING') {
      lines.push(`${id}.batch|${state}|${exit}|${elapsed}||`, `${id}.extern|${state}|${exit}|${elapsed}||`)
    }
  }
  return lines.join('\n')
}

// ── 场景相关的 Gaussian 输出 ────────────────────────────────────────────────

const POST_FAILED_STDOUT = [
  '[GAUSSIAN-WORKFLOW-KSYZQ] Environment loaded',
  JSON.stringify({
    schema_version: 'calcflow.result.v1', software: 'gaussian', task: 'opt',
    phase: 'post', status: 'failed', workdir: '/public/home/eval',
    execution: { status: 'failed' }, workflow: { status: 'failed', next_action: 'inspect job.log' },
    properties: {}, error: 'gaussian_optimization_not_converged',
    error_detail: 'Optimization stopped — number of steps exceeded (l9999)',
  }),
  '',
].join('\n')

const LOG_TAIL_COMPLETED = [
  ' ......',
  ' Optimization completed on the basis of the original criteria.',
  ' -- Stationary point found.',
  ' ----------------------------',
  ' Job cpu time: 0 days 0 hours 3 minutes 12.0 seconds.',
  ' Normal termination of Gaussian 16 at Tue Oct 14 10:00:00 2026.',
].join('\n')

const LOG_TAIL_FAILED = [
  ' ......',
  ' Optimization stopped.',
  ' -- Number of steps exceeded, OptMax.',
  ' Error termination via Lnk1e in /public/home/eval/g16/l9999.exe',
  ' Job cpu time: 0 days 0 hours 1 minutes 47.0 seconds.',
].join('\n')

const ENV_GATE_JSON = JSON.stringify({
  schema: 'gaussian-env-gate.v2',
  ok: true,
  protocol: 'new',
  deployed_version: '1.7.4',
  expected_version: '1.7.4',
  newer_version: '',
  missing_tasks: [],
  errors: [],
  tasks: ['opt', 'opt+freq', 'freq', 'tddft', 'irc', 'polar'],
  workflow: '/public/home/eval/gaussian-workflow',
  g16: '/public/home/eval/g16.sh',
})

// ── 命令路由 ────────────────────────────────────────────────────────────────

function routeCommand(command: string): string {
  // 顺序即优先级；全部按「正确行为必然出现的子串」匹配，不锁完整命令形态。
  if (command.includes('check_environment.sh')) return ENV_GATE_JSON
  if (command.includes('sinfo -o')) return padSinfo(fixtures.sinfo)
  if (/sacct -j /.test(command)) {
    const m = /sacct -j ([\d,]+)/.exec(command)
    const ids = (m?.[1] ?? '').split(',').filter(Boolean)
    return sacctRows(ids)
  }
  if (/squeue -j /.test(command)) return ''
  if (/scancel \d+/.test(command)) {
    const m = /scancel (\d+)/.exec(command)
    const job = m?.[1] !== undefined ? jobs.get(m[1]) : undefined
    if (job && job.cancelledAt === undefined) job.cancelledAt = Date.now()
    return ''
  }
  if (/sbatch /.test(command)) {
    const id = submitJob()
    return `Submitted batch job ${id}`
  }
  if (command.includes('printf %s "$HOME"')) return '/public/home/eval'
  if (command.includes('PREP_READY')) return 'PREP_READY'
  if (/gaussian-workflow -t \S+ -p pre /.test(command)) return padGaussian(fixtures.pre)
  if (/gaussian-workflow -t \S+ -p run /.test(command)) return padGaussian(fixtures.run)
  if (/gaussian-workflow -t \S+ -p post /.test(command)) {
    return padGaussian(SCENARIO === 'failed' ? POST_FAILED_STDOUT : fixtures.post)
  }
  if (/job\.log/.test(command) && /tail /.test(command)) {
    return SCENARIO === 'failed' ? LOG_TAIL_FAILED : LOG_TAIL_COMPLETED
  }
  return ''
}

// ── MCP 协议层 ──────────────────────────────────────────────────────────────

function sseBody(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function send(res: ServerResponse, status: number, body: string, sessionId?: string): void {
  const headers: Record<string, string> = { 'content-type': 'text/event-stream' }
  if (sessionId !== undefined) headers['mcp-session-id'] = sessionId
  res.writeHead(status, headers)
  res.end(body)
}

let sessionCounter = 0

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, 'method not allowed\n')
    return
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  let rpc: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
  try {
    rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    send(res, 400, 'bad json\n')
    return
  }

  if (rpc.method === 'initialize') {
    sessionCounter += 1
    send(res, 200, sseBody({
      jsonrpc: '2.0', id: 1,
      result: {
        protocolVersion: '2024-11-05', capabilities: {},
        serverInfo: { name: 'eval-fake-mat', version: '1.0.0' },
      },
    }), `fake-${sessionCounter}-${Date.now()}`)
    return
  }

  if (rpc.method === 'tools/call' && rpc.params?.name === 'remote_shell_execute') {
    const args = rpc.params.arguments ?? {}
    const command = String(args.command ?? '')
    // guard 包裹格式：printf '\nSCNXS:<token>\n'; <command> …（token 为 16 位 hex）
    const token = /SCNXS:([0-9a-f]+)/.exec(command)?.[1] ?? '0'.repeat(16)
    const stdout = routeCommand(command)
    const business = { code: 0, data: `\nSCNXS:${token}\n${stdout}`, message: 'success' }
    send(res, 200, sseBody({
      jsonrpc: '2.0', id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify(business) }] },
    }))
    return
  }

  send(res, 200, sseBody({ jsonrpc: '2.0', id: 1, result: { content: [] } }))
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    send(res, 500, `internal error: ${String(err)}\n`)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address()
  const port = typeof addr === 'object' && addr !== null ? addr.port : PORT
  // stdout 是与 eval-run 的控制协议：第一行必须是可以解析的监听端口。
  process.stdout.write(`FAKE_MAT_LISTENING ${port}\n`)
})

// 每个 HTTP keep-alive 连接闲置 65s 后关闭，防止长跑批累积悬挂 socket。
server.keepAliveTimeout = 65_000
