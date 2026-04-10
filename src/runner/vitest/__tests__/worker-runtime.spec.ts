import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createVitestWorkerRuntime } from '../worker-runtime.js'

const initFn = vi.fn()
const closeFn = vi.fn()
const runSpecsFn = vi.fn()
const invalidateFn = vi.fn()
const getProjectByNameFn = vi.fn()

vi.mock('vitest/node', () => ({
  createVitest: vi.fn(async () => ({
    init: initFn,
    close: closeFn,
    runTestSpecifications: runSpecsFn,
    invalidateFile: invalidateFn,
    getProjectByName: getProjectByNameFn,
  })),
}))

describe('VitestWorkerRuntime', () => {
  const tmpFiles: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    getProjectByNameFn.mockReturnValue({
      createSpecification: (file: string) => ({ moduleId: file }),
    })
    runSpecsFn.mockResolvedValue({
      testModules: [{ moduleId: 'a', ok: () => false }],
    })
  })

  afterEach(() => {
    for (const f of tmpFiles.splice(0)) {
      try {
        fs.rmSync(f, { recursive: true, force: true })
      } catch {}
    }
  })

  it('runs specs and reports kill based on results', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w1', cwd: tmp })
    await runtime.init()

    const result = await runtime.run(
      {
        id: 'mut#1',
        name: 'm',
        file: path.join(tmp, 'src.ts'),
        code: 'export const x=1',
        line: 1,
        col: 1,
      },
      [path.join(tmp, 'test.ts')],
    )

    expect(initFn).toHaveBeenCalled()
    expect(runSpecsFn).toHaveBeenCalled()
    expect(result.killed).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'src', '__mutineer__'))).toBe(false)
    await runtime.shutdown()
  })

  it('throws when run is called before init', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({
      workerId: 'w-noinit',
      cwd: tmp,
    })

    await expect(
      runtime.run(
        {
          id: 'mut#err',
          name: 'm',
          file: path.join(tmp, 'src.ts'),
          code: 'export const x=1',
          line: 1,
          col: 1,
        },
        [path.join(tmp, 'test.ts')],
      ),
    ).rejects.toThrow('Vitest runtime not initialised')
  })

  it('shutdown is a no-op when not initialised', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({
      workerId: 'w-noinit2',
      cwd: tmp,
    })

    // Should not throw
    await runtime.shutdown()
    expect(closeFn).not.toHaveBeenCalled()
  })

  it('passes vitestConfigPath option to createVitest', async () => {
    const { createVitest } = await import('vitest/node')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({
      workerId: 'w-config',
      cwd: tmp,
      vitestConfigPath: '/custom/vitest.config.ts',
    })
    await runtime.init()

    expect(createVitest).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ config: '/custom/vitest.config.ts' }),
      expect.any(Object),
    )
    await runtime.shutdown()
  })

  it('passes maxWorkers: 1 and watch: false to createVitest to prevent fork resource contention and FS watcher re-runs', async () => {
    const { createVitest } = await import('vitest/node')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w-mw', cwd: tmp })
    await runtime.init()

    expect(createVitest).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ maxWorkers: 1, watch: false }),
      expect.any(Object),
    )
    await runtime.shutdown()
  })

  it('handles non-Error thrown during run', async () => {
    runSpecsFn.mockRejectedValue('string error')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({
      workerId: 'w-strerr',
      cwd: tmp,
    })
    await runtime.init()

    const result = await runtime.run(
      {
        id: 'mut#3',
        name: 'm',
        file: path.join(tmp, 'src.ts'),
        code: 'export const x=1',
        line: 1,
        col: 1,
      },
      [path.join(tmp, 'test.ts')],
    )

    expect(result.killed).toBe(true)
    expect(result.error).toBe('string error')
    await runtime.shutdown()
  })

  it('collects passingTests fullNames from modules when mutant escapes', async () => {
    const makeModule = (moduleId: string, names: string[]) => ({
      moduleId,
      ok: () => true,
      children: {
        allTests: (_state: string) => names.map((n) => ({ fullName: n })),
      },
    })
    runSpecsFn.mockResolvedValue({
      testModules: [
        makeModule(path.join(os.tmpdir(), 'test.ts'), [
          'Math > adds',
          'Math > subtracts',
        ]),
      ],
    })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-pt-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w-pt', cwd: tmp })
    await runtime.init()

    const result = await runtime.run(
      {
        id: 'mut#pt',
        name: 'm',
        file: path.join(tmp, 'src.ts'),
        code: 'export const x=1',
        line: 1,
        col: 1,
      },
      [path.join(os.tmpdir(), 'test.ts')],
    )

    expect(result.killed).toBe(false)
    expect(result.passingTests).toEqual(['Math > adds', 'Math > subtracts'])
    await runtime.shutdown()
  })

  it('omits passingTests when mutant is killed', async () => {
    runSpecsFn.mockResolvedValue({
      testModules: [
        {
          moduleId: path.join(os.tmpdir(), 'test.ts'),
          ok: () => false,
          children: {
            allTests: (_state: string) => [{ fullName: 'Math > adds' }],
          },
        },
      ],
    })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-kpt-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w-kpt', cwd: tmp })
    await runtime.init()

    const result = await runtime.run(
      {
        id: 'mut#kpt',
        name: 'm',
        file: path.join(tmp, 'src.ts'),
        code: 'export const x=1',
        line: 1,
        col: 1,
      },
      [path.join(os.tmpdir(), 'test.ts')],
    )

    expect(result.killed).toBe(true)
    expect(result.passingTests).toBeUndefined()
    await runtime.shutdown()
  })

  it('falls back to all testModules when no relevant modules match', async () => {
    runSpecsFn.mockResolvedValue({
      testModules: [{ moduleId: 'unknown-module', ok: () => true }],
    })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({
      workerId: 'w-fallback',
      cwd: tmp,
    })
    await runtime.init()

    const result = await runtime.run(
      {
        id: 'mut#4',
        name: 'm',
        file: path.join(tmp, 'src.ts'),
        code: 'export const x=1',
        line: 1,
        col: 1,
      },
      [path.join(tmp, 'test.ts')],
    )

    // Falls back to all testModules; 'unknown-module' reports ok() = true
    expect(result.killed).toBe(false)
    await runtime.shutdown()
  })

  it('returns escaped when no specs produced', async () => {
    getProjectByNameFn.mockReturnValue({ createSpecification: () => null })
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w2', cwd: tmp })
    await runtime.init()

    const result = await runtime.run(
      {
        id: 'mut#2',
        name: 'm',
        file: path.join(tmp, 'src.ts'),
        code: 'export const x=1',
        line: 1,
        col: 1,
      },
      [path.join(tmp, 'test.ts')],
    )

    expect(result.killed).toBe(false)
    await runtime.shutdown()
  })

  it('writes setup.mjs when MUTINEER_ACTIVE_ID_FILE is set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-setup-'))
    tmpFiles.push(tmp)
    const activeIdFile = path.join(tmp, '__mutineer__', 'active_id_wx.txt')
    const origEnv = process.env.MUTINEER_ACTIVE_ID_FILE
    process.env.MUTINEER_ACTIVE_ID_FILE = activeIdFile

    try {
      const runtime = createVitestWorkerRuntime({ workerId: 'wx', cwd: tmp })
      await runtime.init()

      const setupFile = path.join(tmp, '__mutineer__', 'setup.mjs')
      expect(fs.existsSync(setupFile)).toBe(true)
      expect(fs.readFileSync(setupFile, 'utf8')).toContain(
        '__mutineer_active_id__',
      )
      await runtime.shutdown()
    } finally {
      if (origEnv === undefined) {
        delete process.env.MUTINEER_ACTIVE_ID_FILE
      } else {
        process.env.MUTINEER_ACTIVE_ID_FILE = origEnv
      }
    }
  })

  it('uses schema path when isFallback is false and MUTINEER_ACTIVE_ID_FILE is set', async () => {
    const tmp = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mutineer-worker-schema-'),
    )
    tmpFiles.push(tmp)
    const activeIdFile = path.join(tmp, '__mutineer__', 'active_id_ws.txt')
    const origEnv = process.env.MUTINEER_ACTIVE_ID_FILE
    process.env.MUTINEER_ACTIVE_ID_FILE = activeIdFile

    try {
      const runtime = createVitestWorkerRuntime({ workerId: 'ws', cwd: tmp })
      await runtime.init()

      await runtime.run(
        {
          id: 'mut#schema',
          name: 'm',
          file: path.join(tmp, 'src.ts'),
          code: 'export const x=1',
          line: 1,
          col: 1,
          isFallback: false,
        },
        [path.join(tmp, 'test.ts')],
      )

      // invalidateFile should be called with setup.mjs path to force re-import per vm context
      const setupFile = path.join(tmp, '__mutineer__', 'setup.mjs')
      expect(invalidateFn).toHaveBeenCalledWith(setupFile)
      // Active ID file should be cleared after run
      expect(fs.readFileSync(activeIdFile, 'utf8')).toBe('')
      await runtime.shutdown()
    } finally {
      if (origEnv === undefined) {
        delete process.env.MUTINEER_ACTIVE_ID_FILE
      } else {
        process.env.MUTINEER_ACTIVE_ID_FILE = origEnv
      }
    }
  })

  it('uses fallback path when isFallback is true even if MUTINEER_ACTIVE_ID_FILE is set', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-fb-'))
    tmpFiles.push(tmp)
    const activeIdFile = path.join(tmp, '__mutineer__', 'active_id_wf.txt')
    const origEnv = process.env.MUTINEER_ACTIVE_ID_FILE
    process.env.MUTINEER_ACTIVE_ID_FILE = activeIdFile

    try {
      const runtime = createVitestWorkerRuntime({ workerId: 'wf', cwd: tmp })
      await runtime.init()

      await runtime.run(
        {
          id: 'mut#fb',
          name: 'm',
          file: path.join(tmp, 'src.ts'),
          code: 'export const x=1',
          line: 1,
          col: 1,
          isFallback: true,
        },
        [path.join(tmp, 'test.ts')],
      )

      // invalidateFile SHOULD be called for fallback path
      expect(invalidateFn).toHaveBeenCalledWith(path.join(tmp, 'src.ts'))
      await runtime.shutdown()
    } finally {
      if (origEnv === undefined) {
        delete process.env.MUTINEER_ACTIVE_ID_FILE
      } else {
        process.env.MUTINEER_ACTIVE_ID_FILE = origEnv
      }
    }
  })

  it('adds setup.mjs and source file to watcher.invalidates for schema path; adds source file for fallback path', async () => {
    const { createVitest } = await import('vitest/node')
    const invalidates = new Set<string>()
    vi.mocked(createVitest).mockResolvedValueOnce({
      init: initFn,
      close: closeFn,
      runTestSpecifications: runSpecsFn,
      invalidateFile: invalidateFn,
      getProjectByName: getProjectByNameFn,
      watcher: { invalidates },
    } as any)

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-winv-'))
    tmpFiles.push(tmp)
    const activeIdFile = path.join(tmp, '__mutineer__', 'active_id_winv.txt')
    const origEnv = process.env.MUTINEER_ACTIVE_ID_FILE
    process.env.MUTINEER_ACTIVE_ID_FILE = activeIdFile

    try {
      const runtime = createVitestWorkerRuntime({
        workerId: 'w-winv',
        cwd: tmp,
      })
      await runtime.init()

      const mutantFile = path.join(tmp, 'src.ts')
      const setupFile = path.join(tmp, '__mutineer__', 'setup.mjs')

      // Schema path: both setup.mjs AND source file must be in watcher.invalidates
      // so the fork re-fetches schema content (with ternary chains) rather than
      // reusing the baseline-cached original code.
      await runtime.run(
        {
          id: 'mut#winv-schema',
          name: 'm',
          file: mutantFile,
          code: 'export const x=1',
          line: 1,
          col: 1,
          isFallback: false,
        },
        [path.join(tmp, 'test.ts')],
      )
      expect(invalidates.has(path.resolve(setupFile))).toBe(true)
      expect(invalidates.has(path.resolve(mutantFile))).toBe(true)

      // Fallback path: source file in watcher.invalidates
      invalidates.clear()
      await runtime.run(
        {
          id: 'mut#winv-fallback',
          name: 'm',
          file: mutantFile,
          code: 'export const x=0',
          line: 1,
          col: 1,
          isFallback: true,
        },
        [path.join(tmp, 'test.ts')],
      )
      expect(invalidates.has(path.resolve(mutantFile))).toBe(true)
      expect(invalidates.has(path.resolve(setupFile))).toBe(false)

      await runtime.shutdown()
    } finally {
      if (origEnv === undefined) {
        delete process.env.MUTINEER_ACTIVE_ID_FILE
      } else {
        process.env.MUTINEER_ACTIVE_ID_FILE = origEnv
      }
    }
  })

  it('logs error and rethrows when vitest.init() throws', async () => {
    const { createVitest } = await import('vitest/node')
    const initError = new Error('init failed')
    vi.mocked(createVitest).mockResolvedValueOnce({
      init: vi.fn().mockRejectedValue(initError),
      close: closeFn,
      runTestSpecifications: runSpecsFn,
      invalidateFile: invalidateFn,
      getProjectByName: getProjectByNameFn,
    } as any)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const tmp = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mutineer-worker-initerr-'),
    )
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({
      workerId: 'w-initerr',
      cwd: tmp,
    })
    await expect(runtime.init()).rejects.toThrow('init failed')
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialise Vitest'),
    )
    spy.mockRestore()
  })

  it('clears state.filesMap before each run to prevent memory accumulation', async () => {
    const { createVitest } = await import('vitest/node')
    const clearFn = vi.fn()
    vi.mocked(createVitest).mockResolvedValueOnce({
      init: initFn,
      close: closeFn,
      runTestSpecifications: runSpecsFn,
      invalidateFile: invalidateFn,
      getProjectByName: getProjectByNameFn,
      state: { filesMap: { clear: clearFn } },
    } as any)

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-state-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w-state', cwd: tmp })
    await runtime.init()

    const mutant = {
      id: 'mut#state',
      name: 'm',
      file: path.join(tmp, 'src.ts'),
      code: 'export const x=1',
      line: 1,
      col: 1,
    }
    await runtime.run(mutant, [path.join(tmp, 'test.ts')])
    await runtime.run({ ...mutant, id: 'mut#state2' }, [
      path.join(tmp, 'test.ts'),
    ])

    expect(clearFn).toHaveBeenCalledTimes(2)
    await runtime.shutdown()
  })

  it('calls vite:vue handleHotUpdate to clear SFC descriptor cache for Vue fallback mutations', async () => {
    const { createVitest } = await import('vitest/node')
    const handleHotUpdate = vi.fn().mockResolvedValue([])

    vi.mocked(createVitest).mockResolvedValueOnce({
      init: initFn,
      close: closeFn,
      runTestSpecifications: runSpecsFn,
      invalidateFile: invalidateFn,
      getProjectByName: getProjectByNameFn,
      projects: [
        {
          _vite: {
            config: { plugins: [{ name: 'vite:vue', handleHotUpdate }] },
            moduleGraph: { getModulesByFile: () => [] },
          },
        },
      ],
    } as any)

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-vue-'))
    tmpFiles.push(tmp)
    const vueFile = path.join(tmp, 'Counter.vue')
    const runtime = createVitestWorkerRuntime({ workerId: 'w-vue', cwd: tmp })
    await runtime.init()

    const mutantCode = '<template><div>mutant</div></template>'
    await runtime.run(
      {
        id: 'mut#vue',
        name: 'm',
        file: vueFile,
        code: mutantCode,
        line: 1,
        col: 1,
        isFallback: true,
      },
      [path.join(tmp, 'test.ts')],
    )

    expect(handleHotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ file: path.resolve(vueFile) }),
    )
    const ctx = handleHotUpdate.mock.calls[0][0]
    await expect(ctx.read()).resolves.toBe(mutantCode)
    await runtime.shutdown()
  })

  it('adds Vue sub-module IDs to watcher.invalidates for fallback Vue mutations', async () => {
    const { createVitest } = await import('vitest/node')
    const invalidates = new Set<string>()
    const handleHotUpdate = vi.fn().mockResolvedValue([])

    const tmp = fs.mkdtempSync(
      path.join(os.tmpdir(), 'mutineer-worker-vuesub-'),
    )
    tmpFiles.push(tmp)
    const vueFile = path.join(tmp, 'Counter.vue')
    const resolvedVue = path.resolve(vueFile)
    const subModuleId = `${resolvedVue}?type=template&v=abc`

    vi.mocked(createVitest).mockResolvedValueOnce({
      init: initFn,
      close: closeFn,
      runTestSpecifications: runSpecsFn,
      invalidateFile: invalidateFn,
      getProjectByName: getProjectByNameFn,
      watcher: { invalidates },
      projects: [
        {
          _vite: {
            config: { plugins: [{ name: 'vite:vue', handleHotUpdate }] },
            moduleGraph: {
              getModulesByFile: (f: string) =>
                f === resolvedVue
                  ? [{ id: resolvedVue }, { id: subModuleId }]
                  : [],
            },
          },
        },
      ],
    } as any)

    const runtime = createVitestWorkerRuntime({
      workerId: 'w-vuesub',
      cwd: tmp,
    })
    await runtime.init()

    await runtime.run(
      {
        id: 'mut#vuesub',
        name: 'm',
        file: vueFile,
        code: '<template><div>mutant</div></template>',
        line: 1,
        col: 1,
        isFallback: true,
      },
      [path.join(tmp, 'test.ts')],
    )

    // Sub-module ID should be in watcher.invalidates; root module ID should not be added twice
    expect(invalidates.has(subModuleId)).toBe(true)
    expect(invalidates.has(resolvedVue)).toBe(true) // already added by main fallback path
    await runtime.shutdown()
  })

  it('does not call vite:vue handleHotUpdate for non-Vue fallback mutations', async () => {
    const { createVitest } = await import('vitest/node')
    const handleHotUpdate = vi.fn().mockResolvedValue([])

    vi.mocked(createVitest).mockResolvedValueOnce({
      init: initFn,
      close: closeFn,
      runTestSpecifications: runSpecsFn,
      invalidateFile: invalidateFn,
      getProjectByName: getProjectByNameFn,
      projects: [
        {
          _vite: {
            config: { plugins: [{ name: 'vite:vue', handleHotUpdate }] },
            moduleGraph: { getModulesByFile: () => [] },
          },
        },
      ],
    } as any)

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-ts2-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w-ts2', cwd: tmp })
    await runtime.init()

    await runtime.run(
      {
        id: 'mut#ts2',
        name: 'm',
        file: path.join(tmp, 'src.ts'),
        code: 'export const x=1',
        line: 1,
        col: 1,
        isFallback: true,
      },
      [path.join(tmp, 'test.ts')],
    )

    expect(handleHotUpdate).not.toHaveBeenCalled()
    await runtime.shutdown()
  })

  it('clears fetchCaches and fetchCache entries for the mutant file before each run', async () => {
    const { createVitest } = await import('vitest/node')
    const ssrCache = new Map<string, unknown>()
    const webCache = new Map<string, unknown>()
    const fetchCache = new Map<string, unknown>()
    const mutantFile = path.join(os.tmpdir(), 'fc-src.ts')
    ssrCache.set(mutantFile, { timestamp: 1, result: 'stale' })
    webCache.set(mutantFile, { timestamp: 1, result: 'stale' })
    fetchCache.set(mutantFile, { timestamp: 1, result: 'stale' })

    vi.mocked(createVitest).mockResolvedValueOnce({
      init: initFn,
      close: closeFn,
      runTestSpecifications: runSpecsFn,
      invalidateFile: invalidateFn,
      getProjectByName: getProjectByNameFn,
      projects: [
        {
          vitenode: {
            fetchCaches: { ssr: ssrCache, web: webCache },
            fetchCache,
          },
        },
      ],
    } as any)

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutineer-worker-fc-'))
    tmpFiles.push(tmp)
    const runtime = createVitestWorkerRuntime({ workerId: 'w-fc', cwd: tmp })
    await runtime.init()

    await runtime.run(
      {
        id: 'mut#fc',
        name: 'm',
        file: mutantFile,
        code: 'export const x=1',
        line: 1,
        col: 1,
      },
      [path.join(tmp, 'test.ts')],
    )

    const resolvedFile = path.resolve(mutantFile)
    expect(ssrCache.has(resolvedFile)).toBe(false)
    expect(webCache.has(resolvedFile)).toBe(false)
    expect(fetchCache.has(resolvedFile)).toBe(false)
    await runtime.shutdown()
  })
})
