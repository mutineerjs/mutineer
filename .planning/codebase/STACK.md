# Technology Stack

**Analysis Date:** 2026-05-04

## Languages

**Primary:**

- TypeScript 5.5+ - All source code under `src/`
- TSX (React JSX) - Terminal UI components (`src/utils/PoolSpinner.tsx`, `src/utils/ProgressBar.tsx`)

**Secondary:**

- JavaScript (CJS) - Config files only (`eslint.config.cjs`, `commitlint.config.cjs`)

## Runtime

**Environment:**

- Node.js >=20 (required); tested on 20 and 22 in CI

**Package Manager:**

- npm 10.9.x
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**

- None (framework-free Node.js CLI library)

**Terminal UI:**

- `ink` ^7.0.0 - React-based terminal rendering (`src/utils/PoolSpinner.tsx`, `src/runner/pool-executor.ts`, `src/runner/orchestrator.ts`)
- `ink-spinner` ^5.0.0 - Spinner widget for ink
- `react` ^19.2.4 - Required peer for ink (JSX transform: `react-jsx` per `tsconfig.json`)

**Testing:**

- `vitest` ^4.0.18 (peer/devDep) - Test runner, configured at `vitest.config.ts`
- `@vitest/coverage-v8` ^4.0.15 - Coverage provider
- `jsdom` ^28.1.0 - DOM environment for tests that need it

**Build/Dev:**

- `typescript` ^5.5.4 - `tsc` compiles `src/` → `dist/`; config at `tsconfig.json`
- `tsx` ^4.21.0 - Runs `.ts` files directly (used in `mutate` npm script)
- `vite` ^7.3.1 (peer) - Used at runtime to load `.ts` config files via `loadConfigFromFile`; optional, falls back to `jiti`

## Key Dependencies

**Critical:**

- `@babel/parser` ^7.29.0 - Parses JS/TS source into AST (`src/core/schemata.ts`, `src/mutators/utils.ts`)
- `@babel/traverse` ^7.29.0 - AST traversal for mutation targeting (`src/mutators/utils.ts`)
- `@babel/types` ^7.28.4 - AST node type helpers (`src/core/schemata.ts`, `src/mutators/`)
- `magic-string` ^0.30.9 - Source-map-aware string mutation (`src/core/schemata.ts`, `src/core/sfc.ts`)
- `fast-glob` ^3.3.3 - Glob-based file discovery (`src/runner/discover.ts`)
- `typescript` ^5.5.4 (also devDep) - Used at runtime for type-checking mutants via the TS compiler API (`src/runner/ts-checker.ts`)

**Terminal/Output:**

- `chalk` ^5.6.2 - Terminal colour (`src/utils/`)
- `slice-ansi` ^9.0.0 - Slice ANSI-coloured strings
- `strip-ansi` (transitive, used via import) - Strip ANSI codes

**Infrastructure:**

- `tsx` ^4.21.0 - TS script runner (dev `mutate` script, not bundled into dist)

## Configuration

**Environment:**

- No `.env` files present
- Runtime configuration via `mutineer.config.ts` / `.js` / `.mjs` in project root
- Key env vars (internal use only):
  - `MUTINEER_DEBUG=1` - Enable debug logging (`src/utils/logger.ts`)
  - `MUTINEER_MUTANT_TIMEOUT_MS` - Override per-mutant timeout (`src/runner/orchestrator.ts`)
  - `MUTINEER_ACTIVE_ID_FILE` - IPC between orchestrator and vitest workers
  - `MUTINEER_REDIRECT_FROM` / `MUTINEER_REDIRECT_TO` - Jest module redirect (`src/runner/jest/worker-runtime.ts`)

**Build:**

- `tsconfig.json` - Strict TypeScript; target ES2021, module ES2022, `rootDir: src`, `outDir: dist`, JSX react-jsx
- `eslint.config.cjs` - ESLint flat config (v9+) with `@typescript-eslint` recommended rules; no semicolons enforced
- `.prettierrc` - No semis, single quotes, 2-space indent, 80-char print width, trailing commas
- `vitest.config.ts` - Node environment, globals, coverage thresholds 60% (lines/functions/branches/statements)
- `commitlint.config.cjs` - Conventional commits enforced via `@commitlint/config-conventional`

## Platform Requirements

**Development:**

- Node.js >=20
- npm (lockfile committed)
- Git (required for `--changed` mode; `spawnSync('git', ...)` calls in `src/runner/changed.ts`)
- `vite` or `jiti` installed in consumer project (to load `.ts` config files)

**Production:**

- Distributed as ESM package via npm (`@mutineerjs/mutineer`)
- Published to npmjs.org registry with provenance (`npm publish --provenance`)
- Entry: `dist/index.js` (types: `dist/index.d.ts`), CLI binary: `dist/bin/mutineer.js`
- Peer dependencies required in consumer: `vitest` or `jest`, `vite` or `jiti` (optional), `@vitest/coverage-v8` (optional), Vue plugins (optional)

---

_Stack analysis: 2026-05-04_
