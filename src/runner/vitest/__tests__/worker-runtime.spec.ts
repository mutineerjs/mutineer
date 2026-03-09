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
})
