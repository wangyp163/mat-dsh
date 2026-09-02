import { beforeEach, describe, expect, it } from 'vitest'
import { fileManagerState } from '../src/client/file-manager-state'

describe('file manager state', () => {
  beforeEach(() => {
    fileManagerState.reset()
  })

  it('opens the native files tab by default and preserves active job', () => {
    fileManagerState.open('job-1')
    expect(fileManagerState.snapshot()).toMatchObject({
      open: true,
      selectedJobId: 'job-1',
      activeTab: 'files',
    })
    fileManagerState.selectTab('details')
    fileManagerState.close()
    fileManagerState.open()
    expect(fileManagerState.snapshot()).toMatchObject({
      open: true,
      selectedJobId: 'job-1',
      activeTab: 'files',
    })
  })

  it('keeps expanded directories and selected paths isolated per job', () => {
    fileManagerState.open('job-1')
    fileManagerState.toggleExpanded('results')
    fileManagerState.selectPath('results/result.json')
    fileManagerState.open('job-2')
    expect(fileManagerState.snapshot()).toMatchObject({ expanded: [], selectedPaths: [] })
    fileManagerState.open('job-1')
    expect(fileManagerState.snapshot()).toMatchObject({
      expanded: ['results'], selectedPaths: ['results/result.json'],
    })
  })

  it('supports durable primary-file pins and unpins', () => {
    fileManagerState.open('job-1')
    fileManagerState.pin('results/result.json')
    expect(fileManagerState.snapshot().pins).toEqual(['results/result.json'])
    fileManagerState.unpin('results/result.json')
    expect(fileManagerState.snapshot().pins).toEqual([])
    fileManagerState.setPins(['result.log', 'result.log', 'output/data.json'])
    expect(fileManagerState.snapshot().pins).toEqual(['result.log', 'output/data.json'])
  })

  it('emits state updates and tracks refresh/download status', () => {
    const snapshots: unknown[] = []
    const dispose = fileManagerState.subscribe(() => snapshots.push(fileManagerState.snapshot()))
    fileManagerState.open('job-1')
    fileManagerState.beginRefresh()
    fileManagerState.beginDownload(['result.json'])
    fileManagerState.finishDownload()
    dispose()
    expect(snapshots).toHaveLength(4)
    expect(fileManagerState.snapshot()).toMatchObject({ refresh: 'idle', download: 'idle' })
  })
})
