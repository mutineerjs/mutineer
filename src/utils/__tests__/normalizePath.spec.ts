import { describe, it, expect } from 'vitest'
import { normalizePath } from '../normalizePath.js'

describe('normalizePath', () => {
  it('replaces backslashes with forward slashes', () => {
    expect(normalizePath('src\\utils\\file.ts')).toBe('src/utils/file.ts')
  })

  it('handles multiple consecutive backslashes', () => {
    expect(normalizePath('src\\\\file.ts')).toBe('src//file.ts')
  })

  it('leaves forward slashes unchanged', () => {
    expect(normalizePath('src/utils/file.ts')).toBe('src/utils/file.ts')
  })

  it('handles empty string', () => {
    expect(normalizePath('')).toBe('')
  })

  it('handles mixed slashes', () => {
    expect(normalizePath('src\\utils/file.ts')).toBe('src/utils/file.ts')
  })

  it('handles Windows-style absolute paths', () => {
    expect(normalizePath('C:\\Users\\dev\\project')).toBe(
      'C:/Users/dev/project',
    )
  })
})
