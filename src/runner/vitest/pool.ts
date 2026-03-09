/**
 * Vitest Worker Pool
 *
 * Manages a pool of persistent Vitest worker processes that can run
 * multiple mutations without restarting, providing significant speedup
 * over the per-spawn approach.
 *
 * Each worker:
 * - Starts Vitest in watch mode via programmatic API
 * - Receives mutations via stdin (JSON)
 * - Uses dynamic redirect loader to swap module at runtime
 * - Returns results via stdout (JSON)
 */

import { spawn, ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as readline from 'node:readline'
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

const workerLog = createLogger('VitestWorker')
const poolLog = createLogger('VitestPool')

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

class VitestWorker extends EventEmitter {
  readonly id: string
  private process: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private pendingTask: PendingTask | null = null
  private ready = false
  private shuttingDown = false

  constructor(
    id: string,
    private readonly cwd: string,
    private readonly vitestConfig?: string,
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

    const loaderJs = path.join(__dirname, 'redirect-loader.js')
    const loaderMjs = path.join(__dirname, 'redirect-loader.mjs')
    const loaderTs = path.join(__dirname, 'redirect-loader.ts')
    const loaderScript = fs.existsSync(loaderJs)
      ? loaderJs
      : fs.existsSync(loaderMjs)
        ? loaderMjs
        : loaderTs

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MUTINEER_WORKER_ID: this.id,
      MUTINEER_CWD: this.cwd,
      ...(this.vitestConfig
        ? { MUTINEER_VITEST_CONFIG: this.vitestConfig }
        : {}),
      ...(DEBUG ? { MUTINEER_DEBUG: '1' } : {}),
    }

    workerLog.debug(`[${this.id}] Starting worker process`)

    this.process = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--experimental-transform-types',
        '--no-warnings',
        '--import',
        loaderScript,
        workerScript,
      ],
      {
        cwd: this.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    // Handle stderr (debug/error output)
    this.process.stderr?.on('data', (data) => {
      if (DEBUG) {
        process.stderr.write(`[worker-${this.id}] ${data}`)
      }
    })

    // Set up line reader for stdout (JSON messages)
    this.rl = readline.createInterface({
      input: this.process.stdout!,
      terminal: false,
    })

    this.rl.on('line', (line) => this.handleMessage(line))

    this.process.on('error', (err) => {
      workerLog.debug(`[${this.id}] Process error: ${err.message}`)
      this.handleExit(1)
    })

    this.process.on('exit', (code) => {
      workerLog.debug(`[${this.id}] Process exited with code ${code}`)
      this.handleExit(code ?? 1)
    })

    // Wait for ready signal
    await new Promise<void>((resolve, reject) => {
      const timeoutMs = 120_000 // allow more time for Vitest init (coverage, large projects)
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

  private handleMessage(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    // Only attempt to parse JSON lines; ignore any other stdout noise
    if (!trimmed.startsWith('{')) {
      workerLog.debug(`[${this.id}] Non-JSON stdout: ${trimmed}`)
      return
    }

    let msg: WorkerMessage
    try {
      msg = JSON.parse(trimmed)
    } catch {
      workerLog.debug(`[${this.id}] Invalid JSON from worker: ${line}`)
      return
    }

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
          // Kill and restart the worker on timeout
          this.kill()
          resolve({ killed: true, durationMs: timeoutMs, error: 'timeout' })
        }
      }, timeoutMs)

      this.pendingTask = { resolve, reject, timeoutHandle }

      const request = JSON.stringify({ type: 'run', mutant, tests })
      this.process!.stdin!.write(request + '\n')
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

      this.process!.stdin!.write(JSON.stringify({ type: 'shutdown' }) + '\n')
    })
  }

  kill(): void {
    if (this.process) {
      try {
        this.process.kill('SIGKILL')
      } catch {
        // Ignore
      }
      this.process = null
    }
    this.ready = false
  }
}

