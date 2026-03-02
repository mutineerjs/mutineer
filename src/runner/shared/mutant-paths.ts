/**
 * Shared utilities for managing mutant file paths.
 */

import path from 'node:path'
import fs from 'node:fs'

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
