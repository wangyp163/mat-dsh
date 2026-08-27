import { expect, it } from 'vitest'
import { MAT_CORE_VERSION } from '../src/index'

it('sanity: 包可导入且导出版本', () => {
  expect(MAT_CORE_VERSION).toBe('0.1.0')
})
