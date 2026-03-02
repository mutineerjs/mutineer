export interface MutateTargetObject {
  readonly file: string
  /** Auto-detected from file extension if omitted (.vue = 'vue:script-setup', else 'module') */
  readonly kind?: 'vue:script-setup' | 'module'
}

/** Target can be a simple path string or an object with file and optional kind */
export type MutateTarget = string | MutateTargetObject

export interface MutineerConfig {
  readonly targets?: readonly MutateTarget[]
  /** Mutator names to include (e.g., ['flipStrictEQ', 'andToOr']) */
  readonly include?: readonly string[]
  /** Mutator names to exclude (e.g., ['relaxGE']) */
  readonly exclude?: readonly string[]
  /** Glob patterns for paths to exclude from mutation (e.g., ['admin/**']) */
  readonly excludePaths?: readonly string[]
  readonly maxMutantsPerFile?: number
  readonly source?: string | readonly string[]
  readonly baseRef?: string
  readonly testPatterns?: readonly string[]
  readonly extensions?: readonly string[]
  readonly autoDiscover?: boolean
  /**
   * Control how Vitest output is handled for mutant runs:
   * - 'mute' (default) suppresses all output
   * - 'minimal' echoes only pass/fail summaries
   * - 'inherit' streams full Vitest output to the CLI
   */
  readonly mutantOutput?: 'mute' | 'minimal' | 'inherit'
  readonly minKillPercent?: number
  /** Preferred test runner (defaults to vitest) */
  readonly runner?: 'vitest' | 'jest'
  readonly vitestConfig?: string
  readonly jestConfig?: string
  /** Max depth for dependency resolution with --changed-with-deps (default: 1) */
  readonly dependencyDepth?: number
  /** Path to coverage JSON file (Istanbul format, e.g., coverage/coverage-final.json) */
  readonly coverageFile?: string
  /** Only mutate lines that are covered by tests (requires coverageFile) */
  readonly onlyCoveredLines?: boolean
  /** Request a coverage-instrumented baseline run (implies per-test coverage if available) */
  readonly coverage?: boolean
  /**
   * Enable per-test coverage collection during the baseline run.
   * When enabled, Mutineer will try to run only the tests that actually cover a mutated line.
   * Requires Vitest coverage with perTest support.
   */
  readonly perTestCoverage?: boolean
}
