// Numbers are mm and strings carry a unit; x right and y down seen from the top; rotation in degrees counter-clockwise on screen.
import type { SchAt } from './sch-elements.js'
import type { SymbolDef } from './sch-symbol.js'

export type Length = number | string
export type Rotation = number | string
/** "x y [rot]": lengths with units, mm when bare, and the rotation in degrees, such as "5 3 90". */
export type At = string
/** A current: amps as a number, or a string with A or mA, such as '2A' or '500mA'. */
export type Current = number | string
export type Side = 'F' | 'B'
/** An outline font file, relative to the file that declares it, and for a variable font its weight. */
export interface FontSpec {
  /** a .ttf or .otf file, such as './fonts/RobotoSlab-Bold.ttf' */
  file: string
  /** the `wght` axis of a variable font, such as 700; a static font has its weight in its file */
  weight?: number
  /** set by pcbjs: the absolute path of the file */
  path?: string
}
/** `custom` is a polygon given by the pad's `points`, for KiCad's trapezoid, chamfered and custom pads. */
export type PadShape = 'circle' | 'rect' | 'roundrect' | 'oval' | 'custom'
export type PadType = 'smd' | 'tht' | 'npth'
/** How a pad joins a pour of its own net: through thermal relief spokes, solidly, or not at all. */
export type ThermalConnection = 'thermal' | 'solid' | 'none'
/** A pad's thermal relief: its connection, or an object with the connection and the spoke angle, over the rules' `thermal.angle`. */
export type PadThermal = ThermalConnection | { connect?: ThermalConnection; angle?: 90 | 45 }

/** The kinds of copper a clearance may be scoped to: the other item of the pair. */
export type ClearanceKind = 'pad' | 'track' | 'via' | 'zone' | 'text'
/** A clearance by the other item's kind, `{ track: 0.4 }`; a kind left out keeps the level below, `self` is between pads of one footprint. */
export type KindClearance = Partial<Record<Exclude<ClearanceKind, 'pad'> | 'self', Length>> & { pad?: Length | PadTypeClearance }
/** A clearance toward pads by type, `{ tht: 0.5, smd: 0.2 }`; a type left out, and a non-plated hole, keeps the level below. */
export type PadTypeClearance = { tht?: Length; smd?: Length }
/** A clearance: one length for every other item, or one per kind of the other item. */
export type Clearance = Length | KindClearance
/** A net class's or a net's clearance: one length, or one per kind of the other item, pads also by type. */
export type NetClearance = Length | Omit<KindClearance, 'self'>

/** A 1-based source position; the end is set only when the source-range transform ran. */
export interface Src {
  file: string
  line: number
  col: number
  endLine?: number
  endCol?: number
  /** 12 hex of the sha1 of the range's source text without its own `at` and `side` attributes, set by the source-range transform; item uids hash it */
  hash?: string
  /** the command of a path string the range covers, such as "H 9" */
  seg?: string
  /** a call site read off the stack: where the helper that called route() was called from */
  call?: true
}

export interface PcbNode {
  $$: 'pcb'
  type: string | Component
  props: Record<string, any>
  children: Child[]
  src?: Src
}
/** What JSX takes as a child; any non-string iterable is a list, consumed once at compile time. */
export type Child = PcbNode | Child[] | Iterable<Child> | string | number | null | undefined | false
export type Component<P = any> = (props: P) => Child

/** Thermal relief geometry of pours, KiCad's defaults: gap 0.5, spokeWidth 0.5, spokes 4, angle 90, minSpokes 2. */
export interface ThermalRules {
  /** pour clearance around a pad it joins through spokes (mm) */
  gap: number
  /** spoke width (mm) */
  spokeWidth: number
  spokes: number
  /** 90 puts the spokes along the pad's axes, 45 between them */
  angle: 90 | 45
  /** fewer spokes reaching the fill is the DRC warning thermal-spokes */
  minSpokes: number
}

