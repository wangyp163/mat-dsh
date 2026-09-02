import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('native HPC task details tab', () => {
  it('registers a task tab and routes task and file actions through native details navigation', async () => {
    const index = await source('index.tsx')
    const dock = await source('StatusDock.tsx')
    const panel = await source('TaskDetailsPanel.tsx')

    expect(index).toContain("id: 'mat-task'")
    expect(index).toContain("label: '任务'")
    expect(dock).toContain("openDetailsTab?.('mat-task')")
    expect(panel).toContain("openDetailsTab('mat-files')")
    expect(panel).toContain('打开文件')
  })

  it('shows task state, metadata, failures, and output summary', async () => {
    const panel = await source('TaskDetailsPanel.tsx')

    expect(panel).toContain('/mat-status/jobs')
    expect(panel).toContain('monitorMetadata')
    expect(panel).toContain('job.detail')
    expect(panel).toContain('job.files')
  })

  it('removes the duplicate turn-tail computation summary', async () => {
    const index = await source('index.tsx')
    const style = await source('style.ts')

    expect(index).not.toContain('ResultTail')
    expect(index).not.toContain('conversation.chat.turnTail')
    expect(style).not.toContain('.mat-result-tail')
  })
})
