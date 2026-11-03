// Patches: edits by reference to copper that has no source of its own, which the compiler applies around routing, each checked against a hash of its target; see docs/patches.md.
import type { Pt } from './model.js'
import type { PcbNode, Src } from './types.js'
import { h, isNode } from './jsx-runtime.js'
import { callerSite } from './provenance.js'

/** One track of a hold, `leg` the 1-based automatic leg it belongs to when the route has several. */
export interface HoldTrack {
  layer: string
  pts: Pt[]
  width: number
  leg?: number
}
export interface HoldVia {
  at: Pt
  span: [string, string]
  drill: number
  size: number
  leg?: number
}
/** The copper of a route's automatic legs as one compile left them; `snapshot` names that compile. */
export interface Hold {
  snapshot?: string
  tracks: HoldTrack[]
  vias: HoldVia[]
}
export type PatchOp =
  { via: { at: string; span?: [string, string]; drill?: number; size?: number; net?: string | null } } | { reroute: { through?: string[] } } | { width: number } | { hold: Hold }
/** A patch as the compiler reads it: what it names, the operation, and the hash of the target it was written against. */
export interface Patch {
  ref: string
  hash: string
  op: PatchOp
  src?: Src
}

export const PATCH_OPS = ['via', 'reroute', 'width', 'hold'] as const
export type PatchKind = (typeof PATCH_OPS)[number]

/** The operation's name, or a TypeError naming what is wrong with it. */
export function opKind(op: unknown): PatchKind {
  const keys = op && typeof op === 'object' && !Array.isArray(op) ? Object.keys(op) : []
  if (keys.length !== 1 || !PATCH_OPS.includes(keys[0] as PatchKind))
    throw new TypeError(`a patch operation is one of ${PATCH_OPS.map(k => `{ ${k} }`).join(', ')}, got ${JSON.stringify(op)}`)
  return keys[0] as PatchKind
}

/** A patch to place in the tree, in `<PCB patches>` or in the default export of the entry's `.patches.ts` file. */
export function patch(ref: string, op: PatchOp, hash: string): PcbNode {
  if (typeof ref !== 'string' || !ref.trim()) throw new TypeError('patch(ref, op, hash) needs a reference such as "R1" or "route:3"')
  opKind(op)
  if (typeof hash !== 'string' || !/^[0-9a-f]{12}$/.test(hash))
    throw new TypeError(`patch(${JSON.stringify(ref)}, …): the hash is 12 hex of the target, got ${JSON.stringify(hash)}`)
  const node = h('patch', { ref, op, hash })
  const site = callerSite()
  if (site) node.src = site
  return node
}

export const isPatchNode = (v: unknown): v is PcbNode => isNode(v) && v.type === 'patch'

/** A patch node as the compiler reads it. */
export function patchOf(n: PcbNode): Patch {
  const p = n.props as { ref: string; op: PatchOp; hash: string }
  return { ref: p.ref, hash: p.hash, op: p.op, ...(n.src ? { src: n.src } : {}) }
}

/** The patches file beside an entry: `pcb.patches.ts` for `pcb.tsx`, `blinky.pcb.patches.ts` for `blinky.pcb.tsx`. */
export const patchesFile = (entry: string): string => entry.replace(/\.[cm]?[jt]sx?$/, '') + '.patches.ts'
