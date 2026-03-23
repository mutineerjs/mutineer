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

  it('removes root-level __mutineer__ directory', async () => {
    const rootMutDir = path.join(tmpDir, '__mutineer__')
    await fs.mkdir(rootMutDir, { recursive: true })
    await fs.writeFile(path.join(rootMutDir, 'setup.mjs'), 'content')

    await cleanupMutineerDirs(tmpDir)

    await expect(fs.access(rootMutDir)).rejects.toThrow()
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

  it('does not remove cache files by default', async () => {
    const cacheFile = path.join(tmpDir, '.mutineer-cache.json')
    await fs.writeFile(cacheFile, '{}')

    await cleanupMutineerDirs(tmpDir)

    await expect(fs.access(cacheFile)).resolves.toBeUndefined()
  })

  it('removes .mutineer-cache*.json files when includeCacheFiles is true', async () => {
    const cacheFile = path.join(tmpDir, '.mutineer-cache.json')
    const shardFile = path.join(tmpDir, '.mutineer-cache-shard-1-of-2.json')
    await fs.writeFile(cacheFile, '{}')
    await fs.writeFile(shardFile, '{}')

    await cleanupMutineerDirs(tmpDir, { includeCacheFiles: true })

    await expect(fs.access(cacheFile)).rejects.toThrow()
    await expect(fs.access(shardFile)).rejects.toThrow()
  })

  it('removes legacy .mutate-cache*.json files for migration when includeCacheFiles is true', async () => {
    const legacyCache = path.join(tmpDir, '.mutate-cache.json')
    const legacyShard = path.join(tmpDir, '.mutate-cache-shard-2-of-4.json')
    await fs.writeFile(legacyCache, '{}')
    await fs.writeFile(legacyShard, '{}')

    await cleanupMutineerDirs(tmpDir, { includeCacheFiles: true })

    await expect(fs.access(legacyCache)).rejects.toThrow()
    await expect(fs.access(legacyShard)).rejects.toThrow()
  })

  it('removes .mutineer-cache*.json.tmp temp files when includeCacheFiles is true', async () => {
    const tmpFile = path.join(tmpDir, '.mutineer-cache.json.tmp')
    await fs.writeFile(tmpFile, '{}')

    await cleanupMutineerDirs(tmpDir, { includeCacheFiles: true })

    await expect(fs.access(tmpFile)).rejects.toThrow()
  })
})
