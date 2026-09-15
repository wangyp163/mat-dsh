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

  it('deletes only the requested local copies, reports unsynced entries missing, and prunes dead pins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    const jobRoot = join(root, '11250', '123')
    await mkdir(join(jobRoot, 'opt'), { recursive: true })
    await writeFile(join(jobRoot, 'result.json'), '{}')
    await writeFile(join(jobRoot, 'opt', 'a.log'), 'a')
    await writeFile(join(jobRoot, 'kept.log'), 'kept')
    await service.setPreferences('11250:123', { autoSync: false, pins: ['opt/a.log', 'kept.log'] })

    const result = await service.deleteLocalFiles({
      jobId: '11250:123', clusterId: '11250', workdir: '/remote/job', localWorkspace: jobRoot,
      paths: ['opt', 'result.json', 'never-synced.log'],
    })
    expect(result.deleted.sort()).toEqual(['opt', 'result.json'])
    expect(result.missing).toEqual(['never-synced.log'])
    await expect(readFile(join(jobRoot, 'kept.log'), 'utf8')).resolves.toBe('kept')
    await expect(readFile(join(jobRoot, 'opt', 'a.log'))).rejects.toMatchObject({ code: 'ENOENT' })
    // 指向已删目录的 pin 一并被清理，存活文件的 pin 保留。
    expect(await service.getPreferences('11250:123')).toEqual({ autoSync: false, pins: ['kept.log'] })

    // 身份绑定：localWorkspace 指向别处（哪怕同 cluster 的其它作业目录）必须拒绝。
    await expect(service.deleteLocalFiles({
      jobId: '11250:123', clusterId: '11250', workdir: '/remote/job', localWorkspace: join(root, '11250', '999'),
      paths: ['kept.log'],
    })).rejects.toThrow(/identity/)
    // 越界路径拒绝。
    await expect(service.deleteLocalFiles({
      jobId: '11250:123', clusterId: '11250', localWorkspace: jobRoot, paths: ['../escape'],
    })).rejects.toThrow('unsafe workspace path')
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

describe('板键作业（cluster:slurm）的文件链路', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs.length = 0 })

  it('lists the real slurm workspace for a board-key job id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    await mkdir(join(root, '11250', '120763977'), { recursive: true })
    await writeFile(join(root, '11250', '120763977', 'local.log'), 'x')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    // 显式 localWorkspace（板上持久化的真实目录）：
    const tree = await service.listWorkspace({
      jobId: '11250:120763977', clusterId: '11250', workdir: '', path: '',
      localWorkspace: join(root, '11250', '120763977'),
    })
    expect(tree.entries.map((entry: { path: string }) => entry.path)).toEqual(['local.log'])
    // 未带 localWorkspace 时按板键段名（真实作业号）兜底，不拼 `:` 目录：
    const fallback = await service.listWorkspace({ jobId: '11250:120763977', clusterId: '11250', workdir: '', path: '' })
    expect(fallback.entries.map((entry: { path: string }) => entry.path)).toEqual(['local.log'])
  })

  it('still rejects identity escapes under board-key ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    // 越出 cluster 根：
    await expect(service.listWorkspace({
      jobId: '11250:120763977', clusterId: '11250', workdir: '', path: '',
      localWorkspace: join(root, '11251', '120763977'),
    })).rejects.toThrow('workspace identity')
    // cluster 根下多层嵌套（伪装成子目录）：
    await expect(service.listWorkspace({
      jobId: '11250:120763977', clusterId: '11250', workdir: '', path: '',
      localWorkspace: join(root, '11250', '120763977', 'sub'),
    })).rejects.toThrow('workspace identity')
    // 板键外的非法字符仍拒绝：
    await expect(service.listWorkspace({ jobId: 'bad key', clusterId: '11250', workdir: '', path: '' }))
      .rejects.toThrow('unsafe workspace identity')
    // 段名伪装（`..`）不得借白名单里的 `.` 通过：
    await expect(service.listWorkspace({ jobId: '11250:..', clusterId: '11250', workdir: '', path: '' }))
      .rejects.toThrow('unsafe workspace identity')
  })

  it('materializes and downloads board-key jobs into the real slurm workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const port = transfer('result')
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => port })
    const path = await service.materializeFile('11250:120763977', '11250', '/remote/job', 'output/result.log')
    expect(path).toBe(join(root, '11250', '120763977', 'output', 'result.log'))
    // 下载路由按板键对账同步记录，文件名不再携带 `:`：
    const artifact = await service.prepareDownload('11250:120763977', ['output/result.log'])
    expect(artifact).toMatchObject({ kind: 'file', filename: 'result.log' })
    const missing = await service.prepareDownload('11250:120763977', ['other.log'], { clusterId: '11250', workdir: '/remote/job' })
    expect(missing).toMatchObject({ kind: 'file', filename: 'other.log' })
  })
})

