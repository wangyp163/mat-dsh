import { MatClient, outputText } from '../packages/mat-core/src/index.js'
const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const WD = '$HOME/workspace/scf-watch-probe'
const setup = await client.execCommand('11250', `python3 -c "
lines = []
for i in range(960, 1100):
    e = -74.66 + (1.0 if i % 2 else -1.0)
    lines.append(f' Cycle {i}  Pass 1  IDiag  1:')
    lines.append(f' E= {e:.10f}     Delta-E=       {(8.7 if i%2 else -8.7):.5f} Rises=F Damp=F')
open(__import__('os').environ.get('HOME','') + '/workspace/scf-watch-probe/job.log', 'w').write('\\n'.join(lines))
" && cd ${WD} && sbatch -p kshcnormal --wrap='sleep 185' -o slurm.out`, 60)
console.log('JOB:', /Submitted batch job (\d+)/.exec(outputText(setup))?.[1])
