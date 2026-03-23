/**
 * Worker thread entry point for parallel TypeScript type checking.
 * Receives one file group, runs baseline + per-variant diagnose, posts results.
 */

import { workerData, parentPort } from 'worker_threads'
import ts from 'typescript'
import path from 'node:path'
import fs from 'node:fs'
import type { Variant } from '../types/mutant.js'

interface WorkerInput {
  options: ts.CompilerOptions
  filePath: string
  variants: Array<Pick<Variant, 'id' | 'code'>>
}

/** Stable fingerprint for a diagnostic. */
function diagnosticKey(d: ts.Diagnostic): string {
  return `${d.code}:${d.start ?? -1}`
}

/** Create a compiler host that serves `code` for `targetPath`. */
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

/** Run semantic diagnostics for `code` in `targetPath`. */
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

const { options, filePath, variants } = workerData as WorkerInput
const resolvedPath = path.resolve(filePath)

let originalCode = ''
try {
  originalCode = fs.readFileSync(resolvedPath, 'utf8')
} catch {
  // empty baseline — all mutant errors count as new
}

const { program: baseProgram, keys: baselineKeys } = diagnose(
  options,
  resolvedPath,
  originalCode,
  undefined,
)

let prevProgram: ts.Program = baseProgram
const compileErrorIds: string[] = []

for (const variant of variants) {
  const { program: mutProgram, keys: mutantKeys } = diagnose(
    options,
    resolvedPath,
    variant.code,
    prevProgram,
  )
  prevProgram = mutProgram

  let newErrors = 0
  for (const key of mutantKeys) {
    if (!baselineKeys.has(key)) newErrors++
  }

  if (newErrors > 0) {
    compileErrorIds.push(variant.id)
  }
}

parentPort!.postMessage({ compileErrorIds })
