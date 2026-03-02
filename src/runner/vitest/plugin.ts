/**
 * Vite plugin for persistent Vitest workers.
 *
 * Unlike the standard viteMutineerPlugin which reads env vars once at init,
 * this plugin reads from a global redirect map that can be updated dynamically
 * between test runs.
 *
 * The worker process sets globalThis.__mutineer_redirect__ before each test run,
 * and this plugin intercepts module loading to return the mutated code.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PluginOption } from 'vite'
import { getRedirect } from '../shared/index.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('mutineer:swap')

export function poolMutineerPlugin(): PluginOption {
  return {
    name: 'mutineer:swap',
    enforce: 'pre',
    load(id) {
      const redirect = getRedirect()
      if (!redirect) {
        return null
      }

      // Normalize the module ID, handling query strings
      const cleanId = id.split('?')[0]
      let normalizedId: string
      try {
        normalizedId = path.resolve(cleanId)
      } catch {
        return null
      }

      // Check if this is the file we're redirecting
      if (normalizedId === path.resolve(redirect.from)) {
        // Read the mutated code from the temp file
        try {
          const mutatedCode = fs.readFileSync(redirect.to, 'utf8')
          return mutatedCode
        } catch (err) {
          log.error(`Failed to read mutant file: ${redirect.to} ${err}`)
          return null
        }
      }

      return null
    },
  }
}
