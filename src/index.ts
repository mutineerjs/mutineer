import type { MutineerConfig } from './types/config.js'

export type { MutineerConfig, MutateTarget } from './types/config.js'

export type {
  MutantStatus,
  MutantRunStatus,
  MutantCacheEntry,
  MutantResult,
  MutantRunResult,
  MutantRunSummary,
  MutantPayload,
  MutantDescriptor,
  MutantLocation,
  Variant,
} from './types/mutant.js'

export function defineMutineerConfig(cfg: MutineerConfig) {
  return cfg
}
