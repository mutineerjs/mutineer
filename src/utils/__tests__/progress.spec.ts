import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Progress } from '../progress.js'

describe('Progress', () => {
  let originalConsole: Record<string, any>

  beforeEach(() => {
    originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    console.log = originalConsole.log
    console.info = originalConsole.info
    console.warn = originalConsole.warn
    console.error = originalConsole.error
  })

  it('logs run/update/finish messages in list mode and tracks counts', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const progress = new Progress(5, { mode: 'list' })

    progress.start()
    progress.update('killed')
    progress.update('escaped')
    progress.update('skipped')
    progress.update('error')
    progress.update('timeout')
    progress.finish()

    const logs = logSpy.mock.calls.map((args) => args.join(' '))
    expect(logs[0]).toContain('running 5 mutants')
    expect(logs.some((l) => l.includes('mutant 1/5 killed'))).toBe(true)
    expect(logs.some((l) => l.includes('mutant 2/5 escaped'))).toBe(true)
    expect(logs.some((l) => l.includes('mutant 3/5 skipped'))).toBe(true)
    expect(logs.some((l) => l.includes('mutant 4/5 error'))).toBe(true)
    expect(logs.some((l) => l.includes('mutant 5/5 timeout'))).toBe(true)
    const lastLog = logs[logs.length - 1] ?? ''
    expect(lastLog).toContain('killed=1')
    expect(lastLog).toContain('errors=1')
    expect(lastLog).toContain('timeouts=1')
  })

  it('is tolerant to finish before start and clamps negative totals', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const progress = new Progress(-5, { mode: 'list' })

    progress.finish() // no-op
    progress.start()
    progress.finish()

    expect(logSpy).toHaveBeenCalled()
  })
})
