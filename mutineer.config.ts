import { defineMutineerConfig } from './dist/index.js'

export default defineMutineerConfig({
  runner: 'vitest',
  source: 'src',
  baseRef: 'origin/main',
  minKillPercent: 80,
  vitestConfig: 'vitest.config.ts',
  onlyCoveredLines: true,
})
