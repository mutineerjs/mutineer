import fs from 'node:fs/promises'

/**
 * Clean up all __mutineer__ temp directories created during mutation testing.
 */
export async function cleanupMutineerDirs(
  cwd: string,
  opts: { includeCacheFiles?: boolean } = {},
): Promise<void> {
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
  if (opts.includeCacheFiles) {
    // Remove cache files (new name + legacy .mutate-cache* for migration)
    const cacheFiles = await glob.default(
      [
        '.mutineer-cache*.json',
        '.mutineer-cache*.json.tmp',
        '.mutate-cache*.json',
        '.mutate-cache*.json.tmp',
      ],
      { cwd, absolute: true },
    )
    for (const f of cacheFiles) {
      try {
        await fs.unlink(f)
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
