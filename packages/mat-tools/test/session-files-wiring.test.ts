import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index'
import type { MatFileServiceImpl } from '../src/file-service'

/**
 * 会话文件归档接线：apply(ctx) 订阅宿主 session/event——write/edit/mat_download
 * 的 tool/call（arguments 是 JSON 字符串）落台账；其余事件/越界路径零副作用。
 */

type SessionEventListener = (session: { id: string; header: { cwd?: string } }, event: { type: string; data?: { name: string; arguments: string } }) => void

function makeCtx() {
  const listeners = new Map<string, SessionEventListener>()
  const provided = new Map<string, unknown>()
  const ctx = {
    on: (name: string, listener: SessionEventListener) => { listeners.set(name, listener); return () => { listeners.delete(name) } },
    systemPrompt: { section: (_s: unknown) => {} },
    tools: { register: (_t: unknown) => {} },
    get: (_key: string) => undefined,
    provide: (n: string, v: unknown) => { provided.set(n, v); return () => { provided.delete(n) } },
  } as unknown as Context
  return { ctx, listeners, provided }
}

describe('session/event → 会话文件归档', () => {
  let testRoot: string
  let workspace: string
  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'mat-sfw-'))
    workspace = await mkdtemp(join(tmpdir(), 'mat-sfw-ws-'))
    await writeFile(join(workspace, 'POSCAR'), 'cell')
    await writeFile(join(workspace, 'f.log'), 'log')
    vi.stubEnv('MAT_FILE_ROOT', testRoot)
    vi.stubEnv('MAT_ENV_GATE', 'off')
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    // 台账 persist 是 fire-and-forget：等在途写盘落定再清理（rm 重试兜底 WSL 竞态）。
    await new Promise(resolve => setTimeout(resolve, 60))
    for (const dir of [testRoot, workspace]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await rm(dir, { recursive: true, force: true }); break } catch { await new Promise(resolve => setTimeout(resolve, 40)) }
      }
    }
  })

  /** apply → emit 一串事件 → 等记账 flush → 返回投影。 */
  async function emitAndProject(events: Array<{ session: { id: string; header: { cwd?: string } }; event: { type: string; data?: { name: string; arguments: string } } }>): Promise<Record<string, string[]> | undefined> {
    const { ctx, listeners, provided } = makeCtx()
    apply(ctx)
    const listener = listeners.get('session/event')
    if (listener === undefined) throw new Error('session/event 未被订阅')
    for (const { session, event } of events) listener(session, event)
    const service = provided.get('mat.files') as MatFileServiceImpl
    await new Promise(resolve => setImmediate(resolve)) // record 是 fire-and-forget
    const tree = await service.listSessionWorkspace({ cwd: workspace, path: '' })
    return tree.sessionFiles
  }

  it('write 的绝对/相对 file_path 都归档；相对路径按会话 cwd 解析', async () => {
    const projection = await emitAndProject([
      { session: { id: 'session-a1', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: `${workspace}/POSCAR`, content: 'x' }) } } },
      { session: { id: 'session-a1', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: 'POSCAR' }) } } },
    ])
    expect(projection).toEqual({ 'session-a1': ['POSCAR'] })
  })

  it('mat_download 的 local_path 归档；edit 同 write（幽灵路径被存在性过滤）', async () => {
    const projection = await emitAndProject([
      { session: { id: 'session-b2', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'mat_download', arguments: JSON.stringify({ cluster_id: '11250', remote_path: '/r/f.log', local_path: `${workspace}/f.log` }) } } },
      { session: { id: 'session-b2', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'edit', arguments: JSON.stringify({ file_path: `${workspace}/POSCAR` }) } } },
      // mat_download 失败形态：目标从未落盘 → 台账有条目但投影过滤（幽灵不进面板）。
      { session: { id: 'session-b2', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'mat_download', arguments: JSON.stringify({ cluster_id: '11250', remote_path: '/r/ghost.log', local_path: `${workspace}/ghost.log` }) } } },
    ])
    expect(projection).toEqual({ 'session-b2': ['POSCAR', 'f.log'] })
  })

  it('非目标工具 / cwd 外路径 / 无 cwd 会话 / 坏 JSON 零副作用', async () => {
    const projection = await emitAndProject([
      { session: { id: 'session-c3', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'bash', arguments: JSON.stringify({ command: 'touch x' }) } } },
      { session: { id: 'session-c3', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: '/etc/evil' }) } } },
      { session: { id: 'session-c3', header: {} }, event: { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: `${workspace}/POSCAR` }) } } },
      { session: { id: 'session-c3', header: { cwd: workspace } }, event: { type: 'tool/call', data: { name: 'write', arguments: '{broken' } } },
      { session: { id: 'session-c3', header: { cwd: workspace } }, event: { type: 'user/message', data: undefined as never } },
    ])
    expect(projection).toBeUndefined()
  })
})
