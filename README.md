```
                  _   _
                 | | (_)
  _ __ ___  _   _| |_ _ _ __   ___  ___ _ __
 | '_ ` _ \| | | | __| | '_ \ / _ \/ _ \ '__|
 | | | | | | |_| | |_| | | | |  __/  __/ |
 |_| |_| |_|\__,_|\__|_|_| |_|\___|\___|_|

       === ~> !== · && ~> || · + ~> -
```

Mutineer is a fast, targeted mutation testing framework for JavaScript and TypeScript. Mutineer introduces small code changes (mutations) into your source files and runs your existing tests to see if they catch the defect. If a test fails, the mutant is "killed" -- meaning your tests are doing their job. If all tests pass, the mutant "escaped" -- revealing a gap in your test coverage.

Built for **Vitest** with first-class **Jest** support. Other test runners can be added via the adapter interface.

**Author**: [Billy Jones](https://www.linkedin.com/in/billyjonesy/)

## How It Works

1. **Baseline** -- runs your test suite to make sure everything passes before mutating
2. **Mutate** -- applies AST-safe operator replacements to your source files (not your tests)
3. **Test** -- re-runs only the tests that import the mutated file, using a fast file-swap mechanism
4. **Report** -- prints a summary with kill rate, escaped mutants, and per-file breakdowns

Mutations are applied using Babel AST analysis, so operators inside strings and comments are never touched. Mutated code is injected at runtime via Vite plugins (Vitest) or custom resolvers (Jest) -- no files on disk are modified.

## Supported Mutations (WIP)

| Category     | Mutator             | Transformation                       |
| ------------ | ------------------- | ------------------------------------ |
| Equality     | `flipStrictEQ`      | `===` &rarr; `!==`                   |
|              | `flipStrictNEQ`     | `!==` &rarr; `===`                   |
|              | `flipEQ`            | `==` &rarr; `!=`                     |
|              | `flipNEQ`           | `!=` &rarr; `==`                     |
| Boundary     | `relaxLE`           | `<=` &rarr; `<`                      |
|              | `relaxGE`           | `>=` &rarr; `>`                      |
|              | `tightenLT`         | `<` &rarr; `<=`                      |
|              | `tightenGT`         | `>` &rarr; `>=`                      |
| Logical      | `andToOr`           | `&&` &rarr; `\|\|`                   |
|              | `orToAnd`           | `\|\|` &rarr; `&&`                   |
|              | `nullishToOr`       | `??` &rarr; `\|\|`                   |
| Arithmetic   | `addToSub`          | `+` &rarr; `-`                       |
|              | `subToAdd`          | `-` &rarr; `+`                       |
|              | `mulToDiv`          | `*` &rarr; `/`                       |
|              | `divToMul`          | `/` &rarr; `*`                       |
|              | `modToMul`          | `%` &rarr; `*`                       |
|              | `powerToMul`        | `**` &rarr; `*`                      |
| Return value | `returnToNull`      | `return x` &rarr; `return null`      |
|              | `returnToUndefined` | `return x` &rarr; `return undefined` |
|              | `returnFlipBool`    | `return true` &harr; `return false`  |
|              | `returnZero`        | `return n` &rarr; `return 0`         |
|              | `returnEmptyStr`    | `return s` &rarr; `return ''`        |
|              | `returnEmptyArr`    | `return [...]` &rarr; `return []`    |

## Installation

```bash
npm i @mutineerjs/mutineer
```

## Usage

### Commands

| Command          | Description                                         |
| ---------------- | --------------------------------------------------- |
| `mutineer init`  | Create a `mutineer.config.ts` with minimal defaults |
| `mutineer run`   | Run mutation testing                                |
| `mutineer clean` | Remove leftover `__mutineer__` temp directories     |

### Quick Start

Try it immediately with `npx`:

```bash
npx @mutineerjs/mutineer init
npx @mutineerjs/mutineer run
```

Or add scripts to your `package.json` (recommended for team projects):

```json
{
  "scripts": {
    "mutineer": "mutineer run",
    "mutineer:init": "mutineer init"
  }
}
```

```bash
npm run mutineer:init
npm run mutineer
```

### CLI Options (for `mutineer run`)

| Flag                     | Description                                | Default       |
| ------------------------ | ------------------------------------------ | ------------- |
| `--runner <type>`        | Test runner: `vitest` or `jest`            | `vitest`      |
| `--config`, `-c`         | Path to config file                        | auto-detected |
| `--concurrency <n>`      | Parallel workers (min 1)                   | CPUs - 1      |
| `--changed`              | Only mutate files changed vs base branch   | --            |
| `--changed-with-deps`    | Include dependents of changed files        | --            |
| `--only-covered-lines`   | Skip mutations on uncovered lines          | --            |
| `--per-test-coverage`    | Run only tests that cover the mutated line | --            |
| `--coverage-file <path>` | Path to Istanbul coverage JSON             | auto-detected |
| `--min-kill-percent <n>` | Fail if kill rate is below threshold       | --            |
| `--progress <mode>`      | Display mode: `bar`, `list`, or `quiet`    | `bar`         |

### Examples

Run mutations on only the files you changed:

```bash
npm run mutineer -- --changed
```

Run with Jest and a minimum kill rate:

```bash
npm run mutineer -- --runner jest --min-kill-percent 80
```

Focus on covered code with 2 parallel workers:

```bash
npm run mutineer -- --only-covered-lines --concurrency 2
```

## Configuration

Create a `mutineer.config.ts` (or `.js` / `.mjs`) in your project root with `mutineer init`, or manually:

```typescript
import { defineMutineerConfig } from 'mutineer'

