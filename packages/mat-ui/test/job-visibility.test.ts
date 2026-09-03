import { describe, expect, it } from 'vitest'
import { jobsForSession } from '../src/client/status-model'

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
