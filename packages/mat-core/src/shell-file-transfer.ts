/**
 * HPC 文件传输的 remote-shell 后备通道。
 *
 * 当开放平台未给目标集群签发 token/efile 地址，但 MAT_MCP_KEY 已获该集群
 * remote-shell 权限时，以小块 base64 在 MCP 文本通道中传输。下载先写本地临时文件，
 * 上传先写远端临时文件，完整校验字节数后再原子替换目标，避免半文件冒充成功产物。
 */

import { randomUUID } from 'node:crypto'
import { appendFile, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import type { ExecResult, MatClient } from './client.ts'
import type { ListFilesOptions, RemoteFilePage } from './efile.ts'

// 通道实测（2026-09-02，fetch 传输）：exec 单次输出上限 1,048,576 字符。
// 512KB 原始块 base64 后约 700K 字符（gzip 对不可压数据 +0.05% 仍安全），取整 16 倍于旧值。
const DEFAULT_CHUNK_BYTES = 512 * 1024
const TRANSFER_TIMEOUT_SECONDS = 60

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function stdoutOf(result: ExecResult): string {
  if (result.code === 0) {
    return typeof result.data === 'string' ? result.data : result.data.stdout
  }
  if (typeof result.data === 'string') throw new Error(result.data || result.message)
  throw new Error(result.data.stderr || result.message || `remote command exited ${result.data.exitCode}`)
}

export interface ShellFileTransferClientOptions {
  execClient: Pick<MatClient, 'execCommand'>
  chunkBytes?: number
}

export interface ShellUploadResult {
  success: true
  path: string
  bytes: number
}

export interface ShellDownloadResult {
  success: true
  path: string
  bytes: number
}

export class ShellFileTransferClient {
  private readonly execClient: Pick<MatClient, 'execCommand'>
  private readonly chunkBytes: number

  constructor(options: ShellFileTransferClientOptions) {
    this.execClient = options.execClient
    this.chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  }

  async listFiles(clusterId: string, remotePath: string, options: ListFilesOptions = {}): Promise<RemoteFilePage> {
    const start = options.start ?? 0
    const limit = options.limit ?? 100
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('remote-shell list start must be a non-negative integer')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('remote-shell list limit must be an integer from 1 to 200')
    const remote = shellQuote(remotePath)
    const output = stdoutOf(await this.execClient.execCommand(
      clusterId,
      `find ${remote} -mindepth 1 -maxdepth 1 -readable -printf '%f\\t%s\\t%TY-%Tm-%Td %TH:%TM:%TS %Tz\\t%y\\t%Y\\n'`,
      TRANSFER_TIMEOUT_SECONDS,
    ))
    let entries = output.split('\n').filter(Boolean).map((line) => {
      const [name = '', size = '0', modifiedAt = '', type = ''] = line.split('\t')
      return {
        name,
        path: `${remotePath.replace(/\/$/, '')}/${name}`,
        size: Number(size) || 0,
        modifiedAt,
        directory: type === 'd',
        regularFile: type === 'f',
        symbolicLink: type === 'l',
        readable: true,
      }
    })
    if (options.keyword) entries = entries.filter((entry) => entry.name.includes(options.keyword!))
    const field = options.orderBy ?? 'name'
    entries.sort((a, b) => {
      const left = field === 'size' ? a.size : field === 'lastModifiedTime' ? a.modifiedAt : a.name
      const right = field === 'size' ? b.size : field === 'lastModifiedTime' ? b.modifiedAt : b.name
      const order = left < right ? -1 : left > right ? 1 : 0
      return options.order === 'desc' ? -order : order
    })
    return { path: remotePath, total: entries.length, entries: entries.slice(start, start + limit) }
  }

  /** 远端字节数；预取预算与下载前校验共用。 */
  async statFile(clusterId: string, remotePath: string): Promise<number> {
    const sizeText = stdoutOf(await this.execClient.execCommand(
      clusterId,
      `stat -c %s -- ${shellQuote(remotePath)}`,
      TRANSFER_TIMEOUT_SECONDS,
    )).trim()
    const bytes = Number(sizeText)
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`remote-shell stat returned invalid size: ${sizeText.slice(0, 80)}`)
    }
    return bytes
  }

  async downloadFile(clusterId: string, remotePath: string, localPath: string): Promise<ShellDownloadResult> {
    const remote = shellQuote(remotePath)
    const expectedBytes = await this.statFile(clusterId, remotePath)

    const temporaryPath = `${localPath}.mat-part-${process.pid}-${randomUUID()}`
    await writeFile(temporaryPath, Buffer.alloc(0), { mode: 0o600 })
    try {
      // 每块独立 gzip 流（dd|gzip|base64），首个块探测 gzip 可用性，失败即整次回退纯 base64。
      let gzipOk = true
      const readChunk = async (skip: number, compressed: boolean): Promise<Buffer> => {
        const pipeline = compressed ? ' | gzip -c' : ''
        const encoded = stdoutOf(await this.execClient.execCommand(
          clusterId,
          `dd if=${remote} bs=${this.chunkBytes} skip=${skip} count=1 status=none${pipeline} | base64 -w0`,
          TRANSFER_TIMEOUT_SECONDS,
        )).trim()
        const raw = Buffer.from(encoded, 'base64')
        return compressed ? gunzipSync(raw) : raw
      }
      for (let offset = 0; offset < expectedBytes; offset += this.chunkBytes) {
        const skip = Math.floor(offset / this.chunkBytes)
        let chunk: Buffer
        try {
          chunk = await readChunk(skip, gzipOk)
        } catch (error) {
          if (!gzipOk) throw error
          gzipOk = false
          chunk = await readChunk(skip, false)
        }
        if (chunk.length === 0) throw new Error(`remote-shell download returned an empty chunk at byte ${offset}`)
        await appendFile(temporaryPath, chunk)
      }
      const actualBytes = (await stat(temporaryPath)).size
      if (actualBytes !== expectedBytes) {
        throw new Error(`remote-shell download size mismatch: expected ${expectedBytes}, got ${actualBytes}`)
      }
      await rename(temporaryPath, localPath)
      return { success: true, path: localPath, bytes: actualBytes }
    } catch (error) {
      await unlink(temporaryPath).catch(() => {})
      throw error
    }
  }

  async uploadFile(clusterId: string, localPath: string, remotePath: string): Promise<ShellUploadResult> {
    const content = await readFile(localPath)
    const remote = shellQuote(remotePath)
    const temporaryRemotePath = `${remotePath}.mat-part-${randomUUID()}`
    const temporary = shellQuote(temporaryRemotePath)

    stdoutOf(await this.execClient.execCommand(
      clusterId,
      `umask 077; mkdir -p -- "$(dirname -- ${remote})" && : > ${temporary}`,
      TRANSFER_TIMEOUT_SECONDS,
    ))
    try {
      for (let offset = 0; offset < content.length; offset += this.chunkBytes) {
        const encoded = content.subarray(offset, offset + this.chunkBytes).toString('base64')
        stdoutOf(await this.execClient.execCommand(
          clusterId,
          `printf %s ${shellQuote(encoded)} | base64 -d >> ${temporary}`,
          TRANSFER_TIMEOUT_SECONDS,
        ))
      }
      const sizeText = stdoutOf(await this.execClient.execCommand(
        clusterId,
        `stat -c %s -- ${temporary}`,
        TRANSFER_TIMEOUT_SECONDS,
      )).trim()
      const remoteBytes = Number(sizeText)
      if (remoteBytes !== content.length) {
        throw new Error(`remote-shell upload size mismatch: expected ${content.length}, got ${sizeText.slice(0, 80)}`)
      }
      stdoutOf(await this.execClient.execCommand(
        clusterId,
        `mv -f -- ${temporary} ${remote}`,
        TRANSFER_TIMEOUT_SECONDS,
      ))
      return { success: true, path: remotePath, bytes: content.length }
    } catch (error) {
      await this.execClient.execCommand(clusterId, `rm -f -- ${temporary}`, TRANSFER_TIMEOUT_SECONDS).catch(() => {})
      throw error
    }
  }
}
