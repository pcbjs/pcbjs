// The compiled board: every item in absolute board coordinates (mm, y down).
import type { IslandMode, ResolvedRules, Rules, Src, PadShape, PadType, ThermalConnection, AutoRouteParams, RouteEnd, ModelSpec, Stackup, ResolvedPos } from './types.js'
import { BASE } from './rules.js'
import type { ResolvedNetClass } from './netclass.js'
import type { Quantity, RuleProvenance, TemplateArgs, Witness } from './finding.js'

export type { ResolvedNetClass }

/** A 2D affine matrix, SVG order: a b c d e f. */
export type Mat = [number, number, number, number, number, number]

export type Pt = [number, number]
export type Ring = Pt[]
/** A segment or an arc of less than a full turn in board mm; `cw` is clockwise seen from the top, SVG sweep flag 1. */
export type Prim = { kind: 'line'; from: Pt; to: Pt } | { kind: 'arc'; from: Pt; to: Pt; center: Pt; cw: boolean }
/** A polygon with holes, as Clipper returns it. */
export interface Poly {
  outer: Ring
  holes: Ring[]
}

export interface LayerDef {
  id: string // canonical KiCad name: F.Cu, B.SilkS, Edge.Cuts ...
  name: string
  kind: 'copper' | 'mask' | 'paste' | 'silkscreen' | 'fab' | 'courtyard' | 'edge' | 'user'
  side: 'front' | 'back' | 'inner' | 'both'
  color: string
  /** stacking order, front on top */
  order: number
}

/** `src` made the item; `chain` lists the enclosing call sites, components, groups and footprint, outermost first. */
interface ItemBase {
  /** the item's index within one compile, for the algorithms and the rows of one facet; only its uid crosses between facets */
  id: number
  /** `item:<12 hex>`, from its kind, the call or route or part that made it and its ordinal there, `~2` on for twins; a move keeps it; set when the stage that adds it ends */
  uid?: string
  layer: string
  net?: string
  ref?: string
  src?: Src
  chain?: Src[]
}
export interface Track extends ItemBase {
  kind: 'track'
  pts: Ring
  width: number
  /** the pair id shared by the P and N tracks of a pair route */
  pair?: string
  /** P from the first end of the array, N from the second */
  role?: 'P' | 'N'
  /** the `route:<n>` id of the route call that placed it; absent on drawn tracks */
  route?: string
  /** the track as lines and arcs when it holds an arc; `pts` is it flattened for the checks, lengths run along the arcs */
  prims?: Prim[]
}
export interface Via extends ItemBase {
  kind: 'via'
  at: Pt
  drill: number
  size: number
  layers: [string, string]
  /** the route id of the route call that placed it, see Track.route */
  route?: string
  /** placed by stitch() from the pour fill */
  stitch?: true
}
export interface Pad extends ItemBase {
  kind: 'pad'
  num: string
  name: string
  at: Pt
  rot: number
  shape: PadShape
  size: [number, number]
  drill: [number, number] | null
  type: PadType
  layers: string[]
  poly: Ring
  maskExpansion?: number
  paste: boolean
  mirrored: boolean
  /** how the pad joins a pour of its net, over the pour's connect; absent means the pour's */
  thermal?: ThermalConnection
  /** the spoke angle of its thermal relief, from the pad or its part, over the rules' thermal.angle */
  thermalAngle?: 90 | 45
  /** rule overrides in mm from the pad or its part; absent means the class's or the rules' */
  clearance?: number
  /** a clearance by the other item's kind, instead of `clearance`; `self` holds toward pads of the same footprint */
  clearanceTo?: KindClearanceMM
  holeClearance?: number
  edgeClearance?: number
  /** the narrowest track that may join this pad */
  trackWidth?: number
  pasteShrink?: number
  /** the paste ratio of the pad, see PadProps.pasteRatio */
  pasteRatio?: number
  /** the paste openings in board mm when they are not the copper less the rules' pasteShrink; [] means no paste */
  pasteRings?: Ring[]
  /** the mask opening of a non-plated hole in board mm, the pad or hole grown by the mask expansion, as KiCad; absent with `mask={false}` */
  maskRings?: Ring[]
  /** the level each override above came from: the pad's own prop, or its part's rules */
  override?: Partial<Record<PadOverrideKey, 'pad' | 'part'>>
}
/** A clearance in mm by the other item's kind; a kind left out is not overridden, `pad` may go by the pad type. */
export type KindClearanceMM = Partial<Record<'track' | 'via' | 'zone' | 'text' | 'self', number>> & { pad?: number | PadTypeClearanceMM }
/** A clearance toward pads in mm by type; a type left out, and a non-plated hole, is not overridden. */
export type PadTypeClearanceMM = { tht?: number; smd?: number }
/** The rules a pad may override. */
export type PadOverrideKey = 'clearance' | 'holeClearance' | 'edgeClearance' | 'trackWidth' | 'pasteShrink'
/** `prims` lists each outline ring as lines and arcs, present only when a ring holds an arc. */
export interface Zone extends ItemBase {
  kind: 'zone'
  outline: Ring[]
  clearance?: number
  priority: number
  minWidth?: number
  fill: Poly[]
  prims?: Prim[][]
  /** how same-net pads join the fill; absent means 'thermal' */
  connect?: ThermalConnection
  /** the pour's own island mode, over the rules' */
  islands?: IslandMode
  /** fill pieces the last fill removed as islands and their area in mm²; absent when none */
  islandsRemoved?: { count: number; area: number }
}
/** `paths` are the flattened polylines the checks use; `prims` the lines and arcs for the exporters when a path holds an arc. */
export interface Graphic extends ItemBase {
  kind: 'graphic'
  paths: Ring[]
  closed: boolean[]
  width: number
  fill: boolean
  prims?: Prim[][]
  /** a teardrop the compiler drew, with the ids of the pad and the track it joins */
  teardrop?: { pad: number; track: number }
}
/** Laid out text in board mm: stroke font polylines `thickness` wide, or an outline font's `polys` with `thickness` 0; `at` is the block's vertical centre. */
export interface Text extends ItemBase {
  /** The compiler-generated reference label of a footprint. */
  generated?: 'reference'
  kind: 'text'
  at: Pt
  rot: number
  size: number
  thickness: number
  /** glyph width, when it differs from size */ width?: number
  text: string
  anchor: 'start' | 'middle' | 'end'
  mirrored: boolean
  strokes: Ring[]
  /** "Family Style" of an outline font, "newstroke", or absent for Hershey Simplex */
  font?: string
  /** the filled glyphs of an outline font, contours unioned, holes as holes */
  polys?: Poly[]
}
export type Item = Track | Via | Pad | Zone | Graphic | Text

