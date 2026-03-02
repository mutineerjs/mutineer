import type { MutineerConfig } from '../../dist/index.js'

const config: MutineerConfig = {
  runner: 'vitest',
  vitestConfig: 'vitest.config.ts',
  targets: ['src/calc.ts'],
  testPatterns: ['__tests__/**/*.test.ts'],
  coverage: true,
}

export default config
