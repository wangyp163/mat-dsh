import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createWatchLoop } from '../src/watch-loop'
import { parseScfSamples } from '../src/scf-trend'

describe('r4 真实形态复现', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('RUNNING 23s + 真实 E= 行 + 5s 采样 → 两窗确认告警', async () => {
    const osc = (i: number) => ` Cycle ${i}  Pass 1  IDiag  1:\n E= ${(-74.66 + (i % 2 ? 1.0 : -1.0)).toFixed(10)}     Delta-E=       ${(i % 2 ? 8.7 : -8.7).toFixed(5)} Rises=F Damp=F\n RMSDP=9.87D-02 MaxDP=7.53D-01\n`
    const tailBody = Array.from({ length: 40 }, (_, k) => osc(960 + k)).join('')
    let jobRunning = true
    const commands: string[] = []
    const exec = async (_c: string, command: string) => {
      commands.push(command)
      if (command.startsWith('sacct')) {
        return { code: 0, data: `999999|${jobRunning ? 'RUNNING' : 'FAILED'}|1:0|10|/w/sp|00:30:00\n`, message: '' }
      }
      if (command.startsWith('for d in')) {
        return { code: 0, data: jobRunning ? `=== /w/sp\n${tailBody}` : '', message: '' }
      }
      throw new Error('unexpected ' + command.slice(0, 50))
    }
    const alerts: string[] = []
    const loop = createWatchLoop({
      clusterId: '11250', jobIds: ['999999'], maxWaitMs: 3_600_000,
      scfSampling: {
        intervalMs: 5_000,
        buildCommand: (ws) => `for d in ${ws.map(w => `'${w}'`).join(' ')}; do echo "=== $d"; tail -n 200 "$d/job.log" "$d"/*/job.log 2>/dev/null; done`,
        parse: parseScfSamples,
        onTrend: (rs) => alerts.push(rs.map(r => `${r.jobId}:${r.trend.kind}`).join('|')),
      },
      execCommand: exec as never,
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    for (let t = 0; t < 40; t += 1) {
      if (t === 23) jobRunning = false
      await vi.advanceTimersByTimeAsync(1_000)
    }
    console.log('sacct ticks:', commands.filter(c => c.startsWith('sacct')).length,
      'sample execs:', commands.filter(c => c.startsWith('for d in')).length,
      'alerts:', JSON.stringify(alerts))
    expect(alerts.length).toBeGreaterThan(0)
    loop.cancel('done')
  })
})
