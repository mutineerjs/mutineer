import { parse } from '@vue/compiler-sfc'
import MagicString from 'magic-string'
import { getFilteredRegistry } from './variant-utils.js'
import type { MutationVariant } from './types.js'

/**
 * Generate all possible mutations for a Vue SFC `<script setup>` block.
 * @param filename - The path to the Vue file (used by the parser for error reporting)
 * @param code - The full SFC source code
 * @param include - Optional list of mutator names to include (if provided, only these are used)
 * @param exclude - Optional list of mutator names to exclude
 * @param max - Optional maximum number of mutations to generate. Must be > 0 if provided.
 * @returns Array of unique mutations (with mutated full source), up to `max` if specified
 * @throws Error if max is provided and <= 0
 */
export function mutateVueSfcScriptSetup(
  filename: string,
  code: string,
  include?: readonly string[],
  exclude?: readonly string[],
  max?: number,
): readonly MutationVariant[] {
  // Input validation
  if (max !== undefined && max <= 0) {
    throw new Error(`max must be a positive number, got: ${max}`)
  }

  const sfc = parse(code, { filename })
  const scriptSetup = sfc.descriptor.scriptSetup
  if (!scriptSetup) return []

  const startOffset = scriptSetup.loc.start.offset
  const endOffset = scriptSetup.loc.end.offset
  const originalBlock = code.slice(startOffset, endOffset)

  const registry = getFilteredRegistry(include, exclude)
  const variants: MutationVariant[] = []
  const seenOutputs = new Set<string>()

  for (const mutator of registry) {
    // Early termination if limit reached
    if (max !== undefined && variants.length >= max) {
      break
    }

    for (const mutation of mutator.apply(originalBlock)) {
      const ms = new MagicString(code)
      ms.overwrite(startOffset, endOffset, mutation.code)

      const mutatedOutput = ms.toString()
      if (!seenOutputs.has(mutatedOutput)) {
        seenOutputs.add(mutatedOutput)
        variants.push({
          name: mutator.name,
          code: mutatedOutput,
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
