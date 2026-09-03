import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { classifyFile, isPoscarFamily, isXyz, poscarToCif, structureBody, xyzToCif } from '../src/client/view-model'

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('classifyFile', () => {
  it('routes structure formats including the extension-less POSCAR', () => {
    expect(classifyFile('water.xyz')).toBe('structure')
    expect(classifyFile('Si.cif')).toBe('structure')
    expect(classifyFile('POSCAR')).toBe('structure')
    expect(classifyFile('relaxed.poscar')).toBe('structure')
    expect(classifyFile('slab.vasp')).toBe('structure')
    expect(structureBody('Si.cif', 'raw cif')).toBe('raw cif')
    // 仅 POSCAR 系需要 poscarToCif 转换；cif 原样喂 NGL。
    expect(isPoscarFamily('POSCAR')).toBe(true)
    expect(isPoscarFamily('relaxed.poscar')).toBe(true)
    expect(isPoscarFamily('slab.vasp')).toBe(true)
    expect(isPoscarFamily('Si.cif')).toBe(false)
    expect(isPoscarFamily('water.xyz')).toBe(false)
  })

  it('routes images, pdf, and text formats', () => {
    expect(classifyFile('ir_spectrum.png')).toBe('image')
    expect(classifyFile('photo.jpg')).toBe('image')
    expect(classifyFile('photo.jpeg')).toBe('image')
    expect(classifyFile('anim.gif')).toBe('image')
    expect(classifyFile('shot.webp')).toBe('image')
    expect(classifyFile('report.pdf')).toBe('pdf')
    expect(classifyFile('job.log')).toBe('text')
    expect(classifyFile('result.json')).toBe('text')
    expect(classifyFile('slurm-123.out')).toBe('text')
    expect(classifyFile('input.com')).toBe('text')
    expect(classifyFile('input.gjf')).toBe('text')
    expect(classifyFile('run.sh')).toBe('text')
    expect(classifyFile('notes.txt')).toBe('text')
  })

  it('rejects everything else as unsupported', () => {
    expect(classifyFile('binary.exe')).toBe('unsupported')
    expect(classifyFile('data.dat')).toBe('unsupported')
    expect(classifyFile('archive.tar.gz')).toBe('unsupported')
    expect(classifyFile('poscar.txt.bak')).toBe('unsupported')
  })
})

describe('poscarToCif', () => {
  it('converts a direct-coordinates POSCAR cell to CIF with exact lattice and sites', async () => {
    const cif = poscarToCif(await fixture('Si.poscar'))
    expect(cif).toContain('_cell_length_a    5.430000')
    expect(cif).toContain('_cell_length_b    5.430000')
    expect(cif).toContain('_cell_length_c    5.430000')
    expect(cif).toContain('_cell_angle_alpha 90.000')
    expect(cif).toContain('_cell_angle_beta  90.000')
    expect(cif).toContain('_cell_angle_gamma 90.000')
    expect(cif).toContain("_symmetry_space_group_name_H-M 'P 1'")
    const sites = cif.split('\n').filter(line => /^Si\d+ Si /.test(line))
    expect(sites).toHaveLength(8)
    expect(sites[0]).toBe('Si1 Si 0.000000 0.000000 0.000000 1.000000')
    expect(sites[1]).toBe('Si2 Si 0.250000 0.250000 0.250000 1.000000')
    // 直角晶格下 Direct 分数坐标应原样出现（5.43 的 0.5/0.75 位点）
    expect(sites[2]).toBe('Si3 Si 0.500000 0.500000 0.000000 1.000000')
    expect(sites[7]).toBe('Si8 Si 0.250000 0.750000 0.750000 1.000000')
  })

  it('converts cartesian POSCAR coordinates back to fractional (round-trip through the fixture lattice)', async () => {
    const text = await fixture('POSCAR_Si_cart')
    const cif = poscarToCif(text)
    const cell = (tag: string) => Number(cif.match(new RegExp(`${tag}\\s+([\\d.]+)`))![1])
    // fcc 原胞：a = √3·s（s=3.326061），三夹角 = arccos(−1/3) ≈ 109.4712°
    expect(cell('_cell_length_a')).toBeCloseTo(Math.sqrt(3) * 3.326061, 4)
    expect(cell('_cell_angle_alpha')).toBeCloseTo(109.4712, 2)
    expect(cell('_cell_angle_gamma')).toBeCloseTo(109.4712, 2)
    const lattice = text.split('\n').slice(2, 5).map(row => row.trim().split(/\s+/).map(Number))
    const sites = cif.split('\n').filter(line => /^Si\d+ Si /.test(line))
    expect(sites).toHaveLength(8)
    const cartesian = text.split('\n').slice(9, 17).map(row => row.trim().split(/\s+/).map(Number))
    sites.forEach((line, index) => {
      const [, , fx, fy, fz] = line.split(' ').map(Number) as number[]
      const [x, y, z] = cartesian[index]!
      const rebuilt = [fx! * lattice[0]![0]! + fy! * lattice[1]![0]! + fz! * lattice[2]![0]!,
        fx! * lattice[0]![1]! + fy! * lattice[1]![1]! + fz! * lattice[2]![1]!,
        fx! * lattice[0]![2]! + fy! * lattice[1]![2]! + fz! * lattice[2]![2]!]
      expect(rebuilt[0]).toBeCloseTo(x, 4)
      expect(rebuilt[1]).toBeCloseTo(y, 4)
      expect(rebuilt[2]).toBeCloseTo(z, 4)
    })
  })

  it('applies the universal scaling factor and skips selective-dynamics flags', () => {
    const scaled = [
      'test cell',
      '2.0',
      '1.0 0.0 0.0',
      '0.0 1.5 0.0',
      '0.0 0.0 2.5',
      'C',
      '1',
      'Selective dynamics',
      'Direct',
      '0.5 0.5 0.5 T T T',
    ].join('\n')
    const cif = poscarToCif(`${scaled}\n`)
    expect(cif).toContain('_cell_length_a    2.000000')
    expect(cif).toContain('_cell_length_b    3.000000')
    expect(cif).toContain('_cell_length_c    5.000000')
    expect(cif).toContain('C1 C 0.500000 0.500000 0.500000 1.000000')
  })

  it('fails closed on malformed input', () => {
    expect(() => poscarToCif('')).toThrow(/malformed POSCAR/)
    expect(() => poscarToCif('only a title\n')).toThrow(/malformed POSCAR/)
  })
})

