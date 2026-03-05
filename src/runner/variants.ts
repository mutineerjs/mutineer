/**
 * Variant Enumeration Module
 *
 * Functions for enumerating mutation variants from source files.
 * Handles both regular modules and Vue SFC files.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { MutateTarget, MutineerConfig } from '../types/config.js'
import type { MutationVariant } from '../core/types.js'
import type { MutantPayload, Variant } from '../types/mutant.js'
import { mutateVueSfcScriptSetup } from '../core/sfc.js'
import { mutateModuleSource } from '../core/module.js'
import { normalizePath } from '../utils/normalizePath.js'
import { isLineCovered, type CoverageData } from '../utils/coverage.js'
import type { TestMap } from './discover.js'
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
        ? await mutateVueSfcScriptSetup(abs, code, includeArr, excludeArr, max)
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

export interface EnumerateAllParams {
  cwd: string
  targets: readonly MutateTarget[]
  testMap: TestMap
  changedFiles: Set<string> | null
  coverageData: CoverageData | null
  config: MutineerConfig
}

/**
 * Enumerate variants for all targets, filtering by changed files and coverage.
 * Links each variant to its relevant test files via the testMap.
 */
export async function enumerateAllVariants(
  params: EnumerateAllParams,
): Promise<Variant[]> {
  const { cwd, targets, testMap, changedFiles, coverageData, config } = params

  const enumerated = await Promise.all(
    targets.map(async (target) => {
      const file = getTargetFile(target)
      const absFile = normalizePath(
        path.isAbsolute(file) ? file : path.join(cwd, file),
      )
      if (changedFiles && !changedFiles.has(absFile)) return [] as Variant[]
      log.debug('Target file: ' + absFile)

      const files = await enumerateVariantsForTarget(
        cwd,
        target,
        config.include,
        config.exclude,
        config.maxMutantsPerFile,
      )
      const testsAbs = testMap.get(normalizePath(absFile))
      const tests = testsAbs ? Array.from(testsAbs) : []

      log.debug(
        `  found ${files.length} variants, linked to ${tests.length} tests`,
      )

      // Filter by coverage if enabled
      let filtered = files
      if (coverageData) {
        filtered = files.filter((v) =>
          isLineCovered(coverageData, absFile, v.line),
        )
        if (filtered.length !== files.length) {
          log.debug(
            `  filtered ${files.length} -> ${filtered.length} variants by coverage`,
          )
        }
      }

      return filtered.map((v) => ({ ...v, tests }))
    }),
  )

  const variants: Variant[] = []
  for (const list of enumerated) variants.push(...list)
  return variants
}

export type { Variant } from '../types/mutant.js'
