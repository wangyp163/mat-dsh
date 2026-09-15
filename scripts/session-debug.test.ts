import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeSession, readInput } from './session-debug.js'

/**
 * session-debug 读数层回归：SOP §6.6 的"读数新鲜度"判据依赖这些行为——
 * 尾帧截断的 zstd 文件仍能读出全部完整帧；end-seed 只有位于最后事件之后
 * 才代表 dispose 已完成的文件终态。
 */

function zstdCompress(input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('zstd', ['-c', '-q'])
    const chunks: Buffer[] = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`zstd exited ${code}`))))
    child.stdin.end(input)
  })
}

let tempDir: string | undefined

async function scratch(): Promise<string> {
  tempDir ??= await mkdtemp(join(tmpdir(), 'session-debug-test-'))
  return tempDir
}

afterEach(async () => {
  if (tempDir === undefined) return
  await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function jsonl(rows: Array<Record<string, unknown>>): string {
  return rows.map(row => JSON.stringify(row)).join('\n') + '\n'
}

describe('readInput 截断尾帧容忍', () => {
  it('尾部截断的 .zstd 文件仍读出全部完整帧，并丢弃不完整的最后一行', async () => {
    const dir = await scratch()
    const intact = jsonl([
      { type: 'session', id: 'session-x', cwd: '/tmp' },
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'turn/end', seq: 4, time: 2000, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const extra = jsonl([
      { type: 'user/message', seq: 5, time: 3000, data: { turn: 2 } },
      { type: 'turn/start', seq: 6, time: 3100, data: { turn: 2 } },
    ])
    // 完整帧 + 一个被截断的尾帧，模拟 dsh 写入中被读/被杀。
    const completeFrame = await zstdCompress(intact)
    const tornFrame = (await zstdCompress(extra)).subarray(0, 40)
    const path = join(dir, 'session.jsonl.zstd')
    await writeFile(path, Buffer.concat([completeFrame, tornFrame]))

    const text = await readInput(path)
    expect(text).toContain('"turn/end"')
    expect(text).not.toContain('"turn":2')
    expect(text).not.toContain('"seq":5')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('不存在或空输出的文件照常报错，不静默吞掉', async () => {
    const dir = await scratch()
    await expect(readInput(join(dir, 'missing.jsonl.zstd'))).rejects.toThrow()
  })

  it('未压缩 .jsonl 原样读取', async () => {
    const dir = await scratch()
    const path = join(dir, 'session.jsonl')
    await writeFile(path, jsonl([{ type: 'session', id: 'session-y' }]))
    await expect(readInput(path)).resolves.toContain('session-y')
  })
})

describe('analyzeSession 时间口径', () => {
  it('lastEventTime 排除 end-seed，endSeedTime 单列；end-seed 在后 ⇒ durableFinal 语义成立', () => {
    const report = analyzeSession(jsonl([
      { type: 'session', id: 'session-z', cwd: '/tmp' },
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 2000, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'session/end-seed', time: 5000, data: {} },
    ]))
    expect(report.lastEventTime).toBe(2000)
    expect(report.endSeedTime).toBe(5000)
    expect(report.endSeedTime! >= report.lastEventTime!).toBe(true)
  })

  it('中部 end-seed（dsh 重启）晚于它的事件仍在 ⇒ 不构成终态', () => {
    const report = analyzeSession(jsonl([
      { type: 'session', id: 'session-w', cwd: '/tmp' },
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'session/end-seed', time: 1500, data: {} },
      { type: 'turn/end', seq: 2, time: 2000, data: { turn: 1, reason: { kind: 'completed' } } },
    ]))
    expect(report.lastEventTime).toBe(2000)
    expect(report.endSeedTime).toBe(1500)
    expect(report.endSeedTime! >= report.lastEventTime!).toBe(false)
  })
})
