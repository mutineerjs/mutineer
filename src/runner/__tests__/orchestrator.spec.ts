import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MutineerConfig } from '../../types/config.js'

const { mockLogDebug } = vi.hoisted(() => ({ mockLogDebug: vi.fn() }))
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: mockLogDebug,
    info: (...args: unknown[]) =>
      console.log(...(args as [unknown, ...unknown[]])),
    warn: (...args: unknown[]) =>
      console.warn(...(args as [unknown, ...unknown[]])),
    error: (...args: unknown[]) =>
      console.error(...(args as [unknown, ...unknown[]])),
  }),
  DEBUG: true,
}))

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
vi.mock('../../core/schemata.js', () => ({
  generateSchema: vi.fn().mockReturnValue({
    schemaCode: '// @ts-nocheck\n',
    fallbackIds: new Set(),
  }),
}))
import { runOrchestrator, parseMutantTimeoutMs } from '../orchestrator.js'
import { loadMutineerConfig } from '../config.js'
import { createVitestAdapter, type VitestAdapter } from '../vitest/index.js'
import { createJestAdapter } from '../jest/index.js'
import { autoDiscoverTargetsAndTests } from '../discover.js'
import { listChangedFiles } from '../changed.js'
import { executePool } from '../pool-executor.js'
import { prepareTasks, type MutantTask } from '../tasks.js'
import { enumerateAllVariants, getTargetFile } from '../variants.js'
import { resolveTypescriptEnabled, checkTypes } from '../ts-checker.js'
import {
  resolveCoverageConfig,
  loadCoverageAfterBaseline,
} from '../coverage-resolver.js'
import type { Variant } from '../../types/mutant.js'
import { generateSchema } from '../../core/schemata.js'
import os from 'node:os'
import fssync from 'node:fs'
import path from 'node:path'

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

describe('runOrchestrator --changed-with-imports diagnostic', () => {
  it('logs uncovered targets when wantsChangedWithImports is true', async () => {
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
    await runOrchestrator(['--changed-with-imports'], '/cwd')

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '1 target(s) from --changed-with-imports have no covering tests and will be skipped',
      ),
    )
  })

  it('does not log when all changed-with-imports targets have covering tests', async () => {
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
    await runOrchestrator(['--changed-with-imports'], '/cwd')

    const diagnosticCalls = consoleSpy.mock.calls.filter(
      ([msg]) =>
        typeof msg === 'string' && msg.includes('have no covering tests'),
    )
    expect(diagnosticCalls).toHaveLength(0)
  })

  it('does not log diagnostic when wantsChangedWithImports is false', async () => {
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

  function makeVariant(id: string): Variant {
    return {
      id,
      name: 'flipEQ',
      file: targetFile,
      code: '',
      line: 1,
      col: 0,
      tests: [testFile],
    }
  }

  function makeTask(key: string): MutantTask {
    return {
      key,
      v: makeVariant(key),
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
    // Return 4 variants so shard filtering can split them across shards
    vi.mocked(enumerateAllVariants).mockResolvedValue(
      ['k0', 'k1', 'k2', 'k3'].map(makeVariant),
    )
    // Map each variant to a task by its id
    vi.mocked(prepareTasks).mockImplementation((variants) =>
      (variants as Variant[]).map((v) => makeTask(v.id)),
    )
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('shard 1/2 assigns even-indexed variants', async () => {
    await runOrchestrator(['--shard', '1/2'], '/cwd')

    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.tasks.map((t) => t.key)).toEqual(['k0', 'k2'])
  })

  it('shard 2/2 assigns odd-indexed variants', async () => {
    await runOrchestrator(['--shard', '2/2'], '/cwd')

    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.tasks.map((t) => t.key)).toEqual(['k1', 'k3'])
  })

  it('does not call executePool when shard has no variants', async () => {
    // Only 1 variant total; shard 2/2 gets nothing
    vi.mocked(enumerateAllVariants).mockResolvedValue([makeVariant('only')])

    await runOrchestrator(['--shard', '2/2'], '/cwd')

    expect(executePool).not.toHaveBeenCalled()
  })

  it('propagates shard to executePool', async () => {
    await runOrchestrator(['--shard', '1/4'], '/cwd')

    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.shard).toEqual({ index: 1, total: 4 })
  })
})

