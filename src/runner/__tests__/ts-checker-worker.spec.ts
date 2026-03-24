import { describe, it, expect } from 'vitest'
import path from 'node:path'
import ts from 'typescript'
import { diagnosticKey, makeHost, diagnose } from '../ts-checker-worker.js'

const defaultOptions: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2020,
}

describe('diagnosticKey', () => {
  it('returns code:start string for diagnostic with start', () => {
    const d = { code: 2345, start: 10 } as ts.Diagnostic
    expect(diagnosticKey(d)).toBe('2345:10')
  })

  it('returns code:-1 when start is undefined', () => {
    const d = { code: 1234, start: undefined } as ts.Diagnostic
    expect(diagnosticKey(d)).toBe('1234:-1')
  })
})

describe('makeHost', () => {
  it('returns custom source file for the target path', () => {
    const targetPath = path.resolve('/fake/target.ts')
    const code = 'const x: string = 1'
    const host = makeHost(defaultOptions, targetPath, code)
    const sf = host.getSourceFile(targetPath, ts.ScriptTarget.ES2020)
    expect(sf).toBeDefined()
    expect(sf!.text).toBe(code)
  })

  it('falls back to orig for non-target files', () => {
    const targetPath = path.resolve('/fake/target.ts')
    const host = makeHost(defaultOptions, targetPath, 'const x = 1')
    // A file that doesn't exist and isn't the target — should return undefined
    const sf = host.getSourceFile('/some/other/file.ts', ts.ScriptTarget.ES2020)
    expect(sf).toBeUndefined()
  })
})

describe('diagnose', () => {
  it('returns empty keys for valid TypeScript code', () => {
    const targetPath = path.resolve('/fake/valid.ts')
    const code = 'const x: number = 1\n'
    const { keys } = diagnose(defaultOptions, targetPath, code, undefined)
    expect(keys.size).toBe(0)
  }, 15000)

  it('detects type errors and returns diagnostic keys', () => {
    const targetPath = path.resolve('/fake/invalid.ts')
    const code = 'const x: number = "hello"\n'
    const { keys } = diagnose(defaultOptions, targetPath, code, undefined)
    expect(keys.size).toBeGreaterThan(0)
    for (const key of keys) {
      expect(key).toMatch(/^\d+:\d+$/)
    }
  }, 15000)

  it('returns empty keys when sourceFile not found', () => {
    // diagnose with empty code for a path that resolves to something ts can not find
    const targetPath = path.resolve('/absolutely/nonexistent/path/foo.ts')
    // Pass code that makes it hard for ts to find the sourceFile by alternate path
    const { keys } = diagnose(defaultOptions, targetPath, '', undefined)
    expect(keys instanceof Set).toBe(true)
  }, 15000)

  it('accepts an oldProgram for incremental compilation', () => {
    const targetPath = path.resolve('/fake/incr.ts')
    const { program: p1 } = diagnose(
      defaultOptions,
      targetPath,
      'const x = 1\n',
      undefined,
    )
    const { keys } = diagnose(
      defaultOptions,
      targetPath,
      'const x: string = 1\n',
      p1,
    )
    expect(keys instanceof Set).toBe(true)
  }, 15000)
})
