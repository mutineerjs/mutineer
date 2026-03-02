import { describe, it, expect } from 'vitest'
import { add, isEven } from '../src/calc'

describe('calc', () => {
  it('adds numbers', () => {
    expect(add(2, 3)).toBe(5)
    expect(add(-1, 1)).toBe(0)
  })

  it('does not subtract when adding', () => {
    // Regression guard: mutation swapping + for - should fail this
    expect(add(4, 6)).toBe(10)
  })

  it('checks even numbers', () => {
    expect(isEven(2)).toBe(true)
    expect(isEven(3)).toBe(false)
  })
})
