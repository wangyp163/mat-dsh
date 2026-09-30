/** HPC browser plugin: resident computation monitor and native file details tab. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { MatBrandName, MatBrandMark } from './Brand.tsx'
import { StatusDock } from './StatusDock.tsx'
import { FileManagerPanel } from './FileManagerPanel.tsx'
import { ViewerOverlay } from './ViewerOverlay.tsx'
import { TaskDetailsPanel } from './TaskDetailsPanel.tsx'
import { MatToolView } from './MatToolView.tsx'
import { DetailsRailToggle } from './DetailsRailToggle.tsx'
import { installStyle } from './style.ts'

export const inject = ['slots', 'theme', 'layout']

export function apply(ctx: ClientContext): void {
  // 左上角品牌名：占宿主 sidebar.brand.name 插槽，fallback（DSH Local Build + 修订号）不再渲染。
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
  }, () => <MatBrandName />))
  // 鲸鱼 mark → 黑色 HPC wordmark：侧栏（含折叠 rail）与 hero 标语两处。
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
  }, (props) => <MatBrandMark {...props} />))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
  }, (props) => <MatBrandMark {...props} />))
  ctx.slots.inject('conversation.details.tab', () => ctx.slots.register({
    name: 'conversation.details.tab',
    id: 'mat-files',
    order: 10,
    label: '文件',
  }, (props) => <FileManagerPanel {...props} />))
  ctx.effect(installStyle, 'mat-ui: native details stylesheet')
  ctx.slots.inject('conversation.details.tab', () => ctx.slots.register({
    name: 'conversation.details.tab',
    id: 'mat-task',
    order: 0,
    label: '任务',
  }, (props) => <TaskDetailsPanel {...props} layout={ctx.layout} />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mat-status',
    order: 15,
  }, (props) => <StatusDock {...props} layout={ctx.layout} />))
  // 右缘中部悬浮钮：收起态没有入口可重开详情面板，这里补一个常驻开关。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mat-rail-toggle',
    order: 10,
  }, (props) => <DetailsRailToggle {...props} layout={ctx.layout} />))
  // 沉浸查看层：查看 tab「放大」进入的全屏大画布（shell.overlay 是 list 插槽，多占合法）。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mat-viewer-overlay',
    order: 20,
  }, () => <ViewerOverlay />))
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['mat_partitions', 'mat_sbatch', 'mat_job_status', 'mat_job_watch', 'mat_gaussian', 'mat_upload', 'mat_download']) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key }, MatToolView)
    }
  })
}
