<!-- refreshed: 2026-05-04 -->

# Testing

**Analysis Date:** 2026-05-04

## Framework

- **Runner:** Vitest v4.x (`vitest --run` for CI, `vitest` for watch)
- **Environment:** `node` (no browser/jsdom by default; jsdom available in devDependencies for specific specs)
- **Coverage:** `@vitest/coverage-v8` — JSON + HTML reporters
- **Config:** `vitest.config.ts` at project root

## Test File Location

Tests live in `__tests__/` directories co-located with source:

```
src/<module>/__tests__/<module>.spec.ts
```

Examples:

- `src/runner/__tests__/orchestrator.spec.ts`
- `src/mutators/__tests__/operator.spec.ts`
- `src/core/__tests__/schemata.spec.ts`
- `src/runner/vitest/__tests__/pool.spec.ts`

**Pattern:** `src/**/__tests__/**/*.spec.ts` (configured in `vitest.config.ts`).

## Coverage Configuration

```ts
coverage: {
  provider: 'v8',
  reporter: ['json', 'html'],
  include: ['src/**/*.ts'],
  exclude: [
    'src/**/__tests__/**',
    'src/**/types.ts',
    'src/types/**',
    'src/bin/**',
  ],
  thresholds: {
    lines: 60,
    functions: 60,
    branches: 60,
    statements: 60,
  },
}
```

Threshold is 60% across all dimensions. Project uses `vitest --run --coverage` for coverage reports.

## Mocking Patterns

**`vi.mock()` for module-level mocks:**

```ts
vi.mock('../config.js', () => ({
  loadMutineerConfig: vi.fn(),
}))
```

**`vi.hoisted()` for hoisted mock setup:**

```ts
const { mockLogDebug } = vi.hoisted(() => ({ mockLogDebug: vi.fn() }))
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ debug: mockLogDebug, info: ..., warn: ..., error: ... }),
  DEBUG: true,
}))
```

Heavy dependencies (config loader, adapters, pool, coverage resolver, discover) are mocked at the top of orchestrator tests. This is the standard pattern for unit-testing modules with deep dependency graphs.

**`vi.fn()` for individual functions:**

```ts
const mockFn = vi.fn().mockResolvedValue(result)
```

**`beforeEach` / `afterEach`** for setup and teardown.

**`describe` / `it` / `expect`** — standard Vitest API, imported explicitly (not globals despite `globals: true` in config — explicit imports are the convention in this codebase).

## Test Structure Pattern

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 1. Hoist mocks
const { mockX } = vi.hoisted(() => ({ mockX: vi.fn() }))

// 2. Module mocks
vi.mock('../dependency.js', () => ({ fn: mockX }))

// 3. Import module under test
import { thingUnderTest } from '../thing.js'

describe('thingUnderTest', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('does X when Y', async () => {
    mockX.mockResolvedValue(...)
    const result = await thingUnderTest(...)
    expect(result).toEqual(...)
  })
})
```

## Running Tests

```bash
npm test                  # vitest --run (single pass)
npm run test:watch        # vitest (watch mode)
npm run test:coverage     # vitest --run --coverage
```

## Notes

- `globals: true` is set in vitest config but imports are explicit in practice (safer with TypeScript).
- `jsdom` is available as a dev dependency; individual specs can opt in via `@vitest-environment jsdom` pragma if needed.
- Mutation testing of the project itself is run via `npm run mutate` (uses the project's own `mutineer.config.ts`).

---

_Testing analysis: 2026-05-04_
