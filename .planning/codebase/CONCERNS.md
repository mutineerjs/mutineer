<!-- refreshed: 2026-05-04 -->

# Concerns

**Analysis Date:** 2026-05-04

## High Severity

### 1. `return undefined!` in mutator utils

**File:** `src/mutators/utils.ts:231,236`
**Issue:** Non-null assertion on `undefined` fools the TypeScript type system. Callers receive `undefined` where `TokenLike` is expected, causing silent wrong mutation positions.
**Risk:** Incorrect mutation location data silently propagates into generated mutants.

### 2. `waitingTasks` never flushed on pool shutdown

**Files:** `src/runner/vitest/pool.ts`, `src/runner/jest/pool.ts`
**Issue:** Callers awaiting `acquireWorker()` hang forever if `shutdown()` is called while tasks are queued in the waiting list. The waiting queue is drained on worker release but not on shutdown.
**Risk:** Processes can hang indefinitely on SIGINT/SIGTERM during high-concurrency runs.

### 3. `isFallback` default-true inversion in pool executor

**File:** `src/runner/pool-executor.ts:155`
**Issue:** When `fallbackIds` is `undefined`, all mutants silently get `isFallback: true`, disabling the fast schema path entirely and forcing all mutants through the slower redirect path.
**Risk:** Significant performance regression if `fallbackIds` is not passed correctly.

## Medium Severity

### 4. `process.exitCode` as cross-module flow control

**Files:** `src/runner/coverage-resolver.ts`, `src/runner/orchestrator.ts`
**Issue:** `process.exitCode` is set in one module and checked in another as a signal to short-circuit execution. Any intervening code that also sets `process.exitCode` can cause false-positive early returns.
**Risk:** Silent partial runs if a library or hook sets exitCode before orchestrator checks it.

### 5. Vitest internals accessed via `as any`

**File:** `src/runner/vitest/worker-runtime.ts`
**Issue:** Private API fields (`watcher.invalidates`, `state.filesMap`, etc.) accessed via `as any` casts. These fields are not part of Vitest's public API.
**Risk:** Silent breakage on Vitest major/minor upgrades without TypeScript errors to surface it.

### 6. `redirect-loader.ts` duplicates `redirect-state.ts` logic

**Files:** `src/runner/vitest/redirect-loader.ts`, `src/runner/shared/redirect-state.ts`
**Issue:** Logic for reading/setting the redirect state is duplicated across these two files and must be kept in sync manually.
**Risk:** Divergence causes silent redirect failures where mutants are not intercepted correctly.

### 7. Stray `console.log` bypassing structured logger

**File:** `src/core/sfc.ts:132`
**Issue:** Direct `console.log` call bypasses the `createLogger()` system. Pollutes stdout unconditionally regardless of `MUTINEER_DEBUG` setting.
**Risk:** Unexpected output in CLI users' terminals; can break stdout-parsing integrations.

## Low Severity / Tech Debt

### 8. Unresolved `@todo` in discovery crawler

**File:** `src/runner/discover.ts:354`
**Issue:** Unverified suspicion that the import crawl may visit `node_modules` files as mutation targets. Not confirmed but not ruled out.
**Risk:** Could generate thousands of spurious mutants from third-party code if triggered.

### 9. Cloud runner stubs non-functional

**Directories:** `src/runner/cloud/`, `src/server/`
**Issue:** Both directories contain only empty `__tests__/` directories. Plan documents (`CLOUD_RUNNER_PLAN.md`, `CLOUD_RUNNER_SERVER_PLAN.md`) describe these as stubs with multiple TODOs. No implementation exists.
**Risk:** Not a runtime risk, but creates misleading directory structure suggesting functionality that does not exist.

### 10. `tsx` in production `dependencies`

**File:** `package.json`
**Issue:** `tsx` is listed as a production dependency rather than `devDependencies`. It is only needed for running the CLI from source during development (`npm run mutate`) and for optional worker script resolution.
**Risk:** Inflates install size for all end users of the package.

### 11. Experimental Node.js flags in worker spawning

**Files:** `src/runner/vitest/pool.ts`, `src/runner/jest/pool.ts`
**Issue:** Workers are spawned with `--experimental-strip-types` (Node.js experimental feature). May break on future Node versions if the flag is removed or behavior changes.
**Risk:** Worker spawning breaks silently on Node.js version upgrades.

## Coverage Gaps

- **Coverage threshold is 60%** — relatively low for a testing tool that others rely on for correctness guarantees.
- `src/bin/**` is excluded from coverage metrics entirely.
- Worker runtime files (`worker-runtime.ts`) are harder to unit-test (integration tests would be more effective).

---

_Concerns analysis: 2026-05-04_
