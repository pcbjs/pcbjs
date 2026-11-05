// The Node ModuleLoader: a project's modules evaluated through Vite's SSR, with the cancel and source mapping Vite needs.
import { fileKey } from './files.js'
import type { Plugin, ViteDevServer } from 'vite'
import { CancelledError } from '@pcbjs/compile'
import type { ModuleLoader } from '@pcbjs/compile/internal/entry'
import { beginCompile, endCompile } from '@pcbjs/core/internal/realm'
import { localFrames } from '@pcbjs/core/internal/provenance'
import type { Src } from '@pcbjs/core/internal/types'

export type { ModuleLoader } from '@pcbjs/compile/internal/entry'

/** The editor's unsaved texts as an evaluation reads them: the code Vite compiles and where a repair's closers start. */
export interface DraftCodes {
  get(file: string): { code: string; limit: number | null } | undefined
}

/** What the evaluation running sees beyond the drafts: the keystroke tier's code of the file it sketches, and the compile's cancel signal; `serial` in a compile thread, whose evaluations never overlap, and only there. */
export const evaluation: { serial: boolean; code: Map<string, string>; signal: { readonly aborted: boolean } | null } = { serial: false, code: new Map(), signal: null }

/** Serve each draft in place of its file; each module loaded is a cancel point of the evaluation. */
export function draftsPlugin(store: () => DraftCodes | null | undefined): Plugin {
  return {
    name: 'pcbjs:drafts',
    enforce: 'pre',
    load(id) {
      if (evaluation.signal?.aborted) throw new CancelledError()
      const file = id.split('?')[0]
      return evaluation.code.get(fileKey(file)) ?? store()?.get(file)?.code
    },
  }
}

/** Unsaved code a loader serves for one file in place of its draft or disk text. */
export interface CodeOf {
  file: string
  code: string
}

/** Modules through Vite's SSR, each a cancel point; with `code`, the keystroke tier's text of one file, which stays out of the graph's next evaluation. */
export function viteLoader(server: ViteDevServer, code?: CodeOf): ModuleLoader {
  if (code && !evaluation.serial) throw new Error('the keystroke tier runs in a compile thread only')
  return {
    load: (file, signal) => (code ? withCode(server, code, () => evaluate(server, file, signal, code)) : evaluate(server, file, signal)),
    imported: file => importedFiles(server, file),
    mapSrc: sourceMapper(server),
  }
}

/** Map a position in the code Vite evaluated back to the source through Vite's own stack rewriting. */
function sourceMapper(server: ViteDevServer): (src: Src) => Src {
  return src => {
    const e = new Error()
    const graph = server.environments.ssr.moduleGraph
    const node = graph.getModuleById(src.file) ?? [...(modulesFor(graph, src.file) ?? [])].find(m => m.id)
    const id = node?.id ?? src.file
    e.stack = `Error\n    at f (${id}:${src.line}:${src.col})`
    server.ssrFixStacktrace(e)
    return localFrames(e.stack ?? '')[0] ?? src
  }
}

/** Every file `file` reaches through the SSR module graph, itself included. */
function importedFiles(server: ViteDevServer, file: string): Set<string> {
  const graph = server.environments?.ssr?.moduleGraph ?? (server as any).moduleGraph
  const seen = new Set<string>([file])
  const stack = [...(modulesFor(graph, file) ?? [])]
  const visited = new Set<unknown>()
  while (stack.length) {
    const m: any = stack.pop()
    if (!m || visited.has(m)) continue
    visited.add(m)
    if (m.file) seen.add(m.file)
    for (const d of m.importedModules ?? []) stack.push(d)
  }
  return seen
}

const invalidate = (server: ViteDevServer, file: string) => {
  const g = server.environments.ssr.moduleGraph
  for (const m of modulesFor(g, file) ?? []) g.invalidateModule(m)
}

async function withCode<T>(server: ViteDevServer, code: CodeOf, fn: () => Promise<T>): Promise<T> {
  invalidate(server, code.file)
  try {
    return await fn()
  } finally {
    // the next evaluation reads the file's draft or disk again
    invalidate(server, code.file)
  }
}

/** A module evaluated through Vite's SSR, each module it loads a cancel point. */
async function evaluate(server: ViteDevServer, file: string, signal: { readonly aborted: boolean } | undefined, code?: CodeOf): Promise<Record<string, any>> {
  if (evaluation.serial) evaluation.signal = signal ?? null
  if (code) evaluation.code.set(fileKey(code.file), code.code)
  try {
    const mod = await server.ssrLoadModule(file, { fixStacktrace: true })
    if (signal?.aborted) throw new CancelledError()
    return mod
  } catch (e: any) {
    if (!signal?.aborted && e?.name !== 'CancelledError') throw e
    // Vite keeps a module's error until it is invalidated: a cancelled evaluation leaves none behind
    const g = server.environments.ssr.moduleGraph
    for (const m of g.idToModuleMap.values()) if (m.ssrError?.name === 'CancelledError') g.invalidateModule(m)
    // a new epoch, as a compile starts one, so the modules evaluated here drop their parts when evaluated again
    endCompile(beginCompile())
    throw new CancelledError()
  } finally {
    evaluation.signal = null
    evaluation.code.clear()
  }
}

/** Vite normalizes separators, but an editor or watcher can still use a different drive case. */
export function modulesFor<T>(graph: { getModulesByFile(file: string): Set<T> | undefined; fileToModulesMap: Map<string, Set<T>> }, file: string): Set<T> | undefined {
  const direct = graph.getModulesByFile(file)
  if (direct?.size || process.platform !== 'win32') return direct
  const key = fileKey(file)
  return [...graph.fileToModulesMap].find(([path]) => fileKey(path) === key)?.[1]
}