export interface Footprint {
  /** library-preview reference label; ref remains the stable source/selection identity */
  displayRef?: string
  ref: string
  value: string
  id: string
  at: Pt
  rot: number
  side: 'F' | 'B'
  fields: Record<string, string>
  bom: boolean
  pos: boolean
  description?: string
  /** do not populate: on the board and in the DRC, out of the BOM and placement file */
  dnp?: boolean
  pads: number[]
  /** the outermost component call that placed the footprint, or the <footprint> element itself */
  src?: Src
  /** the call sites from the entry down to the <footprint> element itself, outermost first */
  chain?: Src[]
  /** body height above the board in mm, for the 3D view */
  height?: number
  /** the 3D model descriptor */
  model?: ModelSpec
  /** net tie groups by pad number: pads of one group may touch, each keeping its net */
  netTie?: string[][]
}

export interface Net {
  id: number
  name: string
}

/** One command of a route chain, coordinates in the frame of the enclosing group, layers resolved, lengths in mm. */
export type RouteStep = (
  | { op: 'L' | 'X'; x: number; y: number; rel: boolean }
  | { op: 'H'; x: number; rel: boolean }
  | { op: 'V'; y: number; rel: boolean }
  /** an arc to x, y turning through `angle` degrees, counter-clockwise on screen when positive */
  | { op: 'A'; x: number; y: number; angle: number; rel: boolean }
  /** a via, and with `cross` a crossover of a pair, where P and N swap sides as they change layer; `drill` and `size` in mm over the route's via */
  | { op: 'U'; layer: string; cross?: boolean; drill?: number; size?: number }
  /** the track width from here on */
  | { op: 'W'; width: number }
  /** the fork of branch `id`, a job of its own that starts here */
  | { op: 'B'; id: number }
  | { op: 'Z' | 'XZ' }
) & {
  /** the command's source range when known */
  src?: Src
}
/** A soft keepout of a job, in board mm: a closed ring, or a position still to resolve; on one layer or on all. */
export type JobAvoid = { ring: Pt[]; layer?: string } | { pos: RouteEnd }
/** Per-route autoroute parameters with layer names resolved and lengths in mm; merged over the board's when the job runs. */
export type JobParams = Omit<Partial<AutoRouteParams>, 'via' | 'avoid'> & { via?: { drill?: number; size?: number }; avoid?: JobAvoid[] }

