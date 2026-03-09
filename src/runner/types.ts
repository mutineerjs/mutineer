/**
 * Test Runner Adapter Interface
 *
 * This module defines the interface that all test runner adapters must implement.
 * Adapters abstract test runner-specific details (Vitest, Jest, etc.) from the
 * mutation testing orchestrator.
 */

import type { MutineerConfig } from '../types/config.js'
import type { MutantPayload, MutantRunResult } from '../types/mutant.js'

/**
 * Options for initializing a test runner adapter.
 */
export interface TestRunnerAdapterOptions {
  readonly cwd: string
  readonly concurrency: number
  readonly timeoutMs: number
  readonly config: MutineerConfig
  readonly cliArgs: string[]
}

/**
 * Coverage-related configuration detected from the test runner.
 */
export interface CoverageConfig {
  /** Whether per-test coverage is enabled in the config */
  readonly perTestEnabled: boolean
  /** Whether coverage is enabled in the config */
  readonly coverageEnabled: boolean
}

/**
 * Interface that all test runner adapters must implement.
 *
 * A test runner adapter handles:
 * - Running baseline tests before mutation testing
 * - Running mutant tests (with code substitution)
 * - Managing worker pools for parallel execution
 * - Detecting coverage configuration
 */
export interface TestRunnerAdapter {
  /**
   * The name of the test runner (e.g., 'vitest', 'jest').
   */
  readonly name: string

  /**
   * Initialize the adapter (start worker pools, etc.).
   * Must be called before running tests.
   */
  init(concurrencyOverride?: number): Promise<void>

  /**
   * Run baseline tests to ensure they pass before mutation testing.
   * @param tests - Array of test file paths to run
   * @param options - Options for the baseline run
   * @returns true if all tests pass, false otherwise
   */
  runBaseline(
    tests: readonly string[],
    options: BaselineOptions,
  ): Promise<boolean>

  /**
   * Run a single mutant against its associated tests.
   * @param mutant - The mutation to test
   * @param tests - Array of test file paths to run
   * @returns Result indicating if the mutant was killed, escaped, or errored
   */
  runMutant(
    mutant: MutantPayload,
    tests: readonly string[],
  ): Promise<MutantRunResult>

  /**
   * Shutdown the adapter (stop worker pools, cleanup, etc.).
   */
  shutdown(): Promise<void>

  /**
   * Check if the coverage provider is installed.
   */
  hasCoverageProvider(): boolean

  /**
   * Detect coverage configuration from the test runner config.
   */
  detectCoverageConfig(): Promise<CoverageConfig>
}

/**
 * Options for running baseline tests.
 */
export interface BaselineOptions {
  /** Whether to collect coverage during baseline run */
  readonly collectCoverage: boolean
  /** Whether to collect per-test coverage */
  readonly perTestCoverage: boolean
}

/**
 * Factory function type for creating test runner adapters.
 */
export type TestRunnerAdapterFactory = (
  options: TestRunnerAdapterOptions,
) => TestRunnerAdapter

// Re-export shared mutant types for adapter consumers
export type {
  MutantPayload,
  MutantRunResult,
  MutantRunStatus,
} from '../types/mutant.js'
