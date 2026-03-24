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
export const parserOptsTs: ParserOptions = {
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

export const parserOptsFlow: ParserOptions = {
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
 * Build a set of line numbers that should be ignored for mutation based on
 * disable comments (`mutineer-disable`, `mutineer-disable-line`,
 * `mutineer-disable-next-line`).
 *
 * @param comments - The comment nodes from the parsed AST
 * @returns Set of 1-based line numbers that should not be mutated
 */
export function buildIgnoreLines(comments: readonly t.Comment[]): Set<number> {
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

  return ignoreLines
}

/**
 * Parse source with the TypeScript Babel plugin, falling back to the Flow
 * plugin for Flow-typed React files that fail TS parsing.
 */
export function parseSource(src: string) {
  try {
    return parse(src, parserOptsTs)
  } catch {
    return parse(src, parserOptsFlow)
  }
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
export interface TokenLike {
  readonly value?: string
  readonly start: number
  readonly end: number
  readonly loc: {
    readonly start: { readonly line: number; readonly column: number }
    readonly end: { readonly line: number; readonly column: number }
  }
}

/**
 * Location info for a single return statement argument, pre-collected
 * during a single AST traversal so return-value mutators need no traversal.
 */
export interface ReturnStatementInfo {
  readonly line: number
  readonly col: number
  readonly argStart: number
  readonly argEnd: number
  readonly argNode: t.Expression
}

/**
 * All mutation targets pre-collected in a single traversal.
 */
export interface PreCollected {
  readonly operatorTargets: Map<string, OperatorTarget[]>
  readonly returnStatements: ReturnStatementInfo[]
  readonly updateTargets: Map<string, OperatorTarget[]>
  readonly assignmentTargets: Map<string, OperatorTarget[]>
}

/**
 * Pre-parsed context for a source file.
 * Allows sharing a single Babel parse across all mutators.
 */
export interface ParseContext {
  readonly ast: t.File & { tokens?: TokenLike[]; comments?: t.Comment[] }
  readonly tokens: readonly TokenLike[]
  readonly ignoreLines: Set<number>
  readonly preCollected: PreCollected
}

/**
 * Single traversal that collects all operator targets and return statements.
 * Eliminates per-mutator traversals when using ParseContext.
 */
export function collectAllTargets(
  src: string,
  ast: t.File & { tokens?: TokenLike[]; comments?: t.Comment[] },
  tokens: readonly TokenLike[],
  ignoreLines: Set<number>,
): PreCollected {
  const operatorTargets = new Map<string, OperatorTarget[]>()
  const returnStatements: ReturnStatementInfo[] = []
  const updateTargets = new Map<string, OperatorTarget[]>()
  const assignmentTargets = new Map<string, OperatorTarget[]>()

  function handleBinaryOrLogical(n: t.BinaryExpression | t.LogicalExpression) {
    const nodeStart = n.start!
    const nodeEnd = n.end!
    const opValue = n.operator
    const tok = tokens.find(
      (tk) =>
        tk.start >= nodeStart && tk.end <= nodeEnd && tk.value === opValue,
    )!
    const line = tok.loc.start.line
    if (ignoreLines.has(line)) return
    const visualCol = getVisualColumn(src, tok.start)
    let arr = operatorTargets.get(opValue)
    if (!arr) {
      arr = []
      operatorTargets.set(opValue, arr)
    }
    arr.push({
      start: tok.start,
      end: tok.end,
      line,
      col1: visualCol,
      op: opValue,
    })
  }

  function handleUpdate(n: t.UpdateExpression) {
    const nodeStart = n.start!
    const nodeEnd = n.end!
    const opValue = n.operator
    const tok = tokens.find(
      (tk) =>
        tk.start >= nodeStart && tk.end <= nodeEnd && tk.value === opValue,
    )!
    const line = tok.loc.start.line
    if (ignoreLines.has(line)) return
    const visualCol = getVisualColumn(src, tok.start)
    const mapKey = (n.prefix ? 'pre' : 'post') + opValue
    let arr = updateTargets.get(mapKey)
    if (!arr) {
      arr = []
      updateTargets.set(mapKey, arr)
    }
    arr.push({
      start: tok.start,
      end: tok.end,
      line,
      col1: visualCol,
      op: opValue,
    })
  }

  function handleAssignment(n: t.AssignmentExpression) {
    const nodeStart = n.start!
    const nodeEnd = n.end!
    const opValue = n.operator
    const tok = tokens.find(
      (tk) =>
        tk.start >= nodeStart && tk.end <= nodeEnd && tk.value === opValue,
    )!
    const line = tok.loc.start.line
    if (ignoreLines.has(line)) return
    const visualCol = getVisualColumn(src, tok.start)
    let arr = assignmentTargets.get(opValue)
    if (!arr) {
      arr = []
      assignmentTargets.set(opValue, arr)
    }
    arr.push({
      start: tok.start,
      end: tok.end,
      line,
      col1: visualCol,
      op: opValue,
    })
  }

  traverse(ast, {
    BinaryExpression(p) {
      handleBinaryOrLogical(p.node)
    },
    LogicalExpression(p) {
      handleBinaryOrLogical(p.node)
    },
    UpdateExpression(p) {
      handleUpdate(p.node)
    },
    AssignmentExpression(p) {
      handleAssignment(p.node)
    },
    ReturnStatement(p) {
      const node = p.node
      if (!node.argument) return
      const line = node.loc!.start.line
      if (ignoreLines.has(line)) return
      const argStart = node.argument.start!
      const argEnd = node.argument.end!
      const col = getVisualColumn(src, node.start!)
      returnStatements.push({
        line,
        col,
        argStart,
        argEnd,
        argNode: node.argument,
      })
    },
  })

  return { operatorTargets, returnStatements, updateTargets, assignmentTargets }
}

/**
 * Parse a source file once and build a reusable ParseContext.
 * Pass this to mutators' applyWithContext to avoid redundant parses.
 */
export function buildParseContext(src: string): ParseContext {
  const ast = parseSource(src) as t.File & {
    tokens?: TokenLike[]
    comments?: t.Comment[]
  }
  const tokens = ast.tokens!
  const ignoreLines = buildIgnoreLines(ast.comments!)
  const preCollected = collectAllTargets(src, ast, tokens, ignoreLines)
  return { ast, tokens, ignoreLines, preCollected }
}

/**
 * Collect operator targets from a pre-built ParseContext.
 * Avoids re-parsing; use when processing multiple operators on the same source.
 */
export function collectOperatorTargetsFromContext(
  src: string,
  ctx: ParseContext,
  opValue: string,
): OperatorTarget[] {
  const { ast, tokens, ignoreLines } = ctx
  const out: OperatorTarget[] = []

  traverse(ast, {
    enter(p) {
      if (!isBinaryOrLogical(p.node)) return
      const n = p.node
      if (n.operator !== opValue) return

      const nodeStart = n.start!
      const nodeEnd = n.end!
      const tok = tokens.find(
        (tk) =>
          tk.start >= nodeStart && tk.end <= nodeEnd && tk.value === opValue,
      )!
      const line = tok.loc.start.line
      if (ignoreLines.has(line)) return

      const visualCol = getVisualColumn(src, tok.start)
      out.push({
        start: tok.start,
        end: tok.end,
        line,
        col1: visualCol,
        op: opValue,
      })
    },
  })

  return out
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
  return collectOperatorTargetsFromContext(src, buildParseContext(src), opValue)
}
