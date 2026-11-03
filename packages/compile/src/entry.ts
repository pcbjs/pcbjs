// One entry's evaluation, shared by the CLI's Vite loader and the browser worker's: its module, its patches file and their checks.
import { realm } from '@pcbjs/core/internal/realm'
import type { PcbNode, Src } from '@pcbjs/core/internal/types'
import { CompileError, type CompileOptions } from './flatten.js'

/** What loads a project's modules: Vite's SSR in Node, the worker's import() in the browser. */
export interface ModuleLoader {
  /** a cancelled signal rejects with a CancelledError */
  load(file: string, signal?: CompileOptions['signal']): Promise<Record<string, unknown>>
  /** every file `file` reaches, itself included: the module graph the stage key hashes */
  imported(file: string): Set<string>
  /** a position in the evaluated code back to its source, where parts are declared */
  mapSrc?(src: Src): Src
}

/** A module to evaluate: its name for the loader and its path relative to the project root. */
export interface EntryFile {
  file: string
  rel: string
}

export interface Evaluated {
  root: PcbNode
  /** null without a patches file */
  patches: PcbNode[] | null
}

/** The design's default export, checked: an element, not a function or a promise. */
export function rootOf(mod: Record<string, unknown>, rel: string): PcbNode {
  const root = mod.default as any
  if (!root) throw new CompileError(`${rel} has no default export (export default <PCB …>)`)
  if (typeof root === 'function' || typeof root.then === 'function')
    throw new CompileError(
      `${rel} default-exports a ${typeof root === 'function' ? 'function' : 'promise'}; export the element, export default <PCB …>, with top-level await for async setup`,
    )
  return root
}

/** A patches file's default export, checked: a list of patch() calls. */
export function patchList(mod: Record<string, unknown>, rel: string): PcbNode[] {
  const list = mod.default
  if (!Array.isArray(list)) throw new CompileError(`${rel} must export default a list of patch() calls`)
  return list
}

/** The entry evaluated with the loader's source mapping, then its patches file when `patches` names one. */
export async function evaluateEntry(loader: ModuleLoader, entry: EntryFile, patches: EntryFile | null, signal?: CompileOptions['signal']): Promise<Evaluated> {
  if (loader.mapSrc) realm().mapSrc = src => loader.mapSrc!(src)
  const root = rootOf(await loader.load(entry.file, signal), entry.rel)
  return { root, patches: patches ? patchList(await loader.load(patches.file, signal), patches.rel) : null }
}
