import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

vi.mock('node:fs')

import fs from 'node:fs'
import { resolveWorkerScript } from '../worker-script.js'

const existsSync = vi.mocked(fs.existsSync)

beforeEach(() => {
  existsSync.mockReset()
})

describe('resolveWorkerScript', () => {
  const dir = '/some/dir'

  it('returns .js path when .js exists', () => {
    existsSync.mockImplementation((p) => p === path.join(dir, 'worker.js'))
    expect(resolveWorkerScript(dir, 'worker')).toBe(path.join(dir, 'worker.js'))
  })

  it('returns .mjs path when .js absent but .mjs exists', () => {
    existsSync.mockImplementation((p) => p === path.join(dir, 'worker.mjs'))
    expect(resolveWorkerScript(dir, 'worker')).toBe(
      path.join(dir, 'worker.mjs'),
    )
  })

  it('falls back to .ts path when neither .js nor .mjs exist', () => {
    existsSync.mockReturnValue(false)
    expect(resolveWorkerScript(dir, 'worker')).toBe(path.join(dir, 'worker.ts'))
  })

  it('checks .js before .mjs', () => {
    existsSync.mockReturnValue(true)
    expect(resolveWorkerScript(dir, 'worker')).toBe(path.join(dir, 'worker.js'))
  })

  it('uses the provided basename', () => {
    existsSync.mockReturnValue(false)
    expect(resolveWorkerScript(dir, 'redirect-loader')).toBe(
      path.join(dir, 'redirect-loader.ts'),
    )
  })
})
