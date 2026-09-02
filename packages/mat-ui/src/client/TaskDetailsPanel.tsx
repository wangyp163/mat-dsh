import { useEffect, useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { monitorMetadata } from './status-model'
import type { MonitorJob } from './status-model'

type Job = MonitorJob & {
  label?: string
  clusterId?: string
  detail?: string
  files?: string[]
}

interface TaskDetailsPanelProps {
  active?: boolean
  open?: () => void
  openTab?: (id: string) => void
  openDetailsTab?: (id: string) => void
}

function stateOf(job: Job): 'done' | 'warning' | 'ongoing' | 'error' {
  if (job.phase !== 'settled') return 'ongoing'
  return job.outcomeStatus === 'completed' ? 'done' : 'error'
}

export function TaskDetailsPanel({ openTab, openDetailsTab }: TaskDetailsPanelProps): JSX.Element {
  const selectFiles = () => {
    openDetailsTab?.('mat-files')
    openTab?.('mat-files')
  }
  // Native navigation target: openDetailsTab('mat-files')
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const response = await fetch('/mat-status/jobs', { cache: 'no-store' })
        if (!response.ok) throw new Error(`status HTTP ${response.status}`)
        const payload = await response.json() as { jobs?: Job[] }
        if (live) setJobs(Array.isArray(payload.jobs) ? payload.jobs : [])
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 5_000)
    return () => { live = false; window.clearInterval(timer) }
  }, [])

  const job = jobs[jobs.length - 1]
  if (error !== undefined) return <section className="mat-task-details" role="status">{error}</section>
  if (job === undefined) return <section className="mat-task-details" role="status">暂无计算任务</section>

  return (
    <section className="mat-task-details" aria-label="HPC task details">
      <header className="mat-task-details__header">
        <StateDot state={stateOf(job)} />
        <strong>{job.label ?? job.jobId}</strong>
      </header>
      <dl className="mat-task-details__metadata">
        {monitorMetadata(job).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {job.detail !== undefined && <p className="mat-task-details__failure">{job.detail}</p>}
      <p className="mat-task-details__files">结果文件：{job.files?.length ?? 0} 个</p>
      <button type="button" onClick={selectFiles}>打开文件</button>
      {/* openDetailsTab is the native Details controller seam; openTab remains for direct hosts. */}
    </section>
  )
}
