import { MatClient, outputText } from '../packages/mat-core/src/index.js'
import { createWatchLoop } from '../packages/mat-core/src/index.js'
import { parseScfSamples, globScfTailCommand } from '../packages/mat-core/src/index.js'
const jobId = process.argv[2]
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const alerts: string[] = []
const loop = createWatchLoop({
  clusterId: '11250', jobIds: [jobId], maxWaitMs: 300_000,
  scfSampling: { intervalMs: 5_000, buildCommand: (ws) => globScfTailCommand(ws), parse: parseScfSamples,
    onTrend: (rs) => alerts.push(rs.map(r => `${r.trend.kind}`).join(',')) },
  execCommand: (c, cmd, t) => client.execCommand(c, cmd, t),
  scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
})
const o = await loop.done
console.log('standalone outcome:', o.status, '| alerts:', JSON.stringify(alerts))