/** A hard keepout in board mm: counter-clockwise rings on the listed copper layers. */
/** A named point of a board, the frame another board's reference mates with: `<mate name at side />`, or a placement's `name` at the part's origin. */
export interface MatePoint {
  name: string
  at: Pt
  rot: number
  side: 'F' | 'B'
  /** the part a placement's name sits on */
  ref?: string
  src?: Src
}

/** A part with an auto slot as this compile placed it: `at` in the frame its `at` is written in, what `pcbjs place --write` writes. */
export interface AutoPlaced {
  ref: string
  at: string
  by: 'placer' | 'solver' | 'follow'
  src?: Src
}

export interface Keepout {
  layers: string[]
  outline: Ring[]
  tracks: boolean
  vias: boolean
  pours: boolean
  /** the nets whose copper may enter it anyway */
  except?: string[]
  ref?: string
  src?: Src
  chain?: Src[]
}

/** A route finished after the rest of the board exists: manual parts first, then automatic legs by priority, then document order. */
export interface AutoRouteJob {
  /** the net given, or inferred from the pads when `infer` */
  net?: string
  /** `.net(null)`: copper on no net, which takes no automatic leg */
  netless?: boolean
  /** the starting layer given, else the first pad's, else F.Cu */
  layer?: string
  /** the width given, else the class width, else the rules' minTrackWidth */
  width?: number
  /** the two ends, coordinates already in board mm; `to` absent for drawn copper or a trunk that ends in branches */
  from?: RouteEnd
  to?: RouteEnd
  /** `route(a, NET)`: the end is the copper of this net nearest the last point */
  toNet?: string
  /** `route(NET)`: every pad of the net joins a tree from `root`, else from its first pad */
  whole?: boolean
  root?: RouteEnd
  /** a branch: it starts where the step `{ op: 'B', id }` of its trunk is */
  fork?: number
  /** a branch or an extra end of a route, whose first job carries its record */
  sub?: boolean
  /** the whole route as written, ends, chains and branches, for the leg keys of a route that has more than two ends or a chain */
  tree?: string
  /** the chain; absent means XZ */
  steps?: RouteStep[]
  /** the frame of the chain: the transform of the enclosing groups */
  m?: Mat
  /** route(a, b): the net comes from the pads */
  infer?: boolean
  /** this route's own parameters */
  params: JobParams
  ref?: string
  src?: Src
  chain?: Src[]
  /** a hold patch: the copper of each automatic leg of the route, in place of routing it, null for a leg it does not hold */
  hold?: (import('./patch.js').Hold | null)[]
  /** a reroute patch: the 1-based legs of the route routed again, never taken from the route memo */
  reroute?: number[]
  /** route(a, b).direct(): the leg reaches its end pads and never joins other copper of its net */
  direct?: boolean
  /** route(a, b).loop(): a loop in the net is intended, no `net-loop` finding */
  loop?: boolean
  /** the chain as text, part of the hash a hold or reroute patch names */
  path?: string
  /** route(a, b).impedance(ohms): flatten turns it into the width, and for a pair the gap */
  impedance?: number
  /** a pair: the N end and net, `from`, `to` and `net` being P's; the job's width is each track's, the path the centre line */
  pair?: { fromN: RouteEnd; toN: RouteEnd; net?: string; gap?: number; skew?: number; uncoupled?: number }
  /** `route:<n>`, counting the route calls of the board from 1 in document order */
  route?: string
  /** route(a, b).length() in mm; the tolerance comes from the class when absent */
  length?: { min?: number; max?: number; target?: number; tolerance?: number }
  /** route(a, b).match(group, tolerance?): the match group, the tolerance in mm when given */
  match?: { group: string; tolerance?: number }
  /** route(a, b).neck() over the class neck, mm: the narrow width at the pads and the longest neck */
  neck?: { width?: number; length?: number }
  /** route(a, b).corner() over the class corner: the radius in mm on the centre line of the manual corners, or 'none' */
  corner?: number | 'none'
  /** route(a, b).current() in amps on this job's route or branch, checked against the width by DRC `current-width` */
  current?: number
  /** route(a, b).solver(fn): asked for each automatic leg before the router, which takes the leg when it returns null */
  solver?: import('./types.js').RouteSolver
}

