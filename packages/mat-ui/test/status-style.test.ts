import { describe, expect, it } from 'vitest'
import { style } from '../src/client/style'

describe('computational monitor styles', () => {
  it('left-aligns and constrains the monitor and task cards to the same geometry', () => {
    expect(style).toContain('.mat-status-dock, section[data-testid=todo-panel]{box-sizing:border-box;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px)')
    expect(style).not.toContain('.mat-status-dock, [data-testid=todo-panel]')
    expect(style).toContain('margin-left:max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2))')
    expect(style).toContain('.mat-status-dock__toggle{display:grid')
    expect(style).toContain('.mat-status-card__metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(style).not.toContain('.mat-status-table')
    expect(style).not.toContain('.mat-status-card__detail')
  })
})
