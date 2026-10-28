// Numbers are mm and strings carry a unit; x right and y down seen from the top; rotation in degrees counter-clockwise on screen.
import type { SchAt } from './sch-elements.js'
import type { SymbolDef } from './sch-symbol.js'

export type Length = number | string
export type Rotation = number | string
/** "x y [rot]" with units, or a tuple in mm / degrees. */
export type At = string | [Length, Length] | [Length, Length, Rotation]
export type Side = 'F' | 'B' | 'top' | 'bottom'
/** An outline font file, relative to the file that holds the literal, and for a variable font its weight. */
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

/** `net:pad1="GND"` sets pad 1, `net:A="LED"` the pad numbered or named A; JSX cannot write `net:1`, use `nets={{ 1: … }}`. */
export type NetAttrs = { [k: `net:pad${number}`]: NetLike; [k: `net:${string}`]: NetLike }

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
  /** reject string nets once the board uses parts or Net values (default false) */
  strictNets?: boolean
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
  except?: (PartBase<any, any> | PinRef | string)[]
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
/** A complete rule set, such as `JLCPCB` from `@pcbjs/lib/rules`. */
export type Ruleset = Rules

export type CopperName = 'F.Cu' | 'B.Cu' | `In${number}.Cu`
export type Finish = 'HASL' | 'LeadFreeHASL' | 'ENIG' | 'ImmersionSilver' | 'ImmersionTin' | 'OSP' | 'HardGold'
/** One layer of the physical stackup, listed top to bottom. Thicknesses in mm, copper weight in oz. */
export type StackupLayer =
  | { type: 'copper'; name: CopperName; thickness: number; weight?: number }
  | { type: 'core' | 'prepreg'; material?: string; thickness: number; er?: number; lossTangent?: number }
  | { type: 'mask' | 'silk' | 'paste'; side: 'F' | 'B'; thickness?: number; color?: string }
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
  revision?: string
  /** number of copper layers, the short form of `stackup`: 2, 4, 6 or 8 */
  copper?: 2 | 4 | 6 | 8
  /** board thickness (mm); with a stackup it must agree with the stackup */
  thickness?: number
  /** the physical stackup; when `copper` is given too, they must agree */
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
  /** outline fonts for `<text font>` by name, a .ttf or .otf relative to this file, over pcb.config.ts */
  fonts?: Record<string, string | FontSpec>
  /** the schematic: a drawing, `<Schematic>` or `schematic({ … })`, or a module namespace, `import * as sch`, whose drawing export is used and whose export names name its parts; without a drawing the compiler draws one */
  schematic?: PcbNode | import('./sch-elements.js').SchematicModule
  children?: Child
}

export interface GroupProps {
  at?: At
  side?: Side
  children?: Child
}

/** A part for the 3D view, generated on demand from this descriptor. Sizes are millimetres. */
export type ModelSpec =
  | { kind: 'chip'; part: 'R' | 'C' | 'L' | 'D'; size: '0402' | '0603' | '0805' | '1206'; marking?: string }
  /** a chip LED, or a PLCC-4 RGB LED such as the WS2812B in 2020 and 5050 */
  | { kind: 'led'; size: '0402' | '0603' | '0805' | '1206' | '2020' | '5050'; color?: string; lens?: 'dome' | 'flat' }
  | { kind: 'header'; pins: number; rows: number; pitch: number; pinLength?: number }
  | { kind: 'sot23'; pins: 3 | 5 | 6 }
  /** an IC package body: SOIC, TSSOP, SOT-223, QFN, QFP */
  | { kind: 'ic'; w: number; h: number; height: number; color?: string }
  /** stands in for a missing model: the 3D view draws it as a dashed outline; `reason` says why there is no model, `fetch` names the one not fetched yet */
  | { kind: 'box'; w: number; h: number; height: number; color?: string; reason?: string; fetch?: string }
  /** no body: bare pads, test points and mounting holes */
  | { kind: 'none' }
  | StepModelSpec

/** A model file with KiCad's conventions: STEP, glTF, GLB or `.wrl`; scale, then rotate about x, y, z in degrees, then offset in mm. */
export interface StepModelSpec {
  kind?: 'step'
  /** such as './models/USB-C.step', relative to the file that holds the literal, or a model fetched on first use: `kicad:<Lib>.3dshapes/<Name>.step`, `lcsc:C123` or an https URL; `file` or `step` is needed */
  file?: string
  /** the older name of `file`; pcbjs sets it to the absolute path */
  step?: string
  offset?: [number, number, number]
  rotate?: [number, number, number]
  scale?: [number, number, number]
  /** the generated model to show while the mesh loads or when the file is missing */
  fallback?: Exclude<ModelSpec, StepModelSpec>
  /** set by the compiler: the absolute path of the file */
  path?: string
}

