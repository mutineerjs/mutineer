import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  clearCacheOnStart,
  saveCacheAtomic,
  decodeCacheKey,
  keyForTests,
  hash,
  readMutantCache,
  getCacheFilename,
} from '../cache.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mutineer-cache-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('getCacheFilename', () => {
  it('returns default filename when no shard', () => {
    expect(getCacheFilename()).toBe('.mutineer-cache.json')
    expect(getCacheFilename(undefined)).toBe('.mutineer-cache.json')
  })

  it('returns shard-namespaced filename when shard provided', () => {
    expect(getCacheFilename({ index: 1, total: 2 })).toBe(
      '.mutineer-cache-shard-1-of-2.json',
    )
    expect(getCacheFilename({ index: 3, total: 4 })).toBe(
      '.mutineer-cache-shard-3-of-4.json',
    )
  })
})

describe('clearCacheOnStart', () => {
  it('removes the cache file if it exists', async () => {
    const cacheFile = path.join(tmpDir, '.mutineer-cache.json')
    await fs.writeFile(cacheFile, '{}')
    await clearCacheOnStart(tmpDir)
    await expect(fs.access(cacheFile)).rejects.toThrow()
  })

  it('does not throw if cache file does not exist', async () => {
    await expect(clearCacheOnStart(tmpDir)).resolves.toBeUndefined()
  })

  it('removes shard-specific cache file', async () => {
    const shardFile = path.join(tmpDir, '.mutineer-cache-shard-1-of-2.json')
    await fs.writeFile(shardFile, '{}')
    await clearCacheOnStart(tmpDir, { index: 1, total: 2 })
    await expect(fs.access(shardFile)).rejects.toThrow()
  })

  it('does not remove default cache when shard is specified', async () => {
    const defaultFile = path.join(tmpDir, '.mutineer-cache.json')
    await fs.writeFile(defaultFile, '{}')
    await clearCacheOnStart(tmpDir, { index: 1, total: 2 })
    // default file should still exist
    await expect(fs.access(defaultFile)).resolves.toBeUndefined()
  })
})

describe('saveCacheAtomic', () => {
  it('writes cache data to the file', async () => {
    const cache = {
      key1: {
        status: 'killed' as const,
        file: 'foo.ts',
        line: 1,
        col: 0,
        mutator: 'flipEQ',
      },
    }
    await saveCacheAtomic(tmpDir, cache)
    const content = await fs.readFile(
      path.join(tmpDir, '.mutineer-cache.json'),
      'utf8',
    )
    expect(JSON.parse(content)).toEqual(cache)
  })

  it('overwrites existing cache', async () => {
    await saveCacheAtomic(tmpDir, { old: {} as any })
    const newCache = {
      new: {
        status: 'escaped' as const,
        file: 'bar.ts',
        line: 2,
        col: 3,
        mutator: 'andToOr',
      },
    }
    await saveCacheAtomic(tmpDir, newCache)
    const content = await fs.readFile(
      path.join(tmpDir, '.mutineer-cache.json'),
      'utf8',
    )
    expect(JSON.parse(content)).toEqual(newCache)
  })

  it('writes to shard-named file when shard is provided', async () => {
    const cache = {
      k: {
        status: 'killed' as const,
        file: 'x.ts',
        line: 1,
        col: 0,
        mutator: 'm',
      },
    }
    await saveCacheAtomic(tmpDir, cache, { index: 2, total: 3 })
    const content = await fs.readFile(
      path.join(tmpDir, '.mutineer-cache-shard-2-of-3.json'),
      'utf8',
    )
    expect(JSON.parse(content)).toEqual(cache)
    // default file should NOT exist
    await expect(
      fs.access(path.join(tmpDir, '.mutineer-cache.json')),
    ).rejects.toThrow()
  })
})

describe('decodeCacheKey', () => {
  it('decodes a full cache key', () => {
    const key = 'testsig:codesig:src/foo.ts:10,5:flipEQ'
    const decoded = decodeCacheKey(key)
    expect(decoded.file).toBe('src/foo.ts')
    expect(decoded.line).toBe(10)
    expect(decoded.col).toBe(5)
    expect(decoded.mutator).toBe('flipEQ')
  })

  it('handles key with no colons', () => {
    const decoded = decodeCacheKey('nodelimiters')
    expect(decoded.mutator).toBe('unknown')
  })

  it('handles key with only one colon', () => {
    const decoded = decodeCacheKey('only:one')
    expect(decoded.mutator).toBe('one')
  })

  it('handles malformed position', () => {
    const key = 'a:b:file:badpos:mutator'
    const decoded = decodeCacheKey(key)
    expect(decoded.mutator).toBe('mutator')
  })

  it('handles key with exactly two colons (no firstColon in rest)', () => {
    // Key: "pos:mutator" after splitting last colon → rest = "pos", no colon in rest
    // Full key: "10,5:mutator" → lastColon splits mutator, positionColon splits pos
    // rest becomes empty string before positionColon
    const decoded = decodeCacheKey('10,5:mutator')
    expect(decoded.mutator).toBe('mutator')
    expect(decoded.line).toBe(0) // positionColon = -1, returns early
  })

  it('handles key with exactly three colons (firstColon but no secondColon)', () => {
    // "sig:10,5:mutator" → mutator='mutator', posRaw='10,5', rest='sig'
    // firstColon in 'sig' = -1, returns early at line 70
    const decoded = decodeCacheKey('sig:10,5:mutator')
    expect(decoded.mutator).toBe('mutator')
    expect(decoded.line).toBe(10)
    expect(decoded.col).toBe(5)
  })

  it('handles key with four colons (firstColon but no secondColon in restAfterFirst)', () => {
    // "tsig:csig:10,5:mutator" → mutator='mutator', posRaw='10,5', rest='tsig:csig'
    // firstColon=4, restAfterFirst='csig', secondColon in 'csig' = -1, returns at line 73
    const decoded = decodeCacheKey('tsig:csig:10,5:mutator')
    expect(decoded.mutator).toBe('mutator')
    expect(decoded.line).toBe(10)
    expect(decoded.col).toBe(5)
  })

  it('falls back to full key when file segment is empty', () => {
    // a:b::1,0:mutator → after parsing, restAfterFirst.slice(secondColon+1) = '' → falls back to key
    const key = 'a:b::1,0:mutator'
    const decoded = decodeCacheKey(key)
    expect(decoded.file).toBe(key)
    expect(decoded.mutator).toBe('mutator')
  })
})

