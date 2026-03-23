/**
 * Vitest Test Runner Adapter
 *
 * Implements the TestRunnerAdapter interface for Vitest.
 * Handles baseline test runs, mutant execution via worker pool,
 * and coverage configuration detection.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

import { VitestPool } from './pool.js'
import type {
  TestRunnerAdapter,
  TestRunnerAdapterOptions,
  MutantPayload,
  MutantRunResult,
  BaselineOptions,
  CoverageConfig,
} from '../types.js'
import { createLogger } from '../../utils/logger.js'

const require = createRequire(import.meta.url)
const log = createLogger('vitest-adapter')

/**
 * Resolve the Vitest CLI entry point.
 */
function resolveVitestPath(): string {
  try {
    return require.resolve('vitest/vitest.mjs')
  } catch {
    const pkgJson = require.resolve('vitest/package.json')
    return path.join(path.dirname(pkgJson), 'vitest.mjs')
  }
}

/**
 * Strip mutineer-specific CLI args that shouldn't be passed to Vitest.
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
    '--shard',
  ])
  const dropExact = new Set([
    '-m',
    '--mutate',
    '--changed',
    '--changed-with-deps',
    '--full',
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
    if (a.startsWith('--shard=')) continue
    out.push(a)
  }
  return out
}

/**
 * Ensure the Vitest config arg is included if specified.
 */
function ensureConfigArg(
  args: string[],
  vitestConfig?: string,
  cwd?: string,
): string[] {
  if (!vitestConfig) return args
  if (
    args.some(
      (a) =>
        a === '--config' ||
        a === '-c' ||
        a.startsWith('--config=') ||
        a.startsWith('-c='),
    )
  ) {
    return args
  }
  const resolved = cwd ? path.resolve(cwd, vitestConfig) : vitestConfig
  return [...args, '--config', resolved]
}

type VitestArgsMode = 'baseline' | 'baseline-with-coverage'

/**
 * Build Vitest CLI arguments for the given mode.
 */
function buildVitestArgs(args: string[], mode: VitestArgsMode): string[] {
  const result = [...args]
  if (!result.includes('run') && !result.includes('--run'))
    result.unshift('run')
  if (!result.some((a) => a.startsWith('--watch'))) result.push('--watch=false')
  if (!result.some((a) => a.startsWith('--passWithNoTests')))
    result.push('--passWithNoTests')

  if (mode === 'baseline-with-coverage') {
    if (!result.some((a) => a.startsWith('--coverage'))) {
      result.push('--coverage.enabled=true', '--coverage.reporter=json')
    }
    if (!result.some((a) => a.startsWith('--coverage.perTest='))) {
      result.push('--coverage.perTest=true')
    }
    // Disable coverage thresholds so baseline doesn't fail when a broader
    // test set (e.g. from --changed-with-deps) lowers aggregate coverage
    result.push(
      '--coverage.thresholds.lines=0',
      '--coverage.thresholds.functions=0',
      '--coverage.thresholds.branches=0',
      '--coverage.thresholds.statements=0',
    )
  }

  return result
}

/**
 * Vitest adapter implementation.
 */
export class VitestAdapter implements TestRunnerAdapter {
  readonly name = 'vitest'

  private readonly options: TestRunnerAdapterOptions
  private readonly vitestPath: string
  private pool: VitestPool | null = null
  private baseArgs: string[] = []

  constructor(options: TestRunnerAdapterOptions) {
    this.options = options

    try {
      this.vitestPath = resolveVitestPath()
    } catch {
      throw new Error("Cannot find 'vitest'. Install it with: npm i -D vitest")
    }

    // Prepare base args by stripping mutineer-specific flags
    const stripped = stripMutineerArgs(options.cliArgs)
    this.baseArgs = ensureConfigArg(
      stripped,
      options.config.vitestConfig,
      options.cwd,
    )
  }

  async init(concurrencyOverride?: number): Promise<void> {
    const workerCount = Math.max(
      1,
      concurrencyOverride ?? this.options.concurrency,
    )
    this.pool = new VitestPool({
      cwd: this.options.cwd,
      concurrency: workerCount,
      vitestConfig: this.options.config.vitestConfig,
      vitestProject: this.options.vitestProject,
      timeoutMs: this.options.timeoutMs,
    })
    await this.pool.init()
  }

