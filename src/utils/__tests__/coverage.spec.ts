import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  loadCoverageData,
  isLineCovered,
  getFileCoverageStats,
  loadPerTestCoverageData,
} from '../coverage.js'

describe('coverage utilities', () => {
  it('loads coverage data and reports covered lines', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const covPath = path.join(tmpDir, 'coverage-final.json')
    const filePath = path.join(tmpDir, 'src', 'file.ts')
    const data = {
      [filePath]: {
        path: filePath,
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
          '1': { start: { line: 5, column: 0 }, end: { line: 5, column: 10 } },
        },
        s: { '0': 1, '1': 0 },
      },
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(covPath, JSON.stringify(data), 'utf8')

    try {
      const coverage = await loadCoverageData(covPath, tmpDir)
      expect(isLineCovered(coverage, filePath, 1)).toBe(true)
      expect(isLineCovered(coverage, filePath, 2)).toBe(true)
      expect(isLineCovered(coverage, filePath, 3)).toBe(false)
      expect(isLineCovered(coverage, filePath, 5)).toBe(false)

      const stats = getFileCoverageStats(coverage, filePath)
      expect(stats?.count).toBe(2)
      expect(stats?.lines.has(1)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns null stats for missing file', () => {
    const coverage = { coveredLines: new Map<string, Set<number>>() }
    expect(getFileCoverageStats(coverage, '/nope.ts')).toBeNull()
  })

  it('loads coverage from a relative path', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const filePath = '/src/file.ts'
    const data = {
      [filePath]: {
        path: filePath,
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { '0': 1 },
      },
    }
    await fs.writeFile(
      path.join(tmpDir, 'cov.json'),
      JSON.stringify(data),
      'utf8',
    )

    try {
      const coverage = await loadCoverageData('cov.json', tmpDir)
      expect(coverage.coveredLines.size).toBeGreaterThan(0)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws on missing coverage file', async () => {
    await expect(
      loadCoverageData('/nonexistent/path.json', '/tmp'),
    ).rejects.toThrow('Failed to read coverage file')
  })

  it('throws on invalid JSON in coverage file', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    await fs.writeFile(path.join(tmpDir, 'bad.json'), 'not json', 'utf8')

    try {
      await expect(
        loadCoverageData(path.join(tmpDir, 'bad.json'), tmpDir),
      ).rejects.toThrow('Failed to parse coverage file')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('skips files with missing statementMap or s', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const data = {
      '/src/nomap.ts': { path: '/src/nomap.ts' },
      '/src/nos.ts': {
        path: '/src/nos.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
      },
    }
    await fs.writeFile(
      path.join(tmpDir, 'cov.json'),
      JSON.stringify(data),
      'utf8',
    )

    try {
      const coverage = await loadCoverageData(
        path.join(tmpDir, 'cov.json'),
        tmpDir,
      )
      expect(coverage.coveredLines.size).toBe(0)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('normalizes relative file paths in coverage data', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const data = {
      'src/relative.ts': {
        path: 'src/relative.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { '0': 1 },
      },
    }
    await fs.writeFile(
      path.join(tmpDir, 'cov.json'),
      JSON.stringify(data),
      'utf8',
    )

    try {
      const coverage = await loadCoverageData(
        path.join(tmpDir, 'cov.json'),
        tmpDir,
      )
      // Should have resolved relative path
      const absPath = path.join(tmpDir, 'src/relative.ts')
      expect(coverage.coveredLines.has(absPath)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('skips files where all statements have zero hits', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const data = {
      '/src/uncovered.ts': {
        path: '/src/uncovered.ts',
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { '0': 0 },
      },
    }
    await fs.writeFile(
      path.join(tmpDir, 'cov.json'),
      JSON.stringify(data),
      'utf8',
    )

    try {
      const coverage = await loadCoverageData(
        path.join(tmpDir, 'cov.json'),
        tmpDir,
      )
      expect(coverage.coveredLines.size).toBe(0)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('isLineCovered returns false for uncovered file', () => {
    const coverage = { coveredLines: new Map<string, Set<number>>() }
    expect(isLineCovered(coverage, '/nonexistent.ts', 1)).toBe(false)
  })

  it('returns null for per-test coverage when no files found', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    await fs.mkdir(path.join(tmpDir, 'empty-reports'), { recursive: true })

    try {
      const map = await loadPerTestCoverageData(
        path.join(tmpDir, 'empty-reports'),
        tmpDir,
      )
      expect(map).toBeNull()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('loads per-test coverage in format B (direct arrays)', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const reportsDir = path.join(tmpDir, 'coverage')
    await fs.mkdir(reportsDir, { recursive: true })

    const formatB = {
      '/test/a.spec.ts': {
        '/src/a.ts': [1, 2, 3],
      },
    }
    await fs.writeFile(
      path.join(reportsDir, 'per-test-coverage.json'),
      JSON.stringify(formatB),
      'utf8',
    )

    try {
      const map = await loadPerTestCoverageData(reportsDir, tmpDir)
      expect(map).not.toBeNull()
      const lines = map!.get('/test/a.spec.ts')!.get('/src/a.ts')
      expect(lines!.has(1)).toBe(true)
      expect(lines!.has(3)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('handles per-test coverage with non-object/null values gracefully', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const reportsDir = path.join(tmpDir, 'coverage')
    await fs.mkdir(reportsDir, { recursive: true })

    const data = {
      '/test/a.spec.ts': null,
      '/test/b.spec.ts': 'not-an-object',
    }
    await fs.writeFile(
      path.join(reportsDir, 'per-test-coverage.json'),
      JSON.stringify(data),
      'utf8',
    )

    try {
      const map = await loadPerTestCoverageData(reportsDir, tmpDir)
      // No valid entries, should return null
      expect(map).toBeNull()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses relative reportsDir when not absolute', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const reportsDir = path.join(tmpDir, 'reports')
    await fs.mkdir(reportsDir, { recursive: true })

    const data = {
      '/test/a.spec.ts': { '/src/a.ts': [1] },
    }
    await fs.writeFile(
      path.join(reportsDir, 'per-test-coverage.json'),
      JSON.stringify(data),
      'utf8',
    )

    try {
      // Pass relative path
      const map = await loadPerTestCoverageData('reports', tmpDir)
      expect(map).not.toBeNull()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('loads per-test coverage data from various shapes', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-coverage-'),
    )
    const reportsDir = path.join(tmpDir, 'coverage')
    await fs.mkdir(reportsDir, { recursive: true })
    const testFile = path.join(tmpDir, 'tests', 'foo.spec.ts')
    const srcFile = path.join(tmpDir, 'src', 'foo.ts')

    // Write per-test-coverage.json (format A)
    const formatA = {
      tests: {
        [testFile]: {
          files: {
            [srcFile]: { lines: [1, 2, 3] },
          },
        },
      },
    }
    await fs.writeFile(
      path.join(reportsDir, 'per-test-coverage.json'),
      JSON.stringify(formatA),
      'utf8',
    )

    // Also drop a tmp file with format B to ensure fallback works when main file is absent
    const tmpSub = path.join(reportsDir, 'tmp')
    await fs.mkdir(tmpSub, { recursive: true })
    const formatB = {
      [testFile]: {
        [srcFile]: [4, 5],
      },
    }
    await fs.writeFile(
      path.join(tmpSub, 'extra.json'),
      JSON.stringify(formatB),
      'utf8',
    )

    try {
      const map = await loadPerTestCoverageData(reportsDir, tmpDir)
      expect(map).not.toBeNull()
      const perTest = map!.get(testFile)
      expect(perTest).toBeDefined()
      const lines = perTest!.get(srcFile)
      expect(lines).toBeDefined()
      // Format A lines present
      expect(lines!.has(1)).toBe(true)
      expect(lines!.has(3)).toBe(true)
      // Fallback not used yet
      expect(lines!.has(4)).toBe(false)

      // Remove primary file to force fallback loading from tmp/extra.json
      await fs.rm(path.join(reportsDir, 'per-test-coverage.json'))
      const fallback = await loadPerTestCoverageData(reportsDir, tmpDir)
      expect(fallback).not.toBeNull()
      const fallbackLines = fallback!.get(testFile)!.get(srcFile)
      expect(fallbackLines!.has(4)).toBe(true)
      expect(fallbackLines!.has(5)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
