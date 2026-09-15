import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileManagerState } from '../src/client/file-manager-state'

describe('fileManagerState 统一虚拟树：scope 参数化 + openScopes', () => {
  it('路径级动作带 scope 参数时作用于目标 scope，不动焦点 scope 的视图态', () => {
    fileManagerState.reset()
    fileManagerState.selectJob('11250:120901514')
    fileManagerState.selectPath('result.log', 'session:s1')
    fileManagerState.toggleExpanded('plots', 'session:s1')
    const snap = fileManagerState.snapshot()
    expect(snap.selectedPaths).toEqual([]) // 焦点（作业）未被波及
    expect(snap.scopes['session:s1']).toMatchObject({ selectedPaths: ['result.log'], expanded: ['plots'] })
  })

  it('openScope/closeScope/toggleScope 管理虚拟根展开；selectJob 顺带开子树（跨面板联动）', () => {
    fileManagerState.reset()
    fileManagerState.openScope('session:s1')
    expect(fileManagerState.snapshot().openScopes).toEqual(['session:s1'])
    fileManagerState.selectJob('11250:120901514')
    const snap = fileManagerState.snapshot()
    expect(snap.openScopes).toContain('11250:120901514')
    expect(snap.selectedJobId).toBe('11250:120901514')
    fileManagerState.closeScope('session:s1')
    expect(fileManagerState.snapshot().openScopes).not.toContain('session:s1')
    fileManagerState.toggleScope('11250:120901514')
    expect(fileManagerState.snapshot().openScopes).not.toContain('11250:120901514')
    fileManagerState.reset()
    expect(fileManagerState.snapshot().openScopes).toEqual([])
  })
})

describe('FileManagerPanel 统一虚拟树渲染（源码契约）', () => {
  const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

  it('scopeOrder：会话工作区固定首位，其后按板序接作业；新作业首次出现自动开+聚焦', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('scopeOrder')
    expect(panel).toMatch(/sessionKey[^]*visible\.map/)
    expect(panel).toContain('seenRef')
    expect(panel).toContain('openScope')
  })

  it('多 scope 子树：每 scope 独立树状态与目录加载；scope 行是虚拟根（depth 0），子树行缩进+1', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('Record<string, WorkspaceEntry[]>')
    expect(panel).toMatch(/loadDirectory\([^)]*,/)
    expect(panel).toMatch(/depth \+ 1|entry\.depth \+ 1/)
  })

  it('能力收敛：下载聚合多 scope 逐个请求；删除仅限单一作业 scope；固定仅作业子树', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('selectionsByScope')
    expect(panel).toMatch(/scope\.startsWith\('session:'\)/)
  })
})

describe('fileManagerState.focus：聚焦不展开（作业默认折叠）', () => {
  it('focus 只改焦点不动 openScopes；selectJob 仍顺带展开（跨面板联动保留）', () => {
    fileManagerState.reset()
    fileManagerState.focus('11250:120901514')
    expect(fileManagerState.snapshot().selectedJobId).toBe('11250:120901514')
    expect(fileManagerState.snapshot().openScopes).toEqual([])
    fileManagerState.selectJob('11250:120901514')
    expect(fileManagerState.snapshot().openScopes).toEqual(['11250:120901514'])
  })
})
