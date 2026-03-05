import { describe, it, expect, beforeEach } from 'vitest'
import {
  initializeRedirectState,
  setRedirect,
  getRedirect,
  clearRedirect,
} from '../redirect-state.js'

describe('redirect-state', () => {
  beforeEach(() => {
    initializeRedirectState()
  })

  describe('initializeRedirectState', () => {
    it('sets global redirect to null/null', () => {
      expect(globalThis.__mutineer_redirect__).toEqual({
        from: null,
        to: null,
      })
    })
  })

  describe('setRedirect', () => {
    it('sets the redirect config', () => {
      setRedirect({ from: '/src/foo.ts', to: '/tmp/mutant.ts' })
      expect(globalThis.__mutineer_redirect__).toEqual({
        from: '/src/foo.ts',
        to: '/tmp/mutant.ts',
      })
    })
  })

  describe('getRedirect', () => {
    it('returns null when no redirect is set', () => {
      expect(getRedirect()).toBeNull()
    })

    it('returns the redirect config when set', () => {
      setRedirect({ from: '/src/foo.ts', to: '/tmp/mutant.ts' })
      const redirect = getRedirect()
      expect(redirect).toEqual({
        from: '/src/foo.ts',
        to: '/tmp/mutant.ts',
      })
    })

    it('returns null when from is null', () => {
      globalThis.__mutineer_redirect__ = { from: null, to: '/tmp/mutant.ts' }
      expect(getRedirect()).toBeNull()
    })

    it('returns null when to is null', () => {
      globalThis.__mutineer_redirect__ = { from: '/src/foo.ts', to: null }
      expect(getRedirect()).toBeNull()
    })
  })

  describe('clearRedirect', () => {
    it('resets the redirect to null/null', () => {
      setRedirect({ from: '/src/foo.ts', to: '/tmp/mutant.ts' })
      clearRedirect()
      expect(getRedirect()).toBeNull()
      expect(globalThis.__mutineer_redirect__).toEqual({
        from: null,
        to: null,
      })
    })
  })
})
