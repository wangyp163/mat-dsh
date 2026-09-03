import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MatFileServiceImpl } from '../src/file-service'

function transfer(content: string, calls: Array<[string, string]> = []) {
  return {
    calls,
    async downloadFile(remotePath: string, localPath: string) {
      calls.push([remotePath, localPath])
      await writeFile(localPath, content)
      return { success: true as const, path: localPath, bytes: Buffer.byteLength(content) }
    },
  }
}

describe('MatFileServiceImpl', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs.length = 0 })

  it('persists auto-sync preferences and restores them in a new instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const first = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    await first.setPreferences('job-1', { autoSync: true })
    expect(await first.getPreferences('job-1')).toEqual({ autoSync: true })

    const second = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    expect(await second.getPreferences('job-1')).toEqual({ autoSync: true })
    expect(JSON.parse(await readFile(join(root, 'preferences.json'), 'utf8'))).toEqual({ jobs: { 'job-1': { autoSync: true } } })
  })

  it('syncs trusted producer files once after a completed job when enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const port = transfer('result')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => port })
    await service.setPreferences('job-1', { autoSync: true })
    const job = { jobId: 'job-1', clusterId: '11250', workdir: '/remote/job', outcomeStatus: 'completed' as const, files: ['result.log', '/remote/job/output/result.json'] }
    await service.handleSettledJob(job)
    await service.handleSettledJob(job)
    expect(port.calls.map(([remote]) => remote).sort()).toEqual(['/remote/job/output/result.json', '/remote/job/result.log'].sort())
    expect(service.listSyncs().every((record) => record.status === 'completed')).toBe(true)
  })

  it('materializes a remote file at its agreed task-workspace path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const port = transfer('result')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => port })
    const path = await service.materializeFile('job-1', '11250', '/remote/job', 'output/result.log')
    expect(path).toBe(join(root, '11250', 'job-1', 'output', 'result.log'))
    expect(await readFile(path, 'utf8')).toBe('result')
    await expect(service.materializeFile('job-1', '11250', '/remote/job', '../secret')).rejects.toThrow('unsafe workspace path')
  })

  it('does not auto-sync failed jobs, disabled jobs, or paths outside workdir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const port = transfer('result')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => port })
    await service.handleSettledJob({ jobId: 'disabled', clusterId: '11250', workdir: '/remote/job', outcomeStatus: 'completed', files: ['result.log'] })
    await service.setPreferences('failed', { autoSync: true })
    await service.handleSettledJob({ jobId: 'failed', clusterId: '11250', workdir: '/remote/job', outcomeStatus: 'failed', files: ['result.log'] })
    await service.setPreferences('unsafe', { autoSync: true })
    await expect(service.handleSettledJob({ jobId: 'unsafe', clusterId: '11250', workdir: '/remote/job', outcomeStatus: 'completed', files: ['/etc/passwd'] })).rejects.toThrow(/outside/)
    expect(port.calls).toEqual([])
  })

  it('persists manual pins and exclusions alongside auto-sync preferences', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const first = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    await first.setPreferences('job-1', {
      autoSync: true,
      pins: ['output/result.json'],
      exclusions: ['output/debug.log'],
    })
    expect(await first.getPreferences('job-1')).toEqual({
      autoSync: true,
      pins: ['output/result.json'],
      exclusions: ['output/debug.log'],
    })
    const second = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    expect(await second.getPreferences('job-1')).toEqual({
      autoSync: true,
      pins: ['output/result.json'],
      exclusions: ['output/debug.log'],
    })
  })

  it('rejects a persisted workspace outside the configured task mapping', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    await expect(service.listWorkspace({
      jobId: 'job-1', clusterId: '11250', workdir: '/remote/job', path: '',
      localWorkspace: join(root, '11250', 'another-job'),
    })).rejects.toThrow('workspace identity')
  })

  it('projects a mapped local tree without exposing temporary or escaping entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    await mkdir(join(root, '11250', 'job-1', 'output'), { recursive: true })
    await writeFile(join(root, '11250', 'job-1', 'output', 'result.json'), '{}')
    await writeFile(join(root, '11250', 'job-1', 'output', '.part-result'), 'partial')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    const tree = await service.listWorkspace({
      jobId: 'job-1', clusterId: '11250', workdir: '/remote/job', path: '',
    })
    expect(tree.entries.map((entry: { path: string }) => entry.path)).toContain('output')
    expect(JSON.stringify(tree)).not.toContain('.part-result')
  })

  it('resolves a shell-style workdir through the injected resolver before listing and merging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const listed: string[] = []
    const hintsSeen: unknown[] = []
    const service = new MatFileServiceImpl({
      localRoot: root,
      transferFor: () => transfer('x'),
      resolveWorkdir: async (_clusterId, workdir, hints) => {
        hintsSeen.push(hints)
        return workdir.replace('$HOME/workspace/job', '/public/home/u/job')
      },
    })
    service.listFiles = async (_clusterId, path) => {
      listed.push(path)
      return { path, total: 1, entries: [{ name: 'result.log', path: '/public/home/u/job/result.log', size: 3, modifiedAt: '', directory: false, regularFile: true, symbolicLink: false, readable: true }] }
    }
    const tree = await service.listWorkspace({
      jobId: 'job-1', clusterId: '11250', workdir: '$HOME/workspace/job', path: '',
      producerFiles: ['/public/home/u/job/result.log'],
    })
    expect(listed).toEqual(['/public/home/u/job'])
    expect(hintsSeen).toEqual([['/public/home/u/job/result.log']])
    expect(tree.entries).toEqual([expect.objectContaining({ path: 'result.log', origin: 'remote', status: 'remote-only' })])
    expect(tree.primary).toContain('result.log')
    expect(tree.warning).toBeUndefined()
  })

  it('degrades to a local-only tree with a warning and producer primary when the remote listing fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    await mkdir(join(root, '11250', 'job-1'), { recursive: true })
    await writeFile(join(root, '11250', 'job-1', 'local.log'), 'x')
    const service = new MatFileServiceImpl({
      localRoot: root,
      transferFor: () => transfer('x'),
      resolveWorkdir: async () => '/public/home/u/job',
    })
    service.listFiles = async () => { throw new Error('find: no such directory') }
    const tree = await service.listWorkspace({
      jobId: 'job-1', clusterId: '11250', workdir: '$HOME/workspace/job', path: '',
      producerFiles: ['/public/home/u/job/result.log'],
    })
    expect(tree.warning).toMatch(/remote listing unavailable/)
    expect(tree.entries).toEqual([expect.objectContaining({ path: 'local.log', origin: 'local', status: 'local-only' })])
    expect(tree.primary).toEqual(['result.log'])
  })

  it('degrades a job without a workdir to the local tree instead of failing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    await mkdir(join(root, '11250', 'job-1'), { recursive: true })
    await writeFile(join(root, '11250', 'job-1', 'local.log'), 'x')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    const tree = await service.listWorkspace({ jobId: 'job-1', clusterId: '11250', workdir: '', path: '' })
    expect(tree.warning).toMatch(/no remote workdir/)
    expect(tree.entries.map((entry: { path: string }) => entry.path)).toEqual(['local.log'])
  })

  it('materializes through a resolved shell-style workdir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const port = transfer('result')
    const service = new MatFileServiceImpl({
      localRoot: root,
      transferFor: () => port,
      resolveWorkdir: async () => '/remote/job',
    })
    const path = await service.materializeFile('job-1', '11250', '$HOME/workspace/job', 'output/result.log')
    expect(path).toBe(join(root, '11250', 'job-1', 'output', 'result.log'))
    expect(port.calls.map(([remote]) => remote)).toEqual(['/remote/job/output/result.log'])
  })

  it('materializes missing files on demand when a download supplies the job context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const port = transfer('result')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => port })
    const artifact = await service.prepareDownload('job-1', ['result.log'], { clusterId: '11250', workdir: '/remote/job' })
    expect(artifact.kind).toBe('file')
    expect(Buffer.from(artifact.body).toString()).toBe('result')
    expect(port.calls.map(([remote]) => remote)).toEqual(['/remote/job/result.log'])
    await expect(service.prepareDownload('job-1', ['other.log'])).rejects.toThrow('file is not synchronized: other.log')
  })

  it('materializes multiple missing files concurrently instead of serially', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const calls: Array<[string, string]> = []
    let inFlight = 0
    let peak = 0
    const port = {
      calls,
      async downloadFile(remotePath: string, localPath: string) {
        calls.push([remotePath, localPath])
        inFlight += 1; peak = Math.max(peak, inFlight)
        await new Promise(resolve => { setTimeout(resolve, 15) })
        const content = `content of ${remotePath}`
        await writeFile(localPath, content)
        inFlight -= 1
        return { success: true as const, path: localPath, bytes: Buffer.byteLength(content) }
      },
    }
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => port })

    const artifact = await service.prepareDownload('job-1', ['a.log', 'b.log', 'c.log', 'd.log'], { clusterId: '11250', workdir: '/remote/job' })

    expect(peak).toBeGreaterThanOrEqual(2) // 串行实现 peak 恒为 1
    expect(artifact.kind).toBe('zip')
    expect(calls.map(([remote]) => remote).sort()).toEqual(['/remote/job/a.log', '/remote/job/b.log', '/remote/job/c.log', '/remote/job/d.log'].sort())
  })

  it('prefetches small primary files in the background after a completed settle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const sizes: Record<string, number> = { '/remote/job/result.json': 1200, '/remote/job/run.log': 3 * 1024 * 1024 }
    const port = {
      calls: [] as Array<[string, string]>,
      async downloadFile(remotePath: string, localPath: string) {
        port.calls.push([remotePath, localPath])
        await writeFile(localPath, 'prefetched')
        return { success: true as const, path: localPath, bytes: 10 }
      },
      async statFile(remotePath: string) {
        if (remotePath === '/remote/job/gone.log') throw new Error('No such file')
        const size = sizes[remotePath]
        if (size === undefined) throw new Error(`unexpected stat: ${remotePath}`)
        return size
      },
    }
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => port })

    const records = await service.handleSettledJob({
      jobId: 'job-1', clusterId: '11250', workdir: '/remote/job', outcomeStatus: 'completed',
      files: ['result.json', 'run.log', 'gone.log'],
    })
    expect(records).toEqual([]) // autoSync 关闭：全量同步不发生，预取走旁路
    await new Promise(resolve => { setTimeout(resolve, 50) }) // 旁路预取是异步的

    expect(port.calls.map(([remote]) => remote)).toEqual(['/remote/job/result.json'])
    expect(await readFile(join(root, '11250', 'job-1', 'result.json'), 'utf8')).toBe('prefetched')

    await service.handleSettledJob({ jobId: 'job-2', clusterId: '11250', workdir: '/remote/job', outcomeStatus: 'failed', files: ['result.json'] })
    await new Promise(resolve => { setTimeout(resolve, 25) })
    expect(port.calls).toHaveLength(1) // 失败结算不预取
  })
})
