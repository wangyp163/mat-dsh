import { useEffect, useState } from 'react'
import { monitorMetadata } from './status-model'
import type { MonitorJob } from './status-model'

type Job = MonitorJob & { label: string; outcomeStatus?: string }

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
  return <aside className="mat-result-tail">
    <span className="mat-status-dock__eyebrow">LATEST COMPUTATION</span>
    <strong>{job.label}</strong>
    <dl className="mat-status-card__metadata">
      {monitorMetadata(job).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  </aside>
}
