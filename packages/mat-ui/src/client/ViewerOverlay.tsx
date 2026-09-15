/** 沉浸查看层：shell.overlay 的第二个 occupant——全屏遮罩 + 大画布卡片 + 同后缀导航。 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { viewerState } from './viewer-state'
import { ViewerSurface } from './ViewerPanel'
import type { PeersNav } from './ViewerPanel'
import { classifyFile } from './view-model'

export function ViewerOverlay(): JSX.Element | null {
  const [snapshot, setSnapshot] = useState(viewerState.snapshot())
  useEffect(() => viewerState.subscribe(() => { setSnapshot(viewerState.snapshot()) }), [])

  const target = snapshot.current
  const immersive = snapshot.immersive && target !== undefined

  // 同后缀导航清单：目标变化即取（服务端遍历 scope 根，只含已同步本地文件）。
  const [peers, setPeers] = useState<{ peers: string[]; index: number }>()
  const [localPath, setLocalPath] = useState<string>()
  const scopeQuery = (jobId: string): string => jobId.startsWith('session:')
    ? `session=${encodeURIComponent(jobId.slice('session:'.length))}`
    : `jobId=${encodeURIComponent(jobId)}`
  // 翻页时**不清空**已有清单：清空会让导航簇整簇卸载一瞬，看起来像"点了没反应"。
  useEffect(() => {
    if (target === undefined) return
    let live = true
    const query = target.jobId.startsWith('session:')
      ? `session=${encodeURIComponent(target.jobId.slice('session:'.length))}`
      : `jobId=${encodeURIComponent(target.jobId)}`
    void (async () => {
      try {
        const response = await fetch(`/mat-files/peers?${query}&path=${encodeURIComponent(target.path)}`, { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as { peers?: string[]; index?: number }
        if (live && Array.isArray(payload.peers)) setPeers({ peers: payload.peers, index: payload.index ?? 0 })
      } catch { /* 导航是增益：失败退化为无翻页 */ }
    })()
    return () => { live = false }
  }, [target?.jobId, target?.path])

  // 本地镜像绝对路径（展示 + 复制）：随目标切换刷新。
  useEffect(() => {
    if (target === undefined) { setLocalPath(undefined); return }
    let live = true
    void (async () => {
      try {
        const response = await fetch(`/mat-files/localpath?${scopeQuery(target.jobId)}&path=${encodeURIComponent(target.path)}`, { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json() as { localPath?: string }
        if (live && typeof payload.localPath === 'string') setLocalPath(payload.localPath)
      } catch { /* 路径展示是增益 */ }
    })()
    return () => { live = false }
  }, [target?.jobId, target?.path])

  const navigate = (path: string): void => {
    if (target === undefined) return
    viewerState.open(target.jobId, path, classifyFile(path))
  }

  // ESC 收起 + ←/→ 翻同后缀（首尾循环）；导航只认键盘原生键，不做焦点陷阱。
  useEffect(() => {
    if (!immersive) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') viewerState.exitImmersive()
      else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && peers !== undefined && peers.peers.length > 1) {
        const delta = event.key === 'ArrowLeft' ? -1 : 1
        navigate(peers.peers[(peers.index + delta + peers.peers.length) % peers.peers.length]!)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [immersive, peers, target?.jobId])

  if (!immersive) return null
  const peersNav: PeersNav | undefined = peers === undefined
    ? undefined
    : { peers: peers.peers, index: peers.index, onNavigate: navigate }
  return (
    <div
      className="mat-view-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="沉浸文件预览"
      onClick={() => { viewerState.exitImmersive() }}
    >
      <div className="mat-view-overlay__card" onClick={(event) => { event.stopPropagation() }}>
        <ViewerSurface variant="overlay" peersNav={peersNav} localPath={localPath} />
      </div>
    </div>
  )
}
