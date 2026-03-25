const COMMON_CONSUME_NEXT = new Set([
  '--concurrency',
  '--progress',
  '--min-kill-percent',
  '--config',
  '-c',
  '--coverage-file',
  '--report',
])

const COMMON_DROP_EXACT = new Set([
  '-m',
  '--mutate',
  '--changed',
  '--changed-with-imports',
  '--full',
  '--only-covered-lines',
  '--per-test-coverage',
  '--perTestCoverage',
])

const COMMON_DROP_PREFIXES = ['--min-kill-percent=', '--config=', '-c=']

export interface StripMutineerArgsOptions {
  /** Runner-specific args that consume the next token and should be dropped. */
  extraConsumeNext?: Iterable<string>
  /** Runner-specific prefixes whose matching args should be dropped. */
  extraPrefixes?: string[]
}

/**
 * Strip mutineer-specific CLI args that shouldn't be passed to the underlying
 * test runner. Callers may supply runner-specific extras via options.
 */
export function stripMutineerArgs(
  args: string[],
  options: StripMutineerArgsOptions = {},
): string[] {
  const consumeNext = options.extraConsumeNext
    ? new Set([...COMMON_CONSUME_NEXT, ...options.extraConsumeNext])
    : COMMON_CONSUME_NEXT
  const extraPrefixes = options.extraPrefixes ?? []

  const allPrefixes = extraPrefixes.length
    ? [...COMMON_DROP_PREFIXES, ...extraPrefixes]
    : COMMON_DROP_PREFIXES

  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (COMMON_DROP_EXACT.has(a)) continue
    if (consumeNext.has(a)) {
      i++
      continue
    }
    if (allPrefixes.some((p) => a.startsWith(p))) continue
    out.push(a)
  }
  return out
}
