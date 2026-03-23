import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createVitestAdapter, isCoverageRequestedInArgs } from '../adapter.js'

// Mock VitestPool to avoid spinning processes
var poolInstance: { init: any; run: any; shutdown: any } | null = null
var poolCtorOpts: any = null
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
  return { VitestPool: MockPool }
})

// Mock spawn for baseline runs
var spawnMock: ReturnType<typeof vi.fn>
vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    )
  spawnMock = vi.fn()
  return { ...actual, spawn: spawnMock }
})

function makeAdapter(
  opts: Partial<import('../../types.js').TestRunnerAdapterOptions> = {},
) {
  return createVitestAdapter({
    cwd: opts.cwd ?? process.cwd(),
    concurrency: opts.concurrency ?? 2,
    timeoutMs: opts.timeoutMs ?? 1000,
    config: opts.config ?? ({ vitestConfig: undefined } as any),
    cliArgs: opts.cliArgs ?? ['--changed'],
  })
}

describe('Vitest adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initialises pool with override concurrency', async () => {
    const adapter = makeAdapter()
    await adapter.init(5)
    expect(poolInstance?.init).toHaveBeenCalledTimes(1)
    expect(poolCtorOpts.concurrency).toBe(5)
  })

  it('maps pool result to mutant status', async () => {
    poolInstance = null
    poolCtorOpts = null
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({ killed: true, durationMs: 10 })
    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res).toEqual({ status: 'killed', durationMs: 10, error: undefined })
  })

  it('includes passingTests in escaped result', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({
      killed: false,
      durationMs: 8,
      passingTests: ['Suite > test one', 'Suite > test two'],
    })
    const res = await adapter.runMutant(
      { id: '2', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res.status).toBe('escaped')
    expect(res.passingTests).toEqual(['Suite > test one', 'Suite > test two'])
  })

  it('omits passingTests for killed mutants', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({
      killed: true,
      durationMs: 5,
      passingTests: ['should not appear'],
    })
    const res = await adapter.runMutant(
      { id: '3', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res.status).toBe('killed')
    expect(res.passingTests).toBeUndefined()
  })

  it('maps pool timeout errors to timeout status', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({
      killed: true,
      durationMs: 15,
      error: 'timeout',
    })

    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )

    expect(res).toEqual({ status: 'timeout', durationMs: 15, error: 'timeout' })
  })

  it('maps pool errors to error status', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockResolvedValueOnce({
      killed: true,
      durationMs: 12,
      error: 'crash',
    })

    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )

    expect(res).toEqual({ status: 'error', durationMs: 12, error: 'crash' })
  })

  it('returns error status on pool throw', async () => {
    const adapter = makeAdapter()
    await adapter.init()
    poolInstance!.run.mockRejectedValueOnce(new Error('boom'))
    const res = await adapter.runMutant(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    expect(res.status).toBe('error')
  })

  it('includes coverage args for baseline when requested', async () => {
    const adapter = makeAdapter({ cliArgs: [] })
    spawnMock.mockImplementationOnce(() => ({
      on: (evt: string, cb: (...a: any[]) => void) => {
        if (evt === 'exit') cb(0)
      },
    }))

    const ok = await adapter.runBaseline(['test-a'], {
      collectCoverage: true,
      perTestCoverage: true,
    })

    expect(ok).toBe(true)
    const call = spawnMock.mock.calls[0]
    const args = call[1] as string[]
    expect(args.join(' ')).toContain('--coverage.enabled=true')
    expect(args.join(' ')).toContain('--coverage.perTest=true')
  })

  it('disables coverage thresholds in baseline-with-coverage to prevent threshold failures', async () => {
    const adapter = makeAdapter({ cliArgs: [] })
    spawnMock.mockImplementationOnce(() => ({
      on: (evt: string, cb: (...a: any[]) => void) => {
        if (evt === 'exit') cb(0)
      },
    }))

    await adapter.runBaseline(['test-a'], {
      collectCoverage: true,
      perTestCoverage: false,
    })

    const args = spawnMock.mock.calls[0][1] as string[]
    const argStr = args.join(' ')
    expect(argStr).toContain('--coverage.thresholds.lines=0')
    expect(argStr).toContain('--coverage.thresholds.functions=0')
    expect(argStr).toContain('--coverage.thresholds.branches=0')
    expect(argStr).toContain('--coverage.thresholds.statements=0')
  })

  it('strips --shard= flag from vitest args', async () => {
    const adapter = makeAdapter({ cliArgs: ['--shard=1/4'] })
    spawnMock.mockImplementationOnce(() => ({
      on: (evt: string, cb: (...a: any[]) => void) => {
        if (evt === 'exit') cb(0)
      },
    }))
    await adapter.runBaseline(['test-a'], {
      collectCoverage: false,
      perTestCoverage: false,
    })
    const args = spawnMock.mock.calls[0][1] as string[]
    expect(args.join(' ')).not.toContain('--shard')
  })

  it('strips --report flag and value from vitest args', async () => {
    const adapter = makeAdapter({ cliArgs: ['--report', 'json'] })
    spawnMock.mockImplementationOnce(() => ({
      on: (evt: string, cb: (...a: any[]) => void) => {
        if (evt === 'exit') cb(0)
      },
    }))
    await adapter.runBaseline(['test-a'], {
      collectCoverage: false,
      perTestCoverage: false,
    })
    const args = spawnMock.mock.calls[0][1] as string[]
    expect(args.join(' ')).not.toContain('--report')
    expect(args.join(' ')).not.toContain('json')
  })

  it('does not write captured output to stdout/stderr on success', async () => {
    const adapter = makeAdapter({ cliArgs: [] })
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const listeners: Record<string, ((...a: any[]) => void)[]> = {}
    spawnMock.mockImplementationOnce(() => ({
      stdout: {
        on: (evt: string, cb: (...a: any[]) => void) => {
          ;(listeners[`stdout:${evt}`] ??= []).push(cb)
        },
      },
      stderr: {
        on: (evt: string, cb: (...a: any[]) => void) => {
          ;(listeners[`stderr:${evt}`] ??= []).push(cb)
        },
      },
      on: (evt: string, cb: (...a: any[]) => void) => {
        if (evt === 'exit') cb(0)
      },
    }))

    const ok = await adapter.runBaseline(['test-a'], {
      collectCoverage: false,
      perTestCoverage: false,
    })

    expect(ok).toBe(true)
    expect(stdoutWrite).not.toHaveBeenCalled()
    expect(stderrWrite).not.toHaveBeenCalled()
    stdoutWrite.mockRestore()
    stderrWrite.mockRestore()
  })

  it('replays captured output to stdout/stderr on failure', async () => {
    const adapter = makeAdapter({ cliArgs: [] })
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const stdoutListeners: ((chunk: Buffer) => void)[] = []
    const stderrListeners: ((chunk: Buffer) => void)[] = []
    spawnMock.mockImplementationOnce(() => ({
      stdout: {
        on: (evt: string, cb: (chunk: Buffer) => void) => {
          if (evt === 'data') stdoutListeners.push(cb)
        },
      },
      stderr: {
        on: (evt: string, cb: (chunk: Buffer) => void) => {
          if (evt === 'data') stderrListeners.push(cb)
        },
      },
      on: (evt: string, cb: (...a: any[]) => void) => {
        if (evt === 'exit') {
          stdoutListeners.forEach((l) => l(Buffer.from('stdout output')))
          stderrListeners.forEach((l) => l(Buffer.from('stderr output')))
          cb(1)
        }
      },
    }))

    const ok = await adapter.runBaseline(['test-a'], {
      collectCoverage: false,
      perTestCoverage: false,
    })

    expect(ok).toBe(false)
    expect(stdoutWrite).toHaveBeenCalledWith(Buffer.from('stdout output'))
    expect(stderrWrite).toHaveBeenCalledWith(Buffer.from('stderr output'))
    stdoutWrite.mockRestore()
    stderrWrite.mockRestore()
  })

  it('detects coverage config from vitest config file', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-vitest-'))
    const cfgPath = path.join(tmp, 'vitest.config.ts')
    await fs.writeFile(
      cfgPath,
      'export default { coverage: { enabled: true }, test: { coverage: { perTest: true } } }',
    )

    try {
      const adapter = makeAdapter({
        cwd: tmp,
        config: { vitestConfig: 'vitest.config.ts' } as any,
      })
      const coverage = await adapter.detectCoverageConfig()
      expect(coverage.coverageEnabled).toBe(true)
      expect(coverage.perTestEnabled).toBe(true)
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('hasCoverageProvider', () => {
  it('returns true when @vitest/coverage-v8 is resolvable', () => {
    const adapter = makeAdapter({ cwd: process.cwd() })
    // coverage-v8 is installed as a devDependency, so this must resolve
    expect(adapter.hasCoverageProvider()).toBe(true)
  })

  it('returns false when neither provider is resolvable', () => {
    const adapter = makeAdapter({ cwd: '/tmp' })
    expect(adapter.hasCoverageProvider()).toBe(false)
  })

  it('returns true when @vitest/coverage-istanbul is resolvable', () => {
    const adapter = makeAdapter({ cwd: process.cwd() })
    const origResolve = require.resolve
    const resolveStub = vi
      .spyOn(require, 'resolve')
      .mockImplementation((id: string, opts?: any) => {
        if (String(id).includes('coverage-v8')) throw new Error('not found')
        if (String(id).includes('coverage-istanbul')) return '/fake/path'
        return origResolve(id, opts)
      })
    expect(adapter.hasCoverageProvider()).toBe(true)
    resolveStub.mockRestore()
  })
})

describe('isCoverageRequestedInArgs', () => {
  it('detects enabled coverage flags', () => {
    expect(isCoverageRequestedInArgs(['--coverage'])).toBe(true)
    expect(isCoverageRequestedInArgs(['--coverage.enabled=true'])).toBe(true)
    expect(isCoverageRequestedInArgs(['--coverage.enabled=false'])).toBe(false)
    expect(isCoverageRequestedInArgs(['--no-coverage'])).toBe(false)
  })
})
