import { describe, it, expect } from 'vitest'
import { stripMutineerArgs } from '../strip-mutineer-args.js'

describe('stripMutineerArgs', () => {
  describe('dropExact flags', () => {
    it('drops -m', () => {
      expect(stripMutineerArgs(['-m', '--verbose'])).toEqual(['--verbose'])
    })

    it('drops --mutate', () => {
      expect(stripMutineerArgs(['--mutate', '--verbose'])).toEqual([
        '--verbose',
      ])
    })

    it('drops --changed', () => {
      expect(stripMutineerArgs(['--changed'])).toEqual([])
    })

    it('drops --changed-with-imports', () => {
      expect(stripMutineerArgs(['--changed-with-imports'])).toEqual([])
    })

    it('drops --full', () => {
      expect(stripMutineerArgs(['--full'])).toEqual([])
    })

    it('drops --only-covered-lines', () => {
      expect(stripMutineerArgs(['--only-covered-lines'])).toEqual([])
    })

    it('drops --per-test-coverage', () => {
      expect(stripMutineerArgs(['--per-test-coverage'])).toEqual([])
    })

    it('drops --perTestCoverage', () => {
      expect(stripMutineerArgs(['--perTestCoverage'])).toEqual([])
    })
  })

  describe('consumeNext flags (drops flag and its value)', () => {
    it('drops --concurrency and next token', () => {
      expect(stripMutineerArgs(['--concurrency', '4', '--verbose'])).toEqual([
        '--verbose',
      ])
    })

    it('drops --progress and next token', () => {
      expect(stripMutineerArgs(['--progress', 'list'])).toEqual([])
    })

    it('drops --min-kill-percent and next token', () => {
      expect(
        stripMutineerArgs(['--min-kill-percent', '80', '--verbose']),
      ).toEqual(['--verbose'])
    })

    it('drops --config and next token', () => {
      expect(
        stripMutineerArgs(['--config', 'vitest.config.ts', '--verbose']),
      ).toEqual(['--verbose'])
    })

    it('drops -c and next token', () => {
      expect(stripMutineerArgs(['-c', 'vitest.config.ts'])).toEqual([])
    })

    it('drops --coverage-file and next token', () => {
      expect(stripMutineerArgs(['--coverage-file', 'cov.json'])).toEqual([])
    })

    it('drops --report and next token', () => {
      expect(stripMutineerArgs(['--report', 'json', '--verbose'])).toEqual([
        '--verbose',
      ])
    })
  })

  describe('prefix-based drops', () => {
    it('drops --min-kill-percent=N', () => {
      expect(stripMutineerArgs(['--min-kill-percent=80', '--verbose'])).toEqual(
        ['--verbose'],
      )
    })

    it('drops --config=path', () => {
      expect(
        stripMutineerArgs(['--config=vitest.config.ts', '--verbose']),
      ).toEqual(['--verbose'])
    })

    it('drops -c=path', () => {
      expect(stripMutineerArgs(['-c=vitest.config.ts'])).toEqual([])
    })
  })

  describe('pass-through', () => {
    it('keeps unrecognised args unchanged', () => {
      expect(stripMutineerArgs(['--reporter=verbose', '--bail=1'])).toEqual([
        '--reporter=verbose',
        '--bail=1',
      ])
    })

    it('returns empty array for empty input', () => {
      expect(stripMutineerArgs([])).toEqual([])
    })
  })

  describe('extraConsumeNext option', () => {
    it('drops extra consume-next flag and its value', () => {
      expect(
        stripMutineerArgs(['--runner', 'jest', '--verbose'], {
          extraConsumeNext: ['--runner'],
        }),
      ).toEqual(['--verbose'])
    })

    it('drops extra consume-next at end of array without panicking', () => {
      expect(
        stripMutineerArgs(['--runner'], { extraConsumeNext: ['--runner'] }),
      ).toEqual([])
    })
  })

  describe('extraPrefixes option', () => {
    it('drops args matching an extra prefix', () => {
      expect(
        stripMutineerArgs(['--shard=1/4', '--verbose'], {
          extraPrefixes: ['--shard='],
        }),
      ).toEqual(['--verbose'])
    })

    it('drops consume-next and prefix for same runner-specific flag', () => {
      expect(
        stripMutineerArgs(['--shard', '1/4', '--shard=1/4', '--verbose'], {
          extraConsumeNext: ['--shard'],
          extraPrefixes: ['--shard='],
        }),
      ).toEqual(['--verbose'])
    })
  })
})
