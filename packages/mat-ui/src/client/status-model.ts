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

/**
 * 作业板按会话相互隔离：「本会话」= 当前会话自身（ownerSession === 当前会话 id）。重开历史会话
 * 仍能看到它的作业；其它会话——包括同一工作区里的——不进面板（盘证：ownerSession 即持久会话 id，
 * 且无 parentId 续接链，精确 id 是会话的唯一可靠键）。板序保留，缺省选末位（最新）。
 */
export function jobsForSession<T extends { ownerSession?: string }>(jobs: T[], sessionId: string | undefined): T[] {
  if (sessionId === undefined) return []
  return jobs.filter(job => job.ownerSession === sessionId)
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
