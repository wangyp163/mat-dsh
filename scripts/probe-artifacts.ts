import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'ls -la "$HOME/workspace/h2o-sp-b3lyp/freq/ir_spectrum.png" "$HOME/workspace/h2o-sp-b3lyp/freq/ir_spectrum.csv" 2>&1 | awk \'{print $5, $9}\'; echo ---; wc -l "$HOME/workspace/h2o-sp-b3lyp/freq/ir_spectrum.csv" 2>&1; echo ---; ls "$HOME/workspace/" | grep -E "h2o-osc|benz-osc|ts-dsh-demo" 2>&1', 60)
console.log(outputText(r))
