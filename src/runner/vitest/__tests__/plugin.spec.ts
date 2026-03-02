import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
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

describe('poolMutineerPlugin', () => {
  afterEach(() => {
    ;(globalThis as any).__mutineer_redirect__ = undefined
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
})
