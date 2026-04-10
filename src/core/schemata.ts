import MagicString from 'magic-string'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import type { Variant } from '../types/mutant.js'
import { parserOptsTs } from '../mutators/utils.js'

export interface SchemaResult {
  schemaCode: string
  fallbackIds: Set<string>
}

interface SiteVariant {
  id: string
  replacement: string
}

interface Site {
  origStart: number
  origEnd: number
  key: string
  variants: SiteVariant[]
}

const isWordChar = (s: string, i: number): boolean =>
  i >= 0 && i < s.length && /[a-zA-Z0-9_]/.test(s[i])

function findSingleDiff(
  original: string,
  mutated: string,
): { origStart: number; origEnd: number; mutEnd: number } {
  let start = 0
  const minLen = Math.min(original.length, mutated.length)
  while (start < minLen && original[start] === mutated[start]) {
    start++
  }

  let origEnd = original.length
  let mutEnd = mutated.length
  while (
    origEnd > start &&
    mutEnd > start &&
    original[origEnd - 1] === mutated[mutEnd - 1]
  ) {
    origEnd--
    mutEnd--
  }

  // Extend to word boundaries so we never produce partial-token ternary branches.
  // e.g. 'true'→'false' has minimal diff 'tru'→'fals' (shared 'e' suffix), but
  // 'tru' alone is not a valid expression — extend forward to include the 'e'.
  while (
    start > 0 &&
    isWordChar(original, start - 1) &&
    isWordChar(original, start)
  ) {
    start--
  }
  while (isWordChar(original, origEnd - 1) && isWordChar(original, origEnd)) {
    origEnd++
    mutEnd++
  }

  return { origStart: start, origEnd, mutEnd }
}

const AST_SKIP_KEYS = new Set([
  'type',
  'start',
  'end',
  'loc',
  'range',
  'errors',
  'operator', // skip operator — forces expansion to the full enclosing expression
])

function escapeId(id: string): string {
  return id.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Returns true if the string is usable as a standalone JS expression fragment.
 * Operator-only strings (e.g. '+', '!', '===') are not valid standalone expressions
 * and cannot appear as ternary branches in generated schema code.
 */
function isExpressionFragment(s: string): boolean {
  return /[a-zA-Z0-9_]/.test(s)
}

/**
 * Parse source code for AST-based span detection.
 * Returns null if parsing fails (e.g. syntax errors in the file).
 */
function parseForSchema(code: string): t.File | null {
  try {
    return parse(code, { ...parserOptsTs, tokens: false })
  } catch {
    return null
  }
}

/**
 * Find the smallest AST Expression node whose span contains `offset`.
 * Used to expand operator-only char diffs (e.g. '+') to the full enclosing
 * expression (e.g. 'x + y') so the ternary branch is a valid JS expression.
 */
function findSmallestEnclosingExpression(
  root: t.Node,
  offset: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null

  function walk(node: t.Node): void {
    // prune: offset is outside this node's span
    if (offset < node.start! || offset >= node.end!) return

    // track this node if it's an expression and smaller than current best
    if (t.isExpression(node)) {
      const span = node.end! - node.start!
      if (!best || span < best.end - best.start) {
        best = { start: node.start!, end: node.end! }
      }
    }

    for (const key of Object.keys(node)) {
      if (AST_SKIP_KEYS.has(key)) continue
      const child = (node as unknown as Record<string, unknown>)[key]
      if (!child || typeof child !== 'object') continue
      // recurse into child node arrays (e.g. function arguments)
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof (item as t.Node).start === 'number') {
            walk(item as t.Node)
          }
        }
        // recurse into single child nodes (e.g. callee, left, right)
      } else if (typeof (child as t.Node).start === 'number') {
        walk(child as t.Node)
      }
    }
  }

  walk(root)
  return best
}

/**
 * Generate a schema file that embeds all mutation variants as a ternary chain.
 *
 * The schema uses `globalThis.__mutineer_active_id__` at call time to select
 * which mutant is active, avoiding per-mutant module reloads.
 *
 * For value mutations (true→false, null→undefined), a character-level diff with
 * word-boundary extension finds the span. For operator mutations (+→-, ===→!==),
 * the Babel AST is used to find the enclosing expression (x + y, x === y) so
 * the ternary branch is a valid JS expression.
 *
 * @param originalCode - The original source file contents
 * @param variants - All variants to embed (must all be from the same source file)
 * @returns schemaCode (the embedded schema) and fallbackIds (variants that
 *   couldn't be embedded due to overlapping diff ranges or parse errors)
 */
