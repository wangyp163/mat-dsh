import { describe, expect, it } from 'vitest'
import { EfileClient, buildListArgs } from '../src/efile'
import type { CommandRunner } from '../src/curl'

function clientWith(result: { rc: number; stdout: string; stderr: string }): {
  client: EfileClient
  calls: string[][]
} {
  const calls: string[][] = []
  const runner: CommandRunner = async (args) => {
    calls.push(args)
    return result
  }
  return {
    client: new EfileClient({ token: 'secret-token', efileUrl: 'https://efile-a', runner }),
    calls,
  }
}

describe('efile directory listing', () => {
  it('builds the documented paginated list request with encoded query values', () => {
    const args = buildListArgs({
      efileUrl: 'https://efile-a/',
      token: 'secret-token',
      path: '/public/home/u/计算 1',
      start: 20,
      limit: 50,
      order: 'desc',
      orderBy: 'lastModifiedTime',
      keyword: 'result 1',
    })

    expect(args.slice(0, 10)).toEqual([
      '-k', '-s', '--noproxy', '*',
      '-H', 'token: secret-token',
      '-H', 'Content-Type: application/json',
      '--max-time', '300',
    ])
    expect(args.at(-1)).toBe(
      'https://efile-a/openapi/v2/file/list?path=%2Fpublic%2Fhome%2Fu%2F%E8%AE%A1%E7%AE%97+1&start=20&limit=50&order=desc&orderBy=lastModifiedTime&keyWord=result+1',
    )
  })

  it('normalizes the documented fileList response without exposing service-only fields', async () => {
    const { client, calls } = clientWith({
      rc: 0,
      stderr: '',
      stdout: JSON.stringify({
        code: '0',
        msg: 'success',
        data: {
          total: 2,
          path: '/public/home/u/job',
          fileList: [
            {
              name: 'result.log', path: '/public/home/u/job/result.log', size: 12,
              lastModifiedTime: '2026-09-01 09:00:00', isDirectory: false,
              isRegularFile: true, isSymbolicLink: false,
              permissionAction: { read: true, write: false, execute: false, allowed: false },
              owner: 'u', group: 'g', fileKey: 123,
            },
            {
              name: 'scratch', path: '/public/home/u/job/scratch', size: 4096,
              lastModifiedTime: '2026-09-01 08:00:00', isDirectory: true,
              isRegularFile: false, isSymbolicLink: false,
              permissionAction: { read: true, write: true, execute: true, allowed: true },
            },
          ],
        },
      }),
    })

    await expect(client.listFiles('/public/home/u/job', { start: 0, limit: 20 }))
      .resolves.toEqual({
        path: '/public/home/u/job',
        total: 2,
        entries: [
          {
            name: 'result.log', path: '/public/home/u/job/result.log', size: 12,
            modifiedAt: '2026-09-01 09:00:00', directory: false,
            regularFile: true, symbolicLink: false, readable: true,
          },
          {
            name: 'scratch', path: '/public/home/u/job/scratch', size: 4096,
            modifiedAt: '2026-09-01 08:00:00', directory: true,
            regularFile: false, symbolicLink: false, readable: true,
          },
        ],
      })
    expect(calls[0]?.join(' ')).toContain('/openapi/v2/file/list?')
  })

  it('rejects invalid pagination before invoking curl', async () => {
    const { client, calls } = clientWith({ rc: 0, stdout: '', stderr: '' })
    await expect(client.listFiles('/public/home/u', { limit: 0 })).rejects.toThrow(/limit/)
    await expect(client.listFiles('/public/home/u', { start: -1 })).rejects.toThrow(/start/)
    expect(calls).toEqual([])
  })

  it('reports malformed and failed service responses without including the token', async () => {
    const failed = clientWith({ rc: 0, stdout: '{"code":"911030","msg":"permission denied"}', stderr: '' })
    await expect(failed.client.listFiles('/private')).rejects.toThrow(/911030.*permission denied/)

    const malformed = clientWith({ rc: 0, stdout: '<html>bad gateway</html>', stderr: '' })
    const error = await malformed.client.listFiles('/private').catch((cause: unknown) => cause)
    expect(String(error)).toContain('bad gateway')
    expect(String(error)).not.toContain('secret-token')
  })
})
