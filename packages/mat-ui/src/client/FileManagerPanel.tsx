import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconDownloadOutline16,
  IconFolderClose16,
  IconFolderOpenOutline16,
  IconRefreshOutline16,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { JSX, KeyboardEvent } from 'react'
import { fileManagerState } from './file-manager-state'
import { mergeTreeEntries, visibleTreeEntries } from './file-tree-model'
import type { FileManagerJob } from './file-manager-state'

interface WorkspaceEntry {
  path: string
  name: string
  size: number
  directory: boolean
  regularFile: boolean
  symbolicLink: boolean
  readable: boolean
  origin: 'local' | 'remote' | 'both'
  status: 'local-only' | 'remote-only' | 'synchronized' | 'downloading' | 'failed' | 'unreadable' | 'conflict'
}

interface WorkspaceTree {
  entries: WorkspaceEntry[]
  primary: string[]
  preferences?: { autoSync?: boolean; pins?: string[]; exclusions?: string[] }
}

async function getJobs(): Promise<FileManagerJob[]> {
  const response = await fetch('/mat-files/jobs', { cache: 'no-store' })
  if (!response.ok) throw new Error(`jobs HTTP ${response.status}`)
  const payload = await response.json() as { jobs?: FileManagerJob[] }
  return Array.isArray(payload.jobs) ? payload.jobs : []
}

async function getTree(jobId: string, path = ''): Promise<WorkspaceTree> {
  const response = await fetch(`/mat-files/tree?jobId=${encodeURIComponent(jobId)}&path=${encodeURIComponent(path)}`, { cache: 'no-store' })
  const payload = await response.json() as WorkspaceTree & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `tree HTTP ${response.status}`)
  return {
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    primary: Array.isArray(payload.primary) ? payload.primary : [],
    preferences: payload.preferences,
  }
}

async function downloadSelection(jobId: string, paths: string[]): Promise<void> {
  const response = await fetch('/mat-files/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, paths }),
  })
  if (!response.ok) {
    const payload = await response.json() as { error?: { message?: string } }
    throw new Error(payload.error?.message ?? `download HTTP ${response.status}`)
  }
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const filename = encoded === undefined ? 'mat-download' : decodeURIComponent(encoded)
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function sourceLabel(entry: WorkspaceEntry): string {
  if (entry.origin === 'both') return '本地 + 远端'
  return entry.origin === 'local' ? '本地' : '远端'
}

function statusState(entry: WorkspaceEntry): 'done' | 'warning' | 'ongoing' | 'error' {
  if (entry.status === 'downloading') return 'ongoing'
  if (entry.status === 'failed' || entry.status === 'unreadable' || entry.status === 'conflict') return 'error'
  if (entry.status === 'remote-only') return 'warning'
  return 'done'
}

