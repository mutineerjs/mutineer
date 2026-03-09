/**
 * Dynamic ESM loader for persistent Vitest workers.
 *
 * Reads redirect targets from globalThis.__mutineer_redirect__ on each resolution
 * so workers can swap files without restarting.
 *
 * NOTE: This loader must be self-contained and cannot import from the shared module
 * because it runs in a special Node.js context before module resolution happens.
 */

import { register, builtinModules } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

declare global {
  // Shared state set by the worker before each run
  var __mutineer_redirect__:
    | { from: string | null; to: string | null }
    | undefined
}

// Register this file as the loader hooks module
register(import.meta.url, {
  parentURL: import.meta.url,
  data: { debug: process.env.MUTINEER_DEBUG === '1' },
})

let DEBUG = process.env.MUTINEER_DEBUG === '1'

export function initialise(data: { debug?: boolean } | undefined) {
  if (data?.debug !== undefined) {
    DEBUG = data.debug
  }
}

/**
 * Try to resolve a .js import to a .ts or .tsx file (TypeScript ESM convention)
 */
function tryResolveTsExtension(specifier: string, parentURL?: string | null) {
  if (!specifier.endsWith('.js') || !specifier.startsWith('.')) {
    return null
  }

  let parentPath: string
  try {
    parentPath = fileURLToPath(parentURL ?? '')
  } catch {
    return null
  }
  const parentDir = path.dirname(parentPath)

  // If the parent is in a __mutineer__ directory, also try the parent's parent
  const dirsToTry = [parentDir]
  if (path.basename(parentDir) === '__mutineer__') {
    dirsToTry.push(path.dirname(parentDir))
  }

  const tsSpecifier = specifier.slice(0, -3) + '.ts'
  const tsxSpecifier = specifier.slice(0, -3) + '.tsx'

  for (const dir of dirsToTry) {
    const tsPath = path.resolve(dir, tsSpecifier)
    if (fs.existsSync(tsPath)) {
      return pathToFileURL(tsPath).href
    }

    const tsxPath = path.resolve(dir, tsxSpecifier)
    if (fs.existsSync(tsxPath)) {
      return pathToFileURL(tsxPath).href
    }
  }

  return null
}

/**
 * Get redirect config with URL conversion for ESM loader.
 * Self-contained implementation (cannot use shared module in loader context).
 */
function getRedirect() {
  const redirect = globalThis.__mutineer_redirect__
  if (!redirect?.from || !redirect?.to) {
    return null
  }
  return {
    from: path.resolve(redirect.from),
    fromUrl: pathToFileURL(path.resolve(redirect.from)).href,
    to: redirect.to,
  }
}

export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (
    specifier: string,
    context: { parentURL?: string },
  ) => Promise<{ url: string; shortCircuit?: boolean } | null>,
) {
  const redirect = getRedirect()
  const isBuiltin =
    specifier.startsWith('node:') || builtinModules.includes(specifier)
  const isNodeModulesSpec = specifier.includes('node_modules')

  const shouldLog = DEBUG && !isBuiltin && !isNodeModulesSpec

  if (shouldLog) {
    console.error(`[pool-loader] resolve: ${specifier}`)
    if (redirect) {
      console.error(
        `[pool-loader] active redirect: ${redirect.from} -> ${redirect.to}`,
      )
    }
  }

  // Try to resolve .js -> .ts for TypeScript ESM imports
  const tsResolved = tryResolveTsExtension(specifier, context.parentURL)
  if (tsResolved) {
    if (shouldLog)
      console.error(`[pool-loader] .js -> .ts: ${specifier} -> ${tsResolved}`)

    // Check if this is our redirect target
    if (redirect && tsResolved === redirect.fromUrl) {
      if (DEBUG)
        console.error(
          `[pool-loader] REDIRECTING ${tsResolved} -> ${pathToFileURL(redirect.to).href}`,
        )
      return {
        url: pathToFileURL(redirect.to).href,
        shortCircuit: true,
      }
    }

    return {
      url: tsResolved,
      shortCircuit: true,
    }
  }

  const resolved = await nextResolve(specifier, context)

  const resolvedInNodeModules = resolved?.url?.includes('/node_modules/')
  const resolvedBuiltin = resolved?.url?.startsWith('node:')
  if (shouldLog && resolved && !resolvedInNodeModules && !resolvedBuiltin)
    console.error(`[pool-loader] resolved ${specifier} to ${resolved.url}`)

  // Check if this resolves to our redirect target
  if (redirect && resolved?.url === redirect.fromUrl) {
    if (DEBUG)
      console.error(
        `[pool-loader] REDIRECTING ${resolved.url} -> ${pathToFileURL(redirect.to).href}`,
      )
    return {
      ...resolved,
      url: pathToFileURL(redirect.to).href,
      shortCircuit: true,
    }
  }

  return resolved
}

export async function load(
  url: string,
  context: unknown,
  nextLoad: (u: string, c: unknown) => Promise<unknown>,
) {
  return nextLoad(url, context)
}
