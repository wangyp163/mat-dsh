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

describe('viewer wiring（09-07 重设计：侧栏不再保留查看 tab）', () => {
  it('不再注册 mat-view details tab——查看器只活在沉浸层', async () => {
    const index = await source('index.tsx')
    expect(index).not.toContain("id: 'mat-view'")
    expect(index).not.toContain('ViewerPanel')
    expect(index).toContain('ViewerOverlay')
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
  it('可预览点击直达沉浸层（enterImmersive），不再切侧栏 tab', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).toContain('classifyFile')
    expect(panel).toContain("viewerState.open(")
    expect(panel).toContain('enterImmersive()')
    expect(panel).not.toContain("openTab?.('mat-view')")
  })

  it('stops opening files through the host workspace and reports unsupported types', async () => {
    const panel = await source('FileManagerPanel.tsx')
    expect(panel).not.toContain("fetch('/mat-files/open'")
    expect(panel).not.toContain('openWorkspace(payload.path)')
    expect(panel).toContain('该类型暂不支持预览')
    // 目录按钮保留宿主域行为：openWorkspace 只服务本地工作区目录。
    expect(panel).toContain('focusedJob.localWorkspace')
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

describe('沉浸层同后缀导航（A 方案）', () => {
  it('peers 清单由服务端遍历 scope 根给出（含 session 通道）', async () => {
    const overlay = await source('ViewerOverlay.tsx')
    expect(overlay).toContain('/mat-files/peers?')
    expect(overlay).toContain('peers')
    expect(overlay).toContain('navigate')
  })
  it('工具条 ‹ i/n › + ←/→ 键盘翻页（首尾循环）', async () => {
    const overlay = await source('ViewerOverlay.tsx')
    const panel = await source('ViewerPanel.tsx')
    expect(panel).toMatch(/‹/)
    expect(panel).toMatch(/›/)
    expect(panel).toContain('peersNav')
    expect(overlay).toContain("'ArrowLeft'")
    expect(overlay).toContain("'ArrowRight'")
    expect(overlay).toMatch(/%/)
  })
})

describe('翻页可用性 + 本地路径可见（09-07 用户报障）', () => {
  const src = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

  it('翻页保持沉浸态与导航簇：open 后不复位 immersive，peers 刷新期间不卸载导航', async () => {
    const overlay = await src('ViewerOverlay.tsx')
    // 重取 peers 时不得把已有清单清空（否则按钮整簇消失，看起来"点了没反应"）
    expect(overlay).not.toContain('setPeers(undefined)')
    // 翻页后本地路径也要跟着刷新
    expect(overlay).toContain('localPath')
  })

  it('工具条显示本地镜像路径且可复制', async () => {
    const panel = await src('ViewerPanel.tsx')
    expect(panel).toContain('localPath')
    expect(panel).toContain('writeClipboard')
    expect(panel).toContain('复制路径')
  })
})

describe('结构翻页：容器复用不残留死画布（09-07 报障）', () => {
  const src = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

  it('切换目标时容器按 target 重建（key），且 dispose 后清空残留 DOM', async () => {
    const panel = await src('ViewerPanel.tsx')
    // NGL dispose 不移除它注入的 canvas/事件层：容器必须带 key 强制重建 + 显式清空
    expect(panel).toMatch(/key=\{`ngl-\$\{target\.jobId\}/)
    expect(panel).toContain('replaceChildren()')
  })

  it('路径条不再用 direction:rtl（会把开头的 / 甩到行尾）', async () => {
    const style = await src('style.ts')
    expect(style).not.toContain('direction:rtl')
  })
})
