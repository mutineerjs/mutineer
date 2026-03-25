/**
 * Represents a pending async task in a worker pool.
 * Shared by Vitest and Jest pool implementations.
 */
export interface PendingTask<TResult> {
  resolve: (result: TResult) => void
  reject: (error: Error) => void
  timeoutHandle: NodeJS.Timeout | null
}
