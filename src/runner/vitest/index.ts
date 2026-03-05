/**
 * Vitest Test Runner
 *
 * Complete Vitest test runner implementation including adapter, pool, worker runtime,
 * and Vitest-specific plugin/loader utilities.
 */

export {
  VitestAdapter,
  createVitestAdapter,
  isCoverageRequestedInArgs,
} from './adapter.js'
export { VitestPool, runWithPool, type VitestPoolOptions } from './pool.js'
export { poolMutineerPlugin } from './plugin.js'
export type {
  MutantPayload,
  MutantRunResult,
  MutantRunSummary,
} from '../../types/mutant.js'