/** Design rules in mm; the defaults come from `BASE` in `@pcbjs/lib/rules`. */
export interface Rules {
  /** copper to copper, different nets (mm) */
  clearance: number
  minTrackWidth: number
  /** copper to board edge (mm) */
  edgeClearance: number
  /** solder mask opening beyond the pad, each side (mm) */
  maskExpansion: number
  /** paste shrink inside the pad, each side (mm) */
  pasteShrink: number
  /** zone fill: slivers narrower than this are removed (mm) */
  zoneMinWidth: number
  /** hole edge to copper of another net (mm): one length, or `{ inner, outer, via }` */
  holeClearance: number | HoleClearanceBySide
  /** smallest via drill (mm) */
  minViaDrill: number
  /** smallest via copper diameter (mm) */
  minViaDiameter: number
  /** smallest via annular ring: copper radius minus drill radius (mm) */
  minAnnularRing: number
  /** smallest annular ring of a plated through-hole pad, on its smaller size (mm) */
  minPadAnnularRing: number
  /** smallest drill of any hole (mm) */
  minDrill: number
  /** hole edge to hole edge (mm): one length, or `{ pad, via }`, via between two vias */
  minHoleToHole: number | HoleToHoleByKind
  /** thinnest silkscreen stroke (mm) */
  silkMinWidth: number
  /** smallest silkscreen text height, the floor of the silk ref size; absent: 1 (mm) */
  silkMinHeight?: number
  /** silkscreen to pad copper; the DRC flags silk inside the mask opening (mm) */
  silkToPad: number
  /** narrowest solder mask web between two openings, DRC mask-web; absent: not checked (mm) */
  maskWeb?: number
  /** the mask web by mask colour, case ignored, `{ Black: 0.13 }`, over `maskWeb` */
  maskWebByColor?: Record<string, number>
  /** thermal reliefs of pours, merged key by key over the defaults */
  thermal?: Partial<ThermalRules>
  /** fill pieces that touch nothing of their net: 'remove' (default), 'keep', or `{ minArea }` mm²; a pour's `islands` wins */
  islands?: IslandMode
  /** ERC warning unsourced-part for every BOM row without an MPN (default false) */
  requireSourcing?: boolean
  /** a band along the outline that courtyards, silk and pads stay out of, such as an enclosure's sidewall */
  edge?: EdgeBand
}
export type EdgeBandKind = 'courtyard' | 'silk' | 'pad'
/** A band of `width` mm inside the outline and around each cutout; `except` lets parts or pads in. See rules.md Edge band. */
export interface EdgeBand {
  width: number
  kinds?: EdgeBandKind[]
  except?: (PartBase<any, any> | PinRef)[]
  /** set by the compiler: the refs and `REF.PAD` keys `except` lets in */
  refs?: string[]
}
/** Hole to copper: `outer` on F.Cu and B.Cu, `inner` on inner layers, `via` from a via's hole; a side left out keeps the level below. */
export type HoleClearanceBySide = { inner?: number; outer?: number; via?: number }
/** Hole to hole: `via` between two vias, `pad` between any other two; a kind left out keeps the level below. */
export type HoleToHoleByKind = { pad?: number; via?: number }
/** Rules with hole clearances at their largest side for the router; DRC and zones read the sides in `holeClearanceBy` and `minHoleToHoleBy`. */
export interface ResolvedRules extends Omit<Rules, 'holeClearance' | 'minHoleToHole'> {
  holeClearance: number
  minHoleToHole: number
  holeClearanceBy?: { inner: number; outer: number; via?: number }
  minHoleToHoleBy?: { pad: number; via: number }
}
/** What a pour does with fill pieces that touch no pad, via or track of its net. */
export type IslandMode = 'remove' | 'keep' | { minArea: number }
export type CopperName = 'F.Cu' | 'B.Cu' | `In${number}.Cu`
export type Finish = 'HASL' | 'LeadFreeHASL' | 'ENIG' | 'ImmersionSilver' | 'ImmersionTin' | 'OSP' | 'HardGold'
/** One layer of the physical stackup, listed top to bottom. Thicknesses in mm, copper weight in oz. */
export type StackupLayer =
  | { type: 'copper'; name: CopperName; thickness: number; weight?: number }
  | { type: 'core' | 'prepreg'; material?: string; thickness: number; er?: number; lossTangent?: number }
  | { type: 'mask' | 'silk' | 'paste'; side: 'F' | 'B'; thickness?: number }
/** The physical board top to bottom; `thickness` is the ordered thickness, else the sum of the layers. */
export interface Stackup {
  layers: StackupLayer[]
  finish?: Finish
  maskColor?: string
  silkColor?: string
  thickness?: number
}

/** Where `cpl.csv` places a part: its courtyard centre, as JLCPCB wants, or its footprint origin. */
export interface CplOptions {
  origin?: 'footprint' | 'center'
}

export interface BoardProps {
  name: string
  title?: string
  /** the revision, in the fab zip name and README-fab */
  rev?: string
  /** the physical stackup, such as `fourLayer()` or `JLCPCB_4L_7628` from `@pcbjs/lib/stackups`; default `twoLayer()` */
  stackup?: Stackup
  /** a partial rule set merged over the defaults, or a full one such as `JLCPCB` */
  rules?: Partial<Rules>
  /** sourcing tags in order, such as `['LCSC', 'CN']`: the first `MPN:<tag>` a part has wins, else its `MPN` */
  sourcing?: readonly string[]
  /** the placement file origin; JLCPCB presets default to 'center', the rest to 'footprint' */
  cpl?: CplOptions
  /** lines for the Notes of README-fab.txt, after a preset's and a variant target's */
  fabNotes?: readonly string[]
  /** refs of circuit parts: "flat" (default) numbers them per prefix, "hierarchical" makes `BUCK1_R1` */
  refStyle?: 'flat' | 'hierarchical'
  /** preferred via dimensions, separate from manufacturing minima; omitted fields keep the legacy fallback */
  via?: { drill?: Length; size?: Length }
  /** board-wide autoroute parameters, merged key by key over the defaults; a route's `auto` wins */
  autoroute?: Partial<AutoRouteParams>
  /** net classes by name, merged class by class and field by field over the defaults */
  classes?: Record<string, NetClass>
  /** an unroutable leg throws a CompileError instead of the DRC error `route-failed` (default false) */
  strict?: boolean
  /** teardrops at pad to track joints, true or `{ pads, length, width }`; default off; a class's or route's wins */
  teardrops?: boolean | TeardropSpec
  /** draw each footprint's ref on its side's silkscreen (default true) */
  silkRefs?: boolean
  /** outline fonts for `<text font>` by name, each file relative to this file */
  fonts?: Record<string, FontSpec>
  /** the schematic module as a namespace, `import * as sch`: its exports are in scope by name and its `drawing` export is the drawing; without one the compiler draws one */
  schematic?: import('./sch-elements.js').SchematicModule
  /** compiler plugins after the config's, see plugins.md */
  plugins?: readonly import('./plugin.js').PcbPlugin[]
  /** the placer of parts with an auto slot in their `at`: the seed of its search, see placement.md */
  place?: { seed?: number }
  /** patch() nodes, before the inline ones and the entry's .patches.ts file, see patches.md */
  patches?: readonly PcbNode[]
  /** the board's grid: bare positions under it are grid units, see grids.md */
  grid?: import('./grid.js').Grid
  /** grids no element attaches, listed for the viewer and inspect */
  grids?: readonly import('./grid.js').Grid[]
  children?: Child
}

