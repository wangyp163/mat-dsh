import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { StatusBoard } from 'mat-core'
import { apply } from '../src/index'

function board(): StatusBoard {
  return {
    upsert: () => {}, settle: () => {}, remove: () => {},
    list: () => [{ jobId: 'j1', kind: 'mat-slurm', label: 'g', clusterId: '11250', ownerSession: 's1', startedAt: 1, updatedAt: 2, phase: 'settled', workdir: '/remote/job', localWorkspace: '/local/11250/j1', outcomeStatus: 'completed', files: ['/remote/job/result.log'] }],
  }
}

describe('mat file routes', () => {
  it('exposes capability-safe config and status-board jobs', async () => {
    const routes = new Map<string, any>()
    const ctx = { webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } }, get: (key: string) => key === 'mat.status' ? board() : undefined } as unknown as Context
    apply(ctx)
    const response = { headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    await routes.get('/mat-files/config').handler({ headers: { host: '127.0.0.1:3030' } }, response)
    expect(JSON.parse(response.body)).toMatchObject({ localRootConfigured: false, efile: { available: Boolean(process.env.MAT_ACCESS_KEY && process.env.MAT_SECRET_KEY && process.env.MAT_USER) } })
    await routes.get('/mat-files/jobs').handler({}, response)
    expect(JSON.parse(response.body).jobs[0]).toMatchObject({
      jobId: 'j1', workdir: '/remote/job', localWorkspace: '/local/11250/j1',
    })
  })

  it('lists only paths below the known job workdir through the server-side file service', async () => {
    const routes = new Map<string, any>()
    const calls: unknown[][] = []
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listFiles: async (...args: unknown[]) => { calls.push(args); return { path: '/remote/job', total: 1, entries: [{ name: 'result.log', path: '/remote/job/result.log', size: 12, directory: false, regularFile: true, symbolicLink: false, readable: true }] } },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    await routes.get('/mat-files/list').handler({ url: '/mat-files/list?jobId=j1&path=%2Fremote%2Fjob&limit=20' }, response)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).entries[0].name).toBe('result.log')
    expect(calls).toEqual([['11250', '/remote/job', { start: 0, limit: 20, order: 'asc', orderBy: 'name', keyword: undefined }]])

    await routes.get('/mat-files/list').handler({ url: '/mat-files/list?jobId=j1&path=%2Fetc' }, response)
    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body).error.code).toBe('invalid-path')
  })

  it('starts and reports a validated local sync without accepting browser-supplied cluster/workdir', async () => {
    const routes = new Map<string, any>()
    const calls: unknown[][] = []
    const sync = { syncId: 'sync-1', id: 'j1', workdir: '/remote/job', remotePath: '/remote/job/result.log', status: 'completed', localPath: '/local/j1/result.log', bytes: 12 }
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listFiles: async () => ({ path: '/remote/job', total: 0, entries: [] }),
        syncFile: async (...args: unknown[]) => { calls.push(args); return sync },
        listSyncs: () => [sync],
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const req = {
      method: 'POST', url: '/mat-files/sync',
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ jobId: 'j1', paths: ['/remote/job/result.log'] })) },
    }
    await routes.get('/mat-files/sync').handler(req, response)
    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body).syncs[0]).toMatchObject({ syncId: 'sync-1', status: 'completed' })
    expect(calls).toEqual([['j1', '11250', '/remote/job', '/remote/job/result.log', 'keep-both']])

    response.body = ''
    await routes.get('/mat-files/sync').handler({ method: 'GET', url: '/mat-files/sync' }, response)
    expect(JSON.parse(response.body).syncs).toHaveLength(1)
  })

  it('persists and returns an explicit per-job auto-sync preference', async () => {
    const routes = new Map<string, any>()
    const preferences = new Map<string, { autoSync: boolean }>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listFiles: async () => ({ path: '/remote/job', total: 0, entries: [] }),
        getPreferences: async (jobId: string) => preferences.get(jobId) ?? { autoSync: false },
        setPreferences: async (jobId: string, value: { autoSync: boolean }) => { preferences.set(jobId, value) },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const req = { method: 'PUT', url: '/mat-files/preferences', async *[Symbol.asyncIterator]() { yield Buffer.from('{"jobId":"j1","autoSync":true}') } }
    await routes.get('/mat-files/preferences').handler(req, response)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ jobId: 'j1', autoSync: true })
    response.body = ''
    await routes.get('/mat-files/preferences').handler({ method: 'GET', url: '/mat-files/preferences?jobId=j1' }, response)
    expect(JSON.parse(response.body)).toEqual({ jobId: 'j1', autoSync: true })
  })

  it('allows a persisted shell-style workdir at its root', async () => {
    const routes = new Map<string, any>()
    const calls: unknown[][] = []
    const persistedBoard: StatusBoard = {
      ...board(),
      list: () => [{ ...board().list()[0], workdir: '$HOME/workspace/job' }],
    }
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? persistedBoard : key === 'mat.files' ? {
        listFiles: async (...args: unknown[]) => { calls.push(args); return { path: '$HOME/workspace/job', total: 0, entries: [] } },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    await routes.get('/mat-files/list').handler({ url: '/mat-files/list?jobId=j1&path=%24HOME%2Fworkspace%2Fjob' }, response)
    expect(response.statusCode).toBe(200)
    expect(calls[0]?.[1]).toBe('$HOME/workspace/job')
  })

  it('rejects a list request for an unknown job before contacting efile', async () => {
    const routes = new Map<string, any>()
    const ctx = { webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } }, get: (key: string) => key === 'mat.status' ? board() : undefined } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    await routes.get('/mat-files/list').handler({ url: '/mat-files/list?jobId=ghost&path=%2Fremote%2Fjob' }, response)
    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body).error.code).toBe('unknown-job')
  })

  it('returns one reconciled local/remote tree and accepts durable pins', async () => {
    const routes = new Map<string, any>()
    const workspaceCalls: unknown[] = []
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listWorkspace: async (request: unknown) => { workspaceCalls.push(request); return { path: '', entries: [{ path: 'result.log', name: 'result.log', directory: false, origin: 'both', status: 'synchronized' }], primary: ['result.log'] } },
        getPreferences: async () => ({ autoSync: false, pins: [], exclusions: [] }),
        setPreferences: async (_jobId: string, value: unknown) => { calls.push(value) },
      } : undefined,
    } as unknown as Context
    const calls: unknown[] = []
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    await routes.get('/mat-files/tree').handler({ url: '/mat-files/tree?jobId=j1&path=' }, response)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).entries[0]).toMatchObject({ path: 'result.log', status: 'synchronized' })
    expect(workspaceCalls).toEqual([expect.objectContaining({ localWorkspace: '/local/11250/j1' })])
    const req = { method: 'PUT', url: '/mat-files/preferences', async *[Symbol.asyncIterator]() { yield Buffer.from('{"jobId":"j1","pins":["result.log"],"exclusions":[]}') } }
    await routes.get('/mat-files/preferences').handler(req, response)
    expect(response.statusCode).toBe(200)
    expect(calls).toEqual([{ autoSync: false, pins: ['result.log'], exclusions: [] }])
  })

  it('materializes a safe job-relative file before the client opens it', async () => {
    const routes = new Map<string, any>()
    const calls: unknown[][] = []
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        materializeFile: async (...args: unknown[]) => { calls.push(args); return '/local/11250/j1/result.log' },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const req = { method: 'POST', url: '/mat-files/open', async *[Symbol.asyncIterator]() { yield Buffer.from('{"jobId":"j1","path":"result.log"}') } }
    await routes.get('/mat-files/open').handler(req, response)
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ path: '/local/11250/j1/result.log' })
    expect(calls).toEqual([['j1', '11250', '/remote/job', 'result.log']])
  })

  it('returns safe attachment downloads and rejects traversal or excessive selections', async () => {
    const routes = new Map<string, any>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        prepareDownload: async (_jobId: string, paths: string[]) => ({ kind: paths.length === 1 ? 'file' : 'zip', filename: 'download.bin', body: Buffer.from('ok') }),
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), chunks: [] as Buffer[], setHeader(k: string, v: string) { this.headers.set(k, v) }, write(v: Buffer) { this.chunks.push(v) }, end(v?: Buffer) { if (v !== undefined) this.chunks.push(v) } }
    const req = { method: 'POST', url: '/mat-files/download', async *[Symbol.asyncIterator]() { yield Buffer.from('{"jobId":"j1","paths":["result.log"]}') } }
    await routes.get('/mat-files/download').handler(req, response)
    expect(response.statusCode).toBe(200)
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const unsafe = { method: 'POST', url: '/mat-files/download', async *[Symbol.asyncIterator]() { yield Buffer.from('{"jobId":"j1","paths":["../secret"]}') } }
    await routes.get('/mat-files/download').handler(unsafe, response)
    expect(response.statusCode).toBe(400)
    const tooMany = { method: 'POST', url: '/mat-files/download', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ jobId: 'j1', paths: Array.from({ length: 101 }, (_, i) => `f-${i}`) })) } }
    await routes.get('/mat-files/download').handler(tooMany, response)
    expect(response.statusCode).toBe(413)
  })

  it('supplies the job context so remote-only selections download on demand', async () => {
    const routes = new Map<string, any>()
    const calls: unknown[][] = []
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        prepareDownload: async (...args: unknown[]) => { calls.push(args); return { kind: 'file' as const, filename: 'result.log', body: Buffer.from('ok') } },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), chunks: [] as Buffer[], setHeader(k: string, v: string) { this.headers.set(k, v) }, write(v: Buffer) { this.chunks.push(v) }, end(v?: Buffer) { if (v !== undefined) this.chunks.push(v) } }
    const req = { method: 'POST', url: '/mat-files/download', async *[Symbol.asyncIterator]() { yield Buffer.from('{"jobId":"j1","paths":["result.log"]}') } }
    await routes.get('/mat-files/download').handler(req, response)
    expect(response.statusCode).toBe(200)
    expect(calls).toEqual([['j1', ['result.log'], { clusterId: '11250', workdir: '/remote/job' }]])
  })
})

