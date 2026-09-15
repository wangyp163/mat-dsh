/** HPC brand occupants for the sidebar/hero brand slots（替换宿主鱼形 mark）. */
import { matLogoDataUrl } from './logo-data.ts'

/**
 * 锁定式（lockup）：mark 插槽的 wordmark 已提供品牌名 HPC，名字只渲染限定词
 * Harness，避免 "HPC HPC" 连读；排版度量镜像宿主 fallback（17px、无字距、不换行）。
 */
export function MatBrandName() {
  return <span className="mat-brand-name">Harness</span>
}

/**
 * 黑色 HPC wordmark，替换鲸鱼 mark。高宽随插槽给定的 size（高度）走，
 * max-width 收缩避免撑破折叠态窄 rail；深色主题经样式反白。
 */
export function MatBrandMark({ size }: { size: number }) {
  return (
    <img
      className="mat-brand-mark"
      src={matLogoDataUrl}
      alt=""
      style={{ height: size }}
    />
  )
}
