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

  it('工作区树 5s 轮询保鲜：agent 中途写入/下载的文件（如 POSCAR）无需手动刷新即可见；只轮询工作区 scope', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('工作区树自动保鲜')
    expect(panel).toMatch(/setInterval[\s\S]{0,400}5_000/)
    // 闸门：scope 收起时不发请求；签名未变时跳过 setTrees。
    expect(panel).toContain('live.openScopes.includes(sessionKey)')
    expect(panel).toContain('pollSignatures')
    // 作业 scope 不进轮询（远端 listing 开销大，维持手动刷新）。
    expect(panel).toMatch(/getTree\(sessionKey, path\)/)
  })

  it('会话文件归档（按会话分档）：根列表携带 sessionFiles，会话分组渲染归档文件行', async () => {
    const panel = await source('FileManagerPanel.tsx')
    // 数据面：接口声明 + getTree 显式挑字段（不挑会被丢）+ 状态容器。
    expect(panel).toContain('sessionFiles?: Record<string, string[]>')
    expect(panel).toContain('sessionFilesByScope')
    expect(panel).toMatch(/path === '' && tree\.sessionFiles !== undefined/)
    // 渲染面：归档行挂会话分组下（与作业行同级），点击走 openFile 沉浸预览；计数含文件。
    expect(panel).toContain('sessionFilesByScope[scope]?.[session.sessionId]')
    expect(panel).toContain('{sessionJobs.length + archived.length}')
    expect(panel).toMatch(/archived\.map[\s\S]{0,900}openFile\(path, scope\)/)
    // 空态语义：无文件且无作业才提示。
    expect(panel).toContain('无文件与作业')
    expect(panel).not.toContain('无跟踪作业')
  })

  it('窄视口右栏腾位：<1220px 时宿主求解器把右栏压回 0（展开是死按钮），打开前须先收侧栏腾位', async () => {
    const helper = await source('layout-room.ts')
    expect(helper).toContain('RAIL_FLOOR')
    expect(helper).toMatch(/toggleSidebar\(\)/)
    expect(helper).toMatch(/layout\.openDetails\(\)/)
    // 腾位判据与宿主契约一致：侧栏轨 + CENTER_MIN(640) + DETAILS_MIN(300) 超出视口且收起后可行。
    expect(helper).toContain('sidebar + 640 + 300 > window.innerWidth')
    expect(helper).toContain('window.innerWidth >= RAIL_FLOOR')
    // 三个入口都接上腾位助手：悬浮展开钮、状态卡「文件」、任务页「打开文件」。
    const toggle = await source('DetailsRailToggle.tsx')
    expect(toggle).toContain('openDetailsWithRoom(layout)')
    const dock = await source('StatusDock.tsx')
    expect(dock).toContain('openDetailsWithRoom(layout)')
    const task = await source('TaskDetailsPanel.tsx')
    expect(task).toContain('openDetailsWithRoom(layout)')
    // 注册点把 ctx.layout 传进 dock/task（helper 需要动作面）。
    const entry = await source('index.tsx')
    expect(entry).toMatch(/<StatusDock \{\.\.\.props\} layout=\{ctx\.layout\}/)
    expect(entry).toMatch(/<TaskDetailsPanel \{\.\.\.props\} layout=\{ctx\.layout\}/)
  })
})
