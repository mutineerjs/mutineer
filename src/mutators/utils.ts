/**
 * Shared utilities for AST-based mutation.
 *
 * Provides functions for parsing, traversing, and analyzing code ASTs.
 * These utilities are used by operator mutators to locate and replace operators.
 */

import { parse, type ParserOptions } from '@babel/parser'
import traverseModule from '@babel/traverse'
import * as t from '@babel/types'
import type { OperatorTarget } from './types.js'

// Normalize the default export shape of @babel/traverse
const traverseModuleNormalized = traverseModule as {
  default?: typeof import('@babel/traverse').default
} & typeof import('@babel/traverse').default

export const traverse: typeof import('@babel/traverse').default =
  traverseModuleNormalized.default ?? traverseModuleNormalized

/**
 * Parser configuration for Babel.
 * Enables support for TypeScript, JSX, decorators, and modern JavaScript features.
 */
const parserOptsTs: ParserOptions = {
  sourceType: 'unambiguous',
  plugins: [
    'typescript',
    'jsx',
    ['decorators', { decoratorsBeforeExport: true }],
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
  ],
  tokens: true,
}

const parserOptsFlow: ParserOptions = {
  sourceType: 'unambiguous',
  plugins: [
    'flow',
    'flowComments',
    'jsx',
    ['decorators', { decoratorsBeforeExport: true }],
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
  ],
  tokens: true,
}

/**
 * Tab width used for converting character columns to visual columns.
 * This helps report correct column positions for terminals that render tabs.
 */
export const TAB_WIDTH = 4

/**
 * Convert a character-based column offset to a visual column, accounting for tabs.
 * For example, a tab at the start of a line counts as multiple spaces visually.
 *
 * @param src - The source code
 * @param charOffset - The character offset (0-based)
 * @returns The visual column (1-based)
 */
export function getVisualColumn(src: string, charOffset: number): number {
  const lineStartIdx = src.lastIndexOf('\n', charOffset - 1) + 1
  const linePrefix = src.slice(lineStartIdx, charOffset)
  let visualCol = 1

  for (const ch of linePrefix) {
    if (ch === '\t') {
      // Advance to next tab stop (multiples of TAB_WIDTH)
      const nextStop =
        (Math.floor((visualCol - 1) / TAB_WIDTH) + 1) * TAB_WIDTH + 1
      visualCol = nextStop
    } else {
      visualCol++
    }
  }
  return visualCol
}

/**
 * Type guard to check if a node is a BinaryExpression or LogicalExpression.
 */
export function isBinaryOrLogical(
  node: t.Node,
): node is t.BinaryExpression | t.LogicalExpression {
  return node.type === 'BinaryExpression' || node.type === 'LogicalExpression'
}

/**
 * Internal token-like interface for AST token analysis.
 */
interface TokenLike {
  readonly value?: string
  readonly start: number
  readonly end: number
  readonly loc: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}

/**
 * Collect the operator tokens for a given operator and return their exact locations.
 * Uses AST traversal to find BinaryExpression/LogicalExpression nodes, then maps them
 * to token positions for accurate column reporting.
 *
 * @param src - The source code
 * @param opValue - The operator to search for (e.g., '&&', '<=')
 * @returns Array of target locations for the operator
 */
export function collectOperatorTargets(
  src: string,
  opValue: string,
): OperatorTarget[] {
  let ast

  try {
    ast = parse(src, parserOptsTs)
  } catch {
    // Flow-typed React sources fail under TS parsing; fall back to Flow plugins.
    ast = parse(src, parserOptsFlow)
  }
  const fileAst = ast as t.File & {
    tokens?: TokenLike[]
    comments?: t.Comment[]
  }
  const tokens = fileAst.tokens ?? []
  const comments = fileAst.comments ?? []

  const out: OperatorTarget[] = []
  const ignoreLines = new Set<number>()

  for (const comment of comments) {
    const text = comment.value.trim()
    if (!text) continue
    if (!comment.loc) continue

    const startLine = comment.loc.start.line
    const endLine = comment.loc.end.line

    if (text.includes('mutineer-disable-next-line')) {
      ignoreLines.add(endLine + 1)
    }
    if (
      text.includes('mutineer-disable-line') ||
      text.includes('mutineer-disable')
    ) {
      for (let line = startLine; line <= endLine; line++) {
        ignoreLines.add(line)
      }
    }
  }

  traverse(ast, {
    enter(p) {
      if (!isBinaryOrLogical(p.node)) return
      const n = p.node
      if (n.operator !== opValue) return

      // Find the exact operator token inside the node span
      const nodeStart = n.start ?? 0
      const nodeEnd = n.end ?? 0
      const tok = tokens.find(
        (tk) =>
          tk.start >= nodeStart && tk.end <= nodeEnd && tk.value === opValue,
      )

      if (tok) {
        // Convert Babel's character-based column to a visual column for accurate reporting
        const line = tok.loc.start.line
        if (ignoreLines.has(line)) return

        const visualCol = getVisualColumn(src, tok.start)

        out.push({
          start: tok.start,
          end: tok.end,
          line,
          col1: visualCol, // convert to 1-based
          op: opValue,
        })
      }
    },
  })

  return out
}
