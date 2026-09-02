/** HPC browser plugin: resident computation monitor and native file details tab. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { StatusDock } from './StatusDock.tsx'
import { FileManagerPanel } from './FileManagerPanel.tsx'
import { TaskDetailsPanel } from './TaskDetailsPanel.tsx'
import { MatToolView } from './MatToolView.tsx'
import { installStyle } from './style.ts'

export const inject = ['slots', 'theme', 'layout']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.details.tab', () => ctx.slots.register({
    name: 'conversation.details.tab',
    id: 'mat-files',
    order: 10,
    label: '文件',
  }, () => <FileManagerPanel />))
  ctx.effect(installStyle, 'mat-ui: native details stylesheet')
  ctx.slots.inject('conversation.details.tab', () => ctx.slots.register({
    name: 'conversation.details.tab',
    id: 'mat-task',
    order: 0,
    label: '任务',
  }, (props) => <TaskDetailsPanel {...props} />))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mat-status',
    order: 15,
  }, (props) => <StatusDock {...props} />))
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['mat_partitions', 'mat_sbatch', 'mat_job_status', 'mat_job_watch', 'mat_gaussian', 'mat_upload', 'mat_download']) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key }, MatToolView)
    }
  })
}
