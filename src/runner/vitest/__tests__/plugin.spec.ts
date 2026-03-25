import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { poolMutineerPlugin } from '../plugin.js'

function getLoadFn() {
  const plugin = poolMutineerPlugin() as any
  if (Array.isArray(plugin)) {
    return plugin[0]?.load
  }
  if (plugin && typeof plugin === 'object' && 'load' in plugin) {
    return (plugin as any).load
  }
  return undefined
}

function getConfigFn() {
  const plugin = poolMutineerPlugin() as any
  if (Array.isArray(plugin)) {
    return plugin[0]?.config
  }
  if (plugin && typeof plugin === 'object' && 'config' in plugin) {
    return (plugin as any).config
  }
  return undefined
}

describe('poolMutineerPlugin', () => {
  afterEach(() => {
    ;(globalThis as any).__mutineer_redirect__ = undefined
    delete process.env.MUTINEER_ACTIVE_ID_FILE
  })

  it('returns null when no redirect is configured', () => {
    const load = getLoadFn()

    const result = load?.('/some/file.ts')

    expect(result).toBeNull()
  })

  it('returns the mutated file when the id matches the redirect target', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-pool-plugin-'),
    )
    const fromPath = path.join(tmpDir, 'source.ts')
    const mutatedPath = path.join(tmpDir, 'mutated.ts')
    await fs.writeFile(fromPath, 'export const original = true\n', 'utf8')
    await fs.writeFile(mutatedPath, 'export const mutated = true\n', 'utf8')

    try {
      ;(globalThis as any).__mutineer_redirect__ = {
        from: fromPath,
        to: mutatedPath,
      }
      const load = getLoadFn()

      const result = load?.(fromPath)

      expect(result).toBe('export const mutated = true\n')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('ignores modules that do not match the redirect', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-pool-plugin-'),
    )
    const fromPath = path.join(tmpDir, 'source.ts')
    const mutatedPath = path.join(tmpDir, 'mutated.ts')
    await fs.writeFile(mutatedPath, 'export const mutated = true\n', 'utf8')

    try {
      ;(globalThis as any).__mutineer_redirect__ = {
        from: fromPath,
        to: mutatedPath,
      }
      const load = getLoadFn()

      const result = load?.(path.join(tmpDir, 'other.ts?import'))

      expect(result).toBeNull()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns schema code when a schema file exists for the source path', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-schema-plugin-'),
    )
    const sourcePath = path.join(tmpDir, 'source.ts')
    const mutineerDir = path.join(tmpDir, '__mutineer__')
    const schemaPath = path.join(mutineerDir, 'source_schema.ts')
    await fs.mkdir(mutineerDir)
    await fs.writeFile(schemaPath, '// @ts-nocheck\nconst x = 1', 'utf8')

    try {
      const load = getLoadFn()
      const result = load?.(sourcePath)
      expect(result).toBe('// @ts-nocheck\nconst x = 1')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('caches schema content so subsequent loads skip filesystem I/O', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-schema-cache-'),
    )
    const sourcePath = path.join(tmpDir, 'source.ts')
    const mutineerDir = path.join(tmpDir, '__mutineer__')
    const schemaPath = path.join(mutineerDir, 'source_schema.ts')
    await fs.mkdir(mutineerDir)
    await fs.writeFile(schemaPath, '// cached schema', 'utf8')

    // Use the same plugin instance for both calls (shared cache)
    const plugin = poolMutineerPlugin() as any
    const load = plugin?.load?.bind(plugin)

    try {
      const first = load?.(sourcePath)
      expect(first).toBe('// cached schema')

      // Remove schema file - second call must still return cached content
      await fs.rm(tmpDir, { recursive: true, force: true })
      const second = load?.(sourcePath)
      expect(second).toBe('// cached schema')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('caches null for paths with no schema to avoid repeated existsSync calls', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-schema-nocache-'),
    )
    const sourcePath = path.join(tmpDir, 'no-schema.ts')

    try {
      const plugin = poolMutineerPlugin() as any
      const load = plugin?.load?.bind(plugin)

      const first = load?.(sourcePath)
      expect(first).toBeNull()

      // Create schema file after first call - second call must return null (cached)
      const mutineerDir = path.join(tmpDir, '__mutineer__')
      await fs.mkdir(mutineerDir, { recursive: true })
      await fs.writeFile(
        path.join(mutineerDir, 'no-schema_schema.ts'),
        '// late schema',
        'utf8',
      )
      const second = load?.(sourcePath)
      expect(second).toBeNull()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('prefers redirect over schema when both are present (fallback mutation path)', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-schema-redirect-'),
    )
    const sourcePath = path.join(tmpDir, 'source.ts')
    const mutineerDir = path.join(tmpDir, '__mutineer__')
    const schemaPath = path.join(mutineerDir, 'source_schema.ts')
    const mutatedPath = path.join(mutineerDir, 'source_0.ts')
    await fs.mkdir(mutineerDir)
    await fs.writeFile(schemaPath, '// schema', 'utf8')
    await fs.writeFile(mutatedPath, '// mutated', 'utf8')

    try {
      ;(globalThis as any).__mutineer_redirect__ = {
        from: sourcePath,
        to: mutatedPath,
      }
      const load = getLoadFn()
      const result = load?.(sourcePath)
      // Redirect wins: fallback mutations use setRedirect + invalidateFile.
      // The schema must not shadow the mutant code during fallback runs.
      expect(result).toBe('// mutated')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns null and logs error when readFileSync throws on redirect', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-plugin-err-'),
    )
    const fromPath = path.join(tmpDir, 'source.ts')
    const mutatedPath = path.join(tmpDir, 'mutated.ts')
    ;(globalThis as any).__mutineer_redirect__ = {
      from: fromPath,
      to: mutatedPath,
    }
    const readSpy = vi
      .spyOn(fssync, 'readFileSync')
      .mockImplementationOnce(() => {
        throw new Error('disk error')
      })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const load = getLoadFn()
      const result = load?.(fromPath)
      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read mutant file'),
      )
    } finally {
      readSpy.mockRestore()
      consoleSpy.mockRestore()
      ;(globalThis as any).__mutineer_redirect__ = undefined
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  describe('config hook', () => {
    it('returns null when MUTINEER_ACTIVE_ID_FILE is not set', () => {
      const config = getConfigFn()
      const result = config?.({ test: { setupFiles: ['/existing/setup.ts'] } })
      expect(result).toBeNull()
    })

    it('appends setup.mjs to setupFiles when MUTINEER_ACTIVE_ID_FILE is set', () => {
      const tmpDir = fssync.mkdtempSync(
        path.join(os.tmpdir(), 'mutineer-config-'),
      )
      const activeIdFile = path.join(tmpDir, '__mutineer__', 'active_id_w0.txt')
      process.env.MUTINEER_ACTIVE_ID_FILE = activeIdFile

      try {
        const config = getConfigFn()
        const result = config?.({
          test: { setupFiles: ['/existing/setup.ts'] },
        })
        const setupFiles = result?.test?.setupFiles as string[]
        expect(setupFiles).toContain('/existing/setup.ts')
        expect(setupFiles.some((f: string) => f.endsWith('setup.mjs'))).toBe(
          true,
        )
      } finally {
        fssync.rmSync(tmpDir, { recursive: true, force: true })
        delete process.env.MUTINEER_ACTIVE_ID_FILE
      }
    })

    it('creates setupFiles array from string value', () => {
      const tmpDir = fssync.mkdtempSync(
        path.join(os.tmpdir(), 'mutineer-config2-'),
      )
      const activeIdFile = path.join(tmpDir, '__mutineer__', 'active_id_w0.txt')
      process.env.MUTINEER_ACTIVE_ID_FILE = activeIdFile

      try {
        const config = getConfigFn()
        const result = config?.({ test: { setupFiles: '/single/setup.ts' } })
        const setupFiles = result?.test?.setupFiles as string[]
        expect(setupFiles).toContain('/single/setup.ts')
        expect(setupFiles.length).toBe(2)
      } finally {
        fssync.rmSync(tmpDir, { recursive: true, force: true })
        delete process.env.MUTINEER_ACTIVE_ID_FILE
      }
    })

    it('creates setupFiles from empty config when no existing setupFiles', () => {
      const tmpDir = fssync.mkdtempSync(
        path.join(os.tmpdir(), 'mutineer-config3-'),
      )
      const activeIdFile = path.join(tmpDir, '__mutineer__', 'active_id_w0.txt')
      process.env.MUTINEER_ACTIVE_ID_FILE = activeIdFile

      try {
        const config = getConfigFn()
        const result = config?.({})
        const setupFiles = result?.test?.setupFiles as string[]
        expect(setupFiles.length).toBe(1)
        expect(setupFiles[0]).toMatch(/setup\.mjs$/)
      } finally {
        fssync.rmSync(tmpDir, { recursive: true, force: true })
        delete process.env.MUTINEER_ACTIVE_ID_FILE
      }
    })
  })
})
