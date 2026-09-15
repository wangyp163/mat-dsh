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

  it('composes the task tab as a content-following spec sheet', async () => {
    const panel = await source('TaskDetailsPanel.tsx')
    const style = await source('style.ts')
    // 元数据进 layer-1 规格卡；文件数与动作合成页脚行（不再靠 grid justify-self 定位）。
    expect(panel).toContain('mat-task-details__footer')
    expect(style).toContain('.mat-task-details__footer{')
    expect(style).toContain('var(--dsw-alias-bg-layer-1)')
    // 打开文件按钮贴近内容，不吸底（margin-top:auto 会把它钉到面板最底）。
    expect(style).not.toContain('margin-top:auto')
    // 字阶（09-04 美化定稿）：大写小标签 10px；值默认无衬线 500，
    // 纯数值/ID 走等宽变体（dd--mono）——文字值不再披打字机字体。
    expect(style).toContain('letter-spacing:.08em;text-transform:uppercase')
    expect(style).toContain('font:500 12px/1.45 var(--dsw-font-family);font-variant-numeric:tabular-nums')
    expect(style).toContain('font:11.5px/1.45 ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums')
  })

  it('renders the red failure block only for failed jobs, never for completed ones', async () => {
    const panel = await source('TaskDetailsPanel.tsx')
    // 红色失败块按失败态渲染；正确完成的作业不得出现红字红底（此前无条件跟着 job.detail 渲染）。
    expect(panel).toContain("stateOf(job) === 'error'")
    expect(panel).not.toMatch(/\{job\.detail !== undefined && <p/)
  })

  it('美化：值字体分型（mono 变体）+ status/converged 语义色点', async () => {
    const panel = await source('TaskDetailsPanel.tsx')
    const style = await source('style.ts')
    expect(panel).toContain('mat-task-details__dd--mono')
    expect(panel).toContain('metadataStateOf')
    expect(panel).toContain('<StateDot')
    expect(style).toContain('.mat-task-details__dd--state{')
    expect(style).toContain('.mat-task-details__dd--done{')
    expect(style).toContain('.mat-task-details__dd--error{')
  })

  it('美化：打开文件按钮带文件夹图标（icon 走宿主 Button 原生位）', async () => {
    const panel = await source('TaskDetailsPanel.tsx')
    expect(panel).toContain('IconFolderOpen16')
    expect(panel).toMatch(/icon=\{/)
    // 继续交出按钮外观（不得用插件元素选择器压宿主按钮模块类）。
    const style = await source('style.ts')
    expect(style).not.toContain('.mat-task-details button')
  })
})
