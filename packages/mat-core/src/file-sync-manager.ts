import { randomUUID } from 'node:crypto'
import { lstat, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { mapRemotePath } from './remote-file-model.ts'

export interface FileDownloadPort {
  downloadFile(remotePath: string, localPath: string): Promise<{ success: true; path: string; bytes: number }>
  /** Optional remote byte size, used to bound background prefetch budgets. */
  statFile?(remotePath: string): Promise<number>
}

export type FileSyncStatus = 'queued' | 'downloading' | 'verifying' | 'completed' | 'failed' | 'cancelled'

export interface FileSyncRequest {
  id: string
  /**
   * Local task-directory segment; defaults to `id`. Required when `id` is a board
   * key (`cluster:slurm`) that is not itself a safe path segment — the directory
   * then carries the real Slurm job number while `id` stays the correlation key.
   */
  localDir?: string
  workdir: string
  remotePath: string
  conflictPolicy?: 'keep-both' | 'overwrite'
}

export interface FileSyncRecord extends FileSyncRequest {
  syncId: string
  status: FileSyncStatus
  localPath?: string
  bytes?: number
  error?: string
}

export class FileSyncManager {
  private readonly records = new Map<string, FileSyncRecord>()
  private readonly keys = new Map<string, string>()
  private readonly options: { localRoot: string; transfer: FileDownloadPort }

  constructor(options: { localRoot: string; transfer: FileDownloadPort }) { this.options = options }

  list(): FileSyncRecord[] { return [...this.records.values()].map((value) => ({ ...value })) }

  async enqueue(request: FileSyncRequest): Promise<FileSyncRecord> {
    const dirName = request.localDir ?? request.id
    if (!/^[A-Za-z0-9._-]+$/.test(dirName) || dirName === '.' || dirName === '..') throw new Error('sync id must be a safe path segment')
    const key = `${request.id}\0${request.workdir}\0${request.remotePath}`
    const existingId = this.keys.get(key)
    if (existingId !== undefined) {
      const existing = this.records.get(existingId)!
      // A terminal failure must not pin the file as permanently unsyncable:
      // re-enqueue retries it under the same sync id. In-flight and completed
      // records are returned as-is.
      if (existing.status !== 'failed') return { ...existing }
      existing.status = 'queued'; delete existing.error
      return this.run(existing)
    }
    const syncId = randomUUID()
    const record: FileSyncRecord = { ...request, syncId, status: 'queued' }
    this.keys.set(key, syncId)
    this.records.set(syncId, record)
    return this.run(record)
  }

  async retry(syncId: string): Promise<FileSyncRecord> {
    const record = this.records.get(syncId)
    if (record === undefined) throw new Error(`unknown sync ${syncId}`)
    if (record.status !== 'failed') return { ...record }
    record.status = 'queued'; delete record.error
    return this.run(record)
  }

  private async run(record: FileSyncRecord): Promise<FileSyncRecord> {
    let temporaryPath: string | undefined
    try {
      const taskRoot = join(this.options.localRoot, record.localDir ?? record.id)
      let destination = mapRemotePath(taskRoot, record.workdir, record.remotePath)
      await ensureSafeDirectory(taskRoot, dirname(destination))
      if ((record.conflictPolicy ?? 'keep-both') === 'keep-both') destination = await keepBothPath(destination)
      temporaryPath = `${destination}.mat-part-${randomUUID()}`
      record.status = 'downloading'
      const result = await this.options.transfer.downloadFile(record.remotePath, temporaryPath)
      record.status = 'verifying'
      const info = await stat(temporaryPath)
      if (info.size !== result.bytes) throw new Error(`download size mismatch: expected ${result.bytes}, got ${info.size}`)
      await rename(temporaryPath, destination)
      temporaryPath = undefined
      record.status = 'completed'; record.localPath = destination; record.bytes = info.size
    } catch (error) {
      if (temporaryPath !== undefined) await unlink(temporaryPath).catch(() => {})
      record.status = 'failed'; record.error = error instanceof Error ? error.message : String(error)
    }
    return { ...record }
  }
}

async function ensureSafeDirectory(root: string, directory: string): Promise<void> {
  const relativePath = directory.slice(root.length).split('/').filter(Boolean)
  let current = root
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const segment of relativePath) {
    current = join(current, segment)
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`local mapping parent is a symlink: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
    }
  }
}

async function keepBothPath(path: string): Promise<string> {
  if (!await exists(path)) return path
  const extension = extname(path)
  const stem = extension === '' ? path : path.slice(0, -extension.length)
  for (let index = 1; ; index++) {
    const candidate = `${stem}.mat-${index}${extension}`
    if (!await exists(candidate)) return candidate
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
