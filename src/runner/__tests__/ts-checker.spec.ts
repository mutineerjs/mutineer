import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  resolveTypescriptEnabled,
  resolveTsconfigPath,
  checkTypes,
} from '../ts-checker.js'
import type { Variant } from '../../types/mutant.js'

// Directory with a real tsconfig.json (the project root, 3 levels up from __tests__)
const CWD_WITH_TSCONFIG = path.resolve(import.meta.dirname, '../../../')
// A temp-like directory unlikely to have tsconfig.json
const CWD_WITHOUT_TSCONFIG = '/tmp'

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'foo.ts#0',
    name: 'flipEQ',
    file: '/nonexistent/foo.ts',
    code: 'const x: number = 1',
    line: 1,
    col: 0,
    tests: [],
    ...overrides,
  }
}

describe('resolveTsconfigPath', () => {
  it('returns undefined for boolean true', () => {
    expect(resolveTsconfigPath({ typescript: true })).toBeUndefined()
  })

  it('returns undefined for boolean false', () => {
    expect(resolveTsconfigPath({ typescript: false })).toBeUndefined()
  })

  it('returns tsconfig path from object config', () => {
    expect(
      resolveTsconfigPath({ typescript: { tsconfig: './tsconfig.app.json' } }),
    ).toBe('./tsconfig.app.json')
  })

  it('returns undefined when object config has no tsconfig property', () => {
    expect(resolveTsconfigPath({ typescript: {} })).toBeUndefined()
  })

  it('returns undefined when no typescript config key', () => {
    expect(resolveTsconfigPath({})).toBeUndefined()
  })
})

describe('resolveTypescriptEnabled', () => {
  it('CLI false overrides everything', () => {
    expect(
      resolveTypescriptEnabled(false, { typescript: true }, CWD_WITH_TSCONFIG),
    ).toBe(false)
  })

  it('CLI true overrides everything', () => {
    expect(
      resolveTypescriptEnabled(true, { typescript: false }, CWD_WITH_TSCONFIG),
    ).toBe(true)
  })

  it('config false disables checking', () => {
    expect(
      resolveTypescriptEnabled(
        undefined,
        { typescript: false },
        CWD_WITH_TSCONFIG,
      ),
    ).toBe(false)
  })

  it('config true enables checking', () => {
    expect(
      resolveTypescriptEnabled(
        undefined,
        { typescript: true },
        CWD_WITHOUT_TSCONFIG,
      ),
    ).toBe(true)
  })

  it('config object enables checking', () => {
    expect(
      resolveTypescriptEnabled(
        undefined,
        { typescript: { tsconfig: './tsconfig.json' } },
        CWD_WITHOUT_TSCONFIG,
      ),
    ).toBe(true)
  })

  it('auto-detects: enabled when tsconfig.json is present in cwd', () => {
    // The project root has a tsconfig.json
    expect(resolveTypescriptEnabled(undefined, {}, CWD_WITH_TSCONFIG)).toBe(
      true,
    )
  })

  it('auto-detects: disabled when no tsconfig.json in cwd', () => {
    // /tmp should not have a tsconfig.json
    expect(resolveTypescriptEnabled(undefined, {}, CWD_WITHOUT_TSCONFIG)).toBe(
      false,
    )
  })
})

describe('checkTypes', () => {
  it('returns empty set for empty variants array', async () => {
    const result = await checkTypes([], undefined, CWD_WITHOUT_TSCONFIG)
    expect(result.size).toBe(0)
  })

  it('does not flag valid TypeScript code', async () => {
    const variant = makeVariant({
      id: 'valid.ts#0',
      file: '/nonexistent/valid.ts',
      code: 'const x: number = 42; export default x',
    })

    const result = await checkTypes([variant], undefined, CWD_WITHOUT_TSCONFIG)
    expect(result.has('valid.ts#0')).toBe(false)
  })

  it('flags TypeScript type mismatch as compile error', async () => {
    const variant = makeVariant({
      id: 'bad.ts#0',
      file: '/nonexistent/bad.ts',
      code: 'const x: number = "this is not a number"',
    })

    const result = await checkTypes([variant], undefined, CWD_WITHOUT_TSCONFIG)
    expect(result.has('bad.ts#0')).toBe(true)
  })

  it('checks multiple variants for same file independently', async () => {
    const valid = makeVariant({
      id: 'multi.ts#0',
      file: '/nonexistent/multi.ts',
      code: 'const x: number = 1',
    })
    const invalid = makeVariant({
      id: 'multi.ts#1',
      file: '/nonexistent/multi.ts',
      code: 'const x: number = "bad"',
    })

    const result = await checkTypes(
      [valid, invalid],
      undefined,
      CWD_WITHOUT_TSCONFIG,
    )
    expect(result.has('multi.ts#0')).toBe(false)
    expect(result.has('multi.ts#1')).toBe(true)
  })

  it('checks variants from different files independently', async () => {
    const validA = makeVariant({
      id: 'a.ts#0',
      file: '/nonexistent/a.ts',
      code: 'const x: number = 1',
    })
    const invalidB = makeVariant({
      id: 'b.ts#0',
      file: '/nonexistent/b.ts',
      code: 'const y: string = 999',
    })

    const result = await checkTypes(
      [validA, invalidB],
      undefined,
      CWD_WITHOUT_TSCONFIG,
    )
    expect(result.has('a.ts#0')).toBe(false)
    expect(result.has('b.ts#0')).toBe(true)
  })
})
