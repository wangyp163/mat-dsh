/**
 * 结构解析与成键管线（移植自 optimade_mcp structure_viewer 的前端 PURE 段，
 * sag-visual 渲染契约）：自解析晶胞/原子 → 共价半径 27 镜像 MIC 成键 →
 * NGL.Shape 自绘所需的颜色/半径素材。与喂 NGL 内置 CIF 解析器的旧路径相比，
 * 不再混入边界邻像原子（Si 8 位点 → 31 原子的问题），跨胞键由 image 平移
 * 显式表达，晶胞棱独立画。
 */

export type Vec3 = [number, number, number]
/** 行向量晶格：[a, b, c]。fract·L → 笛卡尔；cart·L⁻¹ → 分数。 */
export type Mat3 = ReadonlyArray<ReadonlyArray<number>>

export interface StructureAtom {
  elem: string
  f: Vec3
  pos: Vec3
}

export interface ParsedStructure {
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
  lattice: Mat3
  atoms: StructureAtom[]
  /** 真实晶胞（POSCAR/cif）画晶胞棱；xyz 的承载盒是假的，不画。 */
  hasCell: boolean
  formula: string
}

export interface StructureBond {
  i: number
  j: number
  /** j 相对 i 的晶胞平移（跨胞键）。 */
  image: Vec3
}

// 共价半径（Å），取自 ase.data.covalent_radii（1–95 号元素常用子集）
const COV_RADII: Record<string, number> = {
  H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66,
  F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05,
  Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Sc: 1.70, Ti: 1.60, V: 1.53, Cr: 1.39,
  Mn: 1.39, Fe: 1.32, Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.20,
  As: 1.19, Se: 1.20, Br: 1.20, Kr: 1.16, Rb: 2.20, Sr: 1.95, Y: 1.90, Zr: 1.75,
  Nb: 1.64, Mo: 1.54, Tc: 1.47, Ru: 1.46, Rh: 1.42, Pd: 1.39, Ag: 1.45, Cd: 1.44,
  In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40, Cs: 2.44, Ba: 2.15,
  La: 2.07, Ce: 2.04, Pr: 2.03, Nd: 2.01, Pm: 1.99, Sm: 1.98, Eu: 1.98, Gd: 1.96,
  Tb: 1.94, Dy: 1.92, Ho: 1.92, Er: 1.89, Tm: 1.90, Yb: 1.87, Lu: 1.87, Hf: 1.75,
  Ta: 1.70, W: 1.62, Re: 1.51, Os: 1.44, Ir: 1.41, Pt: 1.36, Au: 1.36, Hg: 1.32,
  Tl: 1.45, Pb: 1.46, Bi: 1.48, Po: 1.68, At: 1.68, Rn: 1.50, Fr: 2.60, Ra: 2.21,
  Ac: 2.15, Th: 2.06, Pa: 2.00, U: 1.96, Np: 1.90, Pu: 1.87, Am: 1.80, Cm: 1.69,
}

const COV_FACTOR = 1.2
const MIN_BOND_D2 = 0.01
const MAX_BOND_ATOMS = 1600

