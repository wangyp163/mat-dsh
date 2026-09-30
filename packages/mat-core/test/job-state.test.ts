import { describe, expect, it } from 'vitest'
import { classifyState, isTerminal, nextPollDelayMs, parseSacctBatch, parseTimelimitSeconds } from '../src/job-state'

// 样例来自 docs/evidence/m1/2026-08-28-slurm-format-probe.md（11250 实测）：
//   sacct -j <ids> -P -n -o JobID,State,ExitCode,ElapsedRaw
//   → "120269511|RUNNING|0:0|15\n120269511.batch|RUNNING|0:0|15\n..."

describe('parseSacctBatch', () => {
  it('空串 → 空 Map', () => {
    expect(parseSacctBatch('').size).toBe(0)
    expect(parseSacctBatch('\n\n').size).toBe(0)
  })

  it('RUNNING 三行（含 .batch/.extern 子行）→ 仅主行入表', () => {
    const out = '120269511|RUNNING|0:0|15\n120269511.batch|RUNNING|0:0|15\n120269511.extern|RUNNING|0:0|15\n'
    const m = parseSacctBatch(out)
    expect(m.size).toBe(1)
    expect(m.get('120269511')).toEqual({ jobId: '120269511', state: 'RUNNING', exitCode: 0, elapsedSeconds: 15 })
  })

  it('多作业混查 → 每作业一条（不存在的 id 不出现）', () => {
    const out = '100|COMPLETED|0:0|26\n100.batch|COMPLETED|0:0|26\n101|PENDING|0:0|0\n'
    const m = parseSacctBatch(out)
    expect([...m.keys()].sort()).toEqual(['100', '101'])
    expect(m.get('100')?.state).toBe('COMPLETED')
    expect(m.get('101')?.state).toBe('PENDING')
  })

  it("ExitCode '1:0' → 1（取冒号前 exit，弃 signal）", () => {
    const m = parseSacctBatch('200|FAILED|1:0|30\n')
    expect(m.get('200')?.exitCode).toBe(1)
  })

  it('CANCELLED by 31561 → CANCELLED', () => {
    const m = parseSacctBatch('300|CANCELLED by 31561|0:0|0\n')
    expect(m.get('300')?.state).toBe('CANCELLED')
  })

  it('畸形行（列数不足/非数字 id）→ 跳过不炸', () => {
    const out = '\nonly-one-column\n|x|0:0|5\n400|RUNNING|0:0|\n'
    const m = parseSacctBatch(out)
    expect(m.size).toBe(1)
    expect(m.get('400')?.jobId).toBe('400')
    expect(m.get('400')?.elapsedSeconds).toBeUndefined()
  })

  it('WorkDir 第 5 列 → workdir 绝对路径（子行空值随子行丢弃）', () => {
    const out = '120865157|COMPLETED|0:0|23|/public/home/hpc-user-a/workspace/h3-qst3-0904r3/qst3\n120865157.batch|COMPLETED|0:0|23|\n'
    const m = parseSacctBatch(out)
    expect(m.size).toBe(1)
    expect(m.get('120865157')?.workdir).toBe('/public/home/hpc-user-a/workspace/h3-qst3-0904r3/qst3')
  })

  it('第 5 列缺省（4 列旧行/空 WorkDir）→ workdir 缺省不炸', () => {
    expect(parseSacctBatch('100|RUNNING|0:0|15\n').get('100')?.workdir).toBeUndefined()
    expect(parseSacctBatch('101|RUNNING|0:0|15|\n').get('101')?.workdir).toBeUndefined()
  })
})

describe('classifyState', () => {
  it('标准状态原样归一', () => {
    expect(classifyState('PENDING')).toBe('PENDING')
    expect(classifyState('RUNNING')).toBe('RUNNING')
    expect(classifyState('COMPLETED')).toBe('COMPLETED')
    expect(classifyState('FAILED')).toBe('FAILED')
    expect(classifyState('TIMEOUT')).toBe('TIMEOUT')
    expect(classifyState('NODE_FAIL')).toBe('NODE_FAIL')
    expect(classifyState('OUT_OF_MEMORY')).toBe('OUT_OF_MEMORY')
  })

  it('CANCELLED 变体（带 uid 后缀/加号）→ CANCELLED', () => {
    expect(classifyState('CANCELLED by 31561')).toBe('CANCELLED')
    expect(classifyState('CANCELLED+')).toBe('CANCELLED')
    expect(classifyState('CANCELLED by 31561+')).toBe('CANCELLED')
  })

  it('大小写容错 → 归一', () => {
    expect(classifyState('pending')).toBe('PENDING')
    expect(classifyState('Completed')).toBe('COMPLETED')
  })

  it('未知串 → UNKNOWN', () => {
    expect(classifyState('SOMETHING')).toBe('UNKNOWN')
    expect(classifyState('')).toBe('UNKNOWN')
  })
})

describe('isTerminal', () => {
  it('六终态 → true', () => {
    for (const s of ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'NODE_FAIL', 'OUT_OF_MEMORY'] as const) {
      expect(isTerminal(s)).toBe(true)
    }
  })

  it('PENDING/RUNNING/UNKNOWN → false', () => {
    expect(isTerminal('PENDING')).toBe(false)
    expect(isTerminal('RUNNING')).toBe(false)
    expect(isTerminal('UNKNOWN')).toBe(false)
  })
})

describe('nextPollDelayMs（自适应四档）', () => {
  it('<60s → 10s；60s-10min → 60s；10-30min → 120s；≥30min → 300s', () => {
    expect(nextPollDelayMs(0)).toBe(10_000)
    expect(nextPollDelayMs(59_999)).toBe(10_000)
    expect(nextPollDelayMs(60_000)).toBe(60_000)
    expect(nextPollDelayMs(599_999)).toBe(60_000)
    expect(nextPollDelayMs(600_000)).toBe(120_000)
    expect(nextPollDelayMs(1_799_999)).toBe(120_000)
    expect(nextPollDelayMs(1_800_000)).toBe(300_000)
    expect(nextPollDelayMs(86_400_000)).toBe(300_000)
  })
})

describe('parseTimelimitSeconds（sacct Timelimit 列 → 秒）', () => {
  it('HH:MM:SS / D-HH:MM:SS / MM:SS / UNLIMITED / 畸形', () => {
    expect(parseTimelimitSeconds('04:00:00')).toBe(14_400)
    expect(parseTimelimitSeconds('30:00')).toBe(1_800)
    expect(parseTimelimitSeconds('1-00:00:00')).toBe(86_400)
    expect(parseTimelimitSeconds('2-12:30:00')).toBe(217_800)
    expect(parseTimelimitSeconds('UNLIMITED')).toBeUndefined()
    expect(parseTimelimitSeconds('')).toBeUndefined()
    expect(parseTimelimitSeconds(undefined)).toBeUndefined()
    expect(parseTimelimitSeconds('garbage')).toBeUndefined()
  })

  it('随批查第 6 列进 SlurmJobInfo.timelimitSeconds(缺列兼容旧 fixture)', () => {
    const m = parseSacctBatch('100|RUNNING|0:0|13000|/w/A|04:00:00\n')
    expect(m.get('100')).toEqual({
      jobId: '100', state: 'RUNNING', exitCode: 0, elapsedSeconds: 13_000,
      workdir: '/w/A', timelimitSeconds: 14_400,
    })
    // 旧四列/五列 fixture 无 Timelimit → 字段缺省,不报错
    const legacy = parseSacctBatch('101|RUNNING|0:0|15|/w/B\n')
    expect(legacy.get('101')?.timelimitSeconds).toBeUndefined()
  })
})
