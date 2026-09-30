/**
 * 窄视口右栏腾位（宿主 ui-layout columns.ts 契约冻结值的镜像，只读不改宿主）：
 * 三列求解链是 侧栏(≥280) + 中列(≥640) + 右栏(≥300) —— 视口 < 1220 时右栏被
 * Step 3 自动收起，且 openDetails 设完偏好当帧又被压回 0：所有「打开文件面板」
 * 入口在这种宽度下都是死按钮。展开前先读 AppFrame 的内联轨道契约（与
 * DetailsRailToggle 同一真相源：内联 style 是过渡目标值），宽度不足且收起
 * 侧栏（56px rail）能腾出位时先 toggleSidebar 再 openDetails。
 */
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'

/** SIDEBAR_COLLAPSED(56) + CENTER_MIN(640) + DETAILS_MIN(300)：侧栏收起后右栏的最小可行视口。 */
const RAIL_FLOOR = 56 + 640 + 300

/** 展开中的侧栏轨道宽（读不到内联契约时返回 NaN，调用方跳过腾位）。 */
function sidebarTrack(): number {
  const frame = document.querySelector('[data-shell-overlay]')?.parentElement ?? null
  const tracks = frame instanceof HTMLElement ? frame.style.gridTemplateColumns : ''
  return Number.parseFloat(tracks.split(' ')[0] ?? '')
}

/** 打开右栏，宽度不足时先收侧栏腾位；极端窄（< RAIL_FLOOR）保持宿主原语义。 */
export function openDetailsWithRoom(layout: ILayout): void {
  const sidebar = sidebarTrack()
  if (Number.isFinite(sidebar) && sidebar + 640 + 300 > window.innerWidth && window.innerWidth >= RAIL_FLOOR) {
    layout.toggleSidebar()
  }
  layout.openDetails()
}
