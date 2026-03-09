import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  return { ...actual, register: vi.fn() }
})

import { resolve as poolResolve, initialise } from '../redirect-loader.js'

describe('pool-redirect-loader resolve', () => {
  afterEach(() => {
    ;(globalThis as any).__mutineer_redirect__ = undefined
    delete process.env.MUTINEER_DEBUG
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

  it('passes through non-.js specifiers to nextResolve', async () => {
    const nextResolve = vi.fn().mockResolvedValue({
      url: 'file:///some/module.ts',
      shortCircuit: false,
    })

    const result = await poolResolve(
      './module',
      { parentURL: 'file:///src/index.ts' },
      nextResolve as any,
    )

    expect(nextResolve).toHaveBeenCalled()
    expect(result!.url).toBe('file:///some/module.ts')
  })

  it('passes through builtin modules to nextResolve', async () => {
    const nextResolve = vi.fn().mockResolvedValue({
      url: 'node:fs',
      shortCircuit: true,
    })

    const result = await poolResolve(
      'node:fs',
      { parentURL: 'file:///src/index.ts' },
      nextResolve as any,
    )

    expect(nextResolve).toHaveBeenCalled()
    expect(result!.url).toBe('node:fs')
  })

  it('skips .js->ts resolution for non-relative specifiers', async () => {
    const nextResolve = vi.fn().mockResolvedValue({
      url: 'file:///node_modules/pkg/index.js',
      shortCircuit: false,
    })

    const result = await poolResolve(
      'some-package/foo.js',
      { parentURL: 'file:///src/index.ts' },
      nextResolve as any,
    )

    expect(nextResolve).toHaveBeenCalled()
    expect(result!.url).toBe('file:///node_modules/pkg/index.js')
  })

  it('resolves .js to .tsx when .ts does not exist', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-pool-loader-'),
    )
    const parentFile = path.join(tmpDir, 'src', 'index.ts')
    const tsxFile = path.join(tmpDir, 'src', 'comp.tsx')
    await fs.mkdir(path.dirname(parentFile), { recursive: true })
    await fs.writeFile(parentFile, 'export {}', 'utf8')
    await fs.writeFile(tsxFile, 'export const Comp = () => null', 'utf8')

    try {
      const nextResolve = vi.fn()
      const result = await poolResolve(
        './comp.js',
        { parentURL: pathToFileURL(parentFile).href },
        nextResolve as any,
      )

      expect(nextResolve).not.toHaveBeenCalled()
      expect(result!.shortCircuit).toBe(true)
      expect(result!.url).toBe(pathToFileURL(tsxFile).href)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('tries parent of __mutineer__ directory for ts resolution', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-pool-loader-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const mutineerDir = path.join(srcDir, '__mutineer__')
    await fs.mkdir(mutineerDir, { recursive: true })

    const parentFile = path.join(mutineerDir, 'mutant.ts')
    const tsFile = path.join(srcDir, 'sibling.ts')
    await fs.writeFile(parentFile, 'export {}', 'utf8')
    await fs.writeFile(tsFile, 'export const x = 1', 'utf8')

    try {
      const nextResolve = vi.fn()
      const result = await poolResolve(
        './sibling.js',
        { parentURL: pathToFileURL(parentFile).href },
        nextResolve as any,
      )

      expect(nextResolve).not.toHaveBeenCalled()
      expect(result!.shortCircuit).toBe(true)
      expect(result!.url).toBe(pathToFileURL(tsFile).href)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('initialise sets debug mode', () => {
    // Should not throw
    initialise({ debug: true })
    initialise({ debug: false })
    initialise(undefined)
  })

  it('returns null from tryResolveTsExtension when parentURL is invalid', async () => {
    const nextResolve = vi.fn().mockResolvedValue({
      url: 'file:///fallback.js',
      shortCircuit: false,
    })

    // parentURL is not a valid file URL, so tryResolveTsExtension should return null
    await poolResolve(
      './foo.js',
      { parentURL: 'not-a-valid-url' },
      nextResolve as any,
    )

    // Falls through to nextResolve
    expect(nextResolve).toHaveBeenCalled()
  })
})
