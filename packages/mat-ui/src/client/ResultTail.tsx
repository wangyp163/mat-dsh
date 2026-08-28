import { useEffect, useState } from 'react'

type Job = { jobId: string; label: string; phase: string; outcomeStatus?: string; detail?: string; properties?: Record<string, unknown>; files?: string[] }

export function ResultTail(): JSX.Element | null {
  const [job, setJob] = useState<Job | undefined>()
  useEffect(() => {
    let live = true
    fetch('/mat-status/jobs', { cache: 'no-store' }).then(r => r.ok ? r.json() as Promise<{ jobs?: Job[] }> : { jobs: [] }).then(p => {
      if (live) setJob(p.jobs?.filter(j => j.phase === 'settled').at(-1))
    }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!job) return null
  return <aside className="mat-result-tail"><span className="mat-status-dock__eyebrow">LATEST COMPUTATION</span><strong>{job.label}</strong>{job.detail ? <p>{job.detail}</p> : null}{job.properties ? <div className="mat-status-card__properties">{Object.entries(job.properties).slice(0, 4).map(([k, v]) => <span key={k}><b>{k}</b> {String(v)}</span>)}</div> : null}{job.files?.length ? <small>files · {job.files.join(', ')}</small> : null}</aside>
}
