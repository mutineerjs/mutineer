import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import fg from 'fast-glob'
import { normalizePath } from '../utils/normalizePath.js'
import type { MutateTarget, MutineerConfig } from '../types/config.js'
import { createLogger } from '../utils/logger.js'

const TEST_PATTERNS_DEFAULT: readonly string[] = [
  '**/*.test.[jt]s?(x)',
  '**/*.spec.[jt]s?(x)',
]
const EXT_DEFAULT: readonly string[] = ['.vue', '.ts', '.js', '.tsx', '.jsx']

// naive but fast: matches `import 'x'` and `import ... from 'x'`
const IMPORT_RE = /import\s+(?:[^'\"]*from\s+)?['\"]([^'\"]+)['\"]/g

type TargetMap = Map<string, MutateTarget>
export type TestMap = Map<string, Set<string>> // key: absolute target file, value: set of absolute test files
export interface DiscoveryResult {
  readonly targets: MutateTarget[]
  readonly testMap: TestMap
}

const log = createLogger('discover')
const MAX_CRAWL_DEPTH = 12

/** A function that resolves an import specifier to an absolute path. */
type ResolveFn = (specOrAbs: string, importer?: string) => Promise<string>

function toArray<T>(v?: readonly T[] | T | null): T[] {
  if (Array.isArray(v)) return [...v]
  if (v === null || v === undefined) return []
  return [v as T]
}

function safeRead(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Type guard to check if a resolved module is a valid absolute path.
 * Used to validate Vite plugin resolution results.
 */
function isValidResolvedPath(resolved: unknown): resolved is string {
  return typeof resolved === 'string' && resolved.length > 0
}

function isUnder(anyAbs: string, rootsAbs: readonly string[]): boolean {
  const n = normalizePath(anyAbs)
  return rootsAbs.some((r) => n.startsWith(normalizePath(r)))
}

function looksLikeVueScriptSetup(p: string): boolean {
  return p.endsWith('.vue')
}

/** Extract import specs from source code (fast, regex-based). */
function extractImportSpecs(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(IMPORT_RE)) {
    if (m && m[1]) out.push(m[1])
  }
  return out
}

/**
 * Check if a path matches any of the exclude patterns.
 * Patterns are matched against the path relative to root.
 */
function isExcludedPath(
  absPath: string,
  rootAbs: string,
  excludePatterns: readonly string[],
): boolean {
  if (!excludePatterns.length) return false
  const rel = path.relative(rootAbs, absPath)
  return excludePatterns.some((pattern) => {
    // Support simple prefix matching (e.g., 'admin' matches 'admin/foo.ts')
    if (!pattern.includes('*')) {
      return rel.startsWith(pattern) || rel.startsWith(pattern + path.sep)
    }
    // For glob patterns, use fast-glob's isDynamicPattern check and simple matching
    return fg.isDynamicPattern(pattern)
      ? new RegExp(
          '^' +
            pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') +
            '(/|$)',
        ).test(rel)
      : rel.startsWith(pattern)
  })
}

// ---------------------------------------------------------------------------
// Resolver strategies
// ---------------------------------------------------------------------------

/**
 * Create a Vite-based resolver using a dev server for alias/tsconfig path resolution.
 * Returns the resolver function and a cleanup function to close the server.
 */
async function createViteResolver(
  rootAbs: string,
  exts: Set<string>,
): Promise<{ resolve: ResolveFn; cleanup: () => Promise<void> }> {
  const { createServer } = await import('vite')
  type PluginOption = import('vite').PluginOption
  type ViteDevServer = import('vite').ViteDevServer

  // Load Vue plugin if needed
  let plugins: PluginOption[] = []
  if (exts.has('.vue')) {
    try {
      const mod = await import(
        /* @vite-ignore */ '@vitejs/plugin-vue' as string
      )
      const vue = (mod as { default?: unknown }).default ?? mod
      plugins = typeof vue === 'function' ? [(vue as () => PluginOption)()] : []
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      log.warn(
        `Unable to load @vitejs/plugin-vue; Vue SFC imports may fail to resolve (${detail})`,
      )
    }
  }

  const quietLogger = {
    hasWarned: false,
    info() {},
    warn() {},
    warnOnce() {},
    error(msg: string | { message?: string }) {
      if (
        typeof msg === 'string' &&
        msg.includes('WebSocket server error') &&
        msg.includes('listen EPERM')
      )
        return
      log.error(typeof msg === 'string' ? msg : String(msg))
    },
    clearScreen() {},
    hasErrorLogged() {
      return false
    },
  }

  const server: ViteDevServer = await createServer({
    root: rootAbs,
    logLevel: 'error',
    customLogger: quietLogger,
    clearScreen: false,
    server: { middlewareMode: true, hmr: false },
    plugins,
  })

  const resolve: ResolveFn = async (specOrAbs, importer) => {
    if (path.isAbsolute(specOrAbs))
      return normalizePath(path.resolve(specOrAbs))
    try {
      const resolved = await server.pluginContainer.resolveId(
        specOrAbs,
        importer,
      )

      let candidateId: string | undefined
      if (isValidResolvedPath(resolved)) {
        candidateId = resolved
      } else if (resolved && typeof resolved === 'object' && 'id' in resolved) {
        const { id } = resolved as { id?: unknown }
        if (isValidResolvedPath(id)) candidateId = id
      }

      if (candidateId) {
        const q = candidateId.indexOf('?')
        return normalizePath(q >= 0 ? candidateId.slice(0, q) : candidateId)
      }

      return normalizePath(specOrAbs)
    } catch {
      return normalizePath(specOrAbs)
    }
  }

  return { resolve, cleanup: () => server.close() }
}

const SUPPORTED_EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx', '.vue'] as const

/**
 * Create a Node-based resolver using createRequire for basic module resolution.
 * Used as a fallback when vite is not installed.
 */
function createNodeResolver(): {
  resolve: ResolveFn
  cleanup: () => Promise<void>
} {
  const resolve: ResolveFn = async (specOrAbs, importer) => {
    if (path.isAbsolute(specOrAbs))
      return normalizePath(path.resolve(specOrAbs))

    // Skip bare specifiers (packages) — we only care about relative imports
    if (!specOrAbs.startsWith('.')) return normalizePath(specOrAbs)

    if (!importer) return normalizePath(specOrAbs)

    const require = createRequire(importer)
    try {
      return normalizePath(require.resolve(specOrAbs))
    } catch {
      // Try with different extensions
      for (const ext of SUPPORTED_EXTENSIONS) {
        try {
          return normalizePath(require.resolve(specOrAbs + ext))
        } catch {
          continue
        }
      }
      return normalizePath(specOrAbs)
    }
  }

  return { resolve, cleanup: async () => {} }
}

/**
 * Try to create a Vite resolver, falling back to Node resolver if vite is not available.
 */
async function createResolver(
  rootAbs: string,
  exts: Set<string>,
): Promise<{ resolve: ResolveFn; cleanup: () => Promise<void> }> {
  try {
    return await createViteResolver(rootAbs, exts)
  } catch {
    log.debug('Vite not available, using Node module resolution for discovery')
    return createNodeResolver()
  }
}

export async function autoDiscoverTargetsAndTests(
  root: string,
  cfg: MutineerConfig,
): Promise<DiscoveryResult> {
  const rootAbs = path.resolve(root)
  const sourceRoots = toArray(cfg.source ?? 'src').map((s) =>
    path.resolve(rootAbs, s),
  )
  const exts = new Set(toArray(cfg.extensions ?? EXT_DEFAULT))
  const testGlobs = toArray(cfg.testPatterns ?? TEST_PATTERNS_DEFAULT)
  const excludePatterns = toArray(cfg.excludePaths)

  // Build ignore patterns for fast-glob
  const defaultIgnore = ['**/node_modules/**', '**/dist/**', '**/.*/**']
  const userIgnore = excludePatterns.map((p) =>
    p.endsWith('**') ? p : `${p}/**`,
  )
  const ignore = [...defaultIgnore, ...userIgnore]

  // 1) locate tests on disk (absolute paths)
  const tests = await fg(testGlobs, {
    cwd: rootAbs,
    absolute: true,
    ignore,
  })
  if (!tests.length) return { targets: [], testMap: new Map() }
  const testSet = new Set(tests.map((t) => normalizePath(t)))

  // 2) Create resolver (Vite if available, otherwise Node-based fallback)
  const { resolve, cleanup } = await createResolver(rootAbs, exts)

  const targets: TargetMap = new Map()
  const testMap: TestMap = new Map()
  const contentCache = new Map<string, string | null>()
  const resolveCache = new Map<string, string>() // key: importer\0spec -> resolved id

  async function crawl(
    absFile: string,
    depth: number,
    seen: Set<string>,
    currentTestAbs: string,
  ) {
    if (depth > MAX_CRAWL_DEPTH) return // sane guard for huge graphs
    const key = normalizePath(absFile)
    if (seen.has(key)) return
    seen.add(key)

    // @todo is listing node_modules

    // if this file is within source and has supported extension, register as target mapped to current test
    const ext = path.extname(absFile)
    if (
      exts.has(ext) &&
      isUnder(absFile, sourceRoots) &&
      fs.existsSync(absFile) &&
      !testSet.has(key) &&
      !isExcludedPath(absFile, rootAbs, excludePatterns)
    ) {
      if (!targets.has(key)) {
        targets.set(key, {
          file: absFile,
          kind: looksLikeVueScriptSetup(absFile)
            ? 'vue:script-setup'
            : 'module',
        })
      }
      if (!testMap.has(key)) testMap.set(key, new Set())
      testMap.get(key)!.add(currentTestAbs)
    }

    // read file content to find further imports (works for .vue too; imports are inside <script>)
    let code = contentCache.get(absFile)
    if (code === undefined) {
      code = safeRead(absFile)
      contentCache.set(absFile, code ?? null)
    }
    if (!code) return

    // find import specs and resolve relative to absFile
    for (const spec of extractImportSpecs(code)) {
      if (!spec) continue
      const cacheKey = `${absFile}\0${spec}`
      let resolved = resolveCache.get(cacheKey)
      if (!resolved) {
        resolved = await resolve(spec, absFile)
        resolveCache.set(cacheKey, resolved)
      }

      // vite ids could be URLs; ensure we turn into absolute disk path when possible
      const next = path.isAbsolute(resolved)
        ? resolved
        : normalizePath(path.resolve(rootAbs, resolved))
      // skip node_modules and virtual ids
      if (next.includes('/node_modules/')) continue
      if (!path.isAbsolute(next)) continue

      await crawl(next, depth + 1, seen, currentTestAbs)
    }
  }

  try {
    for (const testAbs of tests) {
      const seen = new Set<string>()
      // prime with the test's own direct imports
      const code = safeRead(testAbs)
      if (!code) continue

      const firstHop: string[] = []
      for (const spec of extractImportSpecs(code)) {
        if (!spec) continue
        const resolved = await resolve(spec, testAbs)
        const next = path.isAbsolute(resolved)
          ? resolved
          : normalizePath(path.resolve(rootAbs, resolved))
        if (!path.isAbsolute(next)) continue
        firstHop.push(next)
      }

      log.debug(`test ${testAbs} first-hop imports ${firstHop.length}`)
      for (const abs of firstHop) {
        await crawl(abs, 0, seen, testAbs)
      }
    }

    return { targets: Array.from(targets.values()), testMap }
  } finally {
    await cleanup()
  }
}
