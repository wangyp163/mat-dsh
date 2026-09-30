import { MatClient, outputText } from '../packages/mat-core/src/index.js'
import { parseScfSamples, classifyScfTrend, globScfTailCommand } from '../packages/mat-core/src/index.js'

const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const cmd = globScfTailCommand(['/public/home/hpc-user-a/workspace/scf-watch-probe'])
console.log('CMD:', cmd.slice(0, 120))
const r = await client.execCommand('11250', cmd, 30)
console.log('r.code:', r.code, '| r.data type:', typeof r.data, Array.isArray(r.data) ? 'array' : '')
if (typeof r.data === 'object' && r.data !== null) {
  console.log('r.data keys:', Object.keys(r.data as object), '| stdout len:', String((r.data as { stdout?: string }).stdout?.length))
}
const text = typeof r.data === 'string' ? r.data : ((r.data as { stdout?: string })?.stdout ?? '')
console.log('text head:', JSON.stringify(text.slice(0, 150)))
const parsed = parseScfSamples(text)
for (const [k, v] of parsed) console.log('parsed', k, '→', v.length, 'energies, head:', v.slice(0, 4))
const energies = [...parsed.values()][0] ?? []
console.log('classify:', JSON.stringify(classifyScfTrend(energies)).slice(0, 220))