// CPK 配色（Jmol 常用子集；表外元素 → 灰 #c9d1d9）
const ELEM_HEX: Record<string, string> = {
  H: '#ffffff', He: '#d9ffff', Li: '#cc80ff', Be: '#c2ff00', B: '#ffb5b5',
  C: '#909090', N: '#3050f8', O: '#ff0d0d', F: '#90e050', Ne: '#b3e3f5',
  Na: '#ab5cf2', Mg: '#8aff00', Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000',
  S: '#ffff30', Cl: '#1ff01f', Ar: '#80d1e3', K: '#8f40d4', Ca: '#3dff00',
  Sc: '#e6e6e6', Ti: '#bfc2c7', V: '#a6a6ab', Cr: '#8a99c7', Mn: '#9c7ac7',
  Fe: '#e45a45', Co: '#f090a0', Ni: '#50d050', Cu: '#c88033', Zn: '#7d80b0',
  Ga: '#966733', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929',
  Kr: '#5cb8d1', Rb: '#702eb0', Sr: '#00ff00', Y: '#94ffff', Zr: '#94e0e0',
  Nb: '#73c2c9', Mo: '#54b5b5', Tc: '#3b9e9e', Ru: '#248f8f', Rh: '#0a7d8c',
  Pd: '#006985', Ag: '#c0c0c0', Cd: '#ffd98d', In: '#a67573', Sn: '#668080',
  Sb: '#9e63b5', Te: '#d47a00', I: '#940094', Xe: '#429eb0', Cs: '#57178f',
  Ba: '#00c900', W: '#2194d6', Pt: '#d0d0e0', Au: '#ffd123', Hg: '#ff8c00',
  Tl: '#a6544d', Pb: '#575961',
}

const FALLBACK_RGB: RGB = [201 / 255, 209 / 255, 217 / 255] // #c9d1d9 归一化

/** NGL 2.4.0 的颜色参数必须是 [r,g,b] 数组（0–1 浮点）——hex 字符串会让底层崩溃。 */
export type RGB = [number, number, number]

function hexRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  return [0, 1, 2].map(k => Number.parseInt(h.slice(k * 2, k * 2 + 2), 16) / 255) as RGB
}

export function covRadius(elem: string): number {
  const r = COV_RADII[elem]
  return typeof r === 'number' ? r : 0.75
}

export function elemRgb(elem: string): RGB {
  return ELEM_HEX[elem] === undefined ? FALLBACK_RGB : hexRgb(ELEM_HEX[elem]!)
}

/** 晶格矩阵（行 = a/b/c 矢量）← (a, b, c, α, β, γ)，与 CIF 惯例一致。 */
export function buildLattice(a: number, b: number, c: number, alpha: number, beta: number, gamma: number): Mat3 {
  const al = alpha * Math.PI / 180, be = beta * Math.PI / 180, ga = gamma * Math.PI / 180
  const cx = c * Math.cos(be)
  const cy = c * (Math.cos(al) - Math.cos(be) * Math.cos(ga)) / Math.sin(ga)
  const cz = Math.sqrt(Math.max(c * c - cx * cx - cy * cy, 0))
  return [[a, 0, 0], [b * Math.cos(ga), b * Math.sin(ga), 0], [cx, cy, cz]]
}

/** 3×3 求逆（伴随法）—— Cartn 坐标 × L⁻¹ 折算分数坐标用；奇异返回 null。 */
export function invertMatrix3(matrix: Mat3): Mat3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix as [Vec3, Vec3, Vec3]
  const cofactor = [
    [e * i - f * h, f * g - d * i, d * h - e * g],
    [c * h - b * i, a * i - c * g, b * g - a * h],
    [b * f - c * e, c * d - a * f, a * e - b * d],
  ]
  const determinant = a! * cofactor[0]![0]! + b! * cofactor[0]![1]! + c! * cofactor[0]![2]!
  if (Math.abs(determinant) < 1e-12) return null
  const transpose = (m: number[][]): number[][] => m[0]!.map((_, column) => m.map(row => row[column]!))
  return transpose(cofactor).map(row => row.map(value => value / determinant))
}

/** 行向量 × 矩阵：v·m（fract·L → 笛卡尔；cart·L⁻¹ → 分数）。 */
export function mulRows(v: ReadonlyArray<number>, m: Mat3): Vec3 {
  return [
    v[0]! * m[0]![0]! + v[1]! * m[1]![0]! + v[2]! * m[2]![0]!,
    v[0]! * m[0]![1]! + v[1]! * m[1]![1]! + v[2]! * m[2]![1]!,
    v[0]! * m[0]![2]! + v[1]! * m[1]![2]! + v[2]! * m[2]![2]!,
  ]
}

