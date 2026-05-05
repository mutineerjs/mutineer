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
 * Location info for a CallExpression callee identifier, pre-collected
 * during a single AST traversal so call mutators need no traversal.
 */
export interface CallTarget {
  readonly start: number
  readonly end: number
  readonly line: number
  readonly col1: number
  readonly callee: string
}

/**
 * All mutation targets pre-collected in a single traversal.
 */
export interface PreCollected {
  readonly operatorTargets: Map<string, OperatorTarget[]>
  readonly returnStatements: ReturnStatementInfo[]
  readonly updateTargets: Map<string, OperatorTarget[]>
  readonly assignmentTargets: Map<string, OperatorTarget[]>
  readonly callTargets: Map<string, CallTarget[]>
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

const MISSING_TOKEN: TokenLike = {
  start: 0,
  end: 0,
  loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
}

/**
 * Binary-search for the first token index with start >= target.
 * Assumes tokens within the group are sorted by start position.
 */
function lowerBound(group: readonly TokenLike[], target: number): number {
  let lo = 0
  let hi = group.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (group[mid].start < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Find the first token within [nodeStart, nodeEnd] that has the given value.
 * Uses a pre-grouped map for O(1) group lookup and binary search within the group.
 */
function findTokenForNode(
  tokensByValue: Map<string, TokenLike[]>,
  nodeStart: number,
  nodeEnd: number,
  opValue: string,
): TokenLike {
  const group = tokensByValue.get(opValue)
  if (!group) return MISSING_TOKEN
  const lo = lowerBound(group, nodeStart)
  for (let i = lo; i < group.length && group[i].start <= nodeEnd; i++) {
    if (group[i].end <= nodeEnd) return group[i]
  }
  return MISSING_TOKEN
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
  const callTargets = new Map<string, CallTarget[]>()

  // Build token index grouped by value for O(log n) lookup per operator node.
  // Relies on `tokens` being in ascending start-position order, which is guaranteed
  // when tokens come from Babel's parser (the only source in this codebase). Each
  // per-value group inherits that order, making binary search in findTokenForNode safe.
  const tokensByValue = new Map<string, TokenLike[]>()
  for (const tk of tokens) {
    if (!tk.value) continue
    let arr = tokensByValue.get(tk.value)
    if (!arr) {
      arr = []
      tokensByValue.set(tk.value, arr)
    }
    arr.push(tk)
  }

  function handleBinaryOrLogical(n: t.BinaryExpression | t.LogicalExpression) {
    const nodeStart = n.start!
    const nodeEnd = n.end!
    const opValue = n.operator
    const tok = findTokenForNode(tokensByValue, nodeStart, nodeEnd, opValue)
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
    const tok = findTokenForNode(tokensByValue, nodeStart, nodeEnd, opValue)
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

  function handleCallExpression(n: t.CallExpression) {
    if (!t.isIdentifier(n.callee)) return
    const callee = n.callee
    if (callee.start == null || !callee.loc) return
    const line = callee.loc.start.line
    if (ignoreLines.has(line)) return
    const visualCol = getVisualColumn(src, callee.start)
    let arr = callTargets.get(callee.name)
    if (!arr) {
      arr = []
      callTargets.set(callee.name, arr)
    }
    arr.push({
      start: callee.start,
      end: callee.end!,
      line,
      col1: visualCol,
      callee: callee.name,
    })
  }

  function handleAssignment(n: t.AssignmentExpression) {
    const nodeStart = n.start!
    const nodeEnd = n.end!
    const opValue = n.operator
    const tok = findTokenForNode(tokensByValue, nodeStart, nodeEnd, opValue)
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
    CallExpression(p) {
      handleCallExpression(p.node)
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

  return {
    operatorTargets,
    returnStatements,
    updateTargets,
    assignmentTargets,
    callTargets,
  }
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
 * Reads directly from preCollected targets; no additional traversal needed.
 */
export function collectOperatorTargetsFromContext(
  _src: string,
  ctx: ParseContext,
  opValue: string,
): OperatorTarget[] {
  return ctx.preCollected.operatorTargets.get(opValue) ?? []
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
