/**
 * Mutator registry and factory.
 *
 * Provides functions to create operator mutators and retrieve registered mutators
 * with optional include/exclude filtering.
 */

import type { ASTMutator, MutationOutput } from './types.js'
import { collectOperatorTargets } from './utils.js'

/**
 * Factory to build an operator mutator using AST traversal and token analysis.
 * Creates a reusable mutator that finds and replaces a specific operator throughout the code.
 *
 * @param name - Name of the mutator (e.g., 'andToOr')
 * @param description - Human-readable description
 * @param fromOp - The operator to find (e.g., '&&')
 * @param toOp - The operator to replace it with (e.g., '||')
 * @returns An ASTMutator that applies this transformation
 */
function makeOperatorMutator(
  name: string,
  description: string,
  fromOp: string,
  toOp: string,
): ASTMutator {
  return {
    name,
    description,
    apply(src: string) {
      // 1) Collect exact operator token locations from matching nodes
      const targets = collectOperatorTargets(src, fromOp)

      // 2) For each occurrence, produce a mutated version of the programme
      const outputs: MutationOutput[] = []
      for (const target of targets) {
        const code = src.slice(0, target.start) + toOp + src.slice(target.end)
        outputs.push({
          line: target.line,
          col: target.col1,
          code,
        })
      }
      return outputs
    },
  }
}

/* === Concrete mutators (AST-safe) === */

export const relaxLE: ASTMutator = makeOperatorMutator(
  'relaxLE',
  "Change '<=' to '<' (relax boundary)",
  '<=',
  '<',
)

export const relaxGE: ASTMutator = makeOperatorMutator(
  'relaxGE',
  "Change '>=' to '>' (relax boundary)",
  '>=',
  '>',
)

export const tightenLT: ASTMutator = makeOperatorMutator(
  'tightenLT',
  "Change '<' to '<=' (tighten boundary)",
  '<',
  '<=',
)

export const tightenGT: ASTMutator = makeOperatorMutator(
  'tightenGT',
  "Change '>' to '>=' (tighten boundary)",
  '>',
  '>=',
)

export const andToOr: ASTMutator = makeOperatorMutator(
  'andToOr',
  "Change '&&' to '||' in boolean expressions",
  '&&',
  '||',
)

export const orToAnd: ASTMutator = makeOperatorMutator(
  'orToAnd',
  "Change '||' to '&&' in boolean expressions",
  '||',
  '&&',
)

export const nullishToOr: ASTMutator = makeOperatorMutator(
  'nullishToOr',
  "Change '??' to '||' to prefer boolean fallback",
  '??',
  '||',
)

export const flipEQ: ASTMutator = makeOperatorMutator(
  'flipEQ',
  "Change '==' to '!='",
  '==',
  '!=',
)

export const flipNEQ: ASTMutator = makeOperatorMutator(
  'flipNEQ',
  "Change '!=' to '=='",
  '!=',
  '==',
)

export const flipStrictEQ: ASTMutator = makeOperatorMutator(
  'flipStrictEQ',
  "Change '===' to '!=='",
  '===',
  '!==',
)

export const flipStrictNEQ: ASTMutator = makeOperatorMutator(
  'flipStrictNEQ',
  "Change '!==' to '==='",
  '!==',
  '===',
)

export const addToSub: ASTMutator = makeOperatorMutator(
  'addToSub',
  "Change '+' to '-' in arithmetic expressions",
  '+',
  '-',
)

export const subToAdd: ASTMutator = makeOperatorMutator(
  'subToAdd',
  "Change '-' to '+' in arithmetic expressions",
  '-',
  '+',
)

export const mulToDiv: ASTMutator = makeOperatorMutator(
  'mulToDiv',
  "Change '*' to '/' in arithmetic expressions",
  '*',
  '/',
)

export const divToMul: ASTMutator = makeOperatorMutator(
  'divToMul',
  "Change '/' to '*' in arithmetic expressions",
  '/',
  '*',
)

export const modToMul: ASTMutator = makeOperatorMutator(
  'modToMul',
  "Change '%' to '*' in arithmetic expressions",
  '%',
  '*',
)

export const powerToMul: ASTMutator = makeOperatorMutator(
  'powerToMul',
  "Change '**' to '*' in arithmetic expressions",
  '**',
  '*',
)

/**
 * All registered mutators in order of precedence.
 */
const ALL: ASTMutator[] = [
  relaxLE,
  relaxGE,
  tightenLT,
  tightenGT,
  andToOr,
  orToAnd,
  nullishToOr,
  flipEQ,
  flipNEQ,
  flipStrictEQ,
  flipStrictNEQ,
  addToSub,
  subToAdd,
  mulToDiv,
  divToMul,
  modToMul,
  powerToMul,
]

/**
 * Get a filtered registry of mutators based on include/exclude options.
 *
 * If include list provided, only those mutators are returned.
 * If exclude list provided, those mutators are filtered out.
 * Include list takes precedence over exclude list.
 *
 * @param include - Optional list of mutator names to include
 * @param exclude - Optional list of mutator names to exclude
 * @returns Filtered array of mutators
 */
export function getRegistry(
  include?: readonly string[],
  exclude?: readonly string[],
) {
  let list = ALL

  // If include list provided, filter to only those mutators
  if (include?.length) {
    list = list.filter((m) => include.includes(m.name))
  }

  // If exclude list provided, remove those mutators
  if (exclude?.length) {
    list = list.filter((m) => !exclude.includes(m.name))
  }

  return list
}

// Re-export types for convenience
export type { ASTMutator, AnyMutator, MutationOutput } from './types.js'
