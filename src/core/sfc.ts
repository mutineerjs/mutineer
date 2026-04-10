import MagicString from 'magic-string'
import { getFilteredRegistry } from './variant-utils.js'
import { buildParseContext } from '../mutators/utils.js'
import type { MutationVariant } from './types.js'
import type { MutationOutput } from '../mutators/types.js'

const TEMPLATE_MUTATOR_NAMES = [
  'vIfNegate',
  'vShowNegate',
  'vBindNegate',
] as const

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
export async function mutateVueSfcScriptSetup(
  filename: string,
  code: string,
  include?: readonly string[],
  exclude?: readonly string[],
  max?: number,
): Promise<readonly MutationVariant[]> {
  // Input validation
  if (max !== undefined && max <= 0) {
    throw new Error(`max must be a positive number, got: ${max}`)
  }

  const { parse } = await import('@vue/compiler-sfc')
  const sfc = parse(code, { filename })
  const scriptSetup = sfc.descriptor.scriptSetup
  if (!scriptSetup) return []

  const startOffset = scriptSetup.loc.start.offset
  const endOffset = scriptSetup.loc.end.offset
  const originalBlock = code.slice(startOffset, endOffset)

  const registry = getFilteredRegistry(include, exclude)
  const variants: MutationVariant[] = []
  const seenOutputs = new Set<string>()
  const ctx = buildParseContext(originalBlock)

  for (const mutator of registry) {
    const blockMutations = mutator.applyWithContext
      ? mutator.applyWithContext(originalBlock, ctx)
      : mutator.apply(originalBlock)
    for (const mutation of blockMutations) {
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

/**
 * Generate all possible mutations for a Vue SFC `<template>` block.
 * Negates v-if, v-show, and v-bind directive expressions.
 * @param filename - The path to the Vue file (used by the parser for error reporting)
 * @param code - The full SFC source code
 * @param include - Optional list of mutator names to include
 * @param exclude - Optional list of mutator names to exclude
 * @param max - Optional maximum number of mutations to generate. Must be > 0 if provided.
 * @returns Array of unique mutations (with mutated full source), up to `max` if specified
 * @throws Error if max is provided and <= 0
 */
export async function mutateVueSfcTemplate(
  filename: string,
  code: string,
  include?: readonly string[],
  exclude?: readonly string[],
  max?: number,
): Promise<readonly MutationVariant[]> {
  if (max !== undefined && max <= 0) {
    throw new Error(`max must be a positive number, got: ${max}`)
  }

  let activeNames: string[]
  if (include?.length) {
    const includeSet = new Set(include)
    activeNames = TEMPLATE_MUTATOR_NAMES.filter((n) => includeSet.has(n))
  } else if (exclude?.length) {
    const excludeSet = new Set(exclude)
    activeNames = TEMPLATE_MUTATOR_NAMES.filter((n) => !excludeSet.has(n))
  } else {
    activeNames = [...TEMPLATE_MUTATOR_NAMES]
  }

  if (activeNames.length === 0) return []

  const { parse } = await import('@vue/compiler-sfc')
  const sfc = parse(code, { filename })
  const template = sfc.descriptor.template
  if (!template) return []

  const templateContent = template.content
  const templateContentStart = code.indexOf(
    templateContent,
    template.loc.start.offset,
  )
  if (templateContentStart === -1) return []
  const templateContentEnd = templateContentStart + templateContent.length

  const { collectTemplateDirectiveMutations, collectTemplateBindingMutations } =
    await import('../mutators/vue-template.js')

  const mutationsByName: Array<{ name: string; mutations: MutationOutput[] }> =
    []

  console.log('Active template mutators:', activeNames.join(', '))

  if (activeNames.includes('vIfNegate')) {
    mutationsByName.push({
      name: 'vIfNegate',
      mutations: await collectTemplateDirectiveMutations(templateContent, 'if'),
    })
  }
  if (activeNames.includes('vShowNegate')) {
    mutationsByName.push({
      name: 'vShowNegate',
      mutations: await collectTemplateDirectiveMutations(
        templateContent,
        'show',
      ),
    })
  }
  if (activeNames.includes('vBindNegate')) {
    mutationsByName.push({
      name: 'vBindNegate',
      mutations: await collectTemplateBindingMutations(templateContent),
    })
  }

  const variants: MutationVariant[] = []
  const seenOutputs = new Set<string>()

  for (const { name, mutations } of mutationsByName) {
    for (const mutation of mutations) {
      const ms = new MagicString(code)
      ms.overwrite(templateContentStart, templateContentEnd, mutation.code)
      const mutatedOutput = ms.toString()

      if (!seenOutputs.has(mutatedOutput)) {
        seenOutputs.add(mutatedOutput)
        variants.push({
          name,
          code: mutatedOutput,
          line: mutation.line,
          col: mutation.col,
        })

        if (max !== undefined && variants.length >= max) return variants
      }
    }
  }

  return variants
}
