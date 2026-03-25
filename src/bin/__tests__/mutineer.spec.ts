import { createRequire } from 'node:module'
import readline from 'node:readline'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { HELP_TEXT, getVersion, confirmFullRun } from '../mutineer.js'

describe('HELP_TEXT', () => {
  const flags = [
    '--config',
    '-c',
    '--concurrency',
    '--runner',
    '--progress',
    '--changed',
    '--changed-with-imports',
    '--full',
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

  it('--changed-with-imports description mentions local dependencies', () => {
    expect(HELP_TEXT).toContain('local dependencies')
  })
})

describe('confirmFullRun()', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockTTY(isTTY: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: isTTY,
      configurable: true,
    })
  }

  function mockReadline(answers: string[]): void {
    let callIndex = 0
    vi.spyOn(readline, 'createInterface').mockReturnValue({
      question(_prompt: string, cb: (answer: string) => void) {
        cb(answers[callIndex++] ?? '')
      },
      close: vi.fn(),
    } as unknown as readline.Interface)
  }

  it('returns args unchanged when --changed is present', async () => {
    mockTTY(true)
    const args = ['--changed', '--concurrency', '4']
    expect(await confirmFullRun(args)).toBe(args)
  })

  it('returns args unchanged when --changed-with-imports is present', async () => {
    mockTTY(true)
    const args = ['--changed-with-imports']
    expect(await confirmFullRun(args)).toBe(args)
  })

  it('returns args unchanged when --full is present, skipping prompt', async () => {
    mockTTY(true)
    const createSpy = vi.spyOn(readline, 'createInterface')
    const args = ['--full']
    expect(await confirmFullRun(args)).toBe(args)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('skips prompt and returns args unchanged when stdin is not a TTY', async () => {
    mockTTY(false)
    const createSpy = vi.spyOn(readline, 'createInterface')
    const args = ['--concurrency', '2']
    expect(await confirmFullRun(args)).toBe(args)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('choice 1 (default Enter) returns args unchanged', async () => {
    mockTTY(true)
    mockReadline([''])
    const args = ['--concurrency', '2']
    expect(await confirmFullRun(args)).toEqual(args)
  })

  it('choice 1 returns args unchanged', async () => {
    mockTTY(true)
    mockReadline(['1'])
    const args: string[] = []
    expect(await confirmFullRun(args)).toEqual([])
  })

  it('choice 2 appends --changed', async () => {
    mockTTY(true)
    mockReadline(['2'])
    expect(await confirmFullRun([])).toEqual(['--changed'])
  })

  it('choice 3 appends --changed-with-imports', async () => {
    mockTTY(true)
    mockReadline(['3'])
    expect(await confirmFullRun([])).toEqual(['--changed-with-imports'])
  })

  it('invalid input re-prompts, then accepts valid choice', async () => {
    mockTTY(true)
    mockReadline(['9', 'x', '2'])
    expect(await confirmFullRun([])).toEqual(['--changed'])
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
