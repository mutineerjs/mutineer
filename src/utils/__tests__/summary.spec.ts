import { describe, it, expect, vi } from 'vitest'
import { computeSummary, printSummary, summarise } from '../summary.js'
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
    }

    const s = computeSummary(cache)

    expect(s).toEqual({
      total: 3,
      killed: 1,
      escaped: 1,
      skipped: 1,
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

  it('summarise returns summary and prints', () => {
    const cache = { a: makeEntry({ status: 'killed' }) }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const s = summarise(cache)

    expect(s.total).toBe(1)
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })
})
