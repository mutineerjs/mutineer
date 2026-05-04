<!-- refreshed: 2026-05-04 -->

# Conventions

**Analysis Date:** 2026-05-04

## Language & Runtime

- TypeScript 5.x, strict mode implied by project config
- Pure ESM (`"type": "module"`); all imports use `.js` extension for `.ts` source files
- Node.js >=20 required; uses native ESM loader, `--experimental-strip-types` for worker spawning
- Worker entry points use `.mts` extension; Jest resolver uses `.cts` (CommonJS module)

## Code Style

**Formatting:** Prettier enforced via lint-staged pre-commit hook on `src/**/*.ts`.

**Linting:** ESLint v10 with `@typescript-eslint` recommended rules. Flat config in `eslint.config.cjs`. Auto-fix on commit.

**File naming:** `kebab-case.ts` throughout. No PascalCase filenames (except Ink React components: `PoolSpinner.tsx`, `ProgressBar.tsx`).

**Imports:** Named imports preferred over default imports. Barrel `index.ts` files used for subpackage surfaces but internal files import by direct path.

## Naming Conventions

| Construct    | Convention                          | Example                                     |
| ------------ | ----------------------------------- | ------------------------------------------- |
| Variables    | camelCase                           | `testMap`, `fallbackIds`                    |
| Functions    | camelCase                           | `createVitestAdapter()`, `generateSchema()` |
| Interfaces   | PascalCase                          | `TestRunnerAdapter`, `MutantPayload`        |
| Type aliases | PascalCase                          | `MutantStatus`, `MutateTarget`              |
| Enums        | Not used; prefer string union types | `'killed' \| 'escaped' \| 'timeout'`        |
| Constants    | camelCase (no ALL_CAPS)             | `log`, `registry`                           |
| Factory fns  | `createX()` or `makeX()`            | `createLogger()`, `makeOperatorMutator()`   |

## Patterns

**Factory functions over classes.** Adapters, loggers, pools are all created by plain functions returning interface-conforming objects. No class-based OOP.

**Plain object implementations.** `ASTMutator` and `TestRunnerAdapter` are interfaces implemented as plain objects. No inheritance.

**Readonly collections.** Public-facing mutation outputs (`MutationOutput[]`, `MutationVariant[]`) use `readonly` arrays.

**`src/runner/shared/`** contains utilities shared between the Vitest and Jest worker paths to avoid duplication.

**Schema path first, redirect fallback.** Schema generation (ternary embedding) is preferred; redirect loader (file swap) is the fallback for Vue templates and overlapping diffs. `fallbackIds: Set<string>` tracks which mutants use the redirect path.

## Error Handling

- Orchestrator sets `process.exitCode = 1` on fatal errors rather than throwing from `main()`.
- Per-file enumeration errors are caught and silently yield `[]` (file is skipped).
- Per-file schema generation failures fall back to the redirect path.
- Worker process crashes / unexpected exits are caught via `PendingTask` rejection in the pool.
- Worker timeouts: `SIGKILL` the process group, resolve with `{ status: 'timeout' }`, restart worker.
- Signal handling (`SIGINT`/`SIGTERM`): graceful finish then cleanup in `src/runner/pool-executor.ts`.
- `toErrorMessage()` in `src/utils/errors.ts` is the canonical way to convert `unknown` caught values to strings.

## Logging

```ts
import { createLogger } from '../utils/logger.js'
const log = createLogger('my-scope')
log.debug('msg', ...args) // only when MUTINEER_DEBUG=1
log.info('msg') // stdout
log.warn('msg') // stderr
log.error('msg') // stderr
```

- Debug output is gated by `MUTINEER_DEBUG=1` env var (`src/utils/logger.ts:1`).
- Structured per-scope prefix: `[scope] message`.
- No `console.log` in production code (a stray one exists in `src/core/sfc.ts:132` — known issue).

## TypeScript Practices

- Interfaces preferred over type aliases for object shapes.
- `readonly` used on interface properties for data types that should not be mutated.
- No runtime schema validation library; config validation is TypeScript-only.
- `as any` used in `src/runner/vitest/worker-runtime.ts` to access Vitest private internals — intentional workaround, flagged as a concern.
- `return undefined!` pattern in `src/mutators/utils.ts:231,236` is a known anti-pattern — see CONCERNS.md.

## Commit Conventions

Conventional Commits enforced via `@commitlint/config-conventional` and a commit-msg hook.
Format: `type(scope): description` — e.g., `fix: fallback to jiti`, `chore(main): release 0.12.2`.

---

_Conventions analysis: 2026-05-04_
