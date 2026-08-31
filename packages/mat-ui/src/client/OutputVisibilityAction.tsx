import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { IconSettingsOutline16, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  DEFAULT_OUTPUT_VISIBILITY,
  applyOutputVisibility,
  loadOutputVisibility,
  observeOutputVisibility,
  saveOutputVisibility,
  type OutputMode,
  type OutputVisibility,
} from './output-visibility.ts'

type Props = PropsRuntime<'conversation.session.header.actions'>
type Scope = 'thinking' | 'tools'

const MODES: ReadonlyArray<{ value: OutputMode; label: string }> = [
  { value: 'hidden', label: '隐藏' },
  { value: 'summary', label: '摘要' },
  { value: 'expanded', label: '展开' },
]

function conversationRoot(node: HTMLElement | null): HTMLElement | null {
  return node?.closest<HTMLElement>('[data-phase]') ?? null
}

export function OutputVisibilityAction(_props: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const stateRef = useRef<OutputVisibility>(DEFAULT_OUTPUT_VISIBILITY)
  const [state, setState] = useState<OutputVisibility>(() => loadOutputVisibility())
  const [open, setOpen] = useState(false)
  stateRef.current = state

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  useEffect(() => {
    const root = conversationRoot(rootRef.current)
    if (root === null) return
    applyOutputVisibility(root, stateRef.current)
    return observeOutputVisibility(root, () => stateRef.current)
  }, [])

  const update = (next: OutputVisibility): void => {
    stateRef.current = next
    setState(next)
    saveOutputVisibility(next)
    const root = conversationRoot(rootRef.current)
    if (root !== null) applyOutputVisibility(root, next)
  }

  const setMode = (scope: Scope, mode: OutputMode): void => {
    update({ ...stateRef.current, [scope]: mode })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return <div ref={rootRef} className="mat-output-manager" onKeyDown={onKeyDown}>
    <button
      ref={triggerRef}
      type="button"
      className="mat-output-manager__trigger"
      aria-label="管理推理与工具调用显示"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      <IconSettingsOutline16 size={14} />
      <span>输出</span>
    </button>
    {open ? <div className="mat-output-manager__menu" role="dialog" aria-label="输出显示设置">
      <header><span className="mat-status-dock__eyebrow">OUTPUT DISPLAY</span><strong>信息密度</strong></header>
      {([['thinking', '推理'], ['tools', '工具调用']] as const).map(([scope, label]) => <section key={scope}>
        <span className="mat-output-manager__label">{label}</span>
        <div className="mat-output-manager__segments" role="group" aria-label={`${label}显示方式`}>
          {MODES.map(mode => <button
            key={mode.value}
            type="button"
            aria-pressed={state[scope] === mode.value}
            onClick={() => { setMode(scope, mode.value) }}
          >{mode.label}</button>)}
        </div>
      </section>)}
      <footer>
        <button type="button" onClick={() => { update({ ...DEFAULT_OUTPUT_VISIBILITY }) }}>整洁模式</button>
        <button type="button" onClick={() => { update({ thinking: 'expanded', tools: 'expanded' }) }}>全部展开</button>
      </footer>
    </div> : null}
  </div>
}
