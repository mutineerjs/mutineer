import { createVitest } from 'vitest/node'
import type { Vitest, TestSpecification } from 'vitest/node'
import fs from 'node:fs'
import path from 'node:path'

import type { MutantPayload } from '../types.js'
import type { MutantRunSummary } from '../../types/mutant.js'
import { poolMutineerPlugin } from './plugin.js'
import {
  getMutantFilePath,
  setRedirect,
  clearRedirect,
} from '../shared/index.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('vitest-runtime')

const SETUP_MJS_CONTENT = `import { beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
const _f = process.env.MUTINEER_ACTIVE_ID_FILE
beforeAll(() => {
  try { globalThis.__mutineer_active_id__ = readFileSync(_f, 'utf8').trim() || null }
  catch { globalThis.__mutineer_active_id__ = null }
})
`

export interface VitestWorkerRuntimeOptions {
  workerId: string
  cwd: string
  vitestConfigPath?: string
  vitestProject?: string
}

export class VitestWorkerRuntime {
  private vitest: Vitest | null = null

  constructor(private readonly options: VitestWorkerRuntimeOptions) {}

  async init(): Promise<void> {
    try {
      // Write setup.mjs before creating Vitest so the config hook can find it
      const activeIdFile = process.env.MUTINEER_ACTIVE_ID_FILE
      if (activeIdFile && path.isAbsolute(activeIdFile)) {
        const mutineerDir = path.dirname(activeIdFile)
        fs.mkdirSync(mutineerDir, { recursive: true })
        fs.writeFileSync(
          path.join(mutineerDir, 'setup.mjs'),
          SETUP_MJS_CONTENT,
          'utf8',
        )
      }

      this.vitest = await createVitest(
        'test',
        {
          watch: false,
          reporters: ['dot'],
          silent: true,
          pool: 'forks',
          bail: 1,
          // Limit to 1 inner fork so bail:1 stops after the first failure
          // without spawning additional fork processes. The single fork is
          // persistent (reused across mutant runs), eliminating per-mutant
          // fork startup overhead.
          maxWorkers: 1,
          ...(this.options.vitestConfigPath
            ? { config: this.options.vitestConfigPath }
            : {}),
        },
        {
          plugins: [poolMutineerPlugin()],
        },
      )

      await this.vitest.init()
      log.debug(`Vitest initialised for worker ${this.options.workerId}`)
    } catch (err) {
      log.error(`Failed to initialise Vitest: ${err}`)
      throw err
    }
  }

  async shutdown(): Promise<void> {
    if (!this.vitest) return
    await this.vitest.close()
    this.vitest = null
  }

  async run(mutant: MutantPayload, tests: string[]): Promise<MutantRunSummary> {
    if (!this.vitest) {
      throw new Error('Vitest runtime not initialised')
    }

    const start = Date.now()
    const activeIdFile = process.env.MUTINEER_ACTIVE_ID_FILE
    const useSchema = !mutant.isFallback && !!activeIdFile

    try {
      if (useSchema) {
        fs.writeFileSync(activeIdFile!, mutant.id, 'utf8')
        log.debug(`Schema path: wrote active ID ${mutant.id}`)
      } else {
        const mutantPath = getMutantFilePath(mutant.file, mutant.id)
        fs.writeFileSync(mutantPath, mutant.code, 'utf8')
        log.debug(`Wrote mutant to ${mutantPath}`)

        setRedirect({
          from: path.resolve(mutant.file),
          to: mutantPath,
        })

        this.vitest.invalidateFile(mutant.file)
        log.debug(`Invalidated ${mutant.file}`)
      }

      const specs: TestSpecification[] = []
      const projectName = this.options.vitestProject ?? ''
      for (const testFile of tests) {
        const spec = this.vitest
          .getProjectByName(projectName)
          ?.createSpecification(testFile)
        if (spec) specs.push(spec)
      }

      if (specs.length === 0) {
        return {
          killed: false,
          durationMs: Date.now() - start,
        }
      }

      log.debug(`Running ${specs.length} test specs`)
      // Clear accumulated test results from previous runs. Without this,
      // state.filesMap grows unboundedly (each run appends to the array per
      // filepath), causing O(N) work in getFiles() on every run and
      // progressive GC pressure that slows down later mutants.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this.vitest as any).state?.filesMap?.clear()
      const results = await this.vitest.runTestSpecifications(specs)

      const requestedModules = new Set(specs.map((s) => s.moduleId))
      const relevantModules = results.testModules.filter(
        (mod: { moduleId: string }) => requestedModules.has(mod.moduleId),
      )
      const modulesForDecision = relevantModules.length
        ? relevantModules
        : results.testModules
      const killed = modulesForDecision.some(
        (mod: { ok: () => boolean }) => !mod.ok(),
      )

      return {
        killed,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        killed: true,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      if (useSchema) {
        try {
          fs.writeFileSync(activeIdFile!, '', 'utf8')
        } catch {
          // ignore
        }
      } else {
        clearRedirect()
        const mutantPath = getMutantFilePath(mutant.file, mutant.id)
        try {
          fs.rmSync(mutantPath, { force: true })
        } catch {
          // ignore
        }
      }
    }
  }
}

export function createVitestWorkerRuntime(
  options: VitestWorkerRuntimeOptions,
): VitestWorkerRuntime {
  return new VitestWorkerRuntime(options)
}
