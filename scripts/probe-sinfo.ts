import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const c = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await c.execCommand('11250', 'sinfo -o "%P %a %l %D %T %N" 2>/dev/null | head -15', 30)
console.log(outputText(r))
