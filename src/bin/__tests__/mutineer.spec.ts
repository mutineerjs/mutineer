import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'
import { HELP_TEXT, getVersion } from '../mutineer.js'

describe('HELP_TEXT', () => {
  const flags = [
    '--config',
    '-c',
    '--concurrency',
    '--runner',
    '--progress',
    '--changed',
    '--changed-with-deps',
    '--only-covered-lines',
    '--per-test-coverage',
    '--coverage-file',
    '--min-kill-percent',
    '--help',
    '-h',
    '--version',
    '-V',
  ]

  it.each(flags)('includes %s', (flag) => {
    expect(HELP_TEXT).toContain(flag)
  })

  it('includes all three commands', () => {
    expect(HELP_TEXT).toContain('init')
    expect(HELP_TEXT).toContain('run')
    expect(HELP_TEXT).toContain('clean')
  })

  it('--changed-with-deps description mentions local dependencies', () => {
    expect(HELP_TEXT).toContain('local dependencies')
  })
})

describe('getVersion()', () => {
  it('returns a semver string', () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('matches package.json version', () => {
    const require = createRequire(import.meta.url)
    const pkg = require('../../../package.json') as { version: string }
    expect(getVersion()).toBe(pkg.version)
  })
})