export function FileManagerPanel(): JSX.Element {
  const [snapshot, setSnapshot] = useState(fileManagerState.snapshot())
  const [jobs, setJobs] = useState<FileManagerJob[]>([])
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [primary, setPrimary] = useState<string[]>([])
  const [error, setError] = useState<string>()

  useEffect(() => fileManagerState.subscribe(() => { setSnapshot(fileManagerState.snapshot()) }), [])
  useEffect(() => {
    let live = true
    void getJobs().then((value) => {
      if (!live) return
      setJobs(value)
      const id = snapshot.selectedJobId ?? value[0]?.jobId
      if (id !== undefined && id !== snapshot.selectedJobId) fileManagerState.select(id)
    }).catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false }
  }, [])

  const job = jobs.find(value => value.jobId === snapshot.selectedJobId) ?? jobs[0]
  const loadDirectory = async (path: string) => {
    if (job === undefined) return
    try {
      const tree = await getTree(job.jobId, path)
      setEntries(current => mergeTreeEntries(current, path, tree.entries) as WorkspaceEntry[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const refresh = async () => {
    if (job === undefined) return
    fileManagerState.beginRefresh()
    setError(undefined)
    try {
      const tree = await getTree(job.jobId)
      setEntries(tree.entries)
      setPrimary(tree.primary)
      fileManagerState.setPins(tree.preferences?.pins ?? [])
      fileManagerState.finishRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      fileManagerState.finishRefresh(cause)
    }
  }
  useEffect(() => { if (job !== undefined) void refresh() }, [job?.jobId])

  const selectedPaths = snapshot.selectedPaths
  const visibleEntries = visibleTreeEntries(entries, snapshot.expanded)
  const selectedEntries = useMemo(
    () => entries.filter(entry => selectedPaths.includes(entry.path)),
    [entries, selectedPaths],
  )
  const disabledReason = selectedEntries.some(entry => entry.symbolicLink || !entry.readable)
    ? '符号链接或不可读条目不能下载'
    : selectedPaths.length === 0 ? '请先选择文件或目录' : undefined

  const persistPins = async (pins: string[]) => {
    if (job === undefined) return
    const response = await fetch('/mat-files/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.jobId, pins, exclusions: [] }),
    })
    if (!response.ok) throw new Error(`preferences HTTP ${response.status}`)
  }
  const togglePin = (path: string) => {
    const pinned = snapshot.pins.includes(path)
    if (pinned) fileManagerState.unpin(path)
    else fileManagerState.pin(path)
    const pins = pinned ? snapshot.pins.filter(value => value !== path) : [...snapshot.pins, path]
    void persistPins(pins).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }
  const download = async () => {
    if (job === undefined || disabledReason !== undefined) return
    fileManagerState.beginDownload(selectedPaths)
    setError(undefined)
    try {
      await downloadSelection(job.jobId, selectedPaths)
      fileManagerState.finishDownload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      fileManagerState.finishDownload(cause)
    }
  }
  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    const path = (event.target as HTMLElement).dataset.path
    if (path === undefined) return
    event.preventDefault()
    fileManagerState.selectPath(path)
  }

  return <section className="mat-files" aria-label="HPC 工作区文件">
    <header className="mat-files__toolbar">
      <label className="mat-files__job"><span>任务</span><select value={job?.jobId ?? ''} onChange={event => { fileManagerState.select(event.target.value) }}>
        {jobs.map(value => <option key={value.jobId} value={value.jobId}>{value.jobId} · {value.clusterId}</option>)}
      </select></label>
      <Tooltip label="刷新本地与远端目录" side="bottom"><Button size="sm" variant="toolbar" aria-label="刷新文件" disabled={snapshot.refresh === 'pending' || job === undefined} icon={<IconRefreshOutline16 />} onClick={() => { void refresh() }} /></Tooltip>
      <Tooltip label={disabledReason ?? '下载选中项'} side="bottom"><span><Button size="sm" variant="primary" aria-label="下载选中项" disabled={disabledReason !== undefined || snapshot.download === 'pending'} icon={<IconDownloadOutline16 />} onClick={() => { void download() }}>下载</Button></span></Tooltip>
    </header>
    <div className="mat-files__location"><span>本地工作区</span><code>{job?.jobId ?? '暂无任务'}</code></div>
    {primary.length > 0 && <section className="mat-files__primary" aria-labelledby="mat-primary-title">
      <div id="mat-primary-title">主要文件</div>
      <div className="mat-files__chips">{primary.map(path => <button key={path} type="button" onClick={() => { if (!selectedPaths.includes(path)) fileManagerState.selectPath(path) }} aria-pressed={selectedPaths.includes(path)}>{path.split('/').at(-1)}</button>)}</div>
    </section>}
    {error !== undefined && <p role="alert" className="mat-files__error">{error}</p>}
    <div className="mat-files__tree" role="tree" aria-label="本地与远端统一文件树" aria-multiselectable="true" onKeyDown={onTreeKeyDown}>
      {entries.length === 0
        ? <p className="mat-files__empty">当前工作区没有可显示的文件。</p>
        : visibleEntries.map(entry => {
          const selected = selectedPaths.includes(entry.path)
          const pinned = snapshot.pins.includes(entry.path)
          return <div key={entry.path} role="treeitem" tabIndex={0} data-path={entry.path} aria-selected={selected} aria-expanded={entry.directory ? snapshot.expanded.includes(entry.path) : undefined} className="mat-files__row" style={{ paddingInlineStart: `${5 + entry.depth * 16}px` }}>
            <input type="checkbox" aria-label={`选择 ${entry.name}`} checked={selected} onChange={() => { fileManagerState.selectPath(entry.path) }} />
            <span className="mat-files__kind">{entry.directory ? (snapshot.expanded.includes(entry.path) ? <IconFolderOpenOutline16 /> : <IconFolderClose16 />) : <StateDot state={statusState(entry)} />}</span>
            <button type="button" className="mat-files__name" onClick={() => { entry.directory ? (fileManagerState.toggleExpanded(entry.path), void loadDirectory(entry.path)) : fileManagerState.selectPath(entry.path) }}>{entry.name}</button>
            <span className={`mat-files__origin mat-files__origin--${entry.origin}`}>{sourceLabel(entry)}</span>
            <Tooltip label={pinned ? '从主要文件移除' : '固定为主要文件'} side="bottom"><button type="button" className="mat-files__pin" aria-label={`${pinned ? '取消固定' : '固定'} ${entry.name}`} aria-pressed={pinned} onClick={() => { togglePin(entry.path) }}>★</button></Tooltip>
          </div>
        })}
    </div>
    <p className="mat-files__status" role="status" aria-live="polite">{selectedPaths.length === 0 ? '未选择文件' : `已选择 ${selectedPaths.length} 项${selectedEntries.some(entry => entry.directory) || selectedPaths.length > 1 ? '，将下载 ZIP' : ''}`}</p>
  </section>
}
