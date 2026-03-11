import { describe, it, expect } from 'vitest'
import {
  collectOperatorTargets,
  collectOperatorTargetsFromContext,
  collectAllTargets,
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
  it('returns an object with ast, tokens, ignoreLines, and preCollected', () => {
    const ctx = buildParseContext(`const x = a && b`)
    expect(ctx.ast.type).toBe('File')
    expect(Array.isArray(ctx.tokens)).toBe(true)
    expect(ctx.ignoreLines).toBeInstanceOf(Set)
    expect(ctx.preCollected).toBeDefined()
    expect(ctx.preCollected.operatorTargets).toBeInstanceOf(Map)
    expect(Array.isArray(ctx.preCollected.returnStatements)).toBe(true)
  })

  it('populates ignoreLines from disable comments', () => {
    const src = `// mutineer-disable-next-line\nconst x = a && b`
    const ctx = buildParseContext(src)
    expect(ctx.ignoreLines.has(2)).toBe(true)
  })

  it('preCollected.operatorTargets groups targets by operator', () => {
    const src = `const x = a && b || c && d`
    const ctx = buildParseContext(src)
    expect(ctx.preCollected.operatorTargets.get('&&')).toHaveLength(2)
    expect(ctx.preCollected.operatorTargets.get('||')).toHaveLength(1)
  })

  it('preCollected.returnStatements captures return arguments', () => {
    const src = `function f() { return x }\nfunction g() { return y }`
    const ctx = buildParseContext(src)
    expect(ctx.preCollected.returnStatements).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// collectAllTargets
// ---------------------------------------------------------------------------

describe('collectAllTargets', () => {
  it('collects operator targets grouped by operator', () => {
    const src = `const x = a && b || c`
    const ctx = buildParseContext(src)
    const result = collectAllTargets(src, ctx.ast, ctx.tokens, ctx.ignoreLines)
    expect(result.operatorTargets.get('&&')).toHaveLength(1)
    expect(result.operatorTargets.get('||')).toHaveLength(1)
  })

  it('collects return statement info', () => {
    const src = `function f() { return 42 }`
    const ctx = buildParseContext(src)
    const result = collectAllTargets(src, ctx.ast, ctx.tokens, ctx.ignoreLines)
    expect(result.returnStatements).toHaveLength(1)
    const info = result.returnStatements[0]
    expect(info.line).toBe(1)
    expect(typeof info.col).toBe('number')
    expect(typeof info.argStart).toBe('number')
    expect(typeof info.argEnd).toBe('number')
    expect(info.argNode).toBeDefined()
  })

  it('skips operators on ignored lines', () => {
    const src = `// mutineer-disable-next-line\nconst x = a && b`
    const ctx = buildParseContext(src)
    const result = collectAllTargets(src, ctx.ast, ctx.tokens, ctx.ignoreLines)
    expect(result.operatorTargets.get('&&') ?? []).toHaveLength(0)
  })

  it('skips return statements on ignored lines', () => {
    const src = `function f() {\n  // mutineer-disable-next-line\n  return x\n}`
    const ctx = buildParseContext(src)
    const result = collectAllTargets(src, ctx.ast, ctx.tokens, ctx.ignoreLines)
    expect(result.returnStatements).toHaveLength(0)
  })

  it('skips bare return with no argument', () => {
    const src = `function f() { return }`
    const ctx = buildParseContext(src)
    const result = collectAllTargets(src, ctx.ast, ctx.tokens, ctx.ignoreLines)
    expect(result.returnStatements).toHaveLength(0)
  })

  it('matches collectOperatorTargetsFromContext for &&', () => {
    const src = `const x = a && b && c`
    const ctx = buildParseContext(src)
    const result = collectAllTargets(src, ctx.ast, ctx.tokens, ctx.ignoreLines)
    const fromCtx = collectOperatorTargetsFromContext(src, ctx, '&&')
    expect(result.operatorTargets.get('&&')).toEqual(fromCtx)
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
