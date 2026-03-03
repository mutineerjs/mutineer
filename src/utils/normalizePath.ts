/** Normalize a file path to use forward slashes (same as vite's normalizePath). */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}
