import { describe, it, expect } from 'vitest'
import { collectOperatorTargets } from '../utils.js'

describe('collectOperatorTargets', () => {
  it('honors mutineer disable comments', () => {
    const src = `// mutineer-disable-next-line
const a = b && c
const b = c && d // mutineer-disable-line
const c = d && e /* mutineer-disable */
const d = e && f
`

    const targets = collectOperatorTargets(src, '&&')

    const lines = targets.map((t) => t.line)
    expect(lines).toEqual([5])
  })
})
