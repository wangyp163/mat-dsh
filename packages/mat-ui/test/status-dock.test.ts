import { describe, expect, it } from 'vitest'
import { formatCompletionTime, monitorMetadata } from '../src/client/status-model'

describe('compact computational monitor model', () => {
  it('projects only task metadata and formats settled completion time', () => {
    const metadata = monitorMetadata({
      jobId: 'mat-slurm-1',
      kind: 'mat-slurm',
      label: 'gaussian opt+freq @11250 #700',
      clusterId: '11250',
      phase: 'settled',
      startedAt: 1_000,
      updatedAt: 1_000,
      settledAt: 1_000,
      outcomeStatus: 'completed',
      task: 'opt+freq',
      partition: 'Agent0',
      converged: true,
      slurm: [{ id: '700', state: 'COMPLETED' }],
      detail: 'energy=-76.4 imag=0',
      properties: { energy: -76.4, imaginary_frequency_count: 0 },
    })

    expect(metadata).toEqual([
      ['completed', formatCompletionTime(1_000)],
      ['partition', 'Agent0'],
      ['job ID', '700'],
      ['status', 'COMPLETED'],
      ['converged', 'yes'],
    ])
    expect(metadata.flat()).not.toEqual(expect.arrayContaining(['energy=-76.4', 'imag=0', '-76.4', '0']))
  })

  it('falls back to the settled outcome when no Slurm snapshot exists', () => {
    expect(monitorMetadata({
      jobId: 'watch-2', phase: 'settled', startedAt: 1, updatedAt: 2,
      outcomeStatus: 'completed',
    })[3]).toEqual(['status', 'completed'])
  })

  it('uses an em dash for unavailable optional task metadata', () => {
    expect(monitorMetadata({
      jobId: 'watch-1', kind: 'mat-watch', label: 'watch', clusterId: '11250',
      phase: 'monitoring', startedAt: 1, updatedAt: 2,
    })).toEqual([
      ['completed', 'in progress'],
      ['partition', '—'],
      ['job ID', 'watch-1'],
      ['status', 'monitoring'],
      ['converged', '—'],
    ])
  })
})
