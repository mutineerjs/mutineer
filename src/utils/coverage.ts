import fs from 'node:fs/promises'
import path from 'node:path'
import { toErrorMessage } from './errors.js'

/**
 * Istanbul coverage format types
 * See: https://istanbul.js.org/docs/advanced/alternative-reporters/
 */

interface IstanbulStatementMap {
  [key: string]: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
}

interface IstanbulFileCoverage {
  path: string
  statementMap: IstanbulStatementMap
  s: Record<string, number> // statement hit counts
  fnMap?: Record<string, unknown>
  f?: Record<string, number>
  branchMap?: Record<string, unknown>
  b?: Record<string, number[]>
}

interface IstanbulCoverageData {
  [filePath: string]: IstanbulFileCoverage
}

export interface CoverageData {
  /** Set of covered lines per file (absolute path -> Set of line numbers) */
  coveredLines: Map<string, Set<number>>
}

/** Per-test coverage map: test file -> file path -> covered lines */
export type PerTestCoverageMap = Map<string, Map<string, Set<number>>>

/**
 * Load and parse Istanbul-format coverage JSON file.
 * Supports both coverage-final.json (from Istanbul) and Vitest's coverage output.
 *
 * @param coverageFile - Path to the coverage JSON file
 * @param cwd - Current working directory for resolving relative paths
 * @returns Parsed coverage data with covered lines per file
 */
export async function loadCoverageData(
  coverageFile: string,
  cwd: string,
): Promise<CoverageData> {
  const absPath = path.isAbsolute(coverageFile)
    ? coverageFile
    : path.join(cwd, coverageFile)

  let raw: string
  try {
    raw = await fs.readFile(absPath, 'utf8')
  } catch (err) {
    throw new Error(
      `Failed to read coverage file "${absPath}": ${toErrorMessage(err)}`,
    )
  }

  let data: IstanbulCoverageData
  try {
    data = JSON.parse(raw) as IstanbulCoverageData
  } catch (err) {
    throw new Error(
      `Failed to parse coverage file "${absPath}" as JSON: ${toErrorMessage(err)}`,
    )
  }

  const coveredLines = new Map<string, Set<number>>()

  for (const [filePath, fileCoverage] of Object.entries(data)) {
    if (!fileCoverage.statementMap || !fileCoverage.s) {
      continue
    }

    const lines = new Set<number>()

    // Extract lines that have been executed (hit count > 0)
    for (const [stmtId, hitCount] of Object.entries(fileCoverage.s)) {
      if (hitCount > 0) {
        const stmt = fileCoverage.statementMap[stmtId]
        if (stmt) {
          // Add all lines covered by this statement
          for (let line = stmt.start.line; line <= stmt.end.line; line++) {
            lines.add(line)
          }
        }
      }
    }

    if (lines.size > 0) {
      // Normalize the file path to absolute
      const absFilePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(cwd, filePath)
      coveredLines.set(absFilePath, lines)
    }
  }

  return { coveredLines }
}

/**
 * Check if a specific line in a file is covered by tests.
 *
 * @param coverage - Coverage data from loadCoverageData
 * @param filePath - Absolute path to the file
 * @param line - Line number to check (1-indexed)
 * @returns true if the line is covered, false otherwise
 */
export function isLineCovered(
  coverage: CoverageData,
  filePath: string,
  line: number,
): boolean {
  const fileLines = coverage.coveredLines.get(filePath)
  if (!fileLines) {
    return false
  }
  return fileLines.has(line)
}

/**
 * Get coverage statistics for a file.
 *
 * @param coverage - Coverage data from loadCoverageData
 * @param filePath - Absolute path to the file
 * @returns Object with covered line count and set of covered lines, or null if file not in coverage
 */
export function getFileCoverageStats(
  coverage: CoverageData,
  filePath: string,
): { count: number; lines: Set<number> } | null {
  const fileLines = coverage.coveredLines.get(filePath)
  if (!fileLines) {
    return null
  }
  return { count: fileLines.size, lines: fileLines }
}

