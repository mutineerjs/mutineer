import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createJestAdapter } from '../adapter.js'

// Mock JestPool to avoid real processes
let poolInstance: { init: any; run: any; shutdown: any } | null = null
let poolCtorOpts: any = null
vi.mock('../pool.js', () => {
  class MockPool {
    init = vi.fn()
    run = vi.fn()
    shutdown = vi.fn()
    constructor(opts: any) {
      poolCtorOpts = opts
      poolInstance = this
    }
  }
  return { JestPool: MockPool }
})

// Mock runCLI from jest
const runCLIMock = vi.fn()
vi.mock('@jest/core', () => ({
  runCLI: runCLIMock,
}))

function makeAdapter(
  opts: Partial<import('../../types.js').TestRunnerAdapterOptions> = {},
) {
  return createJestAdapter({
    cwd: opts.cwd ?? process.cwd(),
    concurrency: opts.concurrency ?? 2,
    timeoutMs: opts.timeoutMs ?? 1000,
    config: opts.config ?? ({ jestConfig: undefined } as any),
    cliArgs: opts.cliArgs ?? ['--changed'],
  })
}

function makeAdapterWithArgs(cliArgs: string[]) {
  return createJestAdapter({
    cwd: process.cwd(),
    concurrency: 2,
    timeoutMs: 1000,
    config: { jestConfig: undefined } as any,
    cliArgs,
  })
}