export interface GroupProps {
  /** a hierarchy level: parts placed inside are `name/R1` in findings, inspect and the viewer */
  name?: string
  at?: At
  side?: Side
  /** a named grid for the contents, or { snap } for placement editing; named grids with a frame take no at or side */
  grid?: import('./grid.js').Grid | import('./grid.js').PlacementGrid
  children?: Child
}

/** The generated bodies by kind, sizes in mm; `GENERATED_KINDS` in model-source.ts lists the kinds. */
export interface GeneratedModels {
  /** a chip passive: `body` its length along the pads and width, `cap` the end cap length */
  chip: { part: 'R' | 'C' | 'L' | 'D'; body: [number, number]; cap: number; height: number; marking?: string }
  /** a chip LED with end caps `cap` long, or a PLCC-4 LED such as the WS2812B: a lens `window` across and `lead` pads, length and width */
  led: { body: [number, number]; height: number; color?: string; lens?: 'dome' | 'flat' } & ({ cap: number } | { window: number; lead: [number, number] })
  header: { pins: number; rows: number; pitch: number; pinLength?: number }
  sot23: { pins: 3 | 5 | 6 }
  /** an IC package body: SOIC, TSSOP, SOT-223, QFN, QFP */
  ic: { w: number; h: number; height: number; color?: string }
}
export type GeneratedKind = (typeof import('./model-source.js').GENERATED_KINDS)[number]
/** A generated body, drawn from its own dimensions in the 3D view, the GLB, shots and references alike. */
export type GeneratedSpec = { [K in GeneratedKind]: { kind: K } & GeneratedModels[K] }[GeneratedKind]

/** A part for the 3D view: a generated body, a stand-in, none, or a model file. Sizes are millimetres. */
export type ModelSpec =
  | GeneratedSpec
  /** stands in for a missing model: the 3D view draws it as a dashed outline; `reason` says why there is no model, `fetch` names the one not fetched yet */
  | { kind: 'box'; w: number; h: number; height: number; color?: string; reason?: string; fetch?: string }
  /** no body: bare pads, test points and mounting holes */
  | { kind: 'none' }
  | StepModelSpec

/** A model file with KiCad's conventions: STEP, glTF, GLB or `.wrl`; scale, then rotate about x, y, z in degrees, then offset in mm. */
export interface StepModelSpec {
  kind?: never
  /** such as './models/USB-C.step', relative to the file that holds the literal, or a model fetched on first use: `kicad:<Lib>.3dshapes/<Name>.step`, `lcsc:C123` or an https URL */
  file: string
  offset?: [number, number, number]
  rotate?: [number, number, number]
  scale?: [number, number, number]
  /** the generated model to show while the mesh loads or when the file is missing */
  fallback?: Exclude<ModelSpec, StepModelSpec>
  /** set by the compiler: the absolute path of the file */
  path?: string
}

export interface FootprintProps {
  ref: string
  value?: string
  /** library id, "Lib:Name" */
  id?: string
  at?: At
  side?: Side
  fields?: Record<string, string>
  /** include in the BOM (default true) */
  bom?: boolean
  /** include in the placement file (default true) */
  pos?: boolean
  /** do not populate: out of the BOM and the placement file, still on the board and in the DRC (default false) */
  dnp?: boolean
  /** pad number or name -> how it joins a pour, over the pad's `thermal`, such as `{ EP: 'solid' }` */
  thermal?: Record<string, PadThermal>
  /** rule overrides for every pad of the footprint, as a part's; see PartRules */
  rules?: PartRules
  /** where the silk ref goes, "x y rot" in the footprint's frame, or false for none; by default above the courtyard */
  'ref:at'?: At | false
  description?: string
  /** net tie groups by pad number, `[['1', '2']]`: the pads of one group may touch inside the footprint */
  netTie?: readonly (readonly (string | number)[])[]
  /** body height for the 3D view (default 1 mm; 0 for a bare hole) */
  height?: Length
  /** the 3D model; without one the 3D view draws a box from the Fab outline and the height */
  model?: ModelSpec
  children?: Child
}

export interface PadProps {
  num: string | number
  /** the pin name, when it is not the pad number */
  name?: string
  at?: At
  shape?: PadShape
  /** [w, h] or a diameter */
  size: Length | [Length, Length]
  drill?: Length | [Length, Length]
  type?: PadType
  /** copper layers; default F.Cu for smd, every copper layer for tht */
  layers?: string[]
  /** roundrect corner radius as a fraction of the shorter side (default 0.25) */
  roundness?: number
  /** the polygon of a `custom` pad in its own frame before rotation (mm); `size` stays its bounding box */
  points?: [number, number][]
  /** left unconnected on purpose: matches no pin, takes no net, raises no ERC finding */
  nc?: boolean
  /** copper clearance over the part's, class's and rules', one length or per kind of the other item; see rules.md Overrides */
  clearance?: Clearance
  /** hole clearance of this pad, over its part's and the rules' */
  holeClearance?: Length
  /** solder mask opening beyond this pad, per side, over the rules' maskExpansion (mm) */
  maskExpansion?: number
  /** false: a non-plated hole opens no mask; by default the mask opens over its pad or hole */
  mask?: boolean
  /** paste shrink inside this pad, per side, over the rules' pasteShrink */
  pasteShrink?: Length
  /** paste grown per side by this fraction of the pad size, negative to shrink, as KiCad's paste ratio */
  pasteRatio?: number
  /** true: the pad less the shrink (smd default), false: none, custom polygons, or a grid of windows */
  paste?: boolean | [number, number][][] | PasteWindows
  /** how the pad joins a pour of its net, over the pour's `connect`; `{ angle: 45 }` turns its spokes */
  thermal?: PadThermal
}