describe('keyForTests', () => {
  it('produces deterministic keys regardless of input order', () => {
    const key1 = keyForTests(['b.test.ts', 'a.test.ts'])
    const key2 = keyForTests(['a.test.ts', 'b.test.ts'])
    expect(key1).toBe(key2)
  })

  it('produces different keys for different test sets', () => {
    const key1 = keyForTests(['a.test.ts'])
    const key2 = keyForTests(['b.test.ts'])
    expect(key1).not.toBe(key2)
  })
})

describe('hash', () => {
  it('returns a 12 character hex string', () => {
    const h = hash('test')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
  })

  it('returns the same hash for the same input', () => {
    expect(hash('hello')).toBe(hash('hello'))
  })

  it('returns different hashes for different inputs', () => {
    expect(hash('a')).not.toBe(hash('b'))
  })
})

describe('readMutantCache', () => {
  it('returns empty object when no cache file exists', async () => {
    const result = await readMutantCache(tmpDir)
    expect(result).toEqual({})
  })

  it('reads from shard-named file when shard is provided', async () => {
    const cache = {
      'k:v:f.ts:1,0:m': {
        status: 'killed',
        file: 'f.ts',
        line: 1,
        col: 0,
        mutator: 'm',
      },
    }
    await fs.writeFile(
      path.join(tmpDir, '.mutineer-cache-shard-1-of-2.json'),
      JSON.stringify(cache),
    )
    const result = await readMutantCache(tmpDir, { index: 1, total: 2 })
    expect(result['k:v:f.ts:1,0:m'].status).toBe('killed')
  })

  it('returns empty object when shard file does not exist', async () => {
    const result = await readMutantCache(tmpDir, { index: 2, total: 4 })
    expect(result).toEqual({})
  })

  it('reads and normalizes object-format cache entries', async () => {
    const cache = {
      'testsig:codesig:file.ts:1,0:flip': {
        status: 'killed',
        file: 'file.ts',
        line: 1,
        col: 0,
        mutator: 'flip',
      },
    }
    await fs.writeFile(
      path.join(tmpDir, '.mutineer-cache.json'),
      JSON.stringify(cache),
    )
    const result = await readMutantCache(tmpDir)
    expect(result['testsig:codesig:file.ts:1,0:flip']).toEqual({
      status: 'killed',
      file: 'file.ts',
      line: 1,
      col: 0,
      mutator: 'flip',
    })
  })

  it('reads and normalizes old string-format cache entries', async () => {
    const cache = {
      'testsig:codesig:file.ts:1,0:flip': 'killed',
    }
    await fs.writeFile(
      path.join(tmpDir, '.mutineer-cache.json'),
      JSON.stringify(cache),
    )
    const result = await readMutantCache(tmpDir)
    const entry = result['testsig:codesig:file.ts:1,0:flip']
    expect(entry.status).toBe('killed')
    expect(entry.mutator).toBe('flip')
  })

  it('returns empty object for invalid JSON', async () => {
    await fs.writeFile(path.join(tmpDir, '.mutineer-cache.json'), 'not json')
    const result = await readMutantCache(tmpDir)
    expect(result).toEqual({})
  })

  it('skips object-format entries without a status field', async () => {
    const cache = {
      'testsig:codesig:file.ts:1,0:flip': { someOtherField: 'foo' },
    }
    await fs.writeFile(
      path.join(tmpDir, '.mutineer-cache.json'),
      JSON.stringify(cache),
    )
    const result = await readMutantCache(tmpDir)
    // Entry has no status, so it is skipped entirely
    expect(result['testsig:codesig:file.ts:1,0:flip']).toBeUndefined()
  })

  it('defaults status to skipped when status is null in object entry', async () => {
    const cache = {
      'testsig:codesig:file.ts:1,0:flip': { status: null },
    }
    await fs.writeFile(
      path.join(tmpDir, '.mutineer-cache.json'),
      JSON.stringify(cache),
    )
    const result = await readMutantCache(tmpDir)
    expect(result['testsig:codesig:file.ts:1,0:flip'].status).toBe('skipped')
  })

  it('normalizes partial object entries with decoded fallbacks', async () => {
    const cache = {
      'testsig:codesig:file.ts:5,3:mut': {
        status: 'escaped',
      },
    }
    await fs.writeFile(
      path.join(tmpDir, '.mutineer-cache.json'),
      JSON.stringify(cache),
    )
    const result = await readMutantCache(tmpDir)
    const entry = result['testsig:codesig:file.ts:5,3:mut']
    expect(entry.status).toBe('escaped')
    expect(entry.line).toBe(5)
    expect(entry.col).toBe(3)
    expect(entry.mutator).toBe('mut')
  })
})
