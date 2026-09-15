import { describe, expect, it } from 'vitest'
import { jobOptionLabel, jobsForSession, monitorMetadata } from '../src/client/status-model'

describe('jobsForSession', () => {
  it('isolates the board per session: only jobs owned by the current session show', () => {
    const jobs = [
      { jobId: 'a', ownerSession: 's1' },
      // 同工作区里其它会话的作业也不进面板（会话相互隔离）。
      { jobId: 'b', ownerSession: 's2' },
      { jobId: 'c', ownerSession: 's1' },
      // 无主作业不进面板。
      { jobId: 'x' },
    ]
    expect(jobsForSession(jobs, 's1').map(job => job.jobId)).toEqual(['a', 'c'])
  })

  it('returns an empty list without a current session', () => {
    expect(jobsForSession([{ jobId: 'a', ownerSession: 's1' }], undefined)).toEqual([])
  })
})

describe('作业展示标识（真实 Slurm 作业号优先，内部板键不进用户视野）', () => {
  it('watch 条目：选项就是 Slurm 作业号本身，不拼 ×N/括号噪声', () => {
    expect(jobOptionLabel({
      jobId: 'mat-watch-1-2', label: '11250 ×4 jobs',
      slurm: [{ id: '120763977', state: 'COMPLETED' }, { id: '120764126', state: 'COMPLETED' }],
    })).toBe('120763977, 120764126')
    expect(jobOptionLabel({
      jobId: 'mat-watch-2', label: '11250 ×1 jobs',
      slurm: [{ id: '120780683', state: 'COMPLETED' }],
    })).toBe('120780683')
  })

  it('gaussian 条目：label 已含 Slurm 号则原样保留', () => {
    expect(jobOptionLabel({
      jobId: 'mat-slurm-1', label: 'gaussian opt+freq @11250 #120780683',
      slurm: [{ id: '120780683', state: 'COMPLETED' }],
    })).toBe('gaussian opt+freq @11250 #120780683')
  })

  it('无 slurm 投影时退 label/jobId', () => {
    expect(jobOptionLabel({ jobId: 'x', label: 'plain' })).toBe('plain')
    expect(jobOptionLabel({ jobId: 'x' })).toBe('x')
  })

  it('元数据 job ID 行列出全部 Slurm 号，内部板键只在无投影时兜底，job number 行删除', () => {
    const rows = monitorMetadata({
      jobId: 'mat-watch-1-2', phase: 'settled', startedAt: 0, updatedAt: 0,
      slurm: [{ id: '120763977', state: 'COMPLETED' }, { id: '120765445', state: 'COMPLETED' }],
    })
    expect(rows.find(([label]) => label === 'job ID')?.[1]).toBe('120763977, 120765445')
    expect(rows.some(([label]) => label === 'job number')).toBe(false)
    const bare = monitorMetadata({ jobId: 'mat-watch-2', phase: 'monitoring', startedAt: 0, updatedAt: 0 })
    expect(bare.find(([label]) => label === 'job ID')?.[1]).toBe('mat-watch-2')
  })
})