/** A grid of paste windows over a pad, for an exposed pad: `coverage` is the paste area over the pad's (default 0.5). */
export interface PasteWindows {
  rows: number
  cols: number
  coverage?: number
}

/** A coordinate string, "x y" or "x y layer", numbers in mm, such as "5 16" or "5 16 B.Cu". */
export type PosString = `${number} ${number}` | `${number} ${number} ${string}`
/** A board position: `{ at, layer }`, a tuple, "x y [layer]", "REF.PAD", a pin handle resolved after placement, or a point of another route. */
export type RouteEnd = { at: At | [number, number]; layer?: string } | [Length, Length, string?] | PosString | PinRef | ViaNode | RoutePoint
/** A point of a route, `vccTrunk.end`, `ch2.vccTrunk.pt(2)`: where its `pt`-th chain call ends, `0` its start, on the layer it is on there; resolved once that route is laid. */
export interface RoutePoint {
  readonly $$: 'route-pt'
  readonly route: RouteBuilder
  readonly pt: number | 'end'
}
/** What `via()` returns: a node to place and a route end, positioned in the frame of the route's group. */
export interface ViaNode extends PcbNode {
  readonly type: 'via'
}
/** A waypoint of `.L(p)` and `.X(p)` in a route chain: a coordinate on the chain's layer, such as '100mil 200mil' or [5, 16], or a via. */
export type Waypoint = `${string} ${string}` | [Length, Length] | { at: At } | ViaNode
/** Neck-down at pads: `width` near the pad, `length` at most from it (default 2 mm, 0 turns it off). */
export interface NeckSpec {
  width?: Length
  length?: Length
}
/** Teardrops at pads: `pads` 'tht', 'smd' or 'all'; `length` and `width` a fraction of the pad's smaller side or a length. */
export interface TeardropSpec {
  pads?: 'tht' | 'smd' | 'all'
  length?: Length
  width?: Length
}
/** A route end in board mm; `layers` lists every layer it may be reached on. */
export interface ResolvedPos {
  x: number
  y: number
  layer: string
  layers?: string[]
}
/** A soft router keepout: a point avoided within 0.5 mm, or a rectangle from its top-left corner. */
export type Avoid = RouteEnd | { x: Length; y: Length; w: Length; h: Length; layer?: string }
/** Autorouter parameters; a route overrides the board's with `auto`. */
export interface AutoRouteParams {
  /** "maze" (grid A* with vias), "straight", or your own RouteFn; default "maze" */
  algorithm: 'maze' | 'straight' | RouteFn
  /** maze grid pitch (mm); default half the track width, clamped to 0.05 .. 0.1 */
  pitch?: number
  /** cost of one via in mm of track; default 5 */
  viaCost: number
  /** copper layers the router may use, the first preferred; default the layers of the leg's ends */
  layers?: string[]
  /** the vias the router places; default the default via of the rules */
  via?: { drill?: Length; size?: Length }
  /** extra margin over the rules around obstacles and the edge (mm); default 0.02 */
  clearance: number
  /** "45" allows diagonal moves, "90" only horizontal and vertical ones; default "45" */
  bend: '45' | '90'
  /** a preferred direction per copper layer */
  prefer?: Record<string, 'h' | 'v'>
  /** the most vias one route may place; default unlimited */
  maxVias?: number
  /** soft keepouts the router crosses only when there is no other way */
  avoid?: Avoid[]
  /** higher runs first, ties in declaration order; default 0 */
  priority: number
  /** allow a via inside an SMD pad of the route's net; default false, per route only */
  viaInPad?: boolean
  /** rounds of negotiated rip-up and reroute; 0 turns it off; default 12 */
  ripup?: number
  /** a leg's cost bound: `ratio` times its straight line or the line plus `floor` mm, whichever is more; ratio 0 for none; default { ratio: 3, floor: 10 } */
  maxDetour?: { ratio?: number; floor?: number }
  /** meander `amplitude`, `spacing` edge to edge and `maxAmplitude` for length and skew tuning (mm); defaults 1, 0.6 and 3 */
  tune?: { amplitude?: Length; spacing?: Length; maxAmplitude?: Length }
}
/** A length target in mm: `min` and `max`, or `target` plus or minus `tolerance`. */
export interface LengthSpec {
  min?: Length
  max?: Length
  target?: Length
  tolerance?: Length
}
/** A net class: route defaults for its nets and limits DRC checks. */
export interface NetClass {
  /** default track width of routes on this class */
  width?: Length
  /** clearance to other nets, one length or per kind of the other item; the larger of two classes holds */
  clearance?: NetClearance
  /** pair gap, edge to edge, for routes with array ends */
  gap?: Length
  /** ohms; resolves width, and gap for pairs, from the stackup when width or gap is not given */
  impedance?: number
  /** allowed length difference of a pair's tracks; default 0.1 mm */
  skew?: Length
  /** allowed uncoupled length of a pair, both ends together; default 5 mm */
  uncoupled?: Length
  /** neck-down at the pads of routes of this class, see `RouteBuilder.neck` */
  neck?: NeckSpec
  /** the corner radius of the manual commands of routes of this class, or 'none', see `RouteBuilder.corner` */
  corner?: Length | 'none'
  /** teardrops at pads: true for the board's, an object over the board's, false for none */
  teardrops?: boolean | TeardropSpec
  /** length and match tolerance; default 0.1 mm */
  tolerance?: Length
  /** the vias of routes of this class */
  via?: { drill?: Length; size?: Length }
  /** copper layers routes of this class may use, the first preferred */
  layers?: string[]
  /** autoroute parameters of routes of this class, over the board's and under the route's own */
  autoroute?: Partial<AutoRouteParams>
  /** loops in the copper of the class's nets are intended: no DRC `net-loop` */
  loops?: boolean
}
/** What a router may use: the board so far, the rules and obstacle queries. */
export interface RouteContext {
  rules: ResolvedRules
  copperLayers: string[]
  /** closed outline rings (mm), empty if Edge.Cuts is not closed */
  outline: [number, number][][]
  /** copper of other nets on a layer, grown by the clearance plus half the width */
  obstacles(layer: string, net: string | undefined, width: number): [number, number][][]
  /** true when a track of this width and net may pass through (x, y) on the layer */
  isFree(layer: string, x: number, y: number, net: string | undefined, width: number): boolean
  /** bounding box of the routable area */
  bbox: { x: number; y: number; w: number; h: number }
}
export interface RouteRequest {
  net?: string
  width: number
  start: ResolvedPos
  end: ResolvedPos
  /** copper layers the router may use; the first is the preferred one */
  layers: string[]
  via: { drill: number; size: number }
  /** grid pitch (mm), absent for the automatic one */
  pitch?: number
  /** cost of one via in mm of track */
  viaCost?: number
  /** extra margin over the rules (mm) */
  clearance?: number
  bend?: '45' | '90'
  prefer?: Record<string, 'h' | 'v'>
  /** the most vias this request may place, absent for unlimited */
  maxVias?: number
  /** soft keepouts in board mm, each a closed ring, on one layer or on all */
  avoid?: { ring: [number, number][]; layer?: string }[]
  /** a via may land inside an SMD pad of the route's net */
  viaInPad?: boolean
  /** a pair leg: `width` is the centre line's 2w + g, `partner` the N net, `via` the disc that holds both vias (mm) */
  pair?: { partner: string; width: number; gap: number }
  /** the cost bound: `ratio` times the straight line or the line plus `floor` mm, whichever is more */
  maxDetour?: { ratio: number; floor: number }
  /** the topology a plugin router lays the leg out in; absent, as for every built-in leg, it stays out of the leg's key */
  topology?: string
  /** the net class of the leg's net; absent, it stays out of the leg's key */
  class?: string
}
export interface RouteResult {
  tracks: { layer: string; pts: [number, number][] }[]
  vias: { x: number; y: number; layers: [string, string] }[]
}
/** What a route's `.solver()` reads besides the router's context: parts, and the routes solvers before it laid out. */
export interface RouteSolverContext extends RouteContext {
  /** a part's origin, rotation and side, board mm */
  part(ref: string): { x: number; y: number; r: number; side: Side } | null
  /** the copper of a route a solver before this one laid out; reading any other route is the error solver-order */
  route(ref: string | RouteBuilder): RouteResult | null
}
/** `.solver(fn)`: the leg's copper, or null to leave the leg to the router. */
export type RouteSolver = (req: RouteRequest, ctx: RouteSolverContext) => RouteResult | null
/** A routing algorithm: returns geometry for the request, or throws with a reason. */
export type RouteFn = (req: RouteRequest, ctx: RouteContext) => RouteResult
/** The raw track the compiler makes: a polyline of `points` in the frame of its group. Hand-drawn copper is a `route()` chain. */
export interface TrackProps {
  net?: Net
  layer: string
  width: Length
  points: At[]
}
/** What `route()` returns: a node to place and a builder. A chain of commands runs from the first end toward the second, which it reaches with `.Z()`, `.X()` or, when it stops short, an automatic leg. */
export interface RouteBuilder extends PcbNode {
  /** the route's start as a route point, `pt:0`, for another route's end or an `at:follow` near */
  readonly start: RoutePoint
  /** where the route's last chain call ends, or its end when the chain runs to it */
  readonly end: RoutePoint
  /** where the k-th chain call ends, `pt(0)` the start */
  pt(k: number): RoutePoint
  /** track width (mm) from here on; before any command it is the route's width, default the class width, else the rules' minTrackWidth */
  width(w: Length): RouteBuilder
  /** the starting layer; default the layer of the first end when it is a pad, else F.Cu */
  layer(name: string): RouteBuilder
  /** the copper layers the automatic legs may use */
  layers(names: string[]): RouteBuilder
  /** false forbids vias in the automatic legs; an object sets the drill and copper size of every via of the route */
  vias(v: false | { drill?: Length; size?: Length }): RouteBuilder
  /** autoroute parameters without a method of their own, merged over the board's */
  rules(params: Omit<Partial<AutoRouteParams>, 'layers' | 'via' | 'priority'>): RouteBuilder
  /** routes with a higher priority run first; default 0 */
  priority(n: number): RouteBuilder
  /** the net, required when no end is a pad; null for copper on no net; a pair takes `.net(P, N)` */
  net(n: Net | null, nN?: Net): RouteBuilder
  /** `route(NET)`: the pad every other pad of the net joins toward; default its first pad */
  root(end: RouteEnd): RouteBuilder
  /** narrow the ends near pads where the full width does not fit, for at most `length` mm (default 2); `{ length: 0 }` turns it off */
  neck(spec: NeckSpec): RouteBuilder
  /** teardrops at this route's pads, whatever the board and class say */
  teardrops(on: boolean | TeardropSpec): RouteBuilder
  /** round manual corners with radius `r` on the centre line, shrinking to a chamfer or square where needed; 'none' for square */
  corner(r: Length | 'none'): RouteBuilder
  /** the automatic legs reach their end pads themselves and never join other copper of the net, for Kelvin sense and star returns */
  direct(on?: boolean): RouteBuilder
  /** a loop in this route's net is intended: no DRC `net-loop` for the net */
  loop(on?: boolean): RouteBuilder
  /** amps the route carries, such as '2A' or '500mA': DRC `current-width` checks each width against the stackup copper per IPC-2152, branches summing toward the root */
  current(amps: Current): RouteBuilder
  /** each automatic leg asks `fn` first, see RouteSolver; the router takes a leg it returns null for */
  solver(fn: RouteSolver): RouteBuilder
  /** reserved for bus topologies such as fly-by and star */
  topology(kind: string): RouteBuilder
  /** a pair only: the gap between its two tracks edge to edge; default the class gap, else the track width */
  gap(g: Length): RouteBuilder
  /** a pair only: the allowed length difference, DRC `pair-skew`; default the class skew, else 0.1 mm */
  skew(s: Length): RouteBuilder
  /** ohms: a single route takes its width, a pair its width and gap from the stackup, holding whichever was given */
  impedance(ohms: number): RouteBuilder
  /** a length target (mm): a number plus or minus the class tolerance, or an object; short routes get a meander, misses are DRC `length` */
  length(spec: Length | LengthSpec): RouteBuilder
  /** join a match group: shorter routes are tuned to within the tolerance of the longest, DRC `length-match`; default the class tolerance */
  match(group: string, tolerance?: Length): RouteBuilder
  /** a manual track to x, y, or to a waypoint; lengths are mm numbers or strings with units */
  L(x: Length, y: Length): RouteBuilder
  L(p: Waypoint): RouteBuilder
  /** a manual track by dx, dy from the cursor */
  l(dx: Length, dy: Length): RouteBuilder
  /** a manual track to x */
  H(x: Length): RouteBuilder
  /** a manual track by dx */
  h(dx: Length): RouteBuilder
  /** a manual track to y */
  V(y: Length): RouteBuilder
  /** a manual track by dy */
  v(dy: Length): RouteBuilder
  /** a manual arc to x, y turning through `angle`, degrees or '1.2rad', counter-clockwise on screen when positive */
  A(x: Length, y: Length, angle: Rotation): RouteBuilder
  /** a manual arc by dx, dy from the cursor, see `A` */
  a(dx: Length, dy: Length, angle: Rotation): RouteBuilder
  /** a via at the cursor, the route continues on `layer`; `drill` and `size` override the route's via for this one */
  via(layer: string, opts?: ChainViaOptions): RouteBuilder
  /** a pair only: a crossover at the cursor, a via pair where P and N swap sides as the pair continues on `layer` */
  cross(layer: string): RouteBuilder
  /** with a waypoint, an automatic leg to it; without, an automatic leg to the route's end, which finishes the chain */
  X(p?: Waypoint): RouteBuilder
  /** a straight manual track to the route's end, which finishes the chain */
  Z(): RouteBuilder
  /** fork here: each sub-chain `b(end)` starts at this point and runs to its own end, with its own width and vias */
  branch(...fns: ((b: (end: RouteEnd) => Branch) => Branch)[]): RouteBuilder
}
/** A sub-chain of `.branch()`: the chain commands, `.width()` and `.branch()`, from the fork to its end. */
export type Branch = Pick<RouteBuilder, 'width' | 'current' | 'L' | 'l' | 'H' | 'h' | 'V' | 'v' | 'A' | 'a' | 'via' | 'X' | 'Z'> & {
  branch(...fns: ((b: (end: RouteEnd) => Branch) => Branch)[]): Branch
}
/** The options of a chain's `.via(layer, opts)`: this via's drill and copper size, default the route's via. */
export type ChainViaOptions = Pick<ViaOptions, 'drill' | 'size'>
/** The options of `via(net, at, opts)`: the default via of the rules when no sizes are given. */
export interface ViaOptions {
  drill?: Length
  size?: Length
  layers?: [string, string]
}
/** The options of `keepout(area, opts)`: each kind of copper is kept out unless set false. */
export interface KeepoutOptions {
  /** the copper layers it holds on, default every one */
  layers?: string[]
  /** no tracks inside (default true) */
  tracks?: boolean
  /** no vias inside (default true) */
  vias?: boolean
  /** no pour fill inside (default true) */
  pours?: boolean
  /** nets whose copper may enter anyway, in DRC, pours and the router */
  except?: Net[]
}
/** The options of `pour(net, layer, area, opts)`. */
export interface PourOptions {
  clearance?: Length
  priority?: number
  minWidth?: Length
  /** how same-net pads join the fill: 'thermal' spokes (default), 'solid', or 'none'; vias are always solid */
  connect?: ThermalConnection
  /** fill pieces that touch no pad, via or track of the net: removed by default, see IslandMode; a pour on no net keeps them all */
  islands?: IslandMode
}
/** The options of `stitch(net, opts)`: vias on a `pitch` lattice wherever every listed layer has the net's fill under the via; the pours refill after. */
export interface StitchOptions {
  /** lattice pitch (mm), default 4; a via or through-hole pad of the net within it suppresses a point */
  pitch?: Length
  /** layers that must have the net's fill at the via, default all; the vias go through every layer */
  layers?: string[]
  /** copper to copper from a stitching via to any pad, default the rules' clearance */
  padClearance?: Length
  /** the via, default the rules' default via */
  via?: { drill?: Length; size?: Length }
  /** keep the vias silkToPad off silk, or out of every courtyard */
  avoid?: { silk?: boolean; courtyard?: boolean }
  /** every via lands on this grid about `origin`, for a via grid rule */
  grid?: Length
  /** lattice origin in board mm, default the board corner, or 0 0 with `grid` */
  origin?: At
  /** an SVG path: the vias go only inside its closed areas */
  area?: string
}
export interface PathProps {
  layer: string
  d: string
  width?: Length
  fill?: boolean
  net?: Net
}
export interface LineProps {
  layer: string
  x1: Length
  y1: Length
  x2: Length
  y2: Length
  width?: Length
}
export interface CircleProps {
  layer: string
  cx?: Length
  cy?: Length
  r: Length
  width?: Length
  fill?: boolean
}
export interface RectProps {
  layer: string
  x: Length
  y: Length
  w: Length
  h: Length
  rx?: Length
  width?: Length
  fill?: boolean
}
/** Text in a stroke font or an outline font: `size` is the cap height, `thickness` the stroke, `width` the glyph width (default `size`). */
export interface TextProps {
  /** persisted editing pitch, independent of coordinate units */
  grid?: import('./grid.js').PlacementGrid
  layer: string
  at?: At
  size?: Length
  thickness?: Length
  width?: Length
  anchor?: 'start' | 'middle' | 'end'
  /** "hershey" (default), "newstroke", or a name of the board's `fonts` */
  font?: string
  /** outline fonts on silk: grow ink thinner than silkMinWidth instead of the silk-width warning */
  thicken?: boolean
  net?: Net
  children?: string | number | (string | number)[]
}

