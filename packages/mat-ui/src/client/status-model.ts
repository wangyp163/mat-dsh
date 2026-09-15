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
  const ids = slurmIds(job)
  return [
    ['completed', job.phase === 'settled' ? formatCompletionTime(job.settledAt ?? job.updatedAt) : 'in progress'],
    ['partition', job.partition ?? '—'],
    ['job ID', ids.length > 0 ? ids.join(', ') : job.jobId],
    ['status', job.slurm?.[0]?.state ?? job.outcomeStatus ?? (job.phase === 'settled' ? '—' : 'monitoring')],
    ['converged', job.converged === undefined ? '—' : job.converged ? 'yes' : 'no'],
  ]
}

/** 条目携带的真实 Slurm 作业号（板序）。 */
export function slurmIds(job: Pick<MonitorJob, 'slurm'>): string[] {
  return job.slurm?.map(entry => entry.id) ?? []
}

/**
 * 下拉/卡片展示名：job-id 槽位要可直接解析/复制——有 Slurm 投影且 label 没把号带全
 * （watch 批量条目）时就是作业号本身（单个裸号、多个逗号分隔），不拼 ×N/括号噪声；
 * label 已含号（gaussian `… #id`）或无投影时原样返回。
 */
export function jobOptionLabel(job: Pick<MonitorJob, 'jobId' | 'slurm'> & { label?: string }): string {
  const ids = slurmIds(job)
  if (ids.length === 0) return job.label ?? job.jobId
  const base = job.label ?? job.jobId
  return ids.every(id => base.includes(id)) ? base : ids.join(', ')
}