describe('MatFileServiceImpl 会话工作区（无作业回退）', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs.length = 0 })

  it('listSessionWorkspace：本地-only 树（root 绝对路径回传），路径穿越拒绝', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mat-session-ws-')); dirs.push(workspace)
    await writeFile(join(workspace, 'mol.gjf'), 'input')
    await mkdir(join(workspace, 'plots'))
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    const tree = await service.listSessionWorkspace({ cwd: workspace, path: '' })
    expect(tree.root).toBe(workspace)
    expect(tree.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'mol.gjf', directory: false, regularFile: true }),
      expect.objectContaining({ path: 'plots', directory: true }),
    ]))
    const sub = await service.listSessionWorkspace({ cwd: workspace, path: 'plots' })
    expect(sub.entries).toEqual([])
    await expect(service.listSessionWorkspace({ cwd: workspace, path: '../escape' })).rejects.toThrow('unsafe')
    await expect(service.listSessionWorkspace({ cwd: workspace, path: '/abs' })).rejects.toThrow('unsafe')
  })

  it('prepareLocalDownload：直接打包会话工作区文件（不经同步记录）', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mat-session-ws-')); dirs.push(workspace)
    await writeFile(join(workspace, 'mol.gjf'), 'input')
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    const artifact = await service.prepareLocalDownload(workspace, ['mol.gjf'])
    expect(artifact).toMatchObject({ kind: 'file', filename: 'mol.gjf' })
    expect(Buffer.from(artifact.body).toString()).toBe('input')
    await expect(service.prepareLocalDownload(workspace, ['../escape'])).rejects.toThrow('unsafe')
  })
})

describe('MatFileServiceImpl.deleteSessionFiles（工作区自由删除）', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs.length = 0 })

  it('按 cwd 根删除安全相对路径；穿越拒绝；不存在的报 missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mat-ws-')); dirs.push(workspace)
    await writeFile(join(workspace, 'mol.gjf'), 'x')
    await mkdir(join(workspace, 'plots'))
    await writeFile(join(workspace, 'plots', 'a.csv'), 'x')
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    const result = await service.deleteSessionFiles({ cwd: workspace, paths: ['mol.gjf', 'plots', 'ghost.log'] })
    expect(result).toEqual({ deleted: ['mol.gjf', 'plots'], missing: ['ghost.log'] })
    await expect(service.deleteSessionFiles({ cwd: workspace, paths: ['../escape'] })).rejects.toThrow('unsafe')
    await expect(service.deleteSessionFiles({ cwd: workspace, paths: ['/abs'] })).rejects.toThrow('unsafe')
  })
})

describe('MatFileServiceImpl.listLocalPeers（同后缀本地清单）', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))); dirs.length = 0 })

  it('递归收集同后缀（大小写不敏感）已同步文件，返回排序清单与当前项索引；无后缀按同名组', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'mat-ws-')); dirs.push(workspace)
    await mkdir(join(workspace, 'plots'), { recursive: true })
    for (const name of ['b.log', 'a.log', 'c.LOG', 'skip.txt']) await writeFile(join(workspace, name), 'x')
    await writeFile(join(workspace, 'plots', 'd.log'), 'x')
    await writeFile(join(workspace, 'noext'), 'x')
    const root = await mkdtemp(join(tmpdir(), 'mat-files-')); dirs.push(root)
    const service = new MatFileServiceImpl({ localRoot: root, transferFor: () => transfer('x') })
    expect(await service.listLocalPeers(workspace, 'b.log')).toEqual({
      peers: ['a.log', 'b.log', 'c.LOG', 'plots/d.log'], index: 1,
    })
    expect(await service.listLocalPeers(workspace, 'noext')).toEqual({ peers: ['noext'], index: 0 })
    // 当前项不在清单（已删/不存在）→ 退化为单元素组
    expect(await service.listLocalPeers(workspace, 'ghost.log')).toEqual({ peers: ['ghost.log'], index: 0 })
    await expect(service.listLocalPeers(workspace, '../escape')).rejects.toThrow('unsafe')
  })
})
