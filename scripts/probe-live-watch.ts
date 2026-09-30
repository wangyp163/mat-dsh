import { MatClient, outputText } from '../packages/mat-core/src/index.js'
import { createWatchLoop } from '../packages/mat-core/src/watch-loop.ts'
import { parseScfSamples, globScfTailCommand } from '../packages/mat-core/src/index.js'

const client = new MatClient({ mcpKey: process.env.MAT_MCP_KEY ?? '', baseUrl: process.env.MAT_MCP_BASE_URL || undefined })
const WD = '$HOME/workspace/scf-watch-probe'
// 1) 造振荡 job.log + sleep 作业(分区 kshcnormal)
const setup = await client.execCommand('11250', `mkdir -p ${WD} && python3 -c "
import sys
lines = []
for i in range(960, 1060):
    e = -74.66 + (1.0 if i % 2 else -1.0)
    lines.append(f' Cycle {i}  Pass 1  IDiag  1:')
    lines.append(f' E= {e:.10f}     Delta-E=       {(8.7 if i%2 else -8.7):.5f} Rises=F Damp=F')
open('$HOME/workspace/scf-watch-probe/job.log'.replace('\\\$HOME', __import__('os').environ.get('HOME','')), 'w').write('\\n'.join(lines))
print('log written')
" && cd ${WD} && sbatch -p kshcnormal --wrap='sleep 65' -o slurm.out && echo OK`, 60)
console.log('SETUP:', outputText(setup).trim())
const jobId = /Submitted batch job (\d+)/.exec(outputText(setup))![1]!
console.log('JOB:', jobId)

// 2) 与 mat_job_watch 工具层完全相同的配置跑 watch
const alerts: string[] = []
const loop = createWatchLoop({
  clusterId: '11250', jobIds: [jobId], maxWaitMs: 300_000,
  scfSampling: {
    intervalMs: 5_000,
    buildCommand: (ws) => globScfTailCommand(ws),
    parse: parseScfSamples,
    onTrend: (rs) => alerts.push(rs.map(r => `${r.jobId}:${r.trend.kind}: ${r.trend.summary.slice(0, 80)}`).join(' | ')),
  },
  execCommand: (c, cmd, t) => client.execCommand(c, cmd, t),
  scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
})
const outcome = await loop.done
console.log('OUTCOME:', outcome.status, outcome.detail.slice(0, 80))
console.log('ALERTS:', alerts.length, alerts)
console.log('OUTPUT:', loop.readOutput().slice(-400))
