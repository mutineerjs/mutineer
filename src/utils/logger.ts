export const DEBUG = process.env.MUTINEER_DEBUG === '1'

export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

export function createLogger(tag: string): Logger {
  return {
    debug(msg: string, ...args: unknown[]) {
      if (DEBUG) console.error(`[${tag}] ${msg}`, ...args)
    },
    info(msg: string, ...args: unknown[]) {
      console.log(msg, ...args)
    },
    warn(msg: string, ...args: unknown[]) {
      console.warn(msg, ...args)
    },
    error(msg: string, ...args: unknown[]) {
      console.error(msg, ...args)
    },
  }
}
