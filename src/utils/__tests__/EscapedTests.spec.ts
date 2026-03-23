import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MutantCacheEntry } from '../../types/mutant.js'

const mockExit = vi.fn()
const mockSetExpanded = vi.fn()

type InputHandler = (input: string, key: { return: boolean }) => void
type EffectCallback = () => void

let inputHandler: InputHandler | undefined
let effectCallback: EffectCallback | undefined

vi.mock('ink', () => ({
  Box: ({ children }: { children?: unknown }) => children,
  Text: ({ children }: { children?: unknown }) => children,
  useInput: vi.fn((fn: InputHandler) => {
    inputHandler = fn
  }),
  useApp: () => ({ exit: mockExit }),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: vi.fn((init: unknown) => [init, mockSetExpanded]),
    useEffect: vi.fn((fn: EffectCallback) => {
      effectCallback = fn
    }),
  }
})

import { EscapedTests } from '../EscapedTests.js'
import { useState } from 'react'

const entries: MutantCacheEntry[] = [
  {
    status: 'escaped',
    file: '/cwd/src/math.ts',
    line: 3,
    col: 5,
    mutator: 'addToSub',
    passingTests: ['Suite > adds two numbers', 'Suite > handles zero'],
  },
  {
    status: 'escaped',
    file: '/cwd/src/auth.ts',
    line: 12,
    col: 1,
    mutator: 'flipEQ',
    passingTests: ['Auth > validates token'],
  },
]

describe('EscapedTests', () => {
  beforeEach(() => {
    mockExit.mockClear()
    mockSetExpanded.mockClear()
    inputHandler = undefined
    effectCallback = undefined
    vi.mocked(useState).mockImplementation(((init: unknown) => [
      init,
      mockSetExpanded,
    ]) as unknown as typeof useState)
  })

  it('registers a useInput handler on render', () => {
    EscapedTests({ entries, cwd: '/cwd' })
    expect(inputHandler).toBeDefined()
  })

  it('calls setExpanded(true) when "e" is pressed', () => {
    EscapedTests({ entries, cwd: '/cwd' })
    inputHandler!('e', { return: false })
    expect(mockSetExpanded).toHaveBeenCalledWith(true)
  })

  it('calls exit() when return is pressed', () => {
    EscapedTests({ entries, cwd: '/cwd' })
    inputHandler!('', { return: true })
    expect(mockExit).toHaveBeenCalled()
  })

  it('calls exit() when "q" is pressed', () => {
    EscapedTests({ entries, cwd: '/cwd' })
    inputHandler!('q', { return: false })
    expect(mockExit).toHaveBeenCalled()
  })

  it('does not call exit() or setExpanded for other keys', () => {
    EscapedTests({ entries, cwd: '/cwd' })
    inputHandler!('x', { return: false })
    expect(mockExit).not.toHaveBeenCalled()
    expect(mockSetExpanded).not.toHaveBeenCalled()
  })

  it('useEffect calls exit() when expanded is true', () => {
    vi.mocked(useState).mockReturnValueOnce([
      true,
      mockSetExpanded,
    ] as ReturnType<typeof useState>)
    EscapedTests({ entries, cwd: '/cwd' })
    effectCallback!()
    expect(mockExit).toHaveBeenCalled()
  })

  it('useEffect does not call exit() when expanded is false', () => {
    EscapedTests({ entries, cwd: '/cwd' })
    effectCallback!()
    expect(mockExit).not.toHaveBeenCalled()
  })
})
