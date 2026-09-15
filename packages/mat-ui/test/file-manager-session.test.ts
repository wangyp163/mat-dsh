import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('统一虚拟树：工作区与作业共存（⑨ 的演进形态；09-07 语义修正：共享单位是工作区非会话）', () => {
  it('工作区是 scopeOrder 固定首位（session pseudo-key 仅为服务端解析 cwd 的通道），不再依赖"零作业"才可见', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('session:${sessionId}')
    expect(panel).toContain('scopeOrder')
    expect(panel).toMatch(/\.\.\.\(sessionKey !== undefined \? \[sessionKey\] : \[\]\)/)
  })

  it('命名诚实：scope 行标「工作区」并带工作区名（basename），不再误称"会话工作区"', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('>工作区</span>')
    expect(panel).not.toContain('会话工作区')
  })

  it('位置行按聚焦 scope 切换：工作区=本地工作目录（rootPath），作业=localWorkspace', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('本地工作目录')
    expect(panel).toContain('focusedRoot')
    expect(panel).toContain('focusedJob.localWorkspace')
  })

  it('预览 URL 支持 session 目标（content 路由 session 参数）', async () => {
    const viewer = await source('ViewerPanel.tsx')
    expect(viewer).toContain("startsWith('session:')")
    expect(viewer).toContain('session=')
  })
})
