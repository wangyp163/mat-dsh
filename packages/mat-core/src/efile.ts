/**
 * HPC efile 文件传输（移植自 plugin.py upload_file §591 / download_file §623）。
 *
 * efile 服务 SSL 链路与 mcp-gateway.example.internal 不同，Python 侧 verify=False 的 TS 等价
 * 是 curl 子进程：`-k --noproxy '*'`；上传 multipart 用 `-F`（path/cover/file），
 * 下载 `-o` 落盘 + `-w '%{content_type}'` —— Content-Type 非即 JSON 错误体
 * （成功是二进制流，失败返回 JSON），据此分流。
 */

import { execFile } from 'node:child_process'
import { readFile, stat, unlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { CommandRunner } from './curl'

const execFileAsync = promisify(execFile)

export const EFILE_MAX_TIME_SEC = 300

export interface UploadArgsInput {
  efileUrl: string
  token: string
  localPath: string
  remotePath: string
  /** cover=覆盖（默认）/ skip=跳过；透传服务端语义。 */
  cover?: string
  maxTimeSec?: number
}

export function buildUploadArgs(input: UploadArgsInput): string[] {
  return [
    '-k', '-s', '--noproxy', '*',
    '-H', `token: ${input.token}`,
    '-F', `path=${input.remotePath}`,
    '-F', `cover=${input.cover ?? 'cover'}`,
    '-F', `file=@${input.localPath}`,
    '--max-time', String(input.maxTimeSec ?? EFILE_MAX_TIME_SEC),
    `${input.efileUrl}/openapi/v2/file/upload`,
  ]
}

export interface DownloadArgsInput {
  efileUrl: string
  token: string
  remotePath: string
  localPath: string
  maxTimeSec?: number
}

export function buildDownloadArgs(input: DownloadArgsInput): string[] {
  return [
    '-k', '-s', '--noproxy', '*',
    '-H', `token: ${input.token}`,
    '-o', input.localPath,
    '-w', '%{content_type}',
    '--max-time', String(input.maxTimeSec ?? EFILE_MAX_TIME_SEC),
    `${input.efileUrl}/openapi/v2/file/download?path=${encodeURIComponent(input.remotePath)}`,
  ]
}

/** 上传成功结果（data 里的远端路径，缺省回显请求的 remotePath）。 */
export interface EfileUploadResult {
  success: true
  path: string
}

export interface EfileDownloadResult {
  success: true
  path: string
  bytes: number
}

export interface EfileClientOptions {
  token: string
  efileUrl: string
  /** 缺省 curl 子进程（timeout 310s > --max-time 300s，让服务端先报错）；注入以离线测试。 */
  runner?: CommandRunner
}

/** efile 专用执行器：大文件上传/下载超过 curl.ts defaultRunner 的 120s 上限。 */
export const efileRunner: CommandRunner = async (argv) => {
  try {
    const { stdout, stderr } = await execFileAsync('curl', argv, {
      timeout: (EFILE_MAX_TIME_SEC + 10) * 1_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    return { rc: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      rc: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(e.message ?? err),
    }
  }
}

/** 解析 efile JSON 响应；code≠'0' 或非法 JSON 抛错（错误消息内嵌输出便于诊断）。 */
function parseEfileJson(stdout: string, action: string): { code: string; msg?: string; data?: Record<string, unknown> } {
  let body: { code?: string; msg?: string; data?: Record<string, unknown> }
  try {
    body = JSON.parse(stdout) as typeof body
  } catch {
    throw new Error(`efile ${action} returned non-JSON: ${stdout.slice(0, 200)}`)
  }
  if (body.code !== '0') {
    throw new Error(`efile ${action} failed: code=${body.code ?? '(none)'} msg=${body.msg ?? '(none)'}`)
  }
  return body as { code: string; msg?: string; data?: Record<string, unknown> }
}

export class EfileClient {
  private readonly token: string
  private readonly efileUrl: string
  private readonly runner: CommandRunner

  constructor(opts: EfileClientOptions) {
    this.token = opts.token
    this.efileUrl = opts.efileUrl
    this.runner = opts.runner ?? efileRunner
  }

  async uploadFile(localPath: string, remotePath: string, cover = 'cover'): Promise<EfileUploadResult> {
    const r = await this.runner(buildUploadArgs({
      efileUrl: this.efileUrl, token: this.token, localPath, remotePath, cover,
    }))
    if (r.rc !== 0) throw new Error(`efile upload curl rc=${r.rc}: ${r.stderr.slice(0, 200)}`)
    const body = parseEfileJson(r.stdout, 'upload')
    const dataPath = body.data?.['path']
    return { success: true, path: typeof dataPath === 'string' && dataPath !== '' ? dataPath : remotePath }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<EfileDownloadResult> {
    const r = await this.runner(buildDownloadArgs({
      efileUrl: this.efileUrl, token: this.token, remotePath, localPath,
    }))
    if (r.rc !== 0) throw new Error(`efile download curl rc=${r.rc}: ${r.stderr.slice(0, 200)}`)
    // Content-Type 为 JSON → 落盘的是错误体而非文件：读出抛错并清理，避免错误体冒充产物。
    if (r.stdout.toLowerCase().includes('json')) {
      const body = await readFile(localPath, 'utf8').catch(() => r.stdout)
      await unlink(localPath).catch(() => {})
      const parsed = parseEfileJson(body, 'download')
      throw new Error(`efile download failed unexpectedly with code 0: ${JSON.stringify(parsed.data ?? {})}; raw: ${body.slice(0, 200)}`)
    }
    const info = await stat(localPath)
    return { success: true, path: localPath, bytes: info.size }
  }
}
