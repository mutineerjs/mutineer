import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We need to test with different DEBUG values, so we mock the module dynamically
describe('logger', () => {
  let originalDebug: string | undefined

  beforeEach(() => {
    originalDebug = process.env.MUTINEER_DEBUG
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.MUTINEER_DEBUG
    } else {
      process.env.MUTINEER_DEBUG = originalDebug
    }
  })

  it('info logs to console.log', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { createLogger } = await import('../logger.js')
    const log = createLogger('test')
    log.info('hello %s', 'world')
    expect(spy).toHaveBeenCalledWith('hello %s', 'world')
  })

  it('warn logs to console.warn', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createLogger } = await import('../logger.js')
    const log = createLogger('test')
    log.warn('warning message')
    expect(spy).toHaveBeenCalledWith('warning message')
  })

  it('error logs to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { createLogger } = await import('../logger.js')
    const log = createLogger('test')
    log.error('error message')
    expect(spy).toHaveBeenCalledWith('error message')
  })

  it('debug logs to console.error when DEBUG is enabled', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // DEBUG is a module-level constant, so we check the tag prefix behavior
    const { createLogger, DEBUG } = await import('../logger.js')
    const log = createLogger('mytag')
    log.debug('debug message')
    if (DEBUG) {
      expect(spy).toHaveBeenCalledWith('[mytag] debug message')
    } else {
      // When DEBUG is false, debug should be a no-op
      expect(spy).not.toHaveBeenCalled()
    }
  })

  it('debug includes the tag prefix', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { createLogger, DEBUG } = await import('../logger.js')
    const log = createLogger('custom-tag')
    log.debug('test')
    if (DEBUG) {
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[custom-tag]'))
    }
  })

  it('debug calls console.error when MUTINEER_DEBUG=1', async () => {
    process.env.MUTINEER_DEBUG = '1'
    vi.resetModules()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { createLogger } = await import('../logger.js')
    const log = createLogger('dbg-tag')
    log.debug('debug msg')
    expect(spy).toHaveBeenCalledWith('[dbg-tag] debug msg')
  })
})
