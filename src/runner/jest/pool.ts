import { fork, ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import type {
  MutantPayload,
  MutantRunResult,
  MutantRunSummary,
} from '../../types/mutant.js'
import { createLogger, DEBUG } from '../../utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const workerLog = createLogger('JestWorker')
const poolLog = createLogger('JestPool')

interface WorkerMessage {
  type: 'ready' | 'result' | 'shutdown'
  workerId?: string
  killed?: boolean
  durationMs?: number
  error?: string
  ok?: boolean
}

interface PendingTask {
  resolve: (result: MutantRunSummary) => void
  reject: (error: Error) => void
  timeoutHandle: NodeJS.Timeout | null
}

class JestWorker extends EventEmitter {
  readonly id: string
  private process: ChildProcess | null = null
  private pendingTask: PendingTask | null = null
  private ready = false
  private shuttingDown = false

  constructor(
    id: string,
    private readonly cwd: string,
    private readonly jestConfig?: string,
  ) {
    super()
    this.id = id
  }

  async start(): Promise<void> {
    const workerJs = path.join(__dirname, 'worker.js')
    const workerMts = path.join(__dirname, 'worker.mjs')
    const workerTs = path.join(__dirname, 'worker.mts')
    const workerScript = fs.existsSync(workerJs)
      ? workerJs
      : fs.existsSync(workerMts)
        ? workerMts
        : workerTs

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MUTINEER_WORKER_ID: this.id,
      MUTINEER_CWD: this.cwd,
      ...(this.jestConfig ? { MUTINEER_JEST_CONFIG: this.jestConfig } : {}),
      ...(DEBUG ? { MUTINEER_DEBUG: '1' } : {}),
    }

    workerLog.debug(`[${this.id}] Starting Jest worker process`)

    this.process = fork(workerScript, [], {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      execArgv: [
        '--experimental-strip-types',
        '--experimental-transform-types',
        '--no-warnings',
      ],
    })

    this.process.stderr?.on('data', (data) => {
      if (DEBUG) {
        process.stderr.write(`[jest-worker-${this.id}] ${data}`)
      }
    })

    this.process.on('message', (msg) => this.handleMessage(msg))

    this.process.on('error', (err) => {
      workerLog.debug(`[${this.id}] Process error: ${err.message}`)
      this.handleExit(1)
    })

    this.process.on('exit', (code) => {
      workerLog.debug(`[${this.id}] Process exited with code ${code}`)
      this.handleExit(code ?? 1)
    })

    await new Promise<void>((resolve, reject) => {
      const timeoutMs = 60_000
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Worker ${this.id} did not become ready in time (${timeoutMs}ms)`,
          ),
        )
      }, timeoutMs)

      this.once('ready', () => {
        clearTimeout(timeout)
        resolve()
      })

      this.once('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  private handleMessage(raw: unknown): void {
    const msg = raw as WorkerMessage

    if (msg.type === 'ready') {
      this.ready = true
      this.emit('ready')
      return
    }

    if (msg.type === 'result') {
      if (this.pendingTask) {
        const { resolve, timeoutHandle } = this.pendingTask
        if (timeoutHandle) clearTimeout(timeoutHandle)
        this.pendingTask = null
        resolve({
          killed: msg.killed ?? true,
          durationMs: msg.durationMs ?? 0,
          error: msg.error,
        })
      }
      return
    }

    if (msg.type === 'shutdown') {
      this.emit('shutdown')
      return
    }
  }

  private handleExit(code: number): void {
    this.ready = false

    if (this.pendingTask && !this.shuttingDown) {
      const { reject, timeoutHandle } = this.pendingTask
      if (timeoutHandle) clearTimeout(timeoutHandle)
      this.pendingTask = null
      reject(new Error(`Worker exited unexpectedly with code ${code}`))
    }

    this.emit('exit', code)
  }

  isReady(): boolean {
    return this.ready && this.process !== null && !this.shuttingDown
  }

  isBusy(): boolean {
    return this.pendingTask !== null
  }

  async run(
    mutant: MutantPayload,
    tests: string[],
    timeoutMs = 10_000,
  ): Promise<MutantRunSummary> {
    if (!this.isReady()) {
      throw new Error(`Worker ${this.id} is not ready`)
    }
    if (this.isBusy()) {
      throw new Error(`Worker ${this.id} is busy`)
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingTask) {
          this.pendingTask = null
          this.kill()
          resolve({ killed: true, durationMs: timeoutMs, error: 'timeout' })
        }
      }, timeoutMs)

      this.pendingTask = { resolve, reject, timeoutHandle }

      this.process!.send?.({ type: 'run', mutant, tests })
    })
  }

  async shutdown(): Promise<void> {
    if (!this.process || this.shuttingDown) return
    this.shuttingDown = true

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.kill()
        resolve()
      }, 5000)

      this.once('shutdown', () => {
        clearTimeout(timeout)
        resolve()
      })

      this.process!.send?.({ type: 'shutdown' })
    })
  }

  kill(): void {
    if (this.process) {
      try {
        this.process.kill('SIGKILL')
      } catch {
        // ignore
      }
      this.process = null
    }
    this.ready = false
  }
}

export interface JestPoolOptions {
  cwd: string
  concurrency: number
  jestConfig?: string
  timeoutMs?: number
  createWorker?: (
    id: string,
    opts: { cwd: string; jestConfig?: string },
  ) => JestWorker
}

export class JestPool {
  private workers: JestWorker[] = []
  private availableWorkers: JestWorker[] = []
  private waitingTasks: Array<(worker: JestWorker) => void> = []
  private readonly options: Required<
    Omit<JestPoolOptions, 'jestConfig' | 'createWorker'>
  > & {
    jestConfig?: string
    createWorker?: JestPoolOptions['createWorker']
  }
  private initialised = false
  private shuttingDown = false

  constructor(options: JestPoolOptions) {
    this.options = {
      cwd: options.cwd,
      concurrency: options.concurrency,
      jestConfig: options.jestConfig,
      timeoutMs: options.timeoutMs ?? 10_000,
      createWorker: options.createWorker,
    }
  }

  async init(): Promise<void> {
    if (this.initialised) return

    const startPromises: Promise<void>[] = []

    for (let i = 0; i < this.options.concurrency; i++) {
      const worker =
        this.options.createWorker?.(`w${i}`, {
          cwd: this.options.cwd,
          jestConfig: this.options.jestConfig,
        }) ?? new JestWorker(`w${i}`, this.options.cwd, this.options.jestConfig)

      worker.on('exit', () => {
        if (!this.shuttingDown) {
          this.handleWorkerExit(worker)
        }
      })

      this.workers.push(worker)
      startPromises.push(
        worker.start().then(() => {
          this.availableWorkers.push(worker)
        }),
      )
    }

    await Promise.all(startPromises)
    this.initialised = true
  }

  private handleWorkerExit(worker: JestWorker): void {
    const availIdx = this.availableWorkers.indexOf(worker)
    if (availIdx >= 0) {
      this.availableWorkers.splice(availIdx, 1)
    }

    const newWorker =
      this.options.createWorker?.(worker.id, {
        cwd: this.options.cwd,
        jestConfig: this.options.jestConfig,
      }) ?? new JestWorker(worker.id, this.options.cwd, this.options.jestConfig)

    const idx = this.workers.indexOf(worker)
    if (idx >= 0) {
      this.workers[idx] = newWorker
    }

    newWorker.on('exit', () => {
      if (!this.shuttingDown) {
        this.handleWorkerExit(newWorker)
      }
    })

    newWorker
      .start()
      .then(() => {
        this.releaseWorker(newWorker)
      })
      .catch((err) => {
        poolLog.debug(`Failed to restart worker ${newWorker.id}: ${err}`)
      })
  }

  private async acquireWorker(): Promise<JestWorker> {
    const worker = this.availableWorkers.shift()
    if (worker) {
      return worker
    }

    return new Promise((resolve) => {
      this.waitingTasks.push(resolve)
    })
  }

  private releaseWorker(worker: JestWorker): void {
    if (!worker.isReady()) return
    const waiting = this.waitingTasks.shift()
    if (waiting) {
      waiting(worker)
      return
    }

    this.availableWorkers.push(worker)
  }

  async run(mutant: MutantPayload, tests: string[]): Promise<MutantRunSummary> {
    if (!this.initialised) {
      throw new Error('Pool not initialised. Call init() first.')
    }
    if (this.shuttingDown) {
      throw new Error('Pool is shutting down')
    }

    const worker = await this.acquireWorker()

    try {
      const result = await worker.run(mutant, tests, this.options.timeoutMs)
      poolLog.debug(
        `worker ${worker.id} returned killed=${result.killed} error=${result.error ?? 'none'} duration=${result.durationMs}`,
      )
      return result
    } finally {
      this.releaseWorker(worker)
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true

    await Promise.all(this.workers.map((w) => w.shutdown()))
    this.workers = []
    this.availableWorkers = []
    this.initialised = false
  }
}

export async function runWithJestPool(
  pool: JestPool,
  mutant: MutantPayload,
  tests: readonly string[],
): Promise<MutantRunResult> {
  try {
    const result = await pool.run(mutant, [...tests])
    if (result.error === 'timeout') {
      return {
        status: 'timeout',
        durationMs: result.durationMs,
        error: result.error,
      }
    }
    if (result.error && !result.killed) {
      return {
        status: 'error',
        durationMs: result.durationMs,
        error: result.error,
      }
    }
    return {
      status: result.killed ? 'killed' : 'escaped',
      durationMs: result.durationMs,
    }
  } catch (err) {
    return {
      status: 'error',
      durationMs: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export type {
  MutantPayload,
  MutantRunResult,
  MutantRunSummary,
} from '../../types/mutant.js'
