import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'f="$HOME/workspace/h2o-osc-999/sp/job.log"; wc -l "$f"; grep -c "SCF Done" "$f"; echo ---; sed -n "5,12p" "$f"; echo ---; ls "$HOME/workspace/h2o-osc-999/sp/" | head; echo ---; for g in "$HOME/workspace/h2o-osc-999/sp/"*.log "$HOME/workspace/h2o-osc-999/sp/"*.out; do echo "$g: $(wc -l < "$g" 2>/dev/null) lines, $(grep -c "SCF Done" "$g" 2>/dev/null) SCFDone"; done', 60)
console.log(outputText(r))
