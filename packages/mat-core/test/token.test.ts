import { describe, expect, it } from 'vitest'
import { TokenClient, generateSignature } from '../src/token'
import type { FetchLike } from '../src/fetch-transport'

// 签名测试向量由 plugin.py generate_signature（HMAC-SHA256，键序
// accessKey,timestamp,user，值经 _escape_json）Python 侧实算得出，保证 TS 直译一致。

describe('generateSignature（Python 向量对齐）', () => {
  it('向量 1：常规字符', () => {
    expect(generateSignature('AK_TEST_123', '1700000000', 'testuser', 'SECRET_TEST_456'))
      .toBe('e4594f0ca85910d87c6a4659fd546e1b14b1d84aa0927b4697f6f7c380e58343')
  })

  it('向量 2：含引号与反斜杠（_escape_json 语义）', () => {
    expect(generateSignature('AKX"q', '1756000000', 'us\\er', 'SK"9'))
      .toBe('79238851cbf0d7f1d441bb47099566cdd2993f7fed070603555badc244f53f98')
  })
})

/** fetch fake：记录调用，返回预置响应。 */
function fakeFetch(status: number, body: unknown): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve({
      status,
      headers: { get: () => null },
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    })
  }) as FetchLike
  return { fetch, calls }
}

const TOKENS_OK = {
  code: '0',
  data: [
    { clusterId: '11250', clusterName: '华东一区', token: 'tok-a', hpcUrls: [{ url: 'https://hpc-a' }], efileUrls: [{ url: 'https://efile-a' }] },
    { clusterId: '11100', clusterName: '另一区', token: 'tok-b', efileUrls: [] },
  ],
}

function makeClient(fetch: FetchLike) {
  return new TokenClient({
    accessKey: 'AK_TEST_123', secretKey: 'SECRET_TEST_456', user: 'testuser',
    fetchImpl: fetch,
    now: () => 1_700_000_000_000, // 时间戳注入：签名可复算
  })
}

describe('TokenClient', () => {
  it('POST /user/v3/tokens，四请求头齐（signature 与向量一致），data 透传', async () => {
    const { fetch, calls } = fakeFetch(200, TOKENS_OK)
    const tokens = await makeClient(fetch).getTokens()
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({ clusterId: '11250', token: 'tok-a' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://mcp-gateway.example.internal/api/user/v3/tokens')
    const init = calls[0]?.init
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers['user']).toBe('testuser')
    expect(headers['accessKey']).toBe('AK_TEST_123')
    expect(headers['timestamp']).toBe('1700000000')
    expect(headers['signature']).toBe('e4594f0ca85910d87c6a4659fd546e1b14b1d84aa0927b4697f6f7c380e58343')
  })

  it('token 内存缓存：二次调用不再发请求；invalidate 后重取', async () => {
    const { fetch, calls } = fakeFetch(200, TOKENS_OK)
    const c = makeClient(fetch)
    await c.getTokens()
    await c.getTokens()
    expect(calls).toHaveLength(1)
    c.invalidate()
    await c.getTokens()
    expect(calls).toHaveLength(2)
  })

  it('code≠0 → 抛错带 msg', async () => {
    const { fetch } = fakeFetch(200, { code: '10001', msg: 'bad signature' })
    await expect(makeClient(fetch).getTokens()).rejects.toThrow(/bad signature/)
  })

  it('非 2xx → 抛错带状态码', async () => {
    const { fetch } = fakeFetch(502, 'gateway error')
    await expect(makeClient(fetch).getTokens()).rejects.toThrow(/502/)
  })

  it('getClusterInfo：按 id 命中；token 为空抛错；未知集群抛错', async () => {
    const okFetch = fakeFetch(200, TOKENS_OK).fetch
    const c = makeClient(okFetch)
    await expect(c.getClusterInfo('11250')).resolves.toMatchObject({ token: 'tok-a', efileUrl: 'https://efile-a' })
    await expect(c.getClusterInfo('11100')).rejects.toThrow(/efile/)
    await expect(c.getClusterInfo('99999')).rejects.toThrow(/99999/)
  })

  it('getClusterInfo：token 响应无 URL 时调用 center discovery 并筛选 enable=true 的 efile', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const body = url.endsWith('/user/v3/tokens')
        ? { code: '0', data: [{ clusterId: '11250', clusterName: '华东一区', token: 'tok-a' }] }
        : { code: '0', data: { efileUrls: [
            { enable: 'false', url: 'https://efile-disabled' },
            { enable: 'true', url: 'https://efile-enabled/efile' },
          ] } }
      return { status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) }
    }) as FetchLike
    const c = makeClient(fetch)

    await expect(c.getClusterInfo('11250')).resolves.toMatchObject({
      token: 'tok-a', efileUrl: 'https://efile-enabled/efile',
    })
    expect(calls[1]?.url).toBe('https://mcp-gateway.example.internal/ac/openapi/v2/center')
    expect((calls[1]?.init?.headers as Record<string, string>)['token']).toBe('tok-a')
  })
})
