import { describe, it, expect, vi } from 'vitest'
import {
  computeSummary,
  printSummary,
  summarise,
  buildJsonReport,
} from '../summary.js'
import type { MutantCacheEntry } from '../../types/mutant.js'

/** Strip ANSI escape codes for clean text assertions */
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '')

function makeEntry(overrides: Partial<MutantCacheEntry>): MutantCacheEntry {
  return {
    mutator: 'flip',
    file: '/tmp/file.ts',
    line: 1,
    col: 1,
    status: 'killed',
    ...overrides,
  }
}

describe('summary', () => {
  it('computes totals and kill rate', () => {
    const cache = {
      a: makeEntry({ status: 'killed' }),
      b: makeEntry({ status: 'escaped' }),
      c: makeEntry({ status: 'skipped' }),
      d: makeEntry({ status: 'timeout' }),
    }

    const s = computeSummary(cache)

    expect(s).toEqual({
      total: 4,
      killed: 1,
      escaped: 1,
      skipped: 1,
      timeouts: 1,
      compileErrors: 0,
      evaluated: 2,
      killRate: 50,
    })
  })

  it('prints a friendly summary with sections', () => {
    const cache = {
      a: makeEntry({ status: 'killed', file: '/tmp/a.ts' }),
      b: makeEntry({ status: 'escaped', file: '/tmp/b.ts', mutator: 'wrap' }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache, 1500)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('Killed Mutants'))).toBe(true)
    expect(lines.some((l) => l.includes('Escaped Mutants'))).toBe(true)
    expect(lines.some((l) => l.includes('Duration: 1.50s'))).toBe(true)

    logSpy.mockRestore()
  })

  it('prints Timed Out Mutants section when timeouts exist', () => {
    const cache = {
      a: makeEntry({ status: 'timeout', file: '/tmp/a.ts', mutator: 'flip' }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('Timed Out Mutants'))).toBe(true)

    logSpy.mockRestore()
  })

  it('shows Timeouts count in stat line when timeouts > 0', () => {
    const cache = {
      a: makeEntry({ status: 'timeout', file: '/tmp/a.ts' }),
      b: makeEntry({ status: 'killed', file: '/tmp/b.ts' }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('Timeouts: 1'))).toBe(true)

    logSpy.mockRestore()
  })

  it('shows Timeouts: 0 in stat line when timeouts is zero', () => {
    const cache = {
      a: makeEntry({ status: 'killed', file: '/tmp/a.ts' }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('Timeouts: 0'))).toBe(true)

    logSpy.mockRestore()
  })

  it('prints diff lines for escaped mutant with snippets', () => {
    const cache = {
      a: makeEntry({
        status: 'escaped',
        originalSnippet: 'return a + b',
        mutatedSnippet: 'return a - b',
      }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('- return a + b'))).toBe(true)
    expect(lines.some((l) => l.includes('+ return a - b'))).toBe(true)

    logSpy.mockRestore()
  })

  it('does not print diff lines for escaped mutant without snippets', () => {
    const cache = {
      a: makeEntry({ status: 'escaped' }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.trimStart().startsWith('- '))).toBe(false)
    expect(lines.some((l) => l.trimStart().startsWith('+ '))).toBe(false)

    logSpy.mockRestore()
  })

  it('prints covering test path for escaped mutant', () => {
    const cache = {
      a: makeEntry({
        status: 'escaped',
        coveringTests: ['/abs/foo.spec.ts'],
      }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('↳'))).toBe(true)
    expect(lines.some((l) => l.includes('foo.spec.ts'))).toBe(true)

    logSpy.mockRestore()
  })

  it('handles printSummary with no cache argument when total > 0', () => {
    const summary = {
      total: 1,
      killed: 1,
      escaped: 0,
      skipped: 0,
      timeouts: 0,
      compileErrors: 0,
      evaluated: 1,
      killRate: 100,
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    // No cache passed: allEntries=[], maxPathLen=25 (|| 25), maxMutatorLen=10 (|| 10)
    printSummary(summary)
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('buildJsonReport includes passingTests when present', () => {
    const cache = {
      a: makeEntry({
        status: 'escaped',
        file: '/tmp/a.ts',
        mutator: 'flip',
        passingTests: ['Suite > test one'],
      }),
    }
    const summary = computeSummary(cache)
    const report = buildJsonReport(summary, cache)
    expect(report.mutants[0].passingTests).toEqual(['Suite > test one'])
  })

  it('buildJsonReport omits passingTests when absent', () => {
    const cache = { a: makeEntry({ status: 'escaped' }) }
    const summary = computeSummary(cache)
    const report = buildJsonReport(summary, cache)
    expect('passingTests' in report.mutants[0]).toBe(false)
  })

  it('does not print covering tests when array is absent', () => {
    const cache = {
      a: makeEntry({ status: 'escaped' }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('↳'))).toBe(false)

    logSpy.mockRestore()
  })

  it('buildJsonReport includes schemaVersion, timestamp, summary, and mutants', () => {
    const cache = {
      a: makeEntry({ status: 'killed', file: '/tmp/a.ts', mutator: 'flip' }),
      b: makeEntry({ status: 'escaped', file: '/tmp/b.ts', mutator: 'wrap' }),
    }
    const summary = computeSummary(cache)
    const report = buildJsonReport(summary, cache, 1000)

    expect(report.schemaVersion).toBe(1)
    expect(typeof report.timestamp).toBe('string')
    expect(report.durationMs).toBe(1000)
    expect(report.summary).toEqual(summary)
    expect(report.mutants).toHaveLength(2)
  })

  it('buildJsonReport mutant entries have required fields', () => {
    const cache = {
      a: makeEntry({
        status: 'escaped',
        file: '/tmp/a.ts',
        mutator: 'flip',
        originalSnippet: 'a === b',
        mutatedSnippet: 'a !== b',
        coveringTests: ['/tmp/a.spec.ts'],
      }),
    }
    const summary = computeSummary(cache)
    const report = buildJsonReport(summary, cache)
    const mutant = report.mutants[0]

    expect(mutant.file).toBe('/tmp/a.ts')
    expect(mutant.status).toBe('escaped')
    expect(mutant.mutator).toBe('flip')
    expect(mutant.originalSnippet).toBe('a === b')
    expect(mutant.mutatedSnippet).toBe('a !== b')
    expect(mutant.coveringTests).toEqual(['/tmp/a.spec.ts'])
  })

  it('buildJsonReport omits optional fields when absent', () => {
    const cache = { a: makeEntry({ status: 'killed' }) }
    const summary = computeSummary(cache)
    const report = buildJsonReport(summary, cache)

    expect('durationMs' in report).toBe(false)
    expect('originalSnippet' in report.mutants[0]).toBe(false)
    expect('coveringTests' in report.mutants[0]).toBe(false)
  })

  it('prints report hint line', () => {
    const cache = { a: makeEntry({ status: 'killed' }) }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printSummary(summary, cache)

    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(
      lines.some((l) =>
        l.includes('Run with --report json to see full mutation details.'),
      ),
    ).toBe(true)

    logSpy.mockRestore()
  })

  it('summarise returns summary and prints', () => {
    const cache = { a: makeEntry({ status: 'killed' }) }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const s = summarise(cache)

    expect(s.total).toBe(1)
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it('counts compile-error status in compileErrors field', () => {
    const cache = { a: makeEntry({ status: 'compile-error' }) }
    const s = computeSummary(cache)
    expect(s.compileErrors).toBe(1)
    expect(s.killed).toBe(0)
  })

  it('categorizes compile-error entries without throwing in printSummary', () => {
    const cache = {
      a: makeEntry({ status: 'compile-error', file: '/tmp/a.ts' }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    printSummary(summary, cache)
    expect(summary.compileErrors).toBe(1)
    logSpy.mockRestore()
  })

  it('formats duration in minutes when duration >= 60s', () => {
    const cache = { a: makeEntry({ status: 'killed' }) }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    printSummary(summary, cache, 90000) // 90 seconds = 1m 30.0s
    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('1m 30.0s'))).toBe(true)
    logSpy.mockRestore()
  })

  it('prints +N more when escaped mutant has more than 2 covering tests', () => {
    const cache = {
      a: makeEntry({
        status: 'escaped',
        coveringTests: ['/t1.spec.ts', '/t2.spec.ts', '/t3.spec.ts'],
      }),
    }
    const summary = computeSummary(cache)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    printSummary(summary, cache)
    const lines = logSpy.mock.calls.map((c) => stripAnsi(c.join(' ')))
    expect(lines.some((l) => l.includes('+1 more'))).toBe(true)
    logSpy.mockRestore()
  })
})
