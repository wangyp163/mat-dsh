import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'sacct -j 123371045,123370261 -P -n -o JobID,State,ElapsedRaw,WorkDir -X 2>&1', 60)
console.log(outputText(r))
