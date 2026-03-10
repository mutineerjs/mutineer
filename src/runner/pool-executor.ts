import fs from 'node:fs'
import { render, type Instance } from 'ink'
import { createElement } from 'react'

import type { MutantCacheEntry, MutantStatus } from '../types/mutant.js'
import type { TestRunnerAdapter } from './types.js'
import type { MutantTask } from './tasks.js'
import { Progress } from '../utils/progress.js'
import { computeSummary, printSummary } from '../utils/summary.js'
import { saveCacheAtomic } from './cache.js'
import { cleanupMutineerDirs } from './cleanup.js'
import { PoolSpinner } from '../utils/PoolSpinner.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('pool-executor')

export interface PoolExecutionOptions {
  tasks: MutantTask[]
  adapter: TestRunnerAdapter
  cache: Record<string, MutantCacheEntry>
  concurrency: number
  progressMode: 'bar' | 'list' | 'quiet'
  minKillPercent?: number
  cwd: string
}

/**
 * Execute all mutant tasks through the worker pool.
 * Handles worker init, progress display, signal handling, and cleanup.
 */
export async function executePool(opts: PoolExecutionOptions): Promise<void> {
  const { tasks, adapter, cache, concurrency, cwd } = opts

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length))

  const progress = new Progress(tasks.length, {
    mode: opts.progressMode === 'bar' ? 'bar' : 'list',
    stream: 'stderr',
  })

  const mutationStartTime = Date.now()

  // Ensure we only finish once
  let finished = false
  const finishOnce = () => {
    if (finished) return
    finished = true
    const durationMs = Date.now() - mutationStartTime
    progress.finish()
    const summary = computeSummary(cache)
    printSummary(summary, cache, durationMs)
    if (opts.minKillPercent !== undefined) {
      const killRateString = summary.killRate.toFixed(2)
      const thresholdString = opts.minKillPercent.toFixed(2)
      if (summary.killRate < opts.minKillPercent) {
        const note = summary.evaluated === 0 ? ' No mutants were executed.' : ''
        log.error(
          `Mutation kill rate ${killRateString}% did not meet required ${thresholdString}% threshold.${note}`,
        )
        process.exitCode = 1
      } else {
        log.info(
          `Mutation kill rate ${killRateString}% meets required ${thresholdString}% threshold`,
        )
      }
    }
  }

  // Initialise worker pool
  const workerLogSuffix =
    workerCount < concurrency ? ` (requested ${concurrency})` : ''
  log.info(
    `Initializing ${adapter.name} worker pool with ${workerCount} workers...${workerLogSuffix}`,
  )
  const poolStart = Date.now()

  // Ink spinner on stderr while workers start up
  let spinnerInstance: Instance | null = null
  if (process.stderr.isTTY) {
    spinnerInstance = render(
      createElement(PoolSpinner, { message: 'Starting pool...' }),
      { stdout: process.stderr, stderr: process.stderr },
    )
  }

  try {
    await adapter.init(workerCount)
  } finally {
    if (spinnerInstance) {
      spinnerInstance.unmount()
      spinnerInstance = null
    }
  }
  const poolDurationMs = Date.now() - poolStart
  log.info(`\u2713 Worker pool ready (${poolDurationMs}ms)`)

  progress.start()

  let nextIdx = 0

  async function processTask(task: MutantTask): Promise<void> {
    const { v, tests, key, directTests } = task

    log.debug('Cache ' + JSON.stringify(cache))

    const cached = cache[key]
    if (cached) {
      progress.update(cached.status)
      return
    }

    if (tests.length === 0) {
      cache[key] = {
        status: 'skipped',
        file: v.file,
        line: v.line,
        col: v.col,
        mutator: v.name,
      }
      progress.update('skipped')
      return
    }

    log.debug(`Running tests for mutant ${v.name} ${JSON.stringify(tests)}`)

    const result = await adapter.runMutant(
      {
        id: v.id,
        name: v.name,
        file: v.file,
        code: v.code,
        line: v.line,
        col: v.col,
      },
      tests,
    )
    const status: MutantStatus = result.status

    let originalSnippet: string | undefined
    let mutatedSnippet: string | undefined
    if (status === 'escaped') {
      try {
        const originalLines = fs.readFileSync(v.file, 'utf8').split('\n')
        const mutatedLines = v.code.split('\n')
        const lineIdx = v.line - 1
        const orig = originalLines[lineIdx]?.trim()
        const mutated = mutatedLines[lineIdx]?.trim()
        if (orig !== undefined && mutated !== undefined && orig !== mutated) {
          originalSnippet = orig
          mutatedSnippet = mutated
        }
      } catch {
        // best-effort
      }
    }

    cache[key] = {
      status,
      file: v.file,
      line: v.line,
      col: v.col,
      mutator: v.name,
      ...(originalSnippet !== undefined && { originalSnippet, mutatedSnippet }),
      ...(status === 'escaped' &&
        (directTests ?? tests).length > 0 && {
          coveringTests: directTests ?? tests,
        }),
    }
    progress.update(status)
  }

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIdx++
      if (i >= tasks.length) break
      await processTask(tasks[i])
    }
  }

  const workers: Promise<void>[] = []

  // Register signal handlers so Ctrl+C / SIGTERM still triggers cleanup
  let signalCleanedUp = false
  const signalHandler = async (signal: string) => {
    if (signalCleanedUp) return
    signalCleanedUp = true
    log.info(`\nReceived ${signal}, cleaning up...`)
    finishOnce()
    await adapter.shutdown()
    await cleanupMutineerDirs(cwd)
    process.exit(1)
  }
  process.on('SIGINT', () => void signalHandler('SIGINT'))
  process.on('SIGTERM', () => void signalHandler('SIGTERM'))

  try {
    for (let i = 0; i < workerCount; i++) workers.push(worker())
    await Promise.all(workers)
    await saveCacheAtomic(cwd, cache)
  } finally {
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    if (!signalCleanedUp) {
      finishOnce()
      await adapter.shutdown()
      await cleanupMutineerDirs(cwd)
    }
  }
}
