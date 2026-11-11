// What the viewer receives: per-layer SVG markup and metadata; @pcbjs/export builds it.
import type { Board, Footprint, Pt, Ratsnest, RoutingReport } from './model.js'
import type { ModelSpec, Rules, Src, Stackup, StepModelSpec } from './types.js'
import type { Finding } from './finding.js'

export interface SiteFootprint {
  locked?: boolean
  /** library-preview reference label; ref remains the stable source/selection identity */
  displayRef?: string
  ref: string
  value: string
  id: string
  at: [number, number]
  rot: number
  side: 'F' | 'B'
  bom: boolean
  /** do not populate: the viewer draws the footprint hatched */
  dnp?: boolean
  fields: Record<string, string>
  description?: string
  /** the placement: the outermost call that placed the footprint, as `Footprint.src` */
  src?: SiteSrc
  /** the innermost call site with a range, normally the `<footprint>` element; absent when it is the placement */
  def?: SiteSrc
  /** `uid` the pad item's, see SiteItem */
  pads: { num: string; name: string; net?: string; at: [number, number]; uid?: string }[]
  /** the 3D body box in board mm: centre, size along the footprint's x and y, rotation in degrees */
  body: { x: number; y: number; w: number; h: number; rot: number }
  /** the extent of the footprint's pads and graphics in board mm, top-left corner and size */
  bbox: { x: number; y: number; w: number; h: number }
  /** body height in mm, 0 for a bare hole */
  height: number
  /** the generated 3D model, absent for a plain box; for a STEP model the fallback until the mesh arrives */
  model?: Exclude<ModelSpec, StepModelSpec>
  /** a STEP model: the file relative to the root, its mesh hash and the KiCad transform with defaults filled in */
  step?: SiteStep
  /** the mesh hash of the generated `model`, at `/__pcbjs/model/<mesh>` in dev and `models/<mesh>.bin` built, placed by the body */
  mesh?: string
}
/** A footprint's model as the viewer gets it; the mesh is at `/__pcbjs/model/<mesh>` in dev and `models/<mesh>.bin` built. */
export interface SiteStep {
  file: string
  /** sha256 of the file content and the conversion options; absent when the file is missing */
  mesh?: string
  transform: StepTransform
  /** the mesh's extent in its own frame, mm, once the cli has converted it */
  bounds?: { min: [number, number, number]; max: [number, number, number] }
  /** the courtyard, else the pads and graphics, in the footprint frame (mm, y down) */
  courtyard?: { x0: number; y0: number; x1: number; y1: number }
  /** why the placed model looks wrong, such as its box past the courtyard; absent when it fits */
  issue?: string
}
/** KiCad's model transform: offset in mm, rotate in degrees about x, y and z, scale per axis. */
export interface StepTransform {
  offset: [number, number, number]
  rotate: [number, number, number]
  scale: [number, number, number]
}
export interface SiteData {
  name: string
  title: string
  rev: string
  copper: number
  thickness: number
  rules: Rules
  /** top to bottom, with the finish and the mask and silk colours */
  stackup: Stackup
  viewBox: [number, number, number, number]
  bbox: Board['bbox']
  layers: { id: string; name: string; kind: string; side: string; color: string; order: number; svg: string }[]
  holes: string
  /** closed Edge.Cuts rings in board mm, the first ring the largest */
  outline: [number, number][][]
  /** every drilled hole, board mm; a slot also has `len`, its overall length, and `a`, its long axis in degrees from +x toward +y */
  drills: { x: number; y: number; d: number; len?: number; a?: number }[]
  nets: string[]
  footprints: SiteFootprint[]
  drc: SiteFinding[]
  erc: SiteFinding[]
  /** the netlist as declared */
  schematic: Schematic
  ratsnest: Ratsnest[]
  /** the netlist's own ratsnest, pad to pad, drawn until the checks give the routed one */
  airwires?: Ratsnest[]
  unconnected: number
  stats: Board['stats']
  bom: { refs: string[]; value: string; footprint: string; qty: number; fields: Record<string, string>; sourcing: Sourcing }[]
  /** sourcing tags in order, such as ["LCSC", "CN"]; [] means the catch-all MPN only */
  sourcingTags: string[]
  fab: { url: string; name: string; files: string[]; status: string }
  svgUrl: string
  generatedAt: string
  dev: boolean
  /** source ranges per file, when the source-range transform ran */
  sources?: SourceIndex
  /** one row per board item: what selection, highlight, the assist and the tools read; its geometry is in `shapes` */
  items?: SiteItem[]
  /** each item's rings, what the 3D view and the hit tests draw from */
  shapes?: SiteShapes
  /** set for a board compiled for several fab targets; `fab` and `svgUrl` are per target */
  variant?: VariantInfo
  /** repository link for a built site, from the `repo` config */
  repo?: RepoLink
  /** the IDE preview of a file no board imports; never built */
  transient?: boolean
  /** hard keepouts in board mm */
  keepouts?: SiteKeepout[]
  /** what the autorouter did; `shared` for a variants target routed once for several */
  routing?: RoutingReport
  /** one entry per route with a length to report */
  routes?: RouteInfo[]
  /** compile phase wall times in ms */
  timings?: { route: number; zones: number; connectivity: number; drc: number; erc: number }
  /** other entries' boards shown as mechanical references, see references.md */
  references?: import('./reference.js').SiteReference[]
  /** each part with an auto slot as this compile placed it, see placement.md */
  placed?: import('./model.js').AutoPlaced[]
  /** UI-derived live state: current geometry is available, but these facets have not caught up. Absent on complete static data. */
  pending?: ('findings' | 'fab')[]
  /** the last compile failed: the data is the previous one, `staleError` says why */
  stale?: boolean
  staleError?: string
  /** dev: compiled from the editor's unsaved text; `skipped` counts the spans its repair left out */
  draft?: { skipped: number }
  /** Preview-only current source prefix; checks and manufacturing output are unavailable. */
  halted?: { stage: string; stages: string[]; completed: string[]; src?: SiteSrc }
  /** a live rebuild's layers: the uids of the last compile's copper drawn until the stage that remakes it ends */
  carried?: string[]
  /** the board's grids, sources relative to the root, see grids.md */
  grids?: (Omit<import('./model.js').GridRecord, 'src' | 'attach'> & { src?: SiteSrc; attach?: SiteSrc })[]
  /** what the tools may change on each part, group and route, see editing.md */
  edit?: SiteEditNode[]
}

