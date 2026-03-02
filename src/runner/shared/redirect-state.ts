/**
 * Shared redirect state management for mutation testing.
 *
 * This module provides a centralized way to manage the redirect configuration
 * that tells test runners to load mutant code instead of the original source.
 *
 * Both Jest and Vitest adapters use this to coordinate file redirection during
 * test execution.
 */

declare global {
  var __mutineer_redirect__:
    | {
        from: string | null
        to: string | null
      }
    | undefined
}

/**
 * Configuration for redirecting file imports/requires.
 */
export interface RedirectConfig {
  /** Absolute path to the original source file */
  readonly from: string
  /** Absolute path to the mutant file */
  readonly to: string
}

/**
 * Initialize the global redirect state.
 * Must be called once at module load time.
 */
export function initializeRedirectState(): void {
  globalThis.__mutineer_redirect__ = { from: null, to: null }
}

/**
 * Set the active redirect configuration.
 *
 * @param config - The redirect configuration
 */
export function setRedirect(config: RedirectConfig): void {
  globalThis.__mutineer_redirect__ = {
    from: config.from,
    to: config.to,
  }
}

/**
 * Get the current redirect configuration.
 *
 * @returns The redirect config if one is active, null otherwise
 */
export function getRedirect(): RedirectConfig | null {
  const redirect = globalThis.__mutineer_redirect__
  if (!redirect?.from || !redirect?.to) {
    return null
  }
  return {
    from: redirect.from,
    to: redirect.to,
  }
}

/**
 * Clear the redirect configuration.
 */
export function clearRedirect(): void {
  globalThis.__mutineer_redirect__ = { from: null, to: null }
}

// Initialize on module load
initializeRedirectState()
