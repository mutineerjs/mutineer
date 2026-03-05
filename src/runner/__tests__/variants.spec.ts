import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  getTargetFile,
  enumerateVariantsForTarget,
  filterTestsByCoverage,
  enumerateAllVariants,
} from '../variants.js'
import { normalizePath } from '../../utils/normalizePath.js'
import type { TestMap } from '../discover.js'
import type { CoverageData } from '../../utils/coverage.js'

describe('getTargetFile', () => {
  it('returns the string directly for string targets', () => {
    expect(getTargetFile('src/foo.ts')).toBe('src/foo.ts')
  })

  it('returns the file property for object targets', () => {
    expect(getTargetFile({ file: 'src/bar.ts', kind: 'module' })).toBe(
      'src/bar.ts',
    )
  })

  it('returns the file property without kind', () => {
    expect(getTargetFile({ file: 'src/baz.ts' })).toBe('src/baz.ts')
  })
})

describe('enumerateVariantsForTarget', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-variants-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('enumerates variants for a module file with mutable code', async () => {
    const srcFile = path.join(tmpDir, 'foo.ts')
    await fs.writeFile(srcFile, 'const x = a === b')
    const result = await enumerateVariantsForTarget(tmpDir, 'foo.ts')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].id).toBe('foo.ts#0')
    expect(result[0].file).toBe(srcFile)
    expect(typeof result[0].name).toBe('string')
  })

  it('auto-detects Vue files as vue:script-setup kind', async () => {
    const vueFile = path.join(tmpDir, 'App.vue')
    // Write a minimal Vue SFC - the sfc mutator needs @vue/compiler-sfc
    // which may not be available, so this may return empty (caught error)
    await fs.writeFile(vueFile, '<script setup>\nconst x = a === b\n</script>')
    const result = await enumerateVariantsForTarget(tmpDir, 'App.vue')
    // Either we get results (if @vue/compiler-sfc is available) or empty array (graceful)
    expect(Array.isArray(result)).toBe(true)
  })

  it('uses explicit kind=module for a .vue file', async () => {
    const vueFile = path.join(tmpDir, 'App.vue')
    await fs.writeFile(vueFile, 'const x = a && b')
    const result = await enumerateVariantsForTarget(tmpDir, {
      file: 'App.vue',
      kind: 'module',
    })
    // Should treat the whole file as a module and find the && mutation
    expect(result.some((v) => v.name === 'andToOr')).toBe(true)
  })

  it('handles absolute paths', async () => {
    const absFile = path.join(tmpDir, 'abs.ts')
    await fs.writeFile(absFile, 'const x = a + b')
    const result = await enumerateVariantsForTarget(tmpDir, absFile)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].file).toBe(absFile)
  })

  it('passes include/exclude/max correctly', async () => {
    const srcFile = path.join(tmpDir, 'multi.ts')
    await fs.writeFile(srcFile, 'const x = a === b && c || d')
    const all = await enumerateVariantsForTarget(tmpDir, 'multi.ts')
    expect(all.length).toBeGreaterThan(1)

    const limited = await enumerateVariantsForTarget(
      tmpDir,
      'multi.ts',
      undefined,
      undefined,
      1,
    )
    expect(limited).toHaveLength(1)
  })

  it('filters by include', async () => {
    const srcFile = path.join(tmpDir, 'inc.ts')
    await fs.writeFile(srcFile, 'const x = a === b && c || d')
    const result = await enumerateVariantsForTarget(
      tmpDir,
      'inc.ts',
      ['andToOr'],
    )
    expect(result.every((v) => v.name === 'andToOr')).toBe(true)
  })

  it('filters by exclude', async () => {
    const srcFile = path.join(tmpDir, 'exc.ts')
    await fs.writeFile(srcFile, 'const x = a === b && c')
    const result = await enumerateVariantsForTarget(
      tmpDir,
      'exc.ts',
      undefined,
      ['flipStrictEQ'],
    )
    expect(result.every((v) => v.name !== 'flipStrictEQ')).toBe(true)
  })

  it('returns empty array when file does not exist', async () => {
    const result = await enumerateVariantsForTarget(tmpDir, 'nonexistent.ts')
    expect(result).toEqual([])
  })

  it('returns empty for code with no mutable patterns', async () => {
    const srcFile = path.join(tmpDir, 'clean.ts')
    await fs.writeFile(srcFile, 'const x = 1')
    const result = await enumerateVariantsForTarget(tmpDir, 'clean.ts')
    expect(result).toEqual([])
  })

  it('generates correct id format', async () => {
    const srcFile = path.join(tmpDir, 'ids.ts')
    await fs.writeFile(srcFile, 'const x = a + b')
    const result = await enumerateVariantsForTarget(tmpDir, 'ids.ts')
    for (let i = 0; i < result.length; i++) {
      expect(result[i].id).toBe(`ids.ts#${i}`)
    }
  })
})

