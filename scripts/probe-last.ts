import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'sacct -S 2026-09-30T16:15 -u hpc-user-a -P -n -o JobID,State,ElapsedRaw,WorkDir,Submit -X 2>&1 | tail -6', 60)
console.log(outputText(r))
