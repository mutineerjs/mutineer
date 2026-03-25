/**
 * Operator mutators.
 *
 * Each mutator finds every occurrence of a specific binary/logical operator
 * using AST traversal and produces a mutated source string with that operator
 * replaced by its counterpart.
 */

import type { ASTMutator, MutationOutput } from './types.js'
import { collectOperatorTargets, buildParseContext } from './utils.js'
import type { ParseContext } from './utils.js'
import type { OperatorTarget } from './types.js'

function targetsToOutputs(
  src: string,
  targets: OperatorTarget[],
  toOp: string,
): readonly MutationOutput[] {
  return targets.map((target) => ({
    line: target.line,
    col: target.col1,
    code: src.slice(0, target.start) + toOp + src.slice(target.end),
  }))
}

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
      return targetsToOutputs(src, collectOperatorTargets(src, fromOp), toOp)
    },
    applyWithContext(
      src: string,
      ctx: ParseContext,
    ): readonly MutationOutput[] {
      return targetsToOutputs(
        src,
        ctx.preCollected.operatorTargets.get(fromOp) ?? [],
        toOp,
      )
    },
  }
}

/**
 * Factory for UpdateExpression mutators (++/--).
 * mapKey distinguishes prefix vs postfix: 'pre++', 'post++', 'pre--', 'post--'
 */
function makeUpdateMutator(
  name: string,
  description: string,
  mapKey: string,
  toOp: string,
): ASTMutator {
  return {
    name,
    description,
    apply(src: string): readonly MutationOutput[] {
      const ctx = buildParseContext(src)
      return targetsToOutputs(
        src,
        ctx.preCollected.updateTargets.get(mapKey) ?? [],
        toOp,
      )
    },
    applyWithContext(
      src: string,
      ctx: ParseContext,
    ): readonly MutationOutput[] {
      return targetsToOutputs(
        src,
        ctx.preCollected.updateTargets.get(mapKey) ?? [],
        toOp,
      )
    },
  }
}

/**
 * Factory for AssignmentExpression mutators (+=, -=, *=, /=).
 */
function makeAssignmentMutator(
  name: string,
  description: string,
  fromOp: string,
  toOp: string,
): ASTMutator {
  return {
    name,
    description,
    apply(src: string): readonly MutationOutput[] {
      const ctx = buildParseContext(src)
      return targetsToOutputs(
        src,
        ctx.preCollected.assignmentTargets.get(fromOp) ?? [],
        toOp,
      )
    },
    applyWithContext(
      src: string,
      ctx: ParseContext,
    ): readonly MutationOutput[] {
      return targetsToOutputs(
        src,
        ctx.preCollected.assignmentTargets.get(fromOp) ?? [],
        toOp,
      )
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

/* === Increment/decrement mutators === */

export const preInc = makeUpdateMutator(
  'preInc',
  "Change '++x' to '--x'",
  'pre++',
  '--',
)

export const preDec = makeUpdateMutator(
  'preDec',
  "Change '--x' to '++x'",
  'pre--',
  '++',
)

export const postInc = makeUpdateMutator(
  'postInc',
  "Change 'x++' to 'x--'",
  'post++',
  '--',
)

export const postDec = makeUpdateMutator(
  'postDec',
  "Change 'x--' to 'x++'",
  'post--',
  '++',
)

/* === Compound assignment mutators === */

export const addAssignToSub = makeAssignmentMutator(
  'addAssignToSub',
  "Change '+=' to '-='",
  '+=',
  '-=',
)

export const subAssignToAdd = makeAssignmentMutator(
  'subAssignToAdd',
  "Change '-=' to '+='",
  '-=',
  '+=',
)

export const mulAssignToDiv = makeAssignmentMutator(
  'mulAssignToDiv',
  "Change '*=' to '/='",
  '*=',
  '/=',
)

export const divAssignToMul = makeAssignmentMutator(
  'divAssignToMul',
  "Change '/=' to '*='",
  '/=',
  '*=',
)