export interface VitestPoolOptions {
  cwd: string
  concurrency: number
  vitestConfig?: string
  timeoutMs?: number
  createWorker?: (
    id: string,
    opts: { cwd: string; vitestConfig?: string },
  ) => VitestWorker
}

export class VitestPool {
  private workers: VitestWorker[] = []
  private availableWorkers: VitestWorker[] = []
  private waitingTasks: Array<(worker: VitestWorker) => void> = []
  private readonly options: Required<
    Omit<VitestPoolOptions, 'vitestConfig' | 'createWorker'>
  > & {
    vitestConfig?: string
    createWorker?: VitestPoolOptions['createWorker']
  }
  private initialised = false
  private shuttingDown = false

  constructor(options: VitestPoolOptions) {
    this.options = {
      cwd: options.cwd,
      concurrency: options.concurrency,
      vitestConfig: options.vitestConfig,
      timeoutMs: options.timeoutMs ?? 10_000,
      createWorker: options.createWorker,
    }
  }

  async init(): Promise<void> {
    if (this.initialised) return

    poolLog.debug(`Initializing pool with ${this.options.concurrency} workers`)

    const startPromises: Promise<void>[] = []

    for (let i = 0; i < this.options.concurrency; i++) {
      const worker =
        this.options.createWorker?.(`w${i}`, {
          cwd: this.options.cwd,
          vitestConfig: this.options.vitestConfig,
        }) ??
        new VitestWorker(`w${i}`, this.options.cwd, this.options.vitestConfig)

      worker.on('exit', () => {
        if (!this.shuttingDown) {
          this.handleWorkerExit(worker)
        }
      })

      this.workers.push(worker)
      startPromises.push(
        worker.start().then(() => {
          this.availableWorkers.push(worker)
          poolLog.debug(`Worker ${worker.id} ready`)
        }),
      )
    }

    await Promise.all(startPromises)
    this.initialised = true
    poolLog.debug('Pool initialised')
  }

  private handleWorkerExit(worker: VitestWorker): void {
    // Remove from available list
    const availIdx = this.availableWorkers.indexOf(worker)
    if (availIdx >= 0) {
      this.availableWorkers.splice(availIdx, 1)
    }

    // Try to restart the worker
    poolLog.debug(`Worker ${worker.id} exited, attempting restart`)
    const newWorker =
      this.options.createWorker?.(worker.id, {
        cwd: this.options.cwd,
        vitestConfig: this.options.vitestConfig,
      }) ??
      new VitestWorker(worker.id, this.options.cwd, this.options.vitestConfig)

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
        poolLog.debug(`Worker ${newWorker.id} restarted`)
      })
      .catch((err) => {
        poolLog.debug(`Failed to restart worker ${newWorker.id}: ${err}`)
      })
  }

  private async acquireWorker(): Promise<VitestWorker> {
    // Try to get an available worker
    const worker = this.availableWorkers.shift()
    if (worker) {
      return worker
    }

    // Wait for one to become available
    return new Promise((resolve) => {
      this.waitingTasks.push(resolve)
    })
  }

  private releaseWorker(worker: VitestWorker): void {
    // If someone is waiting, give them the worker directly
    const waiting = this.waitingTasks.shift()
    if (waiting) {
      waiting(worker)
      return
    }

    // Otherwise return to the pool
    if (worker.isReady()) {
      this.availableWorkers.push(worker)
    }
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
      return result
    } finally {
      this.releaseWorker(worker)
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true

    poolLog.debug('Shutting down pool')

    await Promise.all(this.workers.map((w) => w.shutdown()))
    this.workers = []
    this.availableWorkers = []
    this.initialised = false

    poolLog.debug('Pool shut down')
  }
}

/**
 * Run a single mutation using the pool.
 * Convenience function for integration with orchestrator.
 */
export async function runWithPool(
  pool: VitestPool,
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
