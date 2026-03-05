/**
 * CLI Argument Parsing
 *
 * Pure functions for parsing command-line arguments.
 * Easy to test without side effects.
 */

import os from 'node:os'
import type { MutineerConfig } from '../types/config.js'

/**
 * Parsed CLI options for mutation testing.
 */
export interface ParsedCliOptions {
  readonly configPath: string | undefined
  readonly wantsChanged: boolean
  readonly wantsChangedWithDeps: boolean
  readonly wantsOnlyCoveredLines: boolean
  readonly wantsPerTestCoverage: boolean
  readonly coverageFilePath: string | undefined
  readonly concurrency: number
  readonly progressMode: 'bar' | 'list' | 'quiet'
  readonly minKillPercent: number | undefined
  readonly runner: 'vitest' | 'jest'
}

/**
 * Parse a numeric CLI flag value.
 */
export function parseFlagNumber(raw: string, flag: string): number {
  const num = Number(raw)
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid value for ${flag}: ${raw}`)
  }
  return num
}

/**
 * Read a numeric flag from CLI args.
 */
export function readNumberFlag(
  args: readonly string[],
  flag: string,
): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === flag) {
      const value = args[i + 1]
      if (value === undefined)
        throw new Error(`Expected a numeric value after ${flag}`)
      return parseFlagNumber(value, flag)
    }
    if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1)
      return parseFlagNumber(value, flag)
    }
  }
  return undefined
}

/**
 * Read a string flag from CLI args.
 */
export function readStringFlag(
  args: readonly string[],
  flag: string,
  alias?: string,
): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === flag || (alias && arg === alias)) {
      const value = args[i + 1]
      if (value === undefined) {
        throw new Error(`Expected a value after ${arg}`)
      }
      return value
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1)
    }
    if (alias && arg.startsWith(`${alias}=`)) {
      return arg.slice(alias.length + 1)
    }
  }
  return undefined
}

/**
 * Validate a percentage value (0-100).
 */
export function validatePercent(
  value: number | undefined,
  source: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${source}: expected a number between 0 and 100`)
  }
  if (value < 0 || value > 100) {
    throw new Error(
      `Invalid ${source}: expected value between 0 and 100 (received ${value})`,
    )
  }
  return value
}

/**
 * Parse concurrency from CLI args or use default.
 */
export function parseConcurrency(args: readonly string[]): number {
  const concIdx = args.indexOf('--concurrency')
  const userConc =
    concIdx >= 0 ? Math.max(1, parseInt(args[concIdx + 1] || '', 10) || 0) : 0
  const defaultConc = Math.max(1, os.cpus().length - 1)
  return userConc || defaultConc
}

/**
 * Parse progress mode from CLI args.
 */
export function parseProgressMode(
  args: readonly string[],
): 'bar' | 'list' | 'quiet' {
  const progIdx = args.indexOf('--progress')
  const modeArg = progIdx >= 0 ? args[progIdx + 1] || 'bar' : 'bar'
  return modeArg === 'list' ? 'list' : modeArg === 'quiet' ? 'quiet' : 'bar'
}

/**
 * Extract the config file path from CLI args (before full option parsing).
 * Handles --config=path, -c=path, --config path, and -c path.
 */
export function extractConfigPath(args: readonly string[]): string | undefined {
  return readStringFlag(args, '--config', '-c')
}

/**
 * Parse all CLI options.
 */
export function parseCliOptions(
  args: readonly string[],
  cfg: MutineerConfig,
): ParsedCliOptions {
  const configPath = readStringFlag(args, '--config', '-c')
  const wantsChanged = args.includes('--changed')
  const wantsChangedWithDeps = args.includes('--changed-with-deps')
  const wantsOnlyCoveredLines =
    args.includes('--only-covered-lines') || cfg.onlyCoveredLines === true
  const wantsPerTestCoverage =
    args.includes('--per-test-coverage') || cfg.perTestCoverage === true
  const coverageFilePath =
    readStringFlag(args, '--coverage-file') ?? cfg.coverageFile
  const concurrency = parseConcurrency(args)
  const progressMode = parseProgressMode(args)
  const runnerFlag = readStringFlag(args, '--runner')
  const runner =
    runnerFlag === 'jest' || runnerFlag === 'vitest'
      ? runnerFlag
      : cfg.runner === 'jest'
        ? 'jest'
        : 'vitest'

  const cliKillPercent = validatePercent(
    readNumberFlag(args, '--min-kill-percent'),
    '--min-kill-percent',
  )
  const configKillPercent = validatePercent(
    cfg.minKillPercent,
    'mutineer.config minKillPercent',
  )
  const minKillPercent = cliKillPercent ?? configKillPercent

  return {
    configPath,
    wantsChanged,
    wantsChangedWithDeps,
    wantsOnlyCoveredLines,
    wantsPerTestCoverage,
    coverageFilePath,
    concurrency,
    progressMode,
    minKillPercent,
    runner,
  }
}