export interface IntrinsicElements {
  board: BoardProps
  g: GroupProps
  footprint: FootprintProps
  pad: PadProps
  track: TrackProps
  path: PathProps
  line: LineProps
  circle: CircleProps
  rect: RectProps
  text: TextProps
  mate: MateProps
}

/** A net as a value. Made by `nets()`, `bus()` or `local()`; two nets with the same name and scope are the same net. */
export interface Net {
  readonly $$: 'net'
  readonly name: string
  readonly class?: string
  readonly local?: boolean
  /** an anonymous net class of this net alone, over its own class; returns the same net */
  rules(r: NetRules): Net
}
/** The rules of `net.rules()`: the fields of an anonymous class that holds only this net. */
export interface NetRules {
  clearance?: NetClearance
}
/** Rule overrides for every pad of a part: a pad's own setting wins, and they win over the class and the rules. */
export interface PartRules {
  /** copper clearance of the part's pads to other nets, one length or one per kind of the other item, `{ track: 0.4, self: 0.2 }` */
  clearance?: Clearance
  /** how close the part's pads may come to the board edge */
  edgeClearance?: Length
  /** hole clearance of the part's pads and holes */
  holeClearance?: Length
  /** the narrowest track that may join one of the part's pads, over minTrackWidth */
  trackWidth?: Length
  /** the thermal relief of the part's pads: `{ angle: 45 }` over the rules' `thermal.angle` */
  thermal?: { angle?: 90 | 45 }
}
/** The sentinel for a pin left open on purpose: `NC`. */
export interface NoConnect {
  readonly $$: 'nc'
}
/** What a pin connects to. */
export type Connection = Net | NoConnect
/** A handle on a pin, `D1.A`, or a pad, `J1[3]`; as a route end, the pad nearest the other end. */
export interface PinRef {
  readonly $$: 'pin'
  readonly part: Part<any>
  /** the pin name, or the pad key for a pad handle */
  readonly pin: string
  /** set on a pad handle: the pad number or name it addresses */
  readonly pad?: string
  /** the pin's net; throws when unconnected, `NC` for a pin or pad left open */
  readonly net: Net
}
/** A handle on one pad of a part, `J1['B6']`: a pin handle narrowed to one pad, taken wherever a pin handle is. */
export interface PadRef<D extends string = string> extends PinRef {
  readonly pad: D
}
/** The props of a placed part, `<R1 at="12 5" />`; a slot of `at` written `auto` is chosen by the placer, see placement.md. */
export interface PlaceProps {
  /** prevent preview changes to this placement; expressions are evaluated on compilation */
  locked?: boolean
  /** persisted editing pitch, independent of coordinate units */
  grid?: import('./grid.js').PlacementGrid
  /** "x y rot" in the frame of the enclosing groups; `auto` for all three, or for one slot, "10mm auto 90deg" */
  at?: At
  side?: Side
  /** where the search over the auto slots starts, "x y rot" in the frame of `at` */
  'at:initial'?: At
  /** a cost the placer adds for the pose x, y, rot in the frame of `at`, or null to forbid it */
  'at:cost'?: PlaceCost
  /** a pose for the auto slots, or null to leave them to the placer; wins over at:cost and may call it */
  'at:solver'?: PlaceSolver
  /** placed beside the copper of a route after routing, its own connections routed after it */
  'at:follow'?: FollowSpec
  /** a named point at the part's origin, which another board's reference mates with */
  name?: string
  /** pad number or name -> how that pad joins a pour, over the footprint's, such as `{ EP: 'solid' }` */
  thermal?: Record<string, PadThermal>
  /** where the silk ref goes, "x y rot" in the footprint's frame, or false for none; by default above the courtyard */
  'ref:at'?: At | false
  children?: Child
}
/** A part's pose in the frame its `at` is written in: mm and degrees. */
export interface PlacePose {
  x: number
  y: number
  r: number
}
/** A part as the placer sees it, board mm: its origin, rotation, side and courtyard box. */
export interface PlacedPart {
  x: number
  y: number
  r: number
  side: Side
  box: { x: number; y: number; w: number; h: number }
}
/** The board while it is placed: every part with a place so far. */
export interface PlaceLayout {
  /** a part by ref or as the part, null while it has no place */
  part(ref: string | PartBase<any, any>): PlacedPart | null
  /** the closed outline rings, board mm */
  readonly outline: [number, number][][]
}
/** `at:cost`: the placer adds what it returns for the pose, and never takes a pose it returns null for. */
export type PlaceCost = (layout: PlaceLayout, x: number, y: number, r: number) => number | null
/** What `at:solver` is asked to place. */
export interface PlaceRequest {
  ref: string
  /** the slots `at` fixes, null where it says auto; a fixed slot wins over the pose returned */
  fixed: [number | null, number | null, number | null]
  /** `at:initial`, when given */
  initial?: PlacePose
  /** the part's `at:cost` on this layout, when it has one */
  cost?: (x: number, y: number, r: number) => number | null
}
/** `at:solver`: a pose, or null for the placer to choose. */
export type PlaceSolver = (layout: PlaceLayout, part: PlaceRequest) => PlacePose | null
/** `at:follow`: beside the routed copper of `route`, at its point nearest `near`, on its `side` seen from the route's start, `distance` from its centre line. */
export interface FollowSpec {
  /** a bound route, or its id such as 'route:3' */
  route: RouteBuilder | string
  /** a pin or pad handle, a part, a route point such as `vccTrunk.end`, or a position "x y"; default the middle of the route */
  near?: PinRef | PartBase<any, any> | RoutePoint | At
  /** default the side with more room */
  side?: 'left' | 'right'
  /** from the centre line to the part's origin; default clear of the track by the clearance */
  distance?: Length
}
/** The props of `<mate name at side />`: a named point another board's reference mates with. */
export interface MateProps {
  name: string
  at?: At
  side?: Side
}

