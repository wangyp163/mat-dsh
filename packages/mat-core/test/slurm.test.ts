import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../src/client'
import {
  SINFO_COMMAND,
  jobStatusCommand,
  jobStatusFallbackCommand,
  parseSbatchSubmission,
  parseSinfoOutput,
  parseSingleJobState,
  queryJobStatus,
  sbatchCommand,
  scancelCommand,
} from '../src/slurm'

// 语义对齐 plugin.py §519-577（list_partitions/sbatch/job_status/scancel）；
// sinfo 行样例来自 docs/evidence/post-m0/2026-08-28-gaussian-calc-skill-e2e.md（11250 实测五分区）。

describe('parseSinfoOutput', () => {
  it('五列 sinfo 行 → 分区表（分区名去尾部 *）', () => {
    const out = 'Agent0*|up|7-00:00:00|20|idle\nCPU64|up|7-00:00:00|8|mix\n'
    expect(parseSinfoOutput(out)).toEqual([
      { partition: 'Agent0', avail: 'up', timelimit: '7-00:00:00', nodes: '20', state: 'idle' },
      { partition: 'CPU64', avail: 'up', timelimit: '7-00:00:00', nodes: '8', state: 'mix' },
    ])
  })

  it('空输入 → 空表', () => {
    expect(parseSinfoOutput('')).toEqual([])
    expect(parseSinfoOutput('\n \n')).toEqual([])
  })

  it('畸形行（<5 列）跳过；多余列容忍取前五', () => {
    const out = 'a|b|c\nAgent0|up|1:00|2|idle|extra\n'
    expect(parseSinfoOutput(out)).toEqual([
      { partition: 'Agent0', avail: 'up', timelimit: '1:00', nodes: '2', state: 'idle' },
    ])
  })
})

describe('parseSbatchSubmission', () => {
  it('Submitted batch job <id> → 取行末 token 为 id（对齐 plugin.py §540-541）', () => {
    expect(parseSbatchSubmission('Submitted batch job 120274124\n')).toBe('120274124')
  })

  it('无 Submitted 标记 → 抛错带原始输出', () => {
    expect(() => parseSbatchSubmission('sbatch: error: Batch job submission failure\n'))
      .toThrow(/sbatch: error: Batch job submission failure/)
  })
})

describe('parseSingleJobState', () => {
  it('squeue 单态行 trim 后原样返回', () => {
    expect(parseSingleJobState('RUNNING\n')).toBe('RUNNING')
  })

  it('sacct State%20 右填充去空白', () => {
    expect(parseSingleJobState('COMPLETED            \n')).toBe('COMPLETED')
  })

  it('CANCELLED by <uid> 变体原样返回（归一交给 classifyState）', () => {
    expect(parseSingleJobState('CANCELLED by 31561   ')).toBe('CANCELLED by 31561')
  })

  it('空输入 → 空串（未观测语义由调用方处理）', () => {
    expect(parseSingleJobState('')).toBe('')
    expect(parseSingleJobState(' \n')).toBe('')
  })
})

describe('命令构造（与解析一一对应）', () => {
  it('SINFO_COMMAND 形态', () => {
    expect(SINFO_COMMAND).toBe("sinfo -o '%P|%a|%l|%D|%t' | tail -n +2")
  })

  it('sbatchCommand：cd workdir && sbatch script', () => {
    expect(sbatchCommand('/home/u/w', 'slurm.sh')).toBe('cd "/home/u/w" && sbatch slurm.sh')
  })

  it('jobStatusCommand / jobStatusFallbackCommand / scancelCommand', () => {
    expect(jobStatusCommand('123')).toBe("squeue -j 123 -h -o '%T' 2>/dev/null | head -1")
    expect(jobStatusFallbackCommand('123')).toBe('sacct -j 123 --noheader -o State%20 2>/dev/null | head -1')
    expect(scancelCommand('123')).toBe('scancel 123')
  })
})

/** 脚本化 fake：按命令前缀返回预置 ExecResult。 */
function fakeExec(scripted: Array<{ match: (cmd: string) => boolean; result: ExecResult }>) {
  const calls: string[] = []
  const execCommand = async (_clusterId: string, command: string): Promise<ExecResult> => {
    calls.push(command)
    for (const s of scripted) {
      if (s.match(command)) return s.result
    }
    throw new Error(`unexpected command: ${command}`)
  }
  return { execCommand, calls }
}

const ok = (stdout: string): ExecResult => ({ code: 0, data: stdout, message: '' })

describe('queryJobStatus（squeue→sacct 两段查询）', () => {
  it('squeue 有态 → 直接返回，不发 sacct（本集群 squeue 对 RUNNING 常为空，属正向分支）', async () => {
    const f = fakeExec([
      { match: (c) => c.startsWith('squeue'), result: ok('RUNNING\n') },
      { match: (c) => c.startsWith('sacct'), result: ok('COMPLETED\n') },
    ])
    await expect(queryJobStatus(f.execCommand, '11250', '123')).resolves.toBe('RUNNING')
    expect(f.calls).toHaveLength(1)
  })

  it('squeue 空 → sacct 兜底（11250 实测主路径）', async () => {
    const f = fakeExec([
      { match: (c) => c.startsWith('squeue'), result: ok('') },
      { match: (c) => c.startsWith('sacct'), result: ok('COMPLETED\n') },
    ])
    await expect(queryJobStatus(f.execCommand, '11250', '123')).resolves.toBe('COMPLETED')
    expect(f.calls).toHaveLength(2)
  })

  it('两段皆空 → 空串（作业不可见）', async () => {
    const f = fakeExec([
      { match: (c) => c.startsWith('squeue'), result: ok('') },
      { match: (c) => c.startsWith('sacct'), result: ok('') },
    ])
    await expect(queryJobStatus(f.execCommand, '11250', '123')).resolves.toBe('')
  })

  it('squeue 远端失败（code 10020）→ 仍尝试 sacct 兜底', async () => {
    const f = fakeExec([
      { match: (c) => c.startsWith('squeue'), result: { code: 10020, data: { stdout: '', stderr: 'x', exitCode: 1 }, message: 'fail' } },
      { match: (c) => c.startsWith('sacct'), result: ok('FAILED\n') },
    ])
    await expect(queryJobStatus(f.execCommand, '11250', '123')).resolves.toBe('FAILED')
  })
})
