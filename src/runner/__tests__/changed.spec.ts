import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listChangedFiles } from '../changed.js'

// Mock child_process.spawnSync
const spawnSyncMock = vi.fn()
vi.mock('node:child_process', () => ({
  spawnSync: (...args: any[]) => spawnSyncMock(...args),
}))

// Mock fs functions
const existsSyncMock = vi.fn()
const readFileSyncMock = vi.fn()
vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: any[]) => existsSyncMock(...args),
    readFileSync: (...args: any[]) => readFileSyncMock(...args),
  },
  existsSync: (...args: any[]) => existsSyncMock(...args),
  readFileSync: (...args: any[]) => readFileSyncMock(...args),
}))

describe('listChangedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: files exist
    existsSyncMock.mockReturnValue(true)
  })

  it('returns empty array when no git repo is found', () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '' })
    const result = listChangedFiles('/not-a-repo', { quiet: true })
    expect(result).toEqual([])
  })

  it('returns changed files from git diff', () => {
    // First call: rev-parse --show-toplevel (find repo root)
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('--name-only') && args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0src/bar.ts\0' }
      }
      if (args.includes('--name-only') && args.includes('HEAD')) {
        return { status: 0, stdout: '' }
      }
      if (args.includes('--others')) {
        return { status: 0, stdout: '' }
      }
      return { status: 1, stdout: '' }
    })

    const result = listChangedFiles('/repo')
    expect(result).toHaveLength(2)
    expect(result).toContain('/repo/src/foo.ts')
    expect(result).toContain('/repo/src/bar.ts')
  })

  it('deduplicates files from multiple git sources', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0' }
      }
      if (args.includes('HEAD') && !args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0' } // same file
      }
      if (args.includes('--others')) {
        return { status: 0, stdout: '' }
      }
      return { status: 1, stdout: '' }
    })

    const result = listChangedFiles('/repo')
    expect(result).toHaveLength(1)
  })

  it('skips deleted/missing files', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'deleted.ts\0' }
      }
      return { status: 0, stdout: '' }
    })
    existsSyncMock.mockReturnValue(false)

    const result = listChangedFiles('/repo')
    expect(result).toEqual([])
  })

  it('includes untracked files', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('--others')) {
        return { status: 0, stdout: 'new-file.ts\0' }
      }
      return { status: 0, stdout: '' }
    })

    const result = listChangedFiles('/repo')
    expect(result).toContain('/repo/new-file.ts')
  })

  it('returns empty when all git commands fail', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      return { status: 1, stdout: '' }
    })

    const result = listChangedFiles('/repo')
    expect(result).toEqual([])
  })

  it('uses custom baseRef', () => {
    const gitArgs: string[][] = []
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      gitArgs.push(args)
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      return { status: 0, stdout: '' }
    })

    listChangedFiles('/repo', { baseRef: 'develop' })
    const diffCall = gitArgs.find((a) => a.some((x) => x.includes('...')))
    expect(diffCall).toBeDefined()
    expect(diffCall!.some((a) => a.includes('develop...HEAD'))).toBe(true)
  })

  it('resolves dependencies when includeDeps is true', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0' }
      }
      return { status: 0, stdout: '' }
    })

    // When reading the changed file to resolve deps
    readFileSyncMock.mockReturnValue('// no imports')

    const result = listChangedFiles('/repo', { includeDeps: true })
    // Should at least contain the original file
    expect(result).toContain('/repo/src/foo.ts')
  })

  it('resolves dependencies with import statements', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0' }
      }
      return { status: 0, stdout: '' }
    })

    readFileSyncMock.mockReturnValue(
      'import { bar } from "./bar"\nexport { baz } from "./baz"\nconst x = require("./qux")',
    )
    existsSyncMock.mockImplementation((p: string) => {
      // Changed file and .ts variants of deps exist
      return [
        '/repo/src/foo.ts',
        '/repo/src/bar.ts',
        '/repo/src/baz.ts',
        '/repo/src/qux.ts',
      ].includes(p)
    })

    const result = listChangedFiles('/repo', { includeDeps: true })
    expect(result).toContain('/repo/src/foo.ts')
    expect(result).toContain('/repo/src/bar.ts')
    expect(result).toContain('/repo/src/baz.ts')
    expect(result).toContain('/repo/src/qux.ts')
  })

  it('resolves dep with .ts extension when imported without extension', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel'))
        return { status: 0, stdout: '/repo\n' }
      if (args.includes('main...HEAD'))
        return { status: 0, stdout: 'src/foo.ts\0' }
      return { status: 0, stdout: '' }
    })

    readFileSyncMock.mockReturnValue('import { x } from "./utils"')
    existsSyncMock.mockImplementation((p: string) => {
      return ['/repo/src/foo.ts', '/repo/src/utils.ts'].includes(p)
    })

    const result = listChangedFiles('/repo', { includeDeps: true })
    expect(result).toContain('/repo/src/utils.ts')
  })

  it('excludes deps outside cwd', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel'))
        return { status: 0, stdout: '/repo\n' }
      if (args.includes('main...HEAD'))
        return { status: 0, stdout: 'src/foo.ts\0' }
      return { status: 0, stdout: '' }
    })

    readFileSyncMock.mockReturnValue('import { x } from "../../outside/dep"')
    existsSyncMock.mockImplementation((p: string) => {
      return ['/repo/src/foo.ts', '/outside/dep.ts'].includes(p)
    })

    const result = listChangedFiles('/repo', { includeDeps: true })
    expect(result).not.toContain('/outside/dep.ts')
    expect(result).toHaveLength(1)
  })

  it('excludes deps inside node_modules', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel'))
        return { status: 0, stdout: '/repo\n' }
      if (args.includes('main...HEAD'))
        return { status: 0, stdout: 'src/foo.ts\0' }
      return { status: 0, stdout: '' }
    })

    readFileSyncMock.mockReturnValue(
      'import { x } from "./node_modules/pkg/index"',
    )
    existsSyncMock.mockImplementation((p: string) => {
      return p === '/repo/src/foo.ts' || p.includes('node_modules')
    })

    const result = listChangedFiles('/repo', { includeDeps: true })
    expect(result.some((p) => p.includes('node_modules'))).toBe(false)
  })

  it('resolves direct dep but not transitive dep at maxDepth=1', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel'))
        return { status: 0, stdout: '/repo\n' }
      if (args.includes('main...HEAD'))
        return { status: 0, stdout: 'src/foo.ts\0' }
      return { status: 0, stdout: '' }
    })

    readFileSyncMock.mockImplementation((p: string) => {
      if (p === '/repo/src/foo.ts') return 'import { x } from "./bar"'
      if (p === '/repo/src/bar.ts') return 'import { y } from "./baz"'
      return ''
    })
    existsSyncMock.mockImplementation((p: string) => {
      return [
        '/repo/src/foo.ts',
        '/repo/src/bar.ts',
        '/repo/src/baz.ts',
      ].includes(p)
    })

    const result = listChangedFiles('/repo', { includeDeps: true, maxDepth: 1 })
    expect(result).toContain('/repo/src/foo.ts')
    expect(result).toContain('/repo/src/bar.ts')
    expect(result).not.toContain('/repo/src/baz.ts')
  })

  it('skips non-local imports in dependency resolution', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0' }
      }
      return { status: 0, stdout: '' }
    })

    // Non-local imports (no './' prefix) should be skipped
    readFileSyncMock.mockReturnValue('import lodash from "lodash"')

    const result = listChangedFiles('/repo', { includeDeps: true })
    expect(result).toHaveLength(1)
    expect(result).toContain('/repo/src/foo.ts')
  })

  it('handles file that no longer exists during dep resolution', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0' }
      }
      return { status: 0, stdout: '' }
    })

    // First existsSync for changed file check = true
    // Then existsSync for dep resolution: file exists check, then readFile fails
    let callCount = 0
    existsSyncMock.mockImplementation(() => {
      callCount++
      // First call is for the changed file in the main loop
      return callCount <= 1
    })
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    const result = listChangedFiles('/repo', { includeDeps: true })
    expect(result).toContain('/repo/src/foo.ts')
  })

  it('respects maxDepth option', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'src/foo.ts\0' }
      }
      return { status: 0, stdout: '' }
    })

    readFileSyncMock.mockReturnValue('import { x } from "./bar"')

    const result = listChangedFiles('/repo', {
      includeDeps: true,
      maxDepth: 0,
    })
    // maxDepth=0 means no recursion into deps
    expect(result).toContain('/repo/src/foo.ts')
  })

  it('only processes source files for dependency resolution', () => {
    spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/repo\n' }
      }
      if (args.includes('main...HEAD')) {
        return { status: 0, stdout: 'README.md\0' } // non-source file
      }
      return { status: 0, stdout: '' }
    })

    const result = listChangedFiles('/repo', { includeDeps: true })
    // README.md doesn't match /\.(js|ts|vue|mjs|cjs)$/, so no deps resolved
    expect(result).toContain('/repo/README.md')
    expect(readFileSyncMock).not.toHaveBeenCalled()
  })
})