describe('mat file routes — session workspace mode（无作业回退）', () => {
  it('tree：session 参数从 projcache 解析 cwd（客户端不可传路径），未知会话 404', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = await mkdtemp(join(tmpdir(), 'mat-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'mat-ws-'))
    await writeFile(join(workspace, 'pre.json'), '{}')
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
      unit: { name: 'session_projcache', version: 3 }, global: null,
      tables: { sessions: { 'session-s1': { identity: { createdAt: 1, cwd: workspace } } } },
    }))
    const calls: unknown[][] = []
    const routes = new Map<string, any>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listSessionWorkspace: async (...args: unknown[]) => { calls.push(args); return { root: workspace, path: '', entries: [{ path: 'pre.json', name: 'pre.json', directory: false, regularFile: true, symbolicLink: false, readable: true, size: 2 }], primary: [], sessionFiles: { 'session-s1': ['pre.json'] } } },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await routes.get('/mat-files/tree').handler({ url: '/mat-files/tree?session=session-s1&path=' }, response)
      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toMatchObject({ root: workspace, preferences: { autoSync: false } })
      // 会话文件归档（按会话分档）：根列表透传 sessionFiles 供面板挂会话分组。
      expect(JSON.parse(response.body).sessionFiles).toEqual({ 'session-s1': ['pre.json'] })
      expect(calls[0]![0]).toMatchObject({ cwd: workspace, path: '' })

      response.statusCode = 200; response.body = ''
      await routes.get('/mat-files/tree').handler({ url: '/mat-files/tree?session=session-nope&path=' }, response)
      expect(response.statusCode).toBe(404)
      expect(JSON.parse(response.body).error.code).toBe('unknown-session')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
      await Promise.all([rm(home, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
    }
  })

  it('content：session 模式直接读 cwd 下白名单文件，穿越拒绝', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = await mkdtemp(join(tmpdir(), 'mat-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'mat-ws-'))
    await writeFile(join(workspace, 'mol.gjf'), '%chk=mol')
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
      unit: { name: 'session_projcache', version: 3 }, global: null,
      tables: { sessions: { 'session-s1': { identity: { createdAt: 1, cwd: workspace } } } },
    }))
    const routes = new Map<string, any>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await routes.get('/mat-files/content').handler({ method: 'GET', url: '/mat-files/content?session=session-s1&path=mol.gjf' }, response)
      expect(response.statusCode).toBe(200)
      expect(String(response.body)).toBe('%chk=mol')

      response.statusCode = 200; response.body = ''
      await routes.get('/mat-files/content').handler({ method: 'GET', url: '/mat-files/content?session=session-s1&path=..%2Fsecret' }, response)
      expect(response.statusCode).toBe(400)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
      await Promise.all([rm(home, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
    }
  })
})

