<!-- refreshed: 2026-05-04 -->

# Architecture

**Analysis Date:** 2026-05-04

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                               │
│                  `src/bin/mutineer.ts`                               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Orchestrator                                   │
│                 `src/runner/orchestrator.ts`                         │
│  config → discover → baseline → enumerate → schema → pool           │
└───────────┬──────────────────────────────────────────┬──────────────┘
            │                                          │
            ▼                                          ▼
┌───────────────────────┐               ┌──────────────────────────────┐
│   Mutation Engine     │               │    Test Runner Adapters       │
│  `src/core/`          │               │  `src/runner/vitest/`        │
│  `src/mutators/`      │               │  `src/runner/jest/`          │
│                       │               │                              │
│  - AST traversal      │               │  Implements TestRunnerAdapter │
│  - Mutator registry   │               │  - runBaseline()             │
│  - Schema generation  │               │  - runMutant()               │
│    (ternary embed)    │               │  - Worker pool mgmt          │
└───────────────────────┘               └──────────────────┬───────────┘
                                                           │
                               ┌───────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Worker Processes                                │
│   `src/runner/vitest/worker.mts`  `src/runner/jest/worker.mts`      │
│   Persistent processes: receive mutant via stdin JSON, return result │
│   Use schema path (globalThis.__mutineer_active_id__) or redirect    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Cache + Results                                 │
│   `.mutineer-cache.json`  /  `mutineer-report.json`                 │
│   `src/runner/cache.ts`   /  `src/utils/summary.ts`                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component             | Responsibility                                     | File                                                              |
| --------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| CLI                   | Argument routing, init/run/clean commands          | `src/bin/mutineer.ts`                                             |
| Orchestrator          | Full run coordination, all phases                  | `src/runner/orchestrator.ts`                                      |
| Config loader         | Load and validate `mutineer.config.ts`             | `src/runner/config.ts`                                            |
| Discovery             | Build target-to-test mapping via import crawl      | `src/runner/discover.ts`                                          |
| Variant enumerator    | Apply mutators to source, build Variant list       | `src/runner/variants.ts`                                          |
| Schema generator      | Embed all variants as ternary chain in one file    | `src/core/schemata.ts`                                            |
| Task preparer         | Prune tests by coverage, compute cache keys        | `src/runner/tasks.ts`                                             |
| Pool executor         | Drive N workers concurrently, write cache          | `src/runner/pool-executor.ts`                                     |
| Vitest adapter        | Implements TestRunnerAdapter for Vitest            | `src/runner/vitest/adapter.ts`                                    |
| Jest adapter          | Implements TestRunnerAdapter for Jest              | `src/runner/jest/adapter.ts`                                      |
| VitestPool            | Manages pool of persistent Vitest worker processes | `src/runner/vitest/pool.ts`                                       |
| JestPool              | Manages pool of persistent Jest worker processes   | `src/runner/jest/pool.ts`                                         |
| Redirect loader       | ESM loader hook that swaps the mutated file URL    | `src/runner/vitest/redirect-loader.ts`                            |
| Mutator registry      | All ASTMutators indexed by name                    | `src/mutators/registry.ts`                                        |
| Operator mutators     | Arithmetic/logical/comparison operator swaps       | `src/mutators/operator.ts`                                        |
| Return-value mutators | Return type replacements (null, [], false, etc.)   | `src/mutators/return-value.ts`                                    |
| Vue SFC mutators      | Vue ref/computed/template mutations                | `src/mutators/vue-composition.ts`, `src/mutators/vue-template.ts` |
| TS type checker       | Pre-filter mutants that produce compile errors     | `src/runner/ts-checker.ts`                                        |
| Cache                 | Read/write/hash mutant results to disk             | `src/runner/cache.ts`                                             |
| Coverage resolver     | Load coverage data, enable per-test pruning        | `src/runner/coverage-resolver.ts`                                 |
| Summary/reporter      | Print text summary or write JSON report            | `src/utils/summary.ts`                                            |

## Pattern Overview

**Overall:** Pipeline pattern with adapter pattern for test runner abstraction

**Key Characteristics:**

- Each run phase is a sequential step in `runOrchestrator()` - config, discover, baseline, enumerate, schema-gen, execute
- Test runner backends (Vitest, Jest) are interchangeable via the `TestRunnerAdapter` interface (`src/runner/types.ts`)
- Mutations are activated at runtime via an embedded ternary chain in schema files rather than per-mutant file writes (the "schema path"), with a fallback to file redirection for cases where the ternary cannot be embedded
- Worker processes are persistent across mutants (watch-mode), receiving mutant descriptors over stdin/stdout JSON
- Cache keys are content-addressed hashes of (test set, mutated code) so unchanged mutants are skipped on re-runs

## Layers

**CLI Layer:**

- Purpose: Parse args, print help/version, route to orchestrator or cleanup
- Location: `src/bin/mutineer.ts`
- Contains: Argument parsing, TTY prompts, main entry point
- Depends on: `src/runner/orchestrator.ts`, `src/runner/cleanup.ts`
- Used by: npm bin `mutineer`

**Orchestrator Layer:**

