# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Text style

- No em dashes.

## Unit tests

- Any lines changed should be covered in vitest unit tests.
- Mutations should be assessed.

## Changes

- Any changes to src directory files should include a npm run build command to ensure nothing was broken.

## Commits

- Do not co-author commits.

## Plans

- Make the plan extremely concise. Sacrifice grammar for the sake of concision.
- At the end of each plan, give me a list of unresolved questions to answer, if any.

## GSD Workflow

Planning artifacts live in `.planning/` (git-ignored).

- Project context: `.planning/PROJECT.md`
- Requirements: `.planning/REQUIREMENTS.md`
- Roadmap: `.planning/ROADMAP.md`
- Execution state: `.planning/STATE.md`
- Config: `.planning/config.json`

Run `/gsd-plan-phase 1` to begin Phase 1 (Fix High Severity Bugs).
