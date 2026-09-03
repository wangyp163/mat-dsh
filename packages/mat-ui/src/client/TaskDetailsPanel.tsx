import { useEffect, useMemo, useState } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { jobsForSession, monitorMetadata } from './status-model'
import type { MonitorJob } from './status-model'

import { fileManagerState } from './file-manager-state'

type Job = MonitorJob & {
  label?: string
  clusterId?: string
  ownerSession?: string
  detail?: string
  files?: string[]
  localWorkspace?: string
}

interface TaskDetailsPanelProps extends PropsRuntime<'conversation.details.tab'> {
  active?: boolean
  open?: () => void
  openTab?: (id: string) => void
  openDetailsTab?: (id: string) => void
}

function stateOf(job: Job): 'done' | 'warning' | 'ongoing' | 'error' {
  if (job.phase !== 'settled') return 'ongoing'
  return job.outcomeStatus === 'completed' ? 'done' : 'error'
}

export function TaskDetailsPanel({ sessionId, openTab, openDetailsTab }: TaskDetailsPanelProps): JSX.Element {
  const [selectedJobId, setSelectedJobId] = useState<string>()
  const selectFiles = () => {
    if (selectedJobId !== undefined) fileManagerState.selectJob(selectedJobId)
    openDetailsTab?.('mat-files')
    openTab?.('mat-files')
  }
  // Native navigation target: openDetailsTab('mat-files')
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string>()
  // jobId 与会话相互隔离：只认 ownerSession === 当前会话的作业。
  const visible = useMemo(() => jobsForSession(jobs, sessionId), [jobs, sessionId])

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

  // 缺省/失配时选板序末位（本工作区最新作业）。
  useEffect(() => {
    if (visible.length > 0 && (selectedJobId === undefined || !visible.some(job => job.jobId === selectedJobId))) {
      setSelectedJobId(visible.at(-1)!.jobId)
    }
  }, [visible, selectedJobId])

  const job = visible.find(value => value.jobId === selectedJobId) ?? visible.at(-1)
  if (error !== undefined) return <section className="mat-task-details" role="status">{error}</section>
  if (job === undefined) return <section className="mat-task-details" role="status">暂无计算任务</section>

  return (
    <section className="mat-task-details" aria-label="HPC task details">
      <header className="mat-task-details__header">
        <StateDot state={stateOf(job)} />
        <label><span>任务</span><select value={job.jobId} onChange={(event) => { setSelectedJobId(event.target.value); fileManagerState.selectJob(event.target.value) }}>
          {visible.map(value => <option key={value.jobId} value={value.jobId}>{value.label ?? value.jobId}</option>)}
        </select></label>
      </header>
      <dl className="mat-task-details__metadata">
        {monitorMetadata(job).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {job.detail !== undefined && <p className="mat-task-details__failure" title={job.detail}>{job.detail}</p>}
      <footer className="mat-task-details__footer">
        <p className="mat-task-details__files">结果文件 <b>{job.files?.length ?? 0}</b> 个</p>
        <div className="mat-task-details__actions"><Button size="sm" variant="primary" onClick={selectFiles}>打开文件</Button></div>
      </footer>
      {/* openDetailsTab is the native Details controller seam; openTab remains for direct hosts. */}
    </section>
  )
}
