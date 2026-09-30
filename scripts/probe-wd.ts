import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'sacct -j 123371645 -P -n -o JobID,State,ExitCode,ElapsedRaw,WorkDir,Timelimit 2>&1 | head -3 | cat -A | head -3', 60)
console.log(outputText(r))
