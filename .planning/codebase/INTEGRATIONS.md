# External Integrations

**Analysis Date:** 2026-05-04

## APIs & External Services

**None.** Mutineer is a self-contained CLI tool with no outbound HTTP calls to external APIs or SaaS services.

## Data Storage

**Databases:**

- None. No database dependency.

**File Storage:**

- Local filesystem only
  - Mutant schema files written to temp dirs (OS `tmpdir` via `node:os`)
  - Mutation cache stored at `.mutineer-cache/` in consumer project root (`src/runner/cache.ts`)
  - JSON report written to `mutineer-report.json` in cwd when `report: 'json'` is configured (`src/runner/pool-executor.ts`)
  - Coverage JSON read from consumer project (Istanbul format, e.g. `coverage/coverage-final.json`) via `src/runner/coverage-resolver.ts`

**Caching:**

- File-based only: `.mutineer-cache/` directory; keyed by content hash using Node.js `node:crypto` (`src/runner/cache.ts`)

## Authentication & Identity

**Auth Provider:**

- None. No authentication or identity system.

## Monitoring & Observability

**Error Tracking:**

- None. No external error tracking integration.

**Logs:**

- Custom internal logger (`src/utils/logger.ts`) writing to `console.error`/`console.log`
- Debug output gated behind `MUTINEER_DEBUG=1` env var
- No structured logging or external log shipping

## CI/CD & Deployment

**Hosting:**

- npm registry (`https://registry.npmjs.org`) - package published as `@mutineerjs/mutineer`
- GitHub repository: `https://github.com/mutineerjs/mutineer`

**CI Pipeline:**

- GitHub Actions (`.github/workflows/ci.yml`)
  - Runs on push to all branches and PRs to `main`
  - Matrix: Node 20 and Node 22
  - Steps: `npm ci` → lint → build → test
- Automated releases via `googleapis/release-please-action@v4` on `main` push
- npm publish with provenance (`--provenance`) triggered on release creation
  - Auth: `NPM_TOKEN` GitHub Actions secret → `NODE_AUTH_TOKEN` env var
  - Permissions: `id-token: write` for provenance signing

**Dependency Updates:**

- GitHub Dependabot (`.github/dependabot.yml`)
  - Weekly updates for both npm packages and GitHub Actions
  - Groups: production deps and development deps separated

## Environment Configuration

**Required env vars:**

- None required for consumers
- `NPM_TOKEN` - Required in GitHub Actions secrets for npm publish

**Internal runtime env vars (set by mutineer itself, not by users):**

- `MUTINEER_DEBUG` - `'1'` enables debug logging
- `MUTINEER_MUTANT_TIMEOUT_MS` - Per-mutant timeout override
- `MUTINEER_ACTIVE_ID_FILE` - IPC file path between orchestrator and vitest workers
- `MUTINEER_REDIRECT_FROM` / `MUTINEER_REDIRECT_TO` - Jest module redirect env vars for worker processes

**Secrets location:**

- `NPM_TOKEN` stored as GitHub Actions repository secret

## Git Integration

**Direct git subprocess calls:**

- `spawnSync('git', ['merge-base', ...])` and `spawnSync('git', ['diff', '--name-only', ...])` in `src/runner/changed.ts`
- Used by `--changed` and `--changed-with-imports` CLI flags to scope mutations to modified files
- Reads `INIT_CWD` and `PWD` env vars to resolve Git repo root

## Test Runner Integrations

**Vitest (primary):**

- Programmatic integration via `vitest/node` API (`src/runner/vitest/adapter.ts`, `src/runner/vitest/pool.ts`)
- Custom Vitest plugin injected at runtime (`src/runner/vitest/plugin.ts`)
- Custom module redirect loader (`src/runner/vitest/redirect-loader.ts`)
- Worker processes communicate via stdin/stdout JSON protocol

**Jest (secondary):**

- Integration via `@jest/core` `runCLI` API (`src/runner/jest/adapter.ts`, `src/runner/jest/worker-runtime.ts`)
- Module redirect via environment variables (`MUTINEER_REDIRECT_FROM` / `MUTINEER_REDIRECT_TO`)

**TypeScript Compiler API:**

- `typescript` package used at runtime (`src/runner/ts-checker.ts`) for pre-filtering type-invalid mutants
- Spawns worker threads (`node:worker_threads`) to parallelise type checking
- Reads consumer's `tsconfig.json` to replicate strictness settings

**Vue SFC Support:**

- `@vue/compiler-sfc` (optional peer) used to parse `.vue` files (`src/core/sfc.ts`)
- `@vitejs/plugin-vue` (optional peer) for Vue SFC handling within Vite build pipeline

## Webhooks & Callbacks

**Incoming:**

- None

**Outgoing:**

- None

---

_Integration audit: 2026-05-04_
