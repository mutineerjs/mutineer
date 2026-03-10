# Vitest Example

Minimal Vitest + TypeScript project wired for Mutineer.

## Setup

```bash
cd examples/vitest
npm install
```

## Run tests

```bash
npm test
```

## Run Mutineer

Build Mutineer in the repo root, then run the sample:

```bash
cd ../..
npm run build:cli
cd examples/vitest
npm run mutate
```

## See a surviving mutant in action

`src/calc.ts` contains an `isAdult` function with a boundary condition (`>=`) that
Mutineer will mutate to `>`. The tests in `__tests__/calc.test.ts` only check ages
`20` and `15`, so the mutant survives — Mutineer will report it as **escaped**.

To kill it, open `__tests__/calc.test.ts` and uncomment this line inside the
`'identifies adults'` test:

```ts
// expect(isAdult(18)).toBe(true)
```

Run `npm run mutate` again. The boundary test now catches the `>=` → `>` mutation
and Mutineer will report it as **killed**.
