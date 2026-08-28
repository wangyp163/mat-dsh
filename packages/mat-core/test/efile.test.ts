import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EfileClient, buildDownloadArgs, buildUploadArgs } from '../src/efile'
import type { CommandResult, CommandRunner } from '../src/curl'

// 对齐 plugin.py upload_file(591)/download_file(623)：efile REST + token 头；
// verify=False 的 TS 等价是 curl 子进程（-k --noproxy '*'），multipart 用 -F，
// 下载用 -o 落盘 + -w '%{content_type}' 区分二进制与 JSON 错误体。

describe('命令构造', () => {
  it('buildUploadArgs：-k --noproxy * / token 头 / -F 三段 / --max-time 300 / openapi 路径', () => {
    expect(buildUploadArgs({
      efileUrl: 'https://efile-a', token: 'tok-1', localPath: '/tmp/f.xyz', remotePath: '/home/u/f.xyz',
    })).toEqual([
      '-k', '-s', '--noproxy', '*',
      '-H', 'token: tok-1',
      '-F', 'path=/home/u/f.xyz',
      '-F', 'cover=cover',
      '-F', 'file=@/tmp/f.xyz',
      '--max-time', '300',
      'https://efile-a/openapi/v2/file/upload',
    ])
  })

  it('buildDownloadArgs：-o 落盘 + -w content_type；path 查询参数 URL 编码', () => {
    expect(buildDownloadArgs({
      efileUrl: 'https://efile-a', token: 'tok-1', remotePath: '/home/u/结 果.xyz', localPath: '/tmp/out.xyz',
    })).toEqual([
      '-k', '-s', '--noproxy', '*',
      '-H', 'token: tok-1',
      '-o', '/tmp/out.xyz',
      '-w', '%{content_type}',
      '--max-time', '300',
      'https://efile-a/openapi/v2/file/download?path=%2Fhome%2Fu%2F%E7%BB%93%20%E6%9E%9C.xyz',
    ])
  })
})

/** runner fake：记录 argv，可顺带执行副作用（模拟 curl -o 落盘）。 */
function fakeRunner(effect?: (argv: string[]) => CommandResult): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = []
  const run: CommandRunner = async (argv) => {
    calls.push(argv)
    return effect?.(argv) ?? { rc: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}

function makeClient(run: CommandRunner): EfileClient {
  return new EfileClient({ token: 'tok-1', efileUrl: 'https://efile-a', runner: run })
}

describe('EfileClient.uploadFile', () => {
  it('code 0 → 成功返回 path；argv 与 buildUploadArgs 一致', async () => {
    const { run, calls } = fakeRunner(() => ({ rc: 0, stdout: '{"code":"0","data":{"path":"/home/u/f.xyz"}}\n', stderr: '' }))
    const r = await makeClient(run).uploadFile('/tmp/f.xyz', '/home/u/f.xyz')
    expect(r).toEqual({ success: true, path: '/home/u/f.xyz' })
    expect(calls[0]).toEqual(buildUploadArgs({
      efileUrl: 'https://efile-a', token: 'tok-1', localPath: '/tmp/f.xyz', remotePath: '/home/u/f.xyz',
    }))
  })

  it('code≠0 → 抛错带 code/msg', async () => {
    const { run } = fakeRunner(() => ({ rc: 0, stdout: '{"code":"30001","msg":"no permission"}', stderr: '' }))
    await expect(makeClient(run).uploadFile('/tmp/f.xyz', '/home/u/f.xyz')).rejects.toThrow(/30001.*no permission/)
  })

  it('curl rc≠0（如本地文件不存在）→ 抛错带 stderr', async () => {
    const { run } = fakeRunner(() => ({ rc: 26, stdout: '', stderr: 'curl: (26) Failed to open/read local data' }))
    await expect(makeClient(run).uploadFile('/tmp/missing', '/home/u/f.xyz')).rejects.toThrow(/rc=26[\s\S]*local data/)
  })

  it('stdout 非法 JSON → 抛错带输出尾部', async () => {
    const { run } = fakeRunner(() => ({ rc: 0, stdout: '<html>502 Bad Gateway</html>', stderr: '' }))
    await expect(makeClient(run).uploadFile('/tmp/f.xyz', '/home/u/f.xyz')).rejects.toThrow(/502 Bad Gateway/)
  })

  it('cover 透传（skip 不覆盖）', async () => {
    const { run, calls } = fakeRunner(() => ({ rc: 0, stdout: '{"code":"0","data":{}}', stderr: '' }))
    await makeClient(run).uploadFile('/tmp/f.xyz', '/home/u/f.xyz', 'skip')
    expect(calls[0]?.join(' ')).toContain('-F cover=skip')
  })
})

describe('EfileClient.downloadFile', () => {
  const dirs: string[] = []
  afterEach(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); dirs.length = 0 })

  async function tmpFile(content: string): Promise<{ dir: string; path: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'efile-test-'))
    dirs.push(dir)
    const path = join(dir, 'out.bin')
    await writeFile(path, content)
    return { dir, path }
  }

  it('二进制响应（content_type 非 JSON）→ stat 返回 bytes', async () => {
    const { path } = await tmpFile('hello-efile')
    const { run, calls } = fakeRunner(() => ({ rc: 0, stdout: 'application/octet-stream', stderr: '' }))
    const r = await makeClient(run).downloadFile('/home/u/f.xyz', path)
    expect(r).toEqual({ success: true, path, bytes: 'hello-efile'.length })
    expect(calls[0]).toEqual(buildDownloadArgs({
      efileUrl: 'https://efile-a', token: 'tok-1', remotePath: '/home/u/f.xyz', localPath: path,
    }))
  })

  it('JSON 错误体 → 抛错带 code/msg，并删除落盘的错误体文件', async () => {
    const { path } = await tmpFile('{"code":"30002","msg":"file not exist"}')
    const { run } = fakeRunner(() => ({ rc: 0, stdout: 'application/json;charset=UTF-8', stderr: '' }))
    await expect(makeClient(run).downloadFile('/home/u/f.xyz', path)).rejects.toThrow(/30002.*file not exist/)
    await expect(readFile(path)).rejects.toThrow() // 错误体已清理
  })

  it('curl rc≠0 → 抛错带 stderr', async () => {
    const { path } = await tmpFile('')
    const { run } = fakeRunner(() => ({ rc: 28, stdout: '', stderr: 'curl: (28) Operation timed out' }))
    await expect(makeClient(run).downloadFile('/home/u/f.xyz', path)).rejects.toThrow(/rc=28/)
  })
})
