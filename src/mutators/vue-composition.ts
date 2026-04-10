import type { ASTMutator, MutationOutput } from './types.js'
import { buildParseContext } from './utils.js'
import type { ParseContext, CallTarget } from './utils.js'

function callMutationsFromTargets(
  src: string,
  targets: readonly CallTarget[],
  toFn: string,
): readonly MutationOutput[] {
  return targets.map((target) => ({
    line: target.line,
    col: target.col1,
    code: src.slice(0, target.start) + toFn + src.slice(target.end),
  }))
}

function makeCallMutator(
  name: string,
  description: string,
  fromFn: string,
  toFn: string,
): ASTMutator {
  return {
    name,
    description,
    apply(src: string): readonly MutationOutput[] {
      const ctx = buildParseContext(src)
      return callMutationsFromTargets(
        src,
        ctx.preCollected.callTargets.get(fromFn) ?? [],
        toFn,
      )
    },
    applyWithContext(
      src: string,
      ctx: ParseContext,
    ): readonly MutationOutput[] {
      return callMutationsFromTargets(
        src,
        ctx.preCollected.callTargets.get(fromFn) ?? [],
        toFn,
      )
    },
  }
}

export const refToShallowRef = makeCallMutator(
  'refToShallowRef',
  "Change 'ref(...)' to 'shallowRef(...)'",
  'ref',
  'shallowRef',
)

export const computedToRef = makeCallMutator(
  'computedToRef',
  "Change 'computed(...)' to 'ref(...)'",
  'computed',
  'ref',
)
