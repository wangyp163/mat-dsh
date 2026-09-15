import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { viewerState } from '../src/client/viewer-state'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('viewerState 沉浸态语义', () => {
  it('open 不进沉浸；enter/exit 显式开关；clear 连带退出', () => {
    viewerState.reset()
    viewerState.open('11250:700', 'opt.xyz', 'structure')
    expect(viewerState.snapshot().immersive).toBe(false)
    viewerState.enterImmersive()
    expect(viewerState.snapshot().immersive).toBe(true)
    viewerState.exitImmersive()
    expect(viewerState.snapshot().immersive).toBe(false)
    viewerState.enterImmersive()
    viewerState.clear()
    expect(viewerState.snapshot().immersive).toBe(false)
  })
})

describe('沉浸查看层（shell.overlay 第二 occupant）', () => {
  it('注册 id=mat-viewer-overlay 的 shell.overlay occupant（list 插槽多占合法）', async () => {
    const index = await source('index.tsx')
    expect(index).toContain("'shell.overlay'")
    expect(index).toContain("id: 'mat-viewer-overlay'")
    expect(index).toContain('ViewerOverlay')
  })

  it('09-07 起：入口由 FileManagerPanel 直开（enterImmersive），工具条只留收起', async () => {
    const panel = await source('ViewerPanel.tsx')
    const files = await source('FileManagerPanel.tsx')
    expect(files).toContain('enterImmersive()')
    expect(panel).toContain('exitImmersive')
    expect(panel).toContain("variant === 'overlay'")
    expect(panel).not.toContain("variant === 'panel'")
  })

  it('沉浸层是对话框语义：role=dialog + aria-modal + ESC 收起 + 点背景收起', async () => {
    const overlay = await source('ViewerOverlay.tsx')
    expect(overlay).toContain('role="dialog"')
    expect(overlay).toContain('aria-modal')
    expect(overlay).toContain("'Escape'")
    expect(overlay).toContain('exitImmersive')
  })

  it('NGL 自适应底座：容器尺寸变化触发 handleResize（修 rail 拖宽画布拉伸）', async () => {
    const panel = await source('ViewerPanel.tsx')
    expect(panel).toContain('ResizeObserver')
    expect(panel).toContain('handleResize')
  })

  it('沉浸层样式：fixed 全屏遮罩 + 大卡片画布', async () => {
    const style = await source('style.ts')
    expect(style).toContain('.mat-view-overlay{')
    expect(style).toContain('position:fixed')
    expect(style).toContain('.mat-view-overlay__card{')
  })
})
