/** HPC browser plugin: resident computation monitor and academic visual layer. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { StatusDock } from './StatusDock.tsx'
import { ResultTail } from './ResultTail.tsx'
import { MatToolView } from './MatToolView.tsx'
import { installStyle } from './style.ts'

export const inject = ['slots', 'theme']

export function apply(ctx: ClientContext): void {
  ctx.effect(installStyle, 'mat-ui: academic stylesheet')
  ctx.effect(() => ctx.theme.overrideTokens('mat-ui: academic refinement', {
    '--dsw-alias-label-primary': { light: '#17263a', dark: '#e6edf7' },
    '--dsw-alias-brand-primary': { light: '#35658f', dark: '#8eb9df' },
    '--dsw-alias-bg-base': { light: '#f7f9fc', dark: '#111823' },
  }), 'mat-ui: academic theme tokens')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mat-status',
    order: 15,
  }, StatusDock))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
  }, ResultTail))
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['mat_partitions', 'mat_sbatch', 'mat_job_status', 'mat_job_watch', 'mat_gaussian', 'mat_upload', 'mat_download']) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key }, MatToolView)
    }
  })
}
