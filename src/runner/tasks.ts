import type { Variant } from '../types/mutant.js'
import type { PerTestCoverageMap } from '../utils/coverage.js'
import type { TestMap } from './discover.js'
import { filterTestsByCoverage } from './variants.js'
import { hash, keyForTests } from './cache.js'
import { createLogger } from '../utils/logger.js'
import { normalizePath } from '../utils/normalizePath.js'

const log = createLogger('tasks')

export interface MutantTask {
  v: Variant
  tests: string[]
  key: string
  directTests?: readonly string[]
}

/**
 * Prepare mutant tasks from variants by pruning tests via per-test coverage,
 * sorting tests deterministically, and computing cache keys.
 */
export function prepareTasks(
  variants: readonly Variant[],
  perTestCoverage: PerTestCoverageMap | null,
  directTestMap?: TestMap,
): MutantTask[] {
  return variants.map((v) => {
    let tests = Array.from(v.tests)
    if (perTestCoverage && tests.length) {
      const before = tests.length
      tests = filterTestsByCoverage(perTestCoverage, tests, v.file, v.line)
      if (tests.length !== before) {
        log.debug(
          `Pruned tests ${before} -> ${tests.length} for mutant ${v.name} via per-test coverage`,
        )
      }
    }
    tests.sort()
    const testSig = hash(keyForTests(tests))
    const codeSig = hash(v.code)
    const key = `${testSig}:${codeSig}`
    const direct = directTestMap?.get(normalizePath(v.file))
    return {
      v,
      tests,
      key,
      ...(direct &&
        direct.size > 0 && { directTests: Array.from(direct).sort() }),
    }
  })
}
