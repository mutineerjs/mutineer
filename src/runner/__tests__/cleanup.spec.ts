import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { cleanupMutineerDirs } from '../cleanup.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-cleanup-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('cleanupMutineerDirs', () => {
  it('removes __mutineer__ directories', async () => {
    const mutDir = path.join(tmpDir, 'src', '__mutineer__')
    await fs.mkdir(mutDir, { recursive: true })
    await fs.writeFile(path.join(mutDir, 'mutant.ts'), 'code')

    await cleanupMutineerDirs(tmpDir)

    await expect(fs.access(mutDir)).rejects.toThrow()
  })

  it('removes nested __mutineer__ directories', async () => {
    const dir1 = path.join(tmpDir, 'src', 'a', '__mutineer__')
    const dir2 = path.join(tmpDir, 'src', 'b', '__mutineer__')
    await fs.mkdir(dir1, { recursive: true })
    await fs.mkdir(dir2, { recursive: true })

    await cleanupMutineerDirs(tmpDir)

    await expect(fs.access(dir1)).rejects.toThrow()
    await expect(fs.access(dir2)).rejects.toThrow()
  })

  it('does not throw when no __mutineer__ dirs exist', async () => {
    await expect(cleanupMutineerDirs(tmpDir)).resolves.toBeUndefined()
  })

  it('preserves non-mutineer directories', async () => {
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(path.join(srcDir, 'file.ts'), 'code')

    await cleanupMutineerDirs(tmpDir)

    const stat = await fs.stat(srcDir)
    expect(stat.isDirectory()).toBe(true)
  })
})
