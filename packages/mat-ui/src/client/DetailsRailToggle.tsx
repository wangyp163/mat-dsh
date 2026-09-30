/** 右缘中部悬浮钮：展开/收起右侧详情面板（shell.overlay + ctx.layout 动作面）。 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { IconChevronLeftOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import { openDetailsWithRoom } from './layout-room'

type DetailsRailToggleProps = PropsRuntime<'shell.overlay'> & { layout: ILayout }

export function DetailsRailToggle(props: DetailsRailToggleProps): JSX.Element | null {
  const { layout, useSessions } = props
  // 与宿主 AppFrame 同判据：hero（无会话或 blank 会话）时详情列恒为收起，按钮无意义。
  const live = useSessions(s => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false
  })
  const [detailsWidth, setDetailsWidth] = useState<number | undefined>(undefined)

  // 开合与宽度没有跨插件读面（ctx.layout 只有动作）：读 AppFrame 根的稳定 DOM 契约——
  // [data-shell-overlay] 层的父元素就是根，其内联 gridTemplateColumns 末轨=详情列宽（0=收起）；
  // style（拖拽改宽）与 data-details-collapsed（开合）都表现为属性变化，一个属性观察全覆盖。
  // 锚点必须是宿主层而非按钮自身 DOM：渲染 null 时 ref 永远是 null，effect 拿不到元素
  // 直接返回，宽度永远测不到——按钮永不出现（首版死锁）。宿主层全应用唯一，直接查询。
  useEffect(() => {
    if (live === false) return
    const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
    if (frame === null) return
    const read = () => {
      // 宿主轨道带 0.3s 过渡：属性变更瞬间 getComputedStyle 拿到的是过渡起点的旧值，
      // 且动画期间不再有属性变更——必须读内联 style 的目标值（定位与开合判断的真相源）。
      const tracks = frame.style.gridTemplateColumns || getComputedStyle(frame).gridTemplateColumns
      const lastTrack = tracks.split(' ').at(-1)
      const width = Number.parseFloat(lastTrack ?? '')
      setDetailsWidth(Number.isFinite(width) ? width : 0)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(frame, { attributes: true, attributeFilter: ['style', 'data-details-collapsed'] })
    return () => { observer.disconnect() }
  }, [live])

  if (live === false || detailsWidth === undefined) return null
  const open = detailsWidth > 0
  return <button
    type="button"
    className="mat-rail-toggle"
    aria-expanded={open}
    aria-label={open ? '收起任务面板' : '展开任务面板'}
    title={open ? '收起任务面板' : '展开任务面板'}
    // 11px = 钮宽的一半：骑在详情列分隔线上；收起时贴视口右缘。
    style={{ right: `${Math.max(0, Math.round(detailsWidth) - 11)}px` }}
    onClick={() => { if (open) layout.closeDetails(); else openDetailsWithRoom(layout) }}
  >
    {open ? <IconChevronRightOutline14 /> : <IconChevronLeftOutline14 />}
  </button>
}
