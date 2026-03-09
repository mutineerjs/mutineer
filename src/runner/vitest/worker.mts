/**
 * Persistent Vitest worker process.
 *
 * This worker stays alive and receives mutation tasks via stdin,
 * using Vitest's programmatic API to rerun tests without process restart.
 *
 * Communication protocol (JSON-RPC over stdin/stdout):
 *
 * Request: { "type": "run", "mutant": { file, code, id, name }, "tests": string[] }
 * Response: { "type": "result", "killed": boolean, "durationMs": number }
 *
 * Request: { "type": "shutdown" }
 * Response: { "type": "shutdown", "ok": true }
 */

import * as readline from 'node:readline'
import type { MutantPayload } from '../types.js'
import { createVitestWorkerRuntime } from './worker-runtime.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('vitest-worker')

// Types for IPC messages
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

type Response = ResultResponse | ShutdownResponse | ReadyResponse

// Global state for redirect - shared with the plugin via globalThis
// Type is declared in pool-plugin.ts
globalThis.__mutineer_redirect__ = { from: null, to: null }

function send(response: Response): void {
  console.log(JSON.stringify(response))
}

async function main(): Promise<void> {
  const workerId = process.env.MUTINEER_WORKER_ID ?? 'unknown'
  const cwd = process.env.MUTINEER_CWD ?? process.cwd()
  const vitestConfigPath = process.env.MUTINEER_VITEST_CONFIG

  log.debug(`Starting worker ${workerId} in ${cwd}`)

  const runtime = createVitestWorkerRuntime({
    workerId,
    cwd,
    vitestConfigPath,
  })

  try {
    await runtime.init()
  } catch (err) {
    log.error(`Failed to initialise Vitest: ${err}`)
    process.exit(1)
  }

  // Signal ready
  send({ type: 'ready', workerId })

  // Process requests from stdin
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  })

  for await (const line of rl) {
    if (!line.trim()) continue

    let request: Request
    try {
      request = JSON.parse(line) as Request
    } catch (err) {
      log.debug(`Invalid JSON: ${line}`)
      continue
    }

    if (request.type === 'shutdown') {
      log.debug('Shutting down')
      await runtime.shutdown()
      send({ type: 'shutdown', ok: true })
      process.exit(0)
    }

    if (request.type === 'run') {
      try {
        const { mutant, tests } = request
        const result = await runtime.run(mutant, tests)
        send({
          type: 'result',
          killed: result.killed,
          durationMs: result.durationMs,
          error: result.error,
        })
      } catch (err) {
        // On error, treat as killed (conservative)
        send({
          type: 'result',
          killed: true,
          durationMs: 0,
          error: String(err),
        })
      }
    }
  }
}

main().catch((err) => {
  log.error(`Fatal error: ${err}`)
  process.exit(1)
})
