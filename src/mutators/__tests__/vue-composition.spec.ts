import { describe, it, expect } from 'vitest'
import { refToShallowRef, computedToRef } from '../vue-composition.js'
import { buildParseContext } from '../utils.js'

// ---------------------------------------------------------------------------
// refToShallowRef
// ---------------------------------------------------------------------------

describe('refToShallowRef', () => {
  it('replaces ref callee with shallowRef', () => {
    const src = `const x = ref(0)`
    const [mutation] = refToShallowRef.apply(src)
    expect(mutation.code).toBe(`const x = shallowRef(0)`)
  })

  it('produces one mutation per ref call', () => {
    const src = `const a = ref(0)\nconst b = ref('')`
    const results = refToShallowRef.apply(src)
    expect(results).toHaveLength(2)
  })

  it('does not mutate non-ref calls', () => {
    const src = `const x = computed(() => 1)`
    const results = refToShallowRef.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate ref used as a property (member expression)', () => {
    const src = `const x = vue.ref(0)`
    const results = refToShallowRef.apply(src)
    expect(results).toHaveLength(0)
  })

  it('reports correct 1-based line number', () => {
    const src = `const x = 1\nconst y = ref(0)`
    const [mutation] = refToShallowRef.apply(src)
    expect(mutation.line).toBe(2)
  })

  it('reports correct visual column', () => {
    const src = `const y = ref(0)`
    //                      ^ col 11
    const [mutation] = refToShallowRef.apply(src)
    expect(mutation.col).toBe(11)
  })

  it('respects mutineer-disable-line inline comment', () => {
    const src = `const x = ref(0) // mutineer-disable-line`
    const results = refToShallowRef.apply(src)
    expect(results).toHaveLength(0)
  })

  it('respects mutineer-disable-next-line comment', () => {
    const src = `// mutineer-disable-next-line\nconst x = ref(0)`
    const results = refToShallowRef.apply(src)
    expect(results).toHaveLength(0)
  })

  it('applyWithContext produces same results as apply', () => {
    const src = `const x = ref(0)\nconst y = ref(1)`
    const ctx = buildParseContext(src)
    const direct = refToShallowRef.apply(src)
    const withCtx = refToShallowRef.applyWithContext!(src, ctx)
    expect(withCtx).toEqual(direct)
  })
})

// ---------------------------------------------------------------------------
// computedToRef
// ---------------------------------------------------------------------------

describe('computedToRef', () => {
  it('replaces computed callee with ref', () => {
    const src = `const x = computed(() => count.value * 2)`
    const [mutation] = computedToRef.apply(src)
    expect(mutation.code).toBe(`const x = ref(() => count.value * 2)`)
  })

  it('produces one mutation per computed call', () => {
    const src = `const a = computed(() => 1)\nconst b = computed(() => 2)`
    const results = computedToRef.apply(src)
    expect(results).toHaveLength(2)
  })

  it('does not mutate non-computed calls', () => {
    const src = `const x = ref(0)`
    const results = computedToRef.apply(src)
    expect(results).toHaveLength(0)
  })

  it('does not mutate computed used as a member expression callee', () => {
    const src = `const x = vue.computed(() => 1)`
    const results = computedToRef.apply(src)
    expect(results).toHaveLength(0)
  })

  it('respects mutineer-disable-line inline comment', () => {
    const src = `const x = computed(() => 1) // mutineer-disable-line`
    const results = computedToRef.apply(src)
    expect(results).toHaveLength(0)
  })

  it('applyWithContext produces same results as apply', () => {
    const src = `const x = computed(() => 1)`
    const ctx = buildParseContext(src)
    const direct = computedToRef.apply(src)
    const withCtx = computedToRef.applyWithContext!(src, ctx)
    expect(withCtx).toEqual(direct)
  })
})
