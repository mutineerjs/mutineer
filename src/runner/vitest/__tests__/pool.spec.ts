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
      createWorker: (id, opts) => {
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
})
