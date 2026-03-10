# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode

# Test
npm test             # Run Vitest test suite
npm run test:coverage  # With coverage report

# Lint & Format
npm run lint         # ESLint
npx prettier --write .  # Format code

# Self-mutation testing
npm run mutate       # Run mutineer on itself

# CLI (after build)
npx mutineer run
npx mutineer init
npx mutineer clean
```

**Run a single test file:**

```bash
npx vitest run src/core/__tests__/module.spec.ts
```

Tests live at `src/**/__tests__/**/*.spec.ts`.

## Architecture

Mutineer is a mutation testing framework for Vitest and Jest. It injects mutations at runtime (no disk writes) via Vite plugins / Jest resolvers.

**Layered flow:**

1. **CLI** (`src/bin/mutineer.ts`) — Routes `init`, `run`, `clean` commands
2. **Orchestrator** (`src/runner/orchestrator.ts`) — Main workflow: load config → discover targets/tests → run baseline → enumerate mutants → execute pool → report
3. **Discovery** (`src/runner/discover.ts`) — Crawls import graphs to build a `target → covering tests` map
4. **Mutation generation** (`src/core/module.ts`, `src/core/sfc.ts`) — Uses Babel AST + `magic-string` to generate mutated source variants. Vue SFC `<script setup>` is supported via `sfc.ts`
5. **Mutators** (`src/mutators/`) — 22 mutators across 6 categories (equality, boundary, logical, arithmetic, return values). All registered in `registry.ts`; individual mutators use `makeOperatorMutator()` from `operator.ts`
6. **Pool executor** (`src/runner/pool-executor.ts`) — Manages concurrent workers, progress UI (Ink/React), and SIGINT shutdown
7. **Adapters** — `src/runner/vitest/` and `src/runner/jest/` each implement `TestRunnerAdapter`. The Vitest adapter uses a Vite plugin (`plugin.ts`) + ESM redirect loader; the Jest adapter uses a custom resolver (`resolver.cts`)
8. **Shared runtime** (`src/runner/shared/redirect-state.ts`) — Holds the currently-active mutation substitution; workers read this to inject the right mutated code without touching the filesystem

**Key types** (`src/types/`):

- `MutineerConfig` — user config shape
- `MutantStatus`: `'killed' | 'escaped' | 'skipped' | 'error' | 'timeout'`
- `Variant` — a mutant + its covering tests
- `TestRunnerAdapter` — interface both Vitest and Jest adapters implement

## Code Style

- No semicolons, single quotes, trailing commas (see `.prettierrc`)
- Strict TypeScript — no unused vars/params
- ESLint flat config (`eslint.config.cjs`); test files have relaxed rules for mocking
- Conventional Commits enforced via commitlint + Husky

## Unit tests

- Any lines changed shoud be covered in vitest unit tests.
- Mutations should be assessed.

## Plans

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any.
