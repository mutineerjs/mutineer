/**
 * Jest custom resolver for mutineer.
 *
 * This resolver intercepts module resolution to redirect imports of the original
 * source file to the mutated version during test execution.
 *
 * The redirect configuration is passed via environment variables:
 * - MUTINEER_REDIRECT_FROM: Absolute path to the original file
 * - MUTINEER_REDIRECT_TO: Absolute path to the mutant file
 */

const path = require('path') as typeof import('path')

interface JestResolverOptions {
  basedir?: string
  defaultResolver?: (request: string, options: any) => string
  paths?: string[]
}

/**
 * Custom Jest resolver that redirects module resolution for mutant testing.
 */
module.exports = (request: string, options: JestResolverOptions): string => {
  // Get redirect configuration from environment
  const from = process.env.MUTINEER_REDIRECT_FROM
  const to = process.env.MUTINEER_REDIRECT_TO
  const normalizedFrom = from ? path.resolve(from) : null

  // Helper to resolve using Jest's default resolver
  const resolveWith = (req: string, opts: JestResolverOptions): string => {
    if (options?.defaultResolver) {
      return options.defaultResolver(req, opts)
    }
    // Fallback to require.resolve if no default resolver provided
    return require.resolve(req, { paths: opts?.paths || [process.cwd()] })
  }

  // Helper to check if a path matches the redirect source
  const matchesFrom = (p: string): boolean => {
    if (!normalizedFrom) return false
    const abs = path.resolve(p)
    if (abs === normalizedFrom) return true
    // Handle imports without extensions (e.g., './foo' resolving to './foo.ts')
    const withExt = path.extname(abs) ? abs : abs + path.extname(normalizedFrom)
    return path.resolve(withExt) === normalizedFrom
  }

  // Try to resolve the request normally first
  let resolved
  try {
    resolved = resolveWith(request, options)
  } catch {
    resolved = null
  }

  // Check if the request itself (before resolution) matches
  const baseDir = options?.basedir ?? process.cwd()
  const candidate = path.resolve(baseDir, request)

  // If either the candidate or the resolved path matches our redirect source,
  // return the mutant file path
  if (
    normalizedFrom &&
    to &&
    (matchesFrom(candidate) || (resolved && matchesFrom(resolved)))
  ) {
    return to
  }

  // Otherwise, return the normally resolved path (or resolve again if it failed before)
  return resolved ?? resolveWith(request, options)
}
