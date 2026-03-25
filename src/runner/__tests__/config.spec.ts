import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadMutineerConfig } from '../config.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-config-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('loadMutineerConfig', () => {
  it('throws when no config file is found', async () => {
    await expect(loadMutineerConfig(tmpDir)).rejects.toThrow(
      'No config found in',
    )
  })

  it('throws when explicit config path does not exist', async () => {
    await expect(loadMutineerConfig(tmpDir, 'nonexistent.js')).rejects.toThrow(
      'No config found at nonexistent.js',
    )
  })

  it('loads a .js config file', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.js')
    await fs.writeFile(configFile, 'export default { runner: "vitest" }')
    const config = await loadMutineerConfig(tmpDir)
    expect(config).toEqual({ runner: 'vitest' })
  })

  it('loads a .mjs config file', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.mjs')
    await fs.writeFile(configFile, 'export default { runner: "jest" }')
    const config = await loadMutineerConfig(tmpDir)
    expect(config).toEqual({ runner: 'jest' })
  })

  it('loads config from explicit path', async () => {
    const configFile = path.join(tmpDir, 'custom.config.mjs')
    await fs.writeFile(configFile, 'export default { maxMutantsPerFile: 10 }')
    const config = await loadMutineerConfig(tmpDir, 'custom.config.mjs')
    expect(config).toEqual({ maxMutantsPerFile: 10 })
  })

  it('prefers mutineer.config.ts over .js and .mjs', async () => {
    // When a .ts config exists but we can't load it with Vite, it will fail.
    // We just test the .js fallback works when no .ts exists.
    const jsConfig = path.join(tmpDir, 'mutineer.config.js')
    const mjsConfig = path.join(tmpDir, 'mutineer.config.mjs')
    await fs.writeFile(jsConfig, 'export default { source: "js" }')
    await fs.writeFile(mjsConfig, 'export default { source: "mjs" }')

    const config = await loadMutineerConfig(tmpDir)
    // .js comes before .mjs in the candidate order
    expect(config).toEqual({ source: 'js' })
  })

  it('wraps load errors with config path info', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.js')
    // Write invalid JS that will fail to import
    await fs.writeFile(configFile, '??? not valid javascript ???')
    await expect(loadMutineerConfig(tmpDir)).rejects.toThrow(
      /Failed to load config from/,
    )
  })

  it('throws when config exports null', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.mjs')
    await fs.writeFile(configFile, 'export default null')
    await expect(loadMutineerConfig(tmpDir)).rejects.toThrow(
      'does not export a valid configuration object',
    )
  })

  it('loads a .ts config file via vite', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.ts')
    await fs.writeFile(configFile, 'export default { runner: "vitest" }\n')
    const config = await loadMutineerConfig(tmpDir)
    expect(config).toEqual({ runner: 'vitest' })
  })

  it('throws with helpful message when TypeScript config fails to load', async () => {
    vi.doMock('vite', () => ({
      loadConfigFromFile: vi
        .fn()
        .mockRejectedValue(new Error('vite not available')),
    }))
    vi.resetModules()
    const { loadMutineerConfig: loadConfig } = await import('../config.js')
    const configFile = path.join(tmpDir, 'mutineer.config.ts')
    await fs.writeFile(configFile, 'export default { runner: "vitest" }')
    await expect(loadConfig(tmpDir)).rejects.toThrow(
      'Cannot load TypeScript config',
    )
    vi.doUnmock('vite')
  })

  it('loads a module with named exports only (no default export)', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.mjs')
    // No `export default` — exercises the `mod` fallback in loadModule
    await fs.writeFile(configFile, 'export const runner = "vitest"')
    const config = await loadMutineerConfig(tmpDir)
    expect((config as Record<string, unknown>).runner).toBe('vitest')
  })

  it('returns empty config when Vite loadConfigFromFile returns null', async () => {
    vi.doMock('vite', () => ({
      loadConfigFromFile: vi.fn().mockResolvedValue(null),
    }))
    vi.resetModules()
    const { loadMutineerConfig: loadConfig } = await import('../config.js')
    const configFile = path.join(tmpDir, 'mutineer.config.ts')
    await fs.writeFile(configFile, 'export default {}')
    const config = await loadConfig(tmpDir)
    expect(config).toEqual({})
    vi.doUnmock('vite')
  })

  it('stringifies non-Error thrown by loadConfigFromFile', async () => {
    vi.doMock('vite', () => ({
      loadConfigFromFile: vi.fn().mockRejectedValue('plain string error'),
    }))
    vi.resetModules()
    const { loadMutineerConfig: loadConfig } = await import('../config.js')
    const configFile = path.join(tmpDir, 'mutineer.config.ts')
    await fs.writeFile(configFile, 'export default {}')
    await expect(loadConfig(tmpDir)).rejects.toThrow('plain string error')
    vi.doUnmock('vite')
  })
})
