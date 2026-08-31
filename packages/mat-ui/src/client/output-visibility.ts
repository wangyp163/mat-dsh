export type OutputMode = 'hidden' | 'summary' | 'expanded'

export interface OutputVisibility {
  thinking: OutputMode
  tools: OutputMode
}

export const OUTPUT_VISIBILITY_KEY = 'mat.output-visibility.v1'
export const DEFAULT_OUTPUT_VISIBILITY: OutputVisibility = Object.freeze({ thinking: 'summary', tools: 'summary' })

function isMode(value: unknown): value is OutputMode {
  return value === 'hidden' || value === 'summary' || value === 'expanded'
}

export function parseOutputVisibility(raw: string | null): OutputVisibility {
  if (raw === null) return { ...DEFAULT_OUTPUT_VISIBILITY }
  try {
    const value = JSON.parse(raw) as { thinking?: unknown; tools?: unknown }
    if (!isMode(value.thinking) || !isMode(value.tools)) return { ...DEFAULT_OUTPUT_VISIBILITY }
    return { thinking: value.thinking, tools: value.tools }
  } catch {
    return { ...DEFAULT_OUTPUT_VISIBILITY }
  }
}

export function loadOutputVisibility(storage: Pick<Storage, 'getItem'> = localStorage): OutputVisibility {
  try {
    return parseOutputVisibility(storage.getItem(OUTPUT_VISIBILITY_KEY))
  } catch {
    return { ...DEFAULT_OUTPUT_VISIBILITY }
  }
}

export function saveOutputVisibility(state: OutputVisibility, storage?: Pick<Storage, 'setItem'>): void
export function saveOutputVisibility(storage: Pick<Storage, 'setItem'>, state: OutputVisibility): void
export function saveOutputVisibility(
  first: OutputVisibility | Pick<Storage, 'setItem'>,
  second?: OutputVisibility | Pick<Storage, 'setItem'>,
): void {
  const state = 'thinking' in first ? first : second as OutputVisibility
  const storage = ('setItem' in first ? first : second) as Pick<Storage, 'setItem'> | undefined
  try {
    ;(storage ?? localStorage).setItem(OUTPUT_VISIBILITY_KEY, JSON.stringify(state))
  } catch {
    // 存储不可用不阻断显示控制；当前组件状态仍在内存中生效。
  }
}

const THINKING_ROWS = '[data-variant="think"] [data-disclosure-row][aria-expanded]'
const TOOL_ROWS = '[data-chat-call-id] [data-disclosure-row][aria-expanded]'

function setExpanded(root: HTMLElement, selector: string, expanded: boolean): void {
  for (const row of root.querySelectorAll<HTMLElement>(selector)) {
    if ((row.getAttribute('aria-expanded') === 'true') !== expanded) row.click()
  }
}

export function applyOutputVisibility(root: HTMLElement, state: OutputVisibility): void {
  root.setAttribute('data-mat-thinking', state.thinking)
  root.setAttribute('data-mat-tools', state.tools)
  setExpanded(root, THINKING_ROWS, state.thinking === 'expanded')
  setExpanded(root, TOOL_ROWS, state.tools === 'expanded')
}

export function observeOutputVisibility(root: HTMLElement, getState: () => OutputVisibility): () => void {
  const observer = new MutationObserver(() => { applyOutputVisibility(root, getState()) })
  observer.observe(root, { childList: true, subtree: true })
  return () => { observer.disconnect() }
}
