import { describe, it, expect, vi } from 'vitest'
import { mutateVueSfcScriptSetup, mutateVueSfcTemplate } from '../sfc.js'

// Allow individual tests to override getFilteredRegistry
vi.mock('../variant-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../variant-utils.js')>()
  return {
    ...actual,
    getFilteredRegistry: vi.fn(actual.getFilteredRegistry),
  }
})

// Mock @vue/compiler-sfc to handle both <script setup> and <template> blocks
vi.mock('@vue/compiler-sfc', () => ({
  parse: (code: string, _opts?: { filename?: string }) => {
    const scriptStartTag = '<script setup>'
    const scriptEndTag = '</script>'
    const scriptStartIdx = code.indexOf(scriptStartTag)
    let scriptSetup = null
    if (scriptStartIdx !== -1) {
      const contentStart = scriptStartIdx + scriptStartTag.length
      const contentEnd = code.indexOf(scriptEndTag, contentStart)
      scriptSetup = {
        loc: {
          start: { offset: contentStart },
          end: { offset: contentEnd },
        },
      }
    }

    const templateStartTag = '<template>'
    const templateEndTag = '</template>'
    const templateStartIdx = code.indexOf(templateStartTag)
    let template = null
    if (templateStartIdx !== -1) {
      const contentStart = templateStartIdx + templateStartTag.length
      const contentEnd = code.indexOf(templateEndTag, contentStart)
      const content = code.slice(contentStart, contentEnd)
      template = {
        content,
        loc: {
          start: { offset: templateStartIdx },
          source: code.slice(
            templateStartIdx,
            contentEnd + templateEndTag.length,
          ),
        },
      }
    }

    return { descriptor: { scriptSetup, template } }
  },
}))

vi.mock('@vue/compiler-dom', async (importOriginal) => {
  return importOriginal<typeof import('@vue/compiler-dom')>()
})

vi.mock('../../mutators/vue-template.js', async (importOriginal) => {
  return importOriginal<typeof import('../../mutators/vue-template.js')>()
})

const wrapInSfc = (template: string) =>
  `<template>${template}</template>\n<script setup>\nconst x = 1\n</script>`

describe('mutateVueSfcScriptSetup', () => {
  it('returns empty array when there is no script setup block', async () => {
    const code = '<template><div>hello</div></template>'
    const result = await mutateVueSfcScriptSetup('test.vue', code)
    expect(result).toEqual([])
  })

  it('throws when max is 0', async () => {
    await expect(
      mutateVueSfcScriptSetup('test.vue', '<script setup></script>', [], [], 0),
    ).rejects.toThrow('max must be a positive number, got: 0')
  })

  it('throws when max is negative', async () => {
    await expect(
      mutateVueSfcScriptSetup(
        'test.vue',
        '<script setup></script>',
        [],
        [],
        -1,
      ),
    ).rejects.toThrow('max must be a positive number, got: -1')
  })

  it('generates mutations for script setup content', async () => {
    const code = '<script setup>\nconst x = a && b\n</script>'
    const result = await mutateVueSfcScriptSetup('test.vue', code)
    // Should find at least the andToOr mutation
    expect(result.length).toBeGreaterThan(0)
    // Every result should have the full SFC code (containing template tags)
    for (const v of result) {
      expect(v.code).toContain('<script setup>')
      expect(v.code).toContain('</script>')
    }
  })

  it('deduplicates identical mutations', async () => {
    const code = '<script setup>\nconst x = a && b\n</script>'
    const result = await mutateVueSfcScriptSetup('test.vue', code)
    const outputs = result.map((v) => v.code)
    const unique = new Set(outputs)
    expect(outputs.length).toBe(unique.size)
  })

  it('respects max limit', async () => {
    const code = '<script setup>\nconst x = a && b\nconst y = c || d\n</script>'
    const result = await mutateVueSfcScriptSetup(
      'test.vue',
      code,
      undefined,
      undefined,
      1,
    )
    expect(result.length).toBeLessThanOrEqual(1)
  })

  it('filters mutators with include', async () => {
    const code = '<script setup>\nconst x = a && b\n</script>'
    const result = await mutateVueSfcScriptSetup('test.vue', code, ['andToOr'])
    for (const v of result) {
      expect(v.name).toBe('andToOr')
    }
  })

  it('uses apply() fallback when mutator has no applyWithContext', async () => {
    const { getFilteredRegistry } = await import('../variant-utils.js')
    const applyFn = vi.fn(() => [{ code: 'FALLBACK', line: 1, col: 0 }])
    vi.mocked(getFilteredRegistry).mockReturnValueOnce([
      { name: 'noCtx', description: 'noCtx', apply: applyFn },
    ] as unknown as ReturnType<typeof getFilteredRegistry>)

    const code = '<script setup>\nconst x = 1\n</script>'
    const result = await mutateVueSfcScriptSetup('test.vue', code)
    expect(applyFn).toHaveBeenCalled()
    expect(result.length).toBe(1)
  })

  it('deduplicates when two mutators produce the same full SFC output', async () => {
    const { getFilteredRegistry } = await import('../variant-utils.js')
    vi.mocked(getFilteredRegistry).mockReturnValueOnce([
      {
        name: 'A',
        description: 'A',
        apply: () => [{ code: 'SAME_OUTPUT', line: 1, col: 0 }],
      },
      {
        name: 'B',
        description: 'B',
        apply: () => [{ code: 'SAME_OUTPUT', line: 1, col: 0 }],
      },
    ] as unknown as ReturnType<typeof getFilteredRegistry>)

    const code = '<script setup>\nconst x = 1\n</script>'
    const result = await mutateVueSfcScriptSetup('test.vue', code)
    // Both mutators produce the same output; only one variant should exist
    expect(result.length).toBe(1)
  })

  it('filters mutators with exclude', async () => {
    const code = '<script setup>\nconst x = a && b\n</script>'
    const result = await mutateVueSfcScriptSetup('test.vue', code, undefined, [
      'andToOr',
    ])
    for (const v of result) {
      expect(v.name).not.toBe('andToOr')
    }
  })
})

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
    const vueTemplate = await import('../../mutators/vue-template.js')
    const spy = vi.spyOn(vueTemplate, 'collectTemplateDirectiveMutations')
    const duplicate = { line: 1, col: 1, code: '<div v-if="!(x)"></div>' }
    spy.mockResolvedValue([duplicate, duplicate])

    const code = wrapInSfc('<div v-if="x"></div>')
    const results = await mutateVueSfcTemplate('test.vue', code, ['vIfNegate'])

    expect(results).toHaveLength(1)
    spy.mockRestore()
  })
})
