/**
 * Shared mutant-related type definitions.
 *
 * Centralises the shapes used across the runner and adapters so we
 * don't duplicate unions or object shapes in multiple modules.
 */

export type MutantStatus =
  | 'killed'
  | 'escaped'
  | 'skipped'
  | 'error'
  | 'timeout'
  | 'compile-error'
export type MutantRunStatus = MutantStatus

export interface MutantLocation {
  readonly file: string
  readonly line: number
  readonly col: number
}

export interface MutantDescriptor extends MutantLocation {
  readonly id: string
  readonly name: string
  readonly code: string
}

/** Payload passed to workers/pools for execution. */
export interface MutantPayload extends MutantDescriptor {
  /** When true, this mutant must use the legacy redirect path instead of the schema path. */
  readonly isFallback?: boolean
}

/** Variant with attached test files. */
export interface Variant extends MutantDescriptor {
  readonly tests: readonly string[]
}

export interface MutantCacheEntry extends MutantLocation {
  readonly status: MutantStatus
  readonly mutator: string
  readonly originalSnippet?: string
  readonly mutatedSnippet?: string
  readonly coveringTests?: readonly string[]
  readonly passingTests?: readonly string[]
}

export interface MutantResult extends MutantCacheEntry {
  readonly id: string
  readonly relativePath: string
}

/** Low-level execution result returned by a worker. */
export interface MutantRunSummary {
  readonly killed: boolean
  readonly durationMs: number
  readonly error?: string
  readonly passingTests?: readonly string[]
}

/** Normalised result returned by adapters/orchestrator. */
export interface MutantRunResult {
  readonly status: MutantRunStatus
  readonly durationMs: number
  readonly error?: string
  readonly passingTests?: readonly string[]
}