export interface FootprintProps extends NetAttrs {
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
  /** pad number or name -> net, the object form of `net:pad1` / `net:A` attributes */
  nets?: Record<string, NetLike>
  /** pad number or name -> how it joins a pour, over the pad's `thermal`, such as `{ EP: 'solid' }` */
  thermal?: Record<string, PadThermal>
  /** rule overrides for every pad of the footprint, as a part's; see PartRules */
  rules?: PartRules
  /** where the silk ref goes, "x y rot" in the footprint's frame, or false for none; by default above the courtyard */
  refAt?: At | false
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
  /** pin name, lets footprints expose `net:A` instead of `net:pad1` */
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
  net?: NetLike
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
/** A board position: `{ at, layer }`, a tuple, "x y [layer]", "REF.PAD", or a pin handle resolved after placement. */
export type Pos = { at: At; layer?: string } | [Length, Length, string?] | PosString | `${string}.${string}` | PinRef | ViaNode
/** What `via()` returns: a node to place and a route end, positioned in the frame of the route's group. */
export interface ViaNode extends PcbNode {
  readonly type: 'via'
}
/** One end of `route(a, b)`, the type to give a helper's end parameter: the same as `Pos`. A pair end is `[RouteEnd, RouteEnd]`. */
export type RouteEnd = Pos
/** What `.Z()` and `.X()` of a route chain take: an end, a pair end `[P, N]`, or a position with units such as '100mil 200mil'. */
export type RouteTarget = Pos | readonly [Pos, Pos] | `${string} ${string}`
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
/** Corner `radius` on the centre line, or 'none'; default the pitch for a pair, 'none' for a single route. */
export interface CornerSpec {
  radius?: Length | 'none'
}
/** A route end in board mm; `layers` lists every layer it may be reached on. */
export interface ResolvedPos {
  x: number
  y: number
  layer: string
  layers?: string[]
}
/** A soft router keepout: a point avoided within 0.5 mm, or a rectangle from its top-left corner. */
export type Avoid = Pos | { x: Length; y: Length; w: Length; h: Length; layer?: string }
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
  /** a leg's cost bound: `ratio` times its straight line or the line plus `floor` mm, whichever is more; 0 for none; default { ratio: 3, floor: 10 } */
  maxDetour?: number | { ratio?: number; floor?: number }
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
  /** the corners of the manual commands of routes of this class, see `RouteBuilder.corner` */
  corner?: CornerSpec
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
}
export interface RouteResult {
  tracks: { layer: string; pts: [number, number][] }[]
  vias: { x: number; y: number; layers: [string, string] }[]
}
/** A routing algorithm: returns geometry for the request, or throws with a reason. */
export type RouteFn = (req: RouteRequest, ctx: RouteContext) => RouteResult
/** One autorouted connection, the legacy form: `start`, `end` and any autoroute parameter. */
export interface AutoRoute extends Partial<AutoRouteParams> {
  start: Pos
  end: Pos
}
/** A track: `d` is an SVG path, an AutoRoute, a RouteFn, or omitted to connect every item of `net`; `from`, `to` and `path` come from `route()`. */
export interface TrackProps {
  net?: NetLike
  layer: string
  width: Length
  d?: string | AutoRoute | RouteFn
  points?: At[]
  layers?: string[]
  via?: { drill?: Length; size?: Length }
  auto?: Partial<AutoRouteParams>
  from?: Pos | [Pos, Pos]
  to?: Pos | [Pos, Pos]
  path?: string
  /** pin the automatic legs to their stored result, see `RouteBuilder.lock` */
  lock?: boolean
  /** reach the end pads without joining other copper of the net, see `RouteBuilder.direct` */
  direct?: boolean
  /** a loop in the net is intended, see `RouteBuilder.loop` */
  loop?: boolean
  /** let the router place vias inside SMD pads of this net */
  viaInPad?: boolean
  /** set by route() when both ends are [P, N] pairs */
  pair?: boolean
  /** pair gap edge to edge, see `RouteBuilder.gap` */
  gap?: Length
  /** allowed length difference of a pair, see `RouteBuilder.skew` */
  skew?: Length
  /** ohms, see `RouteBuilder.impedance` */
  impedance?: number
  /** a length target, see `RouteBuilder.length` */
  length?: Length | LengthSpec
  /** a match group and its tolerance, see `RouteBuilder.match` */
  match?: string | { group: string; tolerance?: Length }
  /** the N net of a pair, see `RouteBuilder.net` */
  netN?: NetLike
  /** neck-down at the pads, see `RouteBuilder.neck` */
  neck?: NeckSpec
  /** the corner radius, see `RouteBuilder.corner` */
  corner?: Length | 'none'
  /** teardrops at its pads, see `RouteBuilder.teardrops` */
  teardrops?: boolean | TeardropSpec
}
/** What `route()` returns: a node to place and a builder; the path is a chain ending in `.Z(b)` or `.X(b)`, or a route path string, default `XZ`. */
export interface RouteBuilder extends PcbNode {
  /** track width (mm); default the rules' minTrackWidth */
  width(w: Length): RouteBuilder
  /** the starting layer; default the layer of `a` when it is a pad, else F.Cu */
  layer(name: string): RouteBuilder
  /** the copper layers the automatic legs may use */
  layers(names: string[]): RouteBuilder
  /** false forbids vias in the automatic legs; an object sets the drill and copper size of every via of the route */
  vias(v: boolean | { drill?: Length; size?: Length }): RouteBuilder
  /** autoroute parameters for this route, merged over the board's */
  rules(params: Partial<AutoRouteParams>): RouteBuilder
  /** routes with a higher priority run first; default 0 */
  priority(n: number): RouteBuilder
  /** the net, required when neither end is a pad; a pair takes `.net(P, N)` */
  net(n: NetLike, nN?: NetLike): RouteBuilder
  /** narrow the ends near pads where the full width does not fit, for at most `length` mm (default 2); `{ length: 0 }` turns it off */
  neck(spec: NeckSpec): RouteBuilder
  /** teardrops at this route's pads, whatever the board and class say */
  teardrops(on: boolean | TeardropSpec): RouteBuilder
  /** round manual corners with radius `r` on the centre line, shrinking to a chamfer or square where needed; 'none' for square */
  corner(r: Length | 'none'): RouteBuilder
  /** pin the automatic legs to their result in .pcbjs/routes/<board>.json until the ends or path change */
  lock(on?: boolean): RouteBuilder
  /** the automatic leg reaches its end pads itself and never joins other copper of its net, for Kelvin sense and star returns */
  direct(on?: boolean): RouteBuilder
  /** a loop in this route's net is intended: no DRC `net-loop` for the net */
  loop(on?: boolean): RouteBuilder
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
  /** a manual track to x, y, `L x y`; lengths are mm numbers or strings with units */
  L(x: Length, y: Length): RouteBuilder
  /** a manual track by dx, dy from the cursor, `l dx dy` */
  l(dx: Length, dy: Length): RouteBuilder
  /** a manual track to x, `H x` */
  H(x: Length): RouteBuilder
  /** a manual track by dx, `h dx` */
  h(dx: Length): RouteBuilder
  /** a manual track to y, `V y` */
  V(y: Length): RouteBuilder
  /** a manual track by dy, `v dy` */
  v(dy: Length): RouteBuilder
  /** a via at the cursor, the route continues on `layer`, `@layer` */
  via(layer: string): RouteBuilder
  /** a pair only: a crossover at the cursor, a via pair where P and N swap sides as the pair continues on `layer` */
  cross(layer: string): RouteBuilder
  /** a straight track to the target; the last `.Z` or `.X` ends the route, an earlier one is a waypoint */
  Z(target: RouteTarget): RouteBuilder
  /** an automatic leg to the target; the last `.Z` or `.X` ends the route, an earlier one is a waypoint */
  X(target: RouteTarget): RouteBuilder
}
export interface ViaProps {
  net?: NetLike
  at: At
  drill?: Length
  size?: Length
  layers?: [string, string]
}
/** A hard keepout: closed areas of `d` on the named copper layers, default all, that the named kinds of copper may not enter. */
export interface KeepoutProps {
  layer?: string
  layers?: string[] | 'all'
  d: string
  /** no tracks inside (default true) */
  tracks?: boolean
  /** no vias inside (default true) */
  vias?: boolean
  /** no pour fill inside (default true) */
  pours?: boolean
  /** nets whose copper may enter anyway, in DRC, pours and the router */
  except?: NetLike[]
}
export interface ZoneProps {
  net?: NetLike
  layer: string
  d: string
  clearance?: Length
  priority?: number
  minWidth?: Length
  /** how same-net pads join the fill: 'thermal' spokes (default), 'solid', or 'none'; vias are always solid */
  connect?: ThermalConnection
  /** fill pieces that touch no pad, via or track of the net: removed by default, see IslandMode */
  islands?: IslandMode
}
/** Stitching vias on a `pitch` lattice wherever every listed layer has the net's fill under the via; the pours refill after. */
export interface StitchProps {
  net: NetLike
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
  net?: NetLike
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
  layer: string
  at?: At
  size?: Length
  thickness?: Length
  width?: Length
  anchor?: 'start' | 'middle' | 'end'
  /** "hershey" (default), "newstroke", a name of `fonts`, or `{ file, weight? }` relative to this file */
  font?: string | FontSpec
  /** outline fonts on silk: grow ink thinner than silkMinWidth instead of the silk-width warning */
  thicken?: boolean
  net?: NetLike
  children?: string | number | (string | number)[]
}

