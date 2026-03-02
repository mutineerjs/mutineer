import { describe, it, expect } from 'vitest'
import { getRegistry } from '../registry.js'

const ALL_NAMES = [
  'relaxLE',
  'relaxGE',
  'tightenLT',
  'tightenGT',
  'andToOr',
  'orToAnd',
  'nullishToOr',
  'flipEQ',
  'flipNEQ',
  'flipStrictEQ',
  'flipStrictNEQ',
  'addToSub',
  'subToAdd',
  'mulToDiv',
  'divToMul',
  'modToMul',
  'powerToMul',
] as const

describe('mutator registry', () => {
  it('returns all mutators by default in declared order', () => {
    const all = getRegistry().map((m) => m.name)
    expect(all).toEqual([...ALL_NAMES])
  })

  it('can include only specified mutators', () => {
    const only = getRegistry(['andToOr', 'flipEQ', 'subToAdd']).map(
      (m) => m.name,
    )
    expect(only).toEqual(['andToOr', 'flipEQ', 'subToAdd'])
  })

  it('can exclude specific mutators', () => {
    const filtered = getRegistry(undefined, [
      'flipEQ',
      'relaxGE',
      'modToMul',
    ]).map((m) => m.name)
    expect(filtered).toEqual(
      ALL_NAMES.filter((n) => !['flipEQ', 'relaxGE', 'modToMul'].includes(n)),
    )
  })

  it('exclude still filters after include selection', () => {
    const filtered = getRegistry(
      ['flipEQ', 'relaxGE', 'nullishToOr'],
      ['flipEQ'],
    ).map((m) => m.name)
    expect(filtered).toEqual(['relaxGE', 'nullishToOr'])
  })
})
