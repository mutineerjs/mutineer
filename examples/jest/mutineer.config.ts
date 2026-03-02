import type { MutineerConfig } from '../../dist/index.js'

const config: MutineerConfig = {
  runner: 'jest',
  jestConfig: 'jest.config.cjs',
  targets: ['src/calc.ts'],
  testPatterns: ['__tests__/**/*.test.ts'],
  coverage: true,
}

export default config
