/**
 * Centralised type definitions.
 *
 * Re-exports all public types from a single entry point for easier imports
 * and better tree-shaking.
 *
 * Usage:
 *   import type { MutineerConfig, MutantStatus } from '../types/index.js'
 */

// Configuration types
export type { MutineerConfig, MutateTarget } from './config.js'

// Mutant/runtime types
export type {
  MutantStatus,
  MutantRunStatus,
  MutantCacheEntry,
  MutantResult,
  MutantRunSummary,
  MutantRunResult,
  MutantPayload,
  MutantDescriptor,
  MutantLocation,
  Variant,
} from './mutant.js'

// Mutation core types
export type { MutationVariant } from '../core/types.js'

// Re-export for convenience
export { defineMutineerConfig } from '../index.js'
