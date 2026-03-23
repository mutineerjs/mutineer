/**
 * Vite plugin for persistent Vitest workers.
 *
 * Unlike the standard viteMutineerPlugin which reads env vars once at init,
 * this plugin reads from a global redirect map that can be updated dynamically
 * between test runs.
 *
 * The worker process sets globalThis.__mutineer_redirect__ before each test run,
 * and this plugin intercepts module loading to return the mutated code.
 *
 * For schema-eligible variants, the plugin serves a pre-built schema file that
 * embeds all mutations as ternary chains keyed by globalThis.__mutineer_active_id__.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PluginOption, UserConfig } from 'vite'
import { getRedirect, getSchemaFilePath } from '../shared/index.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('mutineer:swap')

export function poolMutineerPlugin(): PluginOption {
  // Cache schema file contents keyed by normalised source path.
  // null = checked and no schema exists; string = schema code.
  // Schema files are written once before the pool starts and never change,
  // so this cache is always valid for the lifetime of the plugin.
  const schemaCache = new Map<string, string | null>()

  return {
    name: 'mutineer:swap',
    enforce: 'pre',
    config(config: UserConfig) {
      const activeIdFile = process.env.MUTINEER_ACTIVE_ID_FILE
      if (!activeIdFile || !path.isAbsolute(activeIdFile)) return null
      const setupFile = path.join(path.dirname(activeIdFile), 'setup.mjs')
      const testConfig = (config as Record<string, unknown>).test as
        | { setupFiles?: string | string[] }
        | undefined
      const existing = testConfig?.setupFiles
      const existingArr = Array.isArray(existing)
        ? existing
        : existing
          ? [existing]
          : []
      return {
        test: { setupFiles: [...existingArr, setupFile] },
      } as Omit<UserConfig, 'plugins'>
    },
    load(id) {
      const cleanId = id.split('?')[0]
      let normalizedId: string
      try {
        normalizedId = path.resolve(cleanId)
      } catch {
        return null
      }

      // Redirect takes priority: fallback mutations use setRedirect + invalidateFile.
      // Must check redirect first so the schema file (which exists for this source)
      // does not shadow the mutant code during fallback runs.
      const redirect = getRedirect()
      if (redirect && normalizedId === path.resolve(redirect.from)) {
        try {
          return fs.readFileSync(redirect.to, 'utf8')
        } catch (err) {
          log.error(`Failed to read mutant file: ${redirect.to} ${err}`)
          return null
        }
      }

      // Schema path: serves pre-built schema file for schema-eligible variants.
      // Use cache to avoid existsSync + readFileSync on every module import.
      const cached = schemaCache.get(normalizedId)
      if (cached !== undefined) {
        return cached
      }
      const schemaPath = getSchemaFilePath(normalizedId)
      try {
        if (fs.existsSync(schemaPath)) {
          const code = fs.readFileSync(schemaPath, 'utf8')
          schemaCache.set(normalizedId, code)
          return code
        }
      } catch {
        // fall through
      }
      schemaCache.set(normalizedId, null)
      return null
    },
  }
}
