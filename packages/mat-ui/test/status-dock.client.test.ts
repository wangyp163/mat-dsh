import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'


const source = () => readFile(new URL('../src/client/StatusDock.tsx', import.meta.url), 'utf8')

describe('compact computational status strip', () => {
  it('renders one actionable status entry instead of a monitor card list', async () => {
    const text = await source()
    expect(text).toContain('onOpenTask')
    expect(text).toContain('role="status"')
    expect(text).toContain('mat-status-strip')
    expect(text).not.toContain('setCollapsed')
    expect(text).not.toContain('mat-status-card')
    expect(text).not.toContain('COMPUTATIONAL MONITOR')
  })

  it('isolates the strip to the current session and stays hidden before submission', async () => {
    const text = await source()
    expect(text).toContain("PropsRuntime<'conversation.input.dock'>")
    expect(text).toContain('sessionId')
    // jobId 与会话相互隔离：只认 ownerSession === 当前会话的作业。
    expect(text).toContain('jobsForSession(jobs, sessionId)')
    expect(text).not.toContain('ownSessionScope')
    expect(text).toContain('if (selected === undefined) return null')
    expect(text).toContain('<select')
    expect(text).toContain('visible.map(job => <option')
  })

  it('offers explicit launcher buttons that pull up the details side panel', async () => {
    const text = await source()
    expect(text).toContain("openDetailsTab?.('mat-task')")
    expect(text).toContain("openDetailsTab?.('mat-files')")
    expect(text).toContain('打开文件面板')
  })

  it('uses host Button variants and the global font, not raw buttons', async () => {
    const text = await source()
    const style = await readFile(new URL('../src/client/style.ts', import.meta.url), 'utf8')
    expect(text).toContain('variant="outline"')
    expect(text).not.toContain('<button')
    // 宿主原生变体接管按钮外观：插件不再自带 strip 按钮样式（会以元素选择器压过模块类）。
    expect(style).not.toContain('.mat-status-strip>button')
    // 表单控件不吃继承字体：select 必须显式声明全局字体栈。
    expect(style).toContain('.mat-status-strip select{')
    expect(style).toContain('var(--dsw-font-family)')
  })
})
