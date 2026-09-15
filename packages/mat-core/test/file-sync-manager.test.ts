import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileSyncManager } from '../src/file-sync-manager'

function transfer(content: string, calls: string[] = []) {
  return {
    calls,
    async downloadFile(remotePath: string, localPath: string) {
      calls.push(remotePath)
      await writeFile(localPath, content)
      return { success: true as const, path: localPath, bytes: Buffer.byteLength(content) }
    },
  }
}

describe('FileSyncManager', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs.length = 0 })

  it('downloads atomically below the task root and reports completed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-manager-')); dirs.push(root)
    const calls: string[] = []
    const manager = new FileSyncManager({ localRoot: root, transfer: transfer('hello', calls) })
    const result = await manager.enqueue({ id: 's1', workdir: '/remote/job', remotePath: '/remote/job/out.log' })
    expect(result.status).toBe('completed')
    expect(calls).toEqual(['/remote/job/out.log'])
    await expect(readFile(join(root, 's1', 'out.log'), 'utf8')).resolves.toBe('hello')
    await expect(readdir(join(root, 's1'))).resolves.toEqual(['out.log'])
  })

  it('keeps an existing local file and uses a deterministic conflict suffix by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-manager-')); dirs.push(root)
    await mkdirp(join(root, 's1'))
    await writeFile(join(root, 's1', 'out.log'), 'old')
    const manager = new FileSyncManager({ localRoot: root, transfer: transfer('new') })
    const result = await manager.enqueue({ id: 's1', workdir: '/remote/job', remotePath: '/remote/job/out.log' })
    expect(result.status).toBe('completed')
    expect(result.localPath).toMatch(/out\.mat-1\.log$/)
    await expect(readFile(join(root, 's1', 'out.log'), 'utf8')).resolves.toBe('old')
  })

  it('rejects a destination whose parent is a symlink outside the local root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-manager-')); const outside = await mkdtemp(join(tmpdir(), 'sync-outside-')); dirs.push(root, outside)
    await mkdirp(join(root, 's1')); await symlink(outside, join(root, 's1', 'out'))
    const manager = new FileSyncManager({ localRoot: root, transfer: transfer('no') })
    await expect(manager.enqueue({ id: 's1', workdir: '/remote/job', remotePath: '/remote/job/out/result.log' })).resolves.toMatchObject({ status: 'failed', error: expect.stringMatching(/symlink|root/) })
  })

  it('rejects unsafe task keys before creating local paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-manager-')); dirs.push(root)
    const manager = new FileSyncManager({ localRoot: root, transfer: transfer('no') })
    await expect(manager.enqueue({ id: '../escape', workdir: '/remote/job', remotePath: '/remote/job/a' }))
      .rejects.toThrow(/id/)
  })

  it('is idempotent for the same sync key and supports retry after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-manager-')); dirs.push(root)
    let attempts = 0
    const manager = new FileSyncManager({ localRoot: root, transfer: {
      async downloadFile(_remote, localPath) { attempts++; if (attempts === 1) throw new Error('offline'); await writeFile(localPath, 'ok'); return { success: true as const, path: localPath, bytes: 2 } },
    } })
    const failed = await manager.enqueue({ id: 's1', workdir: '/remote/job', remotePath: '/remote/job/a' })
    expect(failed.status).toBe('failed')
    const retried = await manager.retry(failed.syncId)
    expect(retried.status).toBe('completed')
    const duplicate = await manager.enqueue({ id: 's1', workdir: '/remote/job', remotePath: '/remote/job/a' })
    expect(duplicate.syncId).toBe(failed.syncId)
    expect(attempts).toBe(2)
  })

  it('re-runs a failed record on re-enqueue instead of returning the stale failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-manager-')); dirs.push(root)
    let attempts = 0
    const manager = new FileSyncManager({ localRoot: root, transfer: {
      async downloadFile(_remote, localPath) { attempts++; if (attempts === 1) throw new Error('offline'); await writeFile(localPath, 'ok'); return { success: true as const, path: localPath, bytes: 2 } },
    } })
    const failed = await manager.enqueue({ id: 's1', workdir: '/remote/job', remotePath: '/remote/job/a' })
    expect(failed.status).toBe('failed')
    const rerun = await manager.enqueue({ id: 's1', workdir: '/remote/job', remotePath: '/remote/job/a' })
    expect(rerun.syncId).toBe(failed.syncId)
    expect(rerun.status).toBe('completed')
    expect(attempts).toBe(2)
  })

  it('maps a board-key id (cluster:slurm) onto its explicit safe local dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-manager-')); dirs.push(root)
    const manager = new FileSyncManager({ localRoot: root, transfer: transfer('hello') })
    const result = await manager.enqueue({ id: '11250:120763977', localDir: '120763977', workdir: '/remote/job', remotePath: '/remote/job/out.log' })
    expect(result.status).toBe('completed')
    expect(result.id).toBe('11250:120763977') // 关联 id 保留板键，供下载路由按 jobId 对账
    expect(result.localPath).toBe(join(root, '120763977', 'out.log')) // 目录段 = 真实作业号
    // 板键 id 不带安全目录段时必须拒绝（不得把 `:` 拼进本地路径）。
    await expect(manager.enqueue({ id: '11250:oops', workdir: '/remote/job', remotePath: '/remote/job/b.log' }))
      .rejects.toThrow(/id/)
  })
})

async function mkdirp(path: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path, { recursive: true })
}
