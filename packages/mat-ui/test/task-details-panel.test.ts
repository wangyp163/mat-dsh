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
    expect(panel).toContain("openDetailsTab?.('mat-files')")
    expect(panel).toContain('fileManagerState.selectJob(selectedJobId)')
    expect(panel).toContain('打开文件')
  })

  it('shows task state, metadata, failures, and output summary', async () => {
    const panel = await source('TaskDetailsPanel.tsx')

    expect(panel).toContain('/mat-status/jobs')
    // jobId 与会话相互隔离：只认 ownerSession === 当前会话的作业。
    expect(panel).toContain('jobsForSession(jobs, sessionId)')
    expect(panel).not.toContain('ownSessionScope')
    expect(panel).toContain('monitorMetadata')
    expect(panel).toContain('job.detail')
    expect(panel).toContain('job.files')
    expect(panel).toContain('<select')
    expect(panel).toContain('visible.map(value => <option')
    expect(panel).not.toContain('const job = jobs[jobs.length - 1]')
  })

  it('removes the duplicate turn-tail computation summary', async () => {
    const index = await source('index.tsx')
    const style = await source('style.ts')

    expect(index).not.toContain('ResultTail')
    expect(index).not.toContain('conversation.chat.turnTail')
    expect(style).not.toContain('.mat-result-tail')
  })

  it('styles actions with host Button variants and the global font', async () => {
    const panel = await source('TaskDetailsPanel.tsx')
    const style = await source('style.ts')
    expect(panel).toContain('variant="primary"')
    expect(panel).not.toContain('<button')
    // 插件自带元素选择器会压过宿主按钮模块类：交出按钮外观，仅保留字体/布局。
    expect(style).not.toContain('.mat-task-details button')
    expect(style).toContain('.mat-task-details{')
  })

  it('composes the task tab as a footer-anchored spec sheet', async () => {
    const panel = await source('TaskDetailsPanel.tsx')
    const style = await source('style.ts')
    // 元数据进 layer-1 规格卡；文件数与动作合成页脚行（不再靠 grid justify-self 定位）。
    expect(panel).toContain('mat-task-details__footer')
    expect(style).toContain('.mat-task-details__footer{')
    expect(style).toContain('var(--dsw-alias-bg-layer-1)')
    // 字阶：大写小标签 + 等宽定宽数字（数据前置的仪器面板语言）。
    expect(style).toContain('letter-spacing:.08em;text-transform:uppercase')
    expect(style).toContain('font:11px/1.4 ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums')
  })
})
