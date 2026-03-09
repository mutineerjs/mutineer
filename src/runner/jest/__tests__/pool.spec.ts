import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JestPool, runWithJestPool } from '../pool.js'
import type { MutantPayload } from '../../../types/mutant.js'

// We'll use the createWorker option to inject mock workers instead of forking processes

function makeMockWorker(id: string) {
  let readyResolve: (() => void) | null = null
  const worker: any = {
    id,
    _ready: true,
    _busy: false,
    _mockResult: { killed: true, durationMs: 10 },
    on: vi.fn(),
    once: vi.fn(),
    isReady: vi.fn(() => worker._ready),
    isBusy: vi.fn(() => worker._busy),
    start: vi.fn(async () => {
      // Simulate worker startup
    }),
    run: vi.fn(async () => worker._mockResult),
    shutdown: vi.fn(async () => {}),
    kill: vi.fn(),
    emit: vi.fn(),
  }
  return worker
}

const dummyMutant: MutantPayload = {
  id: 'test#1',
  name: 'flipEQ',
  file: '/src/foo.ts',
  code: 'mutated',
  line: 1,
  col: 0,
}

describe('JestPool', () => {
  it('throws if run is called before init', async () => {
    const pool = new JestPool({ cwd: '/tmp', concurrency: 1 })
    await expect(pool.run(dummyMutant, ['test.ts'])).rejects.toThrow(
      'Pool not initialised',
    )
  })

  it('initialises with the specified concurrency', async () => {
    const workers: any[] = []
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 2,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        workers.push(w)
        return w
      },
    })

    await pool.init()
    expect(workers).toHaveLength(2)
    expect(workers[0].start).toHaveBeenCalled()
    expect(workers[1].start).toHaveBeenCalled()
  })

  it('does not re-initialise if already initialised', async () => {
    const workers: any[] = []
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        workers.push(w)
        return w
      },
    })

    await pool.init()
    await pool.init() // second call should be no-op
    expect(workers).toHaveLength(1)
  })

  it('runs a mutant via a worker', async () => {
    const workers: any[] = []
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        w._mockResult = { killed: true, durationMs: 50 }
        workers.push(w)
        return w
      },
    })

    await pool.init()
    const result = await pool.run(dummyMutant, ['test.ts'])
    expect(result.killed).toBe(true)
    expect(result.durationMs).toBe(50)
  })

  it('shuts down all workers', async () => {
    const workers: any[] = []
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 2,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        workers.push(w)
        return w
      },
    })

    await pool.init()
    await pool.shutdown()
    for (const w of workers) {
      expect(w.shutdown).toHaveBeenCalled()
    }
  })

  it('throws if run is called after shutdown', async () => {
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => makeMockWorker(id),
    })

    await pool.init()
    await pool.shutdown()
    // After shutdown, initialised is set to false, so "not initialised" check fires first
    await expect(pool.run(dummyMutant, ['test.ts'])).rejects.toThrow(
      'Pool not initialised',
    )
  })

  it('does not double-shutdown', async () => {
    const workers: any[] = []
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        workers.push(w)
        return w
      },
    })

    await pool.init()
    await pool.shutdown()
    await pool.shutdown() // should not throw
    expect(workers[0].shutdown).toHaveBeenCalledTimes(1)
  })
})

describe('runWithJestPool', () => {
  it('maps killed result correctly', async () => {
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        w._mockResult = { killed: true, durationMs: 10 }
        return w
      },
    })
    await pool.init()

    const result = await runWithJestPool(pool, dummyMutant, ['test.ts'])
    expect(result.status).toBe('killed')
    expect(result.durationMs).toBe(10)
    await pool.shutdown()
  })

  it('maps escaped result correctly', async () => {
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        w._mockResult = { killed: false, durationMs: 20 }
        return w
      },
    })
    await pool.init()

    const result = await runWithJestPool(pool, dummyMutant, ['test.ts'])
    expect(result.status).toBe('escaped')
    await pool.shutdown()
  })

  it('maps timeout error correctly', async () => {
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        w._mockResult = { killed: true, durationMs: 5000, error: 'timeout' }
        return w
      },
    })
    await pool.init()

    const result = await runWithJestPool(pool, dummyMutant, ['test.ts'])
    expect(result.status).toBe('timeout')
    expect(result.error).toBe('timeout')
    await pool.shutdown()
  })

  it('maps non-timeout error with !killed to error status', async () => {
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        w._mockResult = { killed: false, durationMs: 10, error: 'crash' }
        return w
      },
    })
    await pool.init()

    const result = await runWithJestPool(pool, dummyMutant, ['test.ts'])
    expect(result.status).toBe('error')
    expect(result.error).toBe('crash')
    await pool.shutdown()
  })

  it('handles pool.run throwing an error', async () => {
    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        const w = makeMockWorker(id)
        w.run = vi.fn().mockRejectedValue(new Error('pool exploded'))
        return w
      },
    })
    await pool.init()

    const result = await runWithJestPool(pool, dummyMutant, ['test.ts'])
    expect(result.status).toBe('error')
    expect(result.error).toBe('pool exploded')
    expect(result.durationMs).toBe(0)
    await pool.shutdown()
  })
})
