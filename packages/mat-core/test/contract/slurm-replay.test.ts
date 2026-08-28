import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecResult } from '../../src/client'
import { classifyState, isTerminal, parseSacctBatch } from '../../src/job-state'
import { parseSbatchSubmission, parseSinfoOutput, parseSingleJobState, queryJobStatus } from '../../src/slurm'
import { outputText } from '../../src/client'
import { createWatchLoop } from '../../src/watch-loop'

/**
 * 回放契约：fixtures/ 里的真实录制（来源见 PROVENANCE.md）原样喂给解析器与
 * watch 全链路 —— 行为一旦漂移（列序/子行过滤/状态归一/信封语义），本文件即红。
 */

const fx = (rel: string): string => readFileSync(join(import.meta.dirname, 'fixtures', rel), 'utf8')

/** MCP 业务信封 fixture（code/data/message）→ ExecResult。 */
function envelope(rel: string): ExecResult {
  const body = JSON.parse(fx(rel)) as { code: number; data: ExecResult['data']; message: string }
  return { code: body.code, data: body.data, message: body.message }
}

/**
 * 录制探测多一列人读 Elapsed（…,ExitCode,Elapsed,ElapsedRaw）；生产命令只取
 * ElapsedRaw。机械裁掉第 4 列，行语义与录制出处一一对应。
 */
function toProductionSacct(recorded: string): string {
  return recorded.split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('|').filter((_, i) => i !== 3).join('|'))
    .join('\n') + '\n'
}

describe('契约回放：sacct 录制 → parseSacctBatch', () => {
  it('RUNNING 主行 + .batch/.extern 子行：子行丢弃，主行全字段', () => {
    const rows = parseSacctBatch(toProductionSacct(fx('slurm/sacct-running-with-sublines.txt')))
    expect(rows.size).toBe(1)
    expect(rows.get('120269511')).toEqual({
      jobId: '120269511', state: 'RUNNING', exitCode: 0, elapsedSeconds: 15,
    })
  })

  it('混查不存在 id：999999998 静默不在表中，120269511 终态字段完整', () => {
    const rows = parseSacctBatch(toProductionSacct(fx('slurm/sacct-completed-mixed-id.txt')))
    expect(rows.size).toBe(1)
    expect(rows.has('999999998')).toBe(false)
    expect(rows.get('120269511')).toMatchObject({ state: 'COMPLETED', exitCode: 0, elapsedSeconds: 26 })
  })

  it('PENDING 刚提交即可见（非终态）', () => {
    const rows = parseSacctBatch(toProductionSacct(fx('slurm/sacct-pending.txt')))
    expect(rows.get('120268907')).toMatchObject({ state: 'PENDING', elapsedSeconds: 0 })
    expect(isTerminal('PENDING')).toBe(false)
  })

  it('CANCELLED by <uid>：uid 后缀归一为 CANCELLED 且终态', () => {
    const rows = parseSacctBatch(toProductionSacct(fx('slurm/sacct-cancelled-by-uid.txt')))
    expect(rows.get('120268907')?.state).toBe('CANCELLED')
    expect(classifyState('CANCELLED by 31561')).toBe('CANCELLED')
    expect(isTerminal('CANCELLED')).toBe(true)
  })

  it('生产 4 列格式真实输出（无需裁剪）直接解析', () => {
    const rows = parseSacctBatch(fx('slurm/sacct-completed-4col.txt'))
    expect(rows.get('120269511')).toMatchObject({ state: 'COMPLETED', exitCode: 0, elapsedSeconds: 26 })
  })
})

describe('契约回放：watch 全链路（两轮真实录制驱动到终态）', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('RUNNING 轮 → COMPLETED 轮，增量行与终态表逐字符合生产格式', async () => {
    const script = [
      toProductionSacct(fx('slurm/sacct-running-with-sublines.txt')),
      toProductionSacct(fx('slurm/sacct-completed-mixed-id.txt')),
    ]
    let i = 0
    const loop = createWatchLoop({
      clusterId: '11250',
      jobIds: ['120269511'],
      maxWaitMs: 86_400_000,
      execCommand: async (_c, _cmd) => ({ code: 0, data: script[Math.min(i++, script.length - 1)], message: 'success' }),
      scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(loop.readOutput()).toBe('120269511 UNKNOWN (not observed)\n120269511 RUNNING exit=0 elapsed=15s')
    await vi.advanceTimersByTimeAsync(10_000)
    const outcome = await loop.done
    expect(outcome).toEqual({ status: 'completed', detail: '1/1 settled (1 COMPLETED)' })
    expect(loop.readOutput()).toBe([
      '120269511 COMPLETED exit=0 elapsed=26s', // 本轮状态变化增量行
      '1/1 settled (1 COMPLETED)',
      '120269511 COMPLETED exit=0 elapsed=26s', // 终态全表
    ].join('\n'))
  })
})

describe('契约回放：单作业状态（squeue 空/10020 → sacct 兜底）', () => {
  const sacctState = '  COMPLETED              \n' // State%20 右填充形态

  it('squeue 空（本集群 RUNNING 实证）→ sacct 兜底命中', async () => {
    const calls: string[] = []
    const state = await queryJobStatus(async (_c, cmd) => {
      calls.push(cmd)
      if (cmd.includes('sacct')) return { code: 0, data: sacctState, message: 'success' }
      return envelope('slurm/squeue-empty.envelope.json')
    }, '11250', '120269511')
    expect(calls).toHaveLength(2)
    expect(state).toBe('COMPLETED')
  })

  it('squeue 全部 id 不存在（code 10020 信封）→ 仍走 sacct 兜底', async () => {
    const state = await queryJobStatus(async (_c, cmd) => {
      if (cmd.includes('sacct')) return { code: 0, data: sacctState, message: 'success' }
      return envelope('slurm/squeue-invalid-10020.envelope.json')
    }, '11250', '999999998')
    expect(state).toBe('COMPLETED')
  })

  it('parseSingleJobState：trim 语义（CANCELLED by 原样，归一交 classifyState）', () => {
    expect(parseSingleJobState('  CANCELLED by 31561      \n')).toBe('CANCELLED by 31561')
  })
})

describe('契约回放：sbatch / sinfo', () => {
  it('sbatch 业务信封 → outputText → 作业 id（录制 id 原值）', () => {
    expect(parseSbatchSubmission(outputText(envelope('slurm/sbatch-ok.envelope.json')))).toBe('120269511')
  })

  it('sinfo 5 列（synthetic，Step 7 回填真实）：默认分区 * 剥离、行数保序', () => {
    const partitions = parseSinfoOutput(fx('slurm/sinfo-5col.txt'))
    expect(partitions.map((p) => p.partition)).toEqual([
      'kshctest', 'kshdtest', 'kshdtest', 'kshdAI', 'kshdsctest', 'Agent0',
    ])
    expect(partitions.at(-1)).toEqual({ partition: 'Agent0', avail: 'up', timelimit: '1-00:00:00', nodes: '20', state: 'idle' })
    expect(partitions[0]).toMatchObject({ nodes: '283', state: 'alloc' })
  })
})
