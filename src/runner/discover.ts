import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import fg from 'fast-glob'
import { normalizePath } from '../utils/normalizePath.js'
import type { MutateTarget, MutineerConfig } from '../types/config.js'
import { createLogger } from '../utils/logger.js'
import { toErrorMessage } from '../utils/errors.js'

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
  readonly directTestMap: TestMap
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

type CompiledExcludePattern =
  | { readonly kind: 'prefix'; readonly prefix: string }
  | { readonly kind: 'regex'; readonly regex: RegExp }

function compileExcludePatterns(
  patterns: readonly string[],
): CompiledExcludePattern[] {
  return patterns.map((pattern) => {
    if (!pattern.includes('*')) return { kind: 'prefix', prefix: pattern }
    if (fg.isDynamicPattern(pattern)) {
      return {
        kind: 'regex',
        regex: new RegExp(
          '^' +
            pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') +
            '(/|$)',
        ),
      }
    }
    return { kind: 'prefix', prefix: pattern }
  })
}

/**
 * Check if a path matches any of the pre-compiled exclude patterns.
 * Patterns are matched against the path relative to root.
 */
function isExcludedPath(
  absPath: string,
  rootAbs: string,
  compiledPatterns: readonly CompiledExcludePattern[],
): boolean {
  if (!compiledPatterns.length) return false
  const rel = path.relative(rootAbs, absPath)
  return compiledPatterns.some((p) => {
    if (p.kind === 'prefix') {
      return rel.startsWith(p.prefix) || rel.startsWith(p.prefix + path.sep)
    }
    return p.regex.test(rel)
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
    const vueFiles = await fg(['**/*.vue'], {
      cwd: rootAbs,
      onlyFiles: true,
      ignore: ['**/node_modules/**'],
      deep: 5,
    })
    if (vueFiles.length > 0) {
      try {
        const req = createRequire(path.join(rootAbs, 'package.json'))
        const vuePkgPath = req.resolve('@vitejs/plugin-vue')
        const mod = await import(/* @vite-ignore */ vuePkgPath as string)
        const vue = (mod as { default?: unknown }).default ?? mod
        plugins =
          typeof vue === 'function' ? [(vue as () => PluginOption)()] : []
      } catch (err) {
        log.warn(
          `Unable to load @vitejs/plugin-vue; Vue SFC imports may fail to resolve (${toErrorMessage(err)})`,
        )
      }
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
        const resolvedPath = normalizePath(
          q >= 0 ? candidateId.slice(0, q) : candidateId,
        )
        // ESM TS pattern: Vite may echo back the .js spec; check if .ts file exists instead
        if (
          specOrAbs.endsWith('.js') &&
          importer &&
          !fs.existsSync(resolvedPath)
        ) {
          const tsAbs = path.resolve(
            path.dirname(importer),
            specOrAbs.slice(0, -3) + '.ts',
          )
          if (fs.existsSync(tsAbs)) return normalizePath(tsAbs)
        }
        return resolvedPath
      }

      // ESM TS pattern: Vite returned no result; check if .ts file exists
      if (specOrAbs.endsWith('.js') && importer) {
        const tsAbs = path.resolve(
          path.dirname(importer),
          specOrAbs.slice(0, -3) + '.ts',
        )
        if (fs.existsSync(tsAbs)) return normalizePath(tsAbs)
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
      // ESM TS pattern: import written as ./foo.js but file is ./foo.ts
      if (specOrAbs.endsWith('.js')) {
        try {
          return normalizePath(require.resolve(specOrAbs.slice(0, -3) + '.ts'))
        } catch {
          /* continue to extension loop */
        }
      }
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
  onProgress?: (msg: string) => void,
): Promise<DiscoveryResult> {
  const rootAbs = path.resolve(root)
  const sourceRoots = toArray(cfg.source ?? 'src').map((s) =>
    path.resolve(rootAbs, s),
  )
  const exts = new Set(toArray(cfg.extensions ?? EXT_DEFAULT))
  const testGlobs = toArray(cfg.testPatterns ?? TEST_PATTERNS_DEFAULT)
  const excludePatterns = toArray(cfg.excludePaths)
  const compiledExcludePatterns = compileExcludePatterns(excludePatterns)

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
  if (!tests.length)
    return { targets: [], testMap: new Map(), directTestMap: new Map() }
  const testSet = new Set(tests.map((t) => normalizePath(t)))
  onProgress?.(`Found ${tests.length} test file(s), resolving imports...`)

  // 2) Create resolver (Vite if available, otherwise Node-based fallback)
  const { resolve, cleanup } = await createResolver(rootAbs, exts)

  const targets: TargetMap = new Map()
  const testMap: TestMap = new Map()
  const directTestMap: TestMap = new Map()
  const contentCache = new Map<string, string | null>()
  const resolveCache = new Map<string, string>() // key: importer\0spec -> resolved id
  const childrenCache = new Map<string, string[]>() // key: normalized file -> resolved child abs paths

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
      !isExcludedPath(absFile, rootAbs, compiledExcludePatterns)
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
      if (depth === 0) {
        if (!directTestMap.has(key)) directTestMap.set(key, new Set())
        directTestMap.get(key)!.add(currentTestAbs)
      }
    }

    // read file content to find further imports (works for .vue too; imports are inside <script>)
    let code = contentCache.get(absFile)
    if (code === undefined) {
      code = safeRead(absFile)
      contentCache.set(absFile, code ?? null)
    }
    if (!code) return

    // find import specs and resolve relative to absFile, memoized per file
    let children = childrenCache.get(key)
    if (children === undefined) {
      const resolved: string[] = []
      for (const spec of extractImportSpecs(code)) {
        if (!spec) continue
        const cacheKey = `${absFile}\0${spec}`
        let resolvedId = resolveCache.get(cacheKey)
        if (!resolvedId) {
          resolvedId = await resolve(spec, absFile)
          resolveCache.set(cacheKey, resolvedId)
        }
        // vite ids could be URLs; ensure we turn into absolute disk path when possible
        const next = path.isAbsolute(resolvedId)
          ? resolvedId
          : normalizePath(path.resolve(rootAbs, resolvedId))
        // skip node_modules and virtual ids
        if (next.includes('/node_modules/')) continue
        if (!path.isAbsolute(next)) continue
        resolved.push(next)
      }
      childrenCache.set(key, resolved)
      children = resolved
    }
    await Promise.all(
      children.map((next) => crawl(next, depth + 1, seen, currentTestAbs)),
    )
  }

  try {
    await Promise.all(
      tests.map(async (testAbs) => {
        const seen = new Set<string>()
        // prime with the test's own direct imports
        const code = safeRead(testAbs)
        if (!code) return

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
      }),
    )

    onProgress?.(
      `Discovery complete: ${targets.size} source file(s), ${tests.length} test file(s)`,
    )
    return { targets: Array.from(targets.values()), testMap, directTestMap }
  } finally {
    await cleanup()
  }
}
