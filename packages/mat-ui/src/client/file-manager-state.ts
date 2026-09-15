export type FileManagerJob = {
  jobId: string
  clusterId: string
  ownerSession?: string
  workdir?: string
  localWorkspace?: string
  phase: 'monitoring' | 'settled'
  outcomeStatus?: string
  /** sacct 观测快照（/mat-files/jobs 回传）：chip 状态着色取首条 state。 */
  slurm?: Array<{ id: string; state: string }>
  files: string[]
}

export type RemoteFileEntry = {
  name: string
  path: string
  size: number
  modifiedAt?: string
  directory: boolean
  regularFile: boolean
  symbolicLink: boolean
  readable: boolean
}

type Listener = () => void
type FilePanelTab = 'files' | 'details'
type ActivityState = 'idle' | 'pending' | 'failed'

interface JobViewState {
  expanded: string[]
  selectedPaths: string[]
  pins: string[]
}

let open = false
let selectedJobId: string | undefined
/** 统一虚拟树：当前展开的 scope（虚拟根）——`session:<id>` 或作业板键。 */
let openScopes: string[] = []
let activeTab: FilePanelTab = 'files'
let refresh: ActivityState = 'idle'
let download: ActivityState = 'idle'
let deleting: ActivityState = 'idle'
let opening: string[] = []
let expanding: string[] = []
const jobs = new Map<string, JobViewState>()
const listeners = new Set<Listener>()

function emit(): void { for (const listener of listeners) listener() }

function stateOf(scope: string | undefined): JobViewState {
  const key = scope ?? selectedJobId
  if (key === undefined) return { expanded: [], selectedPaths: [], pins: [] }
  let state = jobs.get(key)
  if (state === undefined) {
    state = { expanded: [], selectedPaths: [], pins: [] }
    jobs.set(key, state)
  }
  return state
}

function currentJob(): JobViewState { return stateOf(undefined) }

function toggle(values: string[], path: string): string[] {
  return values.includes(path) ? values.filter(value => value !== path) : [...values, path]
}

function openScopeIn(key: string): void {
  if (!openScopes.includes(key)) openScopes = [...openScopes, key]
}

export const fileManagerState = {
  snapshot: () => ({
    open, selectedJobId, openScopes, activeTab, refresh, download, deleting, opening, expanding,
    ...currentJob(),
    scopes: Object.fromEntries(jobs),
  }),
  subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  open(jobId?: string) {
    open = true
    activeTab = 'files'
    if (jobId !== undefined) { selectedJobId = jobId; openScopeIn(jobId) }
    emit()
  },
  close() { open = false; emit() },
  /** 聚焦某 scope（顺带展开其虚拟根——跨面板 selectJob 联动）。 */
  select(jobId: string) { selectedJobId = jobId; openScopeIn(jobId); emit() },
  selectJob(jobId: string) { selectedJobId = jobId; openScopeIn(jobId); emit() },
  /** 只改焦点、不展开（作业目录默认折叠；展开由用户点 scope 行触发）。 */
  focus(jobId: string) { selectedJobId = jobId; emit() },
  /** 虚拟根展开管理：工作区与作业子树共存于统一树。 */
  openScope(key: string) { openScopeIn(key); emit() },
  closeScope(key: string) { openScopes = openScopes.filter(value => value !== key); emit() },
  toggleScope(key: string) { openScopes.includes(key) ? fileManagerState.closeScope(key) : fileManagerState.openScope(key) },
  selectTab(tab: FilePanelTab) { activeTab = tab; emit() },
  toggleExpanded(path: string, scope?: string) { const state = stateOf(scope); state.expanded = toggle(state.expanded, path); emit() },
  selectPath(path: string, scope?: string) { const state = stateOf(scope); state.selectedPaths = toggle(state.selectedPaths, path); emit() },
  pin(path: string, scope?: string) {
    const state = stateOf(scope)
    if (!state.pins.includes(path)) state.pins = [...state.pins, path]
    emit()
  },
  unpin(path: string, scope?: string) { const state = stateOf(scope); state.pins = state.pins.filter(value => value !== path); emit() },
  setPins(paths: string[], scope?: string) { stateOf(scope).pins = [...new Set(paths)]; emit() },
  beginRefresh() { refresh = 'pending'; emit() },
  finishRefresh(error?: unknown) { refresh = error === undefined ? 'idle' : 'failed'; emit() },
  /** 单文件打开（按需物化）在途集合：驱动 chip 级加载指示。 */
  beginOpen(path: string) { if (!opening.includes(path)) opening = [...opening, path]; emit() },
  finishOpen(path: string) { opening = opening.filter(value => value !== path); emit() },
  /** 目录展开（远端子目录列表）在途集合：驱动目录下加载行。 */
  beginExpand(path: string, scope?: string) { if (!expanding.includes(path)) expanding = [...expanding, path]; emit() },
  finishExpand(path: string, scope?: string) { expanding = expanding.filter(value => value !== path); emit() },
  beginDownload(paths: string[], scope?: string) {
    stateOf(scope).selectedPaths = [...paths]
    refresh = 'idle'
    download = 'pending'
    emit()
  },
  finishDownload(error?: unknown) { download = error === undefined ? 'idle' : 'failed'; emit() },
  /** 本地删除在途态（与下载/刷新同族）。 */
  beginDelete() { deleting = 'pending'; emit() },
  finishDelete(error?: unknown) { deleting = error === undefined ? 'idle' : 'failed'; emit() },
  /** 删除落盘后清掉相关选中/展开/pin，避免树里残留死引用。 */
  removePaths(paths: string[], scope?: string) {
    const state = stateOf(scope)
    const gone = (path: string): boolean => paths.some(target => path === target || path.startsWith(`${target}/`))
    state.selectedPaths = state.selectedPaths.filter(path => !gone(path))
    state.expanded = state.expanded.filter(path => !gone(path))
    state.pins = state.pins.filter(path => !gone(path))
    emit()
  },
  reset() {
    open = false
    selectedJobId = undefined
    openScopes = []
    activeTab = 'files'
    refresh = 'idle'
    download = 'idle'
    deleting = 'idle'
    opening = []
    expanding = []
    jobs.clear()
    listeners.clear()
  },
}
