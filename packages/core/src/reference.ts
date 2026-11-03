// Another entry's board as a mechanical reference, never copper; see references.md.
import type { Length, PcbNode, Side, Src } from './types.js'
import type { MatePoint, Pt, Ring } from './model.js'
import type { SiteData, SiteFootprint } from './site-data.js'
import { h } from './jsx-runtime.js'
import { callerSite, urlPath } from './provenance.js'
import { platform } from './platform.js'

/** Where the referenced board lies against this one: over its top face, under its bottom face, or in its plane. */
export type ReferenceStack = 'above' | 'below' | 'coplanar'

/** The mating pair: a part or a pin handle of this board, and the ref and pin of the connector on the referenced board. */
export interface ReferenceMate {
  /** a part, such as `J1`, a pin handle, such as `J1[19]`, or a part of a group, such as `PORTS[2].J` */
  local: unknown
  /** the ref of the mating part on the referenced board, or a point it names with `<mate name>` or a placement's `name` */
  remote: string
  /** the remote pin that mates, also the local pin when `local` is a part; default 1; a named point mates at itself */
  pin?: string | number
  /** DRC `reference-net`: `true` wants equal net names across each pin pair, an object or function maps local names to remote ones; off by default */
  nets?: boolean | Record<string, string | string[]> | ((local: string) => string | string[])
}

/** Where a body height comes from: the footprint's `height`, the box of its model file, a bare hole's 0 or the 1 mm default. */
export type HeightSource = 'height' | 'model' | 'bare' | 'default'

/** What the reference shows in 2D and 3D. */
export interface ReferenceShow {
  /** the layer the 2D drawing goes on, default Dwgs.User; false for none */
  outline?: string | false
  /** the part bodies in 3D, default true */
  bodies?: boolean
  /** 0 to 1, default 0.5 */
  opacity?: number
  /** the tint, a CSS colour, default a light blue */
  color?: string
}

export interface ReferenceOptions {
  /** one or more mating pairs: the first places the board; a pair without `nets` takes the first pair's */
  mate?: ReferenceMate | ReferenceMate[]
  /** with `mate`: the face the referenced board lies on, F over the top or B under the bottom; default the local part's side */
  side?: Side
  /** with `mate`: 'coplanar' puts the referenced board in this board's plane, edge to edge */
  stack?: 'coplanar'
  /** with `mate`: face to face, mm; default the local connector's height, else 8 */
  gap?: Length
  /** without `mate`: its origin in this board's frame, z the height of its bottom face (mm) */
  at?: [Length, Length, Length?] | [Length, Length]
  /** without `mate`: turned over about its y axis; its top face lands at z */
  flip?: boolean
  /** degrees, counter-clockwise seen from the top: about the local pin after the mate, about the origin for `at` */
  rotate?: number
  /** mm in this board's frame, x right, y down, z up, after everything else */
  offset?: [Length, Length, Length]
  show?: ReferenceShow
}

/** Another entry's board as a mechanical reference, placed by `mate` or `at`; the path is relative to the calling file, or a package's board such as '@acme/power/boards/driver'. */
export function reference(path: string, opts: ReferenceOptions = {}): PcbNode {
  if (typeof path !== 'string' || !path.trim()) throw new TypeError("reference(path, options) needs the path of another entry, such as '../driver/pcb.tsx'")
  if (opts === null || typeof opts !== 'object') throw new TypeError(`reference(${JSON.stringify(path)}, options): options must be an object`)
  const site = callerSite()
  const np = platform().path
  let file = path
  if (path.startsWith('file:')) file = urlPath(path)
  else if (/^\.\.?([\\/]|$)/.test(path) && site?.file && np.isAbsolute(site.file)) file = np.resolve(np.dirname(site.file), path)
  const node = h('reference', { ...opts, path, file, ...(site?.file ? { from: site.file } : {}) })
  if (site) node.src = site
  return node
}

/** A column-major 4x4 matrix in the 3D view's frame: x board x, y board -y, z up from the bottom face. */
export type Mat4 = number[]

/** One part of a referenced board in its own board mm, as its board data has it; `heightFrom` says where the height comes from. */
export type ReferencedFootprint = Pick<SiteFootprint, 'ref' | 'at' | 'rot' | 'side' | 'height' | 'body'> & {
  heightFrom?: HeightSource
  pads: Omit<SiteFootprint['pads'][number], 'uid'>[]
}

