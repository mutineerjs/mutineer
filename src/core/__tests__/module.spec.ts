import { describe, it, expect } from 'vitest'
import { mutateModuleSource } from '../module.js'

describe('mutateModuleSource', () => {
  it('returns empty array for code with no mutable patterns', () => {
    const result = mutateModuleSource('const x = 1')
    expect(result).toEqual([])
  })

  it('generates mutations for equality operators', () => {
    const code = 'if (a === b) {}'
    const result = mutateModuleSource(code)
    expect(result.length).toBeGreaterThan(0)
    expect(result.some((v) => v.name === 'flipStrictEQ')).toBe(true)
  })

  it('generates mutations for logical operators', () => {
    const code = 'const x = a && b'
    const result = mutateModuleSource(code)
    expect(result.some((v) => v.name === 'andToOr')).toBe(true)
  })

  it('generates mutations for arithmetic operators', () => {
    const code = 'const x = a + b'
    const result = mutateModuleSource(code)
    expect(result.some((v) => v.name === 'addToSub')).toBe(true)
  })

  it('deduplicates identical mutations', () => {
    const code = 'if (a === b) {}'
    const result = mutateModuleSource(code)
    const codes = result.map((v) => v.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('respects include filter', () => {
    const code = 'if (a === b && c || d) {}'
    const result = mutateModuleSource(code, ['andToOr'])
    expect(result.every((v) => v.name === 'andToOr')).toBe(true)
  })

  it('respects exclude filter', () => {
    const code = 'if (a === b && c || d) {}'
    const result = mutateModuleSource(code, undefined, ['flipStrictEQ'])
    expect(result.every((v) => v.name !== 'flipStrictEQ')).toBe(true)
  })

  it('respects max limit', () => {
    const code = 'if (a === b && c || d) {}'
    const all = mutateModuleSource(code)
    expect(all.length).toBeGreaterThan(1)
    const limited = mutateModuleSource(code, undefined, undefined, 1)
    expect(limited).toHaveLength(1)
  })

  it('throws when max is 0', () => {
    expect(() => mutateModuleSource('code', undefined, undefined, 0)).toThrow(
      'max must be a positive number',
    )
  })

  it('throws when max is negative', () => {
    expect(() => mutateModuleSource('code', undefined, undefined, -1)).toThrow(
      'max must be a positive number',
    )
  })

  it('includes line and col in variants', () => {
    const code = 'const x = a + b'
    const result = mutateModuleSource(code)
    for (const v of result) {
      expect(typeof v.line).toBe('number')
      expect(typeof v.col).toBe('number')
    }
  })

  it('produces valid mutated code strings', () => {
    const code = 'const x = a <= b'
    const result = mutateModuleSource(code)
    for (const v of result) {
      expect(typeof v.code).toBe('string')
      expect(v.code).not.toBe(code)
    }
  })
})
