import { describe, it, expect } from 'vitest'
import {
  parseFlagNumber,
  readNumberFlag,
  readStringFlag,
  validatePercent,
  validatePositiveMs,
  parseConcurrency,
  parseProgressMode,
  parseCliOptions,
  extractConfigPath,
  parseShardOption,
} from '../args.js'

describe('parseFlagNumber', () => {
  it('parses valid integers', () => {
    expect(parseFlagNumber('42', '--flag')).toBe(42)
  })

  it('parses valid floats', () => {
    expect(parseFlagNumber('3.14', '--flag')).toBe(3.14)
  })

  it('parses zero', () => {
    expect(parseFlagNumber('0', '--flag')).toBe(0)
  })

  it('parses negative numbers', () => {
    expect(parseFlagNumber('-5', '--flag')).toBe(-5)
  })

  it('throws on non-numeric strings', () => {
    expect(() => parseFlagNumber('abc', '--flag')).toThrow(
      'Invalid value for --flag: abc',
    )
  })

  it('parses empty string as 0', () => {
    // Number('') === 0, which is finite
    expect(parseFlagNumber('', '--flag')).toBe(0)
  })

  it('throws on NaN-producing values', () => {
    expect(() => parseFlagNumber('not-a-number', '--flag')).toThrow(
      'Invalid value for --flag: not-a-number',
    )
  })

  it('throws on Infinity', () => {
    expect(() => parseFlagNumber('Infinity', '--flag')).toThrow(
      'Invalid value for --flag: Infinity',
    )
  })
})

describe('readNumberFlag', () => {
  it('reads flag with separate value', () => {
    expect(readNumberFlag(['--count', '5'], '--count')).toBe(5)
  })

  it('reads flag with = syntax', () => {
    expect(readNumberFlag(['--count=10'], '--count')).toBe(10)
  })

  it('returns undefined when flag is not present', () => {
    expect(readNumberFlag(['--other', '5'], '--count')).toBeUndefined()
  })

  it('throws when no value follows flag', () => {
    expect(() => readNumberFlag(['--count'], '--count')).toThrow(
      'Expected a numeric value after --count',
    )
  })

  it('throws when value is not a number', () => {
    expect(() => readNumberFlag(['--count', 'abc'], '--count')).toThrow(
      'Invalid value for --count: abc',
    )
  })
})

describe('readStringFlag', () => {
  it('reads flag with separate value', () => {
    expect(readStringFlag(['--config', 'path.ts'], '--config')).toBe('path.ts')
  })

  it('reads flag with = syntax', () => {
    expect(readStringFlag(['--config=path.ts'], '--config')).toBe('path.ts')
  })

  it('reads alias', () => {
    expect(readStringFlag(['-c', 'path.ts'], '--config', '-c')).toBe('path.ts')
  })

  it('reads alias with = syntax', () => {
    expect(readStringFlag(['-c=path.ts'], '--config', '-c')).toBe('path.ts')
  })

  it('returns undefined when flag is not present', () => {
    expect(readStringFlag(['--other', 'val'], '--config')).toBeUndefined()
  })

  it('throws when no value follows flag', () => {
    expect(() => readStringFlag(['--config'], '--config')).toThrow(
      'Expected a value after --config',
    )
  })

  it('throws when no value follows alias', () => {
    expect(() => readStringFlag(['-c'], '--config', '-c')).toThrow(
      'Expected a value after -c',
    )
  })
})

describe('validatePercent', () => {
  it('returns undefined for undefined', () => {
    expect(validatePercent(undefined, 'test')).toBeUndefined()
  })

  it('returns the value for valid percentages', () => {
    expect(validatePercent(0, 'test')).toBe(0)
    expect(validatePercent(50, 'test')).toBe(50)
    expect(validatePercent(100, 'test')).toBe(100)
  })

  it('throws for negative values', () => {
    expect(() => validatePercent(-1, 'test')).toThrow(
      'Invalid test: expected value between 0 and 100 (received -1)',
    )
  })

  it('throws for values over 100', () => {
    expect(() => validatePercent(101, 'test')).toThrow(
      'Invalid test: expected value between 0 and 100 (received 101)',
    )
  })

  it('throws for non-finite values', () => {
    expect(() => validatePercent(NaN, 'test')).toThrow(
      'Invalid test: expected a number between 0 and 100',
    )
    expect(() => validatePercent(Infinity, 'test')).toThrow(
      'Invalid test: expected a number between 0 and 100',
    )
  })
})

