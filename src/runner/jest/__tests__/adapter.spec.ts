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
