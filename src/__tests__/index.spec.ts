import { describe, it, expect } from 'vitest'
import { defineMutineerConfig } from '../index.js'

describe('defineMutineerConfig', () => {
  it('returns the config object unchanged', () => {
    const cfg = { runner: 'vitest' as const }
    expect(defineMutineerConfig(cfg)).toBe(cfg)
  })
})
