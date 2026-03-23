import path from 'node:path'
import chalk from 'chalk'
import type { MutantCacheEntry } from '../types/mutant.js'

export interface Summary {
  readonly total: number
  readonly killed: number
  readonly escaped: number
  readonly skipped: number
  readonly timeouts: number
  readonly compileErrors: number
  readonly evaluated: number
  readonly killRate: number
}

const SEPARATOR = '\u2500'.repeat(45)

export function computeSummary(
  cache: Readonly<Record<string, MutantCacheEntry>>,
): Summary {
  const allEntries = Object.values(cache)

  let killed = 0
  let escaped = 0
  let skipped = 0
  let timeouts = 0
  let compileErrors = 0

  for (const entry of allEntries) {
    if (entry.status === 'killed') killed++
    else if (entry.status === 'escaped') escaped++
    else if (entry.status === 'compile-error') compileErrors++
    else if (entry.status === 'timeout') timeouts++
    else skipped++
  }

  const evaluated = killed + escaped
  const total = allEntries.length
  const killRate = evaluated === 0 ? 0 : (killed / evaluated) * 100

  return {
    total,
    killed,
    escaped,
    skipped,
    timeouts,
    compileErrors,
    evaluated,
    killRate,
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`
}

export function printSummary(
  summary: Summary,
  cache?: Readonly<Record<string, MutantCacheEntry>>,
  durationMs?: number,
  opts?: { skipCompileErrors?: boolean },
): void {
  console.log('\n' + chalk.dim(SEPARATOR))
  console.log(chalk.bold(' Mutineer Test Suite Summary'))
  console.log(chalk.dim(SEPARATOR))

  if (summary.total === 0) {
    console.log('\nNo mutants found')
    console.log('\n' + chalk.dim(SEPARATOR) + '\n')
    return
  }

  const cwd = process.cwd()
  const allEntries = cache ? Object.values(cache) : []

  const relativePaths = allEntries.map((e) => path.relative(cwd, e.file))
  const maxPathLen =
    Math.min(Math.max(...relativePaths.map((p) => p.length), 0), 40) || 25
  const maxMutatorLen =
    Math.min(Math.max(...allEntries.map((e) => e.mutator.length), 0), 20) || 10

  function formatRow(entry: MutantCacheEntry) {
    const relativePath = path.relative(cwd, entry.file)
    const location = `${relativePath}@${entry.line},${entry.col}`
    if (entry.status === 'killed') {
      return `${chalk.green('\u2713')} ${location.padEnd(maxPathLen)} ${chalk.dim(entry.mutator.padEnd(maxMutatorLen))}`
    }
    if (entry.status === 'escaped') {
      return `${chalk.red('\u2A2F')} ${location.padEnd(maxPathLen)} ${chalk.dim(entry.mutator.padEnd(maxMutatorLen))}`
    }
    return `${chalk.dim('\u2022')} ${chalk.dim(location.padEnd(maxPathLen))} ${chalk.dim(entry.mutator.padEnd(maxMutatorLen))}`
  }

  const entriesByStatus = {
    killed: [] as MutantCacheEntry[],
    escaped: [] as MutantCacheEntry[],
    compileErrors: [] as MutantCacheEntry[],
    timeouts: [] as MutantCacheEntry[],
    skipped: [] as MutantCacheEntry[],
  }

  for (const entry of allEntries) {
    if (entry.status === 'killed') entriesByStatus.killed.push(entry)
    else if (entry.status === 'escaped') entriesByStatus.escaped.push(entry)
    else if (entry.status === 'compile-error')
      entriesByStatus.compileErrors.push(entry)
    else if (entry.status === 'timeout') entriesByStatus.timeouts.push(entry)
    else entriesByStatus.skipped.push(entry)
  }

  if (entriesByStatus.killed.length) {
    console.log('\n' + chalk.green.bold('Killed Mutants:'))
    for (const entry of entriesByStatus.killed)
      console.log('  ' + formatRow(entry))
  }
  if (entriesByStatus.escaped.length) {
    console.log('\n' + chalk.red.bold('Escaped Mutants:'))
    for (const entry of entriesByStatus.escaped) {
      console.log('  ' + formatRow(entry))
      if (
        entry.originalSnippet !== undefined &&
        entry.mutatedSnippet !== undefined
      ) {
        console.log('    ' + chalk.red('- ' + entry.originalSnippet))
        console.log('    ' + chalk.green('+ ' + entry.mutatedSnippet))
      }
      if (entry.coveringTests?.length) {
        const shown = entry.coveringTests.slice(0, 2)
        for (const t of shown) {
          console.log('    ' + chalk.dim('↳ ' + path.relative(cwd, t)))
        }
        if (entry.coveringTests.length > 2) {
          console.log(
            '    ' + chalk.dim(`  +${entry.coveringTests.length - 2} more`),
          )
        }
      }
    }
  }
  if (entriesByStatus.compileErrors.length && !opts?.skipCompileErrors) {
    console.log('\n' + chalk.dim('Compile Error Mutants (type-filtered):'))
    for (const entry of entriesByStatus.compileErrors)
      console.log('  ' + formatRow(entry))
  }
  if (entriesByStatus.timeouts.length) {
    console.log('\n' + chalk.yellow.bold('Timed Out Mutants:'))
    for (const entry of entriesByStatus.timeouts)
      console.log('  ' + formatRow(entry))
  }
  if (entriesByStatus.skipped.length) {
    console.log('\n' + chalk.dim('Skipped Mutants:'))
    for (const entry of entriesByStatus.skipped)
      console.log('  ' + formatRow(entry))
  }

  console.log('\n' + chalk.dim(SEPARATOR))
  const compileErrorStr =
    summary.compileErrors > 0
      ? `, ${chalk.dim(`Compile Errors: ${summary.compileErrors}`)}`
      : ''
  const timeoutStr = `, ${chalk.yellow(`Timeouts: ${summary.timeouts}`)}`
  console.log(
    `Total: ${summary.total} \u2014 ${chalk.green(`Killed: ${summary.killed}`)}, ${chalk.red(`Escaped: ${summary.escaped}`)}, ${chalk.dim(`Skipped: ${summary.skipped}`)}${timeoutStr}${compileErrorStr}`,
  )

  if (summary.evaluated === 0) {
    console.log(`Kill rate: ${chalk.dim('0.00% (no mutants executed)')}`)
  } else {
    const rateColor =
      summary.killRate >= 80
        ? chalk.green
        : summary.killRate >= 50
          ? chalk.yellow
          : chalk.red
    console.log(
      `Kill rate: ${rateColor(summary.killRate.toFixed(2) + '%')} (${summary.killed}/${summary.evaluated})`,
    )
  }

  if (durationMs !== undefined) {
    console.log(`Duration: ${chalk.cyan(formatDuration(durationMs))}`)
  }

  console.log(chalk.dim(SEPARATOR) + '\n')
}

export interface JsonMutant {
  readonly file: string
  readonly line: number
  readonly col: number
  readonly mutator: string
  readonly status: string
  readonly originalSnippet?: string
  readonly mutatedSnippet?: string
  readonly coveringTests?: readonly string[]
}

export interface JsonReport {
  readonly schemaVersion: 1
  readonly timestamp: string
  readonly durationMs?: number
  readonly summary: Summary
  readonly mutants: JsonMutant[]
}

export function buildJsonReport(
  summary: Summary,
  cache: Readonly<Record<string, MutantCacheEntry>>,
  durationMs?: number,
): JsonReport {
  const mutants: JsonMutant[] = Object.values(cache).map((entry) => ({
    file: entry.file,
    line: entry.line,
    col: entry.col,
    mutator: entry.mutator,
    status: entry.status,
    ...(entry.originalSnippet !== undefined && {
      originalSnippet: entry.originalSnippet,
    }),
    ...(entry.mutatedSnippet !== undefined && {
      mutatedSnippet: entry.mutatedSnippet,
    }),
    ...(entry.coveringTests !== undefined && {
      coveringTests: entry.coveringTests,
    }),
  }))

  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...(durationMs !== undefined && { durationMs }),
    summary,
    mutants,
  }
}

export function summarise(
  cache: Readonly<Record<string, MutantCacheEntry>>,
): Summary {
  const s = computeSummary(cache)
  printSummary(s, cache)
  return s
}
