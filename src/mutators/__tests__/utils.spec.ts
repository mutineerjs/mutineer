import { describe, it, expect } from 'vitest'
import {
  collectOperatorTargets,
  collectOperatorTargetsFromContext,
  buildIgnoreLines,
  buildParseContext,
  parseSource,
} from '../utils.js'
import type { Comment } from '@babel/types'

// ---------------------------------------------------------------------------
// buildIgnoreLines
// ---------------------------------------------------------------------------

describe('buildIgnoreLines', () => {
  function comment(
    text: string,
    startLine: number,
    endLine = startLine,
  ): Comment {
    return {
      type: 'CommentLine',
      value: ` ${text}`,
      start: 0,
      end: 0,
      loc: {
        start: { line: startLine, column: 0, index: 0 },
        end: { line: endLine, column: 0, index: 0 },
      },
    } as Comment
  }

  it('ignores the line after mutineer-disable-next-line', () => {
    // The text also contains 'mutineer-disable' as a substring, so the
    // comment line itself is ignored in addition to the following line.
    const lines = buildIgnoreLines([comment('mutineer-disable-next-line', 3)])
    expect(lines.has(4)).toBe(true)
    expect(lines.has(3)).toBe(true)
    expect(lines.has(5)).toBe(false)
  })

  it('ignores the comment line itself for mutineer-disable-line', () => {
    const lines = buildIgnoreLines([comment('mutineer-disable-line', 5)])
    expect(lines.has(5)).toBe(true)
    expect(lines.has(6)).toBe(false)
  })

  it('ignores all lines spanned by a mutineer-disable block comment', () => {
    const lines = buildIgnoreLines([comment('mutineer-disable', 2, 4)])
    expect(lines.has(2)).toBe(true)
    expect(lines.has(3)).toBe(true)
    expect(lines.has(4)).toBe(true)
    expect(lines.has(1)).toBe(false)
    expect(lines.has(5)).toBe(false)
  })

  it('ignores comments without loc', () => {
    const c = {
      ...comment('mutineer-disable-next-line', 1),
      loc: undefined,
    } as unknown as Comment
    expect(() => buildIgnoreLines([c])).not.toThrow()
  })

  it('returns an empty set when there are no disable comments', () => {
    const lines = buildIgnoreLines([comment('just a normal comment', 1)])
    expect(lines.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// parseSource
// ---------------------------------------------------------------------------

describe('parseSource', () => {
  it('parses valid TypeScript source without throwing', () => {
    expect(() => parseSource(`const x: number = 1`)).not.toThrow()
  })

  it('parses JSX without throwing', () => {
    expect(() => parseSource(`const el = <div />`)).not.toThrow()
  })

  it('returns a File node', () => {
    const ast = parseSource(`const x = 1`)
    expect(ast.type).toBe('File')
  })
})

// ---------------------------------------------------------------------------
// buildParseContext
// ---------------------------------------------------------------------------

describe('buildParseContext', () => {
  it('returns an object with ast, tokens, and ignoreLines', () => {
    const ctx = buildParseContext(`const x = a && b`)
    expect(ctx.ast.type).toBe('File')
    expect(Array.isArray(ctx.tokens)).toBe(true)
    expect(ctx.ignoreLines).toBeInstanceOf(Set)
  })

  it('populates ignoreLines from disable comments', () => {
    const src = `// mutineer-disable-next-line\nconst x = a && b`
    const ctx = buildParseContext(src)
    expect(ctx.ignoreLines.has(2)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// collectOperatorTargets / collectOperatorTargetsFromContext
// ---------------------------------------------------------------------------

describe('collectOperatorTargets', () => {
  it('honors mutineer disable comments', () => {
    const src = `// mutineer-disable-next-line
const a = b && c
const b = c && d // mutineer-disable-line
const c = d && e /* mutineer-disable */
const d = e && f
`

    const targets = collectOperatorTargets(src, '&&')

    const lines = targets.map((t) => t.line)
    expect(lines).toEqual([5])
  })
})

describe('collectOperatorTargetsFromContext', () => {
  it('returns same results as collectOperatorTargets', () => {
    const src = `const ok = a && b && c`
    const ctx = buildParseContext(src)
    const fromCtx = collectOperatorTargetsFromContext(src, ctx, '&&')
    const fromSrc = collectOperatorTargets(src, '&&')
    expect(fromCtx).toEqual(fromSrc)
  })

  it('honors disable comments via pre-built context', () => {
    const src = `// mutineer-disable-next-line\nconst x = a && b`
    const ctx = buildParseContext(src)
    const targets = collectOperatorTargetsFromContext(src, ctx, '&&')
    expect(targets).toHaveLength(0)
  })
})
