#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { createRequire } from 'node:module'
import { runOrchestrator } from '../runner/orchestrator.js'
import { cleanupMutineerDirs } from '../runner/cleanup.js'

// Constants
const RUN_COMMAND = 'run'
const CLEAN_COMMAND = 'clean'
const INIT_COMMAND = 'init'
export const HELP_TEXT = `\
Usage: mutineer <command> [options]

Commands:
  init       Create a mutineer.config.ts template
  run        Run mutation testing
  clean      Remove __mutineer__ temp directories

Options (run):
  --config, -c <path>       Config file path
  --concurrency <n>         Worker count (default: CPU count - 1)
  --runner <vitest|jest>    Test runner (default: vitest)
  --progress <bar|list|quiet>  Progress display (default: bar)
  --changed                 Mutate only git-changed files
  --changed-with-deps       Mutate changed files + their local dependencies
  --full                    Mutate full codebase, skipping confirmation prompt
  --only-covered-lines      Mutate only lines covered by tests
  --per-test-coverage       Collect per-test coverage data
  --coverage-file <path>    Path to coverage JSON
  --min-kill-percent <n>    Minimum kill % threshold (0–100)
  --timeout <ms>            Per-mutant test timeout in ms (default: 30000)
  --report <text|json>      Output format: text (default) or json (writes mutineer-report.json)
  --shard <n>/<total>       Run a shard of mutants (e.g. --shard 1/4)
  --skip-baseline           Skip the baseline test run
  --vitest-project <name>   Filter to a specific Vitest workspace project
  --typescript              Enable TS type-check pre-filtering
  --no-typescript           Disable TS type-check pre-filtering

  --help, -h                Show this help
  --version, -V             Show version
`

export function getVersion(): string {
  const require = createRequire(import.meta.url)
  return require('../../package.json').version
}

const CONFIG_TEMPLATE = `\
import { defineMutineerConfig } from 'mutineer'

export default defineMutineerConfig({
  source: 'src',
})
`

const FULL_RUN_WARNING = `
Warning: Running on the full codebase may take a while.

  [1] Continue (full codebase)
  [2] --changed          (git-changed files only)
  [3] --changed-with-deps (changed + their local deps)
  [4] Abort

`

/**
 * When running in full-codebase mode on an interactive TTY, warn the user and
 * let them narrow scope or abort. Returns args (possibly with a flag appended).
 */
export async function confirmFullRun(args: string[]): Promise<string[]> {
  const isFullRun =
    !args.includes('--changed') && !args.includes('--changed-with-deps')
  if (!isFullRun || !process.stdin.isTTY || args.includes('--full')) return args

  process.stdout.write(FULL_RUN_WARNING)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    const ask = (): void => {
      rl.question('Choice [1]: ', (answer) => {
        const choice = answer.trim() || '1'
        if (choice === '1') {
          rl.close()
          resolve(args)
        } else if (choice === '2') {
          rl.close()
          resolve([...args, '--changed'])
        } else if (choice === '3') {
          rl.close()
          resolve([...args, '--changed-with-deps'])
        } else if (choice === '4') {
          rl.close()
          process.exit(0)
        } else {
          process.stdout.write('Please enter 1, 2, 3, or 4.\n')
          ask()
        }
      })
    }
    ask()
  })
}

/**
 * Main entry point - routes to orchestrator or clean
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP_TEXT)
    process.exit(0)
  }

  if (args[0] === '--version' || args[0] === '-V') {
    console.log(getVersion())
    process.exit(0)
  }

  if (args[0] === RUN_COMMAND) {
    if (args.includes('--help') || args.includes('-h')) {
      process.stdout.write(HELP_TEXT)
      process.exit(0)
    }
    const runArgs = await confirmFullRun(args.slice(1))
    await runOrchestrator(runArgs, process.cwd())
  } else if (args[0] === INIT_COMMAND) {
    const configFile = path.join(process.cwd(), 'mutineer.config.ts')
    if (fs.existsSync(configFile)) {
      console.error('mutineer.config.ts already exists.')
      process.exitCode = 1
    } else {
      fs.writeFileSync(configFile, CONFIG_TEMPLATE)
      console.log('Created mutineer.config.ts')
    }
  } else if (args[0] === CLEAN_COMMAND) {
    console.log('Cleaning up __mutineer__ directories...')
    await cleanupMutineerDirs(process.cwd(), { includeCacheFiles: true })
    console.log('Done.')
  } else {
    console.error(
      `Unknown command: ${args[0] ?? '(none)'}\nUsage: mutineer <init|run|clean>`,
    )
    process.exitCode = 1
  }
}

await main()
