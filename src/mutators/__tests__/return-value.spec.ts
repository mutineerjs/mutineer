import { describe, it, expect } from 'vitest'
import {
  returnToNull,
  returnToUndefined,
  returnFlipBool,
  returnZero,
  returnEmptyStr,
  returnEmptyArr,
} from '../return-value.js'
import { buildParseContext } from '../utils.js'

// ---------------------------------------------------------------------------
// returnToNull
// ---------------------------------------------------------------------------

describe('returnToNull', () => {
  it('replaces an identifier return with null', () => {
    const src = `function f() { return x }`
    const [mutation] = returnToNull.apply(src)
    expect(mutation.code).toBe(`function f() { return null }`)
  })

  it('replaces a function call return with null', () => {
    const src = `function f() { return getValue() }`
    const [mutation] = returnToNull.apply(src)
    expect(mutation.code).toBe(`function f() { return null }`)
  })

  it('replaces a numeric literal return with null', () => {
    const src = `function f() { return 42 }`
    const [mutation] = returnToNull.apply(src)
    expect(mutation.code).toBe(`function f() { return null }`)
  })

  it('replaces an object expression return with null', () => {
    const src = `function f() { return { a: 1 } }`
    const [mutation] = returnToNull.apply(src)
    expect(mutation.code).toBe(`function f() { return null }`)
  })

  it('does not mutate bare return;', () => {
    const src = `function f() { return }`
    const results = returnToNull.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate return null', () => {
    const src = `function f() { return null }`
    const results = returnToNull.apply(src)
    expect(results).toHaveLength(0)
  })

  it('produces one mutation per matching return statement', () => {
    const src = `
function f() {
  if (x) return a
  return b
}
`
    const results = returnToNull.apply(src)
    expect(results).toHaveLength(2)
    expect(results[0].code).toContain('return null')
    expect(results[1].code).toContain('return null')
  })

  it('reports the correct line for the return statement', () => {
    const src = `function f() {\n  return x\n}`
    const [mutation] = returnToNull.apply(src)
    expect(mutation.line).toBe(2)
  })

  it('respects mutineer-disable-next-line', () => {
    const src = `
function f() {
  // mutineer-disable-next-line
  return x
  return y
}
`
    const results = returnToNull.apply(src)
    expect(results).toHaveLength(1)
    expect(results[0].code).toContain('return null')
  })

  it('respects mutineer-disable-line', () => {
    const src = `
function f() {
  return x // mutineer-disable-line
  return y
}
`
    const results = returnToNull.apply(src)
    expect(results).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// returnToUndefined
// ---------------------------------------------------------------------------

describe('returnToUndefined', () => {
  it('replaces an identifier return with undefined', () => {
    const src = `function f() { return x }`
    const [mutation] = returnToUndefined.apply(src)
    expect(mutation.code).toBe(`function f() { return undefined }`)
  })

  it('replaces a function call return with undefined', () => {
    const src = `function f() { return getValue() }`
    const [mutation] = returnToUndefined.apply(src)
    expect(mutation.code).toBe(`function f() { return undefined }`)
  })

  it('replaces null with undefined', () => {
    const src = `function f() { return null }`
    const [mutation] = returnToUndefined.apply(src)
    expect(mutation.code).toBe(`function f() { return undefined }`)
  })

  it('does not mutate bare return;', () => {
    const src = `function f() { return }`
    const results = returnToUndefined.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate return undefined', () => {
    const src = `function f() { return undefined }`
    const results = returnToUndefined.apply(src)
    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// returnFlipBool
// ---------------------------------------------------------------------------

describe('returnFlipBool', () => {
  it('flips return true to return false', () => {
    const src = `function f() { return true }`
    const [mutation] = returnFlipBool.apply(src)
    expect(mutation.code).toBe(`function f() { return false }`)
  })

  it('flips return false to return true', () => {
    const src = `function f() { return false }`
    const [mutation] = returnFlipBool.apply(src)
    expect(mutation.code).toBe(`function f() { return true }`)
  })

  it('does not mutate non-boolean returns', () => {
    const src = `function f() { return x }`
    const results = returnFlipBool.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate bare return;', () => {
    const src = `function f() { return }`
    const results = returnFlipBool.apply(src)
    expect(results).toHaveLength(0)
  })

  it('handles multiple boolean returns independently', () => {
    const src = `
function f(x) {
  if (x) return true
  return false
}
`
    const results = returnFlipBool.apply(src)
    expect(results).toHaveLength(2)
    expect(results[0].code).toContain('return false')
    expect(results[1].code).toContain('return true')
  })
})

// ---------------------------------------------------------------------------
// returnZero
// ---------------------------------------------------------------------------

describe('returnZero', () => {
  it('replaces a positive integer return with 0', () => {
    const src = `function f() { return 42 }`
    const [mutation] = returnZero.apply(src)
    expect(mutation.code).toBe(`function f() { return 0 }`)
  })

  it('replaces a negative number return with 0', () => {
    const src = `function f() { return -1 }`
    // -1 is a UnaryExpression, not a NumericLiteral — should produce no output
    const results = returnZero.apply(src)
    expect(results).toHaveLength(0)
  })

  it('replaces a float return with 0', () => {
    const src = `function f() { return 3.14 }`
    const [mutation] = returnZero.apply(src)
    expect(mutation.code).toBe(`function f() { return 0 }`)
  })

  it('does not mutate return 0', () => {
    const src = `function f() { return 0 }`
    const results = returnZero.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate non-numeric returns', () => {
    const src = `function f() { return x }`
    const results = returnZero.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate bare return;', () => {
    const src = `function f() { return }`
    const results = returnZero.apply(src)
    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// returnEmptyStr
// ---------------------------------------------------------------------------

describe('returnEmptyStr', () => {
  it("replaces a non-empty string return with ''", () => {
    const src = `function f() { return 'hello' }`
    const [mutation] = returnEmptyStr.apply(src)
    expect(mutation.code).toBe(`function f() { return '' }`)
  })

  it('replaces a double-quoted string return', () => {
    const src = `function f() { return "world" }`
    const [mutation] = returnEmptyStr.apply(src)
    expect(mutation.code).toBe(`function f() { return '' }`)
  })

  it("does not mutate return ''", () => {
    const src = `function f() { return '' }`
    const results = returnEmptyStr.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate non-string returns', () => {
    const src = `function f() { return x }`
    const results = returnEmptyStr.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate bare return;', () => {
    const src = `function f() { return }`
    const results = returnEmptyStr.apply(src)
    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// returnEmptyArr
// ---------------------------------------------------------------------------

describe('returnEmptyArr', () => {
  it('replaces a non-empty array return with []', () => {
    const src = `function f() { return [1, 2, 3] }`
    const [mutation] = returnEmptyArr.apply(src)
    expect(mutation.code).toBe(`function f() { return [] }`)
  })

  it('replaces a single-element array return with []', () => {
    const src = `function f() { return [x] }`
    const [mutation] = returnEmptyArr.apply(src)
    expect(mutation.code).toBe(`function f() { return [] }`)
  })

  it('does not mutate return []', () => {
    const src = `function f() { return [] }`
    const results = returnEmptyArr.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate non-array returns', () => {
    const src = `function f() { return x }`
    const results = returnEmptyArr.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate bare return;', () => {
    const src = `function f() { return }`
    const results = returnEmptyArr.apply(src)
    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// applyWithContext (shared behaviour)
// ---------------------------------------------------------------------------

describe('return-value mutator applyWithContext', () => {
  it('produces same results as apply', () => {
    const src = `function f() { return x }`
    const ctx = buildParseContext(src)
    expect(returnToNull.applyWithContext!(src, ctx)).toEqual(
      returnToNull.apply(src),
    )
  })

  it('respects disable comments via pre-built context', () => {
    const src = `function f() {\n  // mutineer-disable-next-line\n  return x\n}`
    const ctx = buildParseContext(src)
    expect(returnToNull.applyWithContext!(src, ctx)).toHaveLength(0)
  })
})
