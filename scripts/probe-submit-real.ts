import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
// 复用 h2o-osc-last 的现成 gjf:拷到新目录并 sbatch(1 核 2GB,999 cycle 振荡 ~60s)
const r = await client.execCommand('11250', `WD="$HOME/workspace/h2o-osc-real2"; mkdir -p "$WD/sp" && cp "$HOME/workspace/h2o-osc-last/sp/job.gjf" "$WD/sp/" && cd "$WD/sp" && sbatch -p kshcnormal -N1 -n1 --mem=2GB --time=00:30:00 --wrap='source $HOME/workspace/g16-hy/scripts/env.sh && g16 < job.gjf > job.log' && echo SUBMITTED`, 60)
console.log(outputText(r).trim())
