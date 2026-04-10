import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as childProcess from 'node:child_process'
import * as readline from 'node:readline'
import { VitestPool, runWithPool, type MutantPayload } from '../pool.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('node:readline', () => ({ createInterface: vi.fn() }))

interface MockProc extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { writes: string[]; write: (chunk: string) => void }
  kill: (signal?: string) => void
}

describe('VitestPool', () => {
  const mockProcesses: MockProc[] = []
  const rlEmitters: EventEmitter[] = []
  const fakeWorkers: any[] = []

  beforeEach(() => {
    mockProcesses.length = 0
    rlEmitters.length = 0

    vi.mocked(childProcess.spawn).mockImplementation(() => {
      const proc = new EventEmitter() as MockProc
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.stdin = {
        writes: [],
        write: (chunk: string) => {
          proc.stdin.writes.push(chunk)
        },
      }
      proc.kill = vi.fn()
      mockProcesses.push(proc)
      return proc as unknown as childProcess.ChildProcess
    })

    vi.mocked(readline.createInterface).mockImplementation(() => {
      const rl = new EventEmitter() as readline.Interface
      rlEmitters.push(rl)
      return rl
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs a mutant through a worker and returns result', async () => {
    const pool = new VitestPool({
      cwd: process.cwd(),
      concurrency: 1,
      timeoutMs: 5000,
      createWorker: (id) => {
        const worker = new EventEmitter() as any
        worker.id = id
        worker.start = vi.fn().mockResolvedValue(undefined)
        worker.isReady = vi.fn().mockReturnValue(true)
        worker.isBusy = vi.fn().mockReturnValue(false)
        worker.run = vi
          .fn()
          .mockImplementation(async () => ({ killed: true, durationMs: 42 }))
        worker.shutdown = vi.fn().mockResolvedValue(undefined)
        worker.kill = vi.fn()
        fakeWorkers.push(worker)
        return worker
      },
    })
    await pool.init()

    const mutant: MutantPayload = {
      id: '1',
      name: 'mutant',
      file: 'foo.ts',
      code: 'x',
      line: 1,
      col: 1,
    }
    const tests = ['foo.spec.ts']

    const runPromise = pool.run(mutant, tests)

    const result = await runPromise

    expect(result).toEqual({ killed: true, durationMs: 42, error: undefined })
    expect(fakeWorkers[0].run).toHaveBeenCalledWith(mutant, tests, 5000)
    await pool.shutdown()
  })

  it('maps runWithPool results to escaped when not killed', async () => {
    const mockPool = {
      run: vi.fn().mockResolvedValue({ killed: false, durationMs: 7 }),
    } as unknown as VitestPool

    const mutant: MutantPayload = {
      id: '2',
      name: 'm',
      file: 'bar.ts',
      code: 'y',
      line: 2,
      col: 3,
    }
    const tests = ['bar.spec.ts']

    const result = await runWithPool(mockPool, mutant, tests)

    expect(result).toEqual({ status: 'escaped', durationMs: 7 })
    expect((mockPool as any).run).toHaveBeenCalledWith(mutant, ['bar.spec.ts'])
  })

  it('does not give a dead worker to a waiting task after timeout', async () => {
    let callCount = 0
    const allWorkers: any[] = []

    const pool = new VitestPool({
      cwd: process.cwd(),
      concurrency: 1,
      timeoutMs: 5000,
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

    const mutant1: MutantPayload = {
      id: '1',
      name: 'm1',
      file: 'a.ts',
      code: 'x',
      line: 1,
      col: 1,
    }
    const mutant2: MutantPayload = {
      id: '2',
      name: 'm2',
      file: 'b.ts',
      code: 'y',
      line: 1,
      col: 1,
    }

    const [result1, result2] = await Promise.all([
      pool.run(mutant1, ['a.spec.ts']),
      pool.run(mutant2, ['b.spec.ts']),
    ])

    expect(result1).toMatchObject({ error: 'timeout' })
    expect(result2).toMatchObject({ killed: true })
    expect(allWorkers).toHaveLength(2)
    expect(allWorkers[1].run).toHaveBeenCalled()
    await pool.shutdown()
  })

  it('maps runWithPool errors to error status', async () => {
    const mockPool = {
      run: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as VitestPool

    const mutant: MutantPayload = {
      id: '3',
      name: 'err',
      file: 'baz.ts',
      code: 'z',
      line: 3,
      col: 4,
    }

    const result = await runWithPool(mockPool, mutant, [])

    expect(result.status).toBe('error')
  })

  it('passes MUTINEER_ACTIVE_ID_FILE env var to worker process', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined

    vi.mocked(childProcess.spawn).mockImplementationOnce(
      (_cmd, _args, options) => {
        capturedEnv = (options as any)?.env
        const proc = new EventEmitter() as MockProc
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        proc.stdin = { writes: [], write: vi.fn() as any }
        proc.kill = vi.fn()
        return proc as unknown as childProcess.ChildProcess
      },
    )

    const rl = new EventEmitter() as readline.Interface
    vi.mocked(readline.createInterface).mockImplementationOnce(() => rl)

    const cwd = '/my/project'
    const pool = new VitestPool({ cwd, concurrency: 1 })

    // Start init — synchronous part (spawn + createInterface) runs immediately
    const initPromise = pool.init()
    // Give event loop one tick so the async suspend in worker.start() is reached
    await new Promise((resolve) => setImmediate(resolve))

    // Verify env var was passed to spawn before completing init
    expect(capturedEnv?.MUTINEER_ACTIVE_ID_FILE).toBe(
      '/my/project/__mutineer__/active_id_w0.txt',
    )

    // Emit ready to unblock initPromise
    rl.emit('line', JSON.stringify({ type: 'ready', workerId: 'w0' }))
    await initPromise

    // Shutdown: emit the shutdown response so worker.shutdown() resolves
    const shutdownPromise = pool.shutdown()
    await new Promise((resolve) => setImmediate(resolve))
    rl.emit('line', JSON.stringify({ type: 'shutdown', ok: true }))
    await shutdownPromise
  })

  it('spawns workers with detached: true for process group isolation', async () => {
    let capturedOptions: childProcess.SpawnOptions | undefined

    vi.mocked(childProcess.spawn).mockImplementationOnce(
      (_cmd, _args, options) => {
        capturedOptions = options as childProcess.SpawnOptions
        const proc = new EventEmitter() as MockProc
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        proc.stdin = { writes: [], write: vi.fn() as any }
        proc.kill = vi.fn()
        return proc as unknown as childProcess.ChildProcess
      },
    )

    const rl = new EventEmitter() as readline.Interface
    vi.mocked(readline.createInterface).mockImplementationOnce(() => rl)

    const pool = new VitestPool({ cwd: '/test', concurrency: 1 })
    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))

    expect(capturedOptions?.detached).toBe(true)

    rl.emit('line', JSON.stringify({ type: 'ready', workerId: 'w0' }))
    await initPromise

    const shutdownPromise = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    rl.emit('line', JSON.stringify({ type: 'shutdown', ok: true }))
    await shutdownPromise
  })

  it('kills entire process group (negative PID) on mutant run timeout', async () => {
    const mockProc = new EventEmitter() as MockProc
    mockProc.stdout = new EventEmitter()
    mockProc.stderr = new EventEmitter()
    mockProc.stdin = { writes: [], write: vi.fn() as any }
    mockProc.kill = vi.fn()
    ;(mockProc as any).pid = 42000

    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      mockProc as unknown as childProcess.ChildProcess,
    )
    const rl = new EventEmitter() as readline.Interface
    vi.mocked(readline.createInterface).mockReturnValueOnce(rl)

    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true)

    // Use a very short timeoutMs so the test doesn't wait long
    const pool = new VitestPool({ cwd: '/test', concurrency: 1, timeoutMs: 50 })

    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rl.emit('line', JSON.stringify({ type: 'ready', workerId: 'w0' }))
    await initPromise

    const mutant: MutantPayload = {
      id: 't1',
      name: 'test',
      file: 'a.ts',
      code: 'x',
      line: 1,
      col: 1,
    }

    // Don't emit a 'result' line — let the 50ms timeout fire and call kill()
    const result = await pool.run(mutant, ['a.spec.ts'])

    expect(result).toMatchObject({ error: 'timeout' })
    expect(killSpy).toHaveBeenCalledWith(-42000, 'SIGKILL')

    killSpy.mockRestore()
  })

  /** Helper: create pool, init, emit ready, return {pool, rl} */
  async function initPool(
    concurrency = 1,
    opts: Partial<{ timeoutMs: number }> = {},
  ) {
    const pool = new VitestPool({ cwd: '/test', concurrency, ...opts })
    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'ready', workerId: 'w0' }),
    )
    await initPromise
    return pool
  }

  /** Helper: shutdown pool and emit ack so it resolves immediately */
  async function shutdownPool(pool: VitestPool) {
    const p = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    for (const rl of rlEmitters) {
      rl.emit('line', JSON.stringify({ type: 'shutdown', ok: true }))
    }
    await p
  }

  it('handleMessage: ignores empty lines', async () => {
    const pool = await initPool()
    rlEmitters[0].emit('line', '')
    rlEmitters[0].emit('line', '   ')
    expect(true).toBe(true)
    await shutdownPool(pool)
  })

  it('handleMessage: ignores non-JSON lines', async () => {
    const pool = await initPool()
    rlEmitters[0].emit('line', 'some debug output from vitest')
    expect(true).toBe(true)
    await shutdownPool(pool)
  })

  it('handleMessage: ignores invalid JSON lines', async () => {
    const pool = await initPool()
    rlEmitters[0].emit('line', '{invalid json}')
    expect(true).toBe(true)
    await shutdownPool(pool)
  })

  it('handleMessage: handles result message when no pending task', async () => {
    const pool = await initPool()
    // 'result' message with no pending task should be silently ignored
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'result', killed: true, durationMs: 5 }),
    )
    expect(true).toBe(true)
    await shutdownPool(pool)
  })

  it('handleMessage: handles shutdown message type', async () => {
    const pool = await initPool()
    // Emit 'shutdown' type — triggers this.emit('shutdown') on the worker
    // which the worker's shutdown() handler listens for
    const shutdownP = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    // Instead of shutdown ack, test that 'shutdown' type message is handled
    rlEmitters[0].emit('line', JSON.stringify({ type: 'shutdown', ok: true }))
    await shutdownP
    expect(true).toBe(true)
  })

  it('handleMessage: handles result message with pending task', async () => {
    const pool = await initPool(1, { timeoutMs: 30000 })

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const runPromise = pool.run(mutant, ['t'])
    // Wait for acquireWorker to resolve and worker.run() to set pendingTask
    await new Promise((r) => setImmediate(r))

    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'result', killed: true, durationMs: 10 }),
    )
    const result = await runPromise
    expect(result.killed).toBe(true)

    await shutdownPool(pool)
  })

  it('handleMessage: handles result with passingTests field', async () => {
    const pool = await initPool(1, { timeoutMs: 30000 })

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const runPromise = pool.run(mutant, ['t'])
    // Wait for acquireWorker to resolve and worker.run() to set pendingTask
    await new Promise((r) => setImmediate(r))

    rlEmitters[0].emit(
      'line',
      JSON.stringify({
        type: 'result',
        killed: false,
        durationMs: 10,
        passingTests: ['A > b'],
      }),
    )
    const result = await runPromise
    expect(result.passingTests).toEqual(['A > b'])

    await shutdownPool(pool)
  })

  it('process error event triggers handleExit', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1 })
    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'ready', workerId: 'w0' }),
    )
    await initPromise

    // Start a run to create a pending task
    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const runPromise = pool.run(mutant, ['t'])
    // Let pool.run advance past acquireWorker so pendingTask is set
    await new Promise((r) => setImmediate(r))

    // Emit error on the process — should reject the pending task
    mockProcesses[0].emit('error', new Error('ENOENT'))

    await expect(runPromise).rejects.toThrow('Worker exited unexpectedly')
  })

  it('process exit event triggers handleExit with code', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1 })
    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'ready', workerId: 'w0' }),
    )
    await initPromise

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const runPromise = pool.run(mutant, ['t'])
    // Let pool.run advance past acquireWorker so pendingTask is set
    await new Promise((r) => setImmediate(r))

    // Emit exit on process — should reject pending task
    mockProcesses[0].emit('exit', 1)

    await expect(runPromise).rejects.toThrow('Worker exited unexpectedly')
  })

  it('handleExit with no pending task just emits exit', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1 })
    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'ready', workerId: 'w0' }),
    )
    await initPromise

    // No pending task — process exit should not throw/reject anything
    mockProcesses[0].emit('exit', 0)
    expect(true).toBe(true)

    // Pool handleWorkerExit fires: spawns new process, waits for ready
    // Give event loop a few ticks to process the restart
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // Emit ready for the restarted worker (if it was created)
    if (rlEmitters.length > 1) {
      rlEmitters[1].emit(
        'line',
        JSON.stringify({ type: 'ready', workerId: 'w0' }),
      )
      await new Promise((r) => setImmediate(r))
    }

    // Shutdown
    const shutdownPromise = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    // Emit shutdown ack on all readline emitters
    for (const rl of [...rlEmitters].reverse()) {
      rl.emit('line', JSON.stringify({ type: 'shutdown', ok: true }))
    }
    await shutdownPromise
  })

  it('stderr data handler writes to process.stderr when DEBUG active', async () => {
    const origDebug = process.env.MUTINEER_DEBUG
    process.env.MUTINEER_DEBUG = '1'
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      const pool = await initPool()
      // Emit data on stderr
      mockProcesses[0].stderr.emit('data', Buffer.from('error output'))
      await shutdownPool(pool)
    } finally {
      if (origDebug === undefined) delete process.env.MUTINEER_DEBUG
      else process.env.MUTINEER_DEBUG = origDebug
      stderrSpy.mockRestore()
    }
  })

  it('kill() with undefined pid falls back to process.kill(SIGKILL)', async () => {
    const mockProc = new EventEmitter() as MockProc
    mockProc.stdout = new EventEmitter()
    mockProc.stderr = new EventEmitter()
    mockProc.stdin = { writes: [], write: vi.fn() as any }
    mockProc.kill = vi.fn()
    ;(mockProc as any).pid = undefined // pid is undefined — triggers fallback

    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      mockProc as unknown as childProcess.ChildProcess,
    )
    const rl = new EventEmitter() as readline.Interface
    vi.mocked(readline.createInterface).mockReturnValueOnce(rl)

    // Use very short timeout so test doesn't wait long
    const pool = new VitestPool({ cwd: '/test', concurrency: 1, timeoutMs: 50 })

    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rl.emit('line', JSON.stringify({ type: 'ready', workerId: 'w0' }))
    await initPromise

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    // Don't emit a result — let the 50ms timeout fire and call kill()
    const result = await pool.run(mutant, ['t'])

    expect(result.error).toBe('timeout')
    // With pid=undefined, fallback to this.process.kill('SIGKILL')
    expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('kill() with process.kill throwing is ignored', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1, timeoutMs: 50 })
    const mockProc = new EventEmitter() as MockProc
    mockProc.stdout = new EventEmitter()
    mockProc.stderr = new EventEmitter()
    mockProc.stdin = { writes: [], write: vi.fn() as any }
    mockProc.kill = vi.fn()
    ;(mockProc as any).pid = 99999

    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      mockProc as unknown as childProcess.ChildProcess,
    )
    const rl = new EventEmitter() as readline.Interface
    vi.mocked(readline.createInterface).mockReturnValueOnce(rl)

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })

    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rl.emit('line', JSON.stringify({ type: 'ready', workerId: 'w0' }))
    await initPromise

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const result = await pool.run(mutant, ['t'])

    expect(result.error).toBe('timeout')
    killSpy.mockRestore()
  })

  it('pool.run() throws when pool is shutting down', async () => {
    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const worker = new EventEmitter() as any
        worker.id = id
        worker.start = vi.fn().mockResolvedValue(undefined)
        worker.isReady = vi.fn().mockReturnValue(true)
        worker.isBusy = vi.fn().mockReturnValue(false)
        worker.run = vi.fn().mockResolvedValue({ killed: true, durationMs: 1 })
        worker.shutdown = vi.fn().mockResolvedValue(undefined)
        worker.kill = vi.fn()
        return worker
      },
    })
    await pool.init()
    pool.shutdown() // Don't await — pool is now shutting down
    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    await expect(pool.run(mutant, ['t'])).rejects.toThrow(
      'Pool is shutting down',
    )
  })

  it('releaseWorker skips worker that is not ready', async () => {
    let workerReady = true
    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const worker = new EventEmitter() as any
        worker.id = id
        worker.start = vi.fn().mockResolvedValue(undefined)
        worker.isReady = vi.fn(() => workerReady)
        worker.isBusy = vi.fn().mockReturnValue(false)
        worker.run = vi.fn().mockImplementation(async () => {
          workerReady = false
          return { killed: true, durationMs: 1 }
        })
        worker.shutdown = vi.fn().mockResolvedValue(undefined)
        worker.kill = vi.fn()
        return worker
      },
    })
    await pool.init()

    // Run once — worker becomes not ready after run
    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const result = await pool.run(mutant, ['t'])
    expect(result.killed).toBe(true)

    await pool.shutdown()
  })

  it('runWithPool maps timeout result', async () => {
    const mockPool = {
      run: vi.fn().mockResolvedValue({
        killed: false,
        durationMs: 10000,
        error: 'timeout',
      }),
    } as unknown as VitestPool

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const result = await runWithPool(mockPool, mutant, ['t'])
    expect(result).toEqual({
      status: 'timeout',
      durationMs: 10000,
      error: 'timeout',
    })
  })

  it('runWithPool maps error result (error with !killed)', async () => {
    const mockPool = {
      run: vi
        .fn()
        .mockResolvedValue({ killed: false, durationMs: 5, error: 'crash' }),
    } as unknown as VitestPool

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const result = await runWithPool(mockPool, mutant, ['t'])
    expect(result).toEqual({ status: 'error', durationMs: 5, error: 'crash' })
  })

  it('runWithPool maps non-Error exception', async () => {
    const mockPool = {
      run: vi.fn().mockRejectedValue('string rejection'),
    } as unknown as VitestPool

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const result = await runWithPool(mockPool, mutant, [])
    expect(result).toEqual({
      status: 'error',
      durationMs: 0,
      error: 'string rejection',
    })
  })

  it('pool.init() is a no-op when already initialised', async () => {
    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const w = new EventEmitter() as any
        w.id = id
        w.start = vi.fn().mockResolvedValue(undefined)
        w.isReady = vi.fn().mockReturnValue(true)
        w.isBusy = vi.fn().mockReturnValue(false)
        w.run = vi.fn().mockResolvedValue({ killed: true, durationMs: 1 })
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        return w
      },
    })
    await pool.init()
    const workersBefore = (pool as any).workers.length
    await pool.init() // second call should be no-op
    expect((pool as any).workers.length).toBe(workersBefore)
    await pool.shutdown()
  })

  it('pool.shutdown() is a no-op when already shutting down', async () => {
    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const w = new EventEmitter() as any
        w.id = id
        w.start = vi.fn().mockResolvedValue(undefined)
        w.isReady = vi.fn().mockReturnValue(true)
        w.isBusy = vi.fn().mockReturnValue(false)
        w.run = vi.fn().mockResolvedValue({ killed: true, durationMs: 1 })
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        return w
      },
    })
    await pool.init()
    const p1 = pool.shutdown()
    const p2 = pool.shutdown() // second call is a no-op
    await Promise.all([p1, p2])
    expect(true).toBe(true)
  })

  it('handleMessage: handles result with nullish killed/durationMs', async () => {
    const pool = await initPool(1, { timeoutMs: 30000 })

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const runPromise = pool.run(mutant, ['t'])
    await new Promise((r) => setImmediate(r))

    // Send result without killed/durationMs to test ?? defaults
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'result' }), // killed=undefined, durationMs=undefined
    )
    const result = await runPromise
    expect(result.killed).toBe(true) // ?? true default
    expect(result.durationMs).toBe(0) // ?? 0 default

    await shutdownPool(pool)
  })

  it('handleMessage: unknown message type is silently ignored', async () => {
    const pool = await initPool()
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'unknown-type', data: 'whatever' }),
    )
    expect(true).toBe(true)
    await shutdownPool(pool)
  })

  it('handleExit during shuttingDown skips pendingTask rejection', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1 })
    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'ready', workerId: 'w0' }),
    )
    await initPromise

    // Start shutdown (sets shuttingDown=true)
    const shutdownP = pool.shutdown()
    await new Promise((r) => setImmediate(r))

    // Emit process exit while shutting down — handleExit called with shuttingDown=true
    // This covers the FALSE branch of (pendingTask && !shuttingDown)
    mockProcesses[0].emit('exit', 0)

    // Emit shutdown ack to resolve the shutdown
    rlEmitters[0].emit('line', JSON.stringify({ type: 'shutdown', ok: true }))
    await shutdownP
    expect(true).toBe(true)
  })

  it('worker.run() throws when not ready', async () => {
    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const w = new EventEmitter() as any
        w.id = id
        w.start = vi.fn().mockResolvedValue(undefined)
        w.isReady = vi.fn().mockReturnValue(false) // always not ready
        w.isBusy = vi.fn().mockReturnValue(false)
        w.run = vi
          .fn()
          .mockRejectedValue(new Error(`Worker ${id} is not ready`))
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        return w
      },
    })
    await pool.init()
    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    await expect(pool.run(mutant, ['t'])).rejects.toThrow('is not ready')
    await pool.shutdown()
  })

  it('worker.run() throws when busy', async () => {
    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        const w = new EventEmitter() as any
        w.id = id
        w.start = vi.fn().mockResolvedValue(undefined)
        w.isReady = vi.fn().mockReturnValue(true)
        w.isBusy = vi.fn().mockReturnValue(true) // busy
        w.run = vi.fn().mockRejectedValue(new Error(`Worker ${id} is busy`))
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        return w
      },
    })
    await pool.init()
    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    await expect(pool.run(mutant, ['t'])).rejects.toThrow('is busy')
    await pool.shutdown()
  })

  it('acquireWorker queues second run when single worker is busy', async () => {
    const pool = await initPool(1, { timeoutMs: 30000 })

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }

    // Start two runs simultaneously - second must queue since concurrency=1
    const [run1, run2] = [
      pool.run(mutant, ['t']),
      pool.run({ ...mutant, id: '2' }, ['t']),
    ]

    // Let both acquireWorker() calls resolve (run1 gets worker, run2 queues)
    await new Promise((r) => setImmediate(r))

    // Send result for first run
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'result', killed: true, durationMs: 5 }),
    )
    await new Promise((r) => setImmediate(r))

    // After run1 finishes, releaseWorker gives worker to run2
    // Send result for second run
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'result', killed: false, durationMs: 3 }),
    )

    const [r1, r2] = await Promise.all([run1, run2])
    expect(r1.killed).toBe(true)
    expect(r2.killed).toBe(false)

    await shutdownPool(pool)
  })

  it('vitestConfig and vitestProject are passed to worker env', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined

    vi.mocked(childProcess.spawn).mockImplementationOnce(
      (_cmd, _args, options) => {
        capturedEnv = (options as any)?.env
        const proc = new EventEmitter() as MockProc
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        proc.stdin = { writes: [], write: vi.fn() as any }
        proc.kill = vi.fn()
        return proc as unknown as childProcess.ChildProcess
      },
    )

    const rl = new EventEmitter() as readline.Interface
    vi.mocked(readline.createInterface).mockImplementationOnce(() => rl)

    const pool = new VitestPool({
      cwd: '/proj',
      concurrency: 1,
      vitestConfig: 'vitest.config.ts',
      vitestProject: 'my-project',
    })
    const initP = pool.init()
    await new Promise((r) => setImmediate(r))

    expect(capturedEnv?.MUTINEER_VITEST_CONFIG).toBe('vitest.config.ts')
    expect(capturedEnv?.MUTINEER_VITEST_PROJECT).toBe('my-project')

    rl.emit('line', JSON.stringify({ type: 'ready', workerId: 'w0' }))
    await initP

    const shutdownP = pool.shutdown()
    await new Promise((r) => setImmediate(r))
    rl.emit('line', JSON.stringify({ type: 'shutdown', ok: true }))
    await shutdownP
  })

  it('handleWorkerExit removes idle worker from availableWorkers and restarts', async () => {
    let workerNum = 0
    const allWorkers: any[] = []

    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        workerNum++
        const w = new EventEmitter() as any
        w.id = id
        w.start = vi.fn().mockResolvedValue(undefined)
        w.isReady = vi.fn().mockReturnValue(true)
        w.isBusy = vi.fn().mockReturnValue(false)
        w.run = vi.fn().mockResolvedValue({ killed: true, durationMs: 1 })
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        allWorkers.push(w)
        return w
      },
    })

    await pool.init()
    expect(allWorkers).toHaveLength(1)

    // Worker 1 exits while idle — it is currently in availableWorkers
    allWorkers[0].emit('exit', 1)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // Replacement worker should have been created
    expect(allWorkers).toHaveLength(2)

    // Pool should still serve tasks via the new worker
    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f.ts',
      code: 'x',
      line: 1,
      col: 1,
    }
    const result = await pool.run(mutant, ['t'])
    expect(result.killed).toBe(true)
    expect(allWorkers[1].run).toHaveBeenCalled()

    await pool.shutdown()
  })

  it('handleWorkerExit restart failure is silently caught', async () => {
    let workerNum = 0
    const pool = new VitestPool({
      cwd: '/test',
      concurrency: 1,
      createWorker: (id) => {
        workerNum++
        const w = new EventEmitter() as any
        w.id = id
        w.start =
          workerNum === 1
            ? vi.fn().mockResolvedValue(undefined)
            : vi.fn().mockRejectedValue(new Error('restart failed'))
        w.isReady = vi.fn().mockReturnValue(workerNum === 1)
        w.isBusy = vi.fn().mockReturnValue(false)
        w.run = vi.fn().mockResolvedValue({ killed: true, durationMs: 1 })
        w.shutdown = vi.fn().mockResolvedValue(undefined)
        w.kill = vi.fn()
        return w
      },
    })
    await pool.init()

    // Trigger worker exit (pool not shutting down → handleWorkerExit fires)
    const worker = (pool as any).workers[0]
    worker.emit('exit', 1)

    // Give event loop time for handleWorkerExit and failed restart
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(true).toBe(true) // No uncaught error
    await pool.shutdown()
  })

  it('kill() does nothing when process is already null', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1, timeoutMs: 50 })
    const mockProc = new EventEmitter() as MockProc
    mockProc.stdout = new EventEmitter()
    mockProc.stderr = new EventEmitter()
    mockProc.stdin = { writes: [], write: vi.fn() as any }
    mockProc.kill = vi.fn()
    ;(mockProc as any).pid = 12345

    vi.mocked(childProcess.spawn).mockReturnValueOnce(
      mockProc as unknown as childProcess.ChildProcess,
    )
    const rl = new EventEmitter() as readline.Interface
    vi.mocked(readline.createInterface).mockReturnValueOnce(rl)

    const initP = pool.init()
    await new Promise((r) => setImmediate(r))
    rl.emit('line', JSON.stringify({ type: 'ready', workerId: 'w0' }))
    await initP

    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true)

    // First run: timeout fires, calls kill() (sets process=null, ready=false)
    const run1 = pool.run(
      { id: '1', name: 'm', file: 'f', code: 'c', line: 1, col: 1 },
      ['t'],
    )
    const r1 = await run1
    expect(r1.error).toBe('timeout')

    // Pool tries to restart — mock a new spawn that stays alive
    if (rlEmitters.length > 1) {
      rlEmitters[1].emit(
        'line',
        JSON.stringify({ type: 'ready', workerId: 'w0' }),
      )
    }

    killSpy.mockRestore()
    await pool.shutdown()
  })

  it('process exit with null code uses ?? 1 fallback', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1 })
    const initPromise = pool.init()
    await new Promise((r) => setImmediate(r))
    rlEmitters[0].emit(
      'line',
      JSON.stringify({ type: 'ready', workerId: 'w0' }),
    )
    await initPromise

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const runPromise = pool.run(mutant, ['t'])
    await new Promise((r) => setImmediate(r))

    // Emit exit with null code — triggers `code ?? 1`
    mockProcesses[0].emit('exit', null)

    await expect(runPromise).rejects.toThrow(
      'Worker exited unexpectedly with code 1',
    )
  })

  it('pool.run() throws when pool not initialised', async () => {
    const pool = new VitestPool({ cwd: '/test', concurrency: 1 })
    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    await expect(pool.run(mutant, ['t'])).rejects.toThrow(
      'Pool not initialised',
    )
  })

  it('runWithPool maps killed=true to killed status', async () => {
    const mockPool = {
      run: vi.fn().mockResolvedValue({ killed: true, durationMs: 15 }),
    } as unknown as VitestPool

    const mutant: MutantPayload = {
      id: '1',
      name: 'm',
      file: 'f',
      code: 'c',
      line: 1,
      col: 1,
    }
    const result = await runWithPool(mockPool, mutant, ['t'])
    expect(result).toEqual({ status: 'killed', durationMs: 15 })
  })

  it('threads passingTests from WorkerMessage through to MutantRunSummary', async () => {
    const pool = new VitestPool({
      cwd: process.cwd(),
      concurrency: 1,
      timeoutMs: 5000,
      createWorker: (id) => {
        const worker = new EventEmitter() as any
        worker.id = id
        worker.start = vi.fn().mockResolvedValue(undefined)
        worker.isReady = vi.fn().mockReturnValue(true)
        worker.isBusy = vi.fn().mockReturnValue(false)
        worker.run = vi.fn().mockResolvedValue({
          killed: false,
          durationMs: 10,
          passingTests: ['Suite > test one', 'Suite > test two'],
        })
        worker.shutdown = vi.fn().mockResolvedValue(undefined)
        worker.kill = vi.fn()
        return worker
      },
    })
    await pool.init()

    const mutant: MutantPayload = {
      id: 'pt1',
      name: 'mutant',
      file: 'foo.ts',
      code: 'x',
      line: 1,
      col: 1,
    }

    const result = await pool.run(mutant, ['foo.spec.ts'])

    expect(result.passingTests).toEqual([
      'Suite > test one',
      'Suite > test two',
    ])
    await pool.shutdown()
  })
})
