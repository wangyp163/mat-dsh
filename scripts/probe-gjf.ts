import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'head -6 "$HOME/workspace/h2o-osc-999/sp/job.gjf" 2>/dev/null; echo ===; grep -c "SCF Done" "$HOME/workspace/h2o-osc-999/sp/job.log" 2>/dev/null; grep -E "Convergence|cycle" "$HOME/workspace/h2o-osc-999/sp/job.log" 2>/dev/null | tail -3', 60)
console.log(outputText(r))
