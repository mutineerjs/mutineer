import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  getMutantFilePath,
  getSchemaFilePath,
  getActiveIdFilePath,
} from '../mutant-paths.js'

let createdDirs: string[] = []

afterEach(() => {
  // Clean up any __mutineer__ directories we created
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  createdDirs = []
})

describe('getMutantFilePath', () => {
  it('creates a mutant file path with numeric ID suffix', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-paths-'))
    const srcFile = path.join(tmpDir, 'foo.ts')
    fs.writeFileSync(srcFile, '')

    const result = getMutantFilePath(srcFile, 'foo.ts#42')
    createdDirs.push(path.join(tmpDir, '__mutineer__'))

    expect(result).toBe(path.join(tmpDir, '__mutineer__', 'foo_42.ts'))
  })

  it('creates __mutineer__ directory if it does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-paths-'))
    const srcFile = path.join(tmpDir, 'bar.ts')
    fs.writeFileSync(srcFile, '')
    const mutineerDir = path.join(tmpDir, '__mutineer__')
    createdDirs.push(mutineerDir)

    getMutantFilePath(srcFile, 'bar.ts#1')

    expect(fs.existsSync(mutineerDir)).toBe(true)
  })

  it('handles non-numeric mutant IDs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-paths-'))
    const srcFile = path.join(tmpDir, 'baz.ts')
    fs.writeFileSync(srcFile, '')
    createdDirs.push(path.join(tmpDir, '__mutineer__'))

    const result = getMutantFilePath(srcFile, 'some-weird-id')
    expect(path.basename(result)).toMatch(/^baz_/)
    expect(result).toMatch(/\.ts$/)
  })

  it('preserves file extension', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-paths-'))
    const srcFile = path.join(tmpDir, 'component.vue')
    fs.writeFileSync(srcFile, '')
    createdDirs.push(path.join(tmpDir, '__mutineer__'))

    const result = getMutantFilePath(srcFile, 'component.vue#5')
    expect(result).toMatch(/\.vue$/)
    expect(path.basename(result)).toBe('component_5.vue')
  })

  it('reuses existing __mutineer__ directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-paths-'))
    const srcFile = path.join(tmpDir, 'foo.ts')
    fs.writeFileSync(srcFile, '')
    const mutineerDir = path.join(tmpDir, '__mutineer__')
    fs.mkdirSync(mutineerDir)
    createdDirs.push(mutineerDir)

    // Should not throw
    const result = getMutantFilePath(srcFile, 'foo.ts#1')
    expect(result).toBe(path.join(mutineerDir, 'foo_1.ts'))
  })
})

describe('getSchemaFilePath', () => {
  it('returns path with _schema suffix and correct extension', () => {
    const result = getSchemaFilePath('/src/foo.ts')
    expect(result).toBe('/src/__mutineer__/foo_schema.ts')
  })

  it('preserves the original extension', () => {
    const result = getSchemaFilePath('/src/component.vue')
    expect(result).toBe('/src/__mutineer__/component_schema.vue')
  })

  it('does not create the __mutineer__ directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-schema-'))
    createdDirs.push(tmpDir)
    const srcFile = path.join(tmpDir, 'bar.ts')
    const mutineerDir = path.join(tmpDir, '__mutineer__')

    getSchemaFilePath(srcFile)

    expect(fs.existsSync(mutineerDir)).toBe(false)
  })
})

describe('getActiveIdFilePath', () => {
  it('returns path under cwd/__mutineer__ keyed by workerId', () => {
    const result = getActiveIdFilePath('w0', '/project')
    expect(result).toBe('/project/__mutineer__/active_id_w0.txt')
  })

  it('produces distinct paths for different worker IDs', () => {
    const a = getActiveIdFilePath('w0', '/cwd')
    const b = getActiveIdFilePath('w1', '/cwd')
    expect(a).not.toBe(b)
  })
})
