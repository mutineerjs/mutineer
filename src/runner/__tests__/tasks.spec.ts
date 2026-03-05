import { describe, it, expect } from 'vitest'
import { prepareTasks } from '../tasks.js'
import { hash, keyForTests } from '../cache.js'
import type { Variant } from '../../types/mutant.js'
import type { PerTestCoverageMap } from '../../utils/coverage.js'

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'file.ts#0',
    name: 'flipStrictEQ',
    file: '/src/file.ts',
    code: 'const x = a !== b',
    line: 1,
    col: 10,
    tests: ['/tests/file.test.ts'],
    ...overrides,
  }
}

describe('prepareTasks', () => {
  it('creates tasks with sorted tests and computed cache keys', () => {
    const v = makeVariant({
      tests: ['/tests/b.test.ts', '/tests/a.test.ts'],
    })
    const tasks = prepareTasks([v], null)

    expect(tasks).toHaveLength(1)
    expect(tasks[0].tests).toEqual(['/tests/a.test.ts', '/tests/b.test.ts'])
    expect(tasks[0].v).toBe(v)

    // Key should be testSig:codeSig
    const expectedTestSig = hash(
      keyForTests(['/tests/a.test.ts', '/tests/b.test.ts']),
    )
    const expectedCodeSig = hash(v.code)
    expect(tasks[0].key).toBe(`${expectedTestSig}:${expectedCodeSig}`)
  })

  it('produces deterministic keys regardless of test order', () => {
    const v1 = makeVariant({
      tests: ['/tests/b.test.ts', '/tests/a.test.ts'],
    })
    const v2 = makeVariant({
      tests: ['/tests/a.test.ts', '/tests/b.test.ts'],
    })
    const tasks1 = prepareTasks([v1], null)
    const tasks2 = prepareTasks([v2], null)
    expect(tasks1[0].key).toBe(tasks2[0].key)
  })

  it('produces different keys for different code', () => {
    const v1 = makeVariant({ code: 'const x = a !== b' })
    const v2 = makeVariant({ code: 'const x = a === b' })
    const tasks = prepareTasks([v1, v2], null)
    expect(tasks[0].key).not.toBe(tasks[1].key)
  })

  it('produces different keys for different test sets', () => {
    const v1 = makeVariant({ tests: ['/tests/a.test.ts'] })
    const v2 = makeVariant({ tests: ['/tests/b.test.ts'] })
    const tasks = prepareTasks([v1, v2], null)
    expect(tasks[0].key).not.toBe(tasks[1].key)
  })

  it('handles variants with no tests', () => {
    const v = makeVariant({ tests: [] })
    const tasks = prepareTasks([v], null)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].tests).toEqual([])
  })

  it('prunes tests via per-test coverage', () => {
    const v = makeVariant({
      file: '/src/file.ts',
      line: 5,
      tests: ['/tests/a.test.ts', '/tests/b.test.ts'],
    })

    // Only test-a covers line 5 of /src/file.ts
    const perTestCoverage: PerTestCoverageMap = new Map()
    const aCoverage = new Map<string, Set<number>>()
    aCoverage.set('/src/file.ts', new Set([5, 6, 7]))
    perTestCoverage.set('/tests/a.test.ts', aCoverage)

    const bCoverage = new Map<string, Set<number>>()
    bCoverage.set('/src/file.ts', new Set([10, 11]))
    perTestCoverage.set('/tests/b.test.ts', bCoverage)

    const tasks = prepareTasks([v], perTestCoverage)
    expect(tasks[0].tests).toEqual(['/tests/a.test.ts'])
  })

  it('does not prune when perTestCoverage is null', () => {
    const v = makeVariant({
      tests: ['/tests/a.test.ts', '/tests/b.test.ts'],
    })
    const tasks = prepareTasks([v], null)
    expect(tasks[0].tests).toHaveLength(2)
  })

  it('handles multiple variants', () => {
    const variants = [
      makeVariant({ id: 'file.ts#0', code: 'code1' }),
      makeVariant({ id: 'file.ts#1', code: 'code2' }),
      makeVariant({ id: 'file.ts#2', code: 'code3' }),
    ]
    const tasks = prepareTasks(variants, null)
    expect(tasks).toHaveLength(3)
    expect(tasks[0].v.id).toBe('file.ts#0')
    expect(tasks[1].v.id).toBe('file.ts#1')
    expect(tasks[2].v.id).toBe('file.ts#2')
  })
})
