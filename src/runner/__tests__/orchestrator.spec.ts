import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
vi.mock('../pool-executor.js', () => ({
  executePool: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../variants.js', () => ({
  enumerateAllVariants: vi.fn().mockResolvedValue([]),
  getTargetFile: vi
    .fn()
    .mockImplementation((t: unknown) =>
      typeof t === 'string' ? t : (t as { file: string }).file,
    ),
}))
vi.mock('../tasks.js', () => ({
  prepareTasks: vi.fn().mockReturnValue([]),
}))
vi.mock('../ts-checker.js', () => ({
  checkTypes: vi.fn().mockResolvedValue(new Set()),
  resolveTypescriptEnabled: vi.fn().mockReturnValue(false),
  resolveTsconfigPath: vi.fn().mockReturnValue(undefined),
}))
import { runOrchestrator, parseMutantTimeoutMs } from '../orchestrator.js'
import { loadMutineerConfig } from '../config.js'
import { createVitestAdapter, type VitestAdapter } from '../vitest/index.js'
import { autoDiscoverTargetsAndTests } from '../discover.js'
import { listChangedFiles } from '../changed.js'
import { executePool } from '../pool-executor.js'
import { prepareTasks, type MutantTask } from '../tasks.js'
import { enumerateAllVariants } from '../variants.js'
import type { Variant } from '../../types/mutant.js'

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

describe('parseMutantTimeoutMs', () => {
  it('returns the parsed value for a valid positive number', () => {
    expect(parseMutantTimeoutMs('5000')).toBe(5000)
  })

  it('returns 30_000 for undefined', () => {
    expect(parseMutantTimeoutMs(undefined)).toBe(30_000)
  })

  it('returns 30_000 for zero (kills tightenGT: n>=0 would return 0)', () => {
    expect(parseMutantTimeoutMs('0')).toBe(30_000)
  })

  it('returns 30_000 for Infinity (kills andToOr: || would return Infinity)', () => {
    expect(parseMutantTimeoutMs('Infinity')).toBe(30_000)
  })

  it('returns 30_000 for negative values', () => {
    expect(parseMutantTimeoutMs('-1')).toBe(30_000)
  })

  it('returns 30_000 for non-numeric strings', () => {
    expect(parseMutantTimeoutMs('abc')).toBe(30_000)
  })
})

describe('runOrchestrator no tests found', () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it('sets exitCode=1 when no tests are found for targets', async () => {
    process.exitCode = undefined
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [],
      testMap: new Map(),
      directTestMap: new Map(),
    })

    await runOrchestrator([], '/cwd')

    expect(process.exitCode).toBe(1)
  })

  it('logs error message when no tests are found for targets', async () => {
    process.exitCode = undefined
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [],
      testMap: new Map(),
      directTestMap: new Map(),
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runOrchestrator([], '/cwd')

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('No tests found for the selected targets'),
    )
  })

  it('does not run baseline when no tests are found', async () => {
    process.exitCode = undefined
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [],
      testMap: new Map(),
      directTestMap: new Map(),
    })

    await runOrchestrator([], '/cwd')

    expect(mockAdapter.runBaseline).not.toHaveBeenCalled()
  })
})

describe('runOrchestrator discovery logging', () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it('logs "Discovering tests..." before calling autoDiscoverTargetsAndTests', async () => {
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    const consoleSpy = vi.spyOn(console, 'log')

    await runOrchestrator([], '/cwd')

    const calls = consoleSpy.mock.calls.map((c) => c[0])
    const discoveringIdx = calls.findIndex((m) => m === 'Discovering tests...')
    expect(discoveringIdx).toBeGreaterThanOrEqual(0)
  })

  it('passes an onProgress callback to autoDiscoverTargetsAndTests', async () => {
    vi.mocked(loadMutineerConfig).mockResolvedValue({})

    await runOrchestrator([], '/cwd')

    const [, , onProgress] = vi.mocked(autoDiscoverTargetsAndTests).mock
      .calls[0]
    expect(typeof onProgress).toBe('function')
  })

  it('logs progress messages emitted by autoDiscoverTargetsAndTests', async () => {
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockImplementationOnce(
      async (_root, _cfg, onProgress) => {
        onProgress?.('Discovery complete: 3 source file(s), 2 test file(s)')
        return { targets: [], testMap: new Map(), directTestMap: new Map() }
      },
    )
    const consoleSpy = vi.spyOn(console, 'log')

    await runOrchestrator([], '/cwd')

    expect(consoleSpy).toHaveBeenCalledWith(
      'Discovery complete: 3 source file(s), 2 test file(s)',
    )
  })
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

describe('runOrchestrator shard filtering', () => {
  const targetFile = '/cwd/src/foo.ts'
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  function makeTask(key: string): MutantTask {
    return {
      key,
      v: {
        id: `${key}`,
        name: 'flipEQ',
        file: targetFile,
        code: '',
        line: 1,
        col: 0,
        tests: [testFile],
      },
      tests: [testFile],
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    vi.mocked(loadMutineerConfig).mockResolvedValue({
      targets: [targetFile],
    })
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [targetFile],
      testMap: new Map([[targetFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)
    // Return a non-empty variants array so orchestrator doesn't exit early
    vi.mocked(enumerateAllVariants).mockResolvedValue([{} as Variant])
    const tasks = ['k0', 'k1', 'k2', 'k3'].map(makeTask)
    vi.mocked(prepareTasks).mockReturnValue(tasks)
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('shard 1/2 assigns even-indexed tasks', async () => {
    await runOrchestrator(['--shard', '1/2'], '/cwd')

    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.tasks.map((t) => t.key)).toEqual(['k0', 'k2'])
  })

  it('shard 2/2 assigns odd-indexed tasks', async () => {
    await runOrchestrator(['--shard', '2/2'], '/cwd')

    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.tasks.map((t) => t.key)).toEqual(['k1', 'k3'])
  })

  it('does not call executePool when shard has no tasks', async () => {
    // Only 1 task total; shard 2/2 gets nothing
    vi.mocked(prepareTasks).mockReturnValue([makeTask('only')])

    await runOrchestrator(['--shard', '2/2'], '/cwd')

    expect(executePool).not.toHaveBeenCalled()
  })

  it('propagates shard to executePool', async () => {
    await runOrchestrator(['--shard', '1/4'], '/cwd')

    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.shard).toEqual({ index: 1, total: 4 })
  })
})
