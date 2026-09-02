import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { StatusBoard } from 'mat-core'
import { apply } from '../src/index'

function makeBoard(): StatusBoard {
  return {
    upsert: () => {}, settle: () => {}, remove: () => {},
    list: () => [{ jobId: 'j1', kind: 'mat-watch', label: '11250 ×1 jobs', clusterId: '11250', startedAt: 1, updatedAt: 2, phase: 'monitoring', slurm: [{ id: '100', state: 'RUNNING' }] }],
  }
}

describe('mat-ui /mat-status/jobs route', () => {
  it('returns JSON-safe status snapshot with CORS/content headers', async () => {
    const routes = new Map<string, { path: string; handler: (req: unknown, res: any) => void | Promise<void> }>()
    const response = { headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const ctx = {
      webServer: { register: (route: { path: string; handler: (req: unknown, res: any) => void | Promise<void> }) => { routes.set(route.path, route); return () => {} } },
      get: (key: string) => key === 'mat.status' ? makeBoard() : undefined,
    } as unknown as Context
    apply(ctx)
    const route = routes.get('/mat-status/jobs')!
    expect(route.path).toBe('/mat-status/jobs')
    await route.handler({ url: '/mat-status/jobs' }, response)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(JSON.parse(response.body)).toEqual({ jobs: makeBoard().list() })
  })
})
