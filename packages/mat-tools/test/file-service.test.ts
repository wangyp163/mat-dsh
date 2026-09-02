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
})
