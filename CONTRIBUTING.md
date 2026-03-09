# Contributing to Mutineer

Thanks for your interest in contributing to Mutineer! This guide will help you get started.

## Prerequisites

- Node.js >= 20
- npm

## Getting Started

```bash
# Clone the repo
git clone https://github.com/mutineerjs/mutineer.git
cd mutineer

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Development Workflow

1. Create a branch from `main` for your change.
2. Make your changes with tests where applicable.
3. Run `npm run lint` and `npm test` to verify everything passes.
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat: add new mutation operator`
   - `fix: correct AST traversal for ternaries`
   - `docs: update configuration examples`
   - `test: add coverage for edge case`
   - `chore: update dependencies`
5. Open a pull request against `main`.

## Project Structure

- `src/` — Source code
- `src/runner/` — Test runner adapters (Vitest, Jest)
- `src/mutators/` — Mutation operators
- `examples/` — Example projects

## Scripts

| Command                 | Description             |
| ----------------------- | ----------------------- |
| `npm run build`         | Compile TypeScript      |
| `npm run dev`           | Watch mode compilation  |
| `npm test`              | Run tests once          |
| `npm run test:watch`    | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint`          | Lint source files       |

## Git Hooks

This project uses [Husky](https://typicode.github.io/husky/) to run Git hooks automatically:

- **Pre-commit** — Runs [lint-staged](https://github.com/lint-staged/lint-staged) to auto-fix and format staged files with ESLint and Prettier.
- **Commit message** — Validates your commit message against the [Conventional Commits](https://www.conventionalcommits.org/) spec using [commitlint](https://commitlint.js.org/). Commits that don't follow the format will be rejected.

Hooks are installed automatically when you run `npm install`.

## Code Style

- Code is formatted with Prettier and linted with ESLint.
- Pre-commit hooks enforce linting and formatting automatically.
- No semicolons, single quotes, trailing commas.

## Releases

Releases are fully automated via [release-please](https://github.com/googleapis/release-please):

1. When `feat:` or `fix:` commits are pushed to `main`, release-please opens (or updates) a release PR that bumps the version and updates the changelog.
2. Merging the release PR creates a GitHub Release with a git tag.
3. The release triggers an automated publish to npm via trusted publishing (OIDC).

You do not need to manually update `package.json` version or `CHANGELOG.md` — release-please handles both.

## Reporting Issues

- Use the [bug report template](https://github.com/mutineerjs/mutineer/issues/new?template=bug_report.md) for bugs.
- Use the [feature request template](https://github.com/mutineerjs/mutineer/issues/new?template=feature_request.md) for ideas.
