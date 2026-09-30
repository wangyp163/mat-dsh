import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const ids = [
  '123353159', '123353244', '123353377',            // S1: C1 sp ×2 + C6 freq
  '123353592', '123353675',                          // S2 chain#1 (dead: tsxtb)
  '123354978', '123355038', '123355053',             // S2 chain#2 (dead at gate)
  '123354109', '123354130', '123354153',             // C4' c1
  '123354111', '123354133', '123354163',             // C4' c2
  '123354210', '123354215', '123354228',             // C4' c3
  '123354513', '123354541', '123354590',             // C5 c1
  '123354515', '123354542', '123354588',             // C5 c2
  '123354967', '123355467', '123355895',             // S3 osc ×3
  '123351448', '123352568', '123352778',             // Agent0 已取消 ×3
]
const r = await client.execCommand('11250', `sacct -j ${ids.join(',')} -P -n -o JobID,State,ExitCode,ElapsedRaw,Partition -X 2>&1 | sort -n`, 60)
console.log(outputText(r))
