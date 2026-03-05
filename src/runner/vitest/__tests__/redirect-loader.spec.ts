import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  return { ...actual, register: vi.fn() }
})

import { resolve as poolResolve } from '../redirect-loader.js'

describe('pool-redirect-loader resolve', () => {
  afterEach(() => {
    ;(globalThis as any).__mutineer_redirect__ = undefined
    vi.restoreAllMocks()
  })

  it('resolves .js to .ts in the same directory', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-pool-loader-'),
    )
    const parentFile = path.join(tmpDir, 'src', 'index.ts')
    const tsFile = path.join(tmpDir, 'src', 'foo.ts')
    await fs.mkdir(path.dirname(parentFile), { recursive: true })
    await fs.writeFile(parentFile, 'export {}', 'utf8')
    await fs.writeFile(tsFile, 'export const foo = 1', 'utf8')

    try {
      const nextResolve = vi.fn()
      const result = await poolResolve(
        './foo.js',
        { parentURL: pathToFileURL(parentFile).href },
        nextResolve as any,
      )

      expect(nextResolve).not.toHaveBeenCalled()
      expect(result).not.toBeNull()
      expect(result!.shortCircuit).toBe(true)
      expect(result!.url).toBe(pathToFileURL(tsFile).href)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('redirects to mutated file when target matches', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-pool-loader-'),
    )
    const parentFile = path.join(tmpDir, 'src', 'index.ts')
    const fromPath = path.join(tmpDir, 'src', 'target.ts')
    const mutatedPath = path.join(tmpDir, 'mutated.ts')
    await fs.mkdir(path.dirname(parentFile), { recursive: true })
    await fs.writeFile(parentFile, 'export {}', 'utf8')
    await fs.writeFile(fromPath, 'export const target = true', 'utf8')
    await fs.writeFile(mutatedPath, 'export const mutated = true', 'utf8')

    try {
      ;(globalThis as any).__mutineer_redirect__ = {
        from: fromPath,
        to: mutatedPath,
      }
      const nextResolve = vi.fn()
      const result = await poolResolve(
        './target.js',
        { parentURL: pathToFileURL(parentFile).href },
        nextResolve as any,
      )

      expect(nextResolve).not.toHaveBeenCalled()
      expect(result).not.toBeNull()
      expect(result!.shortCircuit).toBe(true)
      expect(result!.url).toBe(pathToFileURL(mutatedPath).href)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('redirects after delegated resolution', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-pool-loader-'),
    )
    const parentFile = path.join(tmpDir, 'src', 'index.ts')
    const fromPath = path.join(tmpDir, 'src', 'delegated.ts')
    const mutatedPath = path.join(tmpDir, 'mutated.ts')
    await fs.mkdir(path.dirname(parentFile), { recursive: true })
    await fs.writeFile(parentFile, 'export {}', 'utf8')
    await fs.writeFile(fromPath, 'export const delegated = true', 'utf8')
    await fs.writeFile(mutatedPath, 'export const mutated = true', 'utf8')

    try {
      ;(globalThis as any).__mutineer_redirect__ = {
        from: fromPath,
        to: mutatedPath,
      }
      const nextResolve = vi.fn().mockResolvedValue({
        url: pathToFileURL(fromPath).href,
        shortCircuit: false,
      })

      const result = await poolResolve(
        './delegated',
        { parentURL: pathToFileURL(parentFile).href },
        nextResolve as any,
      )

      expect(nextResolve).toHaveBeenCalledOnce()
      expect(result).not.toBeNull()
      expect(result!.shortCircuit).toBe(true)
      expect(result!.url).toBe(pathToFileURL(mutatedPath).href)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
