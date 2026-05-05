# Mutineer — High Severity Bug Fixes

## What This Is

Mutineer is a mutation testing CLI for JavaScript and TypeScript projects, supporting Vitest and Jest. It applies AST-level source mutations, runs tests against each mutant via persistent worker pools, and reports killed/escaped/timeout results. v1.0 shipped four targeted correctness fixes: accurate mutation byte offsets, clean worker pool shutdown, and correct fast-path routing.

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
- ✓ **CORR-01**: `findTokenForNode` returns valid `TokenLike` (MISSING_TOKEN sentinel) — v1.0
- ✓ **CORR-02**: VitestPool rejects all `waitingTasks` with `ShutdownError` on shutdown — v1.0
- ✓ **CORR-03**: JestPool rejects all `waitingTasks` with `ShutdownError` on shutdown — v1.0
- ✓ **CORR-04**: Pool executor defaults `isFallback` to `false` when `fallbackIds` is `undefined` — v1.0

### Active

- [ ] **QUAL-01**: Raise coverage threshold from 60% to 80%
- [ ] **QUAL-02**: Fix `process.exitCode` used as cross-module flow control
- [ ] **QUAL-03**: Encapsulate Vitest internals accessed via `as any`
- [ ] **QUAL-04**: Deduplicate redirect-loader / redirect-state logic
- [ ] **QUAL-05**: Replace stray `console.log` in `src/core/sfc.ts:132` with structured logger

### Out of Scope

- Medium severity issues (exitCode flow control, Vitest internals, redirect duplication, console.log) — deferred, not correctness-critical
- Cloud runner implementation — separate initiative tracked in `CLOUD_RUNNER_PLAN.md`
- Coverage threshold increase — separate quality initiative
- New features or mutators — out of scope for bug-fix milestone

## Context

**Current state:** v1.0 shipped 2026-05-05. All four correctness bugs resolved. Codebase has 8 modified files, 883 tests passing across 42 files, build clean. Tech stack: TypeScript ESM, Node.js, Vitest, Jest.

**Next milestone candidates:** Quality improvements (QUAL-01 through QUAL-05), cloud runner implementation, or new mutator types.

Codebase map completed 2026-05-04 (`/gsd-map-codebase`). Three prior feature phases (DX fixes, new features, performance) are fully shipped. Cloud runner design is complete with stubs in place but no implementation.

## Constraints

- **Tech stack**: TypeScript ESM, pure Node built-ins — no new runtime dependencies
- **Test coverage**: CLAUDE.md requires all changed lines covered in vitest unit tests; mutations must be assessed
- **Build**: Any change to `src/` must pass `npm run build`
- **Commits**: No co-authored commits

## Key Decisions

| Decision                                         | Rationale                                                                       | Outcome      |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | ------------ |
| Fix only high severity                           | Minimise scope; medium issues don't risk silent incorrect output                | ✓ Good — clean, focused milestone |
| Fix BUG-03 by changing `?? true` to `?? false`   | `fallbackIds` being `undefined` should mean "no fallbacks", not "all fallbacks" | ✓ Good — one-token fix, all tests pass |
| Fix BUG-02 by rejecting waitingTasks on shutdown | Rejection propagates cleanly; callers can handle the error rather than hanging  | ✓ Good — ShutdownError pattern adopted for both pool types |
| MISSING_TOKEN sentinel (not null/undefined)      | Callers can identity-check without crashing; three guard sites protect callsites | ✓ Good — cleaner than throwing, safer than null |

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

_Last updated: 2026-05-05 after v1.0 milestone_
