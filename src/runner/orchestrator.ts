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
import fs from 'node:fs'
import os from 'node:os'
import { render, type Instance } from 'ink'
import { createElement } from 'react'
import { normalizePath } from '../utils/normalizePath.js'
import { PoolSpinner } from '../utils/PoolSpinner.js'

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
import type { Variant } from '../types/mutant.js'
import { generateSchema } from '../core/schemata.js'
import { getSchemaFilePath } from './shared/mutant-paths.js'
import {
  resolveCoverageConfig,
  loadCoverageAfterBaseline,
} from './coverage-resolver.js'
import { prepareTasks } from './tasks.js'
import { executePool } from './pool-executor.js'
import {
  checkTypes,
  resolveTypescriptEnabled,
  resolveTsconfigPath,
} from './ts-checker.js'

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

  await clearCacheOnStart(cwd, opts.shard)

  // Create test runner adapter
  const vitestProject =
    opts.vitestProject ??
    (typeof cfg.vitestProject === 'string' ? cfg.vitestProject : undefined)

  const adapter = (
    opts.runner === 'jest' ? createJestAdapter : createVitestAdapter
  )({
    cwd,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeout ?? cfg.timeout ?? MUTANT_TIMEOUT_MS,
    config: cfg,
    cliArgs,
    vitestProject,
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
  const cache = await readMutantCache(cwd, opts.shard)
  log.info('Discovering tests...')
  const discovered = await autoDiscoverTargetsAndTests(cwd, cfg, (msg) =>
    log.info(msg),
  )
  const { testMap, directTestMap } = discovered

  const targets: MutateTarget[] = cfg.targets?.length
    ? [...cfg.targets]
    : (cfg.autoDiscover ?? true)
      ? discovered.targets
      : []
  targets.sort((a, b) => getTargetFile(a).localeCompare(getTargetFile(b)))

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
  if (opts.skipBaseline) {
    log.info('Skipping baseline tests (--skip-baseline)')
  } else {
    const baselineMsg = `Running ${baselineTests.length} baseline tests${coverage.enableCoverageForBaseline ? ' (collecting coverage)' : ''}\u2026`
    let baselineSpinner: Instance | null = null
    if (process.stderr.isTTY) {
      baselineSpinner = render(
        createElement(PoolSpinner, { message: baselineMsg }),
        { stdout: process.stderr, stderr: process.stderr },
      )
    } else {
      log.info(baselineMsg)
    }

    let baselineOk: boolean
    try {
      baselineOk = await adapter.runBaseline(baselineTests, {
        collectCoverage: coverage.enableCoverageForBaseline,
        perTestCoverage: coverage.wantsPerTestCoverage,
      })
    } finally {
      baselineSpinner?.unmount()
    }

    if (!baselineOk) {
      process.exitCode = 1
      return
    }

    log.info('\u2713 Baseline tests complete')
  }

  // 6. Load coverage from baseline if we generated it
  const updatedCoverage = await loadCoverageAfterBaseline(coverage, cwd)

  // 7. Enumerate mutation variants
  let variants = await enumerateAllVariants({
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

  // Apply shard filter before type-checking so each shard only processes its own mutants
  if (opts.shard) {
    const { index, total } = opts.shard
    variants = variants.filter((_, i) => i % total === index - 1)
    log.info(`Shard ${index}/${total}: scoped to ${variants.length} variant(s)`)
    if (!variants.length) {
      log.info('No mutants in this shard. Exiting.')
      return
    }
  }

  // TypeScript pre-filtering (filter mutants that produce compile errors)
  const tsEnabled = resolveTypescriptEnabled(opts.typescriptCheck, cfg, cwd)
  let runnableVariants = variants
  if (tsEnabled) {
    // Only return-value mutants change the expression type — operator mutants
    // (equality, arithmetic, logical, etc.) always preserve the type.
    const returnValueVariants = variants.filter((v) =>
      v.name.startsWith('return'),
    )
    log.info(
      `Running TypeScript type checks on ${returnValueVariants.length} return-value mutant(s)...`,
    )
    const tsconfig = resolveTsconfigPath(cfg)
    let tsSpinner: Instance | null = null
    if (process.stderr.isTTY) {
      tsSpinner = render(
        createElement(PoolSpinner, {
          message: `Type checking ${returnValueVariants.length} return-value mutant(s)...`,
        }),
        { stdout: process.stderr, stderr: process.stderr },
      )
    }
    let compileErrorIds: Set<string>
    try {
      compileErrorIds = await checkTypes(returnValueVariants, tsconfig, cwd)
    } finally {
      tsSpinner?.unmount()
    }
    if (compileErrorIds.size > 0) {
      log.info(
        `\u2713 TypeScript: filtered ${compileErrorIds.size} mutant(s) with compile errors`,
      )
      runnableVariants = variants.filter((v) => !compileErrorIds.has(v.id))
      // Pre-populate cache for compile-error mutants so they appear in summary
      const compileErrorVariants = variants.filter((v) =>
        compileErrorIds.has(v.id),
      )
      const compileErrorTasks = prepareTasks(
        compileErrorVariants,
        updatedCoverage.perTestCoverage,
        directTestMap,
      )
      for (const task of compileErrorTasks) {
        cache[task.key] = {
          status: 'compile-error',
          file: task.v.file,
          line: task.v.line,
          col: task.v.col,
          mutator: task.v.name,
        }
      }
    }
  }

  // 9. Generate schema files for each source file
  const fallbackIds = new Set<string>()
  const variantsByFile = new Map<string, Variant[]>()
  for (const v of runnableVariants) {
    const arr = variantsByFile.get(v.file) ?? []
    arr.push(v)
    variantsByFile.set(v.file, arr)
  }
  const results = await Promise.all(
    [...variantsByFile.entries()].map(async ([file, fileVariants]) => {
      try {
        const originalCode = await fs.promises.readFile(file, 'utf8')
        const schemaPath = getSchemaFilePath(file)
        await fs.promises.mkdir(path.dirname(schemaPath), { recursive: true })
        const { schemaCode, fallbackIds: fileFallbacks } = generateSchema(
          originalCode,
          fileVariants,
        )
        await fs.promises.writeFile(schemaPath, schemaCode, 'utf8')
        return fileFallbacks
      } catch {
        return new Set(fileVariants.map((v) => v.id))
      }
    }),
  )
  for (const ids of results) {
    for (const id of ids) fallbackIds.add(id)
  }
  log.debug(
    `Schema: ${runnableVariants.length - fallbackIds.size} embedded, ${fallbackIds.size} fallback`,
  )

  // 10. Prepare tasks and execute via worker pool
  let tasks = prepareTasks(
    runnableVariants,
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
    reportFormat: opts.reportFormat,
    cwd,
    shard: opts.shard,
    fallbackIds,
  })
}