export interface IntrinsicElements {
  board: BoardProps
  g: GroupProps
  footprint: FootprintProps
  pad: PadProps
  track: TrackProps
  via: ViaProps
  zone: ZoneProps
  keepout: KeepoutProps
  stitch: StitchProps
  path: PathProps
  line: LineProps
  circle: CircleProps
  rect: RectProps
  text: TextProps
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
/** What a net prop takes: a Net, or a net name as a string, the escape hatch. */
export type NetLike = string | Net
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
/** The props of a placed part, `<R1 at="12 5" />`. */
export interface PlaceProps {
  at?: At
  side?: Side
  fields?: Record<string, string>
  bom?: boolean
  pos?: boolean
  /** do not populate this placement: out of the BOM and the placement file, still in the DRC */
  dnp?: boolean
  description?: string
  height?: Length
  model?: ModelSpec
  /** pad number or name -> how that pad joins a pour, over the footprint's, such as `{ EP: 'solid' }` */
  thermal?: Record<string, PadThermal>
  /** false draws no silk ref for this part */
  ref?: false
  /** where the silk ref goes, "x y rot" in the footprint's frame, or false for none; by default above the courtyard */
  refAt?: At | false
  /** rule overrides for every pad of this placement, merged key by key over the part's `.rules()`; see PartRules */
  rules?: PartRules
  children?: Child
}
/** The props of a part inside `<Schematic>` or `<Sheet>`, `<R1 at="10 6" flip />`: its symbol, in grid units. */
export interface SymPlaceProps {
  at: SchAt
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

/** What a footprint factory takes besides the value: BOM fields and footprint props every placement gets. */
export interface PartOptions {
  value?: string | number
  fields?: Record<string, string>
  /** sourcing keys, merged over `fields`: `{ MPN: 'RC0603FR-07330RL', 'MPN:US': 'ERJ-3EKF3300V' }` */
  source?: SourcingSpec
  bom?: boolean
  pos?: boolean
  /** do not populate the part: out of the BOM and the placement file, still on the board and in the DRC */
  dnp?: boolean
  description?: string
  height?: Length
  model?: ModelSpec
}
/** A part: one component of the schematic, placed on the board as a JSX element. `P` names its pins. */
export interface PartBase<P extends string, D extends string = never> {
  (props: PartProps): PcbNode
  readonly $$: 'part'
  /** nets in the footprint's pin order, or an object keyed by pin name or pad number; returns the same part */
  connect(...nets: Connection[]): Part<P, D>
  connect(pins: { [K in P | number]?: Connection }): Part<P, D>
  /** pin an explicit ref such as "Q9"; every other part is numbered by the registry */
  ref(name: string): Part<P, D>
  /** sourcing keys, merged over earlier ones, later calls win */
  source(spec: SourcingSpec): Part<P, D>
  /** rule overrides for every pad, merged key by key over earlier calls */
  rules(r: PartRules): Part<P, D>
  readonly value: string | undefined
  readonly prefix: string
  /** the declared pin names, in order */
  readonly pins: readonly string[]
  pin(name: P | number): PinRef
  /** one pad by number or name, checked at compile time; for a pad name that is also a pin name */
  pad<K extends D | (string & {}) | number>(name: K): PadRef<K extends number ? `${K}` : K & string>
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
/** A footprint component with its schematic metadata: `R0603('330')` makes a part, `<R0603 ref="R1" />` renders. */
export interface FootprintFactory<P extends string = string, Props = FootprintProps, D extends string = never> {
  (props: Props): PcbNode
  (value?: string | number | PartOptions, source?: SourcingSpec): Part<P, D>
  readonly pins: PinList
  /** pad numbers or names left unconnected on purpose */
  readonly nc?: PinList
  readonly prefix: string
  readonly id?: string
}