describe('mat file routes — workspace sessions（按 cwd 反查会话清单）', () => {
  it('返回同 cwd 下的会话（标题可选，createdAt 倒序），其它 cwd 的会话排除', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = await mkdtemp(join(tmpdir(), 'mat-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'mat-ws-'))
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
      unit: { name: 'session_projcache', version: 3 }, global: null,
      tables: { sessions: {
        'session-a': { identity: { createdAt: 2, cwd: workspace }, rows: { title: { val: '水分子的结构优化' } } },
        'session-b': { identity: { createdAt: 9, cwd: workspace } },
        'session-c': { identity: { createdAt: 5, cwd: '/somewhere/else' } },
      } },
    }))
    const routes = new Map<string, any>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await routes.get('/mat-files/workspace-sessions').handler({ url: '/mat-files/workspace-sessions?session=session-a' }, response)
      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toMatchObject({ root: workspace, sessions: [
        { sessionId: 'session-b' },
        { sessionId: 'session-a', title: '水分子的结构优化' },
      ] })

      response.statusCode = 200; response.body = ''
      await routes.get('/mat-files/workspace-sessions').handler({ url: '/mat-files/workspace-sessions?session=session-nope' }, response)
      expect(response.statusCode).toBe(404)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
      await Promise.all([rm(home, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
    }
  })
})

