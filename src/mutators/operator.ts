/**
 * Operator mutators.
 *
 * Each mutator finds every occurrence of a specific binary/logical operator
 * using AST traversal and produces a mutated source string with that operator
 * replaced by its counterpart.
 */

import type { ASTMutator, MutationOutput } from './types.js'
import { collectOperatorTargets } from './utils.js'

/**
 * Factory to build an operator mutator using AST traversal and token analysis.
 *
 * @param name - Mutator name used in the registry and config include/exclude
 * @param description - Human-readable description shown in reports
 * @param fromOp - The operator to find (e.g., '&&')
 * @param toOp - The operator to replace it with (e.g., '||')
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
    apply(src: string): readonly MutationOutput[] {
      return collectOperatorTargets(src, fromOp).map((target) => ({
        line: target.line,
        col: target.col1,
        code: src.slice(0, target.start) + toOp + src.slice(target.end),
      }))
    },
  }
}

/* === Boundary mutators === */

export const relaxLE = makeOperatorMutator(
  'relaxLE',
  "Change '<=' to '<' (relax boundary)",
  '<=',
  '<',
)

export const relaxGE = makeOperatorMutator(
  'relaxGE',
  "Change '>=' to '>' (relax boundary)",
  '>=',
  '>',
)

export const tightenLT = makeOperatorMutator(
  'tightenLT',
  "Change '<' to '<=' (tighten boundary)",
  '<',
  '<=',
)

export const tightenGT = makeOperatorMutator(
  'tightenGT',
  "Change '>' to '>=' (tighten boundary)",
  '>',
  '>=',
)

/* === Logical mutators === */

export const andToOr = makeOperatorMutator(
  'andToOr',
  "Change '&&' to '||'",
  '&&',
  '||',
)

export const orToAnd = makeOperatorMutator(
  'orToAnd',
  "Change '||' to '&&'",
  '||',
  '&&',
)

export const nullishToOr = makeOperatorMutator(
  'nullishToOr',
  "Change '??' to '||'",
  '??',
  '||',
)

/* === Equality mutators === */

export const flipEQ = makeOperatorMutator(
  'flipEQ',
  "Change '==' to '!='",
  '==',
  '!=',
)

export const flipNEQ = makeOperatorMutator(
  'flipNEQ',
  "Change '!=' to '=='",
  '!=',
  '==',
)

export const flipStrictEQ = makeOperatorMutator(
  'flipStrictEQ',
  "Change '===' to '!=='",
  '===',
  '!==',
)

export const flipStrictNEQ = makeOperatorMutator(
  'flipStrictNEQ',
  "Change '!==' to '==='",
  '!==',
  '===',
)

/* === Arithmetic mutators === */

export const addToSub = makeOperatorMutator(
  'addToSub',
  "Change '+' to '-'",
  '+',
  '-',
)

export const subToAdd = makeOperatorMutator(
  'subToAdd',
  "Change '-' to '+'",
  '-',
  '+',
)

export const mulToDiv = makeOperatorMutator(
  'mulToDiv',
  "Change '*' to '/'",
  '*',
  '/',
)

export const divToMul = makeOperatorMutator(
  'divToMul',
  "Change '/' to '*'",
  '/',
  '*',
)

export const modToMul = makeOperatorMutator(
  'modToMul',
  "Change '%' to '*'",
  '%',
  '*',
)

export const powerToMul = makeOperatorMutator(
  'powerToMul',
  "Change '**' to '*'",
  '**',
  '*',
)
