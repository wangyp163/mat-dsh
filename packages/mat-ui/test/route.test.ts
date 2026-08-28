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
    let route: { path: string; handler: (req: unknown, res: any) => void | Promise<void> } | undefined
    const response = { headers: new Map<string, string>(), body: '', setHeader(k: string, v: string) { this.headers.set(k, v) }, end(v?: string) { this.body = v ?? '' } }
    const ctx = {
      webServer: { register: (r: typeof route) => { route = r!; return () => {} } },
      get: (key: string) => key === 'mat.status' ? makeBoard() : undefined,
    } as unknown as Context
    apply(ctx)
    expect(route?.path).toBe('/mat-status/jobs')
    await route!.handler({ url: '/mat-status/jobs' }, response)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(JSON.parse(response.body)).toEqual({ jobs: makeBoard().list() })
  })
})