describe('parseConcurrency', () => {
  it('returns default when flag not present', () => {
    const result = parseConcurrency([])
    expect(result).toBeGreaterThanOrEqual(1)
  })

  it('parses explicit concurrency', () => {
    expect(parseConcurrency(['--concurrency', '4'])).toBe(4)
  })

  it('clamps to minimum of 1', () => {
    expect(parseConcurrency(['--concurrency', '0'])).toBeGreaterThanOrEqual(1)
  })

  it('handles invalid concurrency value gracefully', () => {
    const result = parseConcurrency(['--concurrency', 'abc'])
    expect(result).toBeGreaterThanOrEqual(1)
  })
})

describe('parseProgressMode', () => {
  it('returns bar by default', () => {
    expect(parseProgressMode([])).toBe('bar')
  })

  it('returns list when specified', () => {
    expect(parseProgressMode(['--progress', 'list'])).toBe('list')
  })

  it('returns quiet when specified', () => {
    expect(parseProgressMode(['--progress', 'quiet'])).toBe('quiet')
  })

  it('returns bar for unknown values', () => {
    expect(parseProgressMode(['--progress', 'unknown'])).toBe('bar')
  })

  it('defaults to bar when --progress has no following value', () => {
    expect(parseProgressMode(['--progress'])).toBe('bar')
  })
})

