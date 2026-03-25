import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type { MutantPayload } from '../types.js'
import type { MutantRunSummary } from '../../types/mutant.js'
import {
  getMutantFilePath,
  setRedirect,
  clearRedirect,
} from '../shared/index.js'
import { createLogger } from '../../utils/logger.js'
import { toErrorMessage } from '../../utils/errors.js'

const log = createLogger('jest-runtime')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface JestTestResult {
  failureMessage?: string
}

interface JestAggregatedResult {
  success: boolean
  numTotalTests?: number
  testResults?: JestTestResult[]
}

export type JestRunCLI = (
  argv: Record<string, unknown>,
  projects: string[],
) => Promise<{
  results: JestAggregatedResult
  globalConfig: unknown
}>

export interface JestWorkerRuntimeOptions {
  workerId: string
  cwd: string
  jestConfigPath?: string
}

/**
 * Get the path to the pre-built Jest resolver module.
 */
function getResolverPath(): string {
  // The resolver.cjs is in the same directory as this file
  return path.join(__dirname, 'resolver.cjs')
}

async function loadRunCLI(
  requireFromCwd: NodeJS.Require,
): Promise<{ runCLI: JestRunCLI }> {
  try {
    return requireFromCwd('@jest/core') as { runCLI: JestRunCLI }
  } catch {
    return import('@jest/core') as unknown as { runCLI: JestRunCLI }
  }
}

export class JestWorkerRuntime {
  private readonly resolverPath: string
  private readonly requireFromCwd: NodeJS.Require

  constructor(private readonly options: JestWorkerRuntimeOptions) {
    this.requireFromCwd = createRequire(path.join(options.cwd, 'package.json'))
    this.resolverPath = getResolverPath()
  }

  async init(): Promise<void> {
    // Resolver is pre-built, no initialization needed
  }

  async shutdown(): Promise<void> {
    // Resolver is pre-built, no cleanup needed
  }

  async run(mutant: MutantPayload, tests: string[]): Promise<MutantRunSummary> {
    const start = Date.now()

    try {
      const mutantPath = getMutantFilePath(mutant.file, mutant.id)
      fs.writeFileSync(mutantPath, mutant.code, 'utf8')

      const redirectFrom = path.resolve(mutant.file)
      setRedirect({ from: redirectFrom, to: mutantPath })
      process.env.MUTINEER_REDIRECT_FROM = redirectFrom
      process.env.MUTINEER_REDIRECT_TO = mutantPath

      const cliOptions: Record<string, unknown> = {
        _: [...tests],
        $0: 'mutineer',
        runInBand: true,
        runTestsByPath: true,
        testPathPattern: [...tests],
        watch: false,
        passWithNoTests: true,
        resolver: this.resolverPath,
        silent: true,
      }

      if (this.options.jestConfigPath) {
        cliOptions.config = this.options.jestConfigPath
      }

      const { runCLI } = await loadRunCLI(this.requireFromCwd)
      const { results } = await runCLI(cliOptions, [this.options.cwd])
      const killed = !results.success
      const failureMessages = results.testResults
        ?.map((r: JestTestResult) => r.failureMessage)
        .filter(Boolean)
        .join('\n')

      log.debug(
        `runCLI success=${results.success} tests=${results.numTotalTests ?? 'n/a'}`,
      )

      return {
        killed,
        durationMs: Date.now() - start,
        error: failureMessages || undefined,
      }
    } catch (err) {
      log.debug(`runCLI error: ${err}`)
      return {
        killed: true,
        durationMs: Date.now() - start,
        error: toErrorMessage(err),
      }
    } finally {
      const mutantPath = getMutantFilePath(mutant.file, mutant.id)
      clearRedirect()
      delete process.env.MUTINEER_REDIRECT_FROM
      delete process.env.MUTINEER_REDIRECT_TO

      try {
        fs.rmSync(mutantPath, { force: true })
      } catch {
        // ignore
      }
    }
  }
}

export function createJestWorkerRuntime(
  options: JestWorkerRuntimeOptions,
): JestWorkerRuntime {
  return new JestWorkerRuntime(options)
}
