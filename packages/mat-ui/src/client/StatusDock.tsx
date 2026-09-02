import { useEffect, useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MonitorJob } from './status-model'

type Job = MonitorJob & {
  kind?: string
  label?: string
  clusterId?: string
  outcomeStatus?: string
}

function statusState(job: Job): 'done' | 'warning' | 'ongoing' | 'error' {
  if (job.phase !== 'settled') return 'ongoing'
  return job.outcomeStatus === 'completed' ? 'done' : 'error'
}

export function StatusDock({
  openDetailsTab,
  onOpenTask = () => { openDetailsTab?.('mat-task') },
}: {
  openDetailsTab?: (id: string) => void
  onOpenTask?: () => void
}): JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([])
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const response = await fetch('/mat-status/jobs', { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as { jobs?: Job[] }
        if (alive) setJobs(Array.isArray(payload.jobs) ? payload.jobs : [])
      } catch { /* web route unavailable while node half is booting */ }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 5_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  const latest = jobs[jobs.length - 1]
  return (
    <button
      type="button"
      className="mat-status-strip"
      aria-label={latest === undefined ? 'Open HPC task details' : `Open task ${latest.jobId}`}
      onClick={onOpenTask}
      role="status"
    >
      <StateDot state={latest === undefined ? 'done' : statusState(latest)} />
      <span className="mat-status-strip__label">
        {latest === undefined ? 'HPC ready' : latest.phase === 'settled' ? 'Computation finished' : 'Computation running'}
      </span>
      {latest !== undefined && <code>{latest.jobId}</code>}
      {jobs.length > 1 && <span className="mat-status-strip__count">{jobs.length} tasks</span>}
      <span className="mat-status-strip__action">Details</span>
    </button>
  )
}
