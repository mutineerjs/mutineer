import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import fssync from 'node:fs'
import { normalizePath } from '../../utils/normalizePath.js'
import { autoDiscoverTargetsAndTests } from '../discover.js'

// Mock node:module's createRequire so that resolve('@vitejs/plugin-vue') returns
// the bare specifier rather than an absolute path. This lets vi.doMock stubs for
// '@vitejs/plugin-vue' continue to intercept the dynamic import after the discover
// code switched to resolving the package path from the user's project root.
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  return {
    ...actual,
    createRequire: (_filename: string | URL) => ({
      resolve: (id: string) => id,
    }),
  }
})

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

describe('createViteResolver Vue plugin gating', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not warn about @vitejs/plugin-vue when no .vue files exist', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-novue-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'a.ts'),
      'export const a = 1\n',
      'utf8',
    )
    const importLine = ['im', 'port { a } from "./a"'].join('')
    await fs.writeFile(
      path.join(srcDir, 'a.test.ts'),
      `${importLine}\n`,
      'utf8',
    )

    try {
      await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      const pluginVueWarnings = warnSpy.mock.calls.filter((args: unknown[]) =>
        String(args[0]).includes('plugin-vue'),
      )
      expect(pluginVueWarnings).toHaveLength(0)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('successfully loads @vitejs/plugin-vue when available and .vue files exist', async () => {
    vi.doMock('@vitejs/plugin-vue', () => ({
      default: () => ({}),
    }))

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-vueok-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'Comp.vue'),
      '<template><div/></template>\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(srcDir, 'a.ts'),
      'export const a = 1\n',
      'utf8',
    )
    const importLine = ['im', 'port { a } from "./a"'].join('')
    await fs.writeFile(
      path.join(srcDir, 'a.test.ts'),
      `${importLine}\n`,
      'utf8',
    )

    try {
      await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
        extensions: ['.vue', '.ts'],
      })
      // Should not warn about plugin-vue
      const pluginVueWarnings = warnSpy.mock.calls.filter((args: unknown[]) =>
        String(args[0]).includes('plugin-vue'),
      )
      expect(pluginVueWarnings).toHaveLength(0)
    } finally {
      vi.doUnmock('@vitejs/plugin-vue')
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('does not load @vitejs/plugin-vue when extensions excludes .vue', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-novueext-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'a.ts'),
      'export const a = 1\n',
      'utf8',
    )
    const importLine = ['im', 'port { a } from "./a"'].join('')
    await fs.writeFile(
      path.join(srcDir, 'a.test.ts'),
      `${importLine}\n`,
      'utf8',
    )

    try {
      const result = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
        extensions: ['.ts'],
      })
      // Plugin-vue code is skipped entirely; no warnings
      const pluginVueWarnings = warnSpy.mock.calls.filter((args: unknown[]) =>
        String(args[0]).includes('plugin-vue'),
      )
      expect(pluginVueWarnings).toHaveLength(0)
      expect(result.targets.length).toBeGreaterThan(0)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('warns when .vue files exist but @vitejs/plugin-vue fails to load', async () => {
    vi.doMock('@vitejs/plugin-vue', () => {
      throw new Error('Cannot find module @vitejs/plugin-vue')
    })

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-vue-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'Comp.vue'),
      '<template><div/></template>\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(srcDir, 'a.ts'),
      'export const a = 1\n',
      'utf8',
    )
    const importLine = ['im', 'port { a } from "./a"'].join('')
    await fs.writeFile(
      path.join(srcDir, 'a.test.ts'),
      `${importLine}\n`,
      'utf8',
    )

    try {
      await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
        extensions: ['.vue', '.ts'],
      })
      const pluginVueWarnings = warnSpy.mock.calls.filter((args: unknown[]) =>
        String(args[0]).includes('plugin-vue'),
      )
      expect(pluginVueWarnings.length).toBeGreaterThan(0)
    } finally {
      vi.doUnmock('@vitejs/plugin-vue')
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('autoDiscoverTargetsAndTests', () => {
  it('returns empty result when no test files found', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-notests-'),
    )
    try {
      const result = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      expect(result.targets).toHaveLength(0)
      expect(result.testMap.size).toBe(0)
      expect(result.directTestMap.size).toBe(0)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('directTestMap only includes direct importers', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-direct-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const moduleX = path.join(srcDir, 'x.ts')
    const moduleY = path.join(srcDir, 'y.ts')
    const testFile = path.join(srcDir, 'a.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(moduleY, 'export const y = 2\n', 'utf8')
    const importY = ['im', 'port { y } from "./y"'].join('')
    await fs.writeFile(moduleX, `${importY}\nexport const x = 1\n`, 'utf8')
    const importX = ['im', 'port { x } from "./x"'].join('')
    await fs.writeFile(testFile, `${importX}\nconsole.log(x)\n`, 'utf8')

    try {
      const { directTestMap } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })

      const testAbs = normalizePath(testFile)
      const xAbs = normalizePath(moduleX)
      const yAbs = normalizePath(moduleY)

      // x is directly imported by the test
      expect(directTestMap.get(xAbs)?.has(testAbs)).toBe(true)
      // y is only transitively imported (x -> y), not directly by the test
      expect(directTestMap.get(yAbs)?.has(testAbs)).toBeFalsy()
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('calls onProgress at least twice with informational messages', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-progress-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const moduleFile = path.join(srcDir, 'foo.ts')
    const testFile = path.join(srcDir, 'foo.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(moduleFile, 'export const foo = 1\n', 'utf8')
    const importLine = ['im', 'port { foo } from "./foo"'].join('')
    await fs.writeFile(testFile, `${importLine}\nconsole.log(foo)\n`, 'utf8')

    const messages: string[] = []

    try {
      await autoDiscoverTargetsAndTests(
        tmpDir,
        { testPatterns: ['**/*.test.ts'] },
        (msg) => messages.push(msg),
      )
      expect(messages.length).toBeGreaterThanOrEqual(2)
      expect(messages.some((m) => m.includes('test file'))).toBe(true)
      expect(messages.some((m) => m.includes('Discovery complete'))).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('shared dep imported by 2 tests appears in testMap for both', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-shared-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const sharedDep = path.join(srcDir, 'shared.ts')
    const test1 = path.join(srcDir, 'a.test.ts')
    const test2 = path.join(srcDir, 'b.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(sharedDep, 'export const shared = 1\n', 'utf8')
    const importShared = ['im', 'port { shared } from "./shared"'].join('')
    await fs.writeFile(test1, `${importShared}\n`, 'utf8')
    await fs.writeFile(test2, `${importShared}\n`, 'utf8')

    try {
      const { testMap } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      const sharedAbs = normalizePath(sharedDep)
      const test1Abs = normalizePath(test1)
      const test2Abs = normalizePath(test2)

      expect(testMap.get(sharedAbs)?.has(test1Abs)).toBe(true)
      expect(testMap.get(sharedAbs)?.has(test2Abs)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('diamond graph: shared grandchild discovered with no duplicates', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-diamond-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const fileA = path.join(srcDir, 'A.ts')
    const fileB = path.join(srcDir, 'B.ts')
    const fileC = path.join(srcDir, 'C.ts')
    const fileD = path.join(srcDir, 'D.ts')
    const testFile = path.join(srcDir, 'test.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(fileD, 'export const d = 4\n', 'utf8')
    const importD = ['im', 'port { d } from "./D"'].join('')
    await fs.writeFile(fileB, `${importD}\nexport const b = 2\n`, 'utf8')
    await fs.writeFile(fileC, `${importD}\nexport const c = 3\n`, 'utf8')
    const importB = ['im', 'port { b } from "./B"'].join('')
    const importC = ['im', 'port { c } from "./C"'].join('')
    await fs.writeFile(
      fileA,
      `${importB}\n${importC}\nexport const a = 1\n`,
      'utf8',
    )
    const importA = ['im', 'port { a } from "./A"'].join('')
    await fs.writeFile(testFile, `${importA}\n`, 'utf8')

    try {
      const { testMap } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      const dAbs = normalizePath(fileD)
      const testAbs = normalizePath(testFile)

      expect(testMap.get(dAbs)?.has(testAbs)).toBe(true)
      // D should only be in testMap once (Set ensures no duplicates)
      expect(testMap.get(dAbs)?.size).toBe(1)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('deep chain: deepest file is discovered correctly', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-deep-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    await fs.mkdir(srcDir, { recursive: true })

    // chain: test -> f1 -> f2 -> f3 -> f4 -> f5
    const files = Array.from({ length: 5 }, (_, i) =>
      path.join(srcDir, `f${i + 1}.ts`),
    )
    const testFile = path.join(srcDir, 'chain.test.ts')

    await fs.writeFile(files[4], 'export const f5 = 5\n', 'utf8')
    for (let i = 3; i >= 0; i--) {
      const importNext = ['im', `port { f${i + 2} } from "./f${i + 2}"`].join(
        '',
      )
      await fs.writeFile(
        files[i],
        `${importNext}\nexport const f${i + 1} = ${i + 1}\n`,
        'utf8',
      )
    }
    const importF1 = ['im', 'port { f1 } from "./f1"'].join('')
    await fs.writeFile(testFile, `${importF1}\n`, 'utf8')

    try {
      const { testMap } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      const f5Abs = normalizePath(files[4])
      const testAbs = normalizePath(testFile)

      expect(testMap.get(f5Abs)?.has(testAbs)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('2 tests directly importing same file both appear in directTestMap', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-direct2-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const sharedDep = path.join(srcDir, 'shared.ts')
    const test1 = path.join(srcDir, 'a.test.ts')
    const test2 = path.join(srcDir, 'b.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(sharedDep, 'export const shared = 1\n', 'utf8')
    const importShared = ['im', 'port { shared } from "./shared"'].join('')
    await fs.writeFile(test1, `${importShared}\n`, 'utf8')
    await fs.writeFile(test2, `${importShared}\n`, 'utf8')

    try {
      const { directTestMap } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      const sharedAbs = normalizePath(sharedDep)
      const test1Abs = normalizePath(test1)
      const test2Abs = normalizePath(test2)

      expect(directTestMap.get(sharedAbs)?.has(test1Abs)).toBe(true)
      expect(directTestMap.get(sharedAbs)?.has(test2Abs)).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('excludes files matching excludePaths prefix', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-exclude-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const adminDir = path.join(srcDir, 'admin')
    const adminFile = path.join(adminDir, 'restricted.ts')
    const publicFile = path.join(srcDir, 'public.ts')
    const testFile = path.join(srcDir, 'a.test.ts')

    await fs.mkdir(adminDir, { recursive: true })
    await fs.writeFile(adminFile, 'export const restricted = 1\n', 'utf8')
    await fs.writeFile(publicFile, 'export const pub = 2\n', 'utf8')
    const importLine = [
      ['im', 'port { pub } from "./public"'].join(''),
      ['im', 'port { restricted } from "./admin/restricted"'].join(''),
    ].join('\n')
    await fs.writeFile(testFile, `${importLine}\n`, 'utf8')

    try {
      const { targets } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
        excludePaths: ['src/admin'],
      })
      const targetFiles = targets.map((t) =>
        normalizePath(typeof t === 'string' ? t : t.file),
      )
      expect(targetFiles.some((f) => f.includes('restricted.ts'))).toBe(false)
      expect(targetFiles.some((f) => f.includes('public.ts'))).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('excludes files matching excludePaths glob pattern', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-excludeglob-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const adminDir = path.join(srcDir, 'admin')
    const adminFile = path.join(adminDir, 'restricted.ts')
    const publicFile = path.join(srcDir, 'public.ts')
    const testFile = path.join(srcDir, 'a.test.ts')

    await fs.mkdir(adminDir, { recursive: true })
    await fs.writeFile(adminFile, 'export const restricted = 1\n', 'utf8')
    await fs.writeFile(publicFile, 'export const pub = 2\n', 'utf8')
    const importLine = [
      ['im', 'port { pub } from "./public"'].join(''),
      ['im', 'port { restricted } from "./admin/restricted"'].join(''),
    ].join('\n')
    await fs.writeFile(testFile, `${importLine}\n`, 'utf8')

    try {
      const { targets } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
        excludePaths: ['src/admin/**'],
      })
      const targetFiles = targets.map((t) =>
        normalizePath(typeof t === 'string' ? t : t.file),
      )
      expect(targetFiles.some((f) => f.includes('restricted.ts'))).toBe(false)
      expect(targetFiles.some((f) => f.includes('public.ts'))).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('handles unreadable dependency gracefully', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-unreadable-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const sourceFile = path.join(srcDir, 'source.ts')
    const testFile = path.join(srcDir, 'source.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    // source.ts imports ./ghost which doesn't exist on disk
    const ghostImport = ['im', 'port { x } from "./ghost"'].join('')
    await fs.writeFile(
      sourceFile,
      `${ghostImport}\nexport const y = 1\n`,
      'utf8',
    )
    const importLine = ['im', 'port { y } from "./source"'].join('')
    await fs.writeFile(testFile, `${importLine}\n`, 'utf8')

    try {
      const { targets } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
      })
      const targetFiles = targets.map((t) =>
        normalizePath(typeof t === 'string' ? t : t.file),
      )
      expect(targetFiles.some((f) => f.includes('source.ts'))).toBe(true)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('uses default testPatterns when cfg.testPatterns is not set', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-defaultpat-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const moduleFile = path.join(srcDir, 'foo.ts')
    const testFile = path.join(srcDir, 'foo.spec.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(moduleFile, 'export const foo = 1\n', 'utf8')
    const importLine = ['im', 'port { foo } from "./foo"'].join('')
    await fs.writeFile(testFile, `${importLine}\n`, 'utf8')

    try {
      // No testPatterns → uses TEST_PATTERNS_DEFAULT which includes **/*.spec.[jt]s?(x)
      const { targets } = await autoDiscoverTargetsAndTests(tmpDir, {})
      const targetFiles = targets.map((t) =>
        normalizePath(typeof t === 'string' ? t : t.file),
      )
      expect(targetFiles).toContain(normalizePath(moduleFile))
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('assigns vue:script-setup kind to .vue source files', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'mutineer-discover-vuekind-'),
    )
    const srcDir = path.join(tmpDir, 'src')
    const vueFile = path.join(srcDir, 'Comp.vue')
    const testFile = path.join(srcDir, 'Comp.test.ts')

    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      vueFile,
      '<script setup>\nconst x = 1\n</script>\n',
      'utf8',
    )
    const importLine = ['im', `port Comp from "./Comp.vue"`].join('')
    await fs.writeFile(testFile, `${importLine}\n`, 'utf8')

    try {
      const { targets } = await autoDiscoverTargetsAndTests(tmpDir, {
        testPatterns: ['**/*.test.ts'],
        extensions: ['.vue', '.ts'],
      })
      const vueTarget = targets.find(
        (t) =>
          typeof t !== 'string' && normalizePath(t.file).endsWith('Comp.vue'),
      )
      expect(vueTarget).toBeDefined()
      expect(typeof vueTarget !== 'string' && vueTarget?.kind).toBe(
        'vue:script-setup',
      )
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

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