function latticeMetrics(lattice: Mat3): { lengths: Vec3; angles: Vec3 } {
  const norm = (v: ReadonlyArray<number>) => Math.hypot(v[0]!, v[1]!, v[2]!)
  const angle = (u: ReadonlyArray<number>, v: ReadonlyArray<number>) =>
    Math.acos((u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (norm(u) * norm(v))) * 180 / Math.PI
  return {
    lengths: [norm(lattice[0]!), norm(lattice[1]!), norm(lattice[2]!)],
    angles: [angle(lattice[1]!, lattice[2]!), angle(lattice[0]!, lattice[2]!), angle(lattice[0]!, lattice[1]!)],
  }
}

function finished(lattice: Mat3, atoms: StructureAtom[], hasCell: boolean, formula: string): ParsedStructure {
  const { lengths, angles } = latticeMetrics(lattice)
  return {
    a: lengths[0], b: lengths[1], c: lengths[2],
    alpha: angles[0], beta: angles[1], gamma: angles[2],
    lattice, atoms, hasCell, formula,
  }
}

function numbers(line: string): string[] {
  return line.split(/\s+/).filter(Boolean)
}

/** POSCAR（VASP v5）→ 结构。坐标约定与参考实现一致：cart = fract · L。 */
export function parsePoscar(text: string): ParsedStructure {
  // 空白行无害（真实文件与导出器常在晶格后留空行），按 token 流解析前剔除。
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
  if (lines.length < 9) throw new Error('malformed POSCAR: too few lines')
  const scale = Number(numbers(lines[1]!)[0])
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('malformed POSCAR: bad scaling factor')
  const lattice = lines.slice(2, 5).map(row => numbers(row).map(Number).slice(0, 3))
  if (lattice.some(row => row.length < 3 || row.some(value => !Number.isFinite(value)))) {
    throw new Error('malformed POSCAR: bad lattice vectors')
  }
  const scaled = lattice.map(row => row.map(value => value * scale))

  let cursor = 5
  const tokenIsCount = (token: string) => /^\d+$/.test(token)
  const elementsRow = numbers(lines[cursor]!)
  if (elementsRow.length === 0) throw new Error('malformed POSCAR: missing element symbols (v4 layouts unsupported)')
  if (elementsRow.some(token => !tokenIsCount(token))) {
    cursor += 1
  } else {
    throw new Error('malformed POSCAR: missing element symbols (v4 layouts unsupported)')
  }
  const elements = elementsRow
  const counts = numbers(lines[cursor] ?? '').map(Number)
  if (counts.length !== elements.length || counts.some(value => !Number.isInteger(value) || value <= 0)) {
    throw new Error('malformed POSCAR: element counts do not match symbols')
  }
  cursor += 1

  let mode: 'direct' | 'cartesian' | undefined
  while (cursor < lines.length) {
    const head = numbers(lines[cursor]!)[0]
    if (head === undefined) { cursor += 1; continue }
    if (/^s/i.test(head)) { cursor += 1; continue }
    if (/^d/i.test(head)) mode = 'direct'
    else if (/^c/i.test(head)) mode = 'cartesian'
    break
  }
  if (mode === undefined) throw new Error('malformed POSCAR: missing Direct/Cartesian marker')
  cursor += 1

  const inverse = mode === 'cartesian' ? invertMatrix3(scaled) : undefined
  if (inverse === null) throw new Error('malformed POSCAR: singular lattice')
  const atoms: StructureAtom[] = []
  for (const [index, symbol] of elements.entries()) {
    for (let nth = 0; nth < counts[index]!; nth++) {
      const raw = numbers(lines[cursor] ?? '').map(Number).slice(0, 3)
      if (raw.length < 3 || raw.some(value => !Number.isFinite(value))) {
        throw new Error(`malformed POSCAR: bad coordinates for ${symbol} site ${nth + 1}`)
      }
      const f = inverse === undefined ? raw as Vec3 : mulRows(raw, inverse)
      atoms.push({ elem: symbol, f, pos: mulRows(f, scaled) })
      cursor += 1
    }
  }
  if (atoms.length === 0) throw new Error('malformed POSCAR: no sites')
  return finished(scaled, atoms, true, elements.map((symbol, index) => `${symbol}${counts[index]}`).join(''))
}

/** xyz 分子 → 结构：无真实晶胞，用坐标包围盒加两侧 8Å 余量的正交盒承载。 */
export function parseXyz(text: string): ParsedStructure {
  const raw = text.split(/\r?\n/)
  let head = 0
  while (head < raw.length && raw[head]!.trim() === '') head++
  if (raw.length - head < 3) throw new Error('malformed XYZ: too few lines')
  const declared = Number(raw[head]!.trim())
  if (!Number.isInteger(declared) || declared < 1) throw new Error('malformed XYZ: bad atom count')
  // 第 2 行是注释（可为空行），原子行从第 3 行起；原子行内再容忍空白。
  const siteLines = raw.slice(head + 2).filter(line => line.trim() !== '')
  if (siteLines.length < declared) throw new Error('malformed XYZ: fewer sites than declared')
  const atoms: StructureAtom[] = []
  const MARGIN = 8
  for (const line of siteLines.slice(0, declared)) {
    const tokens = line.trim().split(/\s+/)
    const symbol = tokens[0]?.match(/^[A-Za-z]+/)?.[0]
    const coordinates = tokens.slice(1, 4).map(Number)
    if (symbol === undefined || coordinates.length < 3 || coordinates.some(value => !Number.isFinite(value))) {
      throw new Error('malformed XYZ: bad site line')
    }
    atoms.push({ elem: symbol, f: [0, 0, 0], pos: coordinates as Vec3 })
  }
  const extent = [0, 1, 2].map(axis => Math.max(...atoms.map(at => at.pos[axis])) - Math.min(...atoms.map(at => at.pos[axis])))
  const origin = [0, 1, 2].map(axis => Math.min(...atoms.map(at => at.pos[axis])) - MARGIN)
  const box = extent.map(value => value + 2 * MARGIN) as Vec3
  const lattice: Mat3 = [[box[0], 0, 0], [0, box[1], 0], [0, 0, box[2]]]
  for (const at of atoms) {
    at.f = [0, 1, 2].map(axis => (at.pos[axis] - origin[axis]!) / box[axis]!) as Vec3
  }
  const counts = new Map<string, number>()
  for (const at of atoms) counts.set(at.elem, (counts.get(at.elem) ?? 0) + 1)
  return finished(lattice, atoms, false, [...counts.entries()].map(([elem, n]) => `${elem}${n}`).join(''))
}

/** 对称操作（行向量约定）：f' = f·rotation + translation，如 '-x, y+1/2, z'。 */
interface Symop {
  rotation: number[][]
  translation: Vec3
}

const IDENTITY_SYMOP: Symop = { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] }