/** A source position relative to the root, 1-based, with its range when it has one; a client resolves the file against the project root. */
export interface SiteSrc {
  file: string
  line: number
  col: number
  endLine?: number
  endCol?: number
}
/** An edit node as the viewer gets it, sources relative to the root. */
export type SiteEditNode = Omit<import('./model.js').EditNode, 'src' | 'steps'> & {
  src: { at?: SiteSrc; chain?: SiteSrc }
  steps?: { op: string; layer?: string; angle?: number; src?: SiteSrc }[]
}

/** One route as the viewer reports it: `length` in mm, of the longer track for a pair; `skew` longer minus shorter; `nets` every net of a pair's group, both sides of a series part; `call` where a helper was called; `path` the instance whose layout made it. */
export interface RouteInfo {
  id: string
  net: string
  pair?: string
  nets?: string[]
  length: number
  target?: { min: number; max: number } | null
  group?: string
  skew?: number
  src?: SiteSrc
  call?: SiteSrc
  path?: string
  /** `pt:0` the start, `pt:k` where the k-th chain call ends, board mm */
  pts?: [number, number][]
}

/** A hard keepout as the site carries it; `src` is relative to the root. */
export interface SiteKeepout {
  layers: string[]
  outline: [number, number][][]
  tracks: boolean
  vias: boolean
  pours: boolean
  ref?: string
  src?: SiteSrc
}

/** A finding as the site carries it: the shape of `check --json`, with `path` the instance paths of its parts, such as `CH2/R`. */
export type SiteFinding = Finding & { path?: string[] }

/** One source range of the design that produced items; 1-based, end inclusive. */
export interface SourceRange {
  start: [number, number]
  end: [number, number]
  /** the uids of the items it produced, directly or through components, sorted */
  uids: string[]
  /** the uids it reaches only as a call site around the code that drew them, such as a layout's element; absent when none */
  outer?: string[]
  refs: string[]
  /** the command text, such as "H 9", when the range is one command of a path string; it nests in the element's range */
  seg?: string
}
/** Source ranges by file relative to the project root, sorted by start, may nest. */
export type SourceIndex = Record<string, SourceRange[]>
/** Where the source is hosted, for cmd+click in a built site, from the `repo` config. */
export interface RepoLink {
  /** such as https://github.com/org/name */
  url: string
  kind: 'github' | 'gitlab' | 'gitea' | 'bitbucket' | 'generic'
  /** branch or commit the build was made from */
  ref: string
  /** the project's folder in the repository, '' at the root */
  dir: string
}

