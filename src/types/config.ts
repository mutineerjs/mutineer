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
  /** Per-mutant test timeout in milliseconds (default: 30000) */
  readonly timeout?: number
  /** Output report format: 'text' (default) or 'json' (writes mutineer-report.json) */
  readonly report?: 'text' | 'json'
  /**
   * Enable TypeScript type checking to pre-filter mutants that produce compile errors.
   * true = enable (requires tsconfig.json), false = disable,
   * object = enable with optional custom tsconfig path.
   * Defaults to auto-detect (enabled if tsconfig.json found in cwd).
   */
  readonly typescript?: boolean | { readonly tsconfig?: string }
  /**
   * Filter mutations to a specific Vitest workspace project.
   * Requires a vitest.config.ts with test.projects configured.
   */
  readonly vitestProject?: string | readonly string[]
}
