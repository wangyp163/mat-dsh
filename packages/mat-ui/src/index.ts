/**
 * mat-ui 节点半（探针版）：web 运行时注册 /mat-status 路由，把 mat-tools
 * 状态板的快照喂给浏览器卡片。headless 无 webServer → fiber 休眠，不报错
 * （cordis 依赖等待语义，见宿主 vendor/cordis/src/fiber.ts `_refresh`）。
 */
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { normalizeRemotePath, remoteRelativePath } from 'mat-core'
import type { ListFilesOptions, RemoteFilePage, StatusBoard } from 'mat-core'

interface MatFileService {
  listFiles(clusterId: string, path: string, options?: ListFilesOptions): Promise<RemoteFilePage>
  listWorkspace?(request: { jobId: string; clusterId: string; workdir: string; path: string; producerFiles?: string[]; localWorkspace?: string }): Promise<unknown>
  prepareDownload?(jobId: string, paths: string[], context?: { clusterId: string; workdir: string }): Promise<DownloadArtifact>
  syncFile?(jobId: string, clusterId: string, workdir: string, remotePath: string, conflictPolicy: 'keep-both' | 'overwrite'): Promise<unknown>
  materializeFile?(jobId: string, clusterId: string, workdir: string, path: string): Promise<string>
  listSyncs?(): unknown[]
  getPreferences?(jobId: string): Promise<{ autoSync: boolean; pins?: string[]; exclusions?: string[] }>
  setPreferences?(jobId: string, value: { autoSync: boolean; pins?: string[]; exclusions?: string[] }): Promise<void>
}

type DownloadArtifact = {
  kind: 'file' | 'zip'
  filename: string
  body: AsyncIterable<Uint8Array> | Uint8Array
  contentType?: string
  dispose?: () => Promise<void> | void
}

export const name = 'mat-ui'

/** webServer 与状态板都未就绪时保持 dormant，避免抢先注册空路由。 */
export const inject = ['webServer', 'mat.status', 'mat.files']

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/**
 * 预览白名单：扩展名 → content-type。与客户端 view-model 的判定表各自维护
 * （服务端只关心 mime，且绝不回 text/html —— nosniff 下的预览面不容 XSS）。
 */
const PREVIEW_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  ...Object.fromEntries(['xyz', 'cif', 'poscar', 'vasp', 'log', 'out', 'txt', 'json', 'sh', 'com', 'gjf', 'inp', 'py', 'csv', 'md', 'yml', 'yaml', 'slurm', 'pbs', 'job']
    .map((extension) => [extension, 'text/plain; charset=utf-8'])),
}

function previewContentType(path: string): string | undefined {
  const base = path.split('/').at(-1) ?? path
  if (base.toLowerCase() === 'poscar') return 'text/plain; charset=utf-8'
  const dot = base.lastIndexOf('.')
  const extension = dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
  return PREVIEW_CONTENT_TYPES[extension]
}

const PREVIEW_LIMIT_BYTES = 64 * 1024 * 1024

/** vendored NGL 只读一次磁盘，进程内复用。 */
let nglBuffer: Buffer | undefined

