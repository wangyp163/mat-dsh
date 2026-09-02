export type FileManagerJob = {
  jobId: string
  clusterId: string
  ownerSession?: string
  workdir?: string
  phase: 'monitoring' | 'settled'
  outcomeStatus?: string
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
let activeTab: FilePanelTab = 'files'
let refresh: ActivityState = 'idle'
let download: ActivityState = 'idle'
const jobs = new Map<string, JobViewState>()
const listeners = new Set<Listener>()

function emit(): void { for (const listener of listeners) listener() }

function currentJob(): JobViewState {
  if (selectedJobId === undefined) return { expanded: [], selectedPaths: [], pins: [] }
  let state = jobs.get(selectedJobId)
  if (state === undefined) {
    state = { expanded: [], selectedPaths: [], pins: [] }
    jobs.set(selectedJobId, state)
  }
  return state
}

function toggle(values: string[], path: string): string[] {
  return values.includes(path) ? values.filter(value => value !== path) : [...values, path]
}

export const fileManagerState = {
  snapshot: () => ({ open, selectedJobId, activeTab, refresh, download, ...currentJob() }),
  subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  open(jobId?: string) {
    open = true
    activeTab = 'files'
    selectedJobId = jobId ?? selectedJobId
    emit()
  },
  close() { open = false; emit() },
  select(jobId: string) { selectedJobId = jobId; emit() },
  selectTab(tab: FilePanelTab) { activeTab = tab; emit() },
  toggleExpanded(path: string) { currentJob().expanded = toggle(currentJob().expanded, path); emit() },
  selectPath(path: string) { currentJob().selectedPaths = toggle(currentJob().selectedPaths, path); emit() },
  pin(path: string) {
    const state = currentJob()
    if (!state.pins.includes(path)) state.pins = [...state.pins, path]
    emit()
  },
  unpin(path: string) { currentJob().pins = currentJob().pins.filter(value => value !== path); emit() },
  setPins(paths: string[]) { currentJob().pins = [...new Set(paths)]; emit() },
  beginRefresh() { refresh = 'pending'; emit() },
  finishRefresh(error?: unknown) { refresh = error === undefined ? 'idle' : 'failed'; emit() },
  beginDownload(paths: string[]) {
    currentJob().selectedPaths = [...paths]
    refresh = 'idle'
    download = 'pending'
    emit()
  },
  finishDownload(error?: unknown) { download = error === undefined ? 'idle' : 'failed'; emit() },
  reset() {
    open = false
    selectedJobId = undefined
    activeTab = 'files'
    refresh = 'idle'
    download = 'idle'
    jobs.clear()
    listeners.clear()
  },
}
