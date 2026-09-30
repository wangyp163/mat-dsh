import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const wd = process.argv[2]
const r = await client.execCommand('11250', `cat "${wd}/result.json" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print([p for p in d.get('plots',[]) if p.get('kind')=='irc_profile'])" 2>&1; echo ===CSV===; find "${wd}/irc" -name "*.csv" 2>/dev/null | head -5; for f in $(find "${wd}/irc" -name "*irc*profile*.csv" 2>/dev/null | head -1); do echo "--- $f"; head -8 "$f"; echo ...; tail -4 "$f"; done; echo ===DIAG===; cat "${wd}/diag/att-001-irc-wrong-direction/conclusion.md" 2>/dev/null | head -40`, 60)
console.log(outputText(r))
