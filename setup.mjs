import { beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
const _f = process.env.MUTINEER_ACTIVE_ID_FILE
beforeAll(() => {
  try { globalThis.__mutineer_active_id__ = readFileSync(_f, 'utf8').trim() || null }
  catch { globalThis.__mutineer_active_id__ = null }
})
