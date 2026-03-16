import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { normalizePath } from '../utils/normalizePath.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('changed')

export interface ChangedFilesOptions {
  includeDeps?: boolean
  baseRef?: string
  quiet?: boolean
  /** Max depth for dependency resolution (default: 1, meaning direct imports only) */
  maxDepth?: number
}

// Constants
const NULL_SEP = '\0'
const DEFAULT_BASE_REF = 'main'
const SUPPORTED_EXTENSIONS = ['.ts', '.js', '.vue'] as const
const TEST_FILE_PATTERN = /\.(test|spec)\.(js|ts|vue|mjs|cjs)$/
const IMPORT_PATTERN =
  /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g
const EXPORT_PATTERN = /export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g
const REQUIRE_PATTERN = /require\(['"]([^'"]+)['"]\)/g

/**
 * Recursively resolve local file dependencies starting from a source file.
 * Parses import/export/require statements and follows local references.
 *
 * @param file - Path to the file to analyze
 * @param cwd - Working directory for resolving relative paths
 * @param seen - Set of already-visited files (to prevent infinite recursion)
 * @param maxDepth - Maximum depth to recurse (default: 1, meaning direct imports only)
 * @param currentDepth - Current recursion depth
 * @returns Array of absolute paths to resolved dependencies
 */
function resolveLocalDependencies(
  file: string,
  cwd: string,
  seen = new Set<string>(),
  maxDepth = 1,
  currentDepth = 0,
): string[] {
  // Stop if we've exceeded the max depth
  if (currentDepth >= maxDepth) return []
  // Ignore files that no longer exist (deleted/renamed, etc.)
  if (!fs.existsSync(file)) return []
  if (seen.has(file)) return []
  seen.add(file)

  let content: string
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    // If the file went missing between existsSync and read, just skip it
    return []
  }

  const deps: string[] = []
  const patterns = [IMPORT_PATTERN, EXPORT_PATTERN, REQUIRE_PATTERN]

  for (const pattern of patterns) {
    const matches = content.matchAll(pattern)
    for (const match of matches) {
      const dep = match[1]
      if (!dep.startsWith('.')) continue

      const dir = path.dirname(file)
      const base = dep.replace(/\.(js|ts|mjs|cjs|vue)$/, '')
      const candidates = [dep, ...SUPPORTED_EXTENSIONS.map((ext) => base + ext)]

      let resolvedPath: string | undefined
      for (const candidate of candidates) {
        const abs = normalizePath(path.resolve(dir, candidate))
        if (abs.includes('node_modules') || !abs.startsWith(cwd)) continue
        if (fs.existsSync(abs)) {
          resolvedPath = abs
          break
        }
      }

      if (!resolvedPath) continue
      if (TEST_FILE_PATTERN.test(resolvedPath)) continue

      deps.push(resolvedPath)
      deps.push(
        ...resolveLocalDependencies(
          resolvedPath,
          cwd,
          seen,
          maxDepth,
          currentDepth + 1,
        ),
      )
    }
  }

  return [...new Set(deps)]
}

/**
 * Parse output from git commands using null-separator format.
 */
function splitZ(s: string): string[] {
  return s.split(NULL_SEP).filter(Boolean)
}

/**
 * Execute a git command and return the output or null if command fails.
 */
function runGitCommand(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout : null
}

interface RepoContext {
  repoRoot: string
  workingDir: string
}

/**
 * Find the Git repository root from a given working directory.
 * Tries multiple candidate directories (passed cwd, INIT_CWD, process.cwd(), PWD).
 */
function findRepoContext(passedCwd: string): RepoContext | null {
  const candidates = [
    passedCwd,
    process.env.INIT_CWD,
    process.cwd(),
    process.env.PWD,
  ].filter(Boolean) as string[]

  const seen = new Set<string>()

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) continue
    seen.add(resolved)

    const output = runGitCommand(resolved, ['rev-parse', '--show-toplevel'])
    if (output) {
      return { repoRoot: output.trim(), workingDir: resolved }
    }
  }

  return null
}

/**
 * List all changed files in a Git repository.
 *
 * Returns files that are:
 * - Committed but not yet in baseRef (compared to baseRef...HEAD)
 * - Modified but not yet committed (compared to HEAD)
 * - Untracked but not ignored
 *
 * When includeDeps is true, also includes local dependencies of changed files.
 *
 * @param cwd - Working directory (will search for repo root if needed)
 * @param options - Configuration options
 * @returns Array of absolute paths to changed files
 */
export function listChangedFiles(
  cwd: string,
  options: ChangedFilesOptions = {},
): string[] {
  const repo = findRepoContext(cwd)
  if (!repo) {
    const msg = `Mutineer could not locate a Git repository. Checked: ${cwd}, ${process.env.INIT_CWD}, ${process.cwd()}`
    if (!options.quiet) log.warn(msg)
    return []
  }

  const { repoRoot, workingDir } = repo
  const baseRef = options.baseRef || DEFAULT_BASE_REF

  // Fetch changed files from git
  const diffCommittedOutput = runGitCommand(repoRoot, [
    'diff',
    '-z',
    '--name-only',
    '--diff-filter=ACMR',
    `${baseRef}...HEAD`,
  ])

  const diffWorkingOutput = runGitCommand(repoRoot, [
    'diff',
    '-z',
    '--name-only',
    '--diff-filter=ACMR',
    'HEAD',
  ])

  const untrackedOutput = runGitCommand(repoRoot, [
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
  ])

  // If all git commands failed, return empty
  if (!diffCommittedOutput && !diffWorkingOutput && !untrackedOutput) {
    return []
  }

  // Merge all changed files from different git sources
  const rels = [
    ...(diffCommittedOutput ? splitZ(diffCommittedOutput) : []),
    ...(diffWorkingOutput ? splitZ(diffWorkingOutput) : []),
    ...(untrackedOutput ? splitZ(untrackedOutput) : []),
  ]

  const out = new Set<string>()

  for (const p of rels) {
    const rel = p.replace(/^\.?\//, '')
    const abs = normalizePath(
      path.isAbsolute(rel) ? path.normalize(rel) : path.resolve(repoRoot, rel),
    )

    // Skip deleted / missing
    if (!fs.existsSync(abs)) continue

    out.add(abs)

    if (options.includeDeps && /\.(js|ts|vue|mjs|cjs)$/.test(abs)) {
      const maxDepth = options.maxDepth ?? 1
      const deps = resolveLocalDependencies(
        abs,
        workingDir,
        new Set<string>(),
        maxDepth,
      )
      deps.forEach((dep) => out.add(dep))
    }
  }

  return [...out]
}
