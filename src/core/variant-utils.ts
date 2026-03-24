import { getRegistry } from '../mutators/registry.js'
import { buildParseContext } from '../mutators/utils.js'
import type { MutationVariant } from './types.js'
import type { ASTMutator } from '../mutators/registry.js'

/**
 * Shared logic for generating and deduplicating mutations.
 * Extracted to avoid duplication between module.ts and sfc.ts.
 */

interface VariantGenOptions {
  readonly max?: number
}

/**
 * Generate mutations from a registry of mutators, deduplicating the output.
 * Supports early termination when max limit is reached.
 *
 * @param registry - Array of mutators to apply
 * @param code - Source code to mutate
 * @param max - Optional maximum number of variants to generate (must be > 0 if provided)
 * @returns Array of unique mutations
 * @throws Error if max is provided and <= 0
 */
export function generateMutationVariants(
  registry: readonly ASTMutator[],
  code: string,
  opts: VariantGenOptions = {},
): readonly MutationVariant[] {
  const { max } = opts

  // Input validation
  if (max !== undefined && max <= 0) {
    throw new Error(`max must be a positive number, got: ${max}`)
  }

  const variants: MutationVariant[] = []
  const seen = new Set<string>()
  const ctx = buildParseContext(code)

  for (const mutator of registry) {
    const mutations = mutator.applyWithContext
      ? mutator.applyWithContext(code, ctx)
      : mutator.apply(code)
    for (const mutation of mutations) {
      // Skip unchanged code and duplicates in a single check
      if (!seen.has(mutation.code)) {
        seen.add(mutation.code)
        variants.push({
          name: mutator.name,
          code: mutation.code,
          line: mutation.line,
          col: mutation.col,
        })

        // Check if we've reached the limit and exit early
        if (max !== undefined && variants.length >= max) {
          return variants
        }
      }
    }
  }

  return variants
}

/**
 * Get a filtered registry based on include/exclude options.
 * This is a convenience wrapper around getRegistry for use in variant generation.
 *
 * @param include - Optional list of mutator names to include
 * @param exclude - Optional list of mutator names to exclude
 * @returns Filtered array of mutators
 */
export function getFilteredRegistry(
  include?: readonly string[],
  exclude?: readonly string[],
): readonly ASTMutator[] {
  return getRegistry(include, exclude)
}