  async runBaseline(
    tests: readonly string[],
    options: BaselineOptions,
  ): Promise<boolean> {
    const mode: VitestArgsMode = options.collectCoverage
      ? 'baseline-with-coverage'
      : 'baseline'
    const args = buildVitestArgs(this.baseArgs, mode)

    return new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = { ...process.env }
      env.VITEST_WATCH = 'false'
      if (!env.CI) env.CI = '1'

      const child = spawn(
        process.execPath,
        [this.vitestPath, ...args, ...tests],
        {
          cwd: this.options.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        },
      )

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      child.on('error', (err: Error) => {
        log.debug('Failed to spawn vitest process: ' + err.message)
        resolve(false)
      })

      child.on('exit', (code: number | null) => {
        if (code !== 0) {
          if (stdoutChunks.length)
            process.stdout.write(Buffer.concat(stdoutChunks))
          if (stderrChunks.length)
            process.stderr.write(Buffer.concat(stderrChunks))
        }
        resolve(code === 0)
      })
    })
  }

  async runMutant(
    mutant: MutantPayload,
    tests: readonly string[],
  ): Promise<MutantRunResult> {
    if (!this.pool) {
      throw new Error('VitestAdapter not initialised. Call init() first.')
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
      if (result.error) {
        return {
          status: 'error',
          durationMs: result.durationMs,
          error: result.error,
        }
      }
      const status = result.killed ? 'killed' : 'escaped'
      return {
        status,
        durationMs: result.durationMs,
        error: result.error,
        ...(!result.killed &&
          result.passingTests && {
            passingTests: result.passingTests,
          }),
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
    const packages = ['@vitest/coverage-v8', '@vitest/coverage-istanbul']
    return packages.some((pkg) => {
      try {
        require.resolve(`${pkg}/package.json`, { paths: [this.options.cwd] })
        return true
      } catch {
        return false
      }
    })
  }

  async detectCoverageConfig(): Promise<CoverageConfig> {
    const configPath = this.options.config.vitestConfig
    if (!configPath) {
      return { perTestEnabled: false, coverageEnabled: false }
    }

    try {
      const abs = path.isAbsolute(configPath)
        ? configPath
        : path.join(this.options.cwd, configPath)
      const content = await fs.readFile(abs, 'utf8')

      const perTestEnabled = /perTest\s*:\s*true/.test(content)

      let coverageEnabled = false
      if (
        !/coverage\s*\.\s*enabled\s*:\s*false/.test(content) &&
        !/coverage\s*:\s*false/.test(content)
      ) {
        coverageEnabled = /coverage\s*:/.test(content)
      }

      return { perTestEnabled, coverageEnabled }
    } catch {
      return { perTestEnabled: false, coverageEnabled: false }
    }
  }
}

/**
 * Check if coverage is requested via CLI args.
 */
export function isCoverageRequestedInArgs(args: string[]): boolean {
  let requested = false
  let disabled = false
  const isFalsey = (v: string | undefined) =>
    typeof v === 'string' && /^(false|0|off)$/i.test(v)

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--no-coverage') {
      disabled = true
      continue
    }
    if (arg === '--coverage') {
      requested = true
      continue
    }
    if (arg === '--coverage.enabled') {
      const next = args[i + 1]
      if (isFalsey(next)) disabled = true
      else requested = true
      continue
    }
    if (arg.startsWith('--coverage.enabled=')) {
      const val = arg.slice('--coverage.enabled='.length)
      if (isFalsey(val)) disabled = true
      else requested = true
      continue
    }
    if (arg.startsWith('--coverage=')) {
      const val = arg.slice('--coverage='.length)
      if (isFalsey(val)) disabled = true
      else requested = true
      continue
    }
    if (arg.startsWith('--coverage.')) {
      requested = true
      continue
    }
  }
  return requested && !disabled
}

/**
 * Factory function for creating VitestAdapter instances.
 */
export function createVitestAdapter(
  options: TestRunnerAdapterOptions,
): VitestAdapter {
  return new VitestAdapter(options)
}