- Purpose: Coordinate all phases of a mutation run
- Location: `src/runner/orchestrator.ts`
- Contains: The top-level `runOrchestrator()` function and all phase orchestration
- Depends on: config, discover, variants, schemata, tasks, pool-executor, adapters, cache, ts-checker
- Used by: `src/bin/mutineer.ts`

**Runner Layer:**

- Purpose: Manage test execution, workers, caching, discovery, coverage
- Location: `src/runner/`
- Contains: Adapters (vitest/jest), worker pools, task scheduling, cache I/O, discovery
- Depends on: `src/core/`, `src/types/`, `src/utils/`
- Used by: Orchestrator

**Core / Mutation Engine:**

- Purpose: Generate mutation variants from source code using AST analysis
- Location: `src/core/`, `src/mutators/`
- Contains: `mutateModuleSource()`, Vue SFC mutators, mutator registry, schema generator
- Depends on: `@babel/parser`, `@babel/traverse`, `@babel/types`, `magic-string`
- Used by: Runner layer (`src/runner/variants.ts`, `src/runner/orchestrator.ts`)

**Types Layer:**

- Purpose: Shared TypeScript interfaces used across all layers
- Location: `src/types/`
- Contains: `MutineerConfig`, `MutantPayload`, `Variant`, `MutantStatus`, etc.
- Depends on: Nothing
- Used by: All other layers

**Utils Layer:**

- Purpose: Shared utilities (logger, progress, coverage, summary, path normalization)
- Location: `src/utils/`
- Contains: `logger.ts`, `progress.ts`, `summary.ts`, `coverage.ts`, `normalizePath.ts`, Ink components
- Depends on: `chalk`, `ink`, `react`
- Used by: Runner layer, orchestrator, CLI

## Data Flow

### Primary Mutation Run

1. `main()` parses `process.argv` (`src/bin/mutineer.ts:113`)
2. `runOrchestrator(args, cwd)` called (`src/runner/orchestrator.ts:77`)
3. `loadMutineerConfig()` reads `mutineer.config.ts` (`src/runner/config.ts`)
4. `parseCliOptions()` merges CLI flags with config (`src/runner/args.ts`)
5. Adapter created: `createVitestAdapter()` or `createJestAdapter()` (`src/runner/orchestrator.ts:97`)
6. `autoDiscoverTargetsAndTests()` crawls imports to build test-to-source map (`src/runner/discover.ts`)
7. `adapter.runBaseline(tests)` verifies tests pass before mutation (`src/runner/orchestrator.ts:205`)
8. `enumerateAllVariants()` applies all mutators to each target file (`src/runner/variants.ts:122`)
9. Optional: TypeScript pre-filter via `checkTypes()` removes compile-error mutants (`src/runner/ts-checker.ts`)
10. `generateSchema()` writes a single schema file per source file with all variants embedded as a ternary chain (`src/core/schemata.ts`)
11. `prepareTasks()` prunes tests by per-test coverage, computes cache keys (`src/runner/tasks.ts`)
12. `executePool()` initialises N worker processes, dispatches tasks concurrently (`src/runner/pool-executor.ts`)
13. Workers return `killed | escaped | timeout | error` per mutant; results written to cache
14. `saveCacheAtomic()` persists results; `printSummary()` or JSON report written

### Worker Execution Path (Schema)

1. Pool executor sends `{ type: 'run', mutant, tests }` JSON line to worker stdin
2. Worker writes `mutant.id` to `__mutineer__/active_id_<workerId>.txt`
3. Worker calls `vitest.runTestSpecifications(specs)` (or Jest `runCLI`)
4. Test process resolves imports; schema file is loaded in place of original
5. `globalThis.__mutineer_active_id__` getter reads the active-id file, selects the correct ternary branch
6. Tests run against the mutated code in-process; result (`killed` / `escaped`) sent back via stdout JSON

### Worker Execution Path (Fallback Redirect)

Used when the ternary cannot be embedded (Vue template sections, overlapping diffs, parse failures):

1. Worker writes mutated code to a temp file `src/__mutineer__/file_N.ts`
2. Sets `globalThis.__mutineer_redirect__` to `{ from: originalPath, to: tempPath }`
3. ESM redirect loader (`src/runner/vitest/redirect-loader.ts`) intercepts `resolve()` hook and swaps the URL
4. Tests import the mutated temp file transparently

**State Management:**

- Run-level state: in-memory `cache` object (plain JS object) accumulated throughout a run
- Worker-level state: `globalThis.__mutineer_active_id__` (Vitest) or `globalThis.__mutineer_redirect__` (Jest/fallback)
- Disk state: `.mutineer-cache.json` (written atomically at end of run), `__mutineer__/` temp directories (cleaned up after run)

## Key Abstractions

**TestRunnerAdapter:**

- Purpose: Decouple orchestrator from test runner specifics
- Interface: `src/runner/types.ts` — `init()`, `runBaseline()`, `runMutant()`, `shutdown()`
- Examples: `src/runner/vitest/adapter.ts`, `src/runner/jest/adapter.ts`
- Pattern: Factory function returns adapter (`createVitestAdapter`, `createJestAdapter`)

