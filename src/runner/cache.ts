/**
 * Cache Management Module
 *
 * Pure functions for managing mutation testing cache.
 * Handles reading, writing, and decoding cache entries.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MutantCacheEntry, MutantStatus } from '../types/mutant.js'

/**
 * Get the cache filename for a given shard (or the default if none).
 */
export function getCacheFilename(shard?: {
  index: number
  total: number
}): string {
  if (!shard) return '.mutineer-cache.json'
  return `.mutineer-cache-shard-${shard.index}-of-${shard.total}.json`
}

/**
 * Clear the cache file at the start of a run.
 */
export async function clearCacheOnStart(
  cwd: string,
  shard?: { index: number; total: number },
): Promise<void> {
  const p = path.join(cwd, getCacheFilename(shard))
  try {
    await fs.unlink(p)
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Save cache atomically using a temp file + rename.
 */
export async function saveCacheAtomic(
  cwd: string,
  cache: Record<string, MutantCacheEntry>,
  shard?: { index: number; total: number },
): Promise<void> {
  const p = path.join(cwd, getCacheFilename(shard))
  const tmp = p + '.tmp'
  const json = JSON.stringify(cache, null, 2)
  await fs.writeFile(tmp, json, 'utf8')
  await fs.rename(tmp, p)
}

/**
 * Decode a cache key into its component parts.
 * Cache keys have the format: testSig:codeSig:file:line,col:mutator
 */
export function decodeCacheKey(key: string): {
  file: string
  line: number
  col: number
  mutator: string
} {
  let file = key
  let line = 0
  let col = 0
  let mutator = 'unknown'
  try {
    const lastColon = key.lastIndexOf(':')
    if (lastColon === -1) return { file, line, col, mutator }
    mutator = key.slice(lastColon + 1)
    let rest = key.slice(0, lastColon)
    const positionColon = rest.lastIndexOf(':')
    if (positionColon === -1) return { file, line, col, mutator }
    const posRaw = rest.slice(positionColon + 1)
    rest = rest.slice(0, positionColon)
    const [lineStr, colStr] = posRaw.split(',')
    const maybeLine = parseInt(lineStr, 10)
    const maybeCol = parseInt(colStr, 10)
    if (Number.isFinite(maybeLine)) line = maybeLine
    if (Number.isFinite(maybeCol)) col = maybeCol
    const firstColon = rest.indexOf(':')
    if (firstColon === -1) return { file, line, col, mutator }
    const restAfterFirst = rest.slice(firstColon + 1)
    const secondColon = restAfterFirst.indexOf(':')
    if (secondColon === -1) return { file, line, col, mutator }
    file = restAfterFirst.slice(secondColon + 1) || file
  } catch {
    // fall through and return best-effort data
  }
  return { file, line, col, mutator }
}

/**
 * Create a deterministic key for a set of test files.
 */
export function keyForTests(tests: readonly string[]): string {
  return JSON.stringify([...tests].sort())
}

/**
 * Create a short hash of a string (12 hex chars).
 */
export function hash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)
}

/**
 * Read the mutant cache from disk.
 * Normalizes both old (string status) and new (object) formats.
 */
export async function readMutantCache(
  cwd: string,
  shard?: { index: number; total: number },
): Promise<Record<string, MutantCacheEntry>> {
  const p = path.join(cwd, getCacheFilename(shard))
  try {
    const data = await fs.readFile(p, 'utf8')
    const raw = JSON.parse(data) as Record<string, unknown>
    const normalised: Record<string, MutantCacheEntry> = {}
    for (const [key, value] of Object.entries(raw)) {
      const decoded = decodeCacheKey(key)
      if (typeof value === 'string') {
        normalised[key] = { ...decoded, status: value as MutantStatus }
        continue
      }
      if (value && typeof value === 'object' && 'status' in value) {
        const entry = value as Partial<MutantCacheEntry>
        const status = entry.status ?? 'skipped'
        const file = entry.file ?? decoded.file
        const line = entry.line ?? decoded.line
        const col = entry.col ?? decoded.col
        const mutator = entry.mutator ?? decoded.mutator
        normalised[key] = { status, file, line, col, mutator }
        continue
      }
    }
    return normalised
  } catch {
    return {}
  }
}
