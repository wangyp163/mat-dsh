/** 「查看」details tab：结构 3D（NGL）/ 图片 / PDF / 文本 的应用内预览，替代宿主 openWorkspace。 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { loadScript } from './load-script'
import { viewerState } from './viewer-state'
import type { ViewerTarget } from './viewer-state'
import { isXyz, structureBody } from './view-model'

interface NglComponent {
  addRepresentation(type: string, params?: Record<string, unknown>): unknown
  removeAllRepresentations(): void
}

interface NglStage {
  loadFile(source: Blob, params: { ext: string; defaultRepresentation?: boolean }): Promise<NglComponent>
  setSpin(on: boolean): void
  autoView(): void
  dispose(): void
}

interface NglFactory { new (element: HTMLElement, params?: { backgroundColor?: string }): NglStage }

type RepresentationStyle = 'ball+stick' | 'line' | 'spacefill'

const TEXT_PREVIEW_LIMIT = 512 * 1024

const contentUrl = (target: ViewerTarget): string =>
  `/mat-files/content?jobId=${encodeURIComponent(target.jobId)}&path=${encodeURIComponent(target.path)}`

const KIND_LABELS: Record<ViewerTarget['kind'], string> = {
  structure: '结构',
  image: '图片',
  pdf: '文档',
  text: '文本',
}

function rebuild(style: RepresentationStyle, component: NglComponent, unitcell: boolean): void {
  component.removeAllRepresentations()
  component.addRepresentation(style)
  // 晶胞框只画真实晶胞（POSCAR/cif）；xyz 分子的包盒是承载用的假盒子，不画。
  if (unitcell) component.addRepresentation('unitcell')
}

export function ViewerPanel(_props: PropsRuntime<'conversation.details.tab'>): JSX.Element {
  const [snapshot, setSnapshot] = useState(viewerState.snapshot())
  useEffect(() => viewerState.subscribe(() => { setSnapshot(viewerState.snapshot()) }), [])

  const [style, setStyle] = useState<RepresentationStyle>('ball+stick')
  const [spin, setSpin] = useState(false)
  const [text, setText] = useState<string>()
  const [truncated, setTruncated] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<NglStage | undefined>(undefined)
  const componentRef = useRef<NglComponent | undefined>(undefined)
  const unitcellRef = useRef(false)

  const target = snapshot.current

  // 结构：懒加载 NGL → 取回文件 → 统一转 CIF（vendored NGL 无 xyz 解析器）→ Stage + 球棍；卸载必 dispose。
  useEffect(() => {
    if (target?.kind !== 'structure') return
    let disposed = false
    let stage: NglStage | undefined
    void (async () => {
      try {
        await loadScript('/mat-vendor/ngl.js')
        const response = await fetch(contentUrl(target), { cache: 'no-store' })
        if (!response.ok) throw new Error(`content HTTP ${response.status}`)
        const source = await response.text()
        if (disposed) return
        const NGL = (window as unknown as { NGL?: NglFactory }).NGL
        if (NGL === undefined || containerRef.current === null) throw new Error('3D 引擎未就绪')
        stage = new NGL.Stage(containerRef.current, { backgroundColor: 'white' })
        const component = await stage.loadFile(new Blob([structureBody(target.path, source)]), { ext: 'cif', defaultRepresentation: false })
        if (disposed) return
        // 解析器会为跨胞成键把边界邻像原子一并加进结构（Si 8 位点 → 31 原子，
        // 无 model/chain 标记可分离）：按原生输出渲染，换取晶胞边界处键完整。
        stageRef.current = stage
        componentRef.current = component
        unitcellRef.current = !isXyz(target.path)
        rebuild('ball+stick', component, unitcellRef.current)
        stage.autoView()
        viewerState.finish()
      } catch (cause) {
        if (!disposed) viewerState.finish(cause)
      }
    })()
    return () => {
      disposed = true
      stageRef.current = undefined
      componentRef.current = undefined
      stage?.dispose()
    }
  }, [target?.jobId, target?.path])

  // 文本：取回 + 512K 截断；图片/PDF 不走 JS，直接交给 <img>/<iframe> 的 load 事件收尾。
  useEffect(() => {
    if (target?.kind !== 'text') return
    let live = true
    setText(undefined)
    setTruncated(false)
    void (async () => {
      try {
        const response = await fetch(contentUrl(target), { cache: 'no-store' })
        if (!response.ok) throw new Error(`content HTTP ${response.status}`)
        const body = await response.text()
        if (!live) return
        if (body.length > TEXT_PREVIEW_LIMIT) {
          setText(body.slice(0, TEXT_PREVIEW_LIMIT))
          setTruncated(true)
        } else {
          setText(body)
        }
        viewerState.finish()
      } catch (cause) {
        if (live) viewerState.finish(cause)
      }
    })()
    return () => { live = false }
  }, [target?.jobId, target?.path])

  // 在途秒表：区分「加载中」与「卡了」——超过 10 秒提示远端响应缓慢。
  const busy = snapshot.status === 'pending'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const timer = setInterval(() => { setElapsed(value => value + 1) }, 1000)
    return () => { clearInterval(timer) }
  }, [busy])
  const slowHint = elapsed >= 10 ? '，远端响应缓慢，可能网络不通' : ''

  const onStyle = (next: RepresentationStyle): void => {
    setStyle(next)
    if (componentRef.current !== undefined) rebuild(next, componentRef.current, unitcellRef.current)
  }
  const onSpin = (): void => {
    const next = !spin
    setSpin(next)
    stageRef.current?.setSpin(next)
  }
  const copy = (): void => {
    setCopyFailed(false)
    void writeClipboard(text ?? '').then(ok => { setCopyFailed(!ok) })
  }

  return <section className="mat-view" aria-label="HPC 文件预览">
    <header className="mat-view__toolbar">
      <span className="mat-view__title">{target === undefined ? '未选择文件' : target.path.split('/').at(-1)}</span>
      {target !== undefined && <span className="mat-view__kind">{KIND_LABELS[target.kind]}</span>}
      {target?.kind === 'structure' && <>
        <span className="mat-view__seg">
          <Button size="sm" variant={style === 'ball+stick' ? 'primary' : 'outline'} aria-label="球棍风格" onClick={() => { onStyle('ball+stick') }}>球棍</Button>
          <Button size="sm" variant={style === 'line' ? 'primary' : 'outline'} aria-label="线框风格" onClick={() => { onStyle('line') }}>线框</Button>
          <Button size="sm" variant={style === 'spacefill' ? 'primary' : 'outline'} aria-label="填充风格" onClick={() => { onStyle('spacefill') }}>填充</Button>
        </span>
        <Button size="sm" variant={spin ? 'primary' : 'outline'} aria-label="自转" aria-pressed={spin} onClick={onSpin}>{spin ? '停转' : '自转'}</Button>
        <Button size="sm" variant="outline" aria-label="重置视角" onClick={() => { stageRef.current?.autoView() }}>重置</Button>
      </>}
      {target?.kind === 'text' && <Button size="sm" variant="outline" aria-label="复制文本" disabled={text === undefined} onClick={copy}>复制</Button>}
    </header>
    {target === undefined
      ? <p className="mat-view__empty">点击文件面板中的文件以预览。</p>
      : snapshot.status === 'error'
        ? <p className="mat-view__error" role="alert">预览失败：{snapshot.error}</p>
        : <>
          {busy && <p role="status" aria-live="polite" className="mat-view__loading">正在取回文件… {elapsed}s{slowHint}</p>}
          {copyFailed && <p role="alert" className="mat-view__error">复制失败</p>}
          {target.kind === 'structure' && <div ref={containerRef} className="mat-view__canvas" />}
          {target.kind === 'image' && <img
            className="mat-view__media"
            src={contentUrl(target)}
            alt={`预览 ${target.path}`}
            onLoad={() => { viewerState.finish() }}
            onError={() => { viewerState.finish(new Error('图片加载失败')) }}
          />}
          {target.kind === 'pdf' && <iframe
            className="mat-view__frame"
            src={contentUrl(target)}
            title={`预览 ${target.path}`}
            onLoad={() => { viewerState.finish() }}
          />}
          {target.kind === 'text' && <pre className="mat-view__text">{text}{truncated ? '\n…（文件超过 512 KB，已截断，完整内容请下载）' : ''}</pre>}
        </>}
  </section>
}
