import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import stripAnsi from 'strip-ansi'
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

  it('ignores update and finish calls when not started', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const progress = new Progress(3, { mode: 'list' })

    progress.update('killed') // no-op: not started
    progress.finish() // no-op: not started

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('ignores duplicate start and calls after finish', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const progress = new Progress(2, { mode: 'list' })

    progress.start()
    progress.start() // no-op: already started
    progress.finish()
    progress.update('killed') // no-op: already finished
    progress.finish() // no-op: already finished

    // Only one start message and one finish message
    const logs = logSpy.mock.calls.map((args) => args.join(' '))
    const startLogs = logs.filter((l) => l.includes('running 2 mutants'))
    expect(startLogs).toHaveLength(1)
  })

  it('uses stdout stream when configured', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const progress = new Progress(1, { mode: 'list', stream: 'stdout' })

    progress.start()
    progress.update('killed')
    progress.finish()

    // Should still log to console (non-TTY path)
    expect(console.log).toHaveBeenCalled()
  })

  it('writes progress bar in TTY mode', () => {
    const writeSpy = vi.fn()
    const fakeStream = {
      isTTY: true,
      write: writeSpy,
      columns: 120,
    }

    // Patch process.stderr to simulate TTY
    const origStderr = process.stderr
    Object.defineProperty(process, 'stderr', {
      value: fakeStream,
      writable: true,
      configurable: true,
    })

    try {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const progress = new Progress(3, { mode: 'bar' })

      progress.start()
      expect(writeSpy).toHaveBeenCalled() // hide cursor + bar
      const hideCursor = writeSpy.mock.calls.find((c: string[]) =>
        c[0].includes('\x1b[?25l'),
      )
      expect(hideCursor).toBeDefined()

      progress.update('killed')
      progress.update('escaped')

      progress.finish()
      // Show cursor on finish
      const showCursor = writeSpy.mock.calls.find((c: string[]) =>
        c[0].includes('\x1b[?25h'),
      )
      expect(showCursor).toBeDefined()

      // Final summary still logged via console.log
      expect(logSpy).toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'stderr', {
        value: origStderr,
        writable: true,
        configurable: true,
      })
    }
  })

  it('defaults to bar mode when no opts provided', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const progress = new Progress(2)
    progress.start()
    // Non-TTY path: logs via console
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('running 2 mutants'),
    )
    progress.finish()
    logSpy.mockRestore()
  })

  it('uses 80 column fallback when stream.columns is undefined', () => {
    const writeSpy = vi.fn()
    const fakeStream = {
      isTTY: true,
      write: writeSpy,
      columns: undefined,
    }

    const origStderr = process.stderr
    Object.defineProperty(process, 'stderr', {
      value: fakeStream,
      writable: true,
      configurable: true,
    })

    try {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const progress = new Progress(3, { mode: 'bar' })
      progress.start()
      // Should not throw; bar rendered with 80 column fallback
      expect(writeSpy).toHaveBeenCalled()
      progress.finish()
    } finally {
      Object.defineProperty(process, 'stderr', {
        value: origStderr,
        writable: true,
        configurable: true,
      })
    }
  })

  it('never writes a line wider than the terminal on very narrow columns', () => {
    const writeSpy = vi.fn()
    const cols = 30
    const fakeStream = {
      isTTY: true,
      write: writeSpy,
      columns: cols,
    }

    const origStderr = process.stderr
    Object.defineProperty(process, 'stderr', {
      value: fakeStream,
      writable: true,
      configurable: true,
    })

    try {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const progress = new Progress(10, { mode: 'bar' })

      progress.start()
      progress.update('killed')
      progress.update('escaped')
      progress.update('error')
      progress.finish()

      const barWrites = writeSpy.mock.calls
        .map((c: string[]) => c[0] as string)
        .filter((s) => s.startsWith('\r\x1b[2K'))
        .map((s) => s.slice('\r\x1b[2K'.length))

      expect(barWrites.length).toBeGreaterThan(0)
      for (const written of barWrites) {
        expect(stripAnsi(written).length).toBeLessThanOrEqual(cols)
      }
    } finally {
      Object.defineProperty(process, 'stderr', {
        value: origStderr,
        writable: true,
        configurable: true,
      })
    }
  })

  it('handles zero total in bar mode', () => {
    const writeSpy = vi.fn()
    const fakeStream = {
      isTTY: true,
      write: writeSpy,
      columns: 80,
    }

    const origStderr = process.stderr
    Object.defineProperty(process, 'stderr', {
      value: fakeStream,
      writable: true,
      configurable: true,
    })

    try {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const progress = new Progress(0, { mode: 'bar' })

      progress.start()
      progress.finish()

      // Should not throw; ratio should be 1 (100%)
      expect(writeSpy).toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'stderr', {
        value: origStderr,
        writable: true,
        configurable: true,
      })
    }
  })
})
