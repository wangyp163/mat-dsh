import { useEffect, useMemo, useState } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileManagerState } from './file-manager-state'
import { jobsForSession } from './status-model'
import type { MonitorJob } from './status-model'

type Job = MonitorJob & {
  kind?: string
  label?: string
  clusterId?: string
  ownerSession?: string
  outcomeStatus?: string
}

type StatusDockProps = PropsRuntime<'conversation.input.dock'> & {
  onOpenTask?: () => void
}

function statusState(job: Job): 'done' | 'warning' | 'ongoing' | 'error' {
  if (job.phase !== 'settled') return 'ongoing'
  return job.outcomeStatus === 'completed' ? 'done' : 'error'
}

export function StatusDock({
  sessionId,
  openDetailsTab,
  onOpenTask = () => { openDetailsTab?.('mat-task') },
}: StatusDockProps): JSX.Element | null {
  const [jobs, setJobs] = useState<Job[]>([])
  // jobId 与会话相互隔离：只认 ownerSession === 当前会话的作业。
  const visible = useMemo(() => jobsForSession(jobs, sessionId), [jobs, sessionId])
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

  const [selectedId, setSelectedId] = useState(fileManagerState.snapshot().selectedJobId)
  useEffect(() => fileManagerState.subscribe(() => { setSelectedId(fileManagerState.snapshot().selectedJobId) }), [])
  // 缺省选板序末位（本会话最新作业）；本会话没有作业时整条状态条隐藏。
  const selected = visible.find(job => job.jobId === selectedId) ?? visible.at(-1)
  if (selected === undefined) return null
  return (
    <div className="mat-status-strip" role="status">
      <StateDot state={statusState(selected)} />
      <span className="mat-status-strip__label">
        {selected.phase === 'settled' ? 'Computation finished' : 'Computation running'}
      </span>
      <select
        aria-label="Current conversation task"
        value={selected.jobId}
        onChange={(event) => { fileManagerState.selectJob(event.target.value) }}
      >
        {visible.map(job => <option key={job.jobId} value={job.jobId}>{job.label ?? job.jobId}</option>)}
      </select>
      <span className="mat-status-strip__count">{visible.length} tasks</span>
      <Button size="sm" variant="outline" aria-label={`打开任务面板 ${selected.jobId}`} onClick={onOpenTask}>任务</Button>
      <Button size="sm" variant="outline" aria-label="打开文件面板" onClick={() => { openDetailsTab?.('mat-files') }}>文件</Button>
    </div>
  )
}
