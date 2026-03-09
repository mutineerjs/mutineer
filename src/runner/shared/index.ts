/**
 * Shared utilities for test runner adapters.
 *
 * This module provides common functionality used by both Jest and Vitest adapters,
 * including mutant file path generation and redirect state management.
 */

export { getMutantFilePath } from './mutant-paths.js'
export {
  setRedirect,
  getRedirect,
  clearRedirect,
  initialiseRedirectState,
} from './redirect-state.js'
export type { RedirectConfig } from './redirect-state.js'
