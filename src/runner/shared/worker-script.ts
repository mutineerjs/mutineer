import path from 'node:path'
import fs from 'node:fs'

/**
 * Find a worker/loader script by checking .js -> .mjs -> .ts extension fallback.
 * Handles compiled (.js), bundled (.mjs), and source (.ts) environments.
 */
export function resolveWorkerScript(dir: string, basename: string): string {
  const js = path.join(dir, `${basename}.js`)
  const mjs = path.join(dir, `${basename}.mjs`)
  const ts = path.join(dir, `${basename}.ts`)
  return fs.existsSync(js) ? js : fs.existsSync(mjs) ? mjs : ts
}
