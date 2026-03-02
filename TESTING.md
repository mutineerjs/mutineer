# Testing Guide for Mutineer

This document describes the test setup for the Mutineer project, specifically for testing the code in the `src` directory.

## Test Runner: Vitest

We use **Vitest** as the test runner for the core Mutineer library code. Vitest is:

- ESM-native and perfect for our `"type": "module"` configuration
- Extremely fast with parallel test execution
- Compatible with Jest-style test syntax
- Great for testing Node.js utilities and library code

> Note: The `admin/` directory has its own separate Vitest config for Vue component testing with jsdom.

## Project Structure

```
src/
  core/__tests__/
    module.spec.ts           # Tests for mutation generation
  mutators/__tests__/
    registry.spec.ts         # Tests for mutator registry and filtering
  runner/__tests__/
    orchestrator.spec.ts     # Tests for orchestration and cache management
  utils/__tests__/
    progress.spec.ts         # Tests for progress reporting
```

## Running Tests

### Development

Run tests in watch mode (automatically reruns when files change):

```bash
npm run test:watch
```

### CI/One-shot

Run tests once and exit:

```bash
npm test
```

### With Coverage

Generate coverage reports:

```bash
npm run test:coverage
```

Coverage reports are generated in the `coverage/` directory as:

- `coverage/index.html` - interactive HTML report
- `coverage/coverage-final.json` - machine-readable format

## Test Configuration

The test configuration is defined in `vitest.config.ts`:

- **Environment**: `node` (not DOM)
- **Globals**: Enabled (no need to import `describe`, `it`, `expect`)
- **Include pattern**: `src/**/__tests__/**/*.spec.ts`
- **Coverage**: v8 provider with intelligent exclusions

## Writing Tests

### Basic Test File Template

```typescript
import { describe, it, expect } from 'vitest'

describe('MyModule', () => {
  it('should do something', () => {
    const result = someFunction()
    expect(result).toBe(expectedValue)
  })
})
```

### Async Tests

```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction()
  expect(result).toEqual(expectedData)
})
```

### Setup and Teardown

```typescript
import { beforeEach, afterEach } from 'vitest'

describe('FileOperations', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('should work with files', () => {
    // use tempDir
  })
})
```

### Mocking

```typescript
import { vi } from 'vitest'

describe('WithMocks', () => {
  it('should mock functions', () => {
    const mockFn = vi.fn()
    mockFn('arg')

    expect(mockFn).toHaveBeenCalledWith('arg')
  })
})
```

## Existing Tests

### Core Module Tests (`src/core/__tests__/module.spec.ts`)

Tests for the `mutateModuleSource` function, verifying:

- Basic mutation generation
- Include/exclude filtering
- Max mutation limits
- Error handling for invalid parameters

### Mutator Registry Tests (`src/mutators/__tests__/registry.spec.ts`)

Tests for the mutator registry and filtering system, verifying:

- Registry returns available mutators
- Mutators have required properties
- Include and exclude filters work correctly

### Progress Tests (`src/utils/__tests__/progress.spec.ts`)

Tests for the progress tracking utility, verifying:

- Initialization with various totals
- Status update tracking
- Multiple finish calls don't error
- Mode switching (bar vs list)
- Console interception

### Orchestrator Tests (`src/runner/__tests__/orchestrator.spec.ts`)

Tests for orchestration and caching, verifying:

- Cache file reading
- Cache parsing and validation
- Graceful handling of missing/malformed cache files

## Adding New Tests

1. Create a file in the appropriate `__tests__` directory
2. Name it `*.spec.ts` to match the include pattern
3. Import from `vitest` for test utilities
4. Run `npm run test:watch` during development
5. Commit tests alongside feature changes

## Debugging Tests

### Run Single File

```bash
npm test -- src/core/__tests__/module.spec.ts
```

### Run Tests Matching Pattern

```bash
npm test -- --grep "mutateModuleSource"
```

### Verbose Output

```bash
npm test -- --reporter=verbose
```

### Debug Mode

```bash
node --inspect-brk ./node_modules/.bin/vitest --run
```

Then open `chrome://inspect` in Chrome DevTools.

## Best Practices

1. **Test Behavior, Not Implementation** - Focus on what the function does, not how it does it
2. **Use Descriptive Test Names** - Test names should describe the scenario and expected outcome
3. **Keep Tests Focused** - Each test should verify one thing
4. **Use Fixtures** - For common test data, consider creating test helpers
5. **Avoid Flakiness** - Use appropriate timeouts for async code, avoid race conditions
6. **Clean Up** - Always clean up resources in `afterEach` hooks

## Coverage Goals

We aim for meaningful coverage on:

- Core business logic (mutations, filtering, caching)
- Error handling and edge cases
- Public APIs

We don't require 100% coverage on:

- Type definitions
- CLI argument parsing
- Progress/UI code (tested manually)

## Troubleshooting

### Tests not found

Make sure your test file:

- Is in a `__tests__` directory or ends with `.spec.ts`
- Uses TypeScript (`.ts` extension)
- Is not in `node_modules`, `dist`, or other excluded directories

### Import errors

Verify:

- The imported file path is correct (relative to test file)
- The imported function/class is exported from the module
- You've run `npm run build:cli` if needed

### Module not found errors

If you see "Cannot find module", you may need to build first:

```bash
npm run build:cli
npm test
```

---

For more info on Vitest, see: https://vitest.dev