/** 对称操作字符串 → 矩阵；解析不了的成分返回 null（该操作跳过）。 */
function parseSymop(text: string): Symop | null {
  const parts = text.trim().replace(/^['"]|['"]$/g, '').split(',')
  if (parts.length !== 3) return null
  const axisIndex: Record<string, number> = { x: 0, y: 1, z: 2 }
  const rotation = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const translation: Vec3 = [0, 0, 0]
  for (const [row, part] of parts.entries()) {
    const terms = part.trim().match(/[+-]?[^+-]+/g)
    if (terms === null) return null
    for (const term of terms) {
      const match = term.trim().match(/^([+-])?\s*(?:(\d+)\/(\d+)|(\d*\.?\d+))?\s*([xyz])?$/i)
      if (match === null) return null
      const sign = match[1] === '-' ? -1 : 1
      const value = match[2] !== undefined
        ? Number(match[2]) / Number(match[3])
        : match[4] !== undefined && match[4] !== '' ? Number(match[4]) : 1
      if (!Number.isFinite(value)) return null
      if (match[5] !== undefined) rotation[row]![axisIndex[match[5].toLowerCase()]!] = sign * value
      else translation[row]! += sign * value
    }
  }
  return { rotation, translation }
}

function applySymop(f: Vec3, op: Symop): Vec3 {
  return [0, 1, 2].map(k =>
    f[0]! * op.rotation[0]![k]! + f[1]! * op.rotation[1]![k]! + f[2]! * op.rotation[2]![k]! + op.translation[k]!) as Vec3
}

const wrap01 = (value: number): number => value - Math.floor(value)

/** 周期等价判定（容忍 ±1 整平移）——对称展开去重用。 */
function sameFract(a: Vec3, b: Vec3): boolean {
  return [0, 1, 2].every(k => {
    const d = Math.abs(a[k]! - b[k]!)
    return Math.min(d, 1 - d) < 1e-4
  })
}

/** 行 token 化：引号段（'x, y, z' 这类含空白的值）保持为一个 token。 */
function cifTokens(line: string): string[] {
  const tokens: string[] = []
  for (const match of line.matchAll(/'[^']*'|"[^"]*"|\S+/g)) tokens.push(match[0])
  return tokens
}

/** 类型符号/标签 → 元素符号：去电荷数字，两字母不在元素表则退一字母（Ow → O）。 */
function cleanElem(raw: string): string {
  const letters = raw.replace(/[^A-Za-z]/g, '')
  if (letters === '') return 'X'
  const capped = letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase()
  if (COV_RADII[capped] !== undefined) return capped
  if (capped.length > 1 && COV_RADII[capped.charAt(0)] !== undefined) return capped.charAt(0)
  return capped
}

interface CifSite {
  elem: string
  f: Vec3
}

interface CifLoop {
  headers: string[]
  rows: string[][]
}

const MAX_EXPANSION_SITES = 2000

/** 块内 loop 收集：列头/数据行都容忍行首空白（pymatgen、ABACUS 等发射器缩进书写）。 */
function cifLoops(block: string[]): CifLoop[] {
  const loops: CifLoop[] = []
  for (let i = 0; i < block.length; i++) {
    if (!/^\s*loop_\s*$/i.test(block[i]!)) continue
    const headers: string[] = []
    let j = i + 1
    while (j < block.length && /^\s*_/.test(block[j]!)) {
      headers.push(block[j]!.trim().toLowerCase()); j++
    }
    const rows: string[][] = []
    while (j < block.length) {
      const t = block[j]!.trim()
      if (t === '') { j++; continue }
      if (t.startsWith('_') || t.startsWith('#') || t.startsWith(';') ||
        /^(loop_|data_|save_|stop_|global_)/i.test(t)) break
      rows.push(cifTokens(t))
      j++
    }
    loops.push({ headers, rows })
    i = j - 1
  }
  return loops
}

/**
 * CIF 文本 → 结构。缺晶胞参数/无原子位点 → null。
 * 真实世界容忍度：tag 行首空白/大小写不敏感、引号与 esd 与科学计数法数值、
 * `;` 多行文本块、多 data_ 块（取首个完整块）、对称操作展开（新旧两套 tag；
 * P1 只有恒等操作时为 no-op），分数坐标回绕进 [0,1)。
 */
export function parseCif(text: string): ParsedStructure | null {
  if (!text) return null
  const raw = text.split(/\r?\n/)
  // ; 起止的多行文本字段整块剔除：块内的伪 tag/伪 loop 不参与解析。
  const lines: string[] = []
  for (let i = 0; i < raw.length; i++) {
    if (/^;/.test(raw[i]!)) {
      i += 1
      while (i < raw.length && !/^;/.test(raw[i]!)) i += 1
      continue
    }
    lines.push(raw[i]!)
  }
  const blocks: string[][] = [[]]
  for (const line of lines) {
    if (/^\s*data_[^\s]*/i.test(line)) blocks.push([])
    blocks.at(-1)!.push(line)
  }
  for (const block of blocks) {
    const parsed = parseCifBlock(block)
    if (parsed !== null) return parsed
  }
  return null
}

function parseCifBlock(block: string[]): ParsedStructure | null {
  const get = (tag: string): number | null => {
    const re = new RegExp(`^\\s*_${tag}(?![\\w])\\s+(\\S+)`, 'i')
    for (const line of block) {
      const match = line.match(re)
      if (match) {
        const value = Number.parseFloat(match[1]!.replace(/^['"]|['"]$/g, '').replace(/\(\d+\)/, ''))
        return Number.isFinite(value) ? value : null
      }
    }
    return null
  }
  const a = get('cell_length_a'), b = get('cell_length_b'), c = get('cell_length_c')
  const alpha = get('cell_angle_alpha'), beta = get('cell_angle_beta'), gamma = get('cell_angle_gamma')
  if (a === null || b === null || c === null || alpha === null || beta === null || gamma === null) return null
  let formula = ''
  for (const line of block) {
    const match = line.match(/^\s*_chemical_formula_sum\s+'?([^']+?)'?\s*$/i)
    if (match) { formula = match[1]!.replace(/\s+/g, ''); break }
  }
  const lattice = buildLattice(a, b, c, alpha, beta, gamma)
  const loops = cifLoops(block)

  const symopTags = ['_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz']
  const ops: Symop[] = []
  for (const loop of loops) {
    const col = symopTags.findIndex(tag => loop.headers.includes(tag))
    if (col === -1) continue
    for (const row of loop.rows) {
      if (row.length <= col) continue
      const op = parseSymop(row[col]!)
      if (op !== null) ops.push(op)
    }
  }
  if (ops.length === 0) ops.push(IDENTITY_SYMOP)

  const sites: CifSite[] = []
  for (const loop of loops) {
    const idx: Record<string, number> = {}
    loop.headers.forEach((header, n) => { idx[header] = n })
    const fx = idx['_atom_site_fract_x'], fy = idx['_atom_site_fract_y'], fz = idx['_atom_site_fract_z']
    const cx = idx['_atom_site_cartn_x'], cy = idx['_atom_site_cartn_y'], cz = idx['_atom_site_cartn_z']
    const hasFract = fx !== undefined && fy !== undefined && fz !== undefined
    const hasCart = cx !== undefined && cy !== undefined && cz !== undefined
    if (!hasFract && !hasCart) continue
    const typeCol = idx['_atom_site_type_symbol'] !== undefined ? idx['_atom_site_type_symbol'] : idx['_atom_site_label']
    const inverse = hasCart && !hasFract ? invertMatrix3(lattice) : null
    if (hasCart && !hasFract && inverse === null) return null
    const num = (token: string) => Number.parseFloat(String(token).replace(/^['"]|['"]$/g, '').replace(/\(\d+\)/, ''))
    for (const row of loop.rows) {
      if (row.length < loop.headers.length) continue
      const f = hasFract
        ? [num(row[fx]!), num(row[fy]!), num(row[fz]!)] as Vec3
        : mulRows([num(row[cx]!), num(row[cy]!), num(row[cz]!)], inverse!)
      if (f.some(value => Number.isNaN(value))) continue
      sites.push({ elem: cleanElem(typeCol !== undefined ? row[typeCol] ?? 'X' : 'X'), f })
    }
    break // 只取第一个带坐标的 loop
  }
  if (sites.length === 0) return null

  // 对称展开 + 回绕 + 去重；位点×操作数超上限（防病态文件撑爆内存）退回原样列表。
  const expanded: CifSite[] = []
  if (sites.length * ops.length > MAX_EXPANSION_SITES) {
    expanded.push(...sites)
  } else {
    for (const op of ops) {
      for (const site of sites) {
        const f = applySymop(site.f, op).map(wrap01) as Vec3
        if (!expanded.some(seen => seen.elem === site.elem && sameFract(seen.f, f))) expanded.push({ elem: site.elem, f })
      }
    }
  }
  const atoms = expanded.map(site => ({ elem: site.elem, f: site.f, pos: mulRows(site.f, lattice) }))
  if (formula === '') {
    const counts = new Map<string, number>()
    for (const at of atoms) counts.set(at.elem, (counts.get(at.elem) ?? 0) + 1)
    formula = [...counts.entries()].map(([elem, n]) => `${elem}${n}`).join('')
  }
  return finished(lattice, atoms, true, formula)
}

/**
 * 共价成键（sag-visual 判据）：i<j 对 × 27 镜像，
 * 0.1 < d < (ri+rj)×1.2 → {i, j, image}（image = j 的跨胞平移）。
 * 原子数超上限（分子动力学大体系）返回空表，退化为纯球展示。
 */
export function computeBonds(atoms: StructureAtom[], lattice: Mat3): StructureBond[] {
  const bonds: StructureBond[] = []
  if (atoms.length === 0 || atoms.length > MAX_BOND_ATOMS) return bonds
  const images: Vec3[] = []
  const shifts: Vec3[] = []
  for (let tx = -1; tx <= 1; tx++) {
    for (let ty = -1; ty <= 1; ty++) {
      for (let tz = -1; tz <= 1; tz++) {
        images.push([tx, ty, tz])
        shifts.push([
          tx * lattice[0]![0]! + ty * lattice[1]![0]! + tz * lattice[2]![0]!,
          tx * lattice[0]![1]! + ty * lattice[1]![1]! + tz * lattice[2]![1]!,
          tx * lattice[0]![2]! + ty * lattice[1]![2]! + tz * lattice[2]![2]!,
        ])
      }
    }
  }
  for (let i = 0; i < atoms.length; i++) {
    const pi = atoms[i]!.pos, ri = covRadius(atoms[i]!.elem)
    for (let j = i + 1; j < atoms.length; j++) {
      const pj = atoms[j]!.pos
      const rmax = (ri + covRadius(atoms[j]!.elem)) * COV_FACTOR
      for (let s = 0; s < shifts.length; s++) {
        const dx = pi[0] - pj[0] - shifts[s]![0]
        const dy = pi[1] - pj[1] - shifts[s]![1]
        const dz = pi[2] - pj[2] - shifts[s]![2]
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > MIN_BOND_D2 && d2 < rmax * rmax) bonds.push({ i, j, image: images[s]! })
      }
    }
  }
  return bonds
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** 按文件名分派解析器：POSCAR 系（含无扩展名 POSCAR）/ xyz / cif。 */
export function parseStructure(name: string, text: string): ParsedStructure {
  const base = name.split('/').at(-1) ?? name
  const extension = extensionOf(base)
  if (base.toLowerCase() === 'poscar' || extension === 'poscar' || extension === 'vasp') return parsePoscar(text)
  if (extension === 'xyz') return parseXyz(text)
  if (extension === 'cif') {
    const parsed = parseCif(text)
    if (parsed === null) throw new Error('malformed CIF: missing cell parameters or atom sites')
    return parsed
  }
  throw new Error(`unsupported structure format: ${base}`)
}

/** 镜像端点原子坐标（跨胞键的 j 端平移到 i 的邻胞）。 */
export function imagePos(atom: StructureAtom, image: Vec3, lattice: Mat3): Vec3 {
  const shift = mulRows(image, lattice)
  return [atom.pos[0] + shift[0], atom.pos[1] + shift[1], atom.pos[2] + shift[2]]
}
