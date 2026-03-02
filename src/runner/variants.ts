/**
 * Variant Enumeration Module
 *
 * Functions for enumerating mutation variants from source files.
 * Handles both regular modules and Vue SFC files.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { MutateTarget } from '../types/config.js'
import type { MutationVariant } from '../core/types.js'
import type { MutantPayload } from '../types/mutant.js'
import { mutateVueSfcScriptSetup } from '../core/sfc.js'
import { mutateModuleSource } from '../core/module.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('variants')

/**
 * Get file path from target (handles both string and object forms).
 */
export function getTargetFile(t: MutateTarget): string {
  return typeof t === 'string' ? t : t.file
}

/**
 * Enumerate all mutation variants for a single target file.
 */
export async function enumerateVariantsForTarget(
  root: string,
  t: MutateTarget,
  include?: readonly string[],
  exclude?: readonly string[],
  max?: number,
): Promise<MutantPayload[]> {
  // Normalize target: string → { file: string }, object → as-is
  const file = typeof t === 'string' ? t : t.file
  const explicitKind = typeof t === 'string' ? undefined : t.kind

  const abs = path.isAbsolute(file) ? file : path.join(root, file)
  const includeArr = include ? [...include] : undefined
  const excludeArr = exclude ? [...exclude] : undefined

  try {
    const code = await fs.readFile(abs, 'utf8')

    // Auto-detect kind from file extension if not specified
    const kind =
      explicitKind ?? (abs.endsWith('.vue') ? 'vue:script-setup' : 'module')

    const list: readonly MutationVariant[] =
      kind === 'vue:script-setup'
        ? mutateVueSfcScriptSetup(abs, code, includeArr, excludeArr, max)
        : mutateModuleSource(code, includeArr, excludeArr, max)

    return list.map((v, i) => ({
      id: `${path.basename(abs)}#${i}`,
      name: v.name,
      file: abs,
      code: v.code,
      line: v.line,
      col: v.col,
    }))
  } catch (err: unknown) {
    const detail =
      typeof err === 'object' && err !== null && 'stack' in err
        ? (err as { stack?: unknown }).stack
        : err
    log.debug(`Failed to enumerate variants for ${abs}:`, detail)
    return []
  }
}

/**
 * Filter tests to only those that cover a specific line in a file.
 */
export function filterTestsByCoverage(
  perTest: Map<string, Map<string, Set<number>>>,
  tests: readonly string[],
  filePath: string,
  line: number,
): string[] {
  return tests.filter((testPath) => {
    const filesCovered = perTest.get(testPath)
    if (!filesCovered) return true
    const lines = filesCovered.get(filePath)
    if (!lines) return true
    return lines.has(line)
  })
}

export type { Variant } from '../types/mutant.js'
