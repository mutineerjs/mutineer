#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
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
  --changed-with-deps       Mutate changed files + dependents
  --only-covered-lines      Mutate only lines covered by tests
  --per-test-coverage       Collect per-test coverage data
  --coverage-file <path>    Path to coverage JSON
  --min-kill-percent <n>    Minimum kill % threshold (0–100)

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
    await runOrchestrator(args.slice(1), process.cwd())
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
    await cleanupMutineerDirs(process.cwd())
    console.log('Done.')
  } else {
    console.error(
      `Unknown command: ${args[0] ?? '(none)'}\nUsage: mutineer <init|run|clean>`,
    )
    process.exitCode = 1
  }
}

await main()
