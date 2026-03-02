/**
 * Type definitions for mutation strategies.
 *
 * Defines the interface that all mutators must implement and the output format
 * for mutations. This allows for different mutator implementations to be plugged in.
 */

/**
 * Output of a single mutation, including location info and mutated code.
 */
export interface MutationOutput {
  readonly line: number
  readonly col: number
  readonly code: string
}

/**
 * Base interface for AST-based mutators.
 * Implementations should parse source code and generate mutations by analyzing the AST.
 */
export interface ASTMutator {
  readonly name: string
  readonly description: string
  apply(src: string): readonly MutationOutput[]
}

/**
 * Union type for different mutator kinds.
 * Potentially extensible in future to RegexMutator, TextMutator, etc.
 */
export type AnyMutator = ASTMutator

/**
 * Internal interface for operator target locations.
 * Used by operator mutators to track exact positions of operators in source code.
 */
export interface OperatorTarget {
  readonly start: number // operator token start offset (bytes)
  readonly end: number // operator token end offset (bytes)
  readonly line: number // 1-based line number
  readonly col1: number // 1-based column (visual, accounting for tabs)
  readonly op: string // the operator text
}
