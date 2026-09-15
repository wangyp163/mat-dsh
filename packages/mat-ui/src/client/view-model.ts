/** 查看器类型分派与结构格式转换（纯函数，无 DOM 依赖）。 */

export type ViewKind = 'structure' | 'image' | 'pdf' | 'text' | 'unsupported'

const STRUCTURE_EXTENSIONS = new Set(['xyz', 'cif', 'poscar', 'vasp'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const TEXT_EXTENSIONS = new Set([
  'log', 'out', 'txt', 'json', 'jsonl', 'sh', 'com', 'gjf', 'inp', 'py', 'csv', 'md', 'yml', 'yaml', 'slurm', 'pbs', 'job',
])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** 按扩展名（及无扩展名的 POSCAR 文件名）分派查看方式。 */
export function classifyFile(name: string): ViewKind {
  const base = name.split('/').at(-1) ?? name
  if (base.toLowerCase() === 'poscar') return 'structure'
  const extension = extensionOf(base)
  if (STRUCTURE_EXTENSIONS.has(extension)) return 'structure'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (extension === 'pdf') return 'pdf'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return 'unsupported'
}

/** POSCAR 系（POSCAR/.poscar/.vasp）需要 poscarToCif 转换；cif 原样喂 NGL。 */
export function isPoscarFamily(name: string): boolean {
  const base = name.split('/').at(-1) ?? name
  if (base.toLowerCase() === 'poscar') return true
  const extension = extensionOf(base)
  return extension === 'poscar' || extension === 'vasp'
}

/** 最小 CIF 写出：P 1 + 分数坐标（POSCAR 转换与 xyz 包盒共用）。 */
function emitCif(lengths: [number, number, number], angles: [number, number, number], sites: Array<{ symbol: string; fraction: [number, number, number] }>): string {
  const rows = sites.map((site, index) =>
    `${site.symbol}${index + 1} ${site.symbol} ${site.fraction.map(value => value.toFixed(6)).join(' ')} 1.000000`)
  return [
    'data_structure',
    `_cell_length_a    ${lengths[0].toFixed(6)}`,
    `_cell_length_b    ${lengths[1].toFixed(6)}`,
    `_cell_length_c    ${lengths[2].toFixed(6)}`,
    `_cell_angle_alpha ${angles[0].toFixed(3)}`,
    `_cell_angle_beta  ${angles[1].toFixed(3)}`,
    `_cell_angle_gamma ${angles[2].toFixed(3)}`,
    // 旧式标签：vendored NGL 的 CifParser 非可选地读 symmetry_space_group_name_H-M。
    "_symmetry_space_group_name_H-M 'P 1'",
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    // occupancy 的取值虽可选，但 getField 本身非可选——缺列直接崩。
    '_atom_site_occupancy',
    ...rows,
    '',
  ].join('\n')
}

/**
 * xyz → CIF：分子没有晶胞，用坐标包围盒加两侧 8Å 余量的正交 P1 盒承载
 * （ vendored NGL 未注册 xyz 解析器，统一走 cif；分子源由面板跳过晶胞框）。
 */
export function xyzToCif(text: string): string {
  const raw = text.split(/\r?\n/)
  let head = 0
  while (head < raw.length && raw[head]!.trim() === '') head++
  if (raw.length - head < 3) throw new Error('malformed XYZ: too few lines')
  const declared = Number(raw[head]!.trim())
  if (!Number.isInteger(declared) || declared < 1) throw new Error('malformed XYZ: bad atom count')
  // 第 2 行是注释（可为空行），原子行从第 3 行起；原子行内再容忍空白。
  const siteLines = raw.slice(head + 2).filter(line => line.trim() !== '')
  if (siteLines.length < declared) throw new Error('malformed XYZ: fewer sites than declared')
  const sites: Array<{ symbol: string; cartesian: [number, number, number] }> = []
  for (const line of siteLines.slice(0, declared)) {
    const tokens = line.trim().split(/\s+/)
    const symbol = tokens[0]?.match(/^[A-Za-z]+/)?.[0]
    const coordinates = tokens.slice(1, 4).map(Number)
    if (symbol === undefined || coordinates.length < 3 || coordinates.some(value => !Number.isFinite(value))) {
      throw new Error('malformed XYZ: bad site line')
    }
    sites.push({ symbol, cartesian: coordinates as [number, number, number] })
  }

  const MARGIN = 8
  const extent = [0, 1, 2].map(axis => Math.max(...sites.map(site => site.cartesian[axis])) - Math.min(...sites.map(site => site.cartesian[axis])))
  const origin = [0, 1, 2].map(axis => Math.min(...sites.map(site => site.cartesian[axis])) - MARGIN)
  const box = extent.map(value => value + 2 * MARGIN) as [number, number, number]
  return emitCif(box, [90, 90, 90], sites.map(site => ({
    symbol: site.symbol,
    fraction: [0, 1, 2].map(axis => (site.cartesian[axis] - origin[axis]!) / box[axis]!) as [number, number, number],
  })))
}

/** 结构文件统一转成 NGL 可加载的 CIF 文本：POSCAR 系与 xyz 转换，cif 原样。 */
export function structureBody(name: string, text: string): string {
  if (isPoscarFamily(name)) return poscarToCif(text)
  if (isXyz(name)) return xyzToCif(text)
  return text
}

/** xyz 是分子（无真实晶胞）：面板据此跳过晶胞框，避免画出误导性的假盒子。 */
export function isXyz(name: string): boolean {
  return extensionOf(name) === 'xyz'
}

type Mat3 = ReadonlyArray<ReadonlyArray<number>>

function multiplyMatrixVector(matrix: Mat3, vector: ReadonlyArray<number>): number[] {
  return [
    vector[0]! * matrix[0]![0]! + vector[1]! * matrix[1]![0]! + vector[2]! * matrix[2]![0]!,
    vector[0]! * matrix[0]![1]! + vector[1]! * matrix[1]![1]! + vector[2]! * matrix[2]![1]!,
    vector[0]! * matrix[0]![2]! + vector[1]! * matrix[1]![2]! + vector[2]! * matrix[2]![2]!,
  ]
}

function invertMatrix3(matrix: Mat3): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix as [number[], number[], number[]]
  const cofactor = [
    [e * i - f * h, f * g - d * i, d * h - e * g],
    [c * h - b * i, a * i - c * g, b * g - a * h],
    [b * f - c * e, c * d - a * f, a * e - b * d],
  ]
  const determinant = a * cofactor[0]![0]! + b * cofactor[0]![1]! + c * cofactor[0]![2]!
  if (Math.abs(determinant) < 1e-12) throw new Error('malformed POSCAR: singular lattice')
  // 逆 = 伴随阵 / 行列式，伴随阵 = 余子式阵的转置。
  const transpose = (matrix: number[][]): number[][] => matrix[0]!.map((_, column) => matrix.map(row => row[column]!))
  return transpose(cofactor).map(row => row.map(value => value / determinant))
}

function latticeMetrics(lattice: Mat3): { lengths: [number, number, number]; angles: [number, number, number] } {
  const norm = (v: ReadonlyArray<number>) => Math.hypot(v[0]!, v[1]!, v[2]!)
  const angle = (u: ReadonlyArray<number>, v: ReadonlyArray<number>) =>
    Math.acos((u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (norm(u) * norm(v))) * 180 / Math.PI
  return {
    lengths: [norm(lattice[0]!), norm(lattice[1]!), norm(lattice[2]!)],
    angles: [angle(lattice[1]!, lattice[2]!), angle(lattice[0]!, lattice[2]!), angle(lattice[0]!, lattice[1]!)],
  }
}

/**
 * POSCAR（VASP v5）→ 最小 CIF（P 1 + 分数坐标）。
 * 坐标约定与参考实现（optimade_mcp structure_viewer/cif.py）一致：cart = fract @ L。
 */
export function poscarToCif(text: string): string {
  // 空白行无害（真实文件与导出器常在晶格后留空行），按 token 流解析前剔除。
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
  const numbers = (line: string) => line.split(/\s+/).filter(Boolean)
  if (lines.length < 9) throw new Error('malformed POSCAR: too few lines')
  const scale = Number(numbers(lines[1]!)[0])
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('malformed POSCAR: bad scaling factor')
  const lattice = lines.slice(2, 5).map(row => numbers(row).map(Number).slice(0, 3))
  if (lattice.some(row => row.length < 3 || row.some(value => !Number.isFinite(value)))) {
    throw new Error('malformed POSCAR: bad lattice vectors')
  }
  const scaled = lattice.map(row => row.map(value => value * scale)) as number[][]

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
  const sites: Array<{ symbol: string; fraction: [number, number, number] }> = []
  for (const [index, symbol] of elements.entries()) {
    for (let nth = 0; nth < counts[index]!; nth++) {
      const raw = numbers(lines[cursor] ?? '').map(Number).slice(0, 3)
      if (raw.length < 3 || raw.some(value => !Number.isFinite(value))) {
        throw new Error(`malformed POSCAR: bad coordinates for ${symbol} site ${nth + 1}`)
      }
      const fraction = inverse === undefined
        ? raw as [number, number, number]
        : multiplyMatrixVector(inverse, raw) as [number, number, number]
      sites.push({ symbol, fraction })
      cursor += 1
    }
  }
  if (sites.length === 0) throw new Error('malformed POSCAR: no sites')

  const { lengths, angles } = latticeMetrics(scaled)
  return emitCif(lengths, angles, sites)
}
