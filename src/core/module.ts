import {
  generateMutationVariants,
  getFilteredRegistry,
} from './variant-utils.js'
import type { MutationVariant } from './types.js'

/**
 * Generate all possible mutations for a given source code.
 * @param code - The source code to mutate
 * @param include - Optional list of mutator names to include (if provided, only these are used)
 * @param exclude - Optional list of mutator names to exclude
 * @param max - Optional maximum number of mutations to generate. Must be > 0 if provided.
 * @returns Array of unique mutations, up to `max` if specified
 * @throws Error if max is provided and <= 0
 */
export function mutateModuleSource(
  code: string,
  include?: readonly string[],
  exclude?: readonly string[],
  max?: number,
): readonly MutationVariant[] {
  const registry = getFilteredRegistry(include, exclude)
  return generateMutationVariants(registry, code, { max })
}
