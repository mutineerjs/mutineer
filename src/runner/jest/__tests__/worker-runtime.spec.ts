import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  JestWorkerRuntime,
  createJestWorkerRuntime,
} from '../worker-runtime.js'

// Mock the shared utilities
vi.mock('../../shared/index.js', () => ({
  getMutantFilePath: vi.fn((id: string) => `/tmp/__mutineer__/mutant_${id}.ts`),
  setRedirect: vi.fn(),
  clearRedirect: vi.fn(),
}))

// Mock fs sync operations
const writeFileSyncMock = vi.fn()
const rmSyncMock = vi.fn()
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    writeFileSync: (...args: any[]) => writeFileSyncMock(...args),
    rmSync: (...args: any[]) => rmSyncMock(...args),
  },
  existsSync: vi.fn(() => true),
  writeFileSync: (...args: any[]) => writeFileSyncMock(...args),
  rmSync: (...args: any[]) => rmSyncMock(...args),
}))

// Mock @jest/core
const mockRunCLI = vi.fn()
vi.mock('@jest/core', () => ({
  runCLI: (...args: any[]) => mockRunCLI(...args),
}))

describe('JestWorkerRuntime', () => {
  let runtime: JestWorkerRuntime

  beforeEach(() => {
    vi.clearAllMocks()
    runtime = new JestWorkerRuntime({
      workerId: 'w0',
      cwd: '/project',
    })
  })

  afterEach(() => {
    // Clean up env vars
    delete process.env.MUTINEER_REDIRECT_FROM
    delete process.env.MUTINEER_REDIRECT_TO
  })

  it('init and shutdown are no-ops', async () => {
    await expect(runtime.init()).resolves.toBeUndefined()
    await expect(runtime.shutdown()).resolves.toBeUndefined()
  })

  it('runs a mutant and returns killed when tests fail', async () => {
    mockRunCLI.mockResolvedValueOnce({
      results: {
        success: false,
        numTotalTests: 3,
        testResults: [{ failureMessage: 'Expected true to be false' }],
      },
      globalConfig: {},
    })

    const result = await runtime.run(
      {
        id: 'foo.ts#1',
        name: 'flipEQ',
        file: '/project/src/foo.ts',
        code: 'mutated code',
        line: 1,
        col: 0,
      },
      ['/project/tests/foo.test.ts'],
    )

    expect(result.killed).toBe(true)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.error).toBe('Expected true to be false')
  })

  it('returns not killed when tests pass', async () => {
    mockRunCLI.mockResolvedValueOnce({
      results: {
        success: true,
        numTotalTests: 3,
        testResults: [],
      },
      globalConfig: {},
    })

    const result = await runtime.run(
      {
        id: 'foo.ts#1',
        name: 'flipEQ',
        file: '/project/src/foo.ts',
        code: 'mutated code',
        line: 1,
        col: 0,
      },
      ['/project/tests/foo.test.ts'],
    )

    expect(result.killed).toBe(false)
  })

  it('returns killed on runCLI error', async () => {
    mockRunCLI.mockRejectedValueOnce(new Error('Jest crashed'))

    const result = await runtime.run(
      {
        id: 'foo.ts#1',
        name: 'flipEQ',
        file: '/project/src/foo.ts',
        code: 'mutated code',
        line: 1,
        col: 0,
      },
      ['/project/tests/foo.test.ts'],
    )

    expect(result.killed).toBe(true)
    expect(result.error).toBe('Jest crashed')
  })

  it('writes the mutant file and cleans up after run', async () => {
    mockRunCLI.mockResolvedValueOnce({
      results: { success: true, testResults: [] },
      globalConfig: {},
    })

    const { getMutantFilePath, setRedirect, clearRedirect } =
      await import('../../shared/index.js')

    await runtime.run(
      {
        id: 'foo.ts#1',
        name: 'flipEQ',
        file: '/project/src/foo.ts',
        code: 'mutated code',
        line: 1,
        col: 0,
      },
      ['/project/tests/foo.test.ts'],
    )

    expect(getMutantFilePath).toHaveBeenCalled()
    expect(writeFileSyncMock).toHaveBeenCalled()
    expect(setRedirect).toHaveBeenCalled()
    expect(clearRedirect).toHaveBeenCalled()
    expect(rmSyncMock).toHaveBeenCalled()
  })

  it('uses jest config when provided', async () => {
    const runtimeWithConfig = new JestWorkerRuntime({
      workerId: 'w0',
      cwd: '/project',
      jestConfigPath: 'jest.config.ts',
    })

    mockRunCLI.mockResolvedValueOnce({
      results: { success: true, testResults: [] },
      globalConfig: {},
    })

    await runtimeWithConfig.run(
      {
        id: 'foo.ts#1',
        name: 'flipEQ',
        file: '/project/src/foo.ts',
        code: 'mutated code',
        line: 1,
        col: 0,
      },
      ['/project/tests/foo.test.ts'],
    )

    const callArgs = mockRunCLI.mock.calls[0][0]
    expect(callArgs.config).toBe('jest.config.ts')
  })
})

describe('createJestWorkerRuntime', () => {
  it('returns a JestWorkerRuntime instance', () => {
    const runtime = createJestWorkerRuntime({
      workerId: 'w1',
      cwd: '/project',
    })
    expect(runtime).toBeInstanceOf(JestWorkerRuntime)
  })
})
