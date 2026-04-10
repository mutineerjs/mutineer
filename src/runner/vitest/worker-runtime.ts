import { createVitest } from 'vitest/node'
import type { Vitest, TestSpecification } from 'vitest/node'
import fs from 'node:fs'
import path from 'node:path'

import type { MutantPayload } from '../types.js'
import type { MutantRunSummary } from '../../types/mutant.js'
import { poolMutineerPlugin } from './plugin.js'
import {
  getMutantFilePath,
  setRedirect,
  clearRedirect,
} from '../shared/index.js'
import { createLogger } from '../../utils/logger.js'
import { toErrorMessage } from '../../utils/errors.js'

interface ViteInternal {
  config?: { plugins?: Record<string, unknown>[] }
  moduleGraph?: {
    getModulesByFile(file: string): Iterable<{ id?: string }>
  }
}

interface VitestProject {
  _vite?: ViteInternal
  vitenode?: {
    fetchCaches?: Record<string, Map<string, unknown>>
    fetchCache?: Map<string, unknown>
  }
}

interface VitestInternal {
  watcher?: { invalidates?: Set<string> }
  projects?: VitestProject[]
  coreWorkspaceProject?: VitestProject
  state?: { filesMap?: { clear(): void } }
}

type HookWithHandler = { handler: (...args: unknown[]) => unknown }

const log = createLogger('vitest-runtime')

const SETUP_MJS_CONTENT = `import { readFileSync } from 'node:fs'
const _f = process.env.MUTINEER_ACTIVE_ID_FILE
// Define a getter so every access reads the file fresh. Using beforeAll() is
// insufficient because in a persistent Vitest fork the setup module is imported
// only once — beforeAll fires on the first test run but not on subsequent
// runTestSpecifications calls made by the same worker. The getter has no such
// limitation: it evaluates on each access, always returning the active mutant ID
// that the worker wrote to the file just before calling runTestSpecifications.
Object.defineProperty(globalThis, '__mutineer_active_id__', {
  get: () => { try { return readFileSync(_f, 'utf8').trim() || null } catch { return null } },
  configurable: true,
})
`

export interface VitestWorkerRuntimeOptions {
  workerId: string
  cwd: string
  vitestConfigPath?: string
  vitestProject?: string
}

export class VitestWorkerRuntime {
  private vitest: Vitest | null = null
  private setupFilePath: string | null = null

  constructor(private readonly options: VitestWorkerRuntimeOptions) {}

  async init(): Promise<void> {
    try {
      // Write setup.mjs before creating Vitest so the config hook can find it
      const activeIdFile = process.env.MUTINEER_ACTIVE_ID_FILE
      if (activeIdFile && path.isAbsolute(activeIdFile)) {
        const mutineerDir = path.dirname(activeIdFile)
        fs.mkdirSync(mutineerDir, { recursive: true })
        const setupFile = path.join(mutineerDir, 'setup.mjs')
        fs.writeFileSync(setupFile, SETUP_MJS_CONTENT, 'utf8')
        this.setupFilePath = setupFile
      }

      this.vitest = await createVitest(
        'test',
        {
          watch: false,
          reporters: ['dot'],
          silent: true,
          pool: 'forks',
          bail: 1,
          // Limit to 1 inner fork so bail:1 stops after the first failure
          // without spawning additional fork processes. The single fork is
          // persistent (reused across mutant runs), eliminating per-mutant
          // fork startup overhead.
          maxWorkers: 1,
          ...(this.options.vitestConfigPath
            ? { config: this.options.vitestConfigPath }
            : {}),
        },
        {
          plugins: [poolMutineerPlugin()],
        },
      )

      await this.vitest.init()
      log.debug(`Vitest initialised for worker ${this.options.workerId}`)
    } catch (err) {
      log.error(`Failed to initialise Vitest: ${err}`)
      throw err
    }
  }

  async shutdown(): Promise<void> {
    if (!this.vitest) return
    await this.vitest.close()
    this.vitest = null
  }

