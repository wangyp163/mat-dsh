import { mkdir, readFile, rename, writeFile, readdir, lstat, realpath, stat, unlink } from 'node:fs/promises'
import { dirname, join, relative, resolve, posix } from 'node:path'
import { FileSyncManager, mergeWorkspaceTree, projectPrimaryFiles } from 'mat-core'
import type { FileDownloadPort, FileSyncRecord, ListFilesOptions, RemoteFileEntry, RemoteFilePage } from 'mat-core'
import { normalizeRemotePath, remoteRelativePath } from 'mat-core'

export interface SettledFileJob {
  jobId: string
  clusterId: string
  workdir?: string
  outcomeStatus?: 'completed' | 'failed' | 'killed'
  files?: string[]
}

export interface WorkspaceRequest {
  jobId: string
  clusterId: string
  workdir: string
  path: string
  producerFiles?: string[]
  patterns?: string[]
}
export interface WorkspaceTree { path: string; entries: Array<Record<string, unknown>>; primary: string[] }

export interface DownloadArtifact {
  kind: 'file' | 'zip'
  filename: string
  body: Uint8Array
  contentType?: string
  dispose?: () => Promise<void> | void
}

const MAX_FILES = 100
const MAX_BYTES = 100 * 1024 * 1024
const MAX_DEPTH = 16

export interface FilePreferences { autoSync: boolean; pins?: string[]; exclusions?: string[] }

export interface MatFileServiceOptions {
  localRoot: string
  transferFor: (clusterId: string) => FileDownloadPort
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}

function makeZip(files: Array<{ name: string; data: Buffer }>): Uint8Array {
  const chunks: Buffer[] = []; const central: Buffer[] = []; let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name); const crc = crc32(file.data)
    const header = Buffer.alloc(30 + name.length)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(file.data.length, 18); header.writeUInt32LE(file.data.length, 22)
    header.writeUInt16LE(name.length, 26); name.copy(header, 30); chunks.push(header, file.data)
    const entry = Buffer.alloc(46 + name.length); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8)
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(file.data.length, 20); entry.writeUInt32LE(file.data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42); name.copy(entry, 46); central.push(entry); offset += header.length + file.data.length
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, directory, end])
}

export class MatFileServiceImpl {
  private readonly managers = new Map<string, FileSyncManager>()
  private readonly preferencesPath: string
  private preferences: Record<string, FilePreferences> = {}
  private readonly seenJobs = new Set<string>()

  private readonly options: MatFileServiceOptions

  constructor(options: MatFileServiceOptions) {
    this.options = options
    this.preferencesPath = join(options.localRoot, 'preferences.json')
  }

