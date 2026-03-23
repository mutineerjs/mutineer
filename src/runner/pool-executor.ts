import fs from 'node:fs'
import path from 'node:path'
import { render, type Instance } from 'ink'
import { createElement } from 'react'

import type { MutantCacheEntry, MutantStatus } from '../types/mutant.js'
import type { TestRunnerAdapter } from './types.js'
import type { MutantTask } from './tasks.js'
import { Progress } from '../utils/progress.js'
import {
  computeSummary,
  printSummary,
  buildJsonReport,
} from '../utils/summary.js'
import { saveCacheAtomic } from './cache.js'
import { cleanupMutineerDirs } from './cleanup.js'
import { PoolSpinner } from '../utils/PoolSpinner.js'
import { CompileErrors } from '../utils/CompileErrors.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('pool-executor')

export interface PoolExecutionOptions {
  tasks: MutantTask[]
  adapter: TestRunnerAdapter
  cache: Record<string, MutantCacheEntry>
  concurrency: number
  progressMode: 'bar' | 'list' | 'quiet'
  minKillPercent?: number
  reportFormat?: 'text' | 'json'
  cwd: string
  shard?: { index: number; total: number }
  /** IDs of variants that must use the legacy redirect path (overlapping diff ranges). */
  fallbackIds?: Set<string>
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
  const finishOnce = async (interactive = true) => {
    if (finished) return
    finished = true
    const durationMs = Date.now() - mutationStartTime
    progress.finish()
    const summary = computeSummary(cache)
    if (opts.reportFormat === 'json') {
      const report = buildJsonReport(summary, cache, durationMs)
      const shardSuffix = opts.shard
        ? `-shard-${opts.shard.index}-of-${opts.shard.total}`
        : ''
      const outPath = path.join(opts.cwd, `mutineer-report${shardSuffix}.json`)
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
      log.info(
        `JSON report written to ${path.relative(process.cwd(), outPath)}`,
      )
    } else {
      const compileErrorEntries = Object.values(cache).filter(
        (e) => e.status === 'compile-error',
      )
      const useInteractive =
        interactive && process.stdout.isTTY && compileErrorEntries.length > 0
      printSummary(summary, cache, durationMs, {
        skipCompileErrors: useInteractive,
      })
      if (useInteractive) {
        const { waitUntilExit } = render(
          createElement(CompileErrors, { entries: compileErrorEntries, cwd }),
        )
        await waitUntilExit()
      }
    }
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

  const fileCache = new Map<string, string>()
  let nextIdx = 0

  async function processTask(task: MutantTask): Promise<void> {
    const { v, tests, key, directTests } = task
    const { fallbackIds } = opts

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
        isFallback: !fallbackIds || fallbackIds.has(v.id),
      },
      tests,
    )
    const status: MutantStatus = result.status

    let originalSnippet: string | undefined
    let mutatedSnippet: string | undefined
    if (status === 'escaped') {
      try {
        let fileContent = fileCache.get(v.file)
        if (fileContent === undefined) {
          fileContent = fs.readFileSync(v.file, 'utf8')
          fileCache.set(v.file, fileContent)
        }
        const originalLines = fileContent.split('\n')
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
    await finishOnce(false)
    await adapter.shutdown()
    await cleanupMutineerDirs(cwd)
    process.exit(1)
  }
  process.on('SIGINT', () => void signalHandler('SIGINT'))
  process.on('SIGTERM', () => void signalHandler('SIGTERM'))

  try {
    for (let i = 0; i < workerCount; i++) workers.push(worker())
    await Promise.all(workers)
    await saveCacheAtomic(cwd, cache, opts.shard)
  } finally {
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    if (!signalCleanedUp) {
      await finishOnce()
      await adapter.shutdown()
      await cleanupMutineerDirs(cwd)
    }
  }
}
