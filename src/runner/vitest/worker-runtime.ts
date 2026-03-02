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

export interface VitestWorkerRuntimeOptions {
  workerId: string
  cwd: string
  vitestConfigPath?: string
}

export class VitestWorkerRuntime {
  private vitest: Vitest | null = null

  constructor(private readonly options: VitestWorkerRuntimeOptions) {}

  async init(): Promise<void> {
    try {
      this.vitest = await createVitest(
        'test',
        {
          watch: true,
          reporters: ['dot'],
          silent: true,
          pool: 'forks',
          bail: 1,
          ...(this.options.vitestConfigPath
            ? { config: this.options.vitestConfigPath }
            : {}),
        },
        {
          plugins: [poolMutineerPlugin()],
        },
      )

      await this.vitest.init()
      log.debug(`Vitest initialized for worker ${this.options.workerId}`)
    } catch (err) {
      log.error(`Failed to initialize Vitest: ${err}`)
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
      throw new Error('Vitest runtime not initialized')
    }

    const start = Date.now()

    try {
      const mutantPath = getMutantFilePath(mutant.file, mutant.id)
      fs.writeFileSync(mutantPath, mutant.code, 'utf8')
      log.debug(`Wrote mutant to ${mutantPath}`)

      setRedirect({
        from: path.resolve(mutant.file),
        to: mutantPath,
      })

      this.vitest.invalidateFile(mutant.file)
      log.debug(`Invalidated ${mutant.file}`)

      const specs: TestSpecification[] = []
      for (const testFile of tests) {
        const spec = this.vitest
          .getProjectByName('')
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
      // Clear redirect and clean up temp file
      const mutantPath = getMutantFilePath(mutant.file, mutant.id)
      clearRedirect()
      try {
        fs.rmSync(mutantPath, { force: true })
      } catch {
        // ignore
      }
    }
  }
}

export function createVitestWorkerRuntime(
  options: VitestWorkerRuntimeOptions,
): VitestWorkerRuntime {
  return new VitestWorkerRuntime(options)
}
