export type MonitorJob = {
  jobId: string
  phase: 'monitoring' | 'settled'
  updatedAt: number
  startedAt: number
  settledAt?: number
  outcomeStatus?: string
  partition?: string
  converged?: boolean
  slurm?: Array<{ id: string; state: string }>
}

export function formatCompletionTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(timestamp)
}

export function monitorMetadata(job: MonitorJob): Array<[string, string]> {
  const slurm = job.slurm?.[0]
  return [
    ['completed', job.phase === 'settled' ? formatCompletionTime(job.settledAt ?? job.updatedAt) : 'in progress'],
    ['partition', job.partition ?? '—'],
    ['job ID', job.jobId],
    ['job number', slurm?.id ?? '—'],
    ['status', slurm?.state ?? job.outcomeStatus ?? (job.phase === 'settled' ? '—' : 'monitoring')],
    ['converged', job.converged === undefined ? '—' : job.converged ? 'yes' : 'no'],
  ]
}