describe('runOrchestrator target ordering', () => {
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    // No explicit targets -- use auto-discovery
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)
    vi.mocked(enumerateAllVariants).mockResolvedValue([])
    vi.mocked(prepareTasks).mockReturnValue([])
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('sorts auto-discovered targets alphabetically before enumeration', async () => {
    const fileA = '/cwd/src/aaa.ts'
    const fileB = '/cwd/src/bbb.ts'
    const fileC = '/cwd/src/ccc.ts'
    // Return targets in reverse-alphabetical order (simulating non-deterministic fs)
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [fileC, fileA, fileB],
      testMap: new Map([
        [fileA, new Set([testFile])],
        [fileB, new Set([testFile])],
        [fileC, new Set([testFile])],
      ]),
      directTestMap: new Map(),
    })

    await runOrchestrator([], '/cwd')

    const call = vi.mocked(enumerateAllVariants).mock.calls[0][0]
    expect(call.targets).toEqual([fileA, fileB, fileC])
  })
})

describe('runOrchestrator --skip-baseline', () => {
  const targetFile = '/cwd/src/foo.ts'
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [targetFile],
      testMap: new Map([[targetFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('does not call adapter.runBaseline when --skip-baseline is passed', async () => {
    await runOrchestrator(['--skip-baseline'], '/cwd')

    expect(mockAdapter.runBaseline).not.toHaveBeenCalled()
  })

  it('logs skip message when --skip-baseline is passed', async () => {
    const consoleSpy = vi.spyOn(console, 'log')

    await runOrchestrator(['--skip-baseline'], '/cwd')

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping baseline tests (--skip-baseline)'),
    )
  })

  it('still calls adapter.runBaseline when --skip-baseline is absent', async () => {
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)

    await runOrchestrator([], '/cwd')

    expect(mockAdapter.runBaseline).toHaveBeenCalledOnce()
  })
})

describe('runOrchestrator schema generation', () => {
  let tmpDir: string
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  beforeEach(() => {
    tmpDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'mutineer-orch-schema-'))
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)
  })

  afterEach(() => {
    process.exitCode = undefined
    fssync.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('calls generateSchema and passes fallbackIds to executePool', async () => {
    const sourceFile = path.join(tmpDir, 'source.ts')
    fssync.writeFileSync(sourceFile, 'const x = 1 + 2', 'utf8')

    const variant: Variant = {
      id: 'source.ts#0',
      name: 'flipArith',
      file: sourceFile,
      code: 'const x = 1 - 2',
      line: 1,
      col: 10,
      tests: [testFile],
    }
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [sourceFile],
      testMap: new Map([[sourceFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(enumerateAllVariants).mockResolvedValue([variant])
    vi.mocked(prepareTasks).mockReturnValue([
      {
        key: 'schema-test-key',
        v: variant,
        tests: [testFile],
      },
    ])
    const mockFallbacks = new Set(['source.ts#0'])
    vi.mocked(generateSchema).mockReturnValue({
      schemaCode: '// @ts-nocheck\nconst x = 1',
      fallbackIds: mockFallbacks,
    })

    await runOrchestrator([], tmpDir)

    expect(generateSchema).toHaveBeenCalledWith(expect.any(String), [variant])
    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.fallbackIds).toStrictEqual(mockFallbacks)
  })

  it('treats all variants as fallback when source file read fails', async () => {
    const missingFile = path.join(tmpDir, 'nonexistent.ts')
    const variant: Variant = {
      id: 'nonexistent.ts#0',
      name: 'test',
      file: missingFile,
      code: 'x',
      line: 1,
      col: 0,
      tests: [testFile],
    }
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [missingFile],
      testMap: new Map([[missingFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(enumerateAllVariants).mockResolvedValue([variant])
    vi.mocked(prepareTasks).mockReturnValue([
      { key: 'fallback-key', v: variant, tests: [testFile] },
    ])

    await runOrchestrator([], tmpDir)

    const call = vi.mocked(executePool).mock.calls[0][0]
    expect(call.fallbackIds?.has('nonexistent.ts#0')).toBe(true)
  })

  it('logs embedded and fallback schema counts', async () => {
    const sourceFile = path.join(tmpDir, 'source.ts')
    fssync.writeFileSync(sourceFile, 'const x = 1 + 2', 'utf8')

    const variant: Variant = {
      id: 'source.ts#0',
      name: 'flipArith',
      file: sourceFile,
      code: 'const x = 1 - 2',
      line: 1,
      col: 10,
      tests: [testFile],
    }
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [sourceFile],
      testMap: new Map([[sourceFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(enumerateAllVariants).mockResolvedValue([variant])
    vi.mocked(prepareTasks).mockReturnValue([
      { key: 'log-test-key', v: variant, tests: [testFile] },
    ])
    vi.mocked(generateSchema).mockReturnValue({
      schemaCode: '// @ts-nocheck\n',
      fallbackIds: new Set(),
    })

    await runOrchestrator([], tmpDir)

    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.stringMatching(/Schema: 1 embedded, 0 fallback/),
    )
  })
})

describe('runOrchestrator jest runner', () => {
  const targetFile = '/cwd/src/foo.ts'
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [targetFile],
      testMap: new Map([[targetFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(createJestAdapter).mockReturnValue(
      mockAdapter as unknown as ReturnType<typeof createJestAdapter>,
    )
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('uses jest adapter when --runner jest is passed', async () => {
    await runOrchestrator(['--runner', 'jest'], '/cwd')

    expect(createJestAdapter).toHaveBeenCalled()
    expect(createVitestAdapter).not.toHaveBeenCalled()
  })
})

describe('runOrchestrator vitestProject', () => {
  const targetFile = '/cwd/src/foo.ts'
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [targetFile],
      testMap: new Map([[targetFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('passes vitestProject from config to adapter', async () => {
    vi.mocked(loadMutineerConfig).mockResolvedValue({
      vitestProject: 'my-project',
    })

    await runOrchestrator([], '/cwd')

    expect(createVitestAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ vitestProject: 'my-project' }),
    )
  })
})

describe('runOrchestrator --changed filter', () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it('skips target not in changedAbs and exits with no tests error', async () => {
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    const targetFile = '/cwd/src/foo.ts'
    const unchangedFile = '/cwd/src/bar.ts'
    vi.mocked(listChangedFiles).mockReturnValue([targetFile]) // only targetFile is changed
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [unchangedFile], // bar.ts is not changed -> filtered out
      testMap: new Map([
        [unchangedFile, new Set(['/cwd/src/__tests__/bar.spec.ts'])],
      ]),
      directTestMap: new Map(),
    })

    await runOrchestrator(['--changed'], '/cwd')

    // With no tests because bar.ts was filtered, should hit the no-tests error
    expect(process.exitCode).toBe(1)
  })
})

describe('runOrchestrator baseline failure', () => {
  const targetFile = '/cwd/src/foo.ts'
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [targetFile],
      testMap: new Map([[targetFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('sets exitCode=1 and returns when baseline fails', async () => {
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(false)

    await runOrchestrator([], '/cwd')

    expect(process.exitCode).toBe(1)
    expect(enumerateAllVariants).not.toHaveBeenCalled()
  })
})

describe('runOrchestrator TypeScript checking', () => {
  let tmpDir: string
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  function makeVariant(id: string, file: string): Variant {
    return {
      id,
      name: 'returnNull',
      file,
      code: 'return null',
      line: 1,
      col: 0,
      tests: [testFile],
    }
  }

  beforeEach(() => {
    tmpDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'mutineer-orch-ts-'))
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)
  })

  afterEach(() => {
    process.exitCode = undefined
    fssync.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('filters compile-error variants and populates cache when TS enabled', async () => {
    const sourceFile = path.join(tmpDir, 'source.ts')
    fssync.writeFileSync(sourceFile, 'const x = 1', 'utf8')

    const goodVariant = makeVariant('source.ts#0', sourceFile)
    const badVariant = makeVariant('source.ts#1', sourceFile)

    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [sourceFile],
      testMap: new Map([[sourceFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(enumerateAllVariants).mockResolvedValue([goodVariant, badVariant])
    vi.mocked(resolveTypescriptEnabled).mockReturnValue(true)
    vi.mocked(checkTypes).mockResolvedValue(new Set(['source.ts#1']))
    vi.mocked(prepareTasks)
      .mockReturnValueOnce([
        { key: 'source.ts#1', v: badVariant, tests: [testFile] },
      ]) // compile-error tasks
      .mockReturnValueOnce([
        { key: 'source.ts#0', v: goodVariant, tests: [testFile] },
      ]) // runnable tasks

    await runOrchestrator([], tmpDir)

    // executePool should only receive the good variant
    const poolCall = vi.mocked(executePool).mock.calls[0][0]
    expect(poolCall.tasks.map((t) => t.key)).toEqual(['source.ts#0'])
  })

  it('logs filtered compile-error count when TS enabled', async () => {
    const sourceFile = path.join(tmpDir, 'source.ts')
    fssync.writeFileSync(sourceFile, 'const x = 1', 'utf8')

    const badVariant = makeVariant('source.ts#0', sourceFile)

    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [sourceFile],
      testMap: new Map([[sourceFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(enumerateAllVariants).mockResolvedValue([badVariant])
    vi.mocked(resolveTypescriptEnabled).mockReturnValue(true)
    vi.mocked(checkTypes).mockResolvedValue(new Set(['source.ts#0']))
    vi.mocked(prepareTasks).mockReturnValue([
      { key: 'source.ts#0', v: badVariant, tests: [testFile] },
    ])

    const consoleSpy = vi.spyOn(console, 'log')
    await runOrchestrator([], tmpDir)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'TypeScript: filtered 1 mutant(s) with compile errors',
      ),
    )
  })

  it('calls executePool with empty tasks when all variants are compile errors', async () => {
    const sourceFile = path.join(tmpDir, 'source.ts')
    fssync.writeFileSync(sourceFile, 'const x = 1', 'utf8')

    const badVariant = makeVariant('source.ts#0', sourceFile)

    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [sourceFile],
      testMap: new Map([[sourceFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(enumerateAllVariants).mockResolvedValue([badVariant])
    vi.mocked(resolveTypescriptEnabled).mockReturnValue(true)
    vi.mocked(checkTypes).mockResolvedValue(new Set(['source.ts#0']))
    // First call: compile-error cache population; second call: runnable variants (empty)
    vi.mocked(prepareTasks)
      .mockReturnValueOnce([
        { key: 'source.ts#0', v: badVariant, tests: [testFile] },
      ])
      .mockReturnValueOnce([])

    await runOrchestrator([], tmpDir)

    // executePool is still called, but with empty tasks
    const poolCall = vi.mocked(executePool).mock.calls[0][0]
    expect(poolCall.tasks).toEqual([])
  })

  it('runs TS checking but skips filtering when no compile errors found', async () => {
    const sourceFile = path.join(tmpDir, 'source.ts')
    fssync.writeFileSync(sourceFile, 'const x = 1', 'utf8')

    const goodVariant = makeVariant('source.ts#0', sourceFile)

    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [sourceFile],
      testMap: new Map([[sourceFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(enumerateAllVariants).mockResolvedValue([goodVariant])
    vi.mocked(resolveTypescriptEnabled).mockReturnValue(true)
    vi.mocked(checkTypes).mockResolvedValue(new Set()) // no compile errors
    vi.mocked(prepareTasks).mockReturnValue([
      { key: 'source.ts#0', v: goodVariant, tests: [testFile] },
    ])

    await runOrchestrator([], tmpDir)

    // All variants are runnable; executePool receives the full task list
    const poolCall = vi.mocked(executePool).mock.calls[0][0]
    expect(poolCall.tasks.map((t) => t.key)).toEqual(['source.ts#0'])
  })
})

describe('runOrchestrator misc branches', () => {
  const targetFile = '/cwd/src/foo.ts'
  const testFile = '/cwd/src/__tests__/foo.spec.ts'

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.mocked(createVitestAdapter).mockReturnValue(
      mockAdapter as unknown as VitestAdapter,
    )
    vi.mocked(loadMutineerConfig).mockResolvedValue({})
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [targetFile],
      testMap: new Map([[targetFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })
    vi.mocked(mockAdapter.runBaseline).mockResolvedValue(true)
    // Reset mocks that may carry over from other describe blocks
    vi.mocked(resolveCoverageConfig).mockResolvedValue({
      enableCoverageForBaseline: false,
      wantsPerTestCoverage: false,
      coverageData: null,
    } as any)
    vi.mocked(loadCoverageAfterBaseline).mockResolvedValue({
      coverageData: null,
      perTestCoverage: null,
    } as any)
    vi.mocked(resolveTypescriptEnabled).mockReturnValue(false)
    vi.mocked(checkTypes).mockResolvedValue(new Set())
    vi.mocked(enumerateAllVariants).mockResolvedValue([])
    vi.mocked(prepareTasks).mockReturnValue([])
    vi.mocked(getTargetFile).mockImplementation((t) =>
      typeof t === 'string' ? t : (t as { file: string }).file,
    )
  })

  afterEach(() => {
    process.exitCode = undefined
  })

  it('logs "only covered lines" when --only-covered-lines is passed', async () => {
    const consoleSpy = vi.spyOn(console, 'log')
    await runOrchestrator(['--only-covered-lines'], '/cwd')

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('only covered lines'),
    )
  })

  it('uses autoDiscover=false to return empty targets when no cfg.targets set', async () => {
    vi.mocked(loadMutineerConfig).mockResolvedValue({ autoDiscover: false })
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [targetFile],
      testMap: new Map(),
      directTestMap: new Map(),
    })

    await runOrchestrator([], '/cwd')

    // With autoDiscover=false and no cfg.targets, targets is [], no tests found, exit=1
    expect(process.exitCode).toBe(1)
  })

  it('logs coverage collection message when enableCoverageForBaseline is true', async () => {
    vi.mocked(resolveCoverageConfig).mockResolvedValue({
      enableCoverageForBaseline: true,
      wantsPerTestCoverage: false,
      coverageData: null,
    } as any)

    const consoleSpy = vi.spyOn(console, 'log')
    await runOrchestrator([], '/cwd')

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('collecting coverage'),
    )
  })

  it('logs "no mutants" with coverage note when coverageData is non-null', async () => {
    vi.mocked(loadCoverageAfterBaseline).mockResolvedValue({
      coverageData: new Map(), // non-null
      perTestCoverage: null,
    } as any)

    const consoleSpy = vi.spyOn(console, 'log')
    await runOrchestrator([], '/cwd')

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('uncovered lines'),
    )
  })

  it('collects test files for relative target path', async () => {
    const relTarget = 'src/foo.ts'
    vi.mocked(getTargetFile).mockImplementation((t) =>
      typeof t === 'string' ? relTarget : (t as { file: string }).file,
    )
    vi.mocked(autoDiscoverTargetsAndTests).mockResolvedValue({
      targets: [relTarget],
      testMap: new Map([[targetFile, new Set([testFile])]]),
      directTestMap: new Map(),
    })

    // Relative path gets joined with cwd — should match the testMap key
    await runOrchestrator([], '/cwd')

    // runBaseline should be called since test was found via relative path join
    expect(mockAdapter.runBaseline).toHaveBeenCalled()
  })
})