  async run(mutant: MutantPayload, tests: string[]): Promise<MutantRunSummary> {
    if (!this.vitest) {
      throw new Error('Vitest runtime not initialised')
    }

    const start = Date.now()
    const activeIdFile = process.env.MUTINEER_ACTIVE_ID_FILE
    const useSchema = !mutant.isFallback && !!activeIdFile

    try {
      if (useSchema) {
        fs.writeFileSync(activeIdFile!, mutant.id, 'utf8')
        log.debug(`Schema path: wrote active ID ${mutant.id}`)
        // Invalidate setup.mjs so Vitest re-imports it into each new vm context,
        // ensuring the __mutineer_active_id__ getter is redefined per run.
        // Also add to watcher.invalidates: invalidateFile() only clears the
        // server-side Vite graph; the fork clears evaluatedModules only for
        // files in ctx.invalidates (built from watcher.invalidates). Without
        // this, the fork reuses a cached setup.mjs and skips re-executing it,
        // so __mutineer_active_id__ is never defined on the new vm globalThis.
        if (this.setupFilePath) {
          this.vitest.invalidateFile(this.setupFilePath)
          ;(this.vitest as unknown as VitestInternal).watcher?.invalidates?.add(
            path.resolve(this.setupFilePath),
          )
        }
        // Also clear the source file from the fork's evaluatedModules cache so
        // the fork re-fetches it and receives schema content (with ternary chains)
        // rather than the baseline-cached original. Without this, the fork serves
        // original code for all schema-path runs, causing mutants to escape.
        this.vitest.invalidateFile(mutant.file)
        ;(this.vitest as unknown as VitestInternal).watcher?.invalidates?.add(
          path.resolve(mutant.file),
        )
      } else {
        const mutantPath = getMutantFilePath(mutant.file, mutant.id)
        fs.writeFileSync(mutantPath, mutant.code, 'utf8')
        log.debug(`Wrote mutant to ${mutantPath}`)

        setRedirect({
          from: path.resolve(mutant.file),
          to: mutantPath,
        })

        this.vitest.invalidateFile(mutant.file)
        // Also add to watcher.invalidates so the fork clears its evaluatedModules
        // cache for this file. invalidateFile() only clears the server-side Vite
        // module graph; the fork's own evaluatedModules is only flushed when files
        // appear in ctx.invalidates, which Vitest builds from watcher.invalidates.
        // Without this, a source file cached as schema content during a schema-path
        // run would be reused for the next fallback-path run, causing false escapes.
        ;(this.vitest as unknown as VitestInternal).watcher?.invalidates?.add(
          path.resolve(mutant.file),
        )

        // Clear @vitejs/plugin-vue's SFC descriptor cache for Vue files.
        // The plugin caches parsed descriptors by filename (module-level Map) and
        // only invalidates them via handleHotUpdate. Serving different mutant content
        // under the same filename across fallback runs causes the plugin to return the
        // stale cached descriptor, ignoring the new content from our load hook.
        if (mutant.file.endsWith('.vue')) {
          await this.invalidateVueDescriptor(
            path.resolve(mutant.file),
            mutant.code,
          )
          // Also clear sub-module IDs (e.g. Counter.vue?type=template) from the
          // fork's evaluatedModules. invalidateFile() + watcher.invalidates only
          // handles the root module; sub-modules remain cached and serve stale
          // compiled template content, causing fallback template mutations to escape.
          const vi = this.vitest as unknown as VitestInternal
          const allSubProjects = [
            ...(vi.projects ?? []),
            vi.coreWorkspaceProject,
          ].filter(Boolean) as VitestProject[]
          for (const proj of allSubProjects) {
            const vite = proj._vite
            const mods =
              vite?.moduleGraph?.getModulesByFile(path.resolve(mutant.file)) ??
              []
            for (const mod of mods) {
              if (mod.id && mod.id !== path.resolve(mutant.file)) {
                vi.watcher?.invalidates?.add(mod.id)
              }
            }
          }
        }
      }

      // Clear vite-node's server-side fetchCaches to prevent stale transform
      // content caused by timestamp collision. fetchCaches stores transform
      // results keyed by file path with a timestamp. When invalidateFile() and
      // the prior fetch happen within the same millisecond, the condition
      // `cache.timestamp >= lastInvalidationTimestamp` holds and vite-node
      // serves the stale cached result, bypassing the plugin load hook and
      // delivering the wrong mutant content. Deleting the entry forces a fresh
      // transform on the next run, regardless of millisecond granularity.
      // (vitenode is present in Vitest v3; in Vitest v4 this loop is a no-op.)
      const resolvedFile = path.resolve(mutant.file)
      const vi2 = this.vitest as unknown as VitestInternal
      const allProjects = [
        ...(vi2.projects ?? []),
        vi2.coreWorkspaceProject,
      ].filter(Boolean) as VitestProject[]
      for (const project of allProjects) {
        const vitenode = project.vitenode
        if (vitenode?.fetchCaches) {
          for (const [, cache] of Object.entries(
            vitenode.fetchCaches as Record<string, Map<string, unknown>>,
          )) {
            for (const key of [...cache.keys()]) {
              if (
                key === resolvedFile ||
                key.startsWith(resolvedFile + '?') ||
                key.startsWith(resolvedFile + '&')
              ) {
                cache.delete(key)
              }
            }
          }
        }
        if (vitenode?.fetchCache) {
          for (const key of [
            ...(vitenode.fetchCache as Map<string, unknown>).keys(),
          ]) {
            if (
              key === resolvedFile ||
              key.startsWith(resolvedFile + '?') ||
              key.startsWith(resolvedFile + '&')
            ) {
              ;(vitenode.fetchCache as Map<string, unknown>).delete(key)
            }
          }
        }
      }

      const specs: TestSpecification[] = []
      const projectName = this.options.vitestProject ?? ''
      for (const testFile of tests) {
        const spec = this.vitest
          .getProjectByName(projectName)
          ?.createSpecification(testFile)
        if (spec) specs.push(spec)
      }

      if (specs.length === 0) {
        return {
          killed: false,
          durationMs: Date.now() - start,
        }
      }

      log.debug(`Running ${specs.length} test specs`)
      // Clear accumulated test results from previous runs. Without this,
      // state.filesMap grows unboundedly (each run appends to the array per
      // filepath), causing O(N) work in getFiles() on every run and
      // progressive GC pressure that slows down later mutants.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(this.vitest as any).state?.filesMap?.clear()
      const results = await this.vitest.runTestSpecifications(specs)

      const requestedModules = new Set(specs.map((s) => s.moduleId))
      const relevantModules = results.testModules.filter(
        (mod: { moduleId: string }) => requestedModules.has(mod.moduleId),
      )
      const modulesForDecision = relevantModules.length
        ? relevantModules
        : results.testModules
      const killed = modulesForDecision.some(
        (mod: { ok: () => boolean }) => !mod.ok(),
      )

      const passingTests: string[] = []
      if (!killed) {
        for (const mod of modulesForDecision as Array<{
          children?: {
            allTests(state: 'passed'): Iterable<{ fullName: string }>
          }
        }>) {
          try {
            for (const tc of mod.children?.allTests('passed') ?? []) {
              passingTests.push(tc.fullName)
            }
          } catch {
            // allTests API unavailable in this Vitest version
          }
        }
      }

      return {
        killed,
        durationMs: Date.now() - start,
        ...(passingTests.length > 0 && { passingTests }),
      }
    } catch (err) {
      return {
        killed: true,
        durationMs: Date.now() - start,
        error: toErrorMessage(err),
      }
    } finally {
      if (useSchema) {
        try {
          fs.writeFileSync(activeIdFile!, '', 'utf8')
        } catch {
          // ignore
        }
      } else {
        clearRedirect()
        const mutantPath = getMutantFilePath(mutant.file, mutant.id)
        try {
          fs.rmSync(mutantPath, { force: true })
        } catch {
          // ignore
        }
      }
    }
  }