describe('xyzToCif', () => {
  it('wraps the molecule in a padded orthogonal P1 box with all sites as fractions', async () => {
    const cif = xyzToCif(await fixture('water.xyz'))
    // 水分子 3 位点：O 在盒内、H 相邻。
    const sites = cif.split('\n').filter(line => /^[OH]\d+ [OH] /.test(line))
    expect(sites).toHaveLength(3)
    expect(sites[0]).toMatch(/^O1 O 0\.\d+ 0\.\d+ 0\.\d+ 1\.000000$/)
    expect(cif).toContain('_cell_angle_alpha 90.000')
    expect(cif).toContain('_cell_angle_beta  90.000')
    expect(cif).toContain('_cell_angle_gamma 90.000')
    expect(cif).toContain("_symmetry_space_group_name_H-M 'P 1'")
    // 盒长 = 坐标范围 + 两侧各 8Å 余量（夹具水：x 范围 1.29333、y 0.41599、z 0.81444）。
    const length = (tag: string) => Number(cif.match(new RegExp(`${tag}\\s+([\\d.]+)`))![1])
    expect(length('_cell_length_a')).toBeCloseTo(1.29333 + 16, 2)
    expect(length('_cell_length_b')).toBeCloseTo(0.41599 + 16, 2)
    expect(length('_cell_length_c')).toBeCloseTo(0.81444 + 16, 2)
    // 分数坐标 ∈ [0,1)。
    for (const line of sites) {
      for (const value of line.split(' ').slice(2, 5).map(Number)) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
      }
    }
  })

  it('dispatches through structureBody: xyz and POSCAR convert, cif passes through', async () => {
    const xyz = await fixture('water.xyz')
    expect(structureBody('water.xyz', xyz)).not.toBe(xyz)
    expect(structureBody('water.xyz', xyz)).toContain('O1 O ')
    const poscar = await fixture('Si.poscar')
    expect(structureBody('POSCAR', poscar)).toContain('Si1 Si 0.000000 0.000000 0.000000 1.000000')
    expect(structureBody('Si.cif', 'data_x\n')).toBe('data_x\n')
    // 分子源标记：xyz 没有真实晶胞，面板据此跳过晶胞框。
    expect(isXyz('water.xyz')).toBe(true)
    expect(isXyz('Si.cif')).toBe(false)
    expect(isXyz('POSCAR')).toBe(false)
  })

  it('fails closed on malformed input', () => {
    expect(() => xyzToCif('')).toThrow(/malformed XYZ/)
    expect(() => xyzToCif('3\ncomment\nonly one atom line\n')).toThrow(/malformed XYZ/)
    expect(() => xyzToCif('two\ncomment\nO 0 0 0\n')).toThrow(/malformed XYZ/)
  })
})
