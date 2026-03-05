import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getMutantFilePath } from '../mutant-paths.js'

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