/**
 * Best-effort loader for per-test coverage data.
 * Expects a JSON file with a shape like:
 * {
 *   "tests": {
 *     "/abs/path/to/test.spec.ts": {
 *       "files": {
 *         "/abs/path/to/src/file.ts": { "lines": [1,2,3] }
 *       }
 *     }
 *   }
 * }
 * or a simplified shape:
 * {
 *   "/abs/path/to/test.spec.ts": {
 *     "/abs/path/to/src/file.ts": [1,2,3]
 *   }
 * }
 *
 * Returns a map: testFile -> (filePath -> covered lines).
 */
export async function loadPerTestCoverageData(
  reportsDir: string,
  cwd: string,
): Promise<PerTestCoverageMap | null> {
  const base = path.isAbsolute(reportsDir)
    ? reportsDir
    : path.join(cwd, reportsDir)
  const candidates = [
    path.join(base, 'per-test-coverage.json'),
    path.join(base, 'coverage-per-test.json'),
    path.join(base, 'coverage-final.json'), // fallback if someone writes per-test into the main file
  ]

  const map: PerTestCoverageMap = new Map()
  let loaded = false

  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, 'utf8')
      const data = JSON.parse(raw) as unknown
      ingestPerTestJson(data, map)
      loaded = map.size > 0
      if (loaded) break
    } catch {
      // ignore missing/unreadable candidates
    }
  }

  if (!loaded) {
    // Try scanning coverage/tmp for per-test artifacts
    try {
      const tmpDir = path.join(base, 'tmp')
      const entries = await fs.readdir(tmpDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const p = path.join(tmpDir, entry.name)
        try {
          const raw = await fs.readFile(p, 'utf8')
          const data = JSON.parse(raw) as unknown
          ingestPerTestJson(data, map)
        } catch {
          continue
        }
      }
      loaded = map.size > 0
    } catch {
      // ignore
    }
  }

  return loaded ? map : null
}

function ingestPerTestJson(json: unknown, out: PerTestCoverageMap) {
  if (!json || typeof json !== 'object') return

  // If wrapped under "tests"
  if ('tests' in json && json.tests && typeof json.tests === 'object') {
    ingestTestsObject((json as { tests: unknown }).tests, out)
    return
  }

  // Otherwise treat top-level as tests map
  ingestTestsObject(json, out)
}

function ingestTestsObject(testsObj: unknown, out: PerTestCoverageMap) {
  if (!testsObj || typeof testsObj !== 'object') return
  for (const [testPath, value] of Object.entries(
    testsObj as Record<string, unknown>,
  )) {
    if (!value || typeof value !== 'object') continue

    // Format A: { files: { "/file": { lines: [] } } }
    if ('files' in value && value.files && typeof value.files === 'object') {
      const files = (value as { files: Record<string, unknown> }).files
      const fileMap = ensureTestEntry(out, testPath)
      for (const [filePath, detail] of Object.entries(files)) {
        if (
          detail &&
          typeof detail === 'object' &&
          'lines' in detail &&
          Array.isArray((detail as { lines?: unknown }).lines)
        ) {
          fileMap.set(
            filePath,
            new Set<number>((detail as { lines: number[] }).lines),
          )
        }
      }
      continue
    }

    // Format B: { "/file": [lines] }
    const fileMap = ensureTestEntry(out, testPath)
    for (const [filePath, lines] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (Array.isArray(lines)) {
        fileMap.set(
          filePath,
          new Set<number>(
            lines.filter((n): n is number => Number.isFinite(n as number)),
          ),
        )
      }
    }
  }
}

function ensureTestEntry(
  map: PerTestCoverageMap,
  testPath: string,
): Map<string, Set<number>> {
  if (!map.has(testPath)) {
    map.set(testPath, new Map())
  }
  return map.get(testPath)!
}
