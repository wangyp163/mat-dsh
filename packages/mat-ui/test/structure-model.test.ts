import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { computeBonds, elemRgb, parseCif, parsePoscar, parseStructure, parseXyz } from '../src/client/structure-model'
import { poscarToCif } from '../src/client/view-model'

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('structure-model（OPTIMADE viewer 管线移植）', () => {
  it('parses a direct-coordinates POSCAR into lattice + cartesian + fractional sites', async () => {
    const parsed = parsePoscar(await fixture('Si.poscar'))
    expect(parsed.hasCell).toBe(true)
    expect(parsed.atoms).toHaveLength(8)
    expect(parsed.atoms[0]).toMatchObject({ elem: 'Si', f: [0, 0, 0] })
    expect(parsed.atoms[1]!.f).toEqual([0.25, 0.25, 0.25])
    // 立方晶胞 5.43 Å：笛卡尔位点是分数 × 晶格。
    expect(parsed.a).toBeCloseTo(5.43, 6)
    expect(parsed.alpha).toBeCloseTo(90, 3)
    expect(parsed.atoms[1]!.pos[0]).toBeCloseTo(5.43 * 0.25, 6)
    expect(parsed.formula).toBe('Si8')
  })

  it('parses cartesian POSCAR through the lattice inverse (round-trip)', async () => {
    const text = await fixture('POSCAR_Si_cart')
    const parsed = parsePoscar(text)
    const lattice = text.split('\n').slice(2, 5).map(row => row.trim().split(/\s+/).map(Number))
    const cartesian = text.split('\n').slice(9, 17).map(row => row.trim().split(/\s+/).map(Number))
    expect(parsed.atoms).toHaveLength(8)
    parsed.atoms.forEach((atom, index) => {
      const rebuilt = [0, 1, 2].map(axis =>
        atom.f[0]! * lattice[0]![axis]! + atom.f[1]! * lattice[1]![axis]! + atom.f[2]! * lattice[2]![axis]!)
      rebuilt.forEach((value, axis) => expect(value).toBeCloseTo(cartesian[index]![axis]!, 4))
    })
  })

  it('computes diamond Si bonds with cross-cell images (8 sites × 4 bonds / 2 = 16)', async () => {
    const parsed = parsePoscar(await fixture('Si.poscar'))
    const bonds = computeBonds(parsed.atoms, parsed.lattice)
    expect(bonds).toHaveLength(16)
    // 金刚石位点的近邻全在跨胞/半胞位置：image 非零的键占多数。
    expect(bonds.filter(bond => bond.image.some(value => value !== 0)).length).toBeGreaterThan(0)
    // 每个原子恰好 4 键（配位数守恒：键端点计数）。
    const degree = new Array<number>(parsed.atoms.length).fill(0)
    for (const bond of bonds) { degree[bond.i]! += 1; degree[bond.j]! += 1 }
    expect(degree.every(count => count === 4)).toBe(true)
  })

  it('wraps xyz molecules in a padded fake box without a cell', async () => {
    const parsed = parseXyz(await fixture('water.xyz'))
    expect(parsed.hasCell).toBe(false)
    expect(parsed.atoms.map(atom => atom.elem)).toEqual(['O', 'H', 'H'])
    // 水分子：O-H ×2，H-H 距离 ~1.5 Å 超出共价判据 → 恰好 2 键。
    expect(computeBonds(parsed.atoms, parsed.lattice)).toHaveLength(2)
    expect(parsed.formula).toBe('O1H2')
  })

  it('parses CIF text (the emitted CIF round-trips through parseCif)', async () => {
    const cif = poscarToCif(await fixture('Si.poscar'))
    const parsed = parseCif(cif)
    expect(parsed).not.toBeNull()
    expect(parsed!.atoms).toHaveLength(8)
    expect(parsed!.atoms[1]!.f).toEqual([0.25, 0.25, 0.25])
    expect(parsed!.hasCell).toBe(true)
  })

  it('parseStructure dispatches by family: POSCAR / extension-less POSCAR / xyz / cif', async () => {
    const poscar = await fixture('Si.poscar')
    expect(parseStructure('POSCAR', poscar).atoms).toHaveLength(8)
    expect(parseStructure('work/mp-1078217_NaFeF3.poscar', poscar).formula).toBe('Si8')
    expect(parseStructure('water.xyz', await fixture('water.xyz')).hasCell).toBe(false)
    expect(parseStructure('Si.cif', poscarToCif(poscar)).atoms).toHaveLength(8)
  })

  it('parses real-world CIFs whose loop headers are indented (pymatgen export)', async () => {
    const parsed = parseCif(await fixture('mp-3834.cif'))
    expect(parsed).not.toBeNull()
    expect(parsed!.atoms).toHaveLength(5)
    expect(parsed!.formula).toBe('Ba1Zr1O3')
    expect(parsed!.atoms[1]).toMatchObject({ elem: 'Zr', f: [0.5, 0.5, 0.5] })
    expect(parsed!.hasCell).toBe(true)
  })

  it('wraps out-of-range fractional coordinates (ABACUS emits 1.0 as 0.0)', async () => {
    const parsed = parseCif(await fixture('abacus-si.cif'))
    expect(parsed).not.toBeNull()
    expect(parsed!.atoms).toHaveLength(2)
    expect(parsed!.atoms[0]!.f).toEqual([0, 0, 0])
    expect(parsed!.atoms[1]!.f).toEqual([0.25, 0.25, 0.25])
  })

  it('expands symmetry operations beyond identity and dedupes periodic equivalents', () => {
    // 岩盐 MgO 不对称单元 2 位点 + 体心平移操作 → 4 位点；'x,y,z' 写在引号里。
    const cif = [
      'data_MgO',
      '_cell_length_a 4.21',
      '_cell_length_b 4.21',
      '_cell_length_c 4.21',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      'loop_',
      ' _space_group_symop_operation_xyz',
      "  'x, y, z'",
      "  'x+1/2, y+1/2, z+1/2'",
      'loop_',
      ' _atom_site_label',
      ' _atom_site_fract_x',
      ' _atom_site_fract_y',
      ' _atom_site_fract_z',
      '  Mg1 0.0 0.0 0.0',
      '  O1 0.5 0.5 0.5',
      '',
    ].join('\n')
    const parsed = parseCif(cif)
    expect(parsed).not.toBeNull()
    expect(parsed!.atoms).toHaveLength(4)
    expect(parsed!.formula).toBe('Mg2O2')
  })

  it('tolerates quoted/esd/scientific-notation values and ignores fake tags inside ; text fields', () => {
    const cif = [
      "data_x '_atom_site_fract_x 9 9 9'", // 引号文本里藏伪 tag，不参与解析
      '_cell_length_a 4.0496(2)',
      "_cell_length_b '4.0496'",
      '_cell_length_c 4.0496e0',
      '_cell_angle_alpha 90.0(1)',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      ';',
      '_cell_length_a 999',
      'loop_',
      ' _atom_site_label',
      ' _atom_site_fract_x',
      ' _atom_site_fract_y',
      ' _atom_site_fract_z',
      ' Si1 0 0 0',
      ';',
      'loop_',
      '_atom_site_label',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      ' Si1 0.25 0.25 0.25',
    ].join('\n')
    const parsed = parseCif(cif)
    expect(parsed).not.toBeNull()
    expect(parsed!.a).toBeCloseTo(4.0496, 4)
    // 第二个 data_ 块（; 块之后）才带位点：取到的是它。
    expect(parsed!.atoms).toHaveLength(1)
    expect(parsed!.atoms[0]!.f).toEqual([0.25, 0.25, 0.25])
  })

  it('picks the first data_ block that has both cell and sites', () => {
    const cif = [
      'data_partial', // 只有晶胞没有位点 → 跳过
      '_cell_length_a 3.0',
      '_cell_length_b 3.0',
      '_cell_length_c 3.0',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      'data_full',
      '_cell_length_a 5.0',
      '_cell_length_b 5.0',
      '_cell_length_c 5.0',
      '_cell_angle_alpha 90',
      '_cell_angle_beta 90',
      '_cell_angle_gamma 90',
      'loop_',
      '_atom_site_label',
      '_atom_site_fract_x',
      '_atom_site_fract_y',
      '_atom_site_fract_z',
      ' C1 0.1 0.1 0.1',
    ].join('\n')
    const parsed = parseCif(cif)
    expect(parsed).not.toBeNull()
    expect(parsed!.a).toBeCloseTo(5.0, 6)
    expect(parsed!.atoms).toHaveLength(1)
  })

  it('maps elements to CPK colors as rgb arrays (NGL 2.4.0 crashes on hex strings)', () => {
    expect(elemRgb('Si')).toEqual([240 / 255, 200 / 255, 160 / 255]) // #f0c8a0
    expect(elemRgb('O')).toEqual([255 / 255, 13 / 255, 13 / 255])    // #ff0d0d
    expect(elemRgb('Xx')).toEqual([201 / 255, 209 / 255, 217 / 255]) // 表外灰 #c9d1d9
  })

  it('skips bonding for oversized systems (degrades to spheres-only)', () => {
    const atoms = Array.from({ length: 1601 }, () => ({ elem: 'C', f: [0, 0, 0] as [number, number, number], pos: [0, 0, 0] as [number, number, number] }))
    expect(computeBonds(atoms, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toHaveLength(0)
  })
})
