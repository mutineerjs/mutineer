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
