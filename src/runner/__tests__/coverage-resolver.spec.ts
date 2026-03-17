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
})