/** The props of a part inside `<Schematic>` or `<Sheet>`, `<R1 at="10 6" flip />`: its symbol, in grid units. */
export interface SymPlaceProps {
  /** omitted positions are placed automatically */
  at?: SchAt
  /** lock this schematic placement independently of its PCB placement */
  locked?: boolean
  /** degrees counterclockwise, a multiple of 90 */
  rot?: 0 | 90 | 180 | 270
  /** mirrored left to right before the rotation */
  flip?: boolean
  /** this placement's symbol over the part's */
  symbol?: SymbolDef
}
type Only<A, B> = A & { [K in Exclude<keyof B, keyof A>]?: never }
/** A part as JSX: its footprint on the board, its symbol inside `<Schematic>`. */
export type PartProps = Only<PlaceProps, SymPlaceProps> | Only<SymPlaceProps, PlaceProps>
/** Sourcing: `MPN` is the catch-all part number, `MPN:<tag>` one per target, tags case-insensitive; any other key is a BOM field. */
export interface SourcingSpec {
  /** the catch-all part number, used when none of the target's tags has its own */
  MPN?: string
  Manufacturer?: string
  Datasheet?: string
  Description?: string
  /** the part number for one sourcing tag, such as `'MPN:LCSC': 'C23138'` */
  [tagged: `MPN:${string}`]: string
  [field: string]: string | undefined
}