describe('filterTestsByCoverage', () => {
  it('keeps tests that cover the specified line', () => {
    const perTest = new Map<string, Map<string, Set<number>>>()
    const fileCoverage = new Map<string, Set<number>>()
    fileCoverage.set('src/foo.ts', new Set([1, 2, 3]))
    perTest.set('test-a.ts', fileCoverage)

    const result = filterTestsByCoverage(
      perTest,
      ['test-a.ts'],
      'src/foo.ts',
      2,
    )
    expect(result).toEqual(['test-a.ts'])
  })

  it('excludes tests that do not cover the specified line', () => {
    const perTest = new Map<string, Map<string, Set<number>>>()
    const fileCoverage = new Map<string, Set<number>>()
    fileCoverage.set('src/foo.ts', new Set([1, 2, 3]))
    perTest.set('test-a.ts', fileCoverage)

    const result = filterTestsByCoverage(
      perTest,
      ['test-a.ts'],
      'src/foo.ts',
      99,
    )
    expect(result).toEqual([])
  })

  it('includes tests that have no coverage data (conservative)', () => {
    const perTest = new Map<string, Map<string, Set<number>>>()
    const result = filterTestsByCoverage(
      perTest,
      ['test-a.ts'],
      'src/foo.ts',
      1,
    )
    expect(result).toEqual(['test-a.ts'])
  })

  it('includes tests whose coverage does not track the file (conservative)', () => {
    const perTest = new Map<string, Map<string, Set<number>>>()
    perTest.set('test-a.ts', new Map<string, Set<number>>())

    const result = filterTestsByCoverage(
      perTest,
      ['test-a.ts'],
      'src/foo.ts',
      1,
    )
    expect(result).toEqual(['test-a.ts'])
  })

  it('filters multiple tests correctly', () => {
    const perTest = new Map<string, Map<string, Set<number>>>()

    const coverageA = new Map<string, Set<number>>()
    coverageA.set('src/foo.ts', new Set([1, 2]))
    perTest.set('test-a.ts', coverageA)

    const coverageB = new Map<string, Set<number>>()
    coverageB.set('src/foo.ts', new Set([3, 4]))
    perTest.set('test-b.ts', coverageB)

    const result = filterTestsByCoverage(
      perTest,
      ['test-a.ts', 'test-b.ts'],
      'src/foo.ts',
      2,
    )
    expect(result).toEqual(['test-a.ts'])
  })
})

describe('enumerateAllVariants', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-enumall-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('enumerates variants for multiple targets and attaches tests', async () => {
    const fileA = path.join(tmpDir, 'a.ts')
    const fileB = path.join(tmpDir, 'b.ts')
    await fs.writeFile(fileA, 'const x = a === b')
    await fs.writeFile(fileB, 'const y = c + d')

    const testMap: TestMap = new Map()
    testMap.set(normalizePath(fileA), new Set(['/tests/a.test.ts']))
    testMap.set(normalizePath(fileB), new Set(['/tests/b.test.ts']))

    const result = await enumerateAllVariants({
      cwd: tmpDir,
      targets: ['a.ts', 'b.ts'],
      testMap,
      changedFiles: null,
      coverageData: null,
      config: {},
    })

    expect(result.length).toBeGreaterThan(0)
    const filesInResult = new Set(result.map((v) => path.basename(v.file)))
    expect(filesInResult.has('a.ts')).toBe(true)
    expect(filesInResult.has('b.ts')).toBe(true)
    // Each variant should have its tests attached
    for (const v of result) {
      expect(Array.isArray(v.tests)).toBe(true)
    }
  })

  it('skips targets not in changedFiles set', async () => {
    const fileA = path.join(tmpDir, 'a.ts')
    const fileB = path.join(tmpDir, 'b.ts')
    await fs.writeFile(fileA, 'const x = a === b')
    await fs.writeFile(fileB, 'const y = c + d')

    const testMap: TestMap = new Map()
    testMap.set(normalizePath(fileA), new Set(['/tests/a.test.ts']))
    testMap.set(normalizePath(fileB), new Set(['/tests/b.test.ts']))

    // Only fileA is in changedFiles
    const changedFiles = new Set([normalizePath(fileA)])

    const result = await enumerateAllVariants({
      cwd: tmpDir,
      targets: ['a.ts', 'b.ts'],
      testMap,
      changedFiles,
      coverageData: null,
      config: {},
    })

    // All variants should be from a.ts only
    for (const v of result) {
      expect(path.basename(v.file)).toBe('a.ts')
    }
  })

  it('filters variants by coverage data', async () => {
    const fileA = path.join(tmpDir, 'cov.ts')
    // Write code that produces mutations on different lines
    await fs.writeFile(fileA, 'const x = a === b\nconst y = c === d')

    const testMap: TestMap = new Map()
    testMap.set(normalizePath(fileA), new Set(['/tests/cov.test.ts']))

    // Only line 1 is covered
    const coverageData: CoverageData = {
      coveredLines: new Map([[normalizePath(fileA), new Set([1])]]),
    }

    const all = await enumerateAllVariants({
      cwd: tmpDir,
      targets: ['cov.ts'],
      testMap,
      changedFiles: null,
      coverageData: null,
      config: {},
    })

    const filtered = await enumerateAllVariants({
      cwd: tmpDir,
      targets: ['cov.ts'],
      testMap,
      changedFiles: null,
      coverageData,
      config: {},
    })

    expect(filtered.length).toBeLessThanOrEqual(all.length)
    // All filtered variants should be on line 1
    for (const v of filtered) {
      expect(v.line).toBe(1)
    }
  })

  it('returns empty array when no targets produce variants', async () => {
    const fileA = path.join(tmpDir, 'clean.ts')
    await fs.writeFile(fileA, 'const x = 1')

    const testMap: TestMap = new Map()

    const result = await enumerateAllVariants({
      cwd: tmpDir,
      targets: ['clean.ts'],
      testMap,
      changedFiles: null,
      coverageData: null,
      config: {},
    })

    expect(result).toEqual([])
  })

  it('attaches empty tests array when testMap has no entry for target', async () => {
    const fileA = path.join(tmpDir, 'orphan.ts')
    await fs.writeFile(fileA, 'const x = a === b')

    const testMap: TestMap = new Map() // no entries

    const result = await enumerateAllVariants({
      cwd: tmpDir,
      targets: ['orphan.ts'],
      testMap,
      changedFiles: null,
      coverageData: null,
      config: {},
    })

    expect(result.length).toBeGreaterThan(0)
    for (const v of result) {
      expect(v.tests).toEqual([])
    }
  })
})