/** One route call of a board, `route:<n>`, as the router and the tuning pass left it. Lengths in mm. */
export interface RouteRecord {
  id: string
  /** the net, the P net for a pair */
  net?: string
  /** the pair id of a pair route */
  pair?: string
  /** the allowed range from .length(); `max` absent for a minimum only */
  target?: { min: number; max?: number }
  /** the match group, its tolerance */
  group?: string
  tolerance?: number
  /** length added by meanders, for a target or group, and for a pair's skew */
  tuned?: number
  /** why tuning stopped short, when it did */
  note?: string
  /** for a pair, why its skew tuning stopped short, when it did */
  skewNote?: string
  /** how far this route's maximum lies below the group's longest: it caps the group */
  caps?: number
  /** `pt:0` the start, `pt:k` where the k-th chain call ends, board mm */
  pts?: Pt[]
  /** the automatic legs in chain order, `leg:1` first, board mm; `copper` is the leg as the router placed it, before tuning, which a hold keeps */
  legs?: { from: Pt; to: Pt; copper?: import('./patch.js').Hold }[]
  /** 12 hex of the route request, ends, net, width and layers: what a hold or reroute patch of it names */
  hash?: string
  src?: Src
  chain?: Src[]
}

/** One differential pair route as the router placed it, for DRC, inspect and the viewer. Lengths in mm. */
export interface PairInfo {
  /** `pair:<n>`, as its tracks carry in Track.pair */
  id: string
  /** [P, N] */
  nets: [string, string]
  width: number
  gap: number
  /** allowed length difference, DRC pair-skew */
  skew: number
  /** allowed uncoupled length, DRC pair-uncoupled */
  maxUncoupled: number
  /** uncoupled length as routed: the fans at both ends and every via pair */
  uncoupled: number
  src?: Src
  chain?: Src[]
}

/** A leg the autorouter could not route: what it tried and what was in the way. */
export interface RouteFailure {
  net?: string
  /** 1-based index of the automatic leg in its route, and the number of automatic legs */
  leg: number
  legs: number
  from: ResolvedPos
  to: ResolvedPos
  /** the copper layers tried */
  layers: string[]
  /** the router's reason */
  reason: string
  /** ids of up to five items nearest the straight line, nearest first */
  blockers: number[]
  /** the whole message when it is not the leg's, such as a pair whose centre line cannot carry its tracks */
  message?: string
  src?: Src
  chain?: Src[]
}

/** What the autorouter did for a board. */
export interface RoutingReport {
  /** automatic legs attempted, routed, failed, cached and held by a patch; a leg rerouted after a rip counts once */
  legs: number
  routed: number
  failed: number
  cached: number
  held: number
  /** legs a route's `.solver()` laid out; absent when none did */
  solved?: number
  /** legs taken off the board by negotiation to route again; each time counts */
  ripped: number
  /** the rounds of negotiation, absent when every leg routed in order */
  rounds?: number
  /** set when the board is a target of variants() routed once for several targets */
  shared?: {
    targets: string[]
    /** the rules the shared routing used: the strictest of the targets */
    rules: Partial<Rules>
  }
}

export interface DrcMarker {
  /** 'info' tells what the compiler chose not to do; it never counts against a board */
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
  at: Pt
  layer?: string
  /** the items it concerns by this compile's ids; a route-failed's are the blockers */
  items?: number[]
  /** the source range the finding points at, such as the route call of a `route-failed` */
  src?: Src
  /** set when the checks end: the exact id, `drc:<rule>:<12 hex>`, and the fingerprint, see docs/findings.md */
  id?: string
  fingerprint?: string
  /** what the finding concerns in the reference grammar: `R201/2`, `net:VCC`, `route:vccTrunk`, `route:3/leg:2`, `pair:1`; its net and its route are here */
  refs?: string[]
  measured?: Quantity
  required?: Quantity
  witness?: Witness
  /** the levels that set the required value, the winner first */
  provenance?: RuleProvenance[]
  /** the rule's message template reads these beside refs, measured, required and provenance */
  args?: TemplateArgs
}

