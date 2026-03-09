/**
 * Flat ESLint config (ESLint v9+)
 * Uses @typescript-eslint parser + plugin and re-uses the plugin's recommended rules.
 */
const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')

module.exports = [
  // files/dirs to ignore
  {
    ignores: [
      'mutineer.config.ts',
      'vitest.config.ts',
      'commitlint.config.cjs',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.log',
      'examples/**',
    ],
  },

  // TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        ecmaVersion: 2021,
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // start from the plugin's recommended rules
      ...tsPlugin.configs.recommended.rules,
      // Project-specific adjustments
      'no-console': 'off',
      semi: ['error', 'never'],
    },
  },

  // Test files — relax strict rules for mocking/stubs
  {
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-this-alias': 'off',
    },
  },

  // JS files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
      semi: ['error', 'never'],
    },
  },
]
