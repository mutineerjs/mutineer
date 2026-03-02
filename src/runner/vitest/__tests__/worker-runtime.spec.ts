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
