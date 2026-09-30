import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconDownloadOutline16,
  IconFolderClose16,
  IconFolderOpenOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
  StateDot,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileManagerState } from './file-manager-state'
import { jobOptionLabel, jobsForSession } from './status-model'
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
  /** 工作区 scope：本地工作目录绝对路径（多会话共享，位置行展示 + openWorkspace）。 */
  root?: string
  /** 会话文件归档（仅根列表）：会话 → 相对路径清单（服务端台账 + 存在性过滤）。 */
  sessionFiles?: Record<string, string[]>
}

async function getJobs(): Promise<FileManagerJob[]> {
  const response = await fetch('/mat-files/jobs', { cache: 'no-store' })
  if (!response.ok) throw new Error(`jobs HTTP ${response.status}`)
  const payload = await response.json() as { jobs?: FileManagerJob[] }
  return Array.isArray(payload.jobs) ? payload.jobs : []
}

async function getTree(scope: string, path = ''): Promise<WorkspaceTree> {
  // session:<id> 是工作区 scope 的线上键（服务端经 projcache 解析 cwd；cwd 由多会话共享）；其余按作业板键。
  const query = scope.startsWith('session:')
    ? `session=${encodeURIComponent(scope.slice('session:'.length))}`
    : `jobId=${encodeURIComponent(scope)}`
  // 15s 超时：服务重启撞断的连接会让 fetch 永久 pending（无 reject），面板停在
  // 「正在定位会话工作目录…」且无报错——超时把它变成可见错误，轮询/手动刷新兜底。
  const response = await fetch(`/mat-files/tree?${query}&path=${encodeURIComponent(path)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  const payload = await response.json() as WorkspaceTree & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `tree HTTP ${response.status}`)
  return {
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    primary: Array.isArray(payload.primary) ? payload.primary : [],
    preferences: payload.preferences,
    warning: payload.warning,
    ...(payload.root === undefined ? {} : { root: payload.root }),
    ...(payload.sessionFiles === undefined ? {} : { sessionFiles: payload.sessionFiles }),
  }
}

/** 删除本地已同步副本（远端不动）；未同步条目由服务端报告为 missing。 */
async function deleteSelection(scope: string, paths: string[]): Promise<{ deleted: string[]; missing: string[] }> {
  const body = scope.startsWith('session:')
    ? { session: scope.slice('session:'.length), paths }
    : { jobId: scope, paths }
  const response = await fetch('/mat-files/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as { deleted?: string[]; missing?: string[]; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message ?? `delete HTTP ${response.status}`)
  return { deleted: payload.deleted ?? [], missing: payload.missing ?? [] }
}

/** 同步到本地工作树：把远端文件拉进该作业的本地镜像目录（DSH_HOME/mat-files/<cluster>/<jobid>/）。 */
async function syncSelection(jobId: string, paths: string[]): Promise<void> {
  const response = await fetch('/mat-files/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, paths }),
  })
  if (!response.ok) {
    const payload = await response.json() as { error?: { message?: string } }
    throw new Error(payload.error?.message ?? `sync HTTP ${response.status}`)
  }
}

async function downloadSelection(scope: string, paths: string[]): Promise<void> {
  const body = scope.startsWith('session:')
    ? { session: scope.slice('session:'.length), paths }
    : { jobId: scope, paths }
  const response = await fetch('/mat-files/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

/** 上次成功加载的树（SWR）：展开/刷新先即时渲染缓存，再后台刷新。 */
const treeCache = new Map<string, WorkspaceTree>()
const cacheKey = (scope: string, path = ''): string => `${scope}\0${path}`

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

const isSessionScope = (scope: string): boolean => scope.startsWith('session:')

/**
 * 作业 chip 色调：running 蓝 / failed 红 / completed 绿 / 其余中性。
 * 取值优先 sacct 实时 state，再退到板上终态（settled 但无 slurm 快照时）。
 */
function jobTagTone(job: FileManagerJob): 'running' | 'failed' | 'done' | 'idle' {
  const state = (job.slurm?.[0]?.state ?? '').toUpperCase()
  if (state === 'RUNNING' || state === 'PENDING' || state === 'COMPLETING') return 'running'
  if (state === 'FAILED' || state === 'CANCELLED' || state === 'TIMEOUT' || state === 'OUT_OF_MEMORY' || state === 'NODE_FAIL') return 'failed'
  if (state === 'COMPLETED') return 'done'
  if (job.phase !== 'settled') return 'running'
  if (job.outcomeStatus === 'completed') return 'done'
  if (job.outcomeStatus === 'failed' || job.outcomeStatus === 'killed') return 'failed'
  return 'idle'
}

/** 行名只出名字本身：类型由行首 chip 表达（避免"作业 作业号"式重复）。 */
const scopeLabel = (scope: string, jobs: FileManagerJob[], root: string | undefined): string =>
  isSessionScope(scope)
    ? (root !== undefined && root !== '' ? root.split('/').filter(Boolean).at(-1) ?? root : '工作区')
    : jobOptionLabel(jobs.find(job => job.jobId === scope) ?? { jobId: scope } as FileManagerJob)

type FileManagerPanelProps = PropsRuntime<'conversation.details.tab'> & {
  openWorkspace?: (path: string) => Promise<void>
}

export function FileManagerPanel({ sessionId, openTab, openWorkspace }: FileManagerPanelProps): JSX.Element {
  const [snapshot, setSnapshot] = useState(fileManagerState.snapshot())
  const [jobs, setJobs] = useState<FileManagerJob[]>([])
  const [trees, setTrees] = useState<Record<string, WorkspaceEntry[]>>({})
  const [roots, setRoots] = useState<Record<string, string | undefined>>({})
  const [primaries, setPrimaries] = useState<Record<string, string[]>>({})
  /** 会话文件归档（按会话分档）：scope → 会话 → 相对路径清单（仅根列表携带）。 */
  const [sessionFilesByScope, setSessionFilesByScope] = useState<Record<string, Record<string, string[]>>>({})
  const [warning, setWarning] = useState<string>()
  const [error, setError] = useState<string>()

  // jobId 与会话相互隔离：只认 ownerSession === 当前会话的作业。
  const visible = useMemo(() => jobsForSession(jobs, sessionId), [jobs, sessionId])
  const sessionKey = sessionId !== undefined && sessionId !== '' ? `session:${sessionId}` : undefined

  // 统一虚拟树的 scope 序：工作区固定首位（多会话共享同一份文件），其后按板序接作业（末位=最新）。
  const scopeOrder = useMemo(() => [
    ...(sessionKey !== undefined ? [sessionKey] : []),
    ...visible.map(job => job.jobId),
  ], [sessionKey, visible])
  const openScopes = snapshot.openScopes.filter(scope => scopeOrder.includes(scope))

  useEffect(() => fileManagerState.subscribe(() => { setSnapshot(fileManagerState.snapshot()) }), [])
  // 作业清单 5s 轮询（对齐 TaskDetailsPanel）：一次性拉取会把空会话态钉死在
  // 提交前挂载的面板上——新作业只能靠轮询进入 sessionGroups/seenRef 自动展开链。
  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      try {
        const value = await getJobs()
        if (live) setJobs(value)
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 5_000)
    return () => { live = false; window.clearInterval(timer) }
  }, [sessionId])

  // 三层树的会话层：工作区展开时按 cwd 反查同工作区会话（标题/时间来自宿主 projcache）。
  const [wsSessions, setWsSessions] = useState<Array<{ sessionId: string; title?: string; createdAt?: number }>>([])
  const [openSessions, setOpenSessions] = useState<string[]>([])
  const toggleSessionRow = (sid: string): void => {
    setOpenSessions(current => current.includes(sid) ? current.filter(value => value !== sid) : [...current, sid])
  }
  const workspaceOpen = sessionKey !== undefined && openScopes.includes(sessionKey)
  useEffect(() => {
    if (!workspaceOpen || sessionId === undefined) return
    let live = true
    void (async () => {
      try {
        const response = await fetch(`/mat-files/workspace-sessions?session=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as { sessions?: Array<{ sessionId: string; title?: string; createdAt?: number }> }
        if (live) setWsSessions(Array.isArray(payload.sessions) ? payload.sessions : [])
      } catch { /* 会话层是增益信息，取不到就退化为只列作业 */ }
    })()
    return () => { live = false }
  }, [workspaceOpen, sessionId])

  // 会话分组：ownerSession 归属分桶；本会话置顶；其余须有作业才列（防 28 个空会话噪声）；未归属兜底。
  const sessionGroups = useMemo(() => {
    if (sessionKey === undefined) return []
    const byOwner = new Map<string, FileManagerJob[]>()
    for (const job of jobs) {
      const owner = job.ownerSession ?? ''
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), job])
    }
    const listed = wsSessions.filter(record => record.sessionId === sessionId || (byOwner.get(record.sessionId)?.length ?? 0) > 0)
    const groups = [
      ...listed.filter(record => record.sessionId === sessionId).map(record => ({ session: record, jobs: byOwner.get(record.sessionId) ?? [] })),
      ...listed.filter(record => record.sessionId !== sessionId).map(record => ({ session: record, jobs: byOwner.get(record.sessionId) ?? [] })),
    ]
    const unowned = byOwner.get('') ?? []
    if (unowned.length > 0) groups.push({ session: { sessionId: '', title: '未归属会话' }, jobs: unowned })
    return groups
  }, [wsSessions, jobs, sessionId, sessionKey])

  // 挂载即展开工作区与本会话行；聚焦末位 scope（最新作业，无作业则工作区）。
  useEffect(() => {
    if (sessionKey === undefined) return
    fileManagerState.openScope(sessionKey)
    if (sessionId !== undefined) setOpenSessions(current => current.includes(sessionId) ? current : [...current, sessionId])
  }, [sessionKey, sessionId])
  useEffect(() => {
    const last = scopeOrder.at(-1)
    if (scopeOrder.length > 0 && (snapshot.selectedJobId === undefined || !scopeOrder.includes(snapshot.selectedJobId))) {
      fileManagerState.focus(last!)
    }
  }, [scopeOrder, snapshot.selectedJobId])

  // 入口定位（状态卡「文件」/任务页「打开文件」→ selectJob 展开目标 scope）：
  // 焦点 scope 展开后把它的行滚到视口中央，避免在长树里"展开了但看不见"。
  const treeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const scope = snapshot.selectedJobId
    if (scope === undefined || !openScopes.includes(scope)) return
    const row = treeRef.current?.querySelector(`[data-scope="${scope}"]`)
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [snapshot.selectedJobId, openScopes.join('\0')])

  // 新作业首次出现：自动展开 + 聚焦（提交→看结果的主流程）；此后记住手动选择直到下一个新作业。
  const seenRef = useRef<string[] | undefined>(undefined)
  useEffect(() => {
    const ids = visible.map(job => job.jobId)
    if (seenRef.current === undefined) { seenRef.current = ids; return }
    const fresh = ids.filter(id => !seenRef.current!.includes(id))
    seenRef.current = ids
    for (const id of fresh) {
      // 只聚焦不展开（用户点 scope 行才展开）——作业目录默认折叠。
      fileManagerState.focus(id)
      if (sessionId !== undefined) setOpenSessions(current => current.includes(sessionId) ? current : [...current, sessionId])
    }
  }, [visible])

  const loadScope = async (scope: string): Promise<void> => {
    try {
      const tree = await getTree(scope)
      treeCache.set(cacheKey(scope), tree)
      setTrees(current => ({ ...current, [scope]: tree.entries }))
      setRoots(current => ({ ...current, [scope]: tree.root }))
      if (tree.sessionFiles !== undefined) setSessionFilesByScope(current => ({ ...current, [scope]: tree.sessionFiles! }))
      if (!isSessionScope(scope)) {
        setPrimaries(current => ({ ...current, [scope]: tree.primary }))
        fileManagerState.setPins(tree.preferences?.pins ?? [], scope)
      }
      setWarning(tree.warning)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  // 打开的 scope 缺树即载（SWR 缓存优先）。
  useEffect(() => {
    for (const scope of openScopes) {
      if (trees[scope] === undefined) {
        const cached = treeCache.get(cacheKey(scope))
        if (cached !== undefined) setTrees(current => ({ ...current, [scope]: cached.entries }))
        else void loadScope(scope)
      }
    }
  }, [openScopes.join('\0')])

  // 工作区树自动保鲜（5s 轮询，与作业清单同频）：会话 cwd 是纯本地 readdir，
  // agent 中途写入/下载的文件（如 POSCAR）无需手动刷新即出现在右侧树。只轮询
  // 工作区 scope——作业树含远端 listing，开销大，维持手动刷新语义。清单签名
  // 未变化时跳过 setTrees，静止时零重渲染。
  const pollSignatures = useRef(new Map<string, string>())
  useEffect(() => {
    if (sessionKey === undefined) return
    const timer = window.setInterval(() => {
      void (async () => {
        const live = fileManagerState.snapshot()
        if (!live.openScopes.includes(sessionKey)) return
        // 根 + 当前展开的目录，浅到深合并（浅层 merge 会清掉其下深层条目，随后补回）。
        const paths = ['', ...new Set(live.scopes[sessionKey]?.expanded ?? [])]
          .sort((a, b) => a.split('/').length - b.split('/').length)
        for (const path of paths) {
          try {
            const tree = await getTree(sessionKey, path)
            setError(undefined) // 自愈即清错：超时/失败提示不残留
            if (path === '' && tree.sessionFiles !== undefined) {
              setSessionFilesByScope(current => ({ ...current, [sessionKey]: tree.sessionFiles! }))
            }
            const key = cacheKey(sessionKey, path)
            const signature = tree.entries.map(entry => `${entry.path}:${entry.directory ? 'd' : 'f'}:${entry.size}`).join('\n')
            if (pollSignatures.current.get(key) === signature) continue
            pollSignatures.current.set(key, signature)
            treeCache.set(key, tree)
            setTrees(current => ({ ...current, [sessionKey]: mergeTreeEntries(current[sessionKey] ?? [], path, tree.entries) as WorkspaceEntry[] }))
          } catch { /* 轮询失败静默：手动刷新兜底 */ }
        }
      })()
    }, 5_000)
    return () => { window.clearInterval(timer) }
  }, [sessionKey])

  const loadDirectory = async (path: string, scope: string): Promise<void> => {
    const cached = treeCache.get(cacheKey(scope, path))
    if (cached !== undefined) {
      setTrees(current => ({ ...current, [scope]: mergeTreeEntries(current[scope] ?? [], path, cached.entries) as WorkspaceEntry[] }))
    }
    fileManagerState.beginExpand(path)
    try {
      const tree = await getTree(scope, path)
      treeCache.set(cacheKey(scope, path), tree)
      setTrees(current => ({ ...current, [scope]: mergeTreeEntries(current[scope] ?? [], path, tree.entries) as WorkspaceEntry[] }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      fileManagerState.finishExpand(path)
    }
  }

  const refresh = async (): Promise<void> => {
    fileManagerState.beginRefresh()
    setError(undefined)
    setWarning(undefined)
    try {
      await Promise.all(openScopes.map(scope => loadScope(scope)))
      fileManagerState.finishRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      fileManagerState.finishRefresh(cause)
    }
  }

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

  // 选中聚合：跨 scope 各自持有选中（下载逐 scope 请求；删除仅限单一作业 scope）。
  const selectionsByScope = openScopes.filter(scope => (snapshot.scopes[scope]?.selectedPaths?.length ?? 0) > 0)
  const selectedCount = selectionsByScope.reduce((total, scope) => total + snapshot.scopes[scope]!.selectedPaths.length, 0)
  const selectedEntries = useMemo(
    () => selectionsByScope.flatMap(scope => (trees[scope] ?? []).filter(entry => snapshot.scopes[scope]!.selectedPaths.includes(entry.path))),
    [selectionsByScope, trees, snapshot.scopes],
  )
  const disabledReason = selectedEntries.some(entry => entry.symbolicLink || !entry.readable)
    ? '符号链接或不可读条目不能下载'
    : selectedCount === 0 ? '请先选择文件或目录' : undefined
  const deleteDisabledReason = selectedCount === 0 ? '请先选择文件或目录' : undefined
  const focused = snapshot.selectedJobId
  const focusedJob = visible.find(job => job.jobId === focused)
  const focusedRoot = focused !== undefined ? roots[focused] : undefined

  const persistPins = async (pins: string[], job: FileManagerJob): Promise<void> => {
    const response = await fetch('/mat-files/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: job.jobId, pins, exclusions: [] }),
    })
    if (!response.ok) throw new Error(`preferences HTTP ${response.status}`)
  }
  const togglePin = (path: string, scope: string): void => {
    const job = visible.find(value => value.jobId === scope)
    if (job === undefined) return
    const pins = snapshot.scopes[scope]?.pins ?? []
    const pinned = pins.includes(path)
    if (pinned) fileManagerState.unpin(path, scope)
    else fileManagerState.pin(path, scope)
    const next = pinned ? pins.filter(value => value !== path) : [...pins, path]
    void persistPins(next, job).catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
  }

  // 同步只对作业 scope 有意义：工作区本身就是本地目录，没有远端可拉。
  const syncScopes = selectionsByScope.filter(scope => !isSessionScope(scope))
  const syncDisabledReason = selectedCount === 0
    ? '请先选择文件或目录'
    : syncScopes.length === 0 ? '工作区文件已在本地，无需同步' : undefined
  const syncToLocal = async (): Promise<void> => {
    if (syncDisabledReason !== undefined) return
    fileManagerState.beginRefresh()
    setError(undefined)
    try {
      for (const scope of syncScopes) {
        await syncSelection(scope, snapshot.scopes[scope]!.selectedPaths)
        // 同步后徽章要从「远端」翻到「本地 + 远端」：清缓存并重载该 scope。
        for (const key of [...treeCache.keys()]) if (key.startsWith(`${scope}\0`)) treeCache.delete(key)
        await loadScope(scope)
      }
      fileManagerState.finishRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      fileManagerState.finishRefresh(cause)
    }
  }

  const [locationCopied, setLocationCopied] = useState(false)
  const copyLocationPath = async (path: string): Promise<void> => {
    const ok = await writeClipboard(path)
    setLocationCopied(ok)
    if (ok) window.setTimeout(() => { setLocationCopied(false) }, 1500)
  }

  const download = async (): Promise<void> => {
    if (disabledReason !== undefined) return
    fileManagerState.beginDownload(selectionsByScope.map(scope => snapshot.scopes[scope]!.selectedPaths).flat())
    setError(undefined)
    try {
      for (const scope of selectionsByScope) {
        await downloadSelection(scope, snapshot.scopes[scope]!.selectedPaths)
      }
      fileManagerState.finishDownload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      fileManagerState.finishDownload(cause)
    }
  }

  // 本地删除：两段式（先出确认条，再执行），与宿主删除会话弹窗同级的安全闸。
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const confirmDelete = async (): Promise<void> => {
    if (selectionsByScope.length === 0) return
    fileManagerState.beginDelete()
    setError(undefined)
    try {
      // 自由删除：任意范围（含工作区）逐个执行；失败即停并保留现场。
      for (const scope of selectionsByScope) {
        const { deleted } = await deleteSelection(scope, snapshot.scopes[scope]!.selectedPaths)
        fileManagerState.removePaths(deleted, scope)
        // 树缓存按 scope 整体失效：被删目录的各级缓存都可能残留旧条目。
        for (const key of [...treeCache.keys()]) if (key.startsWith(`${scope}\0`)) treeCache.delete(key)
        await loadScope(scope)
      }
      setConfirmingDelete(false)
      fileManagerState.finishDelete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      fileManagerState.finishDelete(cause)
    }
  }

  const openFile = (path: string, scope: string): void => {
    const kind = classifyFile(path)
    fileManagerState.selectPath(path, scope)
    if (kind === 'unsupported') {
      setError('该类型暂不支持预览：请勾选后下载')
      return
    }
    // 点文件直达沉浸层（09-07 A 方案）：侧栏不再保留查看 tab。
    viewerState.open(scope, path, kind)
    viewerState.enterImmersive()
  }
  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    const path = (event.target as HTMLElement).dataset.path
    const scope = (event.target as HTMLElement).dataset.scope
    if (path === undefined || scope === undefined) return
    event.preventDefault()
    fileManagerState.selectPath(path, scope)
  }

  const primary = focused !== undefined && !isSessionScope(focused) ? primaries[focused] ?? [] : []

  const selectionNote = selectedCount === 0
    ? '未选择文件'
    : `已选择 ${selectedCount} 项${selectionsByScope.length > 1 ? `（跨 ${selectionsByScope.length} 个范围，下载将分范围进行）` : selectedEntries.some(entry => entry.directory) || snapshot.scopes[selectionsByScope[0]!]!.selectedPaths.length > 1 ? '，将下载 ZIP' : ''}`
  return <section className="mat-files" aria-label="HPC 工作区文件">
    <header className="mat-files__toolbar">
      <span className="mat-files__scopetitle">统一工作区树</span>
      <Tooltip label="刷新全部展开范围" side="bottom"><Button size="sm" variant="outline" aria-label="刷新文件" disabled={snapshot.refresh === 'pending' || openScopes.length === 0} icon={<IconRefreshOutline16 />} onClick={() => { void refresh() }} /></Tooltip>
      <Tooltip label={syncDisabledReason ?? '把远端文件同步进本地工作树（作业镜像目录）'} side="bottom"><span><Button size="sm" variant="primary" aria-label="同步到本地工作树" disabled={syncDisabledReason !== undefined || snapshot.refresh === 'pending'} icon={<IconDownloadOutline16 />} onClick={() => { void syncToLocal() }}>{snapshot.refresh === 'pending' ? `同步中…${elapsed}s` : '同步到本地'}</Button></span></Tooltip>
      <Tooltip label={disabledReason ?? '导出到这台电脑的下载目录'} side="bottom"><span><Button size="sm" variant="outline" aria-label="导出到本机" disabled={disabledReason !== undefined || snapshot.download === 'pending'} icon={<IconDownloadOutline16 />} onClick={() => { void download() }}>{snapshot.download === 'pending' ? `导出中…${elapsed}s` : '导出'}</Button></span></Tooltip>
      <Tooltip label={deleteDisabledReason ?? '删除选中项的本地副本'} side="bottom"><span><Button size="sm" variant="outline" aria-label="删除选中项的本地副本" disabled={deleteDisabledReason !== undefined || snapshot.deleting === 'pending'} icon={<IconTrashOutline16 />} onClick={() => { setConfirmingDelete(true) }}>删除</Button></span></Tooltip>
    </header>
    {confirmingDelete && (
      <div role="alertdialog" aria-label="确认删除本地文件" className="mat-files__confirm">
        <span>将删除 {selectedCount} 项（作业范围为本地副本、远端不动；工作区文件为本地原件，均不可恢复）。</span>
        <span className="mat-files__confirm-actions">
          <Button size="sm" variant="outline" disabled={snapshot.deleting === 'pending'} onClick={() => { setConfirmingDelete(false) }}>取消</Button>
          <Button size="sm" variant="primary" disabled={snapshot.deleting === 'pending'} onClick={() => { void confirmDelete() }}>{snapshot.deleting === 'pending' ? `删除中…${elapsed}s` : '确认删除'}</Button>
        </span>
      </div>
    )}
    <div className="mat-files__location">
      {focused !== undefined && isSessionScope(focused)
        ? <>
            <span>本地工作目录</span>
            <button type="button" title={focusedRoot ?? undefined} aria-label="复制本地工作目录路径" disabled={focusedRoot === undefined} onClick={() => { if (focusedRoot !== undefined) void copyLocationPath(focusedRoot) }}>
              <code>{focusedRoot ?? '正在定位会话工作目录…'}</code>
            </button>
            {locationCopied && <span className="mat-files__copied">已复制</span>}
          </>
        : <>
            <span>本地工作区</span>
            <button type="button" title={focusedJob?.localWorkspace ?? undefined} aria-label="复制本地镜像目录路径" disabled={focusedJob?.localWorkspace === undefined} onClick={() => { if (focusedJob?.localWorkspace !== undefined) void copyLocationPath(focusedJob.localWorkspace) }}>
              <code>{focusedJob === undefined ? '未聚焦作业' : (focusedJob.localWorkspace ?? '本地工作区未约定')}</code>
            </button>
            {locationCopied && <span className="mat-files__copied">已复制</span>}
          </>}
    </div>
    {primary.length > 0 && <section className="mat-files__primary" aria-labelledby="mat-primary-title">
      <div id="mat-primary-title">主要文件</div>
      <div className="mat-files__chips">{primary.map(path => {
        const opening = snapshot.opening.includes(path)
        return <button key={path} type="button" onClick={() => { if (focused !== undefined) openFile(path, focused) }} aria-pressed={snapshot.selectedPaths.includes(path)} aria-busy={opening} disabled={opening} className={opening ? 'mat-files__chip--busy' : undefined}>{path.split('/').at(-1)}{opening ? '…' : ''}</button>
      })}</div>
    </section>}
    {warning !== undefined && <p role="status" className="mat-files__warning">远端目录暂不可用，仅显示本地工作区：{warning}</p>}
    {busy && <p role="status" aria-live="polite" className="mat-files__loading">{snapshot.download === 'pending' ? `下载中… ${elapsed}s` : `正在同步目录… ${elapsed}s`}{slowHint}</p>}
    {error !== undefined && <p role="alert" className="mat-files__error">{error}</p>}
    <div ref={treeRef} className="mat-files__tree" role="tree" aria-label="统一工作区文件树" aria-multiselectable="true" onKeyDown={onTreeKeyDown}>
      {scopeOrder.length === 0
        ? <p className="mat-files__empty">当前会话没有可显示的工作区。</p>
        : (() => {
          // 第一层：工作区（唯一顶层 scope；其散文件 + 会话分组都在它之下）。
          const scope = sessionKey!
          const expanded = openScopes.includes(scope)
          const scopeEntries = trees[scope] ?? []
          const rows = expanded ? visibleTreeEntries(scopeEntries, snapshot.scopes[scope]?.expanded ?? []) : []
          return <Fragment key={scope}>
            <div role="treeitem" tabIndex={0} data-scope={scope} aria-expanded={expanded} aria-selected={false} className="mat-files__row mat-files__row--scope" style={{ paddingInlineStart: '5px' }} onClick={() => { fileManagerState.toggleScope(scope) }}>
              <span className="mat-files__kind">{expanded ? <IconFolderOpenOutline16 /> : <IconFolderClose16 />}</span>
              <span className="mat-files__tag mat-files__tag--workspace">工作区</span>
              <button type="button" className="mat-files__name" onClick={(event) => { event.stopPropagation(); fileManagerState.toggleScope(scope) }}>{scopeLabel(scope, visible, roots[scope])}</button>
              <span className="mat-files__origin mat-files__origin--local">本地</span>
            </div>
            {expanded && sessionGroups.map(({ session, jobs: sessionJobs }) => {
              // 第二层：会话（虚拟行）；第三层：该会话归档的文件 + 按 jobId 跟踪的作业目录。
              const sidOpen = openSessions.includes(session.sessionId)
              const sessionTitle = session.title ?? (session.sessionId === '' ? '' : session.sessionId.replace(/^session-/, '').slice(0, 8))
              const archived = session.sessionId === '' ? [] : sessionFilesByScope[scope]?.[session.sessionId] ?? []
              return <Fragment key={session.sessionId || 'unowned'}>
                <div role="treeitem" tabIndex={0} data-scope={sessionKey} aria-expanded={sidOpen} aria-selected={false} className="mat-files__row mat-files__row--session" style={{ paddingInlineStart: `${5 + 16}px` }} onClick={() => { toggleSessionRow(session.sessionId) }}>
                  <span className="mat-files__kind">{sidOpen ? <IconFolderOpenOutline16 /> : <IconFolderClose16 />}</span>
                  <span className={`mat-files__tag mat-files__tag--session${session.sessionId === sessionId ? ' mat-files__tag--current' : ''}`}>{session.sessionId === sessionId ? '本会话' : '会话'}</span>
                  <button type="button" className="mat-files__name" onClick={(event) => { event.stopPropagation(); toggleSessionRow(session.sessionId) }}>{sessionTitle}</button>
                  <span className="mat-files__count">{sessionJobs.length + archived.length}</span>
                </div>
                {sidOpen && (sessionJobs.length === 0 && archived.length === 0
                  ? <div className="mat-files__row mat-files__row--loading" style={{ paddingInlineStart: `${5 + 2 * 16}px` }}>无文件与作业</div>
                  : <>
                    {archived.map(path => {
                      const selected = snapshot.scopes[scope]?.selectedPaths.includes(path) ?? false
                      return <div key={`${session.sessionId}\0${path}`} role="treeitem" tabIndex={0} data-path={path} data-scope={scope} aria-selected={selected} className="mat-files__row" style={{ paddingInlineStart: `${5 + 2 * 16}px` }}>
                        <input type="checkbox" aria-label={`选择 ${path}`} checked={selected} onChange={() => { fileManagerState.selectPath(path, scope) }} onClick={(event) => { event.stopPropagation() }} />
                        <span className="mat-files__kind"><StateDot state="done" /></span>
                        <button type="button" className="mat-files__name" title={path} onClick={() => { openFile(path, scope) }}>{path}</button>
                        <span className="mat-files__origin mat-files__origin--local">本地</span>
                      </div>
                    })}
                    {sessionJobs.map(job => {
                    const jobOpen = openScopes.includes(job.jobId)
                    const jobEntries = trees[job.jobId] ?? []
                    const jobRows = jobOpen ? visibleTreeEntries(jobEntries, snapshot.scopes[job.jobId]?.expanded ?? []) : []
                    return <Fragment key={job.jobId}>
                      <div role="treeitem" tabIndex={0} data-scope={job.jobId} aria-expanded={jobOpen} aria-selected={false} className="mat-files__row mat-files__row--scope" style={{ paddingInlineStart: `${5 + 2 * 16}px` }} onClick={() => { fileManagerState.toggleScope(job.jobId) }}>
                        <span className="mat-files__kind">{jobOpen ? <IconFolderOpenOutline16 /> : <IconFolderClose16 />}</span>
                        <span className={`mat-files__tag mat-files__tag--job mat-files__tag--job-${jobTagTone(job)}`}>作业</span>
                        <button type="button" className="mat-files__name" onClick={(event) => { event.stopPropagation(); fileManagerState.toggleScope(job.jobId) }}>{scopeLabel(job.jobId, [job], undefined)}</button>
                        <span className={`mat-files__origin ${job.workdir === undefined ? 'mat-files__origin--local' : 'mat-files__origin--both'}`}>{job.workdir === undefined ? '本地' : '本地 + 远端'}</span>
                      </div>
                      {jobRows.map(entry => {
                        const selected = snapshot.scopes[job.jobId]?.selectedPaths.includes(entry.path) ?? false
                        const pinned = snapshot.scopes[job.jobId]?.pins.includes(entry.path) ?? false
                        const listing = entry.directory && (snapshot.scopes[job.jobId]?.expanded.includes(entry.path) ?? false) && snapshot.expanding.includes(entry.path)
                        return <Fragment key={`${job.jobId}\0${entry.path}`}>
                          <div role="treeitem" tabIndex={0} data-path={entry.path} data-scope={job.jobId} aria-selected={selected} aria-expanded={entry.directory ? snapshot.scopes[job.jobId]?.expanded.includes(entry.path) : undefined} className="mat-files__row" style={{ paddingInlineStart: `${5 + (entry.depth + 3) * 16}px` }}>
                            <input type="checkbox" aria-label={`选择 ${entry.name}`} checked={selected} onChange={() => { fileManagerState.selectPath(entry.path, job.jobId) }} onClick={(event) => { event.stopPropagation() }} />
                            <span className="mat-files__kind">{entry.directory ? ((snapshot.scopes[job.jobId]?.expanded.includes(entry.path) ?? false) ? <IconFolderOpenOutline16 /> : <IconFolderClose16 />) : <StateDot state={statusState(entry)} />}</span>
                            <button type="button" className="mat-files__name" onClick={() => { entry.directory ? (fileManagerState.toggleExpanded(entry.path, job.jobId), void loadDirectory(entry.path, job.jobId)) : openFile(entry.path, job.jobId) }}>{entry.name}</button>
                            <span className={`mat-files__origin mat-files__origin--${entry.origin}`}>{sourceLabel(entry)}</span>
                            <Tooltip label={pinned ? '从主要文件移除' : '固定为主要文件'} side="bottom"><button type="button" className="mat-files__pin" aria-label={`${pinned ? '取消固定' : '固定'} ${entry.name}`} aria-pressed={pinned} onClick={() => { togglePin(entry.path, job.jobId) }}>★</button></Tooltip>
                          </div>
                          {listing && <div role="status" className="mat-files__row mat-files__row--loading" style={{ paddingInlineStart: `${5 + (entry.depth + 4) * 16}px` }}>正在加载子目录…</div>}
                        </Fragment>
                      })}
                      {jobOpen && jobEntries.length === 0 && <div className="mat-files__row mat-files__row--loading" style={{ paddingInlineStart: `${5 + 3 * 16}px` }}>暂无文件</div>}
                    </Fragment>
                    })}
                  </>
                )}
              </Fragment>
            })}
            {rows.map(entry => {
              const selected = snapshot.scopes[scope]?.selectedPaths.includes(entry.path) ?? false
              const listing = entry.directory && (snapshot.scopes[scope]?.expanded.includes(entry.path) ?? false) && snapshot.expanding.includes(entry.path)
              return <Fragment key={`${scope}\0${entry.path}`}>
                <div role="treeitem" tabIndex={0} data-path={entry.path} data-scope={scope} aria-selected={selected} aria-expanded={entry.directory ? snapshot.scopes[scope]?.expanded.includes(entry.path) : undefined} className="mat-files__row" style={{ paddingInlineStart: `${5 + (entry.depth + 1) * 16}px` }}>
                  <input type="checkbox" aria-label={`选择 ${entry.name}`} checked={selected} onChange={() => { fileManagerState.selectPath(entry.path, scope) }} onClick={(event) => { event.stopPropagation() }} />
                  <span className="mat-files__kind">{entry.directory ? ((snapshot.scopes[scope]?.expanded.includes(entry.path) ?? false) ? <IconFolderOpenOutline16 /> : <IconFolderClose16 />) : <StateDot state={statusState(entry)} />}</span>
                  <button type="button" className="mat-files__name" onClick={() => { entry.directory ? (fileManagerState.toggleExpanded(entry.path, scope), void loadDirectory(entry.path, scope)) : openFile(entry.path, scope) }}>{entry.name}</button>
                  <span className={`mat-files__origin mat-files__origin--${entry.origin}`}>{sourceLabel(entry)}</span>
                </div>
                {listing && <div role="status" className="mat-files__row mat-files__row--loading" style={{ paddingInlineStart: `${5 + (entry.depth + 2) * 16}px` }}>正在加载子目录…</div>}
              </Fragment>
            })}
            {expanded && scopeEntries.length === 0 && wsSessions.length === 0 && <div className="mat-files__row mat-files__row--loading" style={{ paddingInlineStart: '25px' }}>暂无文件</div>}
          </Fragment>
        })()}
    </div>
    <p className="mat-files__status" role="status" aria-live="polite">{selectionNote}</p>
  </section>
}
