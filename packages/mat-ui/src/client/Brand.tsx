/** HPC brand occupants for the sidebar brand slot. */

/**
 * 品牌名插槽占位：只渲染限定词 Harness（排版度量镜像宿主 fallback：17px、
 * 无字距、不换行）。HPC wordmark 已按用户要求去除，mark 插槽回退宿主鱼形。
 */
export function MatBrandName() {
  return <span className="mat-brand-name">Harness</span>
}
