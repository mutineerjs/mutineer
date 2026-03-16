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
import { normalizePath } from '../utils/normalizePath.js'

import { autoDiscoverTargetsAndTests } from './discover.js'
import type { MutateTarget } from '../types/config.js'
import { listChangedFiles } from './changed.js'
import { loadMutineerConfig } from './config.js'
import { createVitestAdapter } from './vitest/index.js'
import { createJestAdapter } from './jest/index.js'
import { createLogger } from '../utils/logger.js'

import { extractConfigPath, parseCliOptions } from './args.js'
import { clearCacheOnStart, readMutantCache } from './cache.js'
import { getTargetFile, enumerateAllVariants } from './variants.js'
import {
  resolveCoverageConfig,
  loadCoverageAfterBaseline,
} from './coverage-resolver.js'
import { prepareTasks } from './tasks.js'
import { executePool } from './pool-executor.js'

const log = createLogger('orchestrator')

// Per-mutant test timeout (ms). Can be overridden with env MUTINEER_MUTANT_TIMEOUT_MS
export function parseMutantTimeoutMs(raw: string | undefined): number {
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 30_000
}
const MUTANT_TIMEOUT_MS = parseMutantTimeoutMs(
  process.env.MUTINEER_MUTANT_TIMEOUT_MS,
)

// Re-export readMutantCache for external use
export { readMutantCache } from './cache.js'

export async function runOrchestrator(cliArgs: string[], cwd: string) {
  // 1. Parse CLI arguments and load configuration
  const cfgPath = extractConfigPath(cliArgs)
  const cfg = await loadMutineerConfig(cwd, cfgPath)
  const opts = parseCliOptions(cliArgs, cfg)

  await clearCacheOnStart(cwd)

  // Create test runner adapter
  const adapter = (
    opts.runner === 'jest' ? createJestAdapter : createVitestAdapter
  )({
    cwd,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeout ?? cfg.timeout ?? MUTANT_TIMEOUT_MS,
    config: cfg,
    cliArgs,
  })

  // 2. Resolve coverage configuration
  const coverage = await resolveCoverageConfig(opts, cfg, adapter, cliArgs)
  if (process.exitCode) return // resolveCoverageConfig sets exitCode on fatal errors

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

  // 3. Enumerate changed files if requested
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

  // 4. Discover targets and tests
  const cache = await readMutantCache(cwd)
  const discovered = await autoDiscoverTargetsAndTests(cwd, cfg)
  const { testMap, directTestMap } = discovered

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
    const testsAbs = testMap.get(normalizePath(absFile))
    if (testsAbs) {
      for (const t of testsAbs) allTestFiles.add(t)
    }
  }
  const baselineTests = Array.from(allTestFiles)

  if (opts.wantsChangedWithDeps) {
    let uncoveredCount = 0
    for (const target of targets) {
      const absFile = normalizePath(
        path.isAbsolute(getTargetFile(target))
          ? getTargetFile(target)
          : path.join(cwd, getTargetFile(target)),
      )
      if (
        changedAbs?.has(absFile) &&
        !testMap.get(normalizePath(absFile))?.size
      ) {
        uncoveredCount++
      }
    }
    if (uncoveredCount > 0) {
      log.info(
        `${uncoveredCount} target(s) from --changed-with-deps have no covering tests and will be skipped`,
      )
    }
  }

  if (!baselineTests.length) {
    log.error(
      'No tests found for the selected targets. Ensure your source files are covered by at least one test file.',
    )
    process.exitCode = 1
    return
  }

  // 5. Run baseline tests (with coverage if needed for filtering)
  log.info(
    `Running ${baselineTests.length} baseline tests${coverage.enableCoverageForBaseline ? ' (collecting coverage)' : ''}\u2026`,
  )

  const baselineOk = await adapter.runBaseline(baselineTests, {
    collectCoverage: coverage.enableCoverageForBaseline,
    perTestCoverage: coverage.wantsPerTestCoverage,
  })
  if (!baselineOk) {
    process.exitCode = 1
    return
  }

  log.info('\u2713 Baseline tests complete')

  // 6. Load coverage from baseline if we generated it
  const updatedCoverage = await loadCoverageAfterBaseline(coverage, cwd)

  // 7. Enumerate mutation variants
  const variants = await enumerateAllVariants({
    cwd,
    targets,
    testMap,
    changedFiles: changedAbs,
    coverageData: updatedCoverage.coverageData,
    config: cfg,
  })

  if (!variants.length) {
    const msg = updatedCoverage.coverageData
      ? 'No mutants to test (all mutations are on uncovered lines). Exiting.'
      : 'No mutants to test. Exiting.'
    log.info(msg)
    return
  }

  // 8. Prepare tasks and execute via worker pool
  const tasks = prepareTasks(
    variants,
    updatedCoverage.perTestCoverage,
    directTestMap,
  )

  await executePool({
    tasks,
    adapter,
    cache,
    concurrency: opts.concurrency,
    progressMode: opts.progressMode,
    minKillPercent: opts.minKillPercent,
    cwd,
  })
}
