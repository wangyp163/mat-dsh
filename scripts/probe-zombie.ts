import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'sacct -j 121176610,121342837,123137497,123145380,123275111,123286649,123295032 -P -n -o JobID,State,ElapsedRaw -X 2>&1; echo ---; squeue -u hpc-user-a -h 2>&1 | head -5', 60)
console.log(outputText(r))
