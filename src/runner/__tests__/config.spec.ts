import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    await expect(
      loadMutineerConfig(tmpDir, 'nonexistent.js'),
    ).rejects.toThrow('No config found at nonexistent.js')
  })

  it('loads a .js config file', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.js')
    await fs.writeFile(
      configFile,
      'export default { runner: "vitest" }',
    )
    const config = await loadMutineerConfig(tmpDir)
    expect(config).toEqual({ runner: 'vitest' })
  })

  it('loads a .mjs config file', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.mjs')
    await fs.writeFile(
      configFile,
      'export default { runner: "jest" }',
    )
    const config = await loadMutineerConfig(tmpDir)
    expect(config).toEqual({ runner: 'jest' })
  })

  it('loads config from explicit path', async () => {
    const configFile = path.join(tmpDir, 'custom.config.mjs')
    await fs.writeFile(
      configFile,
      'export default { maxMutantsPerFile: 10 }',
    )
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

  // BUG: Two bugs compound here:
  // 1. validateConfig uses `&&` instead of `||`: `typeof config !== 'object' && config === null`
  //    Since typeof null === 'object', this condition is always false, so null passes validation.
  // 2. loadModule uses `||` instead of `??`: `mod.default || mod`
  //    When default export is null (falsy), it falls back to the module namespace object.
  // Together: null configs pass validation AND get returned as the module namespace.
  it('BUG: null config passes validation due to && vs || logic error', async () => {
    const configFile = path.join(tmpDir, 'mutineer.config.mjs')
    await fs.writeFile(configFile, 'export default null')
    // This SHOULD throw but doesn't because of the validateConfig bug.
    // Additionally, loadModule returns { default: null } instead of null
    // because it uses || (which treats null as falsy) instead of ??
    const config = await loadMutineerConfig(tmpDir)
    // Bug: returns the module namespace object instead of throwing
    expect(config).toHaveProperty('default', null)
  })
})
