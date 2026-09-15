import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('三层树：工作区 → 会话 → 作业（09-07）', () => {
  it('工作区展开时按 cwd 反查会话清单（/mat-files/workspace-sessions）', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('/mat-files/workspace-sessions')
    expect(panel).toContain('toggleSessionRow')
  })

  it('会话分组：ownerSession 归属分桶，本会话置顶，无作业的其它会话不列，未归属兜底', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('sessionGroups')
    expect(panel).toMatch(/ownerSession/)
    expect(panel).toContain('未归属会话')
    expect(panel).toContain('本会话')
  })




  it('作业清单轮询：挂载后每 5s 刷新（否则提交后子树永不出现在已挂载面板）', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toMatch(/setInterval[\s\S]{0,80}5_000/)
    expect(panel).toMatch(/clearInterval/)
  })

  it('删除解禁：任意范围选中可删（含工作区），多范围逐个删，两段式确认保留', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).not.toContain('删除仅支持单一作业范围')
    expect(panel).toContain('deleteSelection(scope')
    expect(panel).toMatch(/for \(const scope of selectionsByScope\) \{[\s\S]*?deleteSelection/)
    expect(panel).toContain('confirmingDelete')
  })

  it('排序：会话行在工作区散文件之前（先看归属再看散件）', async () => {
    const panel = await source('FileManagerPanel.tsx')
    const sessions = panel.indexOf('sessionGroups.map')
    const files = panel.indexOf('rows.map(entry')
    expect(sessions).toBeGreaterThan(-1)
    expect(files).toBeGreaterThan(-1)
    expect(sessions).toBeLessThan(files)
  })

  it('作业行嵌套在会话行之下：作业行 depth 2、其文件行 entry.depth + 3', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('mat-files__row--session')
    expect(panel).toMatch(/entry\.depth \+ 3/)
    expect(panel).toContain('无跟踪作业')
  })
})

describe('标签样式与默认折叠（09-07 用户点名）', () => {
  it('类型标签提为行首 chip（三色分型），名字不再混入前缀词，行尾重复徽章移除', async () => {
    const panel = await source('FileManagerPanel.tsx')
    const style = await source('style.ts')
    expect(panel).toContain('mat-files__tag--workspace')
    expect(panel).toContain('mat-files__tag--session')
    expect(panel).toContain('mat-files__tag--job')
    // 名字里不再拼类型词（scopeLabel 只出名字本身）
    expect(panel).not.toMatch(/`工作区\$\{/)
    expect(panel).not.toContain('会话 · ')
    expect(panel).not.toContain('作业 ${')
    expect(panel).not.toContain('mat-files__kind-label')
    expect(style).toContain('.mat-files__tag{')
    expect(style).toContain('.mat-files__tag--workspace{')
    expect(style).toContain('.mat-files__tag--session{')
    expect(style).toContain('.mat-files__tag--job{')
  })

  it('作业目录默认不展开：聚焦用 focus（不展开），仅跨面板 selectJob 才展开', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('fileManagerState.focus(')
    // 面板内部初值/新作业不再调 select（select 会顺带展开）
    expect(panel).not.toMatch(/fileManagerState\.select\(/)
  })
})

describe('作业 chip 状态着色 + 定位居中（09-07 用户点名）', () => {
  it('chip 按状态分色：running 蓝、failed 红、completed 绿（数据取 slurm/终态）', async () => {
    const panel = await source('FileManagerPanel.tsx')
    const style = await source('style.ts')
    expect(panel).toContain('jobTagTone')
    expect(panel).toContain('mat-files__tag--job-${jobTagTone(job)}')
    expect(style).toContain('.mat-files__tag--job-running{')
    expect(style).toContain('.mat-files__tag--job-failed{')
    expect(style).toContain('.mat-files__tag--job-done{')
  })

  it('入口点击后目标作业子树展开并滚动居中（scrollIntoView center）', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('scrollIntoView')
    expect(panel).toContain("block: 'center'")
    expect(panel).toContain('data-scope')
  })
})

describe('下载/同步双动作（09-07 用户点名：本地工作树落点）', () => {
  it('工具条区分「同步到本地」（进作业镜像）与「导出」（浏览器下载）', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('syncSelection')
    expect(panel).toContain("'/mat-files/sync'")
    expect(panel).toContain('同步到本地')
    expect(panel).toContain('导出')
  })

  it('同步仅对作业 scope 可用（工作区本身即本地，无远端可拉）；完成后刷新徽章', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('syncDisabledReason')
    expect(panel).toMatch(/isSessionScope[\s\S]{0,200}同步/)
    expect(panel).toMatch(/loadScope\(scope\)/)
  })
})
