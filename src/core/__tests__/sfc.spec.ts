import { describe, it, expect, vi } from 'vitest'
import { mutateVueSfcScriptSetup } from '../sfc.js'

// Mock @vue/compiler-sfc
vi.mock('@vue/compiler-sfc', () => ({
  parse: (code: string, _opts?: { filename?: string }) => {
    // Simple mock that extracts content between <script setup> tags
    const startTag = '<script setup>'
    const endTag = '</script>'
    const startIdx = code.indexOf(startTag)
    if (startIdx === -1) {
      return { descriptor: { scriptSetup: null } }
    }
    const contentStart = startIdx + startTag.length
    const contentEnd = code.indexOf(endTag, contentStart)
    return {
      descriptor: {
        scriptSetup: {
          loc: {
            start: { offset: contentStart },
            end: { offset: contentEnd },
          },
        },
      },
    }
  },
}))

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

  it('filters mutators with exclude', async () => {
    const code = '<script setup>\nconst x = a && b\n</script>'
    const result = await mutateVueSfcScriptSetup(
      'test.vue',
      code,
      undefined,
      ['andToOr'],
    )
    for (const v of result) {
      expect(v.name).not.toBe('andToOr')
    }
  })
})
