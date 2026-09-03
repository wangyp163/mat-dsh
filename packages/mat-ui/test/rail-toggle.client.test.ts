import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = (file: string) => readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8')

describe('details rail toggle (shell.overlay entry)', () => {
  it('registers into shell.overlay and drives the host layout face', async () => {
    const index = await source('index.tsx')
    expect(index).toContain("'shell.overlay'")
    expect(index).toContain("id: 'mat-rail-toggle'")
    expect(index).toContain('DetailsRailToggle')
    // ctx.layout 是跨插件面板动作契约（apply 世界闭包传入，组件不碰 cordis）。
    expect(index).toContain('layout={ctx.layout}')
  })

  it('reads the frame DOM contract instead of reaching into the layout store', async () => {
    const panel = await source('DetailsRailToggle.tsx')
    // 悬浮层是全应用唯一的宿主锚点：按钮自身不能作锚——渲染 null 时 ref 为 null，
    // effect 拿不到元素直接返回，宽度永远测不到（首版死锁，按钮从未出现）。
    expect(panel).toContain("document.querySelector('[data-shell-overlay]')")
    expect(panel).not.toContain('closest(')
    expect(panel).not.toContain('buttonRef')
    // 宿主轨道有 0.3s 过渡：属性变更瞬间 getComputedStyle 是过渡起点旧值，且动画期间
    // 不再有变更事件——必须读内联 style 的目标值（开合判断与定位的源头真相）。
    expect(panel).toContain('frame.style.gridTemplateColumns')
    expect(panel).toContain('gridTemplateColumns')
    // style（拖拽改宽）/data-details-collapsed（开合）都走内联属性，属性观察即可全覆盖。
    expect(panel).toContain("attributeFilter: ['style', 'data-details-collapsed']")
    expect(panel).toContain('openDetails')
    expect(panel).toContain('closeDetails')
  })

  it('gates on a live session and reports expanded state to assistive tech', async () => {
    const panel = await source('DetailsRailToggle.tsx')
    // 与宿主 AppFrame 同判据：无真实会话（hero/blank）时详情列恒为 0，按钮无意义。
    expect(panel).toContain('blank === false')
    expect(panel).toContain('useSessions')
    expect(panel).toContain('aria-expanded')
  })

  it('styles a floating edge tab with theme tokens', async () => {
    const style = await source('style.ts')
    expect(style).toContain('mat-rail-toggle{')
    expect(style).toContain('mat-rail-toggle:hover')
    // right 随轨道同曲线滑移（宿主同款 token）；拖拽/减弱动效时与宿主同步暂停。
    expect(style).toContain('transition:right var(--ds-transition-duration-slow) var(--ds-ease-in-out)')
    expect(style).toContain('[data-dragging] .mat-rail-toggle{transition:none}')
    expect(style).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
