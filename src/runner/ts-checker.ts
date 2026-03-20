/**
 * TypeScript Type Checker for Mutants
 *
 * Pre-filters mutants that produce TypeScript compile errors before running
 * them against tests. This avoids running mutations that would be trivially
 * detected by the type system, saving significant test execution time.
 *
 * Strategy: noLib + noResolve (zero I/O) + baseline comparison
 * -  noLib: true      → don't load lib.d.ts (huge, causes hangs)
 * -  noResolve: true  → don't follow user imports (avoids loading project files)
 * -  Baseline check   → type-check original file first; only flag mutants that
 *                       introduce NEW errors not present in the original. This
 *                       eliminates false positives from missing lib/import types.
 */

import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
import type { MutineerConfig } from '../types/config.js'
import type { Variant } from '../types/mutant.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('ts-checker')

/**
 * Compiler options used for all type checks: fully isolated, zero I/O.
 * We read strict/noImplicitAny/etc from the user's tsconfig (to catch the
 * same errors they care about), but always override lib/resolve settings.
 */
function resolveCompilerOptions(
  tsconfig: string | undefined,
  cwd: string,
): ts.CompilerOptions {
  const base: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    noLib: true, // Never load lib.d.ts — huge, causes hangs
    noResolve: true, // Never follow user imports — avoids loading project files
  }

  const searchDir = tsconfig ? path.dirname(path.resolve(cwd, tsconfig)) : cwd
  const configPath =
    ts.findConfigFile(searchDir, ts.sys.fileExists) ?? undefined

  if (!configPath) return base

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) {
    log.debug(
      `Failed to read tsconfig at ${configPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`,
    )
    return base
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
  )

  // Take user's strictness settings (strict, noImplicitAny, exactOptionalPropertyTypes,
  // etc.) so we catch the same class of errors they care about, but always override
  // the I/O settings to keep checks fast and isolated.
  return {
    ...parsed.options,
    noEmit: true,
    skipLibCheck: true,
    noLib: true,
    noResolve: true,
  }
}

/** Stable fingerprint for a diagnostic — used to diff baseline vs mutant errors. */
function diagnosticKey(d: ts.Diagnostic): string {
  return `${d.code}:${d.start ?? -1}`
}

/** Create a compiler host that serves `code` for `targetPath`, real fs for everything else. */
function makeHost(
  options: ts.CompilerOptions,
  targetPath: string,
  code: string,
): ts.CompilerHost {
  const host = ts.createCompilerHost(options)
  const orig = host.getSourceFile.bind(host)
  host.getSourceFile = (
    fileName: string,
    langOrOpts: ts.ScriptTarget | ts.CreateSourceFileOptions,
  ) => {
    if (path.resolve(fileName) === targetPath) {
      return ts.createSourceFile(fileName, code, langOrOpts)
    }
    return orig(fileName, langOrOpts)
  }
  return host
}

/** Run semantic diagnostics for `code` in `targetPath`, reusing `oldProgram` if provided. */
function diagnose(
  options: ts.CompilerOptions,
  targetPath: string,
  code: string,
  oldProgram: ts.Program | undefined,
): { program: ts.Program; keys: Set<string> } {
  const host = makeHost(options, targetPath, code)
  const program = ts.createProgram({
    rootNames: [targetPath],
    options,
    host,
    oldProgram,
  })
  const sourceFile =
    program.getSourceFile(targetPath) ??
    program.getSourceFile(path.relative(process.cwd(), targetPath))
  if (!sourceFile) {
    return { program, keys: new Set() }
  }
  const keys = new Set(
    program.getSemanticDiagnostics(sourceFile).map(diagnosticKey),
  )
  return { program, keys }
}

/**
 * Check TypeScript types for mutated variants.
 * Returns a Set of variant IDs that introduce NEW compile errors vs the original.
 */
export async function checkTypes(
  variants: readonly Variant[],
  tsconfig: string | undefined,
  cwd: string,
): Promise<Set<string>> {
  const compileErrors = new Set<string>()
  if (variants.length === 0) return compileErrors

  const options = resolveCompilerOptions(tsconfig, cwd)

  // Group variants by source file
  const byFile = new Map<string, Variant[]>()
  for (const v of variants) {
    const list = byFile.get(v.file)
    if (list) list.push(v)
    else byFile.set(v.file, [v])
  }

  for (const [filePath, fileVariants] of byFile) {
    const resolvedPath = path.resolve(filePath)

    // Read original source — needed for baseline comparison.
    // If the file can't be read (e.g. in tests with synthetic paths), use an
    // empty baseline so all mutant errors count as new.
    let originalCode = ''
    try {
      originalCode = fs.readFileSync(resolvedPath, 'utf8')
    } catch {
      log.debug(`Cannot read ${filePath} for baseline — using empty baseline`)
    }

    // Baseline: errors present in the original (from missing lib/import types etc.)
    // These are NOT new errors, so we ignore them in mutations.
    const { program: baseProgram, keys: baselineKeys } = diagnose(
      options,
      resolvedPath,
      originalCode,
      undefined,
    )
    log.debug(`Baseline for ${filePath}: ${baselineKeys.size} error(s)`)

    let prevProgram: ts.Program = baseProgram

    for (const variant of fileVariants) {
      const { program: mutProgram, keys: mutantKeys } = diagnose(
        options,
        resolvedPath,
        variant.code,
        prevProgram,
      )
      prevProgram = mutProgram

      // Count errors that are new (not in baseline)
      let newErrors = 0
      for (const key of mutantKeys) {
        if (!baselineKeys.has(key)) newErrors++
      }

      if (newErrors > 0) {
        compileErrors.add(variant.id)
        log.debug(`Compile error in ${variant.id}: ${newErrors} new error(s)`)
      }
    }
  }

  return compileErrors
}

/**
 * Determine whether TypeScript type checking should run for this invocation.
 * Precedence: CLI flag > config field > auto-detect (tsconfig.json presence).
 */
export function resolveTypescriptEnabled(
  cliFlag: boolean | undefined,
  config: MutineerConfig,
  cwd: string,
): boolean {
  if (cliFlag === true) return true
  if (cliFlag === false) return false

  const cfgTs = config.typescript
  if (cfgTs === false) return false
  if (cfgTs !== undefined) return true

  // Auto-detect: enable if tsconfig.json exists in cwd
  return ts.findConfigFile(cwd, ts.sys.fileExists) !== undefined
}

/**
 * Extract the tsconfig path from the MutineerConfig typescript option.
 */
export function resolveTsconfigPath(
  config: MutineerConfig,
): string | undefined {
  if (typeof config.typescript === 'object' && config.typescript !== null) {
    return config.typescript.tsconfig
  }
  return undefined
}
