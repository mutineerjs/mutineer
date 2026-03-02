/**
 * Mutation Testing Orchestrator
 *
 * Coordinates the mutation testing process:
 * 1. Parse CLI arguments and load configuration
 * 2. Discover targets and tests
 * 3. Run baseline tests
 * 4. Enumerate mutation variants
 * 5. Execute mutants via worker pool
 * 6. Report results
 */

import path from 'node:path'
import os from 'node:os'
import { normalizePath } from 'vite'
import { render, type Instance } from 'ink'
import { createElement } from 'react'

import { autoDiscoverTargetsAndTests, type TestMap } from './discover.js'
import type { MutateTarget, MutineerConfig } from '../types/config.js'
import type { MutantStatus } from '../types/mutant.js'
import { listChangedFiles } from './changed.js'
import { loadMutineerConfig } from './config.js'
import { Progress } from '../utils/progress.js'
import { computeSummary, printSummary } from '../utils/summary.js'
import {
  loadCoverageData,
  loadPerTestCoverageData,
  isLineCovered,
  type CoverageData,
  type PerTestCoverageMap,
} from '../utils/coverage.js'
import {
  createVitestAdapter,
  isCoverageRequestedInArgs,
} from './vitest/index.js'
import { createJestAdapter } from './jest/index.js'
import type { TestRunnerAdapter } from './types.js'
import { createLogger } from '../utils/logger.js'
import { PoolSpinner } from '../utils/PoolSpinner.js'

// CLI argument parsing
import { parseCliOptions, type ParsedCliOptions } from './args.js'

// Cache management
import {
  clearCacheOnStart,
  saveCacheAtomic,
  readMutantCache,
  keyForTests,
  hash,
} from './cache.js'

// Variant enumeration
import {
  enumerateVariantsForTarget,
  filterTestsByCoverage,
  getTargetFile,
  type Variant,
} from './variants.js'

const log = createLogger('orchestrator')

let testMap: TestMap | undefined

// Per-mutant test timeout (ms). Can be overridden with env MUTINEER_MUTANT_TIMEOUT_MS
const MUTANT_TIMEOUT_MS = (() => {
  const raw = process.env.MUTINEER_MUTANT_TIMEOUT_MS
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 30_000
})()

import { cleanupMutineerDirs } from './cleanup.js'

// Re-export readMutantCache for external use
export { readMutantCache } from './cache.js'

