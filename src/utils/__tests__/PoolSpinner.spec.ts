import { describe, it, expect, vi } from 'vitest'

vi.mock('ink', () => ({
  Box: ({ children }: { children: unknown }) => children,
  Text: ({ children }: { children: unknown }) => children,
}))
vi.mock('ink-spinner', () => ({
  default: () => null,
}))

describe('PoolSpinner', () => {
  it('renders without throwing', async () => {
    const { PoolSpinner } = await import('../PoolSpinner.js')
    const result = PoolSpinner({ message: 'initializing...' })
    expect(result).toBeDefined()
  })
})
