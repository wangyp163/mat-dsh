/** 「查看」details tab：结构 3D（NGL.Shape 自绘，OPTIMADE viewer 管线）/ 图片 / PDF / 文本 的应用内预览。 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { loadScript } from './load-script'
import { viewerState } from './viewer-state'
import type { ViewerTarget } from './viewer-state'
import { computeBonds, covRadius, elemRgb, imagePos, mulRows, parseStructure } from './structure-model'
import type { ParsedStructure, RGB, StructureBond, Vec3 } from './structure-model'

interface NglShape {
  addSphere(position: Vec3, color: RGB, radius: number): unknown
  addCylinder(position1: Vec3, position2: Vec3, color: RGB, radius: number): unknown
}

interface NglComponent {
  addRepresentation(type: string, params?: Record<string, unknown>): unknown
}

interface NglStage {
  addComponentFromObject(shape: NglShape): NglComponent
  removeAllComponents(): void
  setSpin(on: boolean): void
  autoView(): void
  handleResize(): void
  dispose(): void
}

interface NglFactory {
  new (element: HTMLElement, params?: { backgroundColor?: string }): NglStage
  Shape: new (name: string) => NglShape
}

type RepresentationStyle = 'ball+stick' | 'line' | 'spacefill'

const TEXT_PREVIEW_LIMIT = 512 * 1024

// sag-visual 渲染契约（与 optimade_mcp structure_viewer 一致）：三 shape 独立透明度。
const SPHERE_R = 0.5, BOND_R = 0.075, EDGE_R = 0.04
const LINE_SPHERE_R = 0.15, LINE_BOND_R = 0.03
const ATOM_OPACITY = 0.9, BOND_OPACITY = 0.6, CELL_OPACITY = 0.4
const BOND_RGB: RGB = [110 / 255, 118 / 255, 129 / 255]   // #6e7681
const CELL_RGB: RGB = [88 / 255, 166 / 255, 255 / 255]    // #58a6ff
/** 填充风格按元素半径缩放（共价半径 ×1.25，上限 1.6），近 vdW 观感。 */
const SPACEFILL_FACTOR = 1.25, SPACEFILL_CAP = 1.6
// 晶胞盒 12 条棱（8 个角点 0/1 组合的连接表）
const CELL_EDGES = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4], [2, 6], [3, 5], [3, 6], [4, 7], [5, 7], [6, 7]] as const

function sphereRadiusOf(style: RepresentationStyle, elem: string): number {
  if (style === 'line') return LINE_SPHERE_R
  if (style === 'spacefill') return Math.min(SPACEFILL_CAP, covRadius(elem) * SPACEFILL_FACTOR)
  return SPHERE_R
}

const contentUrl = (target: ViewerTarget): string =>
  // session:<id> 是工作区目标（服务端解析共享 cwd）——走 content 路由的 session 参数。
  target.jobId.startsWith('session:')
    ? `/mat-files/content?session=${encodeURIComponent(target.jobId.slice('session:'.length))}&path=${encodeURIComponent(target.path)}`
    : `/mat-files/content?jobId=${encodeURIComponent(target.jobId)}&path=${encodeURIComponent(target.path)}`

const KIND_LABELS: Record<ViewerTarget['kind'], string> = {
  structure: '结构',
  image: '图片',
  pdf: '文档',
  text: '文本',
}

/**
 * NGL.Shape 自绘（OPTIMADE viewer 移植）：原子球（CPK 色）+ 键圆柱（灰）+
 * 晶胞棱（蓝，仅真实晶胞）三 shape 独立透明度；开 showOuter 时跨胞键的镜像
 * 端点原子补画并去重（VESTA「Draw atoms outside unit cell bonded to atoms
 * within unit cell」语义），关掉时连伸出胞外的键圆柱一起隐藏，边界呈切开观感。
 * 填充风格不画键；信息行文案由调用方从 parsed/bonds 生成。
 */
