/**
 * HPC 开放 API token 流（移植自 plugin.py §199-237）。
 *
 * POST https://mcp-gateway.example.internal/api/user/v3/tokens，四请求头 {user, accessKey, signature, timestamp}；
 * signature = HMAC-SHA256(secretKey, `{"accessKey":"…","timestamp":"…","user":"…"}`) hex 小写
 * （键序 accessKey→timestamp→user，值为 Python _escape_json 语义的 JSON 字符串）。
 * 响应 code==='0' → data[] 每项 {clusterId, clusterName, token, hpcUrls, efileUrls}；内存缓存。
 *
 * token 端点是 mcp-gateway.example.internal（M0 实测 Node fetch 3/3 通），用 fetch 而非 curl 子进程；
 * efile 域走 curl（见 efile.ts）。
 */

import { createHmac } from 'node:crypto'
import type { FetchLike } from './fetch-transport'

/** Python _escape_json：先反斜杠后引号（顺序不可换，否则 \" 双重转义）。 */
function escapeJson(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function generateSignature(accessKey: string, timestamp: string, user: string, secretKey: string): string {
  const payload = `{"accessKey":"${escapeJson(accessKey)}","timestamp":"${escapeJson(timestamp)}","user":"${escapeJson(user)}"}`
  return createHmac('sha256', secretKey).update(payload).digest('hex')
}

/** token 接口返回的单集群条目（字段对齐 plugin.py，多余字段透传保留）。 */
export interface ClusterToken {
  clusterId: string
  clusterName?: string
  token: string
  hpcUrls?: Array<{ url: string }>
  efileUrls?: Array<{ url: string }>
  [key: string]: unknown
}

export interface TokenClientOptions {
  accessKey: string
  secretKey: string
  /** HPC 账号名（请求头 user）。 */
  user: string
  /** 缺省 https://mcp-gateway.example.internal/api。 */
  baseUrl?: string
  /** 缺省 globalThis.fetch；注入以离线测试。 */
  fetchImpl?: FetchLike
  /** 毫秒时钟注入（签名用秒级时间戳，测试可固化）。 */
  now?: () => number
}

/** 单集群定位结果：token + 首个 efile 服务地址。 */
export interface ClusterInfo {
  clusterId: string
  clusterName?: string
  token: string
  efileUrl: string
}

export class TokenClient {
  private readonly opts: Required<Pick<TokenClientOptions, 'accessKey' | 'secretKey' | 'user' | 'baseUrl'>>
    & Pick<TokenClientOptions, 'fetchImpl' | 'now'>
  private cache: Promise<ClusterToken[]> | undefined

  constructor(opts: TokenClientOptions) {
    this.opts = {
      accessKey: opts.accessKey,
      secretKey: opts.secretKey,
      user: opts.user,
      baseUrl: opts.baseUrl ?? 'https://mcp-gateway.example.internal/api',
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    }
  }

  /** 拉取（并缓存）全量集群 token；code≠'0' 或非 2xx 抛错。 */
  getTokens(): Promise<ClusterToken[]> {
    this.cache ??= this.fetchTokens().catch((err: unknown) => {
      this.cache = undefined // 失败不缓存，下次重试
      throw err
    })
    return this.cache
  }

  invalidate(): void {
    this.cache = undefined
  }

  /** 按 clusterId 取 token 与首个 efile 地址（efile 缺失的集群无法文件传输）。 */
  async getClusterInfo(clusterId: string): Promise<ClusterInfo> {
    const tokens = await this.getTokens()
    const hit = tokens.find((t) => t.clusterId === clusterId)
    if (hit === undefined) throw new Error(`cluster ${clusterId} not found in token response (available: ${tokens.map((t) => t.clusterId).join(', ')})`)
    if (!hit.token) throw new Error(`cluster ${clusterId} returned an empty token`)
    const efileUrl = hit.efileUrls?.[0]?.url
    if (!efileUrl) throw new Error(`cluster ${clusterId} has no efile endpoint`)
    return { clusterId, ...(hit.clusterName !== undefined ? { clusterName: hit.clusterName } : {}), token: hit.token, efileUrl }
  }

  private async fetchTokens(): Promise<ClusterToken[]> {
    const timestamp = String(Math.floor((this.opts.now?.() ?? Date.now()) / 1_000))
    const signature = generateSignature(this.opts.accessKey, timestamp, this.opts.user, this.opts.secretKey)
    const url = `${this.opts.baseUrl}/user/v3/tokens`
    const fetch = this.opts.fetchImpl ?? (globalThis.fetch as FetchLike)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'user': this.opts.user,
        'accessKey': this.opts.accessKey,
        'timestamp': timestamp,
        'signature': signature,
      },
    })
    const text = await response.text()
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`token endpoint HTTP ${response.status}: ${text.slice(0, 200)}`)
    }
    let body: { code?: string; msg?: string; data?: ClusterToken[] }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new Error(`token endpoint returned non-JSON: ${text.slice(0, 200)}`)
    }
    if (body.code !== '0') {
      throw new Error(`token endpoint failed: code=${body.code ?? '(none)'} msg=${body.msg ?? '(none)'}`)
    }
    if (!Array.isArray(body.data)) throw new Error(`token endpoint returned no data array: ${text.slice(0, 200)}`)
    return body.data
  }
}
