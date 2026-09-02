import { describe, expect, it } from 'vitest'
import { createStatusBoard } from '../src/status-board'

/** 固定时钟工厂：每读一次 +1ms；每测独立实例，断言不跨测试累积。 */
function fixedClock(): () => number {
  let t = 1_000
  return () => (t += 1)
}

describe('createStatusBoard', () => {
  it('upsert 首次建档：identity 字段齐 + phase=monitoring + updatedAt=注入时钟', () => {
    const board = createStatusBoard({ now: fixedClock() })
    board.upsert('mat-slurm-1', {
      kind: 'mat-slurm',
      label: 'gaussian opt+freq @11250 #120283614',
      clusterId: '11250',
      ownerSession: 'sess-a',
      startedAt: 500,
      task: 'opt+freq',
      workdir: '/public/home/hpc-user-a/workspace/h2o-m2-probe',
      partition: 'Agent0',
      slurm: [{ id: '120283614', state: 'RUNNING', elapsedSeconds: 15 }],
    })
    expect(board.list()).toEqual([
      {
        jobId: 'mat-slurm-1',
        kind: 'mat-slurm',
        label: 'gaussian opt+freq @11250 #120283614',
        clusterId: '11250',
        ownerSession: 'sess-a',
        startedAt: 500,
        updatedAt: 1001,
        phase: 'monitoring',
        task: 'opt+freq',
        workdir: '/public/home/hpc-user-a/workspace/h2o-m2-probe',
        partition: 'Agent0',
        slurm: [{ id: '120283614', state: 'RUNNING', elapsedSeconds: 15 }],
      },
    ])
  })

  it('upsert 增量合并：只传 slurm 不抹 label/task，未传字段保留', () => {
    const board = createStatusBoard({ now: fixedClock() })
    board.upsert('j1', { kind: 'mat-watch', label: 'watch', clusterId: '11250', startedAt: 500 })
    board.upsert('j1', { slurm: [{ id: '200', state: 'PENDING', elapsedSeconds: 0 }] })
    const [entry] = board.list()
    expect(entry.label).toBe('watch')
    expect(entry.kind).toBe('mat-watch')
    expect(entry.slurm).toEqual([{ id: '200', state: 'PENDING', elapsedSeconds: 0 }])
    expect(entry.updatedAt).toBe(1002)
  })

  it('settle 合并 outcome/properties/files → phase=settled + settledAt', () => {
    const board = createStatusBoard({ now: fixedClock() })
    board.upsert('j1', { kind: 'mat-slurm', label: 'g', clusterId: '11250', startedAt: 500 })
    board.settle('j1', {
      outcomeStatus: 'completed',
      converged: true,
      detail: '1/1 settled (1 COMPLETED); opt+freq E=-76.4089539792 converged=true imag=0',
      properties: { energy: -76.4089539792, converged: true },
      files: ['/h2o/g16_optimized.xyz'],
    })
    const [entry] = board.list()
    expect(entry.phase).toBe('settled')
    expect(entry.outcomeStatus).toBe('completed')
    expect(entry.settledAt).toBe(1002)
    expect(entry.properties?.['energy']).toBe(-76.4089539792)
    expect(entry.files).toEqual(['/h2o/g16_optimized.xyz'])
  })

  it('settle 未知 jobId → 抛错（暴露接线缺陷）', () => {
    const board = createStatusBoard({ now: fixedClock() })
    expect(() => board.settle('ghost', { outcomeStatus: 'completed' }))
      .toThrow(/unknown job/)
  })

  it('settled 后再 upsert 不复活 phase：保留 settled/settledAt，仅刷新 slurm', () => {
    const board = createStatusBoard({ now: fixedClock() })
    board.upsert('j1', { kind: 'mat-watch', label: 'w', clusterId: '11250', startedAt: 500 })
    board.settle('j1', { outcomeStatus: 'completed' })
    board.upsert('j1', { slurm: [{ id: '9', state: 'COMPLETED', exitCode: 0 }] })
    const [entry] = board.list()
    expect(entry.phase).toBe('settled')
    expect(entry.settledAt).toBe(1002)
    expect(entry.slurm).toEqual([{ id: '9', state: 'COMPLETED', exitCode: 0 }])
  })

  it('settled 保留上限：超出 maxSettled 移除最旧 settled，monitoring 永不移除', () => {
    const board = createStatusBoard({ now: fixedClock(), maxSettled: 2 })
    board.upsert('m1', { kind: 'mat-watch', label: 'live', clusterId: '11250', startedAt: 1 })
    for (const id of ['a', 'b', 'c']) {
      board.upsert(id, { kind: 'mat-watch', label: id, clusterId: '11250', startedAt: 1 })
      board.settle(id, { outcomeStatus: 'completed' })
    }
    const ids = board.list().map((e) => e.jobId).sort()
    expect(ids).toEqual(['b', 'c', 'm1'])
  })

  it('list 返回拷贝：改返回值不影响板内状态', () => {
    const board = createStatusBoard({ now: fixedClock() })
    board.upsert('j1', { kind: 'mat-watch', label: 'w', clusterId: '11250', startedAt: 5 })
    const first = board.list()
    first[0].label = 'mutated'
    first.length = 0
    const second = board.list()
    expect(second).toHaveLength(1)
    expect(second[0].label).toBe('w')
  })

  it('从持久化快照恢复且保留时间与终态字段', () => {
    const board = createStatusBoard({
      now: fixedClock(),
      initialEntries: [{
        jobId: 'persisted-1',
        kind: 'mat-slurm',
        label: 'gaussian opt @11250 #700',
        clusterId: '11250',
        startedAt: 500,
        updatedAt: 800,
        phase: 'settled',
        task: 'opt',
        workdir: '/home/u/work',
        settledAt: 800,
        outcomeStatus: 'completed',
        files: ['job.log'],
      }],
    })

    expect(board.list()).toEqual([{
      jobId: 'persisted-1',
      kind: 'mat-slurm',
      label: 'gaussian opt @11250 #700',
      clusterId: '11250',
      startedAt: 500,
      updatedAt: 800,
      phase: 'settled',
      task: 'opt',
      workdir: '/home/u/work',
      settledAt: 800,
      outcomeStatus: 'completed',
      files: ['job.log'],
    }])
  })

  it('恢复时仍执行 settled 保留上限', () => {
    const entry = (jobId: string, settledAt: number) => ({
      jobId,
      kind: 'mat-slurm',
      label: jobId,
      clusterId: '11250',
      startedAt: 1,
      updatedAt: settledAt,
      phase: 'settled' as const,
      settledAt,
      outcomeStatus: 'completed' as const,
    })
    const board = createStatusBoard({
      maxSettled: 2,
      initialEntries: [entry('a', 10), entry('b', 20), entry('c', 30)],
    })

    expect(board.list().map((item) => item.jobId)).toEqual(['b', 'c'])
  })

  it('remove 移除条目', () => {
    const board = createStatusBoard({ now: fixedClock() })
    board.upsert('j1', { kind: 'mat-watch', label: 'w', clusterId: '11250', startedAt: 5 })
    board.remove('j1')
    expect(board.list()).toEqual([])
  })
})