/** What a footprint factory takes after the value, `R0603('330', { dnp: true })`. */
export interface PartOptions {
  /** the ref of a part no binding names, such as one made in a loop: `LED0603('red', { ref: `D${i + 1}` })` */
  ref?: string
  /** include in the BOM (default true) */
  bom?: boolean
  /** include in the placement file (default true) */
  pos?: boolean
  /** do not populate the part: out of the BOM and the placement file, still on the board and in the DRC */
  dnp?: boolean
  /** body height for the 3D view */
  height?: Length
  model?: ModelSpec
}
/** A part: one component of the schematic, placed on the board as a JSX element. `P` names its pins. */
export interface PartBase<P extends string, D extends string = never> {
  (props: PartProps): PcbNode
  readonly $$: 'part'
  /** a Net or NC per pin by name, `{ A: LED, K: GND }`; returns the same part */
  connect(pins: { [K in P]?: Connection }): Part<P, D>
  /** sourcing keys and BOM fields, merged over earlier ones, later calls win */
  source(spec: SourcingSpec): Part<P, D>
  /** rule overrides for every pad, merged key by key over earlier calls */
  rules(r: PartRules): Part<P, D>
  readonly value: string | undefined
  readonly prefix: string
  /** the declared pin names, in order */
  readonly pins: readonly string[]
  /** the footprint's named points, `U1.points.center`, from `defineFootprint(render, { points })` */
  readonly points: Readonly<Record<string, import('./grid.js').FootprintPoint>>
}
/** A part: pins are keys, `D1.A`, and so are pads that are not pins, `J1['B6']`; a number is a pad number, never a pin position. */
export type Part<P extends string = string, D extends string = never> = PartBase<P, D> & PinKeys<P> & PadKeys<P, D> & NumberKeys<P, D>
/** The pin keys of a part; names widened to `string` give none, so declare footprint pins inline or `as const`. */
export type PinKeys<P extends string> = 0 extends 1 & P
  ? { readonly [k: string]: PinRef }
  : string extends P
    ? { readonly 'pin names are untyped: declare the pins of defineFootprint inline or as const'?: never }
    : { readonly [K in P]: PinRef }