/** A compiled referenced entry. */
export interface ReferencedBoard {
  /** the entry, absolute */
  entry: string
  name: string
  title: string
  rev: string
  thickness: number
  outline: Ring[]
  drills: SiteData['drills']
  footprints: ReferencedFootprint[]
  /** its named points, from `<mate>` and `name` on a placement */
  mates?: MatePoint[]
  /** the content hash of its module graph, referenced graphs included; also its mesh name */
  hash: string
  /** set when the mesh of its 3D view was written */
  mesh?: string
  /** how many meshes of the binary are the board itself; the part bodies follow */
  split?: number
  /** the files of that graph, absolute, the config included */
  files: string[]
  /** every entry its references reach, with what each references, for the cycle check */
  graph: Record<string, string[]>
  /** ok, or incomplete when it has DRC errors or unconnected nets */
  status: string
}

/** Compiles a referenced entry in a run of its own; throws an Error with the reason when it cannot. */
export interface ReferenceResolver {
  /** `src`: the reference() call, which a reference cycle names; `from`: its file, absolute, where a package's board resolves from */
  resolve(file: string, src?: Src, from?: string): ReferencedBoard
}

/** A mating pair: the local and remote pads in this board's mm. */
export interface MatePair {
  local: { ref: string; pin: string; pads: { num: string; at: Pt; net?: string; want?: string | string[] }[] }
  remote: { ref: string; pin: string; pads: { num: string; at: Pt; net?: string }[] }
  nets?: boolean
}

/** A reference as the compiled board holds it, in this board's frame. */
export interface BoardReference {
  /** the entry, absolute, and the path as written */
  entry: string
  path: string
  name: string
  title: string
  hash: string
  mesh?: string
  split?: number
  status: string
  anchor: { kind: 'mate'; local: string; remote: string } | { kind: 'at'; at: [number, number, number] }
  stack?: ReferenceStack
  gap?: number
  rotate: number
  offset: [number, number, number]
  flip?: boolean
  /** where the referenced board's own frame goes in this board's 3D frame */
  transform: Mat4
  show: { outline: string | null; bodies: boolean; opacity: number; color: string }
  /** its outline rings in this board's mm, seen from the top */
  outline: Ring[]
  /** the z range of its slab in this board's 3D frame */
  z: [number, number]
  /** its drills in this board's mm, a slot with its length and axis turned onto this board */
  holes: SiteData['drills']
  /** the mating pair; with `nets`, pads carry net names and each local pad the remote name it wants */
  mate?: MatePair
  /** every mating pair, the first one `mate`, when the mate names several */
  mates?: MatePair[]
  /** its part bodies as prisms in this board's frame, with where each height comes from */
  bodies: { ref: string; ring: Ring; z: [number, number]; from?: HeightSource }[]
  /** this board's part bodies the collision check counts: the height of each and where it comes from */
  heights?: { ref: string; height: number; from: HeightSource }[]
  /** where the default gap came from: the local part's height, its model box, or 8 mm */
  gapFrom?: 'gap' | 'height' | 'model' | 'default'
  /** the files of its module graph, for the dev server's watcher */
  files: string[]
  src?: Src
}

export type { Length }

/** A reference as the site carries it: enough to load its mesh, place it and link to its page. */
export interface SiteReference {
  name: string
  title: string
  /** the entry relative to this project's root */
  entry: string
  /** served at /__pcbjs/model/boards/<mesh> in dev, models/boards/<mesh>.bin built */
  mesh?: string
  transform: Mat4
  /** the tint and opacity of the 3D group, and whether the part bodies show */
  color: string
  opacity: number
  bodies: boolean
  /** how many meshes of the binary are the board itself; the part bodies follow */
  split?: number
  /** a panel line: the anchor, the stack and the gap */
  anchor: string
  /** the face it stacks on, F above or B below, so the exploded view moves it with that side's parts; none in this board's plane */
  side?: 'F' | 'B'
  /** the other board's page in this site, when the site has it */
  page?: string
  /** its outline rings in this board's mm, seen from the top */
  outline?: Ring[]
}
