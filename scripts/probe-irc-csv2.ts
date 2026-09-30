import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const r = await client.execCommand('11250', 'f="/public/home/hpc-user-a/workspace/hcn-hshift-tsxtb-ts-irc/tsxtb+ts+irc/03-irc/irc_profile.csv"; head -10 "$f"; echo "...."; tail -6 "$f"; echo; wc -l "$f"', 60)
console.log(outputText(r))