export async function runOrchestrator(cliArgs: string[], cwd: string) {
  // Load configuration
  const configPath = cliArgs.find((arg, i) =>
    arg === '--config' || arg === '-c'
      ? cliArgs[i + 1]
      : arg.startsWith('--config=') || arg.startsWith('-c='),
  )
  const cfgPath = configPath?.startsWith('--config=')
    ? configPath.slice(9)
    : configPath?.startsWith('-c=')
      ? configPath.slice(3)
      : cliArgs.includes('--config')
        ? cliArgs[cliArgs.indexOf('--config') + 1]
        : cliArgs.includes('-c')
          ? cliArgs[cliArgs.indexOf('-c') + 1]
          : undefined
  const cfg: MutineerConfig = await loadMutineerConfig(cwd, cfgPath)

  // Parse CLI options
  const opts: ParsedCliOptions = parseCliOptions(cliArgs, cfg)

  await clearCacheOnStart(cwd)

  // Create test runner adapter
  const adapter: TestRunnerAdapter = (
    opts.runner === 'jest' ? createJestAdapter : createVitestAdapter
  )({
    cwd,
    concurrency: opts.concurrency,
    timeoutMs: MUTANT_TIMEOUT_MS,
    config: cfg,
    cliArgs,
  })

  // Detect coverage configuration from the adapter
  const coverageConfig = await adapter.detectCoverageConfig()
  const wantsPerTestCoverageFromConfig = coverageConfig.perTestEnabled
  const coveragePreference = cfg.coverage
  const wantsCoverageRun =
    coveragePreference === true
      ? true
      : coveragePreference === false
        ? false
        : isCoverageRequestedInArgs(cliArgs) || coverageConfig.coverageEnabled

  // Load pre-existing coverage data if provided
  let coverageData: CoverageData | null = null
  let perTestCoverage: PerTestCoverageMap | null = null
  if (opts.coverageFilePath) {
    log.info(`Loading coverage data from ${opts.coverageFilePath}...`)
    coverageData = await loadCoverageData(opts.coverageFilePath, cwd)
    log.info(`Loaded coverage for ${coverageData.coveredLines.size} files`)
  }

  // If --only-covered-lines but no coverage file, we'll generate it during baseline
  const needsCoverageFromBaseline = opts.wantsOnlyCoveredLines && !coverageData
  const hasCoverageProviderInstalled = adapter.hasCoverageProvider()
  const rawPerTestCoverage =
    opts.wantsPerTestCoverage ||
    wantsPerTestCoverageFromConfig ||
    (opts.wantsOnlyCoveredLines && hasCoverageProviderInstalled)
  const wantsPerTestCoverage =
    opts.runner === 'jest' ? false : rawPerTestCoverage

  if (opts.runner === 'jest' && rawPerTestCoverage) {
    log.warn(
      'Per-test coverage is not supported for Jest; continuing without per-test coverage.',
    )
  }

  if (needsCoverageFromBaseline && !hasCoverageProviderInstalled) {
    log.warn(
      'The "onlyCoveredLines" option requires a coverage provider to generate coverage data.',
    )
    log.warn(
      'Please install the appropriate coverage package (or disable onlyCoveredLines).',
    )
    process.exitCode = 1
    return
  }
  if (
    opts.wantsOnlyCoveredLines &&
    coverageData &&
    !hasCoverageProviderInstalled
  ) {
    log.warn(
      'The "onlyCoveredLines" option is enabled, but no coverage provider is installed.',
    )
    log.warn(
      'Running baseline tests without injecting per-test coverage; existing coverageFile will be used for filtering.',
    )
  }

  log.info(
    `Mutineer starting in ${
      opts.wantsChangedWithDeps
        ? 'changed files with dependencies'
        : opts.wantsChanged
          ? 'changed files only'
          : 'full'
    } mode${opts.wantsOnlyCoveredLines ? ' (only covered lines)' : ''}...`,
  )

  log.info(`Using concurrency=${opts.concurrency} (cpus=${os.cpus().length})`)

  const enableCoverageForBaseline =
    needsCoverageFromBaseline ||
    wantsPerTestCoverage ||
    wantsCoverageRun ||
    (opts.wantsOnlyCoveredLines && hasCoverageProviderInstalled)

  // Enumerate changed files if requested
  const changedAbs =
    opts.wantsChanged || opts.wantsChangedWithDeps
      ? new Set(
          listChangedFiles(cwd, {
            includeDeps: opts.wantsChangedWithDeps,
            baseRef: cfg.baseRef,
            maxDepth: cfg.dependencyDepth,
          }),
        )
      : null

  const variants: Variant[] = []
  const cache = await readMutantCache(cwd)

  // Always run discovery to build testMap (maps source files → test files)
  const discovered = await autoDiscoverTargetsAndTests(cwd, cfg)
  testMap = discovered.testMap

  // Use explicit targets if provided, otherwise use discovered targets
  const targets: MutateTarget[] = cfg.targets?.length
    ? [...cfg.targets]
    : (cfg.autoDiscover ?? true)
      ? discovered.targets
      : []

  // Collect all test files for baseline run
  const allTestFiles = new Set<string>()
  for (const target of targets) {
    const file = getTargetFile(target)
    const absFile = normalizePath(
      path.isAbsolute(file) ? file : path.join(cwd, file),
    )
    if (changedAbs && !changedAbs.has(absFile)) continue
    const testsAbs = testMap?.get(normalizePath(absFile))
    if (testsAbs) {
      for (const t of testsAbs) allTestFiles.add(t)
    }
  }
  const baselineTests = Array.from(allTestFiles)

  if (!baselineTests.length) {
    log.info('No tests found for targets. Exiting.')
    return
  }

  // Run baseline tests first (with coverage if needed for filtering)
  log.info(
    `Running ${baselineTests.length} baseline tests${enableCoverageForBaseline ? ' (collecting coverage)' : ''}\u2026`,
  )

  const baselineOk = await adapter.runBaseline(baselineTests, {
    collectCoverage: enableCoverageForBaseline ?? false,
    perTestCoverage: wantsPerTestCoverage ?? false,
  })
  if (!baselineOk) {
    process.exitCode = 1
    return
  }

  log.info('\u2713 Baseline tests complete')

  // Load coverage from baseline if we generated it
  if (needsCoverageFromBaseline) {
    const defaultCoveragePath = path.join(
      cwd,
      'coverage',
      'coverage-final.json',
    )
    log.info(`Loading coverage data from ${defaultCoveragePath}...`)
    try {
      coverageData = await loadCoverageData(defaultCoveragePath, cwd)
      log.info(`Loaded coverage for ${coverageData.coveredLines.size} files`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`Warning: Could not load coverage data: ${msg}`)
      log.warn('Continuing without coverage filtering.')
    }
  }

  // Load per-test coverage if requested
  if (wantsPerTestCoverage) {
    const reportsDir = path.join(cwd, 'coverage')
    log.info('Loading per-test coverage data...')
    perTestCoverage = await loadPerTestCoverageData(reportsDir, cwd)
    if (!perTestCoverage) {
      log.warn(
        'Per-test coverage data not found. Continuing without per-test test pruning.',
      )
    } else {
      log.info(`Loaded per-test coverage for ${perTestCoverage.size} tests`)
    }
  }

  // Enumerate variants for targets in parallel. Keep order deterministic by mapping then flattening.
  const enumerated = await Promise.all(
    targets.map(async (target) => {
      const file = getTargetFile(target)
      const absFile = normalizePath(
        path.isAbsolute(file) ? file : path.join(cwd, file),
      )
      if (changedAbs && !changedAbs.has(absFile)) return [] as Variant[]
      log.debug('Target file: ' + absFile)

      const files = await enumerateVariantsForTarget(
        cwd,
        target,
        cfg.include,
        cfg.exclude,
        cfg.maxMutantsPerFile,
      )
      const testsAbs = testMap?.get(normalizePath(absFile))
      const tests = testsAbs ? Array.from(testsAbs) : []

      log.debug(
        `  found ${files.length} variants, linked to ${tests.length} tests`,
      )

      // Filter by coverage if enabled
      let filtered = files
      if (coverageData) {
        filtered = files.filter((v) =>
          isLineCovered(coverageData!, absFile, v.line),
        )
        if (filtered.length !== files.length) {
          log.debug(
            `  filtered ${files.length} -> ${filtered.length} variants by coverage`,
          )
        }
      }

      return filtered.map((v) => ({ ...v, tests }))
    }),
  )
  for (const list of enumerated) variants.push(...list)

  if (!variants.length) {
    const msg = coverageData
      ? 'No mutants to test (all mutations are on uncovered lines). Exiting.'
      : 'No mutants to test. Exiting.'
    log.info(msg)
    return
  }

  const progress = new Progress(variants.length, {
    mode: opts.progressMode === 'bar' ? 'bar' : 'list',
    stream: 'stderr',
  })

  // Track mutation testing duration
  const mutationStartTime = Date.now()

  // Precompute task metadata for faster worker loops (sort tests, compute keys once)
  const tasks = variants.map((v) => {
    let tests = Array.from(v.tests)
    if (perTestCoverage && tests.length) {
      const before = tests.length
      tests = filterTestsByCoverage(perTestCoverage, tests, v.file, v.line)
      if (tests.length !== before) {
        log.debug(
          `Pruned tests ${before} -> ${tests.length} for mutant ${v.name} via per-test coverage`,
        )
      }
    }
    tests.sort()
    const testSig = hash(keyForTests(tests))
    const codeSig = hash(v.code)
    const key = `${testSig}:${codeSig}`
    return { v, tests, key }
  })

  const workerCount = Math.max(1, Math.min(opts.concurrency, tasks.length))

  // Ensure we only finish once
  let finished = false
  const finishOnce = () => {
    if (finished) return
    finished = true
    const durationMs = Date.now() - mutationStartTime
    // Finish progress display first
    progress.finish()
    // Compute and print a human-friendly summary
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
        // Set exit code and let caller/CLI decide if it should terminate abruptly
        process.exitCode = 1
      } else {
        log.info(
          `Mutation kill rate ${killRateString}% meets required ${thresholdString}% threshold`,
        )
      }
    }
  }

  // Initialize test runner adapter
  const workerLogSuffix =
    workerCount < opts.concurrency ? ` (requested ${opts.concurrency})` : ''
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

  /**
   * Process a single mutant task: check cache, run tests if needed, update cache and progress.
   * This function is designed to be called by multiple workers concurrently.
   */
  async function processTask(task: (typeof tasks)[0]): Promise<void> {
    const { v, tests, key } = task

    log.debug('Cache ' + JSON.stringify(cache))

    // Check if already cached
    const cached = cache[key]
    if (cached) {
      progress.update(cached.status)
      return
    }

    // Skip if no tests import this file
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

    // Run mutant via test runner adapter
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
    cache[key] = {
      status,
      file: v.file,
      line: v.line,
      col: v.col,
      mutator: v.name,
    }
    progress.update(status)
  }

  /**
   * Worker coroutine: process mutant tasks from the queue until exhausted.
   * Multiple workers run concurrently, sharing the task queue.
   */
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
    // Spawn worker coroutines
    for (let i = 0; i < workerCount; i++) workers.push(worker())
    // Wait for all workers to complete
    await Promise.all(workers)
    // Persist results to disk
    await saveCacheAtomic(cwd, cache)
  } finally {
    // Remove signal handlers to avoid double cleanup
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
    if (!signalCleanedUp) {
      finishOnce()
      // Shutdown adapter
      await adapter.shutdown()
      // Clean up all __mutineer__ temp directories
      await cleanupMutineerDirs(cwd)
    }
  }
}
