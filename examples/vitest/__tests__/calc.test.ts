import { describe, it, expect } from 'vitest'
import { add, isEven, isAdult } from '../src/calc'

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

  it('identifies adults', () => {
    expect(isAdult(20)).toBe(true)
    expect(isAdult(15)).toBe(false)
    // This mutation escapes! Mutineer changes `>=` to `>` and these tests still pass.
    // Uncomment the line below to kill the boundary mutant:
    // expect(isAdult(18)).toBe(true)
  })
})
