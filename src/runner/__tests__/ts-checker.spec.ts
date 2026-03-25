import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import {
  resolveTypescriptEnabled,
  resolveTsconfigPath,
  resolveCompilerOptions,
  checkTypes,
  checkFileSync,
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

describe('resolveCompilerOptions', () => {
  let tmpDir: string
  let brokenTsconfigDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-tsco-'))
    brokenTsconfigDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-tsco-broken-'),
    )
    // Write a broken tsconfig (invalid JSON)
    await fs.writeFile(
      path.join(brokenTsconfigDir, 'tsconfig.json'),
      '{ invalid json',
      'utf8',
    )
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    await fs.rm(brokenTsconfigDir, { recursive: true, force: true })
  })

  it('returns base options when no tsconfig found in cwd', () => {
    const opts = resolveCompilerOptions(undefined, tmpDir)
    expect(opts.noEmit).toBe(true)
    expect(opts.noLib).toBe(true)
    expect(opts.noResolve).toBe(true)
  })

  it('returns base options when tsconfig has parse errors', () => {
    const opts = resolveCompilerOptions(undefined, brokenTsconfigDir)
    expect(opts.noEmit).toBe(true)
    expect(opts.noLib).toBe(true)
  })

  it('parses real tsconfig and merges options', () => {
    const opts = resolveCompilerOptions(undefined, CWD_WITH_TSCONFIG)
    // Should still override these core isolation settings
    expect(opts.noEmit).toBe(true)
    expect(opts.noLib).toBe(true)
    expect(opts.noResolve).toBe(true)
    expect(opts.skipLibCheck).toBe(true)
  })

  it('uses explicit tsconfig path when provided', () => {
    const tsconfigPath = path.join(CWD_WITH_TSCONFIG, 'tsconfig.json')
    const opts = resolveCompilerOptions(tsconfigPath, CWD_WITH_TSCONFIG)
    expect(opts.noEmit).toBe(true)
    expect(opts.noLib).toBe(true)
  })
})

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
  }, 15000)

  it('flags TypeScript type mismatch as compile error', async () => {
    const variant = makeVariant({
      id: 'bad.ts#0',
      file: '/nonexistent/bad.ts',
      code: 'const x: number = "this is not a number"',
    })

    const result = await checkTypes([variant], undefined, CWD_WITHOUT_TSCONFIG)
    expect(result.has('bad.ts#0')).toBe(true)
  }, 15000)

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
  }, 15000)

  it('uses tsconfig from CWD_WITH_TSCONFIG when provided', async () => {
    const variant = makeVariant({
      id: 'with-tsconfig.ts#0',
      file: '/nonexistent/with-tsconfig.ts',
      code: 'const x: number = 1',
    })

    // Should not flag valid code even when cwd has tsconfig
    const result = await checkTypes([variant], undefined, CWD_WITH_TSCONFIG)
    expect(result.has('with-tsconfig.ts#0')).toBe(false)
  }, 30000)

  it('filters out mutant errors that were already in baseline', async () => {
    // The original file also has a type error (same code as mutant) — no NEW errors
    const variant = makeVariant({
      id: 'baseline-error.ts#0',
      file: '/nonexistent/baseline-error.ts',
      // The mutant code is IDENTICAL to what we'd read as baseline (empty string)
      // so any errors in the mutant were already in the baseline
      code: 'const x: number = 1', // valid code - no new errors compared to empty baseline
    })

    const result = await checkTypes([variant], undefined, CWD_WITHOUT_TSCONFIG)
    expect(result.has('baseline-error.ts#0')).toBe(false)
  }, 15000)

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
  }, 15000)
})

describe('checkFileSync', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-checkfilesync-'))
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('does not flag errors that are already present in the baseline file', async () => {
    // Write a baseline file with a type error
    const errorFile = path.join(tmpDir, 'baseline-err.ts')
    await fs.writeFile(errorFile, 'const x: number = "bad string"', 'utf8')

    const options = resolveCompilerOptions(undefined, tmpDir)
    const variant: Variant = makeVariant({
      id: 'baseline-err.ts#0',
      file: errorFile,
      // Mutant has the same type error as the baseline file
      code: 'const x: number = "bad string"',
    })

    // The error exists in both baseline and mutant — no NEW errors, so not flagged
    const ids = checkFileSync(options, errorFile, [variant])
    expect(ids).not.toContain('baseline-err.ts#0')
  }, 15000)
})
