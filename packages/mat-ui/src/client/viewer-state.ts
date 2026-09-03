/** 查看器面板的模块级状态（仿 file-manager-state）：当前预览目标 + 在途/失败标记。 */
import type { ViewKind } from './view-model'

type Listener = () => void

export type ViewerTarget = { jobId: string; path: string; kind: ViewKind }
export type ViewerStatus = 'idle' | 'pending' | 'error'

let current: ViewerTarget | undefined
let status: ViewerStatus = 'idle'
let error: string | undefined
const listeners = new Set<Listener>()

function emit(): void { for (const listener of listeners) listener() }

export const viewerState = {
  snapshot: (): { current?: ViewerTarget; status: ViewerStatus; error?: string } => ({
    ...(current === undefined ? {} : { current }),
    status,
    ...(error === undefined ? {} : { error }),
  }),
  subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  /** 文件面板点击入口：记录目标并进入在途态（图片/PDF 由 onLoad 收尾，结构/文本由取回流程收尾）。 */
  open(jobId: string, path: string, kind: ViewKind) { current = { jobId, path, kind }; status = 'pending'; error = undefined; emit() },
  finish(cause?: unknown) {
    status = cause === undefined ? 'idle' : 'error'
    error = cause === undefined ? undefined : cause instanceof Error ? cause.message : String(cause)
    emit()
  },
  clear() { current = undefined; status = 'idle'; error = undefined; emit() },
  reset() { current = undefined; status = 'idle'; error = undefined; listeners.clear() },
}
