# Mutineer — High Severity Bug Fixes

## What This Is

Mutineer is a mutation testing CLI for JavaScript and TypeScript projects, supporting Vitest and Jest. It applies AST-level source mutations, runs tests against each mutant via persistent worker pools, and reports killed/escaped/timeout results. This milestone targets three high-severity bugs identified by codebase analysis that risk silent incorrect output, indefinite process hangs, and silent performance regressions.

## Core Value

Mutation results must be correct and the process must exit cleanly — wrong positions or hung processes undermine every test suite that relies on mutineer.

## Requirements

### Validated

- ✓ CLI entry point (`mutineer run / init / clean / auth / server`) — existing
- ✓ Vitest and Jest adapter support via `TestRunnerAdapter` interface — existing
- ✓ Schema path (ternary embedding) as default mutant activation — existing
- ✓ Redirect path (file swap + ESM loader) as fallback — existing
- ✓ Persistent worker pool with concurrency control — existing
- ✓ Content-addressed cache (`.mutineer-cache.json`) — existing
- ✓ Coverage-pruned task scheduling — existing
- ✓ JSON and text summary reporters — existing
- ✓ `--shard n/N` flag for distributed runs — existing
- ✓ Cloud runner stubs (`src/runner/cloud/`, `src/server/`) — existing (incomplete)
- ✓ `--changed-with-deps`, `--timeout`, `--report` CLI flags — existing

### Active

- [ ] **BUG-01**: Fix `return undefined!` non-null assertion in `src/mutators/utils.ts:231,236` — callers receive `undefined` where `TokenLike` is expected, producing silent wrong mutation positions
- [ ] **BUG-02**: Flush `waitingTasks` on pool shutdown in `src/runner/vitest/pool.ts` and `src/runner/jest/pool.ts` — tasks queued in the waiting list hang forever when `shutdown()` is called
- [ ] **BUG-03**: Fix `isFallback` default-true inversion in `src/runner/pool-executor.ts:155` — when `fallbackIds` is `undefined`, all mutants silently use the slower redirect path instead of the schema path

### Out of Scope

- Medium severity issues (exitCode flow control, Vitest internals, redirect duplication, console.log) — deferred, not correctness-critical
- Cloud runner implementation — separate initiative tracked in `CLOUD_RUNNER_PLAN.md`
- Coverage threshold increase — separate quality initiative
- New features or mutators — out of scope for bug-fix milestone

## Context

Codebase map completed 2026-05-04 (`/gsd-map-codebase`). Three prior feature phases (DX fixes, new features, performance) are fully shipped. Cloud runner design is complete with stubs in place but no implementation.

**BUG-01 details:** `src/mutators/utils.ts` has two `return undefined!` statements. The `!` non-null assertion tells TypeScript the return is `TokenLike` but the runtime value is `undefined`. Callers use this to compute mutation byte offsets — wrong positions silently corrupt generated mutants.

**BUG-02 details:** `acquireWorker()` pushes to `this.waitingTasks` when all workers are busy. `releaseWorker()` drains the queue on each release. But `shutdown()` kills workers without draining `waitingTasks`, leaving any queued callers permanently suspended. Observed on SIGINT during high-concurrency runs.

**BUG-03 details:** `pool-executor.ts:155` does `isFallback: fallbackIds?.has(task.id) ?? true`. When `fallbackIds` is `undefined` the `??` short-circuits to `true`, marking every mutant as fallback. This disables the fast schema path entirely, routing all mutants through the slower file-redirect path with no warning.

## Constraints

- **Tech stack**: TypeScript ESM, pure Node built-ins — no new runtime dependencies
- **Test coverage**: CLAUDE.md requires all changed lines covered in vitest unit tests; mutations must be assessed
- **Build**: Any change to `src/` must pass `npm run build`
- **Commits**: No co-authored commits

## Key Decisions

| Decision                                         | Rationale                                                                       | Outcome   |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | --------- |
| Fix only high severity                           | Minimise scope; medium issues don't risk silent incorrect output                | — Pending |
| Fix BUG-03 by changing `?? true` to `?? false`   | `fallbackIds` being `undefined` should mean "no fallbacks", not "all fallbacks" | — Pending |
| Fix BUG-02 by rejecting waitingTasks on shutdown | Rejection propagates cleanly; callers can handle the error rather than hanging  | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-05-04 after initialization_
