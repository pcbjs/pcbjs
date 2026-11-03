// A project's state while its modules and config evaluate, one object on globalThis that a host swaps whole with inRealm().
// Process-wide caches keyed by content, such as fonts, meshes and route memos, live elsewhere; brands and weak maps stay on values.
import type { BoardSpec } from './board-spec.js'
import type { BoundRoute, InstanceState, PartState } from './part.js'
import type { Component, Rules, Src } from './types.js'

/** The shape of Realm, raised whenever a field changes: two copies of core with different numbers cannot share one. */
export const REALM_ABI = 1

/** The board being rendered: the instance path, the counts behind its refs and the rules its parts see. */
export interface RenderScope {
  stack: string[]
  counts: Map<string, number>
  rules?: Readonly<Rules>
}

/** What evaluating a project's modules leaves: its parts, instances and bound routes by file, and the counters behind them. */
export interface Registry {
  seq: number
  netSeq: number
  /** advanced every compile; a module evaluated again starts its parts in a newer epoch */
  epoch: number
  localCount: number
  parts: PartState[]
  fileEpoch: Map<string, number>
  /** routes bound to a name, `const vccTrunk = route(…)`, replaced per file like the parts */
  routes: BoundRoute[]
  routeEpoch: Map<string, number>
  render: RenderScope | null
  /** running circuit builds, innermost last */
  building: InstanceState[]
  /** instances made outside any build, replaced per file like the parts */
  instances: InstanceState[]
}

/** Finds the local file of a fetched model, null when it is not there yet; `watch` names the files whose arrival would let it resolve. */
export type RemoteModelResolver = ((source: string) => string | null) & { watch?: (source: string) => string[] }

/** The `kicad` section of the config and the folder its paths are relative to. */
export interface KicadSetting {
  root: string | null
  config: { footprints?: string[]; models?: string }
}

export interface Realm {
  abi: number
  registry: Registry
  /** the layer of `defineDefaultBoard`, under every board the project compiles */
  defaults: BoardSpec | null
  kicad: KicadSetting | null
  remoteModel: RemoteModelResolver | null
  /** maps evaluated code back to source; set by the host that holds the source maps */
  mapSrc: ((src: Src) => Src) | null
}

const SLOT = Symbol.for('pcbjs.realm')

const newRegistry = (): Registry => ({
  seq: 0,
  netSeq: 0,
  epoch: 0,
  localCount: 0,
  parts: [],
  fileEpoch: new Map(),
  routes: [],
  routeEpoch: new Map(),
  render: null,
  building: [],
  instances: [],
})

export const newRealm = (): Realm => ({ abi: REALM_ABI, registry: newRegistry(), defaults: null, kicad: null, remoteModel: null, mapSrc: null })

function checked(r: Realm): Realm {
  if (r.abi !== REALM_ABI)
    throw new Error(
      `pcbjs: this process holds two copies of @pcbjs/core, one with realm abi ${r.abi} and one with ${REALM_ABI}; install one version of the @pcbjs packages, pcbjs doctor lists them`,
    )
  return r
}

/** The realm installed now, the process's own until a host installs a project's. */
export function realm(): Realm {
  const g = globalThis as any
  return checked((g[SLOT] ??= newRealm()))
}

/** Runs `fn` with `r` installed and puts back the realm before; what `fn` leaves stays in `r`. Calls must not overlap. */
export async function inRealm<T>(r: Realm, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as any
  const before = g[SLOT]
  g[SLOT] = checked(r)
  try {
    return await fn()
  } finally {
    g[SLOT] = before
  }
}

/** A module evaluated again, in dev or by the next board of one run: the first part or instance it makes in a new epoch drops those it made before. */
export function claimFile(file: string | undefined): void {
  const r = realm().registry
  if (file === undefined || (r.fileEpoch.get(file) ?? -1) >= r.epoch) return
  r.parts = r.parts.filter(p => p.declFile !== file)
  r.instances = r.instances.filter(i => i.declFile !== file)
  r.fileEpoch.set(file, r.epoch)
}

/** The state of one compile, see beginCompile. */
export interface CompileScope {
  parts: PartState[]
  instances: InstanceState[]
  prev: RenderScope | null
}

/** Start a compile: a new epoch, a snapshot of module-level parts, and a render scope. */
export function beginCompile(rules?: Readonly<Rules>): CompileScope {
  const r = realm().registry
  r.epoch++
  const scope: CompileScope = { parts: [...r.parts], instances: [...r.instances], prev: r.render }
  r.render = { stack: [], counts: new Map(), rules }
  return scope
}
export function endCompile(scope: CompileScope): void {
  realm().registry.render = scope.prev
}

/** The rules of the board being compiled, for a component that sizes itself by them; undefined outside a compile. */
export const boardRules = (): Readonly<Rules> | undefined => realm().registry.render?.rules

/** Call a component in the render scope, so its local() nets are named after the instance path. */
export function renderComponent<T>(fn: Component, props: any): T {
  const r = realm().registry.render
  if (!r) return fn(props) as T
  const name = (fn as any).displayName || fn.name || 'Component'
  const k = (r.counts.get(name) ?? 0) + 1
  r.counts.set(name, k)
  r.stack.push(`${name}#${k}`)
  try {
    return fn(props) as T
  } finally {
    r.stack.pop()
  }
}