export interface BoardSchematicPin {
  name: string
  net: string | null
  nc: boolean
}
/** One part of the netlist; `src` is where it was declared. */
export interface BoardSchematicPart {
  ref: string
  displayRef?: string
  value: string
  footprint: string
  prefix: string
  pins: BoardSchematicPin[]
  placed: boolean
  src?: Src
  /** the circuit instance path that owns the part, outermost first, [] at the board level */
  path: string[]
  /** the part's key in its circuit instance, `R1` for Buck1.R1; the ref at the board level */
  local: string
  /** the export of the `<PCB schematic>` module that holds the part, and that module's file */
  export?: SchematicExport
}
/** Where a part or net is declared by name: an export of the schematic module. */
export interface SchematicExport {
  name: string
  module?: string
}
/** One net with its placed pins as "REF.PIN"; `path` is the instance owning a private net. */
export interface BoardSchematicNet {
  name: string
  displayName?: string
  class?: string
  local: boolean
  pins: string[]
  path?: string[]
  export?: SchematicExport
}
/** One circuit instance on the board. */
export interface BoardSchematicCircuit {
  path: string[]
  name: string
  /** the binding that holds the instance, the handle code writes, `ch2` of `ch2.R01` */
  binding?: string
  kind: 'circuit' | 'group'
  /** its definition: a circuit's `${file}#${circuit}`, a group's `<g>` as `${file}#${line}:${col}` */
  def: string
  /** a circuit's name */
  circuit?: string
  /** the layout that placed it, `${file}#${name}`; isolation enters it when present, else `def` */
  layout?: string
  /** the path of the enclosing instance or group, `P1` of `P1/A1` */
  parent?: string
  /** refs of its own parts, in key order */
  parts: string[]
  /** names of its child instances, in key order */
  children: string[]
  /** every part of it and of its child instances is placed */
  placed: boolean
}
export interface BoardSchematic {
  parts: BoardSchematicPart[]
  nets: BoardSchematicNet[]
  circuits: BoardSchematicCircuit[]
  /** the schematic picture, see docs/schematic-graphic.md; set by every compile */
  drawing?: import('./sch-model.js').SchDrawing
}

export interface Ratsnest {
  net: string
  from: Pt
  to: Pt
}

export interface Board {
  name: string
  title: string
  rev: string
  /** copper layer count, 2 to 8 */
  copper: number
  /** board thickness (mm): the stackup's nominal thickness, or the sum of its layers */
  thickness: number
  /** always present, generated from `copper` and `thickness` when the design gives none */
  stackup: Stackup
  rules: ResolvedRules
  /** the net classes by name, lengths in mm; absent when the board defines none */
  classes?: Record<string, ResolvedNetClass>
  layers: LayerDef[]
  nets: Net[]
  items: Item[]
  footprints: Footprint[]
  /** closed outline rings from Edge.Cuts, if they chain */
  outline: Ring[]
  bbox: { x: number; y: number; w: number; h: number }
  drc: DrcMarker[]
  /** electrical rule findings of the schematic layer, the same shape as the DRC markers */
  erc: DrcMarker[]
  /** the netlist as declared: parts in ref order, nets in declaration order */
  schematic: BoardSchematic
  ratsnest: Ratsnest[]
  unconnected: number
  stats: { tracks: number; vias: number; pads: number; zones: number; footprints: number; nets: number }
  /** set on each board of a design compiled with variants(): this target, its place in the list and every target name */
  variant?: { name: string; index: number; names: string[]; fab?: string }
  /** the ordered sourcing tags the BOM resolves with, [] for the catch-all MPN alone */
  sourcingTags: string[]
  /** where cpl.csv places each part, from the preset or `<PCB cpl>`; absent means the footprint origin */
  cpl?: { origin: 'footprint' | 'center' }
  /** outline fonts by "Family Style" with their name table's notices, for README-fab */
  outlineFonts?: Record<string, { copyright?: string; license?: string; licenseURL?: string }>
  /** README-fab Notes: the preset's or target's, then `<PCB fabNotes>` */
  fabNotes?: string[]
  /** hard keepouts, see <keepout> */
  keepouts?: Keepout[]
  /** what the autorouter did, absent when the board has no automatic routes */
  routing?: RoutingReport
  /** the differential pairs the router placed, absent when there are none */
  pairs?: PairInfo[]
  /** every route(a, b) call of the board by route id, in document order; absent when there are none */
  routes?: RouteRecord[]
  /** nets with a `.loop()` route, whose loops are intended; absent when there are none */
  loopNets?: string[]
  /** other entries' boards placed as mechanical references, see references.md; absent when there are none */
  references?: import('./reference.js').BoardReference[]
  /** the named points another board's reference mates with, from `<mate>` and `name` on a placement; absent when there are none */
  mates?: MatePoint[]
  /** where the placer, a solver or the follower pass put each part with an auto slot, see placement.md; absent when there are none */
  placed?: AutoPlaced[]
  /** compile phase wall times in ms; not enumerable, so it stays out of JSON and deep comparisons */
  timings?: { route: number; zones: number; connectivity: number; drc: number; erc: number }
  /** the board's grids, attached and listed, see grids.md; absent when there are none */
  grids?: GridRecord[]
  /** what each placed part, group and route lets the viewer's tools change, see editing.md; absent when there is nothing */
  edit?: EditNode[]
  /** the placement dependency graph; not enumerable, as timings */
  deps?: import('./plugin.js').DepGraph
  /** the data plugin stages and hooks returned, by plugin name; absent without plugins */
  plugins?: Record<string, Record<string, import('./plugin.js').Json>>
}

