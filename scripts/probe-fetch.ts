const url = process.env.MCP_PROBE_URL ?? ''
const key = process.env.MAT_MCP_KEY ?? ''
const full = url || `https://mcp-gateway.example.internal/api/mcp/${key}/7552849000000000000/mcp`

async function main() {
  for (let i = 1; i <= 3; i += 1) {
    const t0 = Date.now()
    try {
      const res = await fetch(full, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
        }),
        signal: AbortSignal.timeout(30_000),
      })
      const sid = res.headers.get('mcp-session-id')
      const text = (await res.text()).slice(0, 200)
      console.log(`try=${i} status=${res.status} session=${sid ? 'yes' : 'no'} elapsed_ms=${Date.now() - t0} body=${text}`)
    } catch (err) {
      console.log(`try=${i} FETCH_FAIL elapsed_ms=${Date.now() - t0} err=${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

void main()
