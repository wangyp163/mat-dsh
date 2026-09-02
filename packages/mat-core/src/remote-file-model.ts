import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type { RemoteFileEntry } from './efile.ts'

export const DEFAULT_GAUSSIAN_IMPORTANT_PATTERNS = ['*.log', '*.out', '*.chk', '*.fchk', '*.xyz', '*.gjf', 'result*.json']

export function normalizeRemotePath(path: string): string {
  if (!path || path.includes('\0') || !isAbsolute(path) || path.includes('://') || path.split('/').includes('..')) throw new Error('remote path must be an absolute POSIX path without traversal')
  const normalized = normalize(path).replaceAll('\\', '/')
  if (!normalized.startsWith('/') || normalized === '/' && path !== '/') throw new Error('remote path escapes filesystem root')
  return normalized
}

export function remoteRelativePath(workdir: string, filePath: string): string {
  const root = normalizeRemotePath(workdir)
  const target = normalizeRemotePath(filePath)
  const rel = relative(root, target).replaceAll('\\', '/')
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`file path is outside workdir: ${target}`)
  return rel
}

export function mapRemotePath(localRoot: string, workdir: string, filePath: string): string {
  const rel = remoteRelativePath(workdir, filePath)
  const root = resolve(localRoot)
  const target = resolve(join(root, rel))
  if (target !== root && !target.startsWith(`${root}/`)) throw new Error(`mapped path is outside local root: ${target}`)
  return target
}

export function filterDownloadableEntries(entries: RemoteFileEntry[], limits: { maxFiles: number; maxBytes: number }): {
  entries: RemoteFileEntry[]
  skipped: Array<{ entry: RemoteFileEntry; reason: string }>
} {
  const accepted: RemoteFileEntry[] = []
  const skipped: Array<{ entry: RemoteFileEntry; reason: string }> = []
  let bytes = 0
  for (const value of entries) {
    const reason = value.directory ? 'directory' : value.symbolicLink ? 'symbolic-link' : !value.readable ? 'not-readable' : accepted.length >= limits.maxFiles ? 'file-budget' : bytes + value.size > limits.maxBytes ? 'byte-budget' : undefined
    if (reason !== undefined) skipped.push({ entry: value, reason })
    else { accepted.push(value); bytes += value.size }
  }
  return { entries: accepted, skipped }
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')
  return new RegExp(`^${escaped}$`).test(value)
}

export interface LocalFileEntry {
  path: string
  name: string
  size: number
  directory: boolean
  regularFile: boolean
  symbolicLink: boolean
  readable: boolean
}

export type WorkspaceNodeStatus =
  | 'local-only'
  | 'remote-only'
  | 'synchronized'
  | 'downloading'
  | 'failed'
  | 'unreadable'
  | 'conflict'

export interface WorkspaceTreeNode {
  path: string
  name: string
  size: number
  directory: boolean
  regularFile: boolean
  symbolicLink: boolean
  readable: boolean
  origin: 'local' | 'remote' | 'both'
  status: WorkspaceNodeStatus
}

export function mergeWorkspaceTree(input: {
  local: LocalFileEntry[]
  remote: RemoteFileEntry[]
  workdir: string
  syncs: Array<{ remotePath: string; status: string }>
}): WorkspaceTreeNode[] {
  const nodes = new Map<string, WorkspaceTreeNode>()
  for (const local of input.local) {
    if (!local.path || local.path.split('/').includes('..') || local.path.startsWith('/')) throw new Error('local tree path must be relative')
    nodes.set(local.path, { ...local, origin: 'local', status: local.readable ? 'local-only' : 'unreadable' })
  }
  const completed = new Set(input.syncs.filter(sync => sync.status === 'completed').map(sync => remoteRelativePath(input.workdir, normalizeRemotePath(sync.remotePath))))
  for (const remote of input.remote) {
    const path = remoteRelativePath(input.workdir, normalizeRemotePath(remote.path))
    const current = nodes.get(path)
    if (current === undefined) {
      nodes.set(path, { ...remote, path, origin: 'remote', status: remote.readable ? 'remote-only' : 'unreadable' })
      continue
    }
    const sameKind = current.directory === remote.directory
    nodes.set(path, {
      ...remote,
      path,
      name: current.name,
      origin: 'both',
      status: sameKind
        ? completed.has(path)
          ? 'synchronized'
          : input.syncs.some(sync => {
            try { return remoteRelativePath(input.workdir, normalizeRemotePath(sync.remotePath)) === path }
            catch { return false }
          }) ? 'downloading' : 'synchronized'
        : 'conflict',
    })
  }
  return [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function projectPrimaryFiles(input: {
  workdir: string
  entries: RemoteFileEntry[]
  producerFiles: string[]
  patterns: string[]
  pins: string[]
  exclusions: string[]
}): string[] {
  const excluded = new Set(input.exclusions.map(value => value.startsWith('/') ? remoteRelativePath(input.workdir, normalizeRemotePath(value)) : value))
  const remotePaths = importantRemotePaths({
    workdir: input.workdir,
    entries: input.entries,
    producerFiles: input.producerFiles.map(path => path.startsWith('/') ? path : `${input.workdir}/${path}`),
    patterns: input.patterns,
    selectedPaths: input.pins.map(path => path.startsWith('/') ? path : `${input.workdir}/${path}`),
  })
  return remotePaths
    .map(path => remoteRelativePath(input.workdir, path))
    .filter(path => !excluded.has(path))
}

export function importantRemotePaths(input: { workdir: string; entries: RemoteFileEntry[]; producerFiles: string[]; patterns: string[]; selectedPaths: string[] }): string[] {
  const byPath = new Map(input.entries.map((entry) => [normalizeRemotePath(entry.path), entry]))
  const result: string[] = []
  const add = (path: string) => {
    const normalized = normalizeRemotePath(path)
    remoteRelativePath(input.workdir, normalized)
    const entry = byPath.get(normalized)
    if (entry !== undefined && !entry.directory && !entry.symbolicLink && entry.readable && !result.includes(normalized)) result.push(normalized)
  }
  for (const path of input.producerFiles) add(path.startsWith('/') ? path : `${input.workdir}/${path}`)
  for (const entry of input.entries) if (input.patterns.some((pattern) => globMatch(pattern, entry.name) || globMatch(pattern, remoteRelativePath(input.workdir, entry.path)))) add(entry.path)
  for (const path of input.selectedPaths) add(path)
  return result
}
