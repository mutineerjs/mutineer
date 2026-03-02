/**
 * Jest Test Runner Adapter
 *
 * Implements the TestRunnerAdapter interface for Jest using runCLI.
 * Baseline runs are executed directly via runCLI; mutant runs are delegated
 * to a pool of long-lived worker processes that also use runCLI with a
 * redirect resolver to swap in mutated code.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
// import os from 'node:os'

import { JestPool } from './pool.js'
import type {
  TestRunnerAdapter,
  TestRunnerAdapterOptions,
  MutantPayload,
  MutantRunResult,
  BaselineOptions,
  CoverageConfig,
} from '../types.js'
import { createLogger } from '../../utils/logger.js'

import { JestRunCLI } from './worker-runtime.js'

const require = createRequire(import.meta.url)
const log = createLogger('jest-adapter')

/**
 * Strip mutineer-specific CLI args that shouldn't be passed to Jest.
 */
function stripMutineerArgs(args: string[]): string[] {
  const out: string[] = []
  const consumeNext = new Set([
    '--concurrency',
    '--progress',
    '--min-kill-percent',
    '--config',
    '-c',
    '--coverage-file',
    '--runner',
  ])
  const dropExact = new Set([
    '-m',
    '--mutate',
    '--changed',
    '--changed-with-deps',
    '--only-covered-lines',
    '--per-test-coverage',
    '--perTestCoverage',
  ])

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (dropExact.has(a)) continue
    if (consumeNext.has(a)) {
      i++
      continue
    }
    if (a.startsWith('--min-kill-percent=')) continue
    if (a.startsWith('--config=') || a.startsWith('-c=')) continue
    out.push(a)
  }
  return out
}

type JestArgsMode = 'baseline' | 'baseline-with-coverage'

async function loadRunCLI(
  requireFromCwd: NodeJS.Require,
): Promise<{ runCLI: JestRunCLI }> {
  try {
    return requireFromCwd('@jest/core') as { runCLI: JestRunCLI }
  } catch {
    return import('@jest/core') as unknown as { runCLI: JestRunCLI }
  }
}

/**
 * Build Jest runCLI options for the given mode.
 */
function buildJestCliOptions(
  tests: readonly string[],
  mode: JestArgsMode,
  jestConfigPath?: string,
): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    _: [...tests],
    $0: 'mutineer',
    runInBand: true,
    runTestsByPath: true,
    watch: false,
    passWithNoTests: true,
    testPathPattern: [...tests],
  }

  if (jestConfigPath) {
    opts.config = jestConfigPath
  }

  if (mode === 'baseline-with-coverage') {
    opts.coverage = true
    opts.collectCoverage = true
    opts.coverageProvider = 'v8'
  }

  return opts
}

export class JestAdapter implements TestRunnerAdapter {
  readonly name = 'jest'

  private readonly options: TestRunnerAdapterOptions
  private jestConfigPath?: string
  private pool: JestPool | null = null
  private readonly requireFromCwd: NodeRequire

  constructor(options: TestRunnerAdapterOptions) {
    this.options = options
    this.jestConfigPath = options.config.jestConfig
    stripMutineerArgs(options.cliArgs)
    this.requireFromCwd = createRequire(path.join(options.cwd, 'package.json'))
  }

  async init(concurrencyOverride?: number): Promise<void> {
    const workerCount = Math.max(
      1,
      concurrencyOverride ?? this.options.concurrency,
    )
    this.pool = new JestPool({
      cwd: this.options.cwd,
      concurrency: workerCount,
      jestConfig: this.options.config.jestConfig,
      timeoutMs: this.options.timeoutMs,
    })
    await this.pool.init()
  }

  async runBaseline(
    tests: readonly string[],
    options: BaselineOptions,
  ): Promise<boolean> {
    const mode: JestArgsMode = options.collectCoverage
      ? 'baseline-with-coverage'
      : 'baseline'
    const cliOptions = buildJestCliOptions(tests, mode, this.jestConfigPath)

    try {
      const { runCLI } = await loadRunCLI(this.requireFromCwd)
      const { results } = await runCLI(cliOptions, [this.options.cwd])
      return results.success
    } catch (err) {
      log.debug(
        'Failed to run Jest baseline: ' +
          (err instanceof Error ? err.message : String(err)),
      )
      return false
    }
  }

  async runMutant(
    mutant: MutantPayload,
    tests: readonly string[],
  ): Promise<MutantRunResult> {
    if (!this.pool) {
      throw new Error('JestAdapter not initialized. Call init() first.')
    }

    try {
      const result = await this.pool.run(mutant, [...tests])
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

  async shutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.shutdown()
      this.pool = null
    }
  }

  hasCoverageProvider(): boolean {
    try {
      require.resolve('jest/package.json', { paths: [this.options.cwd] })
      return true
    } catch {
      return false
    }
  }

  async detectCoverageConfig(): Promise<CoverageConfig> {
    const configPath = this.options.config.jestConfig
    if (!configPath) {
      return { perTestEnabled: false, coverageEnabled: false }
    }

    try {
      const abs = path.isAbsolute(configPath)
        ? configPath
        : path.join(this.options.cwd, configPath)
      const content = await fs.readFile(abs, 'utf8')

      const coverageEnabled =
        /collectCoverage\s*:\s*true/.test(content) ||
        /coverageProvider\s*:/.test(content)
      return { perTestEnabled: false, coverageEnabled }
    } catch {
      return { perTestEnabled: false, coverageEnabled: false }
    }
  }
}

export function createJestAdapter(
  options: TestRunnerAdapterOptions,
): JestAdapter {
  return new JestAdapter(options)
}
