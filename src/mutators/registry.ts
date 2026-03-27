/**
 * Mutator registry.
 *
 * Aggregates all mutators and exposes `getRegistry` for filtered access.
 */

import type { ASTMutator } from './types.js'
import {
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
  preInc,
  preDec,
  postInc,
  postDec,
  addAssignToSub,
  subAssignToAdd,
  mulAssignToDiv,
  divAssignToMul,
} from './operator.js'
import {
  returnToNull,
  returnToUndefined,
  returnFlipBool,
  returnZero,
  returnEmptyStr,
  returnEmptyArr,
} from './return-value.js'
import { refToShallowRef, computedToRef } from './vue-composition.js'

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
  preInc,
  preDec,
  postInc,
  postDec,
  addAssignToSub,
  subAssignToAdd,
  mulAssignToDiv,
  divAssignToMul,
  returnToNull,
  returnToUndefined,
  returnFlipBool,
  returnZero,
  returnEmptyStr,
  returnEmptyArr,
  refToShallowRef,
  computedToRef,
]

/**
 * Get a filtered list of mutators.
 *
 * If `include` is provided, only those mutators are returned.
 * If `exclude` is provided, those mutators are removed.
 * `include` takes precedence over `exclude`.
 */
export function getRegistry(
  include?: readonly string[],
  exclude?: readonly string[],
): ASTMutator[] {
  let list = ALL

  if (include?.length) {
    list = list.filter((m) => include.includes(m.name))
  }

  if (exclude?.length) {
    list = list.filter((m) => !exclude.includes(m.name))
  }

  return list
}

// Re-export types for convenience
export type { ASTMutator, AnyMutator, MutationOutput } from './types.js'