**ASTMutator:**

- Purpose: Single-responsibility mutator that transforms source code
- Interface: `src/mutators/types.ts` — `apply(src): MutationOutput[]`, optional `applyWithContext()`
- Examples: `src/mutators/operator.ts`, `src/mutators/return-value.ts`, `src/mutators/vue-composition.ts`
- Pattern: Plain objects with name/description/apply — no class hierarchy

**Schema File:**

- Purpose: A single modified copy of a source file where every mutation variant is embedded as a nested ternary guarded by `globalThis.__mutineer_active_id__`
- Generated at: `src/__mutineer__/<basename>_schema<ext>`
- Producer: `src/core/schemata.ts:generateSchema()`
- Consumer: Vitest test process at module load time

**MutantTask:**

- Purpose: Execution unit — a single variant + its pruned test set + cache key
- Definition: `src/runner/tasks.ts`
- Produced by: `prepareTasks()` after coverage pruning
- Consumed by: `executePool()`

**TestMap:**

- Purpose: Map from absolute source file path to set of absolute test file paths
- Type: `Map<string, Set<string>>` — defined in `src/runner/discover.ts`
- Two variants: `testMap` (all tests in import graph), `directTestMap` (only tests that directly import the file)

## Entry Points

**CLI binary:**

- Location: `src/bin/mutineer.ts`
- Triggers: `npx mutineer run`, `npx mutineer init`, `npx mutineer clean`
- Responsibilities: Routes to `runOrchestrator()`, `cleanupMutineerDirs()`, or config template creation

**Public API:**

- Location: `src/index.ts`
- Triggers: User imports `import { defineMutineerConfig } from 'mutineer'`
- Responsibilities: Re-exports config type and `defineMutineerConfig()` helper

## Architectural Constraints

- **Module format:** Pure ESM (`"type": "module"` in package.json). All imports use `.js` extension even for `.ts` source files (TypeScript ESM convention).
- **Worker isolation:** Each persistent worker process runs in its own process group (`detached: true`) so SIGKILL propagates to all Vitest inner forks.
- **Schema vs. redirect:** Schema path (ternary embedding) is the default and avoids module reloads. Redirect path (file swap + ESM loader hook) is the fallback for Vue templates, overlapping diffs, and parse failures. `fallbackIds` tracks which mutant IDs must use the redirect path.
- **Global state:** `globalThis.__mutineer_active_id__` (set via file read by a getter defined in setup module). `globalThis.__mutineer_redirect__` (set in worker before each run). Both are worker-process-local, not shared across workers.
- **Circular imports:** None known.
- **Threading:** Single-threaded event loop per worker process. Parallelism is achieved by spawning N worker sub-processes. The orchestrator itself is single-process but uses `Promise.all` for async concurrency.

## Anti-Patterns

### Writing mutant files per mutant (legacy redirect path)

**What happens:** Before schema generation, each mutant was written as a full copy of the source file into `__mutineer__/`. The pool executor still uses this path for `fallbackIds`.
**Why it's wrong:** Writing N full file copies is slow and causes high disk I/O for large codebases with many mutants.
**Do this instead:** Prefer the schema path (embedded ternary), which writes one file per source file regardless of mutant count. Only fall back to redirect for Vue templates and overlapping diffs.

### Bypassing the TestRunnerAdapter interface

**What happens:** Calling Vitest or Jest APIs directly from the orchestrator.
**Why it's wrong:** Breaks the symmetry between adapters; makes it impossible to add new runners cleanly.
**Do this instead:** All test runner interaction must go through `TestRunnerAdapter` methods defined in `src/runner/types.ts`.

## Error Handling

**Strategy:** Errors in mutation enumeration are caught per-file and silently yield `[]` (see `src/runner/variants.ts:81`). Errors in schema generation per-file cause that file's variants to fall back to the redirect path. Worker process errors / unexpected exits are caught by `PendingTask` rejection in `src/runner/vitest/pool.ts`. The orchestrator sets `process.exitCode = 1` on fatal errors rather than throwing.

**Patterns:**

- Per-file errors in discovery/enumeration: logged at debug level, file skipped
- Baseline failure: sets `process.exitCode = 1`, returns early
- Worker timeout: SIGKILL the worker process group, resolve with `{ killed: true, error: 'timeout' }`, worker restarts automatically
- Signal handling (SIGINT/SIGTERM): `signalHandler` in `src/runner/pool-executor.ts` triggers graceful finish + cleanup

## Cross-Cutting Concerns

**Logging:** `createLogger(scope)` factory (`src/utils/logger.ts`) — prefixes all output with scope name. Debug output gated by `MUTINEER_DEBUG=1` env var.
**Validation:** Config shape is TypeScript interfaces only; no runtime schema validation library.
**Progress display:** `src/utils/progress.ts` (`Progress` class) and `src/utils/PoolSpinner.tsx` (Ink React component rendered to stderr).
**Path normalization:** `normalizePath()` (`src/utils/normalizePath.ts`) converts backslashes to forward slashes for cross-platform consistency. Used extensively in discover and variants.

---

_Architecture analysis: 2026-05-04_
