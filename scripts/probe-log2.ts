import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'f="$HOME/workspace/h2o-osc-999/sp/job.log"; grep -n "SCF Done" "$f" | head -3; echo ---; grep -n "E= " "$f" | head -4; echo ---; sed -n "60,75p" "$f"; echo ===r1===; g="$HOME/workspace/h2o-osc/sp/job.log"; wc -l "$g"; grep -c "SCF Done" "$g"', 60)
console.log(outputText(r))
