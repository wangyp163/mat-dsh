import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({
  mcpKey: process.env.MAT_MCP_KEY ?? '',
  baseUrl: process.env.MAT_MCP_BASE_URL || undefined,
})
const r1 = await client.execCommand('11250', 'squeue -j 123352568 -o "%.10i %.12P %.8T %.10M %.6D %R" 2>&1; echo ---; sinfo -h -o "%.15P %.10a %.13D %.15C %G" 2>&1 | head -8', 60)
console.log(outputText(r1))
