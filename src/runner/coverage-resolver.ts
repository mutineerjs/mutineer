import path from 'node:path'

import type { ParsedCliOptions } from './args.js'
import type { MutineerConfig } from '../types/config.js'
import type { TestRunnerAdapter } from './types.js'
import {
  loadCoverageData,
  loadPerTestCoverageData,
  type CoverageData,
  type PerTestCoverageMap,
} from '../utils/coverage.js'
import { isCoverageRequestedInArgs } from './vitest/index.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('coverage-resolver')

export interface CoverageResolution {
  coverageData: CoverageData | null
  perTestCoverage: PerTestCoverageMap | null
  enableCoverageForBaseline: boolean
  wantsPerTestCoverage: boolean
  needsCoverageFromBaseline: boolean
}

/**
 * Resolve all coverage-related configuration from CLI options, config, and adapter detection.
 * Returns a unified resolution object used by the orchestrator.
 */
export async function resolveCoverageConfig(
  opts: ParsedCliOptions,
  cfg: MutineerConfig,
  adapter: TestRunnerAdapter,
  cliArgs: readonly string[],
): Promise<CoverageResolution> {
  const coverageConfig = await adapter.detectCoverageConfig()
  const wantsPerTestCoverageFromConfig = coverageConfig.perTestEnabled
  const coveragePreference = cfg.coverage
  const wantsCoverageRun =
    coveragePreference === true
      ? true
      : coveragePreference === false
        ? false
        : isCoverageRequestedInArgs([...cliArgs]) || coverageConfig.coverageEnabled

  // Load pre-existing coverage data if provided
  let coverageData: CoverageData | null = null
  if (opts.coverageFilePath) {
    log.info(`Loading coverage data from ${opts.coverageFilePath}...`)
    coverageData = await loadCoverageData(opts.coverageFilePath, process.cwd())
    log.info(`Loaded coverage for ${coverageData.coveredLines.size} files`)
  }

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
    return {
      coverageData: null,
      perTestCoverage: null,
      enableCoverageForBaseline: false,
      wantsPerTestCoverage: false,
      needsCoverageFromBaseline,
    }
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

  const enableCoverageForBaseline =
    needsCoverageFromBaseline ||
    wantsPerTestCoverage ||
    wantsCoverageRun ||
    (opts.wantsOnlyCoveredLines && hasCoverageProviderInstalled)

  return {
    coverageData,
    perTestCoverage: null,
    enableCoverageForBaseline,
    wantsPerTestCoverage,
    needsCoverageFromBaseline,
  }
}

/**
 * Load coverage data produced during the baseline run.
 * Mutates and returns an updated CoverageResolution.
 */
export async function loadCoverageAfterBaseline(
  resolution: CoverageResolution,
  cwd: string,
): Promise<CoverageResolution> {
  let { coverageData, perTestCoverage } = resolution

  if (resolution.needsCoverageFromBaseline) {
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

  if (resolution.wantsPerTestCoverage) {
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

  return { ...resolution, coverageData, perTestCoverage }
}
