/**
 * Return value mutators.
 *
 * These mutators target `return` statements and replace the returned expression
 * with a simpler or opposite value. They catch a different class of test gap
 * from operator mutators: they reveal when callers never check what a function
 * returns (e.g. no null-check, no assertion on the return value).
 */

import * as t from '@babel/types'
import {
  traverse,
  getVisualColumn,
  parseSource,
  buildIgnoreLines,
} from './utils.js'
import type { ASTMutator, MutationOutput } from './types.js'

/**
 * Factory for return-value mutators.
 *
 * Traverses all `ReturnStatement` nodes in the source. For each node that has
 * an argument (i.e. not a bare `return;`), calls `replacer` with the argument
 * AST node. If `replacer` returns a non-null string, emits a mutation that
 * splices that string in place of the original argument.
 *
 * @param name - Mutator name used in the registry and config include/exclude
 * @param description - Human-readable description shown in reports
 * @param replacer - Returns the replacement source text, or null to skip
 */
function makeReturnMutator(
  name: string,
  description: string,
  replacer: (node: t.Expression) => string | null,
): ASTMutator {
  return {
    name,
    description,
    apply(src: string): readonly MutationOutput[] {
      const ast = parseSource(src)
      const fileAst = ast as t.File & { comments?: t.Comment[] }
      const ignoreLines = buildIgnoreLines(fileAst.comments ?? [])
      const outputs: MutationOutput[] = []

      traverse(ast, {
        ReturnStatement(path) {
          const node = path.node
          if (!node.argument) return // bare return; — nothing to replace

          const line = node.loc?.start.line
          if (line === undefined) return
          if (ignoreLines.has(line)) return

          const replacement = replacer(node.argument)
          if (replacement === null) return

          const argStart = node.argument.start
          const argEnd = node.argument.end
          if (argStart == null || argEnd == null) return

          const col = getVisualColumn(src, node.start ?? 0)
          const code = src.slice(0, argStart) + replacement + src.slice(argEnd)
          outputs.push({ line, col, code })
        },
      })

      return outputs
    },
  }
}

/* === Concrete return-value mutators === */

/**
 * Replace any non-null return value with `null`.
 * Reveals callers that never check for null returns.
 */
export const returnToNull: ASTMutator = makeReturnMutator(
  'returnToNull',
  'Replace return value with null',
  (node) => (t.isNullLiteral(node) ? null : 'null'),
)

/**
 * Replace any non-undefined return value with `undefined`.
 * Reveals callers that never guard against undefined returns.
 */
export const returnToUndefined: ASTMutator = makeReturnMutator(
  'returnToUndefined',
  'Replace return value with undefined',
  (node) => (t.isIdentifier(node, { name: 'undefined' }) ? null : 'undefined'),
)

/**
 * Flip `return true` ↔ `return false`.
 * Catches missing assertions on boolean-returning functions.
 */
export const returnFlipBool: ASTMutator = makeReturnMutator(
  'returnFlipBool',
  'Flip boolean return value (true ↔ false)',
  (node) => {
    if (!t.isBooleanLiteral(node)) return null
    return node.value ? 'false' : 'true'
  },
)

/**
 * Replace a non-zero numeric return with `0`.
 * Catches callers that never check the numeric return value.
 */
export const returnZero: ASTMutator = makeReturnMutator(
  'returnZero',
  'Replace numeric return value with 0',
  (node) => {
    if (!t.isNumericLiteral(node)) return null
    return node.value === 0 ? null : '0'
  },
)

/**
 * Replace a non-empty string return with `''`.
 * Catches callers that never check the string return value.
 */
export const returnEmptyStr: ASTMutator = makeReturnMutator(
  'returnEmptyStr',
  "Replace string return value with ''",
  (node) => {
    if (!t.isStringLiteral(node)) return null
    return node.value === '' ? null : "''"
  },
)

/**
 * Replace an array expression return with `[]`.
 * Catches callers that never check for an empty array.
 */
export const returnEmptyArr: ASTMutator = makeReturnMutator(
  'returnEmptyArr',
  'Replace array return value with []',
  (node) => {
    if (!t.isArrayExpression(node)) return null
    return node.elements.length === 0 ? null : '[]'
  },
)
