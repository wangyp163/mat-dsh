/** 查看器类型分派与结构格式转换（纯函数，无 DOM 依赖）。
 * 解析/成键/配色管线已移至 structure-model.ts（OPTIMADE viewer 移植）；
 * 本模块保留分类分派与 CIF 发射（emitCif）——poscarToCif/xyzToCif 是
 * structure-model 解析结果的 CIF 序列化薄封装，输出与旧内联实现逐字节一致。 */

import { parsePoscar, parseXyz } from './structure-model'
import type { ParsedStructure } from './structure-model'

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

function toCif(parsed: ParsedStructure): string {
  return emitCif(
    [parsed.a, parsed.b, parsed.c],
    [parsed.alpha, parsed.beta, parsed.gamma],
    parsed.atoms.map(at => ({ symbol: at.elem, fraction: at.f })),
  )
}

/**
 * xyz → CIF：分子没有晶胞，用坐标包围盒加两侧 8Å 余量的正交 P1 盒承载
 * （盒几何由 structure-model.parseXyz 决定）。
 */
export function xyzToCif(text: string): string {
  return toCif(parseXyz(text))
}

/** 结构文件统一转成 CIF 文本（旧管线兼容出口）：POSCAR 系与 xyz 转换，cif 原样。 */
export function structureBody(name: string, text: string): string {
  if (isPoscarFamily(name)) return poscarToCif(text)
  if (isXyz(name)) return xyzToCif(text)
  return text
}

/** xyz 是分子（无真实晶胞）：面板据此跳过晶胞框，避免画出误导性的假盒子。 */
export function isXyz(name: string): boolean {
  return extensionOf(name) === 'xyz'
}

/**
 * POSCAR（VASP v5）→ 最小 CIF（P 1 + 分数坐标）。
 * 坐标约定与参考实现（optimade_mcp structure_viewer）一致：cart = fract · L。
 */
export function poscarToCif(text: string): string {
  return toCif(parsePoscar(text))
}
