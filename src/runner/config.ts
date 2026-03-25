import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MutineerConfig } from '../index.js'

import { createLogger } from '../utils/logger.js'
import { toErrorMessage } from '../utils/errors.js'

// Constants
const CONFIG_FILENAMES = [
  'mutineer.config.ts',
  'mutineer.config.js',
  'mutineer.config.mjs',
] as const
const VITE_CONFIG_OPTIONS = { command: 'build', mode: 'development' } as const
const log = createLogger('config')

/**
 * Attempt to load and parse a JavaScript/TypeScript module.
 * @param filePath - Path to the module file
 * @returns The default export or the module itself
 * @throws Error if module cannot be loaded
 */
async function loadModule(filePath: string): Promise<unknown> {
  const moduleUrl = pathToFileURL(filePath).href
  const mod = await import(moduleUrl)
  return 'default' in mod ? mod.default : mod
}

/**
 * Validate that the loaded configuration has the expected shape.
 * While we allow partial configs (defaults applied elsewhere), this ensures
 * the structure is an object and not some other unexpected type.
 */
function validateConfig(config: unknown): config is MutineerConfig {
  if (typeof config !== 'object' || config === null) {
    return false
  }
  // Config is valid even if empty; defaults are applied elsewhere.
  // For stricter validation, property-level checks could be added here.
  return true
}

/**
 * Loads the Mutineer configuration file.
 *
 * Searches for mutineer.config.ts/js/mjs in the project root, or uses a user-provided path.
 * TypeScript configs are loaded via Vite's loader; JS/MJS configs are imported directly.
 *
 * @param cwd - Current working directory to search from
 * @param configPath - Optional explicit path to the config file
 * @returns Loaded MutineerConfig (may be partial; defaults applied by caller)
 * @throws Error if no config file is found or if loading fails
 */
export async function loadMutineerConfig(
  cwd: string,
  configPath?: string,
): Promise<MutineerConfig> {
  // Build list of candidate file paths to check
  const candidates = configPath
    ? [path.resolve(cwd, configPath)]
    : CONFIG_FILENAMES.map((filename) => path.join(cwd, filename))

  // Find the first config file that exists
  const configFile = candidates.find((f) => fs.existsSync(f))
  if (!configFile) {
    const suggestion = configPath
      ? `No config found at ${configPath}`
      : `No config found in ${cwd}. Expected one of: ${CONFIG_FILENAMES.join(', ')}`
    throw new Error(suggestion)
  }

  log.debug(`Loading config from: ${configFile}`)

  try {
    // Load TypeScript config via Vite, or import JS/MJS directly
    const loadedConfig = configFile.endsWith('.ts')
      ? await loadTypeScriptConfig(configFile)
      : await loadModule(configFile)

    if (!validateConfig(loadedConfig)) {
      throw new Error(
        `Config file does not export a valid configuration object: ${configFile}`,
      )
    }

    log.debug('Config loaded successfully:', loadedConfig)

    return loadedConfig as MutineerConfig
  } catch (err) {
    throw new Error(
      `Failed to load config from ${configFile}: ${toErrorMessage(err)}`,
    )
  }
}

/**
 * Load a TypeScript config file using Vite's loader.
 * @param filePath - Path to the .ts config file
 * @returns The loaded configuration object
 * @throws Error if loading fails
 */
async function loadTypeScriptConfig(filePath: string): Promise<unknown> {
  try {
    const { loadConfigFromFile } = await import('vite')
    const loaded = await loadConfigFromFile(VITE_CONFIG_OPTIONS, filePath)
    return loaded?.config ?? {}
  } catch (err) {
    throw new Error(
      `Cannot load TypeScript config. Ensure 'vite' is installed or rename to .js/.mjs:\n${toErrorMessage(err)}`,
    )
  }
}
