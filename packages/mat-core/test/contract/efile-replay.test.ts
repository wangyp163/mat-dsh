import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { FetchLike } from '../../src/fetch-transport'
import { EfileClient, TokenClient } from '../../src/index'

/**
 * 回放契约（synthetic，凭证未到位）：fixtures/efile/ 的响应结构按 plugin.py
 * 的处理逻辑构造（PROVENANCE.md 记录依据）。断言钉的是**字段名与分支语义**——
 * code/data/msg、data[].clusterId/token、center.data.efileUrls、data.path——凭证到位实弹
 * 回填真实响应后，这些断言无需变化。
 */

const fx = (rel: string): string => readFileSync(join(import.meta.dirname, 'fixtures', rel), 'utf8')

function fakeFetch(body: string): FetchLike {
  return ((_url: string, _init?: RequestInit) => Promise.resolve({
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  })) as FetchLike
}

describe('契约回放：token 响应（synthetic）', () => {
  it('code==="0" → data[] 逐集群字段（clusterId/token/efileUrls）；无 efile 集群被 getClusterInfo 拒绝', async () => {
    const client = new TokenClient({
      accessKey: 'AK', secretKey: 'SECRET', user: 'u',
      fetchImpl: fakeFetch(fx('efile/token-ok.json')),
    })
    const tokens = await client.getTokens()
    expect(tokens.map((t) => t.clusterId)).toEqual(['11250', '11100'])
    const info = await client.getClusterInfo('11250')
    expect(info).toMatchObject({
      clusterId: '11250',
      token: 'synthetic-token-11250',
      efileUrl: 'https://efile-11250.synthetic',
    })
    await expect(client.getClusterInfo('11100')).rejects.toThrow(/no efile endpoint/)
  })
})

describe('契约回放：efile upload/download 响应（synthetic）', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); dirs.length = 0 })

  function clientWith(stdout: string, localSideEffect?: (path: string) => Promise<void>): EfileClient {
    return new EfileClient({
      token: 't', efileUrl: 'https://efile-11250.synthetic',
      runner: async (argv) => {
        const outIndex = argv.indexOf('-o')
        if (outIndex >= 0 && localSideEffect) await localSideEffect(argv[outIndex + 1] ?? '')
        return { rc: 0, stdout, stderr: '' }
      },
    })
  }

  it('upload code==="0" → data.path 作为远端路径', async () => {
    const r = await clientWith(fx('efile/upload-ok.json')).uploadFile('/tmp/f.xyz', '/public/home/user01/f.xyz')
    expect(r).toEqual({ success: true, path: '/public/home/user01/f.xyz' })
  })

  it('upload code!=="0" → 抛错带 code/msg', async () => {
    await expect(clientWith(fx('efile/upload-error.json')).uploadFile('/tmp/f.xyz', '/x'))
      .rejects.toThrow(/30001.*no permission/)
  })

  it('download JSON 错误体（content_type JSON）→ 抛错带 code/msg，落盘残留清理', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'efile-contract-'))
    dirs.push(dir)
    const path = join(dir, 'out.bin')
    const c = clientWith('application/json', async (p) => { await writeFile(p, fx('efile/download-error.json')) })
    await expect(c.downloadFile('/x', path)).rejects.toThrow(/30002.*file not exist/)
    await expect(readFile(path)).rejects.toThrow()
  })
})