export function apply(ctx: Context): void {
  const board = ctx.get('mat.status') as StatusBoard | undefined
  if (board === undefined) return
  const files = ctx.get('mat.files') as MatFileService
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-status/jobs',
    handler: (_req: IncomingMessage, res: ServerResponse) => json(res, { jobs: board.list() }),
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/config',
    handler: (_req: IncomingMessage, res: ServerResponse) => json(res, {
      localRootConfigured: Boolean(process.env.MAT_FILE_ROOT),
      efile: { available: Boolean(process.env.MAT_ACCESS_KEY && process.env.MAT_SECRET_KEY && process.env.MAT_USER) },
      fallback: { available: Boolean(process.env.MAT_MCP_KEY) },
    }),
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/jobs',
    handler: (_req: IncomingMessage, res: ServerResponse) => json(res, {
      jobs: board.list().map((job) => ({
        jobId: job.jobId, clusterId: job.clusterId, ownerSession: job.ownerSession,
        workdir: job.workdir, localWorkspace: job.localWorkspace,
        phase: job.phase, outcomeStatus: job.outcomeStatus,
        files: job.files ?? [],
      })),
    }),
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/preferences',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET') {
        const jobId = url.searchParams.get('jobId') ?? ''
        if (!board.list().some((job) => job.jobId === jobId) || files?.getPreferences === undefined) {
          json(res, { error: { code: 'unknown-job', message: `unknown job ${jobId}` } }, 404)
          return
        }
        json(res, { jobId, ...await files.getPreferences(jobId) })
        return
      }
      if (req.method !== 'PUT' || files?.setPreferences === undefined) {
        json(res, { error: { code: 'method-not-allowed', message: 'use GET or PUT' } }, 405)
        return
      }
      try {
        const body = await readJson(req)
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        if (!board.list().some((job) => job.jobId === jobId)) {
          json(res, { error: { code: 'unknown-job', message: `unknown job ${jobId}` } }, 404)
          return
        }
        const pins = Array.isArray(body.pins) ? body.pins.filter((value): value is string => typeof value === 'string') : undefined
        const exclusions = Array.isArray(body.exclusions) ? body.exclusions.filter((value): value is string => typeof value === 'string') : undefined
        if (pins?.some((value) => value.length > 4096 || value.startsWith('/') || value.split('/').includes('..'))
          || exclusions?.some((value) => value.length > 4096 || value.startsWith('/') || value.split('/').includes('..'))) {
          throw new Error('preferences paths must be relative and safe')
        }
        const value = { autoSync: body.autoSync === true, ...(pins === undefined ? {} : { pins }), ...(exclusions === undefined ? {} : { exclusions }) }
        await files.setPreferences(jobId, value)
        json(res, { jobId, ...value })
      } catch (error) {
        json(res, { error: { code: 'invalid-request', message: error instanceof Error ? error.message : String(error) } }, 400)
      }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/sync',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        json(res, { syncs: files?.listSyncs?.() ?? [] })
        return
      }
      if (req.method !== 'POST') {
        json(res, { error: { code: 'method-not-allowed', message: 'use GET or POST' } }, 405)
        return
      }
      if (files?.syncFile === undefined) {
        json(res, { error: { code: 'not-configured', message: 'local synchronization is not configured' } }, 501)
        return
      }
      try {
        const body = await readJson(req)
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        const job = board.list().find((entry) => entry.jobId === jobId)
        if (job === undefined || job.workdir === undefined) {
          json(res, { error: { code: 'unknown-job', message: `unknown job ${jobId}` } }, 404)
          return
        }
        const paths = Array.isArray(body.paths) ? body.paths.filter((path): path is string => typeof path === 'string') : []
        if (paths.length < 1 || paths.length > 100) throw new Error('paths must contain 1 to 100 files')
        for (const path of paths) remoteRelativePath(job.workdir, path)
        const policy = body.conflictPolicy === 'overwrite' ? 'overwrite' : 'keep-both'
        const syncs = await Promise.all(paths.map((path) => files.syncFile!(job.jobId, job.clusterId, job.workdir!, path, policy)))
        json(res, { syncs }, 202)
      } catch (error) {
        json(res, { error: { code: 'invalid-request', message: error instanceof Error ? error.message : String(error) } }, 400)
      }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/tree',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const jobId = url.searchParams.get('jobId') ?? ''
      const job = board.list().find((entry) => entry.jobId === jobId)
      if (job === undefined) { json(res, { error: { code: 'unknown-job', message: `unknown job ${jobId}` } }, 404); return }
      if (files?.listWorkspace === undefined) { json(res, { error: { code: 'not-configured', message: 'workspace tree is not configured' } }, 501); return }
      try {
        const path = url.searchParams.get('path') ?? ''
        if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\\0')) throw new Error('unsafe relative path')
        const tree = await files.listWorkspace({
          jobId, clusterId: job.clusterId, workdir: job.workdir ?? '', path,
          ...(job.localWorkspace === undefined ? {} : { localWorkspace: job.localWorkspace }),
          producerFiles: job.files ?? [],
        })
        const preferences = files.getPreferences === undefined ? { autoSync: false, pins: [], exclusions: [] } : await files.getPreferences(jobId)
        json(res, { ...(tree as object), preferences })
      } catch (error) { json(res, { error: { code: 'tree-failed', message: error instanceof Error ? error.message : String(error) } }, 400) }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/open',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST' || files?.materializeFile === undefined) {
        json(res, { error: { code: 'not-configured', message: 'use POST with configured file synchronization' } }, 501)
        return
      }
      try {
        const body = await readJson(req)
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        const path = typeof body.path === 'string' ? body.path : ''
        const job = board.list().find((entry) => entry.jobId === jobId)
        if (job === undefined || job.workdir === undefined || job.localWorkspace === undefined
          || !job.localWorkspace.startsWith(`${process.env.MAT_FILE_ROOT || ''}`)) {
          json(res, { error: { code: 'unknown-job', message: `unknown workspace job ${jobId}` } }, 404)
          return
        }
        const localPath = await files.materializeFile(jobId, job.clusterId, job.workdir, path)
        const expected = `${job.localWorkspace.replace(/\/$/, '')}/${path}`
        if (localPath !== expected) throw new Error('materialized file escaped the agreed workspace')
        json(res, { path: localPath })
      } catch (error) {
        json(res, { error: { code: 'open-failed', message: error instanceof Error ? error.message : String(error) } }, 400)
      }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/download',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      let artifact: DownloadArtifact | undefined
      if (req.method !== 'POST' || files?.prepareDownload === undefined) { json(res, { error: { code: 'not-configured', message: 'use POST with configured download service' } }, 501); return }
      try {
        const body = await readJson(req)
        const jobId = typeof body.jobId === 'string' ? body.jobId : ''
        const job = board.list().find((entry) => entry.jobId === jobId)
        if (job === undefined) { json(res, { error: { code: 'unknown-job', message: `unknown job ${jobId}` } }, 404); return }
        const paths = Array.isArray(body.paths) ? body.paths.filter((value): value is string => typeof value === 'string') : []
        if (paths.length < 1 || paths.length > 100 || paths.some((value) => !value || value.startsWith('/') || value.split('/').includes('..') || value.includes('\\0'))) {
          json(res, { error: { code: paths.length > 100 ? 'download-limit' : 'invalid-path', message: 'paths must be safe relative paths, at most 100' } }, paths.length > 100 ? 413 : 400); return
        }
        artifact = await files.prepareDownload(jobId, paths, { clusterId: job.clusterId, workdir: job.workdir ?? '' })
        res.statusCode = 200
        res.setHeader('content-type', artifact.contentType ?? (artifact.kind === 'zip' ? 'application/zip' : 'application/octet-stream'))
        res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`)
        res.setHeader('x-content-type-options', 'nosniff')
        res.setHeader('cache-control', 'no-store')
        if (Symbol.asyncIterator in Object(artifact.body)) { for await (const chunk of artifact.body as AsyncIterable<Uint8Array>) (res as unknown as { write(v: Uint8Array): void }).write(chunk) }
        else (res as unknown as { write(v: Uint8Array): void }).write(artifact.body as Uint8Array)
        res.end()
      } catch (error) { json(res, { error: { code: 'download-failed', message: error instanceof Error ? error.message : String(error) } }, 400) }
      finally {
        // The artifact may hold a temporary ZIP or materialized remote file.
        // Always release it, including aborted/error responses.
        try { await artifact?.dispose?.() } catch { /* response already owns the error */ }
      }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/list',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const jobId = url.searchParams.get('jobId') ?? ''
      const job = board.list().find((entry) => entry.jobId === jobId)
      if (job === undefined) {
        json(res, { error: { code: 'unknown-job', message: `unknown job ${jobId}` } }, 404)
        return
      }
      if (files === undefined || job.workdir === undefined) {
        json(res, { error: { code: 'not-configured', message: 'remote directory listing is not configured' } }, 501)
        return
      }
      const path = url.searchParams.get('path') ?? job.workdir
      try {
        const shellStyle = (value: string) => value === '$HOME' || value.startsWith('$HOME/')
        if (shellStyle(job.workdir) || shellStyle(path)) {
          if (path !== job.workdir && !path.startsWith(`${job.workdir}/`)) throw new Error('outside workdir')
          if (path.includes('\0') || path.split('/').includes('..')) throw new Error('unsafe path')
        } else if (normalizeRemotePath(path) !== normalizeRemotePath(job.workdir)) {
          remoteRelativePath(job.workdir, path)
        }
      } catch {
        json(res, { error: { code: 'invalid-path', message: 'path must remain below the job workdir' } }, 400)
        return
      }
      try {
        const page = await files.listFiles(job.clusterId, path, {
          start: Number(url.searchParams.get('start') ?? 0), limit: Number(url.searchParams.get('limit') ?? 100),
          order: (url.searchParams.get('order') as 'asc' | 'desc' | null) ?? 'asc',
          orderBy: (url.searchParams.get('orderBy') as 'name' | 'size' | 'lastModifiedTime' | null) ?? 'name',
          keyword: url.searchParams.get('keyword') ?? undefined,
        })
        json(res, page)
      } catch (error) {
        json(res, { error: { code: 'list-failed', message: error instanceof Error ? error.message : String(error) } }, 502)
      }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-files/content',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') { json(res, { error: { code: 'method-not-allowed', message: 'use GET' } }, 405); return }
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const jobId = url.searchParams.get('jobId') ?? ''
        const path = url.searchParams.get('path') ?? ''
        const job = board.list().find((entry) => entry.jobId === jobId)
        if (job === undefined || job.workdir === undefined || job.localWorkspace === undefined
          || !job.localWorkspace.startsWith(`${process.env.MAT_FILE_ROOT || ''}`)) {
          json(res, { error: { code: 'unknown-job', message: `unknown workspace job ${jobId}` } }, 404)
          return
        }
        if (path === '' || path.startsWith('/') || path.split('/').includes('..') || path.includes('\\0')) {
          json(res, { error: { code: 'invalid-path', message: 'path must be a safe relative path' } }, 400)
          return
        }
        const contentType = previewContentType(path)
        if (contentType === undefined) {
          json(res, { error: { code: 'unsupported-type', message: `${path} is not previewable` } }, 415)
          return
        }
        const localPath = await files?.materializeFile?.(jobId, job.clusterId, job.workdir, path)
        if (localPath === undefined) { json(res, { error: { code: 'not-configured', message: 'file synchronization is not configured' } }, 501); return }
        const expected = `${job.localWorkspace.replace(/\/$/, '')}/${path}`
        if (localPath !== expected) throw new Error('materialized file escaped the agreed workspace')
        const info = await stat(localPath)
        if (info.size > PREVIEW_LIMIT_BYTES) { json(res, { error: { code: 'content-limit', message: 'preview supports files up to 64MB' } }, 413); return }
        const body = await readFile(localPath)
        res.statusCode = 200
        res.setHeader('content-type', contentType)
        res.setHeader('x-content-type-options', 'nosniff')
        res.setHeader('cache-control', 'no-store')
        res.end(body)
      } catch (error) {
        json(res, { error: { code: 'content-failed', message: error instanceof Error ? error.message : String(error) } }, 400)
      }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/mat-vendor/ngl.js',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      const headers = _req.headers as Record<string, string | undefined>
      try {
        nglBuffer ??= await readFile(new URL('../assets/ngl.js', import.meta.url))
        const info = await stat(new URL('../assets/ngl.js', import.meta.url))
        const etag = `"${info.size}-${Math.round(info.mtimeMs)}"`
        res.setHeader('content-type', 'text/javascript; charset=utf-8')
        res.setHeader('etag', etag)
        res.setHeader('cache-control', 'public, max-age=86400')
        if (headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return }
        res.statusCode = 200
        res.end(nglBuffer)
      } catch (error) {
        json(res, { error: { code: 'vendor-missing', message: error instanceof Error ? error.message : String(error) } }, 500)
      }
    },
  })
}