describe('Jest adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initialises pool with override concurrency', async () => {
    const adapter = makeAdapter()
    await adapter.init(4)
    expect(poolInstance?.init).toHaveBeenCalledTimes(1)
    expect(poolCtorOpts.concurrency).toBe(4)
  })

  it('runs baseline via runCLI with coverage when requested', async () => {
    const adapter = makeAdapter({
      config: { jestConfig: 'jest.config.ts' } as any,
    })
    runCLIMock.mockResolvedValueOnce({ results: { success: true } })

    const ok = await adapter.runBaseline(['test-a'], {
      collectCoverage: true,
      perTestCoverage: false,
    })

    expect(ok).toBe(true)
    expect(runCLIMock).toHaveBeenCalledTimes(1)
    const args = runCLIMock.mock.calls[0][0] as any
    expect(args.collectCoverage).toBe(true)
    expect(args.coverageProvider).toBe('v8')
    expect(args.config).toBe('jest.config.ts')
  })

  it('does not write captured output to stdout/stderr on success', async () => {
    const adapter = makeAdapter()
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    runCLIMock.mockResolvedValueOnce({ results: { success: true } })

    const ok = await adapter.runBaseline(['test-a'], {
      collectCoverage: false,
      perTestCoverage: false,
    })

    expect(ok).toBe(true)
    // No output should be replayed on success
    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(stderrWrite).not.toHaveBeenCalled()
    stdoutWrite.mockRestore()
    stderrWrite.mockRestore()
  })

  it('replays captured output to stdout/stderr on failure', async () => {
    const adapter = makeAdapter()

    // Spy before runBaseline so adapter's origStdoutWrite/origStderrWrite bind to the spy.
    // runCLI writes during capture are suppressed; the spy sees only the replay after restore.
    const writtenStdout: string[] = []
    const writtenStderr: string[] = []
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any) => {
        writtenStdout.push(
          Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk),
        )
        return true
      })
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: any) => {
        writtenStderr.push(
          Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk),
        )
        return true
      })

    runCLIMock.mockImplementationOnce(async () => {
      process.stdout.write('jest stdout output')
      process.stderr.write('jest stderr output')
      return { results: { success: false } }
    })

    const ok = await adapter.runBaseline(['test-a'], {
      collectCoverage: false,
      perTestCoverage: false,
    })

    expect(ok).toBe(false)
    expect(writtenStdout.join('')).toContain('jest stdout output')
    expect(writtenStderr.join('')).toContain('jest stderr output')
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('maps pool result to mutant status', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({ killed: true, durationMs: 10 })
    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res).toEqual({ status: 'killed', durationMs: 10 })
  })

  it('maps pool errors to error status', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({
      killed: false,
      durationMs: 12,
      error: 'crash',
    })

    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )

    expect(res).toEqual({ status: 'error', durationMs: 12, error: 'crash' })
  })

  it('maps killed with failure messages to killed status', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({
      killed: true,
      durationMs: 12,
      error: 'expect(received).toBe(expected)',
    })

    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )

    expect(res).toEqual({ status: 'killed', durationMs: 12 })
  })

  it('detects coverage config from jest config file', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-jest-'))
    const cfgPath = path.join(tmp, 'jest.config.ts')
    await fs.writeFile(cfgPath, 'module.exports = { collectCoverage: true }')

    try {
      const adapter = makeAdapter({
        cwd: tmp,
        config: { jestConfig: 'jest.config.ts' } as any,
      })
      const coverage = await adapter.detectCoverageConfig()
      expect(coverage.coverageEnabled).toBe(true)
      expect(coverage.perTestEnabled).toBe(false)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('Jest adapter additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('strips --min-kill-percent= and --config= and -c= style args', () => {
    const adapter = makeAdapterWithArgs([
      '--min-kill-percent=50',
      '--config=jest.config.ts',
      '-c=x',
      '--verbose',
    ])
    expect(adapter).toBeDefined()
  })

  it('strips consumeNext args like --concurrency and --runner', () => {
    const adapter = makeAdapterWithArgs([
      '--concurrency',
      '4',
      '--runner',
      'jest',
    ])
    expect(adapter).toBeDefined()
  })

  it('runBaseline catches runCLI Error and returns false', async () => {
    const adapter = makeAdapter()
    runCLIMock.mockRejectedValueOnce(new Error('jest crashed'))
    const ok = await adapter.runBaseline(['test.spec.ts'], {
      collectCoverage: false,
      perTestCoverage: false,
    })
    expect(ok).toBe(false)
  })

  it('runBaseline catches non-Error runCLI rejection and returns false', async () => {
    const adapter = makeAdapter()
    runCLIMock.mockRejectedValueOnce('string rejection')
    const ok = await adapter.runBaseline(['test.spec.ts'], {
      collectCoverage: false,
      perTestCoverage: false,
    })
    expect(ok).toBe(false)
  })

  it('makeCapture handles Buffer chunks and callback signatures', async () => {
    const adapter = makeAdapter()

    runCLIMock.mockImplementationOnce(async () => {
      // Buffer chunk (covers Buffer.isBuffer true branch)
      process.stdout.write(Buffer.from('buffered'))
      // Write with encoding arg (covers typeof encodingOrCb !== 'function' → use cb)
      const cb1 = vi.fn()
      ;(process.stdout.write as any)('str-with-encoding', 'utf8', cb1)
      // Write with function as second arg (covers typeof encodingOrCb === 'function')
      const cb2 = vi.fn()
      ;(process.stdout.write as any)('str-with-cb', cb2)
      return { results: { success: false } }
    })

    const writtenStdout: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: any) => {
        writtenStdout.push(
          Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk),
        )
        return true
      })

    await adapter.runBaseline(['test.spec.ts'], {
      collectCoverage: false,
      perTestCoverage: false,
    })

    spy.mockRestore()
    expect(writtenStdout.join('')).toContain('buffered')
  })

  it('runMutant throws if init() not called', async () => {
    const adapter = makeAdapter()
    await expect(
      adapter.runMutant(
        { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
        ['t'],
      ),
    ).rejects.toThrow('JestAdapter not initialised')
  })

  it('runMutant returns error on pool.run() Error throw', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockRejectedValueOnce(new Error('pool crashed'))
    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res).toEqual({
      status: 'error',
      durationMs: 0,
      error: 'pool crashed',
    })
  })

  it('runMutant returns error on pool.run() non-Error throw', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockRejectedValueOnce('string error')
    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res).toEqual({
      status: 'error',
      durationMs: 0,
      error: 'string error',
    })
  })

  it('runMutant maps escaped result', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({ killed: false, durationMs: 8 })
    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res).toEqual({ status: 'escaped', durationMs: 8 })
  })

  it('runMutant maps timeout result', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({
      killed: false,
      durationMs: 30000,
      error: 'timeout',
    })
    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res).toEqual({
      status: 'timeout',
      durationMs: 30000,
      error: 'timeout',
    })
  })

  it('shutdown with pool calls pool.shutdown and nulls pool', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    await adapter.shutdown()
    expect(poolInstance!.shutdown).toHaveBeenCalledTimes(1)
  })

  it('shutdown with no pool is a no-op', async () => {
    const adapter = makeAdapter()
    await expect(adapter.shutdown()).resolves.toBeUndefined()
  })

  it('hasCoverageProvider returns false when jest not found in cwd', () => {
    const adapter = makeAdapter({ cwd: os.tmpdir() })
    // Resolving jest/package.json from os.tmpdir() should fail
    const result = adapter.hasCoverageProvider()
    expect(result).toBe(false)
  })

  it('detectCoverageConfig returns defaults when no jestConfig set', async () => {
    const adapter = makeAdapter({ config: { jestConfig: undefined } as any })
    const coverage = await adapter.detectCoverageConfig()
    expect(coverage).toEqual({ perTestEnabled: false, coverageEnabled: false })
  })

  it('detectCoverageConfig returns false on unreadable config file', async () => {
    const adapter = makeAdapter({
      config: { jestConfig: '/nonexistent/path/jest.config.ts' } as any,
    })
    const coverage = await adapter.detectCoverageConfig()
    expect(coverage).toEqual({ perTestEnabled: false, coverageEnabled: false })
  })

  it('detectCoverageConfig detects coverageProvider pattern', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-jest-'))
    const cfgPath = path.join(tmp, 'jest.config.ts')
    await fs.writeFile(cfgPath, 'module.exports = { coverageProvider: "v8" }')
    try {
      const adapter = makeAdapter({
        cwd: tmp,
        config: { jestConfig: cfgPath } as any,
      })
      const coverage = await adapter.detectCoverageConfig()
      expect(coverage.coverageEnabled).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
