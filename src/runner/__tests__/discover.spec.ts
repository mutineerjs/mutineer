import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import fssync from 'node:fs'
import { normalizePath } from 'vite'
import { autoDiscoverTargetsAndTests } from '../discover.js'

// Mock Vite server creation to avoid opening a real port during tests
vi.mock('vite', async () => {
  const actual = await vi.importActual<typeof import('vite')>('vite')
  return {
    ...actual,
    // Stub createServer to avoid binding ports in tests
    createServer: vi.fn(async (options) => {
      const root = options?.root ?? process.cwd()
      return {
        pluginContainer: {
          resolveId: async (spec: string, importer?: string) => {
            if (path.isAbsolute(spec)) return spec
            const base = importer ? path.dirname(importer) : root
            const candidate = path.resolve(base, spec)
            if (fssync.existsSync(candidate)) return candidate
            if (fssync.existsSync(`${candidate}.ts`)) return `${candidate}.ts`
            if (fssync.existsSync(`${candidate}.js`)) return `${candidate}.js`
            return candidate
          },
        },
        close: async () => {},
      } as any
    }),
  }
})

describe('autoDiscoverTargetsAndTests', () => {
  it('ignores test files when collecting mutate targets', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const moduleFile = path.join(srcDir, 'foo.ts')
    const testFile = path.join(srcDir, 'foo.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(moduleFile, 'export const foo = 1\n', 'utf8')
    const importLine = ['im', 'port { foo } from "./foo"'].join('')
    await fs.writeFile(testFile, `${importLine}\nconsole.log(foo)\n`, 'utf8')

    try {
      const { targets } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      const targetFiles = targets.map((t) =>
        normalizePath(typeof t === 'string' ? t : t.file),
      )

      expect(targetFiles).toContain(normalizePath(moduleFile))
      expect(targetFiles).not.toContain(normalizePath(testFile))
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})