export default defineMutineerConfig({
  source: 'src',
  runner: 'vitest',
  vitestConfig: 'vitest.config.ts',
  minKillPercent: 80,
  onlyCoveredLines: true,
})
```

### Config Options

| Option              | Type                 | Description                                      |
| ------------------- | -------------------- | ------------------------------------------------ |
| `source`            | `string \| string[]` | Glob patterns for source files to mutate         |
| `targets`           | `MutateTarget[]`     | Explicit list of files to mutate                 |
| `runner`            | `'vitest' \| 'jest'` | Test runner to use                               |
| `vitestConfig`      | `string`             | Path to vitest config                            |
| `jestConfig`        | `string`             | Path to jest config                              |
| `include`           | `string[]`           | Only run these mutators                          |
| `exclude`           | `string[]`           | Skip these mutators                              |
| `excludePaths`      | `string[]`           | Glob patterns for paths to skip                  |
| `maxMutantsPerFile` | `number`             | Cap mutations per file                           |
| `minKillPercent`    | `number`             | Fail if kill rate is below this                  |
| `onlyCoveredLines`  | `boolean`            | Only mutate lines covered by tests               |
| `perTestCoverage`   | `boolean`            | Use per-test coverage to select tests            |
| `baseRef`           | `string`             | Git ref for `--changed` (default: `origin/main`) |
| `testPatterns`      | `string[]`           | Globs for test file discovery                    |
| `extensions`        | `string[]`           | File extensions to consider                      |

## Recommended Workflow

Large repos can generate thousands of mutations. These strategies keep runs fast and incremental.

### 1. PR-scoped runs (CI) — `--changed-with-deps`

Run only on files changed in the branch plus their direct dependents:

```bash
mutineer run --changed-with-deps
```

- Tune the dependency graph depth with `dependencyDepth` in config (default: `1`)
- Add `--per-test-coverage` to only run tests that cover the mutated line
- Recommended `package.json` script:

```json
"mutineer:ci": "mutineer run --changed-with-deps --per-test-coverage"
```

### 2. Split configs by domain

Create a `mutineer.config.ts` per domain and run selectively:

```bash
mutineer run -c src/api/mutineer.config.ts
```

Each config sets its own `source` glob and `minKillPercent`. Good for monorepos or large modular projects — domains can also be parallelized in CI.

### 3. Combine filters to reduce scope

- `--only-covered-lines` — skips lines not covered by any test (requires a coverage file)
- `maxMutantsPerFile` — caps mutations per file as a safety valve
- Combine for maximum focus:

```bash
mutineer run --changed-with-deps --only-covered-lines --per-test-coverage
```

## File Support

- TypeScript and JavaScript modules (`.ts`, `.js`, `.tsx`, `.jsx`)
- Vue Single File Components (`.vue` with `<script setup>`)

## Extending: Adding a New Test Runner

Mutineer uses an adapter pattern to support different test runners. To add a new one, implement the `TestRunnerAdapter` interface:

```typescript
import type {
  TestRunnerAdapter,
  TestRunnerAdapterOptions,
  BaselineOptions,
  MutantPayload,
  MutantRunResult,
} from 'mutineer'

export function createMyRunnerAdapter(
  options: TestRunnerAdapterOptions,
): TestRunnerAdapter {
  return {
    name: 'my-runner',

    async init(concurrencyOverride?: number) {
      // Start worker pool, set up file-swap mechanism, etc.
    },

    async runBaseline(tests: readonly string[], opts: BaselineOptions) {
      // Run all tests without mutations.
      // Return true if they pass, false otherwise.
      // If opts.collectCoverage is true, write Istanbul-format JSON.
    },

    async runMutant(mutant: MutantPayload, tests: readonly string[]) {
      // Swap in the mutated code and run the relevant tests.
      // Return { status: 'killed' | 'escaped' | 'timeout' | 'error', durationMs }
    },

    async shutdown() {
      // Tear down workers and clean up resources.
    },

    hasCoverageProvider() {
      // Return true if the runner has coverage support available.
      return false
    },

    async detectCoverageConfig() {
      // Return { perTestEnabled, coverageEnabled } from runner config.
      return { perTestEnabled: false, coverageEnabled: false }
    },
  }
}
```

The key requirement is the **file-swap mechanism** -- the adapter needs a way to intercept module resolution so the mutated source code is loaded instead of the original file on disk. See the Vitest adapter (Vite plugin + ESM loader) and Jest adapter (custom resolver) for working reference implementations in `src/runner/vitest/` and `src/runner/jest/`.

## License

MIT