  async initialize(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.preferencesPath, 'utf8')) as { jobs?: Record<string, FilePreferences> }
      if (data.jobs !== undefined) this.preferences = data.jobs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('file preferences are corrupt or unreadable')
    }
  }

  async setPreferences(jobId: string, value: FilePreferences): Promise<void> {
    this.preferences[jobId] = {
      autoSync: value.autoSync === true,
      ...(value.pins === undefined ? {} : { pins: [...new Set(value.pins.filter((path) => typeof path === 'string'))] }),
      ...(value.exclusions === undefined ? {} : { exclusions: [...new Set(value.exclusions.filter((path) => typeof path === 'string'))] }),
    }
    await mkdir(dirname(this.preferencesPath), { recursive: true, mode: 0o700 })
    const temporary = `${this.preferencesPath}.part`
    await writeFile(temporary, JSON.stringify({ jobs: this.preferences }), { mode: 0o600 })
    await rename(temporary, this.preferencesPath)
  }

  async getPreferences(jobId: string): Promise<FilePreferences> {
    if (Object.keys(this.preferences).length === 0) await this.initialize()
    const value = this.preferences[jobId]
    return {
      autoSync: value?.autoSync === true,
      ...(value?.pins === undefined ? {} : { pins: [...value.pins] }),
      ...(value?.exclusions === undefined ? {} : { exclusions: [...value.exclusions] }),
    }
  }

  async listWorkspace(request: WorkspaceRequest): Promise<WorkspaceTree> {
    if (!/^[A-Za-z0-9._-]+$/.test(request.jobId) || !/^[A-Za-z0-9._-]+$/.test(request.clusterId)) throw new Error('unsafe workspace identity')
    if (request.path.includes('\0') || request.path.startsWith('/') || request.path.split('/').some((part) => part === '..')) throw new Error('unsafe workspace path')
    const mappedRoot = resolve(this.options.localRoot, request.clusterId, request.jobId)
    const root = resolve(mappedRoot, request.path)
    if (root !== mappedRoot && !root.startsWith(`${mappedRoot}/`)) throw new Error('unsafe workspace path')
    const local: Array<Record<string, unknown>> = []
    for (const item of await readdir(root, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
      if (item.name.includes('\0') || item.name.endsWith('.mat-part-') || item.name.includes('.mat-part-')) continue
      const full = join(root, item.name)
      const info = await lstat(full)
      const path = request.path ? `${request.path}/${item.name}` : item.name
      local.push({ path, name: item.name, directory: info.isDirectory(), regularFile: info.isFile(), symbolicLink: info.isSymbolicLink(), readable: info.isFile() ? Boolean(info.mode & 0o444) : true, size: info.isFile() ? info.size : 0 })
    }
    let remotePage: RemoteFilePage = { path: request.workdir, total: 0, entries: [] }
    try {
      remotePage = await this.listFiles(request.clusterId, request.path ? `${request.workdir}/${request.path}` : request.workdir, { limit: MAX_FILES })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('must be supplied')) throw error
    }
    const prefs = await this.getPreferences(request.jobId)
    const nodes = mergeWorkspaceTree({ local: local as never[], remote: remotePage.entries, workdir: request.workdir, syncs: this.listSyncs() })
      .filter((node) => node.path === request.path || (request.path === '' ? !node.path.includes('/') : node.path.startsWith(`${request.path}/`) && !node.path.slice(request.path.length + 1).includes('/')))
    const primary = projectPrimaryFiles({ workdir: request.workdir, entries: remotePage.entries, producerFiles: request.producerFiles ?? [], patterns: request.patterns ?? ['*.log', '*.out', 'result*.json'], pins: prefs.pins ?? [], exclusions: prefs.exclusions ?? [] })
    return { path: request.path, entries: nodes as unknown as Array<Record<string, unknown>>, primary }
  }

  private manager(clusterId: string): FileSyncManager {
    let manager = this.managers.get(clusterId)
    if (manager === undefined) {
      manager = new FileSyncManager({ localRoot: join(this.options.localRoot, clusterId), transfer: this.options.transferFor(clusterId) })
      this.managers.set(clusterId, manager)
    }
    return manager
  }

  async syncFile(jobId: string, clusterId: string, workdir: string, remotePath: string, conflictPolicy: 'keep-both' | 'overwrite' = 'keep-both'): Promise<FileSyncRecord> {
    remoteRelativePath(workdir, normalizeRemotePath(remotePath))
    return this.manager(clusterId).enqueue({ id: jobId, workdir, remotePath, conflictPolicy })
  }

  listSyncs(): FileSyncRecord[] { return [...this.managers.values()].flatMap((manager) => manager.list()) }

  async listFiles(_clusterId: string, _path: string, _options?: ListFilesOptions): Promise<RemoteFilePage> {
    throw new Error('efile list service must be supplied by the runtime adapter')
  }

  async prepareDownload(jobId: string, paths: string[]): Promise<DownloadArtifact> {
    if (!/^[A-Za-z0-9._-]+$/.test(jobId) || paths.length < 1 || paths.length > MAX_FILES) throw new Error('invalid download request')
    const records = this.listSyncs().filter((record) => record.id === jobId && record.status === 'completed' && record.localPath !== undefined)
    const roots: string[] = []
    for (const value of paths) {
      if (!value || value.includes('\0') || value.startsWith('/') || value.split('/').some((part) => part === '..')) throw new Error('unsafe download path')
      const record = records.find((candidate) => candidate.remotePath.endsWith(`/${value}`) || candidate.remotePath === value)
      if (record?.localPath !== undefined) roots.push(record.localPath)
      else {
        const candidate = records.length > 0 ? undefined : undefined
        if (candidate !== undefined) roots.push(candidate)
        else throw new Error(`file is not synchronized: ${value}`)
      }
    }
    const files: Array<{ path: string; name: string; data: Buffer }> = []
    let bytes = 0
    const walk = async (filePath: string, name: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) throw new Error('download depth limit exceeded')
      const info = await lstat(filePath)
      if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) throw new Error('unsupported local file type')
      if (info.isDirectory()) {
        for (const entry of await readdir(filePath)) {
          if (entry.includes('.mat-part-')) continue
          await walk(join(filePath, entry), `${name}/${entry}`, depth + 1)
        }
        return
      }
      if (!(info.mode & 0o444)) throw new Error('file is not readable')
      if (files.length >= MAX_FILES || bytes + info.size > MAX_BYTES) throw new Error('download size limit exceeded')
      const data = await readFile(filePath); files.push({ path: filePath, name, data }); bytes += data.length
    }
    for (const root of roots) await walk(root, posix.basename(root), 0)
    if (files.length === 1 && roots.length === 1) return { kind: 'file', filename: files[0]!.name, body: files[0]!.data, contentType: 'application/octet-stream' }
    return { kind: 'zip', filename: `${jobId}-files.zip`, body: makeZip(files) , contentType: 'application/zip' }
  }

  async handleSettledJob(job: SettledFileJob): Promise<FileSyncRecord[]> {
    if (job.outcomeStatus !== 'completed' || !(await this.getPreferences(job.jobId)).autoSync || this.seenJobs.has(job.jobId)) return []
    this.seenJobs.add(job.jobId)
    if (job.workdir === undefined) return []
    return Promise.all((job.files ?? []).map((path) => this.syncFile(job.jobId, job.clusterId, job.workdir!, path.startsWith('/') ? path : `${job.workdir}/${path}`)))
  }
}
