import { mkdir, mkdtemp, open as openFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { StatusBoard } from 'mat-core'
import { apply } from '../src/index'

/** 回读校验要求物化路径落在 localWorkspace 内：测试就用 MAT_FILE_ROOT 指向临时根复刻真实布局。 */
function board(localWorkspace: string): StatusBoard {
  return {
    upsert: () => {}, settle: () => {}, remove: () => {},
    list: () => [{ jobId: 'j1', kind: 'mat-slurm', label: 'g', clusterId: '11250', ownerSession: 's1', startedAt: 1, updatedAt: 2, phase: 'settled', workdir: '/remote/job', localWorkspace, outcomeStatus: 'completed', files: ['/remote/job/result.log'] }],
  }
}

function harness(localWorkspace: string, materializeFile: (path: string) => Promise<string>) {
  const routes = new Map<string, any>()
  const calls: unknown[][] = []
  const ctx = {
    webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
    get: (key: string) => key === 'mat.status' ? board(localWorkspace) : key === 'mat.files' ? {
      materializeFile: async (...args: unknown[]) => { calls.push(args); return materializeFile(String(args[3])) },
    } : undefined,
  } as unknown as Context
  apply(ctx)
  const response = () => ({
    statusCode: 200, headers: new Map<string, string>(), chunks: [] as Buffer[],
    setHeader(k: string, v: string) { this.headers.set(k, v) },
    write(v: Buffer) { this.chunks.push(v) },
    end(v?: Buffer) { if (v !== undefined) this.chunks.push(v) },
  })
  const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = response()
    await routes.get('/mat-files/content').handler({ method: 'GET', url, headers }, res)
    return res
  }
  return { calls, get, routes }
}

