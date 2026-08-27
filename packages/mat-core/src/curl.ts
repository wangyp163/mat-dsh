import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export interface CurlArgsInput {
  url: string
  body: string
  maxTimeSec: number
  sessionId?: string
}

export function buildCurlArgs(input: CurlArgsInput): string[] {
  const args = [
    'curl', '-k', '-s', '--noproxy', '*',
    '-H', 'Content-Type: application/json',
    '-H', 'Accept: application/json, text/event-stream',
  ]
  if (input.sessionId) args.push('-H', `Mcp-Session-Id: ${input.sessionId}`)
  args.push('-D', '/dev/stderr', '-d', input.body, '--max-time', String(input.maxTimeSec), input.url)
  return args
}

export function extractSessionId(headersText: string): string | null {
  for (const line of headersText.split('\n')) {
    if (line.toLowerCase().includes('mcp-session-id')) {
      const value = line.split(':', 2)[1]
      if (value) return value.trim()
    }
  }
  return null
}

/** 解析 MCP SSE 响应，返回 remote_shell_execute 的 HPC 业务 JSON（code/data/message）。 */
export function parseToolCallResponse(stdout: string): Record<string, unknown> {
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const mcp = JSON.parse(line.slice(6)) as {
        result?: { content?: Array<{ type: string; text: string }> }
      }
      const text = mcp.result?.content?.[0]?.text
      if (typeof text === 'string') return JSON.parse(text) as Record<string, unknown>
    } catch {
      // 坏行（心跳/半截 JSON）跳过，继续找下一个 data 行
    }
  }
  throw new Error('empty MCP stream (likely network fault)')
}

const execFileAsync = promisify(execFile)

export interface CommandResult {
  rc: number
  stdout: string
  stderr: string
}

export type CommandRunner = (argv: string[]) => Promise<CommandResult>

/** 生产执行器：curl 子进程（Node 原生网络栈对 mcp-gateway.example.internal 有 SSL 风险，curl 为实测稳定路径）。 */
export const defaultRunner: CommandRunner = async (argv) => {
  try {
    const { stdout, stderr } = await execFileAsync('curl', argv, {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { rc: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      rc: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(e.message ?? err),
    }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface CurlRetryOptions {
  delays?: [number, number, number]
  requireBody?: boolean
}

/** 三级容错第一级：curl 层重试（rc≠0 或 requireBody 时 body 空 → 5s/15s/30s 三次）。 */
export async function curlWithRetry(
  run: CommandRunner,
  argv: string[],
  opts: CurlRetryOptions = {},
): Promise<CommandResult> {
  const delays = opts.delays ?? [5, 15, 30]
  const requireBody = opts.requireBody ?? false
  let last: Error | undefined
  // 重试次数固定为 3；delays 只提供前两次退避（缺省回落 30s）
  for (let i = 0; i < 3; i += 1) {
    try {
      const result = await run(argv)
      if (result.rc !== 0 || (requireBody && !result.stdout.trim())) {
        throw new Error(`curl failed: rc=${result.rc} body_len=${result.stdout.length}`)
      }
      return result
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err))
      if (i < 2) await sleep(delays[i] ?? 30)
    }
  }
  throw last ?? new Error('curl failed')
}