// one SiteData per board and target; the client groups entries by `name`
/** Set on every entry of a board compiled with `variants(...)`. */
export interface VariantInfo {
  /** such as "JLCPCB 2-Layer"; unique within the board */
  name: string
  /** 0-based */
  index: number
  names: string[]
  fab?: string
}

export interface SchematicPin {
  name: string
  net: string | null
  nc: boolean
}
export interface SchematicPart {
  ref: string
  displayRef?: string
  value: string
  footprint: string
  prefix: string
  pins: SchematicPin[]
  placed: boolean
  src?: SiteSrc
  /** owning instance path, outermost first, [] at the board level */
  path: string[]
  /** the key in its circuit, "R1" for Buck1.R1; the ref at the board level */
  local: string
  /** its export in the `<PCB schematic>` module, the module relative to the project root */
  export?: { name: string; module?: string }
}
export interface SchematicNet {
  name: string
  displayName?: string
  class?: string
  local: boolean
  pins: string[] /* "R1.2" */
  path?: string[] /* owning circuit instance of a private net */
  export?: { name: string; module?: string }
}
export type SchematicCircuit = import('./model.js').BoardSchematicCircuit
export interface Schematic {
  parts: SchematicPart[]
  nets: SchematicNet[]
  circuits: SchematicCircuit[]
  /** the schematic picture in sheet mm, see docs/schematic-graphic.md */
  drawing?: import('./sch-model.js').SchDrawing
  /** the picture as SVG elements coloured by `--sch-*` variables, its stylesheet and each theme's values of the variables; the viewBox is the drawing's `page` */
  svg?: { markup: string; style: string; themes: Record<'light' | 'dark', Record<string, string>> }
}

/** Resolved sourcing of one BOM row for the board's target. */
export interface Sourcing {
  /** the first `MPN:<tag>` in tag order, else `MPN`, else null */
  mpn: string | null
  /** the tag that matched, "" for the catch-all MPN */
  tag: string | null
  /** every sourcing key given for the part, inline or out of line */
  all: Record<string, string>
  manufacturer?: string
  datasheet?: string
}

/** One board item as the views index it, its geometry in `SiteData.shapes`; board mm, y down. */
export interface SiteItem {
  /** its place in this facet, what the SVG's `data-id` and the shapes name; never compared across facets */
  id: number
  /** the item's uid, see Item.uid */
  uid?: string
  /** its content, see itemRev in @pcbjs/core/ref: the same uid with another rev changed */
  rev: string
  kind: 'pad' | 'track' | 'via' | 'zone' | 'graphic' | 'text'
  generated?: 'reference'
  /** a THT pad or via lists every copper layer it spans */
  layers: string[]
  net?: string
  ref?: string
  /** a pad's number */
  pad?: string
  /** the extent of its rings: x0, y0, x1, y1; absent for an item its holes cut away whole */
  box?: [number, number, number, number]
  /** drill diameter (mm) */
  drill?: number
  /** track width (mm) */
  width?: number
  /** the `route:<n>` id of the route call that placed a track or via */
  route?: string
  /** the instance whose layout drew a text or graphic of no part, `CH1` */
  path?: string
  /** a pair track's pair id and role */
  pair?: string
  role?: 'P' | 'N'
}

/** Rings packed flat: entry i holds `n[i]` rings of the item `ids[i]`, ring k has `len[k]` points, `xy` every point's x and y in turn. */
export interface PackedRings {
  ids: number[]
  n: number[]
  len: number[]
  xy: number[]
}
/** The items' rings in board mm, y down; an item's outers have a positive signed area, its holes a negative one. */
export interface SiteShapes {
  /** Hash of the item rows these numeric ids belong to; absent on legacy exports. */
  itemsHash?: string
  /** the stroked outline, pad shape or zone fill of each item */
  rings: PackedRings
  /** on outer copper, the rings under each side's mask of the items that have some open; an item left out is wholly covered */
  covered: { F: PackedRings; B: PackedRings }
  /** each side's mask openings, by the item that opens them */
  openings: { F: PackedRings; B: PackedRings }
}