describe('mat file routes — delete session 模式（工作区自由删除）', () => {
  it('session 体走 cwd 根删除；未知会话 404；穿越 400', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = await mkdtemp(join(tmpdir(), 'mat-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'mat-ws-'))
    await writeFile(join(workspace, 'mol.gjf'), 'x')
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
      unit: { name: 'session_projcache', version: 3 }, global: null,
      tables: { sessions: { 'session-s1': { identity: { createdAt: 1, cwd: workspace } } } },
    }))
    const calls: unknown[][] = []
    const routes = new Map<string, any>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        deleteSessionFiles: async (...args: unknown[]) => { calls.push(args); return { deleted: ['mol.gjf'], missing: [] } },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const post = (payload: unknown) => ({
      method: 'POST', url: '/mat-files/delete',
      on: () => {}, [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(payload)) })() },
    } as never)
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await routes.get('/mat-files/delete').handler(post({ session: 'session-s1', paths: ['mol.gjf'] }), response)
      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ deleted: ['mol.gjf'], missing: [] })
      expect(calls[0]![0]).toMatchObject({ cwd: workspace, paths: ['mol.gjf'] })

      response.statusCode = 200; response.body = ''
      await routes.get('/mat-files/delete').handler(post({ session: 'session-s1', paths: ['../escape'] }), response)
      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.body).error.code).toBe('invalid-path')

      response.statusCode = 200; response.body = ''
      await routes.get('/mat-files/delete').handler(post({ session: 'session-nope', paths: ['a'] }), response)
      expect(response.statusCode).toBe(404)
      expect(JSON.parse(response.body).error.code).toBe('unknown-session')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
      await Promise.all([rm(home, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
    }
  })
})

