import { describe, it, expect } from 'vitest'
import { generateMutationVariants, getFilteredRegistry } from '../variant-utils.js'
import type { ASTMutator } from '../../mutators/registry.js'

function makeMutator(
  name: string,
  mutations: Array<{ code: string; line: number; col: number }>,
): ASTMutator {
  return {
    name,
    apply: () => mutations,
  } as ASTMutator
}

describe('generateMutationVariants', () => {
  it('returns empty array for empty registry', () => {
    expect(generateMutationVariants([], 'const x = 1')).toEqual([])
  })

  it('generates variants from a single mutator', () => {
    const mutator = makeMutator('flip', [
      { code: 'const x = 2', line: 1, col: 0 },
    ])
    const result = generateMutationVariants([mutator], 'const x = 1')
    expect(result).toEqual([
      { name: 'flip', code: 'const x = 2', line: 1, col: 0 },
    ])
  })

  it('generates variants from multiple mutators', () => {
    const m1 = makeMutator('a', [{ code: 'code_a', line: 1, col: 0 }])
    const m2 = makeMutator('b', [{ code: 'code_b', line: 2, col: 5 }])
    const result = generateMutationVariants([m1, m2], 'original')
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('a')
    expect(result[1].name).toBe('b')
  })

  it('deduplicates identical mutation outputs', () => {
    const m1 = makeMutator('a', [{ code: 'same', line: 1, col: 0 }])
    const m2 = makeMutator('b', [{ code: 'same', line: 2, col: 0 }])
    const result = generateMutationVariants([m1, m2], 'original')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('a')
  })

  it('throws when max is 0', () => {
    expect(() => generateMutationVariants([], 'code', { max: 0 })).toThrow(
      'max must be a positive number, got: 0',
    )
  })

  it('throws when max is negative', () => {
    expect(() => generateMutationVariants([], 'code', { max: -5 })).toThrow(
      'max must be a positive number, got: -5',
    )
  })

  it('respects max limit', () => {
    const mutator = makeMutator('m', [
      { code: 'v1', line: 1, col: 0 },
      { code: 'v2', line: 2, col: 0 },
      { code: 'v3', line: 3, col: 0 },
    ])
    const result = generateMutationVariants([mutator], 'code', { max: 2 })
    expect(result).toHaveLength(2)
  })

  it('stops iterating mutators once max is reached via inner return', () => {
    const m1 = makeMutator('a', [
      { code: 'v1', line: 1, col: 0 },
      { code: 'v2', line: 2, col: 0 },
    ])
    const m2 = makeMutator('b', [{ code: 'v3', line: 3, col: 0 }])
    const result = generateMutationVariants([m1, m2], 'code', { max: 2 })
    expect(result).toHaveLength(2)
    expect(result.every((v) => v.name === 'a')).toBe(true)
  })

  // NOTE: The outer loop `break` (variant-utils.ts line 42) is dead code.
  // The inner loop always `return`s immediately when max is reached after adding
  // a new unique variant, so the outer loop check can never fire.
  // Same applies to sfc.ts line 43.

  it('works with undefined max', () => {
    const mutator = makeMutator('m', [
      { code: 'v1', line: 1, col: 0 },
      { code: 'v2', line: 2, col: 0 },
    ])
    const result = generateMutationVariants([mutator], 'code', {})
    expect(result).toHaveLength(2)
  })
})

describe('getFilteredRegistry', () => {
  it('returns the full registry when no filters', () => {
    const result = getFilteredRegistry()
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('apply')
  })

  it('filters by include', () => {
    const result = getFilteredRegistry(['flipEQ', 'andToOr'])
    expect(result.map((r) => r.name)).toEqual(['andToOr', 'flipEQ'])
  })

  it('filters by exclude', () => {
    const all = getFilteredRegistry()
    const result = getFilteredRegistry(undefined, ['flipEQ'])
    expect(result.length).toBe(all.length - 1)
    expect(result.find((r) => r.name === 'flipEQ')).toBeUndefined()
  })
})