describe('parseCliOptions', () => {
  const emptyCfg = {} as any

  it('parses --changed flag', () => {
    const opts = parseCliOptions(['--changed'], emptyCfg)
    expect(opts.wantsChanged).toBe(true)
    expect(opts.wantsChangedWithDeps).toBe(false)
  })

  it('parses --changed-with-deps flag', () => {
    const opts = parseCliOptions(['--changed-with-deps'], emptyCfg)
    expect(opts.wantsChangedWithDeps).toBe(true)
  })

  it('parses --only-covered-lines flag', () => {
    const opts = parseCliOptions(['--only-covered-lines'], emptyCfg)
    expect(opts.wantsOnlyCoveredLines).toBe(true)
  })

  it('reads onlyCoveredLines from config', () => {
    const opts = parseCliOptions([], { onlyCoveredLines: true } as any)
    expect(opts.wantsOnlyCoveredLines).toBe(true)
  })

  it('parses --per-test-coverage flag', () => {
    const opts = parseCliOptions(['--per-test-coverage'], emptyCfg)
    expect(opts.wantsPerTestCoverage).toBe(true)
  })

  it('reads perTestCoverage from config', () => {
    const opts = parseCliOptions([], { perTestCoverage: true } as any)
    expect(opts.wantsPerTestCoverage).toBe(true)
  })

  it('parses --coverage-file flag', () => {
    const opts = parseCliOptions(['--coverage-file', 'coverage.json'], emptyCfg)
    expect(opts.coverageFilePath).toBe('coverage.json')
  })

  it('reads coverageFile from config', () => {
    const opts = parseCliOptions([], { coverageFile: 'cov.json' } as any)
    expect(opts.coverageFilePath).toBe('cov.json')
  })

  it('CLI coverage-file takes precedence over config', () => {
    const opts = parseCliOptions(['--coverage-file', 'cli.json'], {
      coverageFile: 'config.json',
    } as any)
    expect(opts.coverageFilePath).toBe('cli.json')
  })

  it('parses --runner vitest', () => {
    const opts = parseCliOptions(['--runner', 'vitest'], emptyCfg)
    expect(opts.runner).toBe('vitest')
  })

  it('parses --runner jest', () => {
    const opts = parseCliOptions(['--runner', 'jest'], emptyCfg)
    expect(opts.runner).toBe('jest')
  })

  it('falls back to config runner', () => {
    const opts = parseCliOptions([], { runner: 'jest' } as any)
    expect(opts.runner).toBe('jest')
  })

  it('defaults to vitest', () => {
    const opts = parseCliOptions([], emptyCfg)
    expect(opts.runner).toBe('vitest')
  })

  it('parses --config flag', () => {
    const opts = parseCliOptions(['--config', 'my.config.ts'], emptyCfg)
    expect(opts.configPath).toBe('my.config.ts')
  })

  it('parses -c alias', () => {
    const opts = parseCliOptions(['-c', 'my.config.ts'], emptyCfg)
    expect(opts.configPath).toBe('my.config.ts')
  })

  it('parses --min-kill-percent from CLI', () => {
    const opts = parseCliOptions(['--min-kill-percent', '80'], emptyCfg)
    expect(opts.minKillPercent).toBe(80)
  })

  it('reads minKillPercent from config', () => {
    const opts = parseCliOptions([], { minKillPercent: 75 } as any)
    expect(opts.minKillPercent).toBe(75)
  })

  it('CLI min-kill-percent takes precedence over config', () => {
    const opts = parseCliOptions(['--min-kill-percent', '90'], {
      minKillPercent: 75,
    } as any)
    expect(opts.minKillPercent).toBe(90)
  })

  it('rejects invalid --min-kill-percent', () => {
    expect(() =>
      parseCliOptions(['--min-kill-percent', '150'], emptyCfg),
    ).toThrow('expected value between 0 and 100')
  })

  it('parses --timeout flag', () => {
    const opts = parseCliOptions(['--timeout', '5000'], emptyCfg)
    expect(opts.timeout).toBe(5000)
  })

  it('parses --timeout with = syntax', () => {
    const opts = parseCliOptions(['--timeout=5000'], emptyCfg)
    expect(opts.timeout).toBe(5000)
  })

  it('returns undefined timeout when flag absent', () => {
    const opts = parseCliOptions([], emptyCfg)
    expect(opts.timeout).toBeUndefined()
  })

  it('config timeout does not affect opts.timeout (resolved in orchestrator)', () => {
    const opts = parseCliOptions([], { timeout: 10000 } as any)
    expect(opts.timeout).toBeUndefined()
  })

  it('rejects --timeout 0', () => {
    expect(() => parseCliOptions(['--timeout', '0'], emptyCfg)).toThrow(
      'expected a positive number',
    )
  })

  it('rejects --timeout -1', () => {
    expect(() => parseCliOptions(['--timeout', '-1'], emptyCfg)).toThrow(
      'expected a positive number',
    )
  })

  it('rejects --timeout abc', () => {
    expect(() => parseCliOptions(['--timeout', 'abc'], emptyCfg)).toThrow(
      'Invalid value for --timeout: abc',
    )
  })

  it('defaults reportFormat to text', () => {
    const opts = parseCliOptions([], emptyCfg)
    expect(opts.reportFormat).toBe('text')
  })

  it('parses --report json', () => {
    const opts = parseCliOptions(['--report', 'json'], emptyCfg)
    expect(opts.reportFormat).toBe('json')
  })

  it('reads report from config', () => {
    const opts = parseCliOptions([], { report: 'json' } as any)
    expect(opts.reportFormat).toBe('json')
  })

  it('CLI --report takes precedence over config', () => {
    const opts = parseCliOptions(['--report', 'json'], {
      report: 'text',
    } as any)
    expect(opts.reportFormat).toBe('json')
  })

  it('parses --typescript flag', () => {
    const opts = parseCliOptions(['--typescript'], emptyCfg)
    expect(opts.typescriptCheck).toBe(true)
  })

  it('parses --no-typescript flag', () => {
    const opts = parseCliOptions(['--no-typescript'], emptyCfg)
    expect(opts.typescriptCheck).toBe(false)
  })

  it('defaults typescriptCheck to undefined', () => {
    const opts = parseCliOptions([], emptyCfg)
    expect(opts.typescriptCheck).toBeUndefined()
  })

  it('--typescript takes precedence over --no-typescript (first one wins)', () => {
    const opts = parseCliOptions(['--typescript', '--no-typescript'], emptyCfg)
    expect(opts.typescriptCheck).toBe(true)
  })

  it('parses --vitest-project flag', () => {
    const opts = parseCliOptions(['--vitest-project', 'my-pkg'], emptyCfg)
    expect(opts.vitestProject).toBe('my-pkg')
  })

  it('defaults vitestProject to undefined', () => {
    const opts = parseCliOptions([], emptyCfg)
    expect(opts.vitestProject).toBeUndefined()
  })

  it('parses --skip-baseline flag', () => {
    const opts = parseCliOptions(['--skip-baseline'], emptyCfg)
    expect(opts.skipBaseline).toBe(true)
  })

  it('defaults skipBaseline to false', () => {
    const opts = parseCliOptions([], emptyCfg)
    expect(opts.skipBaseline).toBe(false)
  })
})

