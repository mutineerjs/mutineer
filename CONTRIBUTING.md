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

## Code Style

- Code is formatted with Prettier and linted with ESLint.
- Pre-commit hooks enforce linting and formatting automatically.
- No semicolons, single quotes, trailing commas.

## Reporting Issues

- Use the [bug report template](https://github.com/mutineerjs/mutineer/issues/new?template=bug_report.md) for bugs.
- Use the [feature request template](https://github.com/mutineerjs/mutineer/issues/new?template=feature_request.md) for ideas.
