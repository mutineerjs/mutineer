/**
 * Shared utilities for managing mutant file paths.
 */

import path from 'node:path'
import fs from 'node:fs'

/**
 * Generate a file path for the schema file in the __mutineer__ directory.
 * The schema file embeds all mutation variants for a source file.
 *
 * @param originalFile - Path to the original source file
 * @returns Path where the schema file should be written (dir may not exist)
 */
export function getSchemaFilePath(originalFile: string): string {
  const dir = path.dirname(originalFile)
  const ext = path.extname(originalFile)
  const basename = path.basename(originalFile, ext)
  return path.join(dir, '__mutineer__', `${basename}_schema${ext}`)
}

/**
 * Generate the path for a worker's active-mutant-ID file.
 * Each worker writes the active mutant ID here so test forks can read it.
 *
 * @param workerId - Unique worker identifier
 * @param cwd - Project working directory
 * @returns Absolute path for the active ID file
 */
export function getActiveIdFilePath(workerId: string, cwd: string): string {
  return path.join(cwd, '__mutineer__', `active_id_${workerId}.txt`)
}

/**
 * Generate a file path for a mutant file in the __mutineer__ directory.
 *
 * @param originalFile - Path to the original source file
 * @param mutantId - Unique identifier for the mutant
 * @returns Absolute path where the mutant file should be written
 *
 * @example
 * getMutantFilePath('/src/foo.ts', 'mutant#42')
 * // Returns: '/src/__mutineer__/foo_42.ts'
 */
export function getMutantFilePath(
  originalFile: string,
  mutantId: string,
): string {
  const dir = path.dirname(originalFile)
  const ext = path.extname(originalFile)
  const basename = path.basename(originalFile, ext)
  const mutineerDir = path.join(dir, '__mutineer__')

  if (!fs.existsSync(mutineerDir)) {
    fs.mkdirSync(mutineerDir, { recursive: true })
  }

  const idMatch = mutantId.match(/#(\d+)$/)
  const suffix = idMatch
    ? idMatch[1]
    : mutantId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)
  return path.join(mutineerDir, `${basename}_${suffix}${ext}`)
}