/** One pad key per literal pad id that is not a pin name. */
export type PadKeys<P extends string, D extends string> = [D] extends [never] ? {} : string extends D ? {} : 0 extends 1 & P ? {} : { readonly [K in Exclude<D, P>]: PadRef<K> }
/** Any number key when the pads are untyped or list no numbers, so `J1[3]` type-checks on a header. */
export type NumberKeys<P extends string, D extends string> = 0 extends 1 & P
  ? { readonly [n: number]: PinRef }
  : string extends D
    ? { readonly [n: number]: PinRef }
    : [Extract<D, `${number}`>] extends [never]
      ? { readonly [n: number]: PinRef }
      : {}
/** Pin metadata a footprint component declares: names in pin order, or a function of the footprint's props. */
export type PinList = readonly string[] | ((props: any) => readonly string[])
/** A footprint with its schematic metadata: `R0603('330')` makes a part. `Props` are the props its footprint renders with. */
export interface FootprintFactory<P extends string = string, Props = FootprintProps, D extends string = never> {
  (value?: string | number, options?: PartOptions): Part<P, D>
  (options: PartOptions): Part<P, D>
  readonly pins: PinList
  /** pad numbers or names left unconnected on purpose */
  readonly nc?: PinList
  readonly prefix: string
  readonly id?: string
}
