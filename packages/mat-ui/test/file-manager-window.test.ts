import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('native HPC file details tab', () => {
  it('registers the file manager as an additive native details tab, not an overlay', async () => {
    const index = await source('index.tsx')
    const panel = await source('FileManagerPanel.tsx')
    expect(index).toContain('conversation.details.tab')
    // #17 起右缘悬浮钮合法占用 shell.overlay（仅 mat-rail-toggle 一个入口）；
    // 文件面板本身仍必须是 details tab，不回到浮层启动器形态。
    expect(panel).not.toContain('mat-file-manager-launcher')
    expect(panel).toContain('role="tree"')
  })

  it('uses the unified workspace tree and exposes primary files', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('/mat-files/tree?')
    expect(panel).toContain('primary')
    expect(panel).toContain('selectedPaths')
    expect(panel).toContain('loadDirectory(entry.path)')
    expect(panel).toContain('/mat-files/download')
  })

  it('surfaces a degraded remote listing as a warning instead of hiding the local tree', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('warning')
    expect(panel).toContain('mat-files__warning')
  })

  it('surfaces in-flight remote work with a timed loading state instead of silence', async () => {
    const panel = await source('FileManagerPanel.tsx')
    const style = await source('style.ts')
    expect(panel).toContain('mat-files__loading')
    expect(panel).toContain('aria-busy')
    expect(panel).toContain('下载中')
    expect(panel).toContain('远端响应缓慢')
    expect(panel).toContain('beginExpand')
    expect(style).toContain('@keyframes')
  })

  it('renders the cached tree instantly while revalidating, and reads job selection live', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('treeCache')
    expect(panel).toContain('fileManagerState.snapshot().selectedJobId')
  })

  it('keeps jobs visible across session switches (own first) and opens its local workspace', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain("PropsRuntime<'conversation.details.tab'>")
    expect(panel).toContain('sessionId')
    // jobId 与会话相互隔离：只认 ownerSession === 当前会话的作业。
    expect(panel).toContain('jobsForSession(jobs, sessionId)')
    expect(panel).not.toContain('ownSessionScope')
    expect(panel).toContain('openWorkspace')
    expect(panel).toContain('job.localWorkspace')
    expect(panel).toContain('openFile(path)')
    expect(panel).toContain('openFile(entry.path)')
    // 点击文件的预览已迁到「查看」tab：不再 POST /mat-files/open、不再 openWorkspace 单文件。
    expect(panel).not.toContain("fetch('/mat-files/open'")
    expect(panel).not.toContain('openWorkspace(payload.path)')
    expect(panel).not.toContain("openWorkspace?.('')")
    expect(panel).toContain('/mat-files/tree?')
  })

  it('uses DSH-native visual primitives and attachment-only downloads', async () => {
    const index = await source('index.tsx')
    const panel = await source('FileManagerPanel.tsx')
    const style = await source('style.ts')
    expect(panel).toContain('@deepseek-ai/dsh-client-ui-primitives')
    expect(style).not.toContain('mat-file-manager-launcher')
    expect(style).not.toContain('mat-file-manager{position:absolute')
    expect(style).not.toContain('academic')
    expect(index).not.toContain('overrideTokens')
  })

  it('styles the chrome as a quiet instrument panel: pills, hairlines, mono paths', async () => {
    const style = await source('style.ts')
    // 位置条：大写小标签 + 等宽路径 + 底缘发丝线；主要文件 chips 与来源角标走药丸。
    expect(style).toContain('.mat-files__location{display:flex;align-items:center;gap:8px')
    expect(style).toContain('.mat-files__chips button{padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px')
    expect(style).toContain('.mat-files__origin{flex:none;padding:1px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px')
    // 状态行收为面板页脚（发丝上边），不再是裸 p。
    expect(style).toContain('.mat-files__status{margin:0;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1)')
  })
})
