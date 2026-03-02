import fs from 'node:fs/promises'

/**
 * Clean up all __mutineer__ temp directories created during mutation testing.
 */
export async function cleanupMutineerDirs(cwd: string): Promise<void> {
  const glob = await import('fast-glob')
  const dirs = await glob.default('**/__mutineer__', {
    cwd,
    onlyDirectories: true,
    absolute: true,
    ignore: ['**/node_modules/**'],
  })
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  }
}
