/** HPC browser plugin: resident computation monitor and academic visual layer. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { StatusDock } from './StatusDock.tsx'
import { installStyle } from './style.ts'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.effect(installStyle, 'mat-ui: academic stylesheet')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'mat-status',
    order: 15,
  }, StatusDock))
}
