import { describe, it, expect } from 'vitest'
import {
  relaxLE,
  relaxGE,
  tightenLT,
  tightenGT,
  andToOr,
  orToAnd,
  nullishToOr,
  flipEQ,
  flipNEQ,
  flipStrictEQ,
  flipStrictNEQ,
  addToSub,
  subToAdd,
  mulToDiv,
  divToMul,
  modToMul,
  powerToMul,
  preInc,
  preDec,
  postInc,
  postDec,
  addAssignToSub,
  subAssignToAdd,
  mulAssignToDiv,
  divAssignToMul,
} from '../operator.js'
import { buildParseContext } from '../utils.js'

// ---------------------------------------------------------------------------
// Shared behaviour (tested once; all mutators use the same factory)
// ---------------------------------------------------------------------------

describe('operator mutator shared behaviour', () => {
  it('produces one mutation per matching operator occurrence', () => {
    const src = `const ok = a && b && c`
    const results = andToOr.apply(src)
    expect(results).toHaveLength(2)
  })

  it('reports the correct 1-based line number', () => {
    const src = `const x = 1\nconst ok = a && b`
    const [result] = andToOr.apply(src)
    expect(result.line).toBe(2)
  })

  it('reports the correct visual column', () => {
    const src = `const ok = a && b`
    //                        ^ col 14 ('a' is at col 12, ' ' 13, '&' 14)
    const [result] = andToOr.apply(src)
    expect(result.col).toBe(14)
  })

  it('does not mutate operators inside string literals (AST-safe)', () => {
    const src = `const s = 'a && b'`
    const results = andToOr.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate operators inside comments (AST-safe)', () => {
    const src = `// a && b\nconst x = 1`
    const results = andToOr.apply(src)
    expect(results).toHaveLength(0)
  })

  it('returns no results when the operator is absent', () => {
    const src = `const x = a || b`
    const results = andToOr.apply(src)
    expect(results).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// applyWithContext (shared behaviour)
// ---------------------------------------------------------------------------

describe('operator mutator applyWithContext', () => {
  it('produces same results as apply', () => {
    const src = `const ok = a && b && c`
    const ctx = buildParseContext(src)
    expect(andToOr.applyWithContext!(src, ctx)).toEqual(andToOr.apply(src))
  })

  it('respects disable comments via pre-built context', () => {
    const src = `// mutineer-disable-next-line\nconst ok = a && b`
    const ctx = buildParseContext(src)
    expect(andToOr.applyWithContext!(src, ctx)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Boundary mutators
// ---------------------------------------------------------------------------

describe('relaxLE', () => {
  it("replaces '<=' with '<'", () => {
    const src = `if (x <= 10) {}`
    const [result] = relaxLE.apply(src)
    expect(result.code).toBe(`if (x < 10) {}`)
  })
})

describe('relaxGE', () => {
  it("replaces '>=' with '>'", () => {
    const src = `if (x >= 0) {}`
    const [result] = relaxGE.apply(src)
    expect(result.code).toBe(`if (x > 0) {}`)
  })
})

describe('tightenLT', () => {
  it("replaces '<' with '<='", () => {
    const src = `if (x < 10) {}`
    const [result] = tightenLT.apply(src)
    expect(result.code).toBe(`if (x <= 10) {}`)
  })
})

describe('tightenGT', () => {
  it("replaces '>' with '>='", () => {
    const src = `if (x > 0) {}`
    const [result] = tightenGT.apply(src)
    expect(result.code).toBe(`if (x >= 0) {}`)
  })
})

// ---------------------------------------------------------------------------
// Logical mutators
// ---------------------------------------------------------------------------

describe('andToOr', () => {
  it("replaces '&&' with '||'", () => {
    const src = `const ok = a && b`
    const [result] = andToOr.apply(src)
    expect(result.code).toBe(`const ok = a || b`)
  })
})

describe('orToAnd', () => {
  it("replaces '||' with '&&'", () => {
    const src = `const ok = a || b`
    const [result] = orToAnd.apply(src)
    expect(result.code).toBe(`const ok = a && b`)
  })
})

describe('nullishToOr', () => {
  it("replaces '??' with '||'", () => {
    const src = `const v = x ?? defaultValue`
    const [result] = nullishToOr.apply(src)
    expect(result.code).toBe(`const v = x || defaultValue`)
  })
})

// ---------------------------------------------------------------------------
// Equality mutators
// ---------------------------------------------------------------------------

describe('flipEQ', () => {
  it("replaces '==' with '!='", () => {
    const src = `if (a == b) {}`
    const [result] = flipEQ.apply(src)
    expect(result.code).toBe(`if (a != b) {}`)
  })
})

describe('flipNEQ', () => {
  it("replaces '!=' with '=='", () => {
    const src = `if (a != b) {}`
    const [result] = flipNEQ.apply(src)
    expect(result.code).toBe(`if (a == b) {}`)
  })
})

describe('flipStrictEQ', () => {
  it("replaces '===' with '!=='", () => {
    const src = `if (a === b) {}`
    const [result] = flipStrictEQ.apply(src)
    expect(result.code).toBe(`if (a !== b) {}`)
  })
})

describe('flipStrictNEQ', () => {
  it("replaces '!==' with '==='", () => {
    const src = `if (a !== b) {}`
    const [result] = flipStrictNEQ.apply(src)
    expect(result.code).toBe(`if (a === b) {}`)
  })
})

// ---------------------------------------------------------------------------
// Arithmetic mutators
// ---------------------------------------------------------------------------

describe('addToSub', () => {
  it("replaces '+' with '-'", () => {
    const src = `const n = a + b`
    const [result] = addToSub.apply(src)
    expect(result.code).toBe(`const n = a - b`)
  })
})

describe('subToAdd', () => {
  it("replaces '-' with '+'", () => {
    const src = `const n = a - b`
    const [result] = subToAdd.apply(src)
    expect(result.code).toBe(`const n = a + b`)
  })
})

describe('mulToDiv', () => {
  it("replaces '*' with '/'", () => {
    const src = `const n = a * b`
    const [result] = mulToDiv.apply(src)
    expect(result.code).toBe(`const n = a / b`)
  })
})

describe('divToMul', () => {
  it("replaces '/' with '*'", () => {
    const src = `const n = a / b`
    const [result] = divToMul.apply(src)
    expect(result.code).toBe(`const n = a * b`)
  })
})

describe('modToMul', () => {
  it("replaces '%' with '*'", () => {
    const src = `const n = a % b`
    const [result] = modToMul.apply(src)
    expect(result.code).toBe(`const n = a * b`)
  })
})

describe('powerToMul', () => {
  it("replaces '**' with '*'", () => {
    const src = `const n = a ** b`
    const [result] = powerToMul.apply(src)
    expect(result.code).toBe(`const n = a * b`)
  })
})

// ---------------------------------------------------------------------------
// Increment/decrement mutators
// ---------------------------------------------------------------------------

describe('preInc', () => {
  it("replaces '++x' to '--x'", () => {
    const src = `const n = ++i`
    const [result] = preInc.apply(src)
    expect(result.code).toBe(`const n = --i`)
  })

  it('does not match postfix x++', () => {
    const src = `i++`
    expect(preInc.apply(src)).toHaveLength(0)
  })

  it('applyWithContext matches apply', () => {
    const src = `const n = ++i`
    const ctx = buildParseContext(src)
    expect(preInc.applyWithContext!(src, ctx)).toEqual(preInc.apply(src))
  })
})

describe('preDec', () => {
  it("replaces '--x' to '++x'", () => {
    const src = `const n = --i`
    const [result] = preDec.apply(src)
    expect(result.code).toBe(`const n = ++i`)
  })

  it('does not match postfix x--', () => {
    const src = `i--`
    expect(preDec.apply(src)).toHaveLength(0)
  })
})

describe('postInc', () => {
  it("replaces 'x++' to 'x--'", () => {
    const src = `i++`
    const [result] = postInc.apply(src)
    expect(result.code).toBe(`i--`)
  })

  it('does not match prefix ++x', () => {
    const src = `const n = ++i`
    expect(postInc.apply(src)).toHaveLength(0)
  })

  it('applyWithContext matches apply', () => {
    const src = `i++`
    const ctx = buildParseContext(src)
    expect(postInc.applyWithContext!(src, ctx)).toEqual(postInc.apply(src))
  })
})

describe('postDec', () => {
  it("replaces 'x--' to 'x++'", () => {
    const src = `i--`
    const [result] = postDec.apply(src)
    expect(result.code).toBe(`i++`)
  })

  it('does not match prefix --x', () => {
    const src = `const n = --i`
    expect(postDec.apply(src)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Compound assignment mutators
// ---------------------------------------------------------------------------

describe('addAssignToSub', () => {
  it("replaces '+=' with '-='", () => {
    const src = `x += 1`
    const [result] = addAssignToSub.apply(src)
    expect(result.code).toBe(`x -= 1`)
  })

  it('returns no results when operator absent', () => {
    expect(addAssignToSub.apply(`x -= 1`)).toHaveLength(0)
  })

  it('applyWithContext matches apply', () => {
    const src = `x += 1`
    const ctx = buildParseContext(src)
    expect(addAssignToSub.applyWithContext!(src, ctx)).toEqual(
      addAssignToSub.apply(src),
    )
  })
})

describe('subAssignToAdd', () => {
  it("replaces '-=' with '+='", () => {
    const src = `x -= 1`
    const [result] = subAssignToAdd.apply(src)
    expect(result.code).toBe(`x += 1`)
  })
})

describe('mulAssignToDiv', () => {
  it("replaces '*=' with '/='", () => {
    const src = `x *= 2`
    const [result] = mulAssignToDiv.apply(src)
    expect(result.code).toBe(`x /= 2`)
  })
})

describe('divAssignToMul', () => {
  it("replaces '/=' with '*='", () => {
    const src = `x /= 2`
    const [result] = divAssignToMul.apply(src)
    expect(result.code).toBe(`x *= 2`)
  })
})
