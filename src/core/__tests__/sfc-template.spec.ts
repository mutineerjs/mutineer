import { describe, it, expect, vi } from 'vitest'
import { mutateVueSfcTemplate } from '../sfc.js'

// Mock @vue/compiler-sfc to extract template content simply
vi.mock('@vue/compiler-sfc', () => ({
  parse: (code: string, _opts?: { filename?: string }) => {
    const startTag = '<template>'
    const endTag = '</template>'
    const startIdx = code.indexOf(startTag)
    if (startIdx === -1) {
      return { descriptor: { template: null } }
    }
    const contentStart = startIdx + startTag.length
    const contentEnd = code.indexOf(endTag, contentStart)
    const content = code.slice(contentStart, contentEnd)
    return {
      descriptor: {
        template: {
          content,
          loc: {
            start: { offset: startIdx },
            source: code.slice(startIdx, contentEnd + endTag.length),
          },
        },
      },
    }
  },
}))

// Mock @vue/compiler-dom with the real implementation via actual import
// We use the actual @vue/compiler-dom parse to get real AST
vi.mock('@vue/compiler-dom', async (importOriginal) => {
  return importOriginal<typeof import('@vue/compiler-dom')>()
})

const wrapInSfc = (template: string) =>
  `<template>${template}</template>\n<script setup>\nconst x = 1\n</script>`

describe('mutateVueSfcTemplate', () => {
  it('returns empty array when there is no template block', async () => {
    const code = '<script setup>const x = 1</script>'
    const result = await mutateVueSfcTemplate('test.vue', code)
    expect(result).toEqual([])
  })

  it('throws when max is 0', async () => {
    await expect(
      mutateVueSfcTemplate('test.vue', wrapInSfc('<div></div>'), [], [], 0),
    ).rejects.toThrow('max must be a positive number, got: 0')
  })

  // ---------------------------------------------------------------------------
  // v-if negation
  // ---------------------------------------------------------------------------

  it('negates v-if expression', async () => {
    const code = wrapInSfc('<div v-if="isActive">hello</div>')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const vIfResult = results.find((r) => r.name === 'vIfNegate')
    expect(vIfResult).toBeDefined()
    expect(vIfResult!.code).toContain('v-if="!(isActive)"')
  })

  it('produces one vIfNegate mutation per v-if directive', async () => {
    const code = wrapInSfc('<div v-if="a">x</div><span v-if="b">y</span>')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const vIfResults = results.filter((r) => r.name === 'vIfNegate')
    expect(vIfResults).toHaveLength(2)
  })

  it('does not mutate static attributes as v-if', async () => {
    const code = wrapInSfc('<div class="active">hello</div>')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const vIfResults = results.filter((r) => r.name === 'vIfNegate')
    expect(vIfResults).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // v-show negation
  // ---------------------------------------------------------------------------

  it('negates v-show expression', async () => {
    const code = wrapInSfc('<div v-show="isVisible">hello</div>')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const vShowResult = results.find((r) => r.name === 'vShowNegate')
    expect(vShowResult).toBeDefined()
    expect(vShowResult!.code).toContain('v-show="!(isVisible)"')
  })

  it('does not produce vIfNegate for v-show', async () => {
    const code = wrapInSfc('<div v-show="isVisible">hello</div>')
    const results = await mutateVueSfcTemplate('test.vue', code)
    expect(results.filter((r) => r.name === 'vIfNegate')).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // v-bind negation
  // ---------------------------------------------------------------------------

  it('negates v-bind (colon shorthand) expression', async () => {
    const code = wrapInSfc('<input :disabled="isDisabled" />')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const vBindResult = results.find((r) => r.name === 'vBindNegate')
    expect(vBindResult).toBeDefined()
    expect(vBindResult!.code).toContain(':disabled="!(isDisabled)"')
  })

  it('does not mutate static (non-colon) attribute bindings', async () => {
    const code = wrapInSfc('<input disabled />')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const vBindResults = results.filter((r) => r.name === 'vBindNegate')
    expect(vBindResults).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // Nested elements
  // ---------------------------------------------------------------------------

  it('handles v-if on nested elements', async () => {
    const code = wrapInSfc('<div><span v-if="show">nested</span></div>')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const vIfResults = results.filter((r) => r.name === 'vIfNegate')
    expect(vIfResults).toHaveLength(1)
    expect(vIfResults[0].code).toContain('v-if="!(show)"')
  })

  // ---------------------------------------------------------------------------
  // include / exclude filtering
  // ---------------------------------------------------------------------------

  it('respects include filter', async () => {
    const code = wrapInSfc('<div v-if="a" v-show="b"></div>')
    const results = await mutateVueSfcTemplate('test.vue', code, ['vIfNegate'])
    expect(results.every((r) => r.name === 'vIfNegate')).toBe(true)
    expect(results.filter((r) => r.name === 'vShowNegate')).toHaveLength(0)
  })

  it('respects exclude filter', async () => {
    const code = wrapInSfc('<div v-if="a" v-show="b"></div>')
    const results = await mutateVueSfcTemplate('test.vue', code, undefined, [
      'vIfNegate',
    ])
    expect(results.filter((r) => r.name === 'vIfNegate')).toHaveLength(0)
  })

  it('returns empty when all template mutators excluded', async () => {
    const code = wrapInSfc('<div v-if="a"></div>')
    const results = await mutateVueSfcTemplate('test.vue', code, undefined, [
      'vIfNegate',
      'vShowNegate',
      'vBindNegate',
    ])
    expect(results).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // max limit
  // ---------------------------------------------------------------------------

  it('respects max limit', async () => {
    const code = wrapInSfc(
      '<div v-if="a"></div><span v-if="b"></span><p v-if="c"></p>',
    )
    const results = await mutateVueSfcTemplate(
      'test.vue',
      code,
      undefined,
      undefined,
      2,
    )
    expect(results).toHaveLength(2)
  })

  // ---------------------------------------------------------------------------
  // Output structure
  // ---------------------------------------------------------------------------

  it('returns full SFC source in mutated code', async () => {
    const code = wrapInSfc('<div v-if="isActive">hello</div>')
    const [result] = await mutateVueSfcTemplate('test.vue', code)
    expect(result.code).toContain('<script setup>')
    expect(result.code).toContain('<template>')
  })

  it('deduplicates identical mutations', async () => {
    const code = wrapInSfc('<div v-if="x"></div>')
    const results = await mutateVueSfcTemplate('test.vue', code)
    const codes = results.map((r) => r.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
