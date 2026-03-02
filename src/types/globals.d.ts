// ensure this file is included by tsconfig "include"
import 'vitest'

declare global {
  // make vitest globals visible to TS and assignable
  let it: (typeof import('vitest'))['it']
  let test: (typeof import('vitest'))['test']
  let describe: (typeof import('vitest'))['describe']
}

export {}