export function generateSchema(
  originalCode: string,
  variants: readonly Variant[],
  fallbackRanges?: readonly { readonly start: number; readonly end: number }[],
): SchemaResult {
  const fallbackIds = new Set<string>()
  const siteMap = new Map<string, Site>()

  // Lazily parsed AST — only needed for operator mutations
  let ast: t.File | null | undefined = undefined
  function getAst(): t.File | null {
    if (ast === undefined) ast = parseForSchema(originalCode)
    return ast
  }

  for (const variant of variants) {
    const { origStart, origEnd, mutEnd } = findSingleDiff(
      originalCode,
      variant.code,
    )

    // Skip variants with empty diffs (identical to original)
    if (origStart >= origEnd && origStart >= mutEnd) {
      fallbackIds.add(variant.id)
      continue
    }

    // If the diff site falls within a caller-specified fallback range, use the
    // redirect path instead. This is needed for e.g. Vue template sections where
    // globalThis.__mutineer_active_id__ is not accessible in template expressions.
    if (
      fallbackRanges?.some((r) => origStart >= r.start && origStart < r.end)
    ) {
      fallbackIds.add(variant.id)
      continue
    }

    const origSpan = originalCode.slice(origStart, origEnd)
    const repSpan = variant.code.slice(origStart, mutEnd)

    let siteStart: number
    let siteEnd: number
    let replacement: string

    if (isExpressionFragment(origSpan) && isExpressionFragment(repSpan)) {
      // Value mutation (true→false, null→undefined, 0→1 etc.): char diff is usable
      siteStart = origStart
      siteEnd = origEnd
      replacement = repSpan
    } else {
      // Operator mutation (+→-, ===→!==, &&→|| etc.): char diff produces an
      // operator-only span that isn't a valid standalone expression.
      // Use the Babel AST to find the smallest enclosing Expression node
      // (e.g. the BinaryExpression x + y) so the ternary branches are valid JS.
      const parsedAst = getAst()
      if (!parsedAst) {
        fallbackIds.add(variant.id)
        continue
      }
      const enclosing = findSmallestEnclosingExpression(parsedAst, origStart)
      if (!enclosing) {
        fallbackIds.add(variant.id)
        continue
      }
      siteStart = enclosing.start
      siteEnd = enclosing.end
      // The enclosing node end is from the original AST. For variable-length
      // operators (e.g. '>' → '>=', '+=' → '-='), the variant code is longer or
      // shorter by delta = mutEnd - origEnd. Adjust the slice end accordingly.
      const delta = mutEnd - origEnd
      replacement = variant.code.slice(siteStart, siteEnd + delta)
    }

    const key = `${siteStart}:${siteEnd}`
    if (!siteMap.has(key)) {
      siteMap.set(key, {
        origStart: siteStart,
        origEnd: siteEnd,
        key,
        variants: [],
      })
    }
    siteMap.get(key)!.variants.push({ id: variant.id, replacement })
  }

  const sites = Array.from(siteMap.values()).sort(
    (a, b) => a.origStart - b.origStart,
  )

  // Detect overlapping sites.
  // When one site is fully contained within another (nested expressions), keep
  // the inner (smaller) site and mark the outer one as fallback. For partial
  // overlaps, mark both as fallback.
  const overlappingSiteKeys = new Set<string>()
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i]
      const b = sites[j]
      if (b.origStart >= a.origEnd) break // sorted by start, no further overlap

      const keyA = a.key
      const keyB = b.key

      if (b.origEnd <= a.origEnd) {
        // b fully contained within a → keep b (inner), mark a (outer) as fallback
        overlappingSiteKeys.add(keyA)
      } else if (a.origStart === b.origStart) {
        // Same start, b is larger → b contains a → mark b (outer) as fallback
        overlappingSiteKeys.add(keyB)
      } else {
        // Partial overlap → mark both as fallback
        overlappingSiteKeys.add(keyA)
        overlappingSiteKeys.add(keyB)
      }
    }
  }

  const s = new MagicString(originalCode)

  // Apply sites in descending order to preserve character positions.
  // sites is already sorted ascending by origStart, so iterating in reverse
  // gives descending order without an extra sort + copy.
  for (let siteIdx = sites.length - 1; siteIdx >= 0; siteIdx--) {
    const site = sites[siteIdx]
    const key = site.key
    if (overlappingSiteKeys.has(key)) {
      for (const v of site.variants) fallbackIds.add(v.id)
      continue
    }

    const originalSpan = originalCode.slice(site.origStart, site.origEnd)

    // Build ternary chain: iterate from last variant inward, wrapping originalSpan
    let chain = originalSpan
    for (let i = site.variants.length - 1; i >= 0; i--) {
      const v = site.variants[i]
      chain = `(globalThis.__mutineer_active_id__ === '${escapeId(v.id)}' ? (${v.replacement}) : ${chain})`
    }

    s.overwrite(site.origStart, site.origEnd, chain)
  }

  const schemaCode = `// @ts-nocheck\n` + s.toString()
  return { schemaCode, fallbackIds }
}
