import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkdirResolver } from '../src/workdir-resolver'

describe('createWorkdirResolver', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mat-resolver-'))
    dirs.push(dir)
    return dir
  }

  it('prefers producer-path derivation and never touches the remote', async () => {
    const calls: string[] = []
    const resolver = createWorkdirResolver({
      execHome: async (clusterId) => { calls.push(clusterId); return '/public/home/agent' },
    })

    await expect(resolver.resolve('11250', '$HOME/workspace/h2o', ['/public/home/hpc-user-a/workspace/h2o/result.json']))
      .resolves.toBe('/public/home/hpc-user-a/workspace/h2o')
    expect(calls).toEqual([])
    await expect(resolver.resolve('11250', '/already/absolute')).resolves.toBe('/already/absolute')
    expect(calls).toEqual([])
  })

  it('caches the exec result on disk so a fresh instance skips the remote entirely', async () => {
    const dir = await tempDir()
    const cachePath = join(dir, 'remote-homes.json')
    let execs = 0
    const first = createWorkdirResolver({
      cachePath,
      execHome: async () => { execs += 1; return '/public/home/hpc-user-a' },
    })
    await expect(first.resolve('11250', '$HOME/h2o')).resolves.toBe('/public/home/hpc-user-a/h2o')
    expect(execs).toBe(1)
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({ '11250': '/public/home/hpc-user-a' })

    const second = createWorkdirResolver({
      cachePath,
      execHome: async () => { execs += 1; return '/should-not-run' },
    })
    await expect(second.resolve('11250', '$HOME/h2o')).resolves.toBe('/public/home/hpc-user-a/h2o')
    expect(execs).toBe(1)
  })

  it('rejects empty homes, retries on the next call, and falls back to the raw workdir on failure', async () => {
    const dir = await tempDir()
    const cachePath = join(dir, 'remote-homes.json')
    let execs = 0
    const resolver = createWorkdirResolver({
      cachePath,
      execHome: async () => {
        execs += 1
        if (execs === 1) return ''
        if (execs === 2) throw new Error('cluster unreachable')
        return '/public/home/agent'
      },
    })

    await expect(resolver.resolve('11250', '$HOME/h2o')).resolves.toBe('$HOME/h2o')
    await expect(resolver.resolve('11250', '$HOME/h2o')).resolves.toBe('$HOME/h2o')
    await expect(resolver.resolve('11250', '$HOME/h2o')).resolves.toBe('/public/home/agent/h2o')
    expect(execs).toBe(3)
    await expect(readFile(cachePath, 'utf8')).resolves.toContain('/public/home/agent')
  })

  it('exposes the raw home for callers that expand paths themselves', async () => {
    const resolver = createWorkdirResolver({ execHome: async () => '/public/home/hpc-user-a' })
    await expect(resolver.home('11250')).resolves.toBe('/public/home/hpc-user-a')
    await expect(resolver.home('11250')).resolves.toBe('/public/home/hpc-user-a')
  })
})
