import { useEffect, useState } from 'react'

type Job = {
  jobId: string
  kind: string
  label: string
  clusterId: string
  phase: 'monitoring' | 'settled'
  updatedAt: number
  startedAt: number
  outcomeStatus?: string
  detail?: string
  task?: string
  workdir?: string
  slurm?: Array<{ id: string; state: string; elapsedSeconds?: number; exitCode?: number }>
  properties?: Record<string, unknown>
  files?: string[]
}

function statusTone(job: Job): string {
  if (job.phase === 'settled') return job.outcomeStatus === 'completed' ? 'complete' : 'attention'
  return 'active'
}

function elapsed(job: Job): string {
  const seconds = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function StatusDock(): JSX.Element {
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

  if (jobs.length === 0) return <div className="mat-status-dock mat-status-dock--empty">No active HPC jobs</div>
  return <section className="mat-status-dock" aria-label="HPC job status">
    <header className="mat-status-dock__header">
      <span className="mat-status-dock__eyebrow">COMPUTATIONAL MONITOR</span>
      <span className="mat-status-dock__count">{jobs.length} tracked</span>
    </header>
    <div className="mat-status-dock__jobs">
      {jobs.map((job) => <article className="mat-status-card" key={job.jobId}>
        <div className="mat-status-card__topline">
          <span className={`mat-status-chip mat-status-chip--${statusTone(job)}`}>{job.phase}</span>
          <code>{job.jobId}</code>
          <span className="mat-status-card__elapsed">{elapsed(job)}</span>
        </div>
        <strong>{job.label}</strong>
        <div className="mat-status-card__meta">cluster {job.clusterId}{job.task ? ` · ${job.task}` : ''}</div>
        {job.slurm?.length ? <table className="mat-status-table"><tbody>{job.slurm.map((s) => <tr key={s.id}>
          <th>{s.id}</th><td>{s.state}</td><td>{s.elapsedSeconds ?? '—'}s</td><td>{s.exitCode ?? '—'}</td>
        </tr>)}</tbody></table> : null}
        {job.detail ? <p className="mat-status-card__detail">{job.detail}</p> : null}
        {job.properties ? <div className="mat-status-card__properties">{Object.entries(job.properties).slice(0, 3).map(([key, value]) => <span key={key}><b>{key}</b> {String(value)}</span>)}</div> : null}
      </article>)}
    </div>
  </section>
}
