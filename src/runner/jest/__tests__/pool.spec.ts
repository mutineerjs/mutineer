import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import * as childProcess from 'node:child_process'
import { JestPool, runWithJestPool } from '../pool.js'
import type { MutantPayload } from '../../../types/mutant.js'

vi.mock('node:child_process', () => ({ fork: vi.fn() }))

interface MockProc extends EventEmitter {
  stderr: EventEmitter
  send: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  pid?: number
}

// We'll use the createWorker option to inject mock workers instead of forking processes

function makeMockWorker(id: string) {
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

describe('JestWorker via JestPool (real fork mock)', () => {
  const mockProcesses: MockProc[] = []

  beforeEach(() => {
    mockProcesses.length = 0
    vi.mocked(childProcess.fork).mockImplementation(() => {
      const proc = new EventEmitter() as MockProc
      proc.stderr = new EventEmitter()
      proc.send = vi.fn()
      proc.kill = vi.fn()
      proc.pid = 12345
      mockProcesses.push(proc)
      return proc as unknown as childProcess.ChildProcess
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function initWorkerPool(
    opts: { cwd?: string; jestConfig?: string } = {},
  ) {
    const pool = new JestPool({
      cwd: opts.cwd ?? '/test',
      concurrency: 1,
      jestConfig: opts.jestConfig,
    })
    const initP = pool.init()
    await new Promise((r) => setImmediate(r))
    mockProcesses[0].emit('message', { type: 'ready' })
    await initP
    return pool
  }

  async function shutdownWorkerPool(pool: JestPool) {
    const p = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    mockProcesses[mockProcesses.length - 1].emit('message', {
      type: 'shutdown',
    })
    await p
  }

  it('starts worker and emits ready via IPC', async () => {
    const pool = await initWorkerPool()
    expect(mockProcesses).toHaveLength(1)
    expect(mockProcesses[0].send).toBeDefined()
    await shutdownWorkerPool(pool)
  })

  it('passes jestConfig to env', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined
    vi.mocked(childProcess.fork).mockImplementationOnce(
      (_script, _args, opts) => {
        capturedEnv = (opts as any)?.env
        const proc = new EventEmitter() as MockProc
        proc.stderr = new EventEmitter()
        proc.send = vi.fn()
        proc.kill = vi.fn()
        proc.pid = 99
        mockProcesses.push(proc)
        return proc as unknown as childProcess.ChildProcess
      },
    )

    const pool = new JestPool({
      cwd: '/proj',
      concurrency: 1,
      jestConfig: 'jest.config.ts',
    })
    const initP = pool.init()
    await new Promise((r) => setImmediate(r))
    expect(capturedEnv?.MUTINEER_JEST_CONFIG).toBe('jest.config.ts')
    mockProcesses[0].emit('message', { type: 'ready' })
    await initP
    await shutdownWorkerPool(pool)
  })

  it('handleMessage: result with pending task resolves run()', async () => {
    const pool = await initWorkerPool()

    const runP = pool.run(dummyMutant, ['t'])
    await new Promise((r) => setImmediate(r))

    mockProcesses[0].emit('message', {
      type: 'result',
      killed: true,
      durationMs: 42,
    })
    const result = await runP
    expect(result.killed).toBe(true)
    expect(result.durationMs).toBe(42)

    await shutdownWorkerPool(pool)
  })

  it('handleMessage: result with nullish killed/durationMs uses defaults', async () => {
    const pool = await initWorkerPool()

    const runP = pool.run(dummyMutant, ['t'])
    await new Promise((r) => setImmediate(r))

    mockProcesses[0].emit('message', { type: 'result' })
    const result = await runP
    expect(result.killed).toBe(true) // ?? true default
    expect(result.durationMs).toBe(0) // ?? 0 default

    await shutdownWorkerPool(pool)
  })

  it('handleMessage: result when no pending task is silently ignored', async () => {
    const pool = await initWorkerPool()
    mockProcesses[0].emit('message', {
      type: 'result',
      killed: true,
      durationMs: 5,
    })
    expect(true).toBe(true)
    await shutdownWorkerPool(pool)
  })

  it('handleMessage: shutdown type triggers shutdown resolution', async () => {
    const pool = await initWorkerPool()
    const shutdownP = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    mockProcesses[0].emit('message', { type: 'shutdown' })
    await shutdownP
    expect(true).toBe(true)
  })

  it('process error event triggers handleExit and rejects pending run', async () => {
    const pool = await initWorkerPool()

    const runP = pool.run(dummyMutant, ['t'])
    await new Promise((r) => setImmediate(r))

    mockProcesses[0].emit('error', new Error('ENOENT'))
    await expect(runP).rejects.toThrow('Worker exited unexpectedly')
  })

  it('process exit event with code triggers handleExit', async () => {
    const pool = await initWorkerPool()

    const runP = pool.run(dummyMutant, ['t'])
    await new Promise((r) => setImmediate(r))

    mockProcesses[0].emit('exit', 1)
    await expect(runP).rejects.toThrow('Worker exited unexpectedly with code 1')
  })

  it('process exit with null code uses ?? 1 fallback', async () => {
    const pool = await initWorkerPool()

    const runP = pool.run(dummyMutant, ['t'])
    await new Promise((r) => setImmediate(r))

    mockProcesses[0].emit('exit', null)
    await expect(runP).rejects.toThrow('Worker exited unexpectedly with code 1')
  })

  it('handleExit during shutdown skips pending rejection', async () => {
    const pool = await initWorkerPool()

    const shutdownP = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    // emit exit while shutting down — handleExit called with shuttingDown=true
    mockProcesses[0].emit('exit', 0)
    // emit shutdown to resolve
    mockProcesses[0].emit('message', { type: 'shutdown' })
    await shutdownP
    expect(true).toBe(true)
  })

  it('pool.run() throws when pool is shutting down', async () => {
    const pool = await initWorkerPool()
    pool.shutdown() // don't await
    await expect(pool.run(dummyMutant, ['t'])).rejects.toThrow(
      'Pool is shutting down',
    )
  })

  it('acquireWorker queues second run when single worker is busy', async () => {
    const pool = await initWorkerPool()

    const [run1, run2] = [
      pool.run(dummyMutant, ['t']),
      pool.run({ ...dummyMutant, id: '2' }, ['t']),
    ]

    await new Promise((r) => setImmediate(r))

    // resolve first run
    mockProcesses[0].emit('message', {
      type: 'result',
      killed: true,
      durationMs: 5,
    })
    await new Promise((r) => setImmediate(r))

    // resolve second run
    mockProcesses[0].emit('message', {
      type: 'result',
      killed: false,
      durationMs: 3,
    })

    const [r1, r2] = await Promise.all([run1, run2])
    expect(r1.killed).toBe(true)
    expect(r2.killed).toBe(false)

    await shutdownWorkerPool(pool)
  })

  it('releaseWorker skips non-ready worker', async () => {
    // Use createWorker mock where worker becomes not-ready after run
    let workerReady = true
    const pool = new JestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const w = new EventEmitter() as any
        w.id = id
        w.start = vi.fn().mockResolvedValue(undefined)
        w.isReady = vi.fn(() => workerReady)
        w.isBusy = vi.fn().mockReturnValue(false)
        w.run = vi.fn().mockImplementation(async () => {
          workerReady = false
          return { killed: true, durationMs: 1 }
        })
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        return w
      },
    })
    await pool.init()
    const result = await pool.run(dummyMutant, ['t'])
    expect(result.killed).toBe(true)
    await pool.shutdown()
  })

  it('runWithJestPool maps non-Error exception to error status', async () => {
    const pool = new JestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const w = new EventEmitter() as any
        w.id = id
        w.start = vi.fn().mockResolvedValue(undefined)
        w.isReady = vi.fn().mockReturnValue(true)
        w.isBusy = vi.fn().mockReturnValue(false)
        w.run = vi.fn().mockRejectedValue('string error')
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        return w
      },
    })
    await pool.init()
    const result = await runWithJestPool(pool, dummyMutant, ['t'])
    expect(result.status).toBe('error')
    expect(result.error).toBe('string error')
    await pool.shutdown()
  })
})

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

  it('does not give a dead worker to a waiting task after timeout', async () => {
    let callCount = 0
    const allWorkers: any[] = []

    const pool = new JestPool({
      cwd: '/tmp',
      concurrency: 1,
      createWorker: (id) => {
        callCount++
        const workerNum = callCount
        const worker = new EventEmitter() as any
        worker.id = id
        worker._ready = true
        worker.start = vi.fn().mockResolvedValue(undefined)
        worker.isReady = vi.fn(() => worker._ready)
        worker.isBusy = vi.fn().mockReturnValue(false)
        worker.run = vi.fn().mockImplementation(async () => {
          if (workerNum === 1) {
            worker._ready = false
            Promise.resolve().then(() => worker.emit('exit'))
            return { killed: false, durationMs: 5000, error: 'timeout' }
          }
          return { killed: true, durationMs: 42 }
        })
        worker.shutdown = vi.fn().mockResolvedValue(undefined)
        worker.kill = vi.fn()
        allWorkers.push(worker)
        return worker
      },
    })

    await pool.init()

    const [result1, result2] = await Promise.all([
      pool.run(dummyMutant, ['a.spec.ts']),
      pool.run({ ...dummyMutant, id: 'test#2' }, ['b.spec.ts']),
    ])

    expect(result1).toMatchObject({ error: 'timeout' })
    expect(result2).toMatchObject({ killed: true })
    expect(allWorkers).toHaveLength(2)
    expect(allWorkers[1].run).toHaveBeenCalled()
    await pool.shutdown()
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