describe('mat-files content route', () => {
  let root: string
  let workspace: string
  let previousFileRoot: string | undefined

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mat-view-'))
    workspace = join(root, '11250', 'j1')
    await mkdir(workspace, { recursive: true })
    previousFileRoot = process.env.MAT_FILE_ROOT
    process.env.MAT_FILE_ROOT = root
  })

  afterEach(async () => {
    if (previousFileRoot === undefined) delete process.env.MAT_FILE_ROOT
    else process.env.MAT_FILE_ROOT = previousFileRoot
    await rm(root, { recursive: true, force: true })
  })

  it('materializes and serves a previewable image with typed safety headers', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    await mkdir(join(workspace, 'shots'), { recursive: true })
    await writeFile(join(workspace, 'shots', 'shot.png'), bytes)
    const { calls, get } = harness(workspace, async path => join(workspace, path))
    const res = await get('/mat-files/content?jobId=j1&path=shots%2Fshot.png')
    expect(res.statusCode).toBe(200)
    expect(Buffer.concat(res.chunks)).toEqual(bytes)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).not.toContain('text/html')
    expect(calls).toEqual([['j1', '11250', '/remote/job', 'shots/shot.png']])
  })

  it('serves text and structure files (including extension-less POSCAR) as utf-8 text', async () => {
    await writeFile(join(workspace, 'result.json'), 'a=1\n')
    await writeFile(join(workspace, 'POSCAR'), 'Si\n1.0\n5.43 0 0\n0 5.43 0\n0 0 5.43\nSi\n1\nDirect\n0 0 0\n')
    const { get } = harness(workspace, async path => join(workspace, path))
    const text = await get('/mat-files/content?jobId=j1&path=result.json')
    expect(text.statusCode).toBe(200)
    expect(text.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(Buffer.concat(text.chunks).toString('utf8')).toBe('a=1\n')
    const structure = await get('/mat-files/content?jobId=j1&path=POSCAR')
    expect(structure.statusCode).toBe(200)
    expect(structure.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })

  it('rejects non-previewable types with 415 before touching the workspace', async () => {
    const { calls, get } = harness(workspace, async () => { throw new Error('must not materialize') })
    const res = await get('/mat-files/content?jobId=j1&path=tool.exe')
    expect(res.statusCode).toBe(415)
    expect(JSON.parse(res.chunks[0]!.toString('utf8')).error.code).toBe('unsupported-type')
    expect(calls).toEqual([])
  })

  it('rejects traversal and absolute paths with 400', async () => {
    const { get } = harness(workspace, async () => { throw new Error('must not materialize') })
    const dotdot = await get('/mat-files/content?jobId=j1&path=..%2Fsecret')
    expect(dotdot.statusCode).toBe(400)
    expect(JSON.parse(dotdot.chunks[0]!.toString('utf8')).error.code).toBe('invalid-path')
    const absolute = await get('/mat-files/content?jobId=j1&path=%2Fetc%2Fpasswd')
    expect(absolute.statusCode).toBe(400)
    expect(JSON.parse(absolute.chunks[0]!.toString('utf8')).error.code).toBe('invalid-path')
  })

  it('rejects unknown jobs with 404 and non-GET methods with 405', async () => {
    const { routes } = harness(workspace, async () => { throw new Error('must not materialize') })
    const res = { statusCode: 200, headers: new Map<string, string>(), chunks: [] as Buffer[], setHeader(k: string, v: string) { this.headers.set(k, v) }, write(v: Buffer) { this.chunks.push(v) }, end(v?: Buffer) { if (v !== undefined) this.chunks.push(v) } }
    await routes.get('/mat-files/content').handler({ method: 'GET', url: '/mat-files/content?jobId=ghost&path=a.log', headers: {} }, res)
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.chunks[0]!.toString('utf8')).error.code).toBe('unknown-job')
    await routes.get('/mat-files/content').handler({ method: 'POST', url: '/mat-files/content', headers: {} }, res)
    expect(res.statusCode).toBe(405)
  })

  it('refuses files above the 64MB preview limit with 413', async () => {
    const big = join(workspace, 'huge.log')
    const handle = await openFile(big, 'w')
    await handle.truncate(64 * 1024 * 1024 + 1)
    await handle.close()
    const { get } = harness(workspace, async path => join(workspace, path))
    const res = await get('/mat-files/content?jobId=j1&path=huge.log')
    expect(res.statusCode).toBe(413)
    expect(JSON.parse(res.chunks[0]!.toString('utf8')).error.code).toBe('content-limit')
  })

  it('fails closed when the materialized path escapes the workspace', async () => {
    const { get } = harness(workspace, async () => '/somewhere/else/shot.png')
    const res = await get('/mat-files/content?jobId=j1&path=shot.png')
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.chunks[0]!.toString('utf8')).error.code).toBe('content-failed')
  })
})

describe('mat vendor ngl route', () => {
  it('serves the vendored bundle with an etag and answers conditional requests', async () => {
    const routes = new Map<string, any>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board('/local/11250/j1') : undefined,
    } as unknown as Context
    apply(ctx)
    const response = () => ({
      statusCode: 200, headers: new Map<string, string>(), chunks: [] as Buffer[],
      setHeader(k: string, v: string) { this.headers.set(k, v) },
      write(v: Buffer) { this.chunks.push(v) },
      end(v?: Buffer) { if (v !== undefined) this.chunks.push(v) },
    })
    const first = response()
    await routes.get('/mat-vendor/ngl.js').handler({ method: 'GET', url: '/mat-vendor/ngl.js', headers: {} }, first)
    expect(first.statusCode).toBe(200)
    expect(first.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(first.headers.get('etag')).toMatch(/^"\d+-\d+"$/)
    const body = Buffer.concat(first.chunks)
    expect(body.length).toBeGreaterThan(1_000_000)
    expect(body.slice(0, 8).toString('utf8')).not.toContain('<')

    const revalidated = response()
    await routes.get('/mat-vendor/ngl.js').handler({ method: 'GET', url: '/mat-vendor/ngl.js', headers: { 'if-none-match': first.headers.get('etag')! } }, revalidated)
    expect(revalidated.statusCode).toBe(304)
    expect(revalidated.chunks).toEqual([])

    const stale = response()
    await routes.get('/mat-vendor/ngl.js').handler({ method: 'GET', url: '/mat-vendor/ngl.js', headers: { 'if-none-match': '"stale-1"' } }, stale)
    expect(stale.statusCode).toBe(200)
  })
})