describe('mat file routes — peers（同后缀导航清单）', () => {
  it('job 模式以 localWorkspace 为根、session 模式以 cwd 为根；未知身份 404', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = await mkdtemp(join(tmpdir(), 'mat-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'mat-ws-'))
    await writeFile(join(workspace, 'a.log'), 'x')
    await mkdir(join(home, 'storages'), { recursive: true })
    await writeFile(join(home, 'storages', 'session_projcache.json'), JSON.stringify({
      unit: { name: 'session_projcache', version: 3 }, global: null,
      tables: { sessions: { 'session-s1': { identity: { createdAt: 1, cwd: workspace } } } },
    }))
    const calls: unknown[][] = []
    const routes = new Map<string, any>()
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listLocalPeers: async (...args: unknown[]) => { calls.push(args); return { peers: ['a.log', 'b.log'], index: 1 } },
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await routes.get('/mat-files/peers').handler({ url: '/mat-files/peers?jobId=j1&path=b.log' }, response)
      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ peers: ['a.log', 'b.log'], index: 1 })
      expect(calls[0]![0]).toBe('/local/11250/j1')

      response.statusCode = 200; response.body = ''
      await routes.get('/mat-files/peers').handler({ url: '/mat-files/peers?session=session-s1&path=a.log' }, response)
      expect(response.statusCode).toBe(200)
      expect(calls[1]![0]).toBe(workspace)

      response.statusCode = 200; response.body = ''
      await routes.get('/mat-files/peers').handler({ url: '/mat-files/peers?session=session-nope&path=a.log' }, response)
      expect(response.statusCode).toBe(404)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
      await Promise.all([rm(home, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })])
    }
  })
})

describe('mat file routes — sync 接受相对路径（UI 同步到本地入口）', () => {
  it('相对路径按 job.workdir 拼绝对；绝对路径仍走原校验；工作区 scope 无远端不适用', async () => {
    const calls: unknown[][] = []
    const routes = new Map<string, any>()
    const sync = { syncId: 's1', id: 'j1', workdir: '/remote/job', remotePath: '/remote/job/result.log', status: 'completed', localPath: '/local/11250/j1/result.log', bytes: 3 }
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listFiles: async () => ({ path: '/remote/job', total: 0, entries: [] }),
        syncFile: async (...args: unknown[]) => { calls.push(args); return sync },
        listSyncs: () => [sync],
      } : undefined,
    } as unknown as Context
    apply(ctx)
    const response = { statusCode: 200, headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const post = (payload: unknown) => ({
      method: 'POST', url: '/mat-files/sync',
      on: () => {}, [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(payload)) })() },
    } as never)

    await routes.get('/mat-files/sync').handler(post({ jobId: 'j1', paths: ['result.log', 'opt/freq.log'] }), response)
    expect(response.statusCode).toBe(202)
    expect(calls.map(args => args[3])).toEqual(['/remote/job/result.log', '/remote/job/opt/freq.log'])

    calls.length = 0
    response.statusCode = 200
    await routes.get('/mat-files/sync').handler(post({ jobId: 'j1', paths: ['/remote/job/result.log'] }), response)
    expect(response.statusCode).toBe(202)
    expect(calls[0]![3]).toBe('/remote/job/result.log')

    response.statusCode = 200
    await routes.get('/mat-files/sync').handler(post({ jobId: 'j1', paths: ['../escape.log'] }), response)
    expect(response.statusCode).toBe(400)
  })
})
