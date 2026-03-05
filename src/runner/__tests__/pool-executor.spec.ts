import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { executePool } from '../pool-executor.js'
import type { TestRunnerAdapter } from '../types.js'
import type { MutantTask } from '../tasks.js'
import type { MutantCacheEntry } from '../../types/mutant.js'

function makeAdapter(
  overrides: Partial<TestRunnerAdapter> = {},
): TestRunnerAdapter {
  return {
    name: 'vitest',
    init: vi.fn().mockResolvedValue(undefined),
    runBaseline: vi.fn().mockResolvedValue(true),
    runMutant: vi
      .fn()
      .mockResolvedValue({ status: 'killed', durationMs: 10 }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    hasCoverageProvider: vi.fn().mockReturnValue(false),
    detectCoverageConfig: vi
      .fn()
      .mockResolvedValue({ perTestEnabled: false, coverageEnabled: false }),
    ...overrides,
  }
}

function makeTask(overrides: Partial<MutantTask> = {}): MutantTask {
  return {
    v: {
      id: 'file.ts#0',
      name: 'flipStrictEQ',
      file: '/src/file.ts',
      code: 'const x = a !== b',
      line: 1,
      col: 10,
      tests: ['/tests/file.test.ts'],
    },
    tests: ['/tests/file.test.ts'],
    key: 'test-key-1',
    ...overrides,
  }
}

describe('executePool', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-pool-'))
    process.exitCode = undefined
  })

  afterEach(async () => {
    process.exitCode = undefined
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('initializes adapter with correct worker count', async () => {
    const adapter = makeAdapter()
    const cache: Record<string, MutantCacheEntry> = {}
    const tasks = [makeTask()]

    await executePool({
      tasks,
      adapter,
      cache,
      concurrency: 4,
      progressMode: 'list',
      cwd: tmpDir,
    })

    // workerCount = min(concurrency, tasks.length) = min(4, 1) = 1
    expect(adapter.init).toHaveBeenCalledWith(1)
  })

  it('runs mutants through the adapter and populates cache', async () => {
    const adapter = makeAdapter()
    const cache: Record<string, MutantCacheEntry> = {}
    const task = makeTask({ key: 'unique-key' })

    await executePool({
      tasks: [task],
      adapter,
      cache,
      concurrency: 1,
      progressMode: 'list',
      cwd: tmpDir,
    })

    expect(adapter.runMutant).toHaveBeenCalledTimes(1)
    expect(cache['unique-key']).toBeDefined()
    expect(cache['unique-key'].status).toBe('killed')
  })

  it('skips cached tasks without calling runMutant', async () => {
    const adapter = makeAdapter()
    const cache: Record<string, MutantCacheEntry> = {
      'cached-key': {
        status: 'killed',
        file: '/src/file.ts',
        line: 1,
        col: 10,
        mutator: 'flipStrictEQ',
      },
    }

    await executePool({
      tasks: [makeTask({ key: 'cached-key' })],
      adapter,
      cache,
      concurrency: 1,
      progressMode: 'list',
      cwd: tmpDir,
    })

    expect(adapter.runMutant).not.toHaveBeenCalled()
  })

  it('marks tasks with no tests as skipped', async () => {
    const adapter = makeAdapter()
    const cache: Record<string, MutantCacheEntry> = {}
    const task = makeTask({ tests: [], key: 'no-tests-key' })

    await executePool({
      tasks: [task],
      adapter,
      cache,
      concurrency: 1,
      progressMode: 'list',
      cwd: tmpDir,
    })

    expect(adapter.runMutant).not.toHaveBeenCalled()
    expect(cache['no-tests-key'].status).toBe('skipped')
  })

  it('processes multiple tasks', async () => {
    const adapter = makeAdapter()
    const cache: Record<string, MutantCacheEntry> = {}
    const tasks = [
      makeTask({ key: 'key-1' }),
      makeTask({ key: 'key-2' }),
      makeTask({ key: 'key-3' }),
    ]

    await executePool({
      tasks,
      adapter,
      cache,
      concurrency: 2,
      progressMode: 'list',
      cwd: tmpDir,
    })

    expect(adapter.runMutant).toHaveBeenCalledTimes(3)
    expect(Object.keys(cache)).toHaveLength(3)
  })

  it('shuts down adapter after completion', async () => {
    const adapter = makeAdapter()
    const cache: Record<string, MutantCacheEntry> = {}

    await executePool({
      tasks: [makeTask()],
      adapter,
      cache,
      concurrency: 1,
      progressMode: 'list',
      cwd: tmpDir,
    })

    expect(adapter.shutdown).toHaveBeenCalledTimes(1)
  })

  it('sets exitCode when kill rate is below threshold', async () => {
    const adapter = makeAdapter({
      runMutant: vi
        .fn()
        .mockResolvedValue({ status: 'escaped', durationMs: 10 }),
    })
    const cache: Record<string, MutantCacheEntry> = {}

    await executePool({
      tasks: [makeTask()],
      adapter,
      cache,
      concurrency: 1,
      progressMode: 'list',
      minKillPercent: 80,
      cwd: tmpDir,
    })

    expect(process.exitCode).toBe(1)
  })

  it('does not set exitCode when kill rate meets threshold', async () => {
    const adapter = makeAdapter({
      runMutant: vi
        .fn()
        .mockResolvedValue({ status: 'killed', durationMs: 10 }),
    })
    const cache: Record<string, MutantCacheEntry> = {}

    await executePool({
      tasks: [makeTask()],
      adapter,
      cache,
      concurrency: 1,
      progressMode: 'list',
      minKillPercent: 80,
      cwd: tmpDir,
    })

    expect(process.exitCode).toBeUndefined()
  })

  it('saves cache to disk after completion', async () => {
    const adapter = makeAdapter()
    const cache: Record<string, MutantCacheEntry> = {}

    await executePool({
      tasks: [makeTask({ key: 'persist-key' })],
      adapter,
      cache,
      concurrency: 1,
      progressMode: 'list',
      cwd: tmpDir,
    })

    const cacheFile = path.join(tmpDir, '.mutate-cache.json')
    const content = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
    expect(content['persist-key']).toBeDefined()
  })

  it('handles adapter errors gracefully and still shuts down', async () => {
    const adapter = makeAdapter({
      runMutant: vi.fn().mockRejectedValue(new Error('adapter failure')),
    })
    const cache: Record<string, MutantCacheEntry> = {}

    await expect(
      executePool({
        tasks: [makeTask()],
        adapter,
        cache,
        concurrency: 1,
        progressMode: 'list',
        cwd: tmpDir,
      }),
    ).rejects.toThrow('adapter failure')

    expect(adapter.shutdown).toHaveBeenCalledTimes(1)
  })
})
