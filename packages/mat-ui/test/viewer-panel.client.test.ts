import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { viewerState } from '../src/client/viewer-state'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('viewer state module', () => {
  it('tracks the current file through open → pending → finished', () => {
    viewerState.reset()
    viewerState.open('j1', 'POSCAR', 'structure')
    let snapshot = viewerState.snapshot()
    expect(snapshot.current).toEqual({ jobId: 'j1', path: 'POSCAR', kind: 'structure' })
    expect(snapshot.status).toBe('pending')
    viewerState.finish()
    snapshot = viewerState.snapshot()
    expect(snapshot.status).toBe('idle')
    expect(snapshot.error).toBeUndefined()
  })

  it('keeps the failing file visible with the error message', () => {
    viewerState.reset()
    viewerState.open('j1', 'a.png', 'image')
    viewerState.finish(new Error('content HTTP 415'))
    const snapshot = viewerState.snapshot()
    expect(snapshot.current?.path).toBe('a.png')
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toBe('content HTTP 415')
    viewerState.clear()
    expect(viewerState.snapshot().current).toBeUndefined()
    expect(viewerState.snapshot().status).toBe('idle')
  })

  it('notifies subscribers on transitions', () => {
    viewerState.reset()
    const events: string[] = []
    const unsubscribe = viewerState.subscribe(() => { events.push('tick') })
    viewerState.open('j1', 'm.xyz', 'structure')
    viewerState.finish()
    unsubscribe()
    viewerState.clear()
    expect(events).toHaveLength(2)
  })
})

describe('viewer details tab wiring', () => {
  it('registers mat-view as an additive details tab after the file tab', async () => {
    const index = await source('index.tsx')
    expect(index).toContain("id: 'mat-view'")
    expect(index).toContain('order: 20')
    expect(index).toContain('label: \'查看\'')
    expect(index).toContain('ViewerPanel')
    expect(index.indexOf("id: 'mat-view'")).toBeGreaterThan(index.indexOf("id: 'mat-files'"))
  })

  it('keeps NGL loading lazy: script injection inside the component, never at module scope', async () => {
    const panel = await source('ViewerPanel.tsx')
    const loader = await source('load-script.ts')
    expect(panel).toContain("loadScript('/mat-vendor/ngl.js')")
    // 调用发生在组件 effect 内，而不是模块顶层（bundle.test 在 vm 里跑 factory，顶层 document 会炸）。
    expect(panel).toMatch(/useEffect[\s\S]*loadScript\('\/mat-vendor\/ngl\.js'\)/)
    expect(loader).toContain("createElement('script')")
    // 幂等：并发去重，不重复插桩。
    expect(loader).toMatch(/(Map|pending|cache)/)
    expect(loader).toContain('src')
  })

  it('drives NGL with unit cell, toolbar controls, and full disposal', async () => {
    const panel = await source('ViewerPanel.tsx')
    expect(panel).toContain('NGL.Stage')
    expect(panel).toContain("addRepresentation('unitcell')")
    expect(panel).toContain('ball+stick')
    expect(panel).toContain('setSpin')
    expect(panel).toContain('autoView')
    expect(panel).toContain('dispose')
    // vendored NGL 未注册 xyz 解析器：一切结构统一 structureBody 转 CIF 喂入。
    expect(panel).toContain("structureBody(target.path, source)")
    expect(panel).toContain("{ ext: 'cif', defaultRepresentation: false }")
    // 分子（xyz）没有真实晶胞：不画假盒子。
    expect(panel).toContain('unitcellRef.current = !isXyz(target.path)')
  })

  it('previews text with truncation and copy, images and pdf via content URLs', async () => {
    const panel = await source('ViewerPanel.tsx')
    expect(panel).toContain('/mat-files/content?')
    expect(panel).toContain('writeClipboard')
    expect(panel).toContain('512 * 1024')
    expect(panel).toContain('<img')
    expect(panel).toContain('<iframe')
  })
})

describe('file manager click-through into the viewer', () => {
  it('routes previewable clicks to viewerState plus the mat-view tab', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('classifyFile')
    expect(panel).toContain("viewerState.open(")
    expect(panel).toContain("openTab?.('mat-view')")
  })

  it('stops opening files through the host workspace and reports unsupported types', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).not.toContain("fetch('/mat-files/open'")
    expect(panel).not.toContain('openWorkspace(payload.path)')
    expect(panel).toContain('该类型暂不支持预览')
    // 目录按钮保留宿主域行为：openWorkspace 只服务本地工作区目录。
    expect(panel).toContain('job.localWorkspace')
  })
})

describe('viewer styles', () => {
  it('fills the tab with a scrollable text pane and contained media', async () => {
    const style = await source('style.ts')
    expect(style).toContain('mat-view{')
    expect(style).toContain('mat-view__canvas')
    expect(style).toContain('mat-view__text')
    expect(style).toContain('object-fit:contain')
  })

  it('renders toolbars in the global font with non-gray buttons', async () => {
    const panel = await source('ViewerPanel.tsx')
    const files = await source('FileManagerPanel.tsx')
    const style = await source('style.ts')
    // 宿主 toolbar 变体 = 灰底黑字（button-tool-bar-fill），全线弃用。
    expect(panel).not.toContain('variant="toolbar"')
    expect(files).not.toContain('variant="toolbar"')
    // 选中态走宿主 primary（品牌蓝），未选中走 outline（透明+描边）。
    expect(panel).toContain("variant={style === 'ball+stick' ? 'primary' : 'outline'}")
    expect(panel).toContain("variant={spin ? 'primary' : 'outline'}")
    expect(panel).toContain("variant=\"outline\"")
    // 字体与全局一致：工具栏用 --dsw-font-family（应用字体栈），标题 500 字重。
    expect(style).toContain('var(--dsw-font-family)')
    expect(style).toContain('font:500 12px/16px var(--dsw-font-family)')
  })

  it('groups representation toggles and badges the file kind', async () => {
    const panel = await source('ViewerPanel.tsx')
    const style = await source('style.ts')
    // 球棍/线框/填充三键成组（细分隔线与自转/重置动作键区隔）；文件类型徽标随标题。
    expect(panel).toContain('mat-view__seg')
    expect(panel).toContain('mat-view__kind')
    expect(style).toContain('.mat-view__seg{')
    expect(style).toContain('.mat-view__kind{')
    // 文本预览是文档卡片：layer-1 底 + 发丝边，不是裸 pre。
    expect(style).toContain('mat-view__text{flex:1;min-height:0;overflow:auto;margin:10px 12px 12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1)')
  })
})
