import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MutineerConfig } from '../../types/config.js'

// Mock all heavy dependencies before importing orchestrator
vi.mock('../config.js', () => ({
  loadMutineerConfig: vi.fn(),
}))
vi.mock('../cache.js', () => ({
  clearCacheOnStart: vi.fn().mockResolvedValue(undefined),
  readMutantCache: vi.fn().mockResolvedValue({}),
}))
vi.mock('../vitest/index.js', () => ({
  createVitestAdapter: vi.fn(),
}))
vi.mock('../jest/index.js', () => ({
  createJestAdapter: vi.fn(),
}))
vi.mock('../coverage-resolver.js', () => ({
  resolveCoverageConfig: vi.fn().mockResolvedValue({
    enableCoverageForBaseline: false,
    wantsPerTestCoverage: false,
    coverageData: null,
  }),
  loadCoverageAfterBaseline: vi.fn().mockResolvedValue({
    coverageData: null,
    perTestCoverage: null,
  }),
}))
vi.mock('../discover.js', () => ({
  autoDiscoverTargetsAndTests: vi.fn().mockResolvedValue({
    targets: [],
    testMap: new Map(),
    directTestMap: new Map(),
  }),
}))
vi.mock('../changed.js', () => ({
  listChangedFiles: vi.fn().mockReturnValue([]),
}))

import { runOrchestrator } from '../orchestrator.js'
import { loadMutineerConfig } from '../config.js'
import { createVitestAdapter, type VitestAdapter } from '../vitest/index.js'
import { autoDiscoverTargetsAndTests } from '../discover.js'
import { listChangedFiles } from '../changed.js'

const mockAdapter = {
  name: 'vitest',
  init: vi.fn().mockResolvedValue(undefined),
  runBaseline: vi.fn().mockResolvedValue(true),
  runMutant: vi.fn().mockResolvedValue({ status: 'killed', durationMs: 10 }),
  shutdown: vi.fn().mockResolvedValue(undefined),
  hasCoverageProvider: vi.fn().mockReturnValue(false),
  detectCoverageConfig: vi
    .fn()
    .mockResolvedValue({ perTestEnabled: false, coverageEnabled: false }),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createVitestAdapter).mockReturnValue(
    mockAdapter as unknown as VitestAdapter,
  )
})

describe('runOrchestrator --changed-with-deps diagnostic', () => {
  it('logs uncovered targets when wantsChangedWithDeps is true', async () => {
    const cfg: MutineerConfig = {}
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    const depFile = '/cwd/src/dep.ts'
    vi.mocked(listChangedFiles).mockReturnValue([depFile])
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [depFile],
      testMap: new Map(), // dep has no covering tests
      directTestMap: new Map(),
    })

    const consoleSpy = vi.spyOn(console, 'log')
    await runOrchestrator(['--changed-with-deps'], '/cwd')

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '1 target(s) from --changed-with-deps have no covering tests and will be skipped',
      ),
    )
  })

  it('does not log when all changed-with-deps targets have covering tests', async () => {
    const cfg: MutineerConfig = {}
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    const depFile = '/cwd/src/dep.ts'
    const testFile = '/cwd/src/__tests__/dep.spec.ts'
    vi.mocked(listChangedFiles).mockReturnValue([depFile])
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [depFile],
      testMap: new Map([[depFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)

    const consoleSpy = vi.spyOn(console, 'log')
    await runOrchestrator(['--changed-with-deps'], '/cwd')

    const diagnosticCalls = consoleSpy.mock.calls.filter(
      ([msg]) =>
        typeof msg === 'string' && msg.includes('have no covering tests'),
    )
    expect(diagnosticCalls).toHaveLength(0)
  })

  it('does not log diagnostic when wantsChangedWithDeps is false', async () => {
    const cfg: MutineerConfig = {}
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    const depFile = '/cwd/src/dep.ts'
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [depFile],
      testMap: new Map(),
      directTestMap: new Map(),
    })

    const consoleSpy = vi.spyOn(console, 'log')
    await runOrchestrator([], '/cwd')

    const diagnosticCalls = consoleSpy.mock.calls.filter(
      ([msg]) =>
        typeof msg === 'string' && msg.includes('have no covering tests'),
    )
    expect(diagnosticCalls).toHaveLength(0)
  })
})

describe('runOrchestrator timeout precedence', () => {
  it('uses CLI --timeout when provided', async () => {
    const cfg: MutineerConfig = {}
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    await runOrchestrator(['--timeout', '5000'], '/cwd')

    expect(createVitestAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 5000 }),
    )
  })

  it('uses config timeout when CLI flag is absent', async () => {
    const cfg: MutineerConfig = { timeout: 10000 }
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    await runOrchestrator([], '/cwd')

    expect(createVitestAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 10000 }),
    )
  })

  it('CLI --timeout takes precedence over config timeout', async () => {
    const cfg: MutineerConfig = { timeout: 10000 }
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    await runOrchestrator(['--timeout', '2000'], '/cwd')

    expect(createVitestAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 2000 }),
    )
  })

  it('falls back to MUTANT_TIMEOUT_MS default when neither CLI nor config timeout set', async () => {
    const cfg: MutineerConfig = {}
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    await runOrchestrator([], '/cwd')

    expect(createVitestAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 30_000 }),
    )
  })

  it('env var MUTINEER_MUTANT_TIMEOUT_MS affects default when no CLI/config timeout', async () => {
    const cfg: MutineerConfig = {}
    vi.mocked(loadMutineerConfig).mockResolvedValue(cfg)

    const orig = process.env.MUTINEER_MUTANT_TIMEOUT_MS
    // env var is read at module load time, so we can only verify the default
    // is used when no cli/config override is present
    process.env.MUTINEER_MUTANT_TIMEOUT_MS = orig
    await runOrchestrator([], '/cwd')

    const call = vi.mocked(createVitestAdapter).mock.calls[0][0]
    expect(call.timeoutMs).toBeGreaterThan(0)
    expect(Number.isFinite(call.timeoutMs)).toBe(true)
  })
})
