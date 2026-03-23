import { describe, it, expect } from 'vitest'
import { generateSchema } from '../schemata.js'
import type { Variant } from '../../types/mutant.js'

function makeVariant(id: string, code: string): Variant {
  return {
    id,
    name: 'test',
    file: '/src/foo.ts',
    code,
    line: 1,
    col: 1,
    tests: [],
  }
}

describe('generateSchema', () => {
  it('returns original code with ts-nocheck header for empty variants', () => {
    const original = 'const x = 1 + 2'
    const { schemaCode, fallbackIds } = generateSchema(original, [])
    expect(schemaCode).toBe('// @ts-nocheck\n' + original)
    expect(fallbackIds.size).toBe(0)
  })

  it('embeds an operator mutation using the enclosing expression', () => {
    // '+' is operator-only char diff — uses AST to find BinaryExpression 'x + y'
    const original = 'x + y'
    const { schemaCode, fallbackIds } = generateSchema(original, [
      makeVariant('f#0', 'x - y'),
    ])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'f#0'")
    expect(schemaCode).toContain('x - y')
    expect(schemaCode).toContain('x + y')
  })

  it('embeds === to !== operator mutation using the enclosing BinaryExpression', () => {
    const original = 'x === true'
    const { schemaCode, fallbackIds } = generateSchema(original, [
      makeVariant('f#0', 'x !== true'),
    ])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'f#0'")
    expect(schemaCode).toContain('x !== true')
    expect(schemaCode).toContain('x === true')
  })

  it('handles variable-length operator replacement (> → >=) without truncating operands', () => {
    // '>' is 1 char, '>=' is 2 chars — the AST end from original must be shifted by +1
    const original = 'hitCount > 0'
    const { schemaCode, fallbackIds } = generateSchema(original, [
      makeVariant('f#0', 'hitCount >= 0'),
    ])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain('hitCount >= 0')
    expect(schemaCode).toContain('hitCount > 0')
  })

  it('handles variable-length operator replacement (>= → >) without truncating operands', () => {
    // '>=' is 2 chars, '>' is 1 char — AST end shifts by -1
    const original = 'hitCount >= 0'
    const { schemaCode, fallbackIds } = generateSchema(original, [
      makeVariant('f#0', 'hitCount > 0'),
    ])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain('hitCount > 0')
    expect(schemaCode).toContain('hitCount >= 0')
  })

  it('chains multiple operator variants on the same expression site', () => {
    const original = 'x + y'
    const v0 = makeVariant('f#0', 'x - y')
    const v1 = makeVariant('f#1', 'x * y')
    const { schemaCode, fallbackIds } = generateSchema(original, [v0, v1])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'f#0'")
    expect(schemaCode).toContain("'f#1'")
    expect(schemaCode).toContain('x - y')
    expect(schemaCode).toContain('x * y')
    expect(schemaCode).toContain('x + y')
  })

  it('wraps a value mutation site in a ternary', () => {
    // 'true' → 'false': both valid identifiers, char diff path
    const original = 'return true'
    const { schemaCode, fallbackIds } = generateSchema(original, [
      makeVariant('f#0', 'return false'),
    ])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'f#0'")
    expect(schemaCode).toContain('false')
    expect(schemaCode).toContain('true')
  })

  it('chains multiple value variants on the same site', () => {
    const original = 'return true'
    const v0 = makeVariant('f#0', 'return false')
    const v1 = makeVariant('f#1', 'return null')
    const { schemaCode, fallbackIds } = generateSchema(original, [v0, v1])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'f#0'")
    expect(schemaCode).toContain("'f#1'")
    expect(schemaCode).toContain('false')
    expect(schemaCode).toContain('null')
    expect(schemaCode).toContain('true')
  })

  it('produces separate ternaries for non-overlapping sites', () => {
    // 'return true || false': two value sites, non-overlapping
    const original = 'return true || false'
    const v0 = makeVariant('f#0', 'return false || false') // first 'true' → 'false'
    const v1 = makeVariant('f#1', 'return true || true') // second 'false' → 'true'
    const { schemaCode, fallbackIds } = generateSchema(original, [v0, v1])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'f#0'")
    expect(schemaCode).toContain("'f#1'")
  })

  it('marks outer expression as fallback when inner and outer sites overlap (nested binary)', () => {
    // 'x + y - z': '+' → inner BinaryExpression 'x + y', '-' → outer 'x + y - z'
    // Inner is kept in schema; outer (containing inner) is fallback.
    const original = 'x + y - z'
    const vInner = makeVariant('f#0', 'x - y - z') // '+' → '-'
    const vOuter = makeVariant('f#1', 'x + y + z') // '-' → '+'
    const { schemaCode, fallbackIds } = generateSchema(original, [
      vInner,
      vOuter,
    ])
    // Inner (x + y site) kept in schema, outer (x + y - z site) fallback
    expect(fallbackIds.has('f#1')).toBe(true)
    expect(fallbackIds.has('f#0')).toBe(false)
    expect(schemaCode).toContain("'f#0'")
  })

  it('embeds two value-mutation variants on the same site', () => {
    const orig2 = 'return true'
    const vX = makeVariant('g#0', 'return false')
    const vY = makeVariant('g#1', 'return null')
    const { schemaCode: sc2, fallbackIds: fb2 } = generateSchema(orig2, [
      vX,
      vY,
    ])
    expect(fb2.size).toBe(0)
    expect(sc2).toContain("'g#0'")
    expect(sc2).toContain("'g#1'")
  })

  it('marks variant as fallback when diff produces empty range', () => {
    // Variant identical to original → empty diff
    const original = 'const x = 1'
    const identical = makeVariant('f#0', 'const x = 1')
    const { fallbackIds } = generateSchema(original, [identical])
    expect(fallbackIds.has('f#0')).toBe(true)
  })

  it('escapes single quotes in variant IDs', () => {
    const original = 'return true'
    const v = makeVariant("it's#0", 'return false')
    const { schemaCode } = generateSchema(original, [v])
    expect(schemaCode).toContain("it\\'s#0")
  })

  it('handles multi-character replacements correctly', () => {
    const original = 'return true'
    const v = makeVariant('r#0', 'return false')
    const { schemaCode, fallbackIds } = generateSchema(original, [v])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'r#0'")
    expect(schemaCode).toMatch(/globalThis\.__mutineer_active_id__/)
  })

  it('merges variants into same site when word-boundary extension unifies their spans', () => {
    // 'abcde' (all word chars): both variants extend to the full 5-char span [0,5]
    const original = 'abcde'
    const v0 = makeVariant('f#0', 'xyzde')
    const v1 = makeVariant('f#1', 'aUVWe')
    const { schemaCode, fallbackIds } = generateSchema(original, [v0, v1])
    expect(fallbackIds.size).toBe(0)
    expect(schemaCode).toContain("'f#0'")
    expect(schemaCode).toContain("'f#1'")
  })
})