describe('validatePositiveMs', () => {
  it('returns undefined for undefined', () => {
    expect(validatePositiveMs(undefined, 'test')).toBeUndefined()
  })

  it('returns the value for a positive number', () => {
    expect(validatePositiveMs(5000, '--timeout')).toBe(5000)
    expect(validatePositiveMs(1, '--timeout')).toBe(1)
  })

  it('throws for zero', () => {
    expect(() => validatePositiveMs(0, '--timeout')).toThrow(
      'Invalid --timeout: expected a positive number (received 0)',
    )
  })

  it('throws for negative values', () => {
    expect(() => validatePositiveMs(-1, '--timeout')).toThrow(
      'Invalid --timeout: expected a positive number (received -1)',
    )
  })

  it('throws for non-finite values', () => {
    expect(() => validatePositiveMs(Infinity, '--timeout')).toThrow(
      'Invalid --timeout: expected a positive number',
    )
    expect(() => validatePositiveMs(NaN, '--timeout')).toThrow(
      'Invalid --timeout: expected a positive number',
    )
  })
})

describe('parseShardOption', () => {
  it('returns undefined when --shard is absent', () => {
    expect(parseShardOption([])).toBeUndefined()
    expect(parseShardOption(['--runner', 'vitest'])).toBeUndefined()
  })

  it('parses valid shard with space syntax', () => {
    expect(parseShardOption(['--shard', '1/2'])).toEqual({ index: 1, total: 2 })
    expect(parseShardOption(['--shard', '2/2'])).toEqual({ index: 2, total: 2 })
    expect(parseShardOption(['--shard', '3/4'])).toEqual({ index: 3, total: 4 })
  })

  it('parses valid shard with = syntax', () => {
    expect(parseShardOption(['--shard=1/2'])).toEqual({ index: 1, total: 2 })
  })

  it('throws on 5/4 (index > total)', () => {
    expect(() => parseShardOption(['--shard', '5/4'])).toThrow(
      'Invalid --shard',
    )
  })

  it('throws on 0/4 (index < 1)', () => {
    expect(() => parseShardOption(['--shard', '0/4'])).toThrow(
      'Invalid --shard',
    )
  })

  it('throws on 1/0 (total < 1)', () => {
    expect(() => parseShardOption(['--shard', '1/0'])).toThrow(
      'Invalid --shard',
    )
  })

  it('throws on bad format', () => {
    expect(() => parseShardOption(['--shard', 'bad'])).toThrow(
      'Invalid --shard format',
    )
    expect(() => parseShardOption(['--shard', '1-2'])).toThrow(
      'Invalid --shard format',
    )
  })
})

describe('parseCliOptions shard', () => {
  const emptyCfg = {} as any

  it('parses --shard into opts.shard', () => {
    const opts = parseCliOptions(['--shard', '2/4'], emptyCfg)
    expect(opts.shard).toEqual({ index: 2, total: 4 })
  })

  it('opts.shard is undefined when flag absent', () => {
    const opts = parseCliOptions([], emptyCfg)
    expect(opts.shard).toBeUndefined()
  })
})

describe('extractConfigPath', () => {
  it('extracts --config with separate value', () => {
    expect(extractConfigPath(['--config', 'my.config.ts'])).toBe('my.config.ts')
  })

  it('extracts --config with = syntax', () => {
    expect(extractConfigPath(['--config=my.config.ts'])).toBe('my.config.ts')
  })

  it('extracts -c alias with separate value', () => {
    expect(extractConfigPath(['-c', 'my.config.ts'])).toBe('my.config.ts')
  })

  it('extracts -c alias with = syntax', () => {
    expect(extractConfigPath(['-c=my.config.ts'])).toBe('my.config.ts')
  })

  it('returns undefined when no config flag is present', () => {
    expect(
      extractConfigPath(['--changed', '--runner', 'vitest']),
    ).toBeUndefined()
  })

  it('returns undefined for empty args', () => {
    expect(extractConfigPath([])).toBeUndefined()
  })
})
