import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  resolveCoverageConfig,
  loadCoverageAfterBaseline,
  type CoverageResolution,
} from '../coverage-resolver.js'
import type { TestRunnerAdapter } from '../types.js'
import type { ParsedCliOptions } from '../args.js'

function makeOpts(overrides: Partial<ParsedCliOptions> = {}): ParsedCliOptions {
  return {
    configPath: undefined,
    wantsChanged: false,
    wantsChangedWithDeps: false,
    wantsFull: false,
    wantsOnlyCoveredLines: false,
    wantsPerTestCoverage: false,
    coverageFilePath: undefined,
    concurrency: 1,
    progressMode: 'bar',
    minKillPercent: undefined,
    runner: 'vitest',
    timeout: undefined,
    reportFormat: 'text',
    shard: undefined,
    typescriptCheck: undefined,
    vitestProject: undefined,
    skipBaseline: false,
    ...overrides,
  }
}

function makeAdapter(
  overrides: Partial<TestRunnerAdapter> = {},
): TestRunnerAdapter {
  return {
    name: 'vitest',
    init: vi.fn().mockResolvedValue(undefined),
    runBaseline: vi.fn().mockResolvedValue(true),
    runMutant: vi.fn().mockResolvedValue({ status: 'killed', durationMs: 0 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    hasCoverageProvider: vi.fn().mockReturnValue(false),
    detectCoverageConfig: vi
      .fn()
      .mockResolvedValue({ perTestEnabled: false, coverageEnabled: false }),
    ...overrides,
  }
}

describe('resolveCoverageConfig', () => {
  beforeEach(() => {
    process.exitCode = undefined
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('returns baseline defaults when no coverage is requested', async () => {
    const result = await resolveCoverageConfig(
      makeOpts(),
      {},
      makeAdapter(),
      [],
    )
    expect(result.coverageData).toBeNull()
    expect(result.perTestCoverage).toBeNull()
    expect(result.enableCoverageForBaseline).toBe(false)
    expect(result.wantsPerTestCoverage).toBe(false)
    expect(result.needsCoverageFromBaseline).toBe(false)
  })

  it('enables coverage for baseline when config coverage is true', async () => {
    const result = await resolveCoverageConfig(
      makeOpts(),
      { coverage: true },
      makeAdapter(),
      [],
    )
    expect(result.enableCoverageForBaseline).toBe(true)
  })

  it('disables coverage for baseline when config coverage is false', async () => {
    const adapter = makeAdapter({
      detectCoverageConfig: vi
        .fn()
        .mockResolvedValue({ perTestEnabled: false, coverageEnabled: true }),
    })
    const result = await resolveCoverageConfig(
      makeOpts(),
      { coverage: false },
      adapter,
      [],
    )
    expect(result.enableCoverageForBaseline).toBe(false)
  })

  it('sets exitCode when onlyCoveredLines is set but no coverage provider', async () => {
    const opts = makeOpts({ wantsOnlyCoveredLines: true })
    const adapter = makeAdapter({
      hasCoverageProvider: vi.fn().mockReturnValue(false),
    })
    await resolveCoverageConfig(opts, {}, adapter, [])
    expect(process.exitCode).toBe(1)
  })

  it('does not set exitCode when onlyCoveredLines is set with coverage provider', async () => {
    const opts = makeOpts({ wantsOnlyCoveredLines: true })
    const adapter = makeAdapter({
      hasCoverageProvider: vi.fn().mockReturnValue(true),
    })
    await resolveCoverageConfig(opts, {}, adapter, [])
    expect(process.exitCode).toBeUndefined()
  })

  it('disables per-test coverage for jest runner', async () => {
    const opts = makeOpts({ runner: 'jest', wantsPerTestCoverage: true })
    const result = await resolveCoverageConfig(opts, {}, makeAdapter(), [])
    expect(result.wantsPerTestCoverage).toBe(false)
  })

  it('enables per-test coverage for vitest runner', async () => {
    const opts = makeOpts({ runner: 'vitest', wantsPerTestCoverage: true })
    const result = await resolveCoverageConfig(opts, {}, makeAdapter(), [])
    expect(result.wantsPerTestCoverage).toBe(true)
    expect(result.enableCoverageForBaseline).toBe(true)
  })

  it('enables per-test coverage when adapter reports it enabled', async () => {
    const adapter = makeAdapter({
      detectCoverageConfig: vi
        .fn()
        .mockResolvedValue({ perTestEnabled: true, coverageEnabled: false }),
    })
    const result = await resolveCoverageConfig(makeOpts(), {}, adapter, [])
    expect(result.wantsPerTestCoverage).toBe(true)
  })

  it('sets needsCoverageFromBaseline when onlyCoveredLines without coverageFile', async () => {
    const opts = makeOpts({ wantsOnlyCoveredLines: true })
    const adapter = makeAdapter({
      hasCoverageProvider: vi.fn().mockReturnValue(true),
    })
    const result = await resolveCoverageConfig(opts, {}, adapter, [])
    expect(result.needsCoverageFromBaseline).toBe(true)
    expect(result.enableCoverageForBaseline).toBe(true)
  })

  it('loads coverage data when coverageFilePath is provided', async () => {
    const coverageJson = {
      '/src/foo.ts': {
        path: '/src/foo.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { '0': 1 },
      },
    }
    const covDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-cov-file-'),
    )
    const covFile = path.join(covDir, 'coverage-final.json')
    await fs.writeFile(covFile, JSON.stringify(coverageJson))

    try {
      const opts = makeOpts({ coverageFilePath: covFile })
      const result = await resolveCoverageConfig(opts, {}, makeAdapter(), [])
      expect(result.coverageData).not.toBeNull()
      expect(result.coverageData!.coveredLines.size).toBeGreaterThan(0)
    } finally {
      await fs.rm(covDir, { recursive: true, force: true })
    }
  })

  it('logs warning when onlyCoveredLines + coverageData + no coverage provider', async () => {
    const coverageJson = {
      '/src/foo.ts': {
        path: '/src/foo.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { '0': 1 },
      },
    }
    const covDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-cov-warn-'),
    )
    const covFile = path.join(covDir, 'coverage-final.json')
    await fs.writeFile(covFile, JSON.stringify(coverageJson))

    try {
      const opts = makeOpts({
        wantsOnlyCoveredLines: true,
        coverageFilePath: covFile,
      })
      const adapter = makeAdapter({
        hasCoverageProvider: vi.fn().mockReturnValue(false),
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await resolveCoverageConfig(opts, {}, adapter, [])
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('onlyCoveredLines'),
      )
      warnSpy.mockRestore()
    } finally {
      await fs.rm(covDir, { recursive: true, force: true })
    }
  })
})

describe('loadCoverageAfterBaseline', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-cov-resolver-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns resolution unchanged when no coverage needed from baseline', async () => {
    const resolution: CoverageResolution = {
      coverageData: null,
      perTestCoverage: null,
      enableCoverageForBaseline: false,
      wantsPerTestCoverage: false,
      needsCoverageFromBaseline: false,
    }
    const result = await loadCoverageAfterBaseline(resolution, tmpDir)
    expect(result).toEqual(resolution)
  })

  it('loads coverage data from default path when needsCoverageFromBaseline', async () => {
    const coverageDir = path.join(tmpDir, 'coverage')
    await fs.mkdir(coverageDir, { recursive: true })
    const coverageJson = {
      '/src/foo.ts': {
        path: '/src/foo.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { '0': 1 },
      },
    }
    await fs.writeFile(
      path.join(coverageDir, 'coverage-final.json'),
      JSON.stringify(coverageJson),
    )

    const resolution: CoverageResolution = {
      coverageData: null,
      perTestCoverage: null,
      enableCoverageForBaseline: true,
      wantsPerTestCoverage: false,
      needsCoverageFromBaseline: true,
    }
    const result = await loadCoverageAfterBaseline(resolution, tmpDir)
    expect(result.coverageData).not.toBeNull()
    expect(result.coverageData!.coveredLines.size).toBeGreaterThan(0)
  })

  it('continues gracefully when coverage file is missing', async () => {
    const resolution: CoverageResolution = {
      coverageData: null,
      perTestCoverage: null,
      enableCoverageForBaseline: true,
      wantsPerTestCoverage: false,
      needsCoverageFromBaseline: true,
    }
    const result = await loadCoverageAfterBaseline(resolution, tmpDir)
    // Should not throw, coverageData stays null
    expect(result.coverageData).toBeNull()
  })

  it('does not modify resolution when wantsPerTestCoverage is false', async () => {
    const resolution: CoverageResolution = {
      coverageData: null,
      perTestCoverage: null,
      enableCoverageForBaseline: false,
      wantsPerTestCoverage: false,
      needsCoverageFromBaseline: false,
    }
    const result = await loadCoverageAfterBaseline(resolution, tmpDir)
    expect(result.perTestCoverage).toBeNull()
  })

  it('loads per-test coverage when wantsPerTestCoverage is true', async () => {
    const coverageDir = path.join(tmpDir, 'coverage')
    await fs.mkdir(coverageDir, { recursive: true })
    const testFile = '/test/foo.spec.ts'
    const srcFile = '/src/foo.ts'
    const perTestData = {
      [testFile]: { [srcFile]: [1, 2, 3] },
    }
    await fs.writeFile(
      path.join(coverageDir, 'per-test-coverage.json'),
      JSON.stringify(perTestData),
    )

    const resolution: CoverageResolution = {
      coverageData: null,
      perTestCoverage: null,
      enableCoverageForBaseline: true,
      wantsPerTestCoverage: true,
      needsCoverageFromBaseline: false,
    }
    const result = await loadCoverageAfterBaseline(resolution, tmpDir)
    expect(result.perTestCoverage).not.toBeNull()
    expect(result.perTestCoverage!.size).toBeGreaterThan(0)
  })

  it('logs warning when per-test coverage data is not found', async () => {
    const resolution: CoverageResolution = {
      coverageData: null,
      perTestCoverage: null,
      enableCoverageForBaseline: true,
      wantsPerTestCoverage: true,
      needsCoverageFromBaseline: false,
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await loadCoverageAfterBaseline(resolution, tmpDir)
    expect(result.perTestCoverage).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Per-test coverage data not found'),
    )
    warnSpy.mockRestore()
  })
})
