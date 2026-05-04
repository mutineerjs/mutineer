<!-- refreshed: 2026-05-04 -->

# Structure

**Analysis Date:** 2026-05-04

## Directory Layout

```
mutineer/
├── src/
│   ├── bin/                    # CLI entry point
│   │   ├── mutineer.ts         # Main binary: arg routing, init/run/clean
│   │   └── __tests__/
│   ├── core/                   # Mutation engine (pure, no I/O)
│   │   ├── module.ts           # Public API: mutateModuleSource()
│   │   ├── schemata.ts         # Schema file generator (ternary embedding)
│   │   ├── sfc.ts              # Vue SFC parsing helpers
│   │   ├── types.ts            # Core types (MutationVariant)
│   │   ├── variant-utils.ts    # Registry filtering, variant generation
│   │   └── __tests__/
│   ├── mutators/               # AST mutator implementations
│   │   ├── operator.ts         # Arithmetic/logical/comparison swaps
│   │   ├── registry.ts         # All mutators indexed by name
│   │   ├── return-value.ts     # Return type replacements
│   │   ├── types.ts            # ASTMutator / MutationOutput interfaces
│   │   ├── utils.ts            # AST traversal helpers
│   │   ├── vue-composition.ts  # Vue ref/reactive/computed mutations
│   │   ├── vue-template.ts     # Vue template mutations
│   │   └── __tests__/
│   ├── runner/                 # Orchestration, adapters, workers, cache
│   │   ├── orchestrator.ts     # Top-level run coordinator
│   │   ├── args.ts             # CLI flag parsing + config merge
│   │   ├── cache.ts            # Disk cache read/write
│   │   ├── changed.ts          # Git changed-file detection
│   │   ├── cleanup.ts          # Remove __mutineer__/ dirs
│   │   ├── config.ts           # Load mutineer.config.ts
│   │   ├── coverage-resolver.ts# Per-test coverage loading
│   │   ├── discover.ts         # Import-crawl target-to-test mapping
│   │   ├── pool-executor.ts    # Concurrent worker dispatch
│   │   ├── tasks.ts            # Task preparation, coverage pruning
│   │   ├── ts-checker.ts       # TypeScript pre-filter of invalid mutants
│   │   ├── ts-checker-worker.ts# Worker side of TS type checking
│   │   ├── types.ts            # TestRunnerAdapter interface
│   │   ├── variants.ts         # Variant enumeration across targets
│   │   ├── vitest/             # Vitest adapter + worker pool
│   │   │   ├── adapter.ts
│   │   │   ├── index.ts        # Factory: createVitestAdapter()
│   │   │   ├── plugin.ts       # Vite plugin for schema/redirect setup
│   │   │   ├── pool.ts         # Persistent Vitest worker pool
│   │   │   ├── redirect-loader.ts  # ESM loader hook for fallback redirect
│   │   │   ├── worker.mts      # Worker entry point (spawned by pool)
│   │   │   ├── worker-runtime.ts   # In-worker Vitest API usage
│   │   │   └── __tests__/
│   │   ├── jest/               # Jest adapter + worker pool
│   │   │   ├── adapter.ts
│   │   │   ├── index.ts        # Factory: createJestAdapter()
│   │   │   ├── pool.ts
│   │   │   ├── resolver.cts    # Jest module resolver (CJS)
│   │   │   ├── worker.mts
│   │   │   ├── worker-runtime.ts
│   │   │   └── __tests__/
│   │   └── shared/             # Shared worker utilities
│   │       ├── index.ts
│   │       ├── mutant-paths.ts     # Schema/redirect file path helpers
│   │       ├── pending-task.ts     # PendingTask<T> interface
│   │       ├── redirect-state.ts   # globalThis redirect state helpers
│   │       ├── strip-mutineer-args.ts
│   │       ├── worker-script.ts    # Worker script path resolution
│   │       └── __tests__/
│   ├── types/                  # Shared TypeScript interfaces
│   │   ├── config.ts           # MutineerConfig, MutateTarget
│   │   ├── globals.d.ts        # globalThis declarations
│   │   ├── index.ts
│   │   ├── jest-shim.d.ts
│   │   └── mutant.ts           # MutantStatus, MutantResult, Variant, etc.
│   ├── utils/                  # Shared utilities
│   │   ├── coverage.ts         # Coverage data helpers
│   │   ├── errors.ts           # Error formatting
│   │   ├── logger.ts           # createLogger() factory
│   │   ├── normalizePath.ts    # Cross-platform path normalization
│   │   ├── PoolSpinner.tsx     # Ink React progress spinner
│   │   ├── progress.ts         # Progress class for run tracking
│   │   ├── ProgressBar.tsx     # Ink React progress bar
│   │   ├── summary.ts          # Result summary printer / JSON reporter
│   │   └── __tests__/
│   └── index.ts                # Public package API
├── dist/                       # Compiled output (tsc)
├── examples/                   # Example projects
├── .planning/                  # GSD planning artifacts
├── mutineer.config.ts          # Self-test config for mutineer on itself
├── vitest.config.ts            # Test runner config
├── tsconfig.json               # TypeScript compiler config
├── eslint.config.cjs           # ESLint flat config
├── commitlint.config.cjs       # Commit lint config
└── package.json
```

## Key File Locations

| Purpose                 | Path                         |
| ----------------------- | ---------------------------- |
| Public API entrypoint   | `src/index.ts`               |
| CLI binary              | `src/bin/mutineer.ts`        |
| Main run coordinator    | `src/runner/orchestrator.ts` |
| Config type definition  | `src/types/config.ts`        |
| All mutant types        | `src/types/mutant.ts`        |
| Mutator registry        | `src/mutators/registry.ts`   |
| Schema generator        | `src/core/schemata.ts`       |
| Vitest adapter factory  | `src/runner/vitest/index.ts` |
| Jest adapter factory    | `src/runner/jest/index.ts`   |
| Shared worker utilities | `src/runner/shared/`         |
| Logger utility          | `src/utils/logger.ts`        |

## Naming Conventions

- **Files:** `kebab-case.ts` throughout. Worker entry points use `.mts` extension (ESM module with explicit extension for Node spawning). Jest resolver uses `.cts` (CommonJS).
- **Test files:** `__tests__/<module>.spec.ts` co-located with the module they test.
- **Factory functions:** `createXAdapter()` pattern for adapters; `makeX()` for internal builders.
- **Types:** PascalCase interfaces; suffix `Config` for config shapes, `Adapter` for adapter interfaces, `Task` for task types.
- **Exports:** Each subdirectory exposes a minimal public surface via `index.ts`; internal helpers are imported directly by path.

## Where to Add New Code

| Task                    | Location                                                                          |
| ----------------------- | --------------------------------------------------------------------------------- |
| New mutator             | `src/mutators/<name>.ts`, register in `src/mutators/registry.ts`                  |
| New test runner adapter | `src/runner/<runner>/` mirroring `vitest/` or `jest/` structure                   |
| New CLI command         | `src/bin/mutineer.ts` routing block                                               |
| New shared type         | `src/types/mutant.ts` or `src/types/config.ts`                                    |
| New utility             | `src/utils/<name>.ts`                                                             |
| New config option       | `src/types/config.ts`, wire up in `src/runner/args.ts` and `src/runner/config.ts` |

---

_Structure analysis: 2026-05-04_
