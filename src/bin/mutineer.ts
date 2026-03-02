#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { runOrchestrator } from '../runner/orchestrator.js'
import { cleanupMutineerDirs } from '../runner/cleanup.js'

// Constants
const RUN_COMMAND = 'run'
const CLEAN_COMMAND = 'clean'
const INIT_COMMAND = 'init'

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

  if (args[0] === RUN_COMMAND) {
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