function drawStructure(stage: NglStage, shapeFactory: new (name: string) => NglShape, parsed: ParsedStructure, bonds: StructureBond[], style: RepresentationStyle, showOuter: boolean): void {
  const showBonds = style !== 'spacefill'
  const crossesCell = (bond: StructureBond): boolean => Boolean(bond.image[0] || bond.image[1] || bond.image[2])
  stage.removeAllComponents()
  const addShape = (shape: NglShape, opacity: number): void => {
    stage.addComponentFromObject(shape).addRepresentation('buffer', { opacity })
  }
  const atomsShape = new shapeFactory('atoms')
  for (const atom of parsed.atoms) {
    atomsShape.addSphere(atom.pos, elemRgb(atom.elem), sphereRadiusOf(style, atom.elem))
  }
  if (showBonds && showOuter) {
    const seen = new Set<string>() // 跨胞键镜像端点原子去重
    for (const bond of bonds) {
      if (!crossesCell(bond)) continue
      const atom = parsed.atoms[bond.j]!
      const q = imagePos(atom, bond.image, parsed.lattice)
      const key = `${bond.j}|${q.map(value => value.toFixed(2)).join(',')}`
      if (!seen.has(key)) {
        seen.add(key)
        atomsShape.addSphere(q, elemRgb(atom.elem), sphereRadiusOf(style, atom.elem))
      }
    }
  }
  addShape(atomsShape, ATOM_OPACITY)
  if (showBonds) {
    const bondShape = new shapeFactory('bonds')
    for (const bond of bonds) {
      if (!showOuter && crossesCell(bond)) continue
      bondShape.addCylinder(parsed.atoms[bond.i]!.pos, imagePos(parsed.atoms[bond.j]!, bond.image, parsed.lattice), BOND_RGB, style === 'line' ? LINE_BOND_R : BOND_R)
    }
    addShape(bondShape, BOND_OPACITY)
  }
  if (parsed.hasCell) {
    const cellShape = new shapeFactory('cell')
    const corners = ([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as Vec3[])
      .map(fraction => mulRows(fraction, parsed.lattice))
    for (const [from, to] of CELL_EDGES) {
      cellShape.addCylinder(corners[from]!, corners[to]!, CELL_RGB, EDGE_R)
    }
    addShape(cellShape, CELL_OPACITY)
  }
  stage.autoView()
}

/** 同后缀导航（A 方案）：清单与当前项由 ViewerOverlay 从 /mat-files/peers 取得。 */
export interface PeersNav {
  peers: string[]
  index: number
  onNavigate: (path: string) => void
}

/**
 * 视图主体（沉浸层专用，09-07 起侧栏不再保留查看 tab）。
 */
export function ViewerSurface({ variant = 'overlay', peersNav, localPath }: { variant?: 'panel' | 'overlay'; peersNav?: PeersNav; localPath?: string }): JSX.Element {
  const [snapshot, setSnapshot] = useState(viewerState.snapshot())
  useEffect(() => viewerState.subscribe(() => { setSnapshot(viewerState.snapshot()) }), [])

  const [style, setStyle] = useState<RepresentationStyle>('ball+stick')
  const [outer, setOuter] = useState(true)
  const [text, setText] = useState<string>()
  const [truncated, setTruncated] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [structInfo, setStructInfo] = useState<string>()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<NglStage | undefined>(undefined)
  const shapeFactoryRef = useRef<(new (name: string) => NglShape) | undefined>(undefined)
  const structureRef = useRef<{ parsed: ParsedStructure; bonds: StructureBond[] } | undefined>(undefined)

  const target = snapshot.current

  // 结构：懒加载 NGL → 取回文件 → 自解析（POSCAR/xyz/cif）→ 共价 MIC 成键 →
  // NGL.Shape 自绘（CPK 球/键/晶胞棱）；卸载必 dispose。
  useEffect(() => {
    if (target?.kind !== 'structure') return
    let disposed = false
    let stage: NglStage | undefined
    // NGL 无容器自适应（vendored 产物零 ResizeObserver）：rail 拖宽/沉浸大画布
    // 都靠这里补的观察器驱动 handleResize，否则位图被 CSS 拉伸糊掉。
    let resizeObserver: ResizeObserver | undefined
    void (async () => {
      try {
        await loadScript('/mat-vendor/ngl.js')
        const response = await fetch(contentUrl(target), { cache: 'no-store' })
        if (!response.ok) throw new Error(`content HTTP ${response.status}`)
        const source = await response.text()
        if (disposed) return
        const NGL = (window as unknown as { NGL?: NglFactory }).NGL
        if (NGL === undefined || containerRef.current === null) throw new Error('3D 引擎未就绪')
        const parsed = parseStructure(target.path, source)
        const bonds = computeBonds(parsed.atoms, parsed.lattice)
        stage = new NGL.Stage(containerRef.current, { backgroundColor: 'white' })
        resizeObserver = new ResizeObserver(() => { stage?.handleResize() })
        resizeObserver.observe(containerRef.current)
        stageRef.current = stage
        shapeFactoryRef.current = NGL.Shape
        structureRef.current = { parsed, bonds }
        drawStructure(stage, NGL.Shape, parsed, bonds, 'ball+stick', true)
        // 换文件重置为默认开：按钮态与画面保持一致（与风格重置行为对齐）。
        setOuter(true)
        setStructInfo(`${parsed.formula} · 晶胞 ${parsed.a.toFixed(3)} × ${parsed.b.toFixed(3)} × ${parsed.c.toFixed(3)} Å，${parsed.alpha.toFixed(1)}/${parsed.beta.toFixed(1)}/${parsed.gamma.toFixed(1)}° · ${parsed.atoms.length} 位点 · ${bonds.length} 键`)
        viewerState.finish()
      } catch (cause) {
        if (!disposed) viewerState.finish(cause)
      }
    })()
    return () => {
      disposed = true
      resizeObserver?.disconnect()
      stageRef.current = undefined
      shapeFactoryRef.current = undefined
      structureRef.current = undefined
      setStructInfo(undefined)
      stage?.dispose()
      // dispose 只销毁 NGL 实例，注入的 canvas 与事件层仍挂在容器上：
      // 不清掉的话翻页后旧画布盖住新画布（画面不更新）且截走鼠标事件。
      containerRef.current?.replaceChildren()
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
    const stage = stageRef.current
    const structure = structureRef.current
    if (stage !== undefined && shapeFactoryRef.current !== undefined && structure !== undefined) {
      drawStructure(stage, shapeFactoryRef.current, structure.parsed, structure.bonds, next, outer)
    }
  }
  const onOuter = (): void => {
    const next = !outer
    setOuter(next)
    const stage = stageRef.current
    const structure = structureRef.current
    if (stage !== undefined && shapeFactoryRef.current !== undefined && structure !== undefined) {
      drawStructure(stage, shapeFactoryRef.current, structure.parsed, structure.bonds, style, next)
    }
  }
  const [spin, setSpin] = useState(false)
  const onSpin = (): void => {
    const next = !spin
    setSpin(next)
    stageRef.current?.setSpin(next)
  }
  const copy = (): void => {
    setCopyFailed(false)
    void writeClipboard(text ?? '').then(ok => { setCopyFailed(!ok) })
  }
  const [pathCopied, setPathCopied] = useState(false)
  const copyPath = (): void => {
    if (localPath === undefined) return
    void writeClipboard(localPath).then(ok => {
      setPathCopied(ok)
      if (ok) window.setTimeout(() => { setPathCopied(false) }, 1500)
    })
  }

  return <section className={variant === 'overlay' ? 'mat-view mat-view--overlay' : 'mat-view'} aria-label="HPC 文件预览">
    <header className="mat-view__toolbar">
      <span className="mat-view__title">{target === undefined ? '未选择文件' : target.path.split('/').at(-1)}</span>
      {target !== undefined && <span className="mat-view__kind">{KIND_LABELS[target.kind]}</span>}
      {peersNav !== undefined && peersNav.peers.length > 1 && <>
        <span className="mat-view__seg mat-view__peers">
          <Button size="sm" variant="outline" aria-label="上一个同后缀文件" onClick={() => { peersNav.onNavigate(peersNav.peers[(peersNav.index - 1 + peersNav.peers.length) % peersNav.peers.length]!) }}>‹</Button>
          <span className="mat-view__count">{peersNav.index + 1}/{peersNav.peers.length}</span>
          <Button size="sm" variant="outline" aria-label="下一个同后缀文件" onClick={() => { peersNav.onNavigate(peersNav.peers[(peersNav.index + 1) % peersNav.peers.length]!) }}>›</Button>
        </span>
      </>}
      {target?.kind === 'structure' && <>
        <span className="mat-view__seg">
          <Button size="sm" variant={style === 'ball+stick' ? 'primary' : 'outline'} aria-label="球棍风格" onClick={() => { onStyle('ball+stick') }}>球棍</Button>
          <Button size="sm" variant={style === 'line' ? 'primary' : 'outline'} aria-label="线框风格" onClick={() => { onStyle('line') }}>线框</Button>
          <Button size="sm" variant={style === 'spacefill' ? 'primary' : 'outline'} aria-label="填充风格" onClick={() => { onStyle('spacefill') }}>填充</Button>
        </span>
        <Button size="sm" variant={outer ? 'primary' : 'outline'} aria-label="胞外原子" aria-pressed={outer} title="显示与胞内原子成键的胞外镜像原子（Draw atoms outside unit cell bonded to atoms within unit cell）" onClick={onOuter}>胞外原子</Button>
        <Button size="sm" variant={spin ? 'primary' : 'outline'} aria-label="自转" aria-pressed={spin} onClick={onSpin}>{spin ? '停转' : '自转'}</Button>
        <Button size="sm" variant="outline" aria-label="重置视角" onClick={() => { stageRef.current?.autoView() }}>重置</Button>
      </>}
      {target?.kind === 'text' && <Button size="sm" variant="outline" aria-label="复制文本" disabled={text === undefined} onClick={copy}>复制</Button>}
      {variant === 'overlay'
        && <Button size="sm" variant="outline" className="mat-view__zoom" aria-label="收起沉浸预览" onClick={() => { viewerState.exitImmersive() }}>收起</Button>}
    </header>
    {localPath !== undefined && <div className="mat-view__path">
      <code title={localPath}>{localPath.length > 72 ? `…${localPath.slice(-71)}` : localPath}</code>
      <Button size="sm" variant="outline" aria-label="复制本地镜像路径" onClick={copyPath}>{pathCopied ? '已复制' : '复制路径'}</Button>
    </div>}
    {target?.kind === 'structure' && structInfo !== undefined && <div className="mat-view__structinfo" title={structInfo}>{structInfo}</div>}
    {target === undefined
      ? <p className="mat-view__empty">点击文件面板中的文件以预览。</p>
      : snapshot.status === 'error'
        ? <p className="mat-view__error" role="alert">预览失败：{snapshot.error}</p>
        : <>
          {busy && <p role="status" aria-live="polite" className="mat-view__loading">正在取回文件… {elapsed}s{slowHint}</p>}
          {copyFailed && <p role="alert" className="mat-view__error">复制失败</p>}
          {target.kind === 'structure' && <div key={`ngl-${target.jobId}-${target.path}`} ref={containerRef} className="mat-view__canvas" />}
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
