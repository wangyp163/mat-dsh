import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShellFileTransferClient } from '../src/shell-file-transfer'
import type { ExecResult, MatClient } from '../src/client'

function stdout(data: string): ExecResult {
  return { code: 0, data, message: 'success' }
}

function remoteFailure(stderr: string): ExecResult {
  return { code: 10020, data: { stdout: '', stderr, exitCode: 1 }, message: 'remote shell command failed' }
}

describe('ShellFileTransferClient', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
    dirs.length = 0
  })

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mat-shell-transfer-'))
    dirs.push(dir)
    return dir
  }

  it('downloadFile 分块读取 base64，按字节恢复本地文件', async () => {
    const dir = await tempDir()
    const localPath = join(dir, 'result.bin')
    const commands: string[] = []
    const chunks = [Buffer.from([0, 1, 2]).toString('base64'), Buffer.from('abc').toString('base64'), '']
    let chunk = 0
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
      commands.push(command)
      if (command.includes('stat -c %s')) return stdout('6\n')
      return stdout(`${chunks[chunk++]}\n`)
    }
    const client = new ShellFileTransferClient({ execClient: { execCommand } as MatClient, chunkBytes: 3 })

    await expect(client.downloadFile('11250', "/remote/a b/'result.bin", localPath))
      .resolves.toEqual({ success: true, path: localPath, bytes: 6 })
    expect([...await readFile(localPath)]).toEqual([0, 1, 2, 97, 98, 99])
    expect(commands[0]).toContain("'/remote/a b/'\"'\"'result.bin'")
    expect(commands.filter((command) => command.includes('base64'))).toHaveLength(2)
  })

  it('downloadFile 远端失败时删除临时文件，不覆盖既有目标', async () => {
    const dir = await tempDir()
    const localPath = join(dir, 'result.bin')
    await writeFile(localPath, 'keep')
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> =>
      command.includes('stat -c %s') ? stdout('3\n') : remoteFailure('permission denied')
    const client = new ShellFileTransferClient({ execClient: { execCommand } as MatClient })

    await expect(client.downloadFile('11250', '/remote/result.bin', localPath)).rejects.toThrow(/permission denied/)
    await expect(readFile(localPath, 'utf8')).resolves.toBe('keep')
  })

  it('listFiles 通过受控 find 输出规范化目录条目', async () => {
    const commands: string[] = []
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
      commands.push(command)
      return stdout([
        'result.log\t12\t2026-09-01 09:00:00.000000000 +0000\tf\t0\t1',
        'scratch\t4096\t2026-09-01 08:00:00.000000000 +0000\td\t0\t1',
      ].join('\n'))
    }
    const client = new ShellFileTransferClient({ execClient: { execCommand } as MatClient })

    await expect(client.listFiles('11250', '/remote/a b')).resolves.toEqual({
      path: '/remote/a b',
      total: 2,
      entries: [
        { name: 'result.log', path: '/remote/a b/result.log', size: 12, modifiedAt: '2026-09-01 09:00:00.000000000 +0000', directory: false, regularFile: true, symbolicLink: false, readable: true },
        { name: 'scratch', path: '/remote/a b/scratch', size: 4096, modifiedAt: '2026-09-01 08:00:00.000000000 +0000', directory: true, regularFile: false, symbolicLink: false, readable: true },
      ],
    })
    expect(commands[0]).toContain("'/remote/a b'")
    expect(commands[0]).toContain('-maxdepth 1')
  })

  it('uploadFile 分块写入远端临时文件，校验后原子替换', async () => {
    const dir = await tempDir()
    const localPath = join(dir, 'input.bin')
    await writeFile(localPath, Buffer.from([0, 1, 2, 97, 98, 99]))
    const commands: string[] = []
    const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
      commands.push(command)
      return command.includes('stat -c %s') ? stdout('6\n') : stdout('')
    }
    const client = new ShellFileTransferClient({ execClient: { execCommand } as MatClient, chunkBytes: 3 })

    await expect(client.uploadFile('11250', localPath, "/remote/a b/'input.bin"))
      .resolves.toEqual({ success: true, path: "/remote/a b/'input.bin", bytes: 6 })
    expect(commands[0]).toContain('umask 077')
    expect(commands.filter((command) => command.includes('base64 -d'))).toHaveLength(2)
    expect(commands.at(-1)).toContain('mv -f --')
  })
})