  private async invalidateVueDescriptor(
    resolvedFile: string,
    mutantContent: string,
  ): Promise<void> {
    const vi3 = this.vitest as unknown as VitestInternal
    const allProjects = [
      ...(vi3.projects ?? []),
      vi3.coreWorkspaceProject,
    ].filter(Boolean) as VitestProject[]
    for (const project of allProjects) {
      const vite = project._vite
      if (!vite) continue
      for (const plugin of (vite.config?.plugins ?? []) as Record<
        string,
        unknown
      >[]) {
        if (!plugin || plugin.name !== 'vite:vue') continue
        const hook = plugin.handleHotUpdate
        const fn =
          typeof hook === 'function'
            ? hook
            : typeof (hook as HookWithHandler)?.handler === 'function'
              ? (hook as HookWithHandler).handler
              : null
        if (typeof fn !== 'function') continue
        try {
          const modules = [
            ...(vite.moduleGraph?.getModulesByFile(resolvedFile) ?? []),
          ]
          await fn({
            file: resolvedFile,
            modules,
            read: () => Promise.resolve(mutantContent),
            server: vite,
            timestamp: Date.now(),
          })
        } catch {
          // ignore
        }
      }
    }
  }
}

export function createVitestWorkerRuntime(
  options: VitestWorkerRuntimeOptions,
): VitestWorkerRuntime {
  return new VitestWorkerRuntime(options)
}
