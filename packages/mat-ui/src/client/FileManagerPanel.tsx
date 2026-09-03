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
import { Fragment } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileManagerState } from './file-manager-state'
import { jobsForSession } from './status-model'
import { mergeTreeEntries, visibleTreeEntries } from './file-tree-model'
import { viewerState } from './viewer-state'
import { classifyFile } from './view-model'
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
  warning?: string
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
    warning: payload.warning,
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

/** 上次成功加载的树（SWR）：切任务/展开先即时渲染缓存，再后台刷新。 */
const treeCache = new Map<string, WorkspaceTree>()
const cacheKey = (jobId: string, path = ''): string => `${jobId}\0${path}`

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

type FileManagerPanelProps = PropsRuntime<'conversation.details.tab'> & {
  openWorkspace?: (path: string) => Promise<void>
}

export function FileManagerPanel({ sessionId, openTab, openWorkspace }: FileManagerPanelProps): JSX.Element {
  const [snapshot, setSnapshot] = useState(fileManagerState.snapshot())
  const [jobs, setJobs] = useState<FileManagerJob[]>([])
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [primary, setPrimary] = useState<string[]>([])
  const [warning, setWarning] = useState<string>()
  const [error, setError] = useState<string>()

  // jobId 与会话相互隔离：只认 ownerSession === 当前会话的作业。
  const visible = useMemo(() => jobsForSession(jobs, sessionId), [jobs, sessionId])

  useEffect(() => fileManagerState.subscribe(() => { setSnapshot(fileManagerState.snapshot()) }), [])
  useEffect(() => {
    let live = true
    void getJobs().then((value) => {
      if (live) setJobs(value)
    }).catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false }
  }, [sessionId])

  // 对齐选中：选中项不在本会话范围时回到板序末位（本会话最新作业）。
  useEffect(() => {
    const current = fileManagerState.snapshot().selectedJobId
    const id = current !== undefined && visible.some(job => job.jobId === current)
      ? current
      : visible.at(-1)?.jobId
    if (id !== undefined && id !== current) fileManagerState.select(id)
  }, [visible])

  const job = visible.find(value => value.jobId === snapshot.selectedJobId) ?? visible.at(-1)
  // 点击文件 = 应用内预览（「查看」tab）。不再走宿主 openWorkspace —— WSL 下它派生 powershell 必炸。
  const openFile = (path: string): void => {
    if (job === undefined) return
    const kind = classifyFile(path)
    fileManagerState.selectPath(path)
    if (kind === 'unsupported') {
      setError('该类型暂不支持预览：请勾选后下载')
      return
    }
    viewerState.open(job.jobId, path, kind)
    openTab?.('mat-view')
  }
  const loadDirectory = async (path: string) => {
    if (job === undefined) return
    const cached = treeCache.get(cacheKey(job.jobId, path))
    if (cached !== undefined) {
      setEntries(current => mergeTreeEntries(current, path, cached.entries) as WorkspaceEntry[])
    }
    fileManagerState.beginExpand(path)
    try {
      const tree = await getTree(job.jobId, path)
      treeCache.set(cacheKey(job.jobId, path), tree)
      setEntries(current => mergeTreeEntries(current, path, tree.entries) as WorkspaceEntry[])
      setWarning(tree.warning)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      fileManagerState.finishExpand(path)
    }
  }
  const refresh = async () => {
    if (job === undefined) return
    const cached = treeCache.get(cacheKey(job.jobId))
    if (cached !== undefined) {
      setEntries(cached.entries)
      setPrimary(cached.primary)
      setWarning(cached.warning)
    }
    fileManagerState.beginRefresh()
    setError(undefined)
    setWarning(undefined)
    try {
      const tree = await getTree(job.jobId)
      treeCache.set(cacheKey(job.jobId), tree)
      setEntries(tree.entries)
      setPrimary(tree.primary)
      setWarning(tree.warning)
      fileManagerState.setPins(tree.preferences?.pins ?? [])
      fileManagerState.finishRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      fileManagerState.finishRefresh(cause)
    }
  }
  useEffect(() => { if (job !== undefined) void refresh() }, [job?.jobId])

  // 在途秒表：区分「加载中」与「卡了」——超过 10 秒提示远端响应缓慢。
  const busy = snapshot.refresh === 'pending' || snapshot.download === 'pending'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const timer = setInterval(() => { setElapsed(value => value + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [busy])
  const slowHint = elapsed >= 10 ? '，远端响应缓慢，可能网络不通' : ''

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
        {visible.map(value => <option key={value.jobId} value={value.jobId}>{value.jobId} · {value.clusterId}</option>)}      </select></label>
      <Tooltip label="刷新本地与远端目录" side="bottom"><Button size="sm" variant="outline" aria-label="刷新文件" disabled={snapshot.refresh === 'pending' || job === undefined} icon={<IconRefreshOutline16 />} onClick={() => { void refresh() }} /></Tooltip>
      <Tooltip label={disabledReason ?? '下载选中项'} side="bottom"><span><Button size="sm" variant="primary" aria-label="下载选中项" disabled={disabledReason !== undefined || snapshot.download === 'pending'} icon={<IconDownloadOutline16 />} onClick={() => { void download() }}>{snapshot.download === 'pending' ? `下载中…${elapsed}s` : '下载'}</Button></span></Tooltip>
    </header>
    <div className="mat-files__location">
      <span>本地工作区</span>
      <button type="button" disabled={job?.localWorkspace === undefined || openWorkspace === undefined} onClick={() => { if (job?.localWorkspace !== undefined) void openWorkspace?.(job.localWorkspace) }}>
        <code>{job === undefined ? '暂无任务' : (job.localWorkspace ?? '本地工作区未约定')}</code>
      </button>
    </div>
    {primary.length > 0 && <section className="mat-files__primary" aria-labelledby="mat-primary-title">
      <div id="mat-primary-title">主要文件</div>
      <div className="mat-files__chips">{primary.map(path => {
        const opening = snapshot.opening.includes(path)
        return <button key={path} type="button" onClick={() => { openFile(path) }} aria-pressed={selectedPaths.includes(path)} aria-busy={opening} disabled={opening} className={opening ? 'mat-files__chip--busy' : undefined}>{path.split('/').at(-1)}{opening ? '…' : ''}</button>
      })}</div>
    </section>}
    {warning !== undefined && <p role="status" className="mat-files__warning">远端目录暂不可用，仅显示本地工作区：{warning}</p>}
    {busy && <p role="status" aria-live="polite" className="mat-files__loading">{snapshot.download === 'pending' ? `下载中… ${elapsed}s` : `正在同步远端目录… ${elapsed}s`}{slowHint}</p>}
    {error !== undefined && <p role="alert" className="mat-files__error">{error}</p>}
    <div className="mat-files__tree" role="tree" aria-label="本地与远端统一文件树" aria-multiselectable="true" onKeyDown={onTreeKeyDown}>
      {entries.length === 0
        ? <p className="mat-files__empty">当前工作区没有可显示的文件。</p>
        : visibleEntries.map(entry => {
          const selected = selectedPaths.includes(entry.path)
          const pinned = snapshot.pins.includes(entry.path)
          const listing = entry.directory && snapshot.expanded.includes(entry.path) && snapshot.expanding.includes(entry.path)
          return <Fragment key={entry.path}>
            <div role="treeitem" tabIndex={0} data-path={entry.path} aria-selected={selected} aria-expanded={entry.directory ? snapshot.expanded.includes(entry.path) : undefined} className="mat-files__row" style={{ paddingInlineStart: `${5 + entry.depth * 16}px` }}>
              <input type="checkbox" aria-label={`选择 ${entry.name}`} checked={selected} onChange={() => { fileManagerState.selectPath(entry.path) }} />
              <span className="mat-files__kind">{entry.directory ? (snapshot.expanded.includes(entry.path) ? <IconFolderOpenOutline16 /> : <IconFolderClose16 />) : <StateDot state={statusState(entry)} />}</span>
              <button type="button" className="mat-files__name" onClick={() => { entry.directory ? (fileManagerState.toggleExpanded(entry.path), void loadDirectory(entry.path)) : openFile(entry.path) }}>{entry.name}</button>
              <span className={`mat-files__origin mat-files__origin--${entry.origin}`}>{sourceLabel(entry)}</span>
              <Tooltip label={pinned ? '从主要文件移除' : '固定为主要文件'} side="bottom"><button type="button" className="mat-files__pin" aria-label={`${pinned ? '取消固定' : '固定'} ${entry.name}`} aria-pressed={pinned} onClick={() => { togglePin(entry.path) }}>★</button></Tooltip>
            </div>
            {listing && <div role="status" className="mat-files__row mat-files__row--loading" style={{ paddingInlineStart: `${5 + (entry.depth + 1) * 16}px` }}>正在加载远端子目录…</div>}
          </Fragment>
        })}
    </div>
    <p className="mat-files__status" role="status" aria-live="polite">{selectedPaths.length === 0 ? '未选择文件' : `已选择 ${selectedPaths.length} 项${selectedEntries.some(entry => entry.directory) || selectedPaths.length > 1 ? '，将下载 ZIP' : ''}`}</p>
  </section>
}
