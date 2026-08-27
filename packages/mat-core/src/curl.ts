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