/** The rules a board gets when it sets none: the cross-fab `BASE` set from `@pcbjs/lib/rules`. */
export const DEFAULT_RULES: Readonly<Rules> = BASE

/** A grid as compiled: a point `(x, y)` in its units is at `origin + R(angle) · M(mirror) · (x, y) · pitch` on the board, mm and degrees counter-clockwise on screen. */
export interface GridRecord {
  maxLevel?: number
  name: string
  pitch: number
  /** the subdivision factors, outermost first */
  minor: number[]
  origin: Pt
  angle: number
  /** the frame is on side B, so x runs mirrored */
  mirror: boolean
  /** the part whose frame it adopts */
  frame: string | null
  /** the defineGrid call */
  src?: Src
  /** the element that attaches it, absent for one only listed in `<PCB grids>` */
  attach?: Src
  /** the parts and groups placed under it, innermost */
  used: string[]
}

/** What the viewer's tools may change on an entity; see editing.md. */
export type Capability = 'placed' | 'layered' | 'chain' | 'viaEnd'
/** One editable entity: a part, group or instance with its placement, a text with its element, or a route with its chain. */
export interface EditNode {
  ref: string
  caps: Capability[]
  /** the element or call that writes each capability's literal */
  src: { at?: Src; chain?: Src }
  /** the frame its `at` is written in: board = m · (x, y) with x and y in mm, pitches already applied */
  m: [number, number, number, number, number, number]
  /** the grid its `at` is in, innermost */
  grid: string | null
  /** persisted placement snapping pitch in mm, independent of coordinate units */
  snap?: { pitch: number; maxLevel?: number }
  /** the slots of `at` that are automatic */
  auto?: ('x' | 'y' | 'rot')[]
  at?: [number, number, number]
  /** the origin of a group’s own grid in board mm, used as its rotation centre */
  pivot?: Pt
  side?: 'F' | 'B'
  /** a route: each chain call's op and source in chain order, aligned with its `pts` after `pt:0` */
  steps?: { op: string; layer?: string; angle?: number; src?: Src }[]
  /** a part a layout element places: that element and the member path under the innermost frame's instance, `R`, for an own placement among its children */
  layout?: { src: Src; member: string }
  /** the definition whose source writes its literal, a circuit record's `def` or `layout`; absent at the board level */
  def?: string
  /** the frames of the instances around it, outermost first, each in the one before, so board = frames composed · local; an instance's own frame is its last */
  frames?: { inst: string; m: [number, number, number, number, number, number] }[]
  /** an instance whose layout element has no `at`, or one its render does not place with: the code computes where it goes, so it takes no tools */
  computed?: true
  /** a part with an own placement among the children of the layout element of this instance, `CH1`: a write to the definition leaves it */
  owned?: string
}
