import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'scancel 123352778 && echo SCANCELLED; squeue -u hpc-user-a -h 2>&1 | wc -l', 60)
console.log(outputText(r))
