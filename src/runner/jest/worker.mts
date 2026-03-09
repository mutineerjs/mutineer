import type { MutantPayload } from '../types.js'
import { createJestWorkerRuntime } from './worker-runtime.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('jest-worker')

interface RunRequest {
  type: 'run'
  mutant: MutantPayload
  tests: string[]
}

interface ShutdownRequest {
  type: 'shutdown'
}

type Request = RunRequest | ShutdownRequest

interface ResultResponse {
  type: 'result'
  killed: boolean
  durationMs: number
  error?: string
}

interface ShutdownResponse {
  type: 'shutdown'
  ok: boolean
}

interface ReadyResponse {
  type: 'ready'
  workerId: string
}

globalThis.__mutineer_redirect__ = { from: null, to: null }

async function main(): Promise<void> {
  const workerId = process.env.MUTINEER_WORKER_ID ?? 'unknown'
  const cwd = process.env.MUTINEER_CWD ?? process.cwd()
  const jestConfigPath = process.env.MUTINEER_JEST_CONFIG

  log.debug(`Starting worker ${workerId} in ${cwd}`)

  const runtime = createJestWorkerRuntime({
    workerId,
    cwd,
    jestConfigPath,
  })

  try {
    await runtime.init()
  } catch (err) {
    log.error(`Failed to initialise: ${err}`)
    process.exit(1)
  }

  process.send?.({ type: 'ready', workerId } satisfies ReadyResponse)

  process.on('message', async (raw: Request) => {
    if (raw.type === 'shutdown') {
      log.debug('Shutting down')
      await runtime.shutdown()
      process.send?.({ type: 'shutdown', ok: true } satisfies ShutdownResponse)
      process.exit(0)
    }

    if (raw.type === 'run') {
      try {
        const { mutant, tests } = raw
        const result = await runtime.run(mutant, tests)
        process.send?.({
          type: 'result',
          killed: result.killed,
          durationMs: result.durationMs,
          error: result.error,
        } satisfies ResultResponse)
      } catch (err) {
        process.send?.({
          type: 'result',
          killed: true,
          durationMs: 0,
          error: String(err),
        } satisfies ResultResponse)
      }
    }
  })
}

main().catch((err) => {
  log.error(`Fatal error: ${err}`)
  process.exit(1)
})
