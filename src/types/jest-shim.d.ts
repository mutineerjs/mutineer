declare module '@jest/core' {
  export function runCLI(
    argv: Record<string, unknown>,
    projects: readonly string[],
    options?: Record<string, unknown>,
  ): Promise<{
    results: {
      success: boolean
      testResults?: Array<{ failureMessage?: string | null }>
    }
  }>
}
