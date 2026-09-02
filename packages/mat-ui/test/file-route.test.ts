import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { StatusBoard } from 'mat-core'
import { apply } from '../src/index'

function board(): StatusBoard {
  return {
    upsert: () => {}, settle: () => {}, remove: () => {},
    list: () => [{ jobId: 'j1', kind: 'mat-slurm', label: 'g', clusterId: '11250', ownerSession: 's1', startedAt: 1, updatedAt: 2, phase: 'settled', workdir: '/remote/job', outcomeStatus: 'completed', files: ['/remote/job/result.log'] }],
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
    expect(JSON.parse(response.body).jobs[0]).toMatchObject({ jobId: 'j1', workdir: '/remote/job' })
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
    const ctx = {
      webServer: { register: (route: any) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? board() : key === 'mat.files' ? {
        listWorkspace: async () => ({ path: '', entries: [{ path: 'result.log', name: 'result.log', directory: false, origin: 'both', status: 'synchronized' }], primary: ['result.log'] }),
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
    const req = { method: 'PUT', url: '/mat-files/preferences', async *[Symbol.asyncIterator]() { yield Buffer.from('{"jobId":"j1","pins":["result.log"],"exclusions":[]}') } }
    await routes.get('/mat-files/preferences').handler(req, response)
    expect(response.statusCode).toBe(200)
    expect(calls).toEqual([{ autoSync: false, pins: ['result.log'], exclusions: [] }])
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
})
