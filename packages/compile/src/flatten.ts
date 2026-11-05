import { marker } from './messages.js'
import type { AutoRouteParams, Child, IslandMode, PcbNode, PinRef, RouteEnd, ResolvedRules as Rules, Src, Stackup, ThermalConnection } from '@pcbjs/core/internal/types'
import { resolveVia, withMaskColor } from '@pcbjs/core/internal/rules'
import type { BoardSpec, ResolvedBoardSpec } from '@pcbjs/core/internal/defaults'
import { checkTeardrops, type TeardropLevel } from '@pcbjs/core/internal/teardrop'
import { checkAutoroute, checkIslands, mergeAutoroute, resolveBoardSpec } from '@pcbjs/core/internal/board-spec'
import { recolor, type VariantSpec } from '@pcbjs/core/internal/variants'
import { childList, isNode } from '@pcbjs/core/jsx-runtime'
import { isPatchNode, patchOf, type Patch } from '@pcbjs/core/internal/patch'
import { schematicDrawing, type SchematicModule } from '@pcbjs/core/internal/sch-elements'
import { at as parseAt, autoAt, coordString, endAt, mm, parseToken, size2 } from '@pcbjs/core/internal/units'
import {
  type AutoRouteJob,
  type Keepout,
  type JobAvoid,
  type JobParams,
  type Board,
  type BoardSchematic,
  type BoardSchematicCircuit,
  type BoardSchematicPart,
  type SchematicExport,
  type DrcMarker,
  type Footprint,
  type Graphic,
  type Item,
  type KindClearanceMM,
  type LayerDef,
  type Pad,
  type Prim,
  type Pt,
  type Ring,
  type RouteStep,
  type Text,
  type Track,
  type Via,
  type Zone,
} from '@pcbjs/core/model'
import { beginCompile, endCompile, renderComponent } from '@pcbjs/core/internal/realm'
import {
  instanceParts,
  instancePath,
  isInstanceState,
  markNcPad,
  partOf,
  pinsOfPads,
  topInstance,
  routeName,
  routeOwner,
  isRoutePoint,
  type InstanceState,
  type PartState,
} from '@pcbjs/core/internal/part'
import { isNC, isNet, isPinRef, netInfo, isSchematicError } from '@pcbjs/core/internal/nets'
import { footprintRender } from '@pcbjs/core/internal/footprint'
import { absFile, footprintModel, isStepSpec } from './models.js'
import { platform } from '@pcbjs/core/platform'
import { circuitKey, LAYOUT_PROP, type LayoutMark } from '@pcbjs/core/internal/circuit'
import { apply, applyRing, bbox, IDENTITY, intersection, isMirrored, mul, offset, placement, polysToRings, rotationOf, type Mat } from './geom.js'
import { gridAt as inGridUnits, gridPitch, isGrid, placementSnap, type Grid } from '@pcbjs/core/internal/grid'
import { gridFrame, gridRecord, type Anchor } from './grids.js'
import type { GridRecord } from '@pcbjs/core/model'
import { applyPrims, circlePrims, circleRing, hasArc, padRing, parsePath, roundedRect, roundedRectPrims } from './path.js'
import { copperLayers, layerTable, resolveLayer } from './layers.js'
import { strokeFontName, strokeText } from '@pcbjs/core/internal/text'
import { loadOutlineFont, offsetPolys, outlineText, thinInk, type OutlineFont } from '@pcbjs/core/internal/outline'
import type { FontSpec } from '@pcbjs/core/internal/types'
import type { ResolvedNetClass } from './netclass.js'
import { pairGeometry, traceWidth } from '@pcbjs/core/internal/impedance'
import { CLASS_DEFAULTS, checkCorner, checkNeck } from './netclass.js'
import { mergeRuleSets, PART_RULE_KEYS, ruleOverrides, type PartRuleKey, type RuleSet } from '@pcbjs/core/internal/netclass'
import { pinOfPad } from '@pcbjs/core/internal/part'
import { pulse } from './cancel.js'
import { realm } from '@pcbjs/core/internal/realm'

const nm = (v: number) => Math.round(v * 1e6) / 1e6 || 0

/** A pad's paste openings in board mm on `pad.pasteRings`, when they differ from its copper less pasteShrink: custom windows, KiCad's paste margin and ratio, or a window grid. */
function padPaste(pad: Pad, p: Record<string, any>, ring: Ring, w: number, h: number, m: Mat, rules: Rules): void {
  if (p.pasteRatio !== undefined) {
    if (typeof p.pasteRatio !== 'number' || !Number.isFinite(p.pasteRatio) || p.pasteRatio <= -0.5)
      throw new Error(`pasteRatio must be a number above -0.5, a fraction of the pad size per side, got ${JSON.stringify(p.pasteRatio)}`)
    pad.pasteRatio = p.pasteRatio
  }
  const v = p.paste
  if (v === false || !pad.paste) return
  if (Array.isArray(v)) {
    if (
      !v.length ||
      !v.every((r: unknown) => Array.isArray(r) && r.length >= 3 && r.every(q => Array.isArray(q) && q.length === 2 && q.every(x => typeof x === 'number' && Number.isFinite(x))))
    )
      throw new Error('paste must be true, false, a list of polygons of at least three [x, y] in mm in the pad frame, or { rows, cols, coverage }')
    pad.pasteRings = v.map((r: [number, number][]) =>
      applyRing(
        m,
        r.map(q => [q[0], q[1]] as Pt),
      ),
    )
    return
  }
  const grid = v && typeof v === 'object' ? (v as { rows: unknown; cols: unknown; coverage?: unknown }) : undefined
  if (v !== undefined && v !== true && !grid) throw new Error(`paste must be true, false, polygons or { rows, cols, coverage }, got ${JSON.stringify(v)}`)
  if (grid) {
    const bad = Object.keys(grid).find(k => k !== 'rows' && k !== 'cols' && k !== 'coverage')
    if (bad || !Number.isInteger(grid.rows) || !Number.isInteger(grid.cols) || (grid.rows as number) < 1 || (grid.cols as number) < 1)
      throw new Error(`paste windows need whole rows and cols of 1 or more${bad ? `, not ${bad}` : ''}, got ${JSON.stringify(v)}`)
    if (grid.coverage !== undefined && !(typeof grid.coverage === 'number' && grid.coverage > 0 && grid.coverage <= 1))
      throw new Error(`paste coverage must be above 0 and at most 1, got ${JSON.stringify(grid.coverage)}`)
  }
  const own = pad.override?.pasteShrink !== undefined
  if (!grid && !own && pad.pasteRatio === undefined) return
  const shrink = pad.pasteShrink ?? rules.pasteShrink,
    ratio = pad.pasteRatio ?? 0
  const mx = ratio * w - shrink,
    my = ratio * h - shrink
  let base: Ring[]
  if (pad.shape === 'custom') base = mx ? polysToRings(offset([ring], mx)) : [ring]
  else if (pad.shape === 'circle') base = Math.min(w, h) / 2 + mx > 0 ? [circleRing(0, 0, Math.min(w, h) / 2 + mx)] : []
  else {
    const W = w + 2 * mx,
      H = h + 2 * my
    if (!(W > 0 && H > 0)) base = []
    else if (pad.shape === 'roundrect') base = [roundedRect(W, H, Math.max(0, Math.min(w, h) * Math.min(Math.max(p.roundness ?? 0.25, 0), 0.5) + Math.min(mx, my)))]
    else base = [padRing(pad.shape, W, H)]
  }
  if (grid && base.length) {
    const b = bbox(base),
      rows = grid.rows as number,
      cols = grid.cols as number,
      s = Math.sqrt((grid.coverage as number | undefined) ?? 0.5)
    const cw = b.w / cols,
      ch = b.h / rows,
      ww = (cw * s) / 2,
      wh = (ch * s) / 2
    const wins: Ring[] = []
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const cx = b.x + cw * (j + 0.5),
          cy = b.y + ch * (i + 0.5)
        wins.push([
          [cx - ww, cy - wh],
          [cx + ww, cy - wh],
          [cx + ww, cy + wh],
          [cx - ww, cy + wh],
        ])
      }
    base = pad.shape === 'rect' ? wins : polysToRings(intersection(wins, base))
  }
  pad.pasteRings = base.map(r => applyRing(m, r))
}

export interface Flat {
  name: string
  title: string
  rev: string
  copper: number
  thickness: number
  stackup: Stackup
  rules: Rules
  layers: LayerDef[]
  items: Item[]
  footprints: Footprint[]
  netNames: Set<string>
  /** tracks to route once everything else is flattened, in document order */
  autoRoutes: AutoRouteJob[]
  /** preferred via dimensions in mm, over the legacy fallback */
  via?: { drill?: number; size?: number }
  /** the board-wide autoroute parameters */
  autoroute: AutoRouteParams
  /** the net classes by name, in mm, {} when none */
  classes: Record<string, ResolvedNetClass>
  /** electrical rule findings of the schematic layer */
  erc: DrcMarker[]
  schematic: BoardSchematic
  /** the ref the registry gave each placed part, for pin handles in routes */
  partRefs: Map<PartState, string>
  /** the ordered sourcing tags the BOM resolves with */
  sourcingTags: string[]
  /** where cpl.csv places each part, absent for the footprint origin */
  cpl?: { origin: 'footprint' | 'center' }
  /** the README-fab notes, lowest level first */
  fabNotes: string[]
  /** the board's teardrops and their parameters, see teardrop.ts */
  teardrops: ResolvedBoardSpec['teardrops']
  /** `teardrops` of route calls by route id, as given */
  routeTeardrops: Record<string, boolean | TeardropLevel>
  /** the outline fonts of the board's text with their notices, see Board.outlineFonts */
  outlineFonts: NonNullable<import('@pcbjs/core/model').Board['outlineFonts']>
  /** hard keepouts, in document order */
  keepouts: Keepout[]
  /** stitch() elements, in document order, placed after the pours fill */
  stitches: import('./stitch.js').StitchJob[]
  /** <PCB strict>: a failed route leg throws instead of becoming a route-failed finding */
  strict: boolean
  /** this variant target routes under its own rules instead of the shared strictest ones */
  routeSeparately: boolean
  /** <PCB silkRefs>: draw the refs on the silkscreen */
  silkRefs: boolean
  /** patch() nodes: those of `<PCB patches>`, then the inline ones in tree order, then CompileOptions.patches */
  patches: Patch[]
  /** reference() elements in document order, resolved once the board is flattened */
  references?: import('./reference.js').ReferenceJob[]
  /** <PCB schematic>, the picture compileSchematic draws */
  sch?: unknown
  /** the exports of a <PCB schematic> module that are parts or nets, nets by name */
  exports?: { parts: Map<PartState, SchematicExport>; nets: Map<string, SchematicExport> }
  /** parts with an auto slot or `at:follow`, in tree order, see placer.ts */
  placeJobs: PlaceJob[]
  /** `<PCB place>`: the placer's seed */
  placeSeed: number
  /** `<mate>` elements and placements with a `name`, in tree order */
  mates: MateJob[]
  /** the grids attached and listed, in tree order, `used` still empty */
  grids: GridRecord[]
  /** each grid's reads of placed parts and the grid it sits in, for the dependency graph */
  gridDeps: { name: string; src?: Src; reads: Footprint[]; parent: string | null; unplaced: string[]; frame: Footprint | null }[]
  /** each placement as written: its part or named group, the frame of its `at`, the grid it is in and its element */
  placements: Placement[]
  /** each route's definition and the instances around its call, by route id, as `Placement` has them */
  routeScopes: Record<string, { def?: string; within: string[] }>
}

/** A placement for the editing tools: `m` maps its `at` in mm, pitches applied, to the board. */
export interface Placement {
  /** the grid attached inside this placement, whose origin is its rotation centre */
  rotationGrid?: string
  snap?: { pitch: number; maxLevel?: number }
  fp?: Footprint
  group?: string
  m: Mat
  grid: string | null
  src?: Src
  at?: [number, number, number]
  side?: 'F' | 'B'
  /** a part a layout element places: that element and the part's member path under its instance, the last of `within`, where an own placement goes */
  layout?: { src: Src; member: string }
  /** the definition whose source writes its `at`; absent at the board level */
  def?: string
  /** the instances whose layouts are around it, outermost first; an instance's own is its last */
  within: string[]
  /** a part an own placement places, by the instance whose layout element holds it */
  owned?: string
  /** an instance its layout element places, `CH1`; `computed` when no `<g>` of the render takes the element's `at` */
  inst?: string
  computed?: true
  /** a text of no part, by its element */
  text?: Text
}

/** A part whose `at` has an auto slot, as flatten left it: at its provisional pose, `m` the frame of its `at`. */
export interface PlaceJob {
  fp: Footprint
  /** the slots `at` fixes, null where it says auto */
  fixed: [number | null, number | null, number | null]
  /** the pose the footprint was drawn at, in the frame of `at` */
  start: [number, number, number]
  initial?: [number, number, number]
  cost?: import('@pcbjs/core/internal/types').PlaceCost
  solver?: import('@pcbjs/core/internal/types').PlaceSolver
  follow?: { route: unknown; near?: unknown; side?: unknown; distance?: unknown }
  m: Mat
  flip: boolean
  /** the placement element, whose `at` `pcbjs place --write` rewrites */
  src?: Src
}

/** A named point: a `<mate>` at its board pose, or a placement's `name` on its part. */
export type MateJob = { name: string; src?: Src } & ({ at: Pt; rot: number; side: 'F' | 'B' } | { fp: Footprint })

/** Each placed route node's `route:<n>` id, for `at:follow` and a solver's `ctx.route()`. */
export const ROUTE_IDS = new WeakMap<object, string>()

/** The id of a bound route: `route:vccTrunk`, or under the instance whose build returns it, `CH2/route:vccTrunk`. */
export function boundId(n: object): string | undefined {
  const name = routeName(n)
  if (name === undefined) return undefined
  const owner = routeOwner(n)
  return owner ? `${instancePath(owner).join('/')}/route:${name}` : `route:${name}`
}

/** A footprint's own silk ref placement from `ref:at`: false for none, else the position and rotation on the board. */
export const REF_SRC = new WeakMap<Footprint, Src>()
export const REF_AT = new WeakMap<Footprint, false | { at: Pt; rot: number }>()

/** Where a compile keeps its route memos and stage outputs; stage outputs only when `entry` and `files` say what was evaluated. */
export interface CompileCache {
  dir?: string | null
  /** a compile of unsaved text: it reads the cache and writes memory only */
  draft?: boolean
  /** the entry, relative to the project, as the index names it */
  entry?: string
  /** the sha1 of every file the entry and the config evaluated, by absolute path */
  files?: Record<string, string>
  /** what else the evaluation read, such as PCBJS_* and package versions */
  env?: string
}

/** Options of a compile. `files` are the modules the entry imports. */
export interface CompileOptions {
  /** Preview only: stop traversal before this source expression; omit completeness checks. */
  previewBefore?: Src
  /** Preview the reusable layout of this instance without its own placement overrides. */
  library?: string
  /** The root used by the loader for relative source filenames. */
  sourceRoot?: string
  files?: ReadonlySet<string>
  /** the cache: false for none; `dir` its folder, `.pcbjs/cache` in a pcbjs project, null for memory only; see CompileCache */
  cache?: false | CompileCache
  /** compiles the entries reference() names, each in a run of its own; the CLI passes one, see references.md */
  references?: import('./reference.js').ReferenceResolver
  /** A footprint model's box in the footprint frame, mm, z up from the board face, or null when unknown; see references.md. */
  modelBox?: import('./reference.js').ModelBoxLoader
  /** called as the router takes each leg, cached or routed, in its first pass and in every negotiation round */
  progress?: (p: import('./autoroute.js').RouteProgress) => void
  /** plugins before those of `<PCB plugins>`, as `defineConfig({ plugins })` gives them */
  plugins?: readonly import('@pcbjs/core/internal/plugin').PcbPlugin[]
  /** the layer of `defineDefaultBoard` under the board; the realm's when absent, read once as the compile starts */
  defaults?: BoardSpec | null
  /** the views wanted; only the stages they need run, every stage when absent */
  want?: readonly import('@pcbjs/core/internal/plugin').View[]
  /** the formats of the exports stage, in order */
  exports?: readonly import('./pipeline.js').Exporter[]
  /** the default export of the entry's .patches.ts file, after the patches of the tree */
  patches?: readonly PcbNode[]
  /** a cancel: checked at the cancel points between stages and inside them, docs/design.md; an AbortSignal will do */
  signal?: { readonly aborted: boolean }
  /** each stage of each target as it starts, ends or comes from the cache, with the board as it stands after it */
  stage?: (e: import('./pipeline.js').StageEvent) => void
}

/** The part refs of a compiled board, for resolving pin handles such as `J1[3]`. */
export const PART_REFS = new WeakMap<Board, Map<PartState, string>>()

/** A placed part while its footprint is walked: the placeholder ref it was given, its pads once walked, and the layouts around it. */
interface PartBinding {
  st: PartState
  id: string
  rec?: Footprint
  pads?: Pad[]
  padPins?: (string | null)[]
  layouts: ActiveLayout[]
  site?: Src
  refSrc?: Src
  /** the named `<g>` around the placement, outermost first */
  groups: string[]
}
/** A layout being walked: the instance it places, its name and where it was called. */
interface ActiveLayout {
  inst: InstanceState
  name: string
  key: string
  src?: Src
}
/** A definition around a node: a layout by its instance's path, or a named group, and its key. */
interface Level {
  path: string
  key: string
}
/** A layout element whose instance's frame is not yet found: the first `<g>` of its render that takes the element's `at` places it. */
interface Pending {
  snap?: { pitch: number; maxLevel?: number }
  path: string
  at: unknown
  src?: Src
  done: boolean
}
/** A layout element's child placing one part of its instance, `<CH1.R at="13 0" />`. */
interface Own {
  node: PcbNode
  used: boolean
}
const PLACEHOLDER = '\u0000part:'
/** What a placement takes; everything else about a part is set where it is made. */
const PLACE_PROPS = new Set(['at', 'side', 'grid', 'locked', 'ref:at', 'thermal', 'children', 'at:initial', 'at:cost', 'at:solver', 'at:follow', 'name'])
const AUTO_PROPS = ['at:initial', 'at:cost', 'at:solver', 'at:follow'] as const

interface Ctx {
  m: Mat
  flipped: boolean
  fp: { rec: Footprint; pads: Pad[]; label: string } | null
  /** where the design placed the outermost component around this node: a footprint's part points there, not at its <footprint> */
  site?: Src
  /** the enclosing call sites from the entry down, outermost first */
  chain: Src[]
  /** the part whose footprint is being rendered, until its <footprint> is reached */
  part?: PartBinding
  /** the circuit layouts around this node, outermost first */
  layouts: ActiveLayout[]
  /** the layouts and named groups around this node, outermost first: whose source writes what it holds */
  levels: Level[]
  /** placements a layout element's children give one instance's parts, in place of the layout's own */
  own?: Map<PartState, Own>
  /** the innermost layout element whose instance's frame is not yet found */
  pending?: Pending
  /** the named `<g>` around this node, outermost first */
  groups: string[]
  /** the grid in effect for part and group positions: its name, pitch and frame */
  grid: GridCtx | null
}
interface GridCtx {
  name: string
  pitch: number
  m: Mat
}
/** Set on a route node once it is compiled, see the fluent path in @pcbjs/core: no fluent call may follow. */
const COMPILED = Symbol.for('pcbjs.route.compiled')
/** A command of a route chain, see `chain` in @pcbjs/core. */
type ChainCommand =
  | Exclude<RouteStep, { op: 'W' | 'B' }>
  | { op: 'to'; auto: boolean; target: unknown; src?: Src }
  | { op: 'W'; width: unknown; src?: Src }
  | { op: 'branch'; end: unknown; chain: ChainCommand[]; width?: unknown; current?: number; src?: Src }
/** A route end for a message: J1.B6 for a pin or pad handle, "via" for a via node, the value as JSON otherwise. */
const isLength = (v: unknown) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && !!parseToken(v))
/** A coordinate tuple, one position: [x, y] or [x, y, layer] with lengths for x and y. */
export const isCoordTuple = (v: unknown): v is [unknown, unknown, unknown?] =>
  Array.isArray(v) && (v.length === 2 || (v.length === 3 && (v[2] === undefined || typeof v[2] === 'string'))) && isLength(v[0]) && isLength(v[1])
/** A pair end [P, N]: two handles or two positions, never a coordinate tuple. */
export const isPairEnd = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2 && !isCoordTuple(v)
function describeEnd(q: unknown): string {
  if (isPairEnd(q)) return `[${q.map(describeEnd).join(', ')}]`
  if (isPinRef(q)) {
    const st = partOf(q.part)
    return `${st ? st.label : 'a part'}.${q.pad ?? q.pin}`
  }
  if (isNode(q) && q.type === 'via') return `the via at ${JSON.stringify(q.props.at)}`
  if (isRoutePoint(q)) return `${boundId(q.route) ?? ROUTE_IDS.get(q.route) ?? 'a route'}/${q.pt === 'end' ? 'end' : `pt:${q.pt}`}`
  return JSON.stringify(q) ?? String(q)
}
/** One step of a chain as text, for the hash a hold or reroute patch of the route names. */
const stepText = (st: RouteStep): string => {
  switch (st.op) {
    case 'L':
    case 'X':
      return `${st.rel ? st.op.toLowerCase() : st.op} ${st.x} ${st.y}`
    case 'H':
      return `${st.rel ? 'h' : 'H'} ${st.x}`
    case 'V':
      return `${st.rel ? 'v' : 'V'} ${st.y}`
    case 'A':
      return `${st.rel ? 'a' : 'A'} ${st.x} ${st.y} ${st.angle}`
    case 'U':
      return `@${st.layer}${st.cross ? ' cross' : ''}${st.drill !== undefined ? ` d${st.drill}` : ''}${st.size !== undefined ? ` s${st.size}` : ''}`
    case 'W':
      return `W ${st.width}`
    case 'B':
      return 'B'
    default:
      return st.op
  }
}
/** A chain as text, for the hash a hold or reroute patch of the route names. */
const stepsText = (steps: readonly RouteStep[]): string => steps.map(stepText).join(' ')
/** A chain as written, branches nested, for the leg keys of a route with a chain, branches or more than two ends. */
function chainText(cmds: readonly ChainCommand[]): unknown[] {
  return cmds.map(c =>
    c.op === 'branch'
      ? [describeEnd(c.end), c.width ?? null, chainText(c.chain)]
      : c.op === 'to'
        ? [c.auto ? 'X' : 'L', JSON.stringify(isNode(c.target) ? propsOf(c.target).at : c.target)]
        : c.op === 'W'
          ? ['W', String(c.width)]
          : stepText(c as RouteStep),
  )
}
/** True for a coordinate end, "x y", [x, y] or { at }: where drawn copper starts. */
const coordinate = (q: unknown): boolean => {
  if (isPinRef(q) || isNode(q)) return false
  if (typeof q === 'string') {
    try {
      return coordString(q) !== null
    } catch {
      return true
    }
  }
  return Array.isArray(q) || (!!q && typeof q === 'object' && 'at' in q)
}

function thermalConnection(v: unknown, what: string, at: string, src?: Src): ThermalConnection {
  if (v !== 'thermal' && v !== 'solid' && v !== 'none') throw new CompileError(`${what} must be 'thermal', 'solid' or 'none', got ${JSON.stringify(v)}${at}`, src)
  return v
}

/** A pad's `thermal`, a connection or `{ connect?, angle? }`, onto the pad. */
function padThermal(pad: Pad, v: unknown, what: string, at: string, src?: Src): void {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    pad.thermal = thermalConnection(v, what, at, src)
    return
  }
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined || k === '__src') continue
    if (k === 'connect') pad.thermal = thermalConnection(x, `${what} connect`, at, src)
    else if (k === 'angle') {
      if (x !== 90 && x !== 45) throw new CompileError(`${what} angle must be 90 or 45, got ${JSON.stringify(x)}${at}`, src)
      pad.thermalAngle = x
    } else throw new CompileError(`${what} has an unknown field ${JSON.stringify(k)}; it takes connect and angle${at}`, src)
  }
}

/** A footprint's or a placed part's `thermal` map, pad number or name to connection, onto its pads; every key must name a pad. */
function padThermals(ref: string, map: unknown, pads: Pad[], at: string, src?: Src): void {
  if (!map || typeof map !== 'object' || Array.isArray(map))
    throw new CompileError(`${ref}: thermal must map pad numbers or names to 'thermal', 'solid' or 'none', such as { EP: 'solid' }${at}`, src)
  for (const [k, v] of Object.entries(map)) {
    const hit = pads.filter(p => p.num === k)
    const list = hit.length ? hit : pads.filter(p => p.name === k)
    if (!list.length) throw new CompileError(`${ref}: thermal names pad ${JSON.stringify(k)}, which the footprint does not have${at}`, src)
    for (const p of list) padThermal(p, v, `${ref}: thermal ${k}`, at, src)
  }
}

/** Resolve each pin handle to the "REF.PAD" of its pad nearest the route's other end, once the refs are final. */
function padEnds(flat: Flat, bindings: PartBinding[]): void {
  const byState = new Map(bindings.map(b => [b.st, b]))
  const padsOf = new Map<string, Pad[]>()
  for (const it of flat.items)
    if (it.kind === 'pad' && it.ref !== undefined) {
      const l = padsOf.get(it.ref) ?? []
      l.push(it)
      padsOf.set(it.ref, l)
    }
  const choices = (q: unknown): Pad[] | null => {
    if (!isPinRef(q)) return null
    const st = partOf(q.part),
      b = st && byState.get(st)
    if (!st || !b || !b.pads || !b.rec) return null
    if (q.pad === undefined) return b.pads.filter((_, i) => b.padPins![i] === q.pin)
    const hit = b.pads.filter(p => p.num === q.pad)
    const list = hit.length ? hit : b.pads.filter(p => p.name === q.pad)
    if (!list.length)
      throw new CompileError(
        `${b.rec.ref}.pad(${JSON.stringify(q.pad)}): ${st.label} has no pad numbered or named ${JSON.stringify(q.pad)}; its pads are ${[...new Set(b.pads.filter(p => p.num !== '').map(p => p.num))].join(', ')}`,
        st.src,
      )
    return list
  }
  const pointsOf = (q: unknown): Pt[] => {
    const c = choices(q)
    if (c) return c.map(p => p.at)
    if (typeof q === 'string') {
      const dot = q.indexOf('.')
      const pads = padsOf.get(q.slice(0, dot)) ?? [],
        k = q.slice(dot + 1)
      const pad = pads.find(p => p.num === k) ?? pads.find(p => p.name === k)
      return pad ? [pad.at] : []
    }
    if (q && typeof q === 'object' && !Array.isArray(q) && 'at' in q) {
      try {
        const [x, y] = endAt((q as any).at)
        return [[x, y]]
      } catch {
        return []
      }
    }
    return []
  }
  const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
  const pick = (q: unknown, toward: Pt[]): RouteEnd | null => {
    const c = choices(q)
    if (!c || (c.length < 2 && (q as PinRef).pad === undefined)) return null
    let best = c[0]
    if (toward.length) {
      let bd = Infinity
      for (const p of c) {
        const d = Math.min(...toward.map(t => d2(p.at, t)))
        if (d < bd) {
          bd = d
          best = p
        }
      }
    }
    const same = (padsOf.get(best.ref!) ?? []).filter(p => p.num === best.num)
    if (same[0] === best) return `${best.ref}.${best.num}` as RouteEnd
    if ((q as PinRef).pad !== undefined)
      throw new CompileError(
        `${best.ref}.pad(${JSON.stringify((q as PinRef).pad)}): several pads are numbered ${JSON.stringify(best.num)}; name the pad by a unique number`,
        partOf((q as PinRef).part)?.src,
      )
    return null
  }
  for (const j of flat.autoRoutes) {
    if (j.from === undefined || j.to === undefined) continue
    const a = choices(j.from),
      b = choices(j.to)
    if (a?.length === 1 && b?.length === 1 && a[0] === b[0]) throw new CompileError(`${j.route}: ${a[0].ref}/${a[0].num} is both ends; a route joins two different ends`, j.src)
    const from = pick(j.from, pointsOf(j.to))
    if (from !== null) j.from = from
    const to = pick(j.to, pointsOf(j.from))
    if (to !== null) j.to = to
    // the N end of a pair takes the pad of its pin nearest the P end chosen, so the two sit side by side
    if (j.pair) {
      const fromN = pick(j.pair.fromN, pointsOf(j.from))
      if (fromN !== null) j.pair.fromN = fromN
      const toN = pick(j.pair.toN, pointsOf(j.to))
      if (toN !== null) j.pair.toN = toN
    }
  }
}

export class CompileError extends Error {
  constructor(
    message: string,
    public src?: Src,
    /** the diagnostic code when it is not `compile-error`, such as `grid-frame` */
    public code?: string,
  ) {
    super(message)
    this.name = 'CompileError'
  }
}

/** The `__src` prop the source-range transform injects: the element or call with its full range. */
function rangeOf(v: unknown): Src | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.file !== 'string' || typeof o.line !== 'number' || typeof o.col !== 'number') return undefined
  const s: Src = { file: o.file, line: o.line, col: o.col }
  if (typeof o.endLine === 'number' && typeof o.endCol === 'number') {
    s.endLine = o.endLine
    s.endCol = o.endCol
  }
  if (typeof o.hash === 'string') s.hash = o.hash
  return s
}
/** The element's own position: the transform's range when present, else the start jsxDEV recorded. */
const srcOf = (n: PcbNode): Src | undefined => rangeOf(n.props?.__src) ?? n.src
const where = (n: PcbNode | undefined) => {
  const s = n && srcOf(n)
  return s ? ` (${s.file}:${s.line}:${s.col})` : ''
}
const loc = (s: Src | undefined) => (s ? `${s.file}:${s.line}:${s.col}` : 'an element without a source position')
/** The props without `__src`, so it never reaches fields, nets, pads or a component's rest spread. */
function propsOf(n: PcbNode): Record<string, any> {
  const { __src: _, __refSrc: _ref, ...p } = n.props ?? {}
  return p
}
const chained = (ctx: Ctx, self: Src | undefined) => (self ? [...ctx.chain, self] : ctx.chain)

/** The <PCB> element at the root of an entry, its components called. Throws when there is none or it has no name. */
export function rootBoard(root: Child): PcbNode {
  const node = unwrap(root)
  if (!node || node.type !== 'board') throw new CompileError('the entry must default-export a <PCB> element')
  if (!propsOf(node).name) throw new CompileError('<PCB> needs a name', srcOf(node))
  // the board's element keeps the range of the <PCB> that made it
  const own = isNode(root) ? rangeOf(root.props?.__src) : undefined
  return own && !srcOf(node) ? { ...node, props: { ...node.props, __src: own } } : node
}

/** The variant targets a root carries, or null for a single-target board. */
export function variantsOf(node: PcbNode): VariantSpec[] | null {
  const v = node.props?.variants
  return Array.isArray(v) ? v : null
}

/** `<PCB schematic>`: a module namespace whose `drawing` export is drawn and whose part and net exports are named. */
function schematicProp(flat: Flat, sch: unknown, node: PcbNode): void {
  if (typeof sch !== 'object' || Array.isArray(sch) || isNode(sch))
    throw new CompileError(
      `<PCB ${flat.name}>: schematic takes the schematic module as a namespace, import * as sch, whose drawing export is the drawing; got ${isNode(sch) ? 'an element' : typeof sch}${where(node)}`,
      srcOf(node),
    )
  const ns = sch as SchematicModule
  const drawing = schematicDrawing(ns)
  if (drawing) flat.sch = drawing
  const parts = new Map<PartState, SchematicExport>(),
    nets = new Map<string, SchematicExport>()
  for (const [name, v] of Object.entries(ns)) {
    const st = partOf(v)
    if (st && !parts.has(st)) parts.set(st, { name, ...(st.declFile ? { module: st.declFile } : {}) })
  }
  const module = [...parts.values()].find(e => e.module)?.module
  for (const [name, v] of Object.entries(ns)) if (isNet(v) && !nets.has(v.name)) nets.set(v.name, { name, ...(module ? { module } : {}) })
  flat.exports = { parts, nets }
}

/** Walk the design into absolute items; a `target` merges like a fab preset: base, global defaults, target, the element's props. */
export function flatten(root: Child, target?: VariantSpec, opts: CompileOptions = {}): Flat {
  const node = rootBoard(root)
  const p = propsOf(node)
  // base <- global defaults (defineDefaultBoard) <- these props; see defaults.ts
  const {
    name: _name,
    children: _children,
    variants: _variants,
    color: _color,
    silk: _silk,
    finish: _finish,
    refStyle = 'flat',
    strict = false,
    silkRefs = true,
    fonts: boardFonts,
    schematic: sch,
    plugins: _plugins,
    patches: boardPatches,
    place: ownPlace,
    grid: boardGrid,
    grids: boardGrids,
    ...spec
  } = p
  // the element's place wins, as its other props win over a target's board
  const placeOpt = ownPlace ?? (target?.board as { place?: unknown } | undefined)?.place
  const seed = (placeOpt as { seed?: unknown } | undefined)?.seed ?? 1
  if (placeOpt !== undefined && (!placeOpt || typeof placeOpt !== 'object' || Object.keys(placeOpt).some(k => k !== 'seed') || !Number.isInteger(seed)))
    throw new CompileError(`<PCB ${p.name}>: place takes { seed }, an integer, got ${JSON.stringify(placeOpt)}${where(node)}`, srcOf(node))
  if (typeof silkRefs !== 'boolean') throw new CompileError(`<PCB ${p.name}>: silkRefs must be true or false, got ${JSON.stringify(silkRefs)}${where(node)}`, srcOf(node))
  if (typeof strict !== 'boolean') throw new CompileError(`<PCB ${p.name}>: strict must be true or false, got ${JSON.stringify(strict)}${where(node)}`, srcOf(node))
  if (refStyle !== 'flat' && refStyle !== 'hierarchical')
    throw new CompileError(`<PCB ${p.name}>: refStyle must be "flat" or "hierarchical", got ${JSON.stringify(refStyle)}${where(node)}`, srcOf(node))
  let board: ResolvedBoardSpec
  try {
    if (!target) board = resolveBoardSpec([opts.defaults ?? {}, spec])
    else {
      const level = {
        ...(target.board ?? {}),
        ...(target.sourcing ? { sourcing: [...target.sourcing] } : {}),
        ...(target.rules ? { rules: { ...target.rules } } : {}),
      }
      const own = { ...spec, ...(spec.stackup === undefined || spec.stackup === null ? (target.stackup ? { stackup: target.stackup } : {}) : {}) }
      board = resolveBoardSpec([opts.defaults ?? {}, level, own], ['default', `target "${target.name}"`, '<PCB>'])
      board.stackup = recolor(board.stackup, target.color, target.silk, target.finish)
    }
  } catch (e) {
    throw new CompileError(`<PCB ${p.name}>${target ? ` target "${target.name}"` : ''}: ${(e as Error).message}${where(node)}`, srcOf(node))
  }
  board.rules = withMaskColor(board.rules, board.stackup.maskColor)
  const copper = board.copper
  const layers = layerTable(copper)
  const known = new Set(layers.map(l => l.id))
  const flat: Flat = {
    name: String(p.name),
    title: board.title ?? String(p.name),
    rev: board.rev,
    copper,
    thickness: board.thickness,
    stackup: board.stackup,
    rules: board.rules,
    layers,
    items: [],
    footprints: [],
    netNames: new Set(),
    autoRoutes: [],
    ...(board.via ? { via: board.via } : {}),
    autoroute: board.autoroute,
    classes: board.classes,
    erc: [],
    schematic: { parts: [], nets: [], circuits: [] },
    partRefs: new Map(),
    sourcingTags: [...board.sourcing],
    ...(board.cpl ? { cpl: board.cpl } : {}),
    fabNotes: board.fabNotes,
    outlineFonts: {},
    teardrops: board.teardrops,
    routeTeardrops: {},
    keepouts: [],
    stitches: [],
    strict,
    routeSeparately: !!target?.routeSeparately,
    silkRefs,
    patches: patchList(boardPatches, `<PCB ${p.name}> patches`),
    placeJobs: [],
    placeSeed: seed as number,
    mates: [],
    grids: [],
    gridDeps: [],
    placements: [],
    routeScopes: {},
  }
  if (sch !== undefined && sch !== null) schematicProp(flat, sch, node)
  const { drill: viaDrill, size: viaSize } = resolveVia(flat.rules, flat.via)
  let nextId = 1
  const localObjects = new WeakSet<object>()
  const inLibrary = (ctx: Ctx) => !!opts.library && ctx.levels.some(l => l.path === opts.library || l.path.startsWith(opts.library + '/'))
  const local = <T extends object>(value: T, ctx: Ctx): T => {
    if (inLibrary(ctx)) localObjects.add(value)
    return value
  }
  const add = <T extends Item>(it: Omit<T, 'id'>, ctx: Ctx): T => {
    const full = { ...(it as any), id: nextId++ } as T
    flat.items.push(local(full, ctx))
    return full
  }
  // for messages about nets
  let cur: PcbNode | undefined
  const netObjs = new Map<string, NetObj>()
  const net = (name: unknown): string | undefined => {
    if (name === undefined || name === null) return undefined
    if (isNC(name)) throw new CompileError(`NC marks an open pin in connect(), it is not a net${where(cur)}`, cur && srcOf(cur))
    const info = netInfo(name)
    if (info) {
      const seen = netObjs.get(info.name)
      if (!seen) netObjs.set(info.name, { ...info, classes: new Set(info.class ? [info.class] : []) })
      else {
        if (info.class) {
          seen.classes.add(info.class)
          seen.class ??= info.class
        }
        if (info.rules) seen.rules = { ...(seen.rules ?? {}), ...info.rules }
      }
      flat.netNames.add(info.name)
      return info.name
    }
    if (typeof name === 'string')
      throw new CompileError(
        `a net is a Net from nets(), got the string ${JSON.stringify(name)}; declare it, const { ${/^[A-Za-z_]\w*$/.test(name) ? name : 'NAME'} } = nets()${where(cur)}`,
        cur && srcOf(cur),
      )
    throw new CompileError(`a net must be a Net from nets(), got ${isPinRef(name) ? 'a pin handle' : typeof name}${where(cur)}`, cur && srcOf(cur))
  }
  const placedAt = new Map<PartState, Src | undefined>()
  const placedRoutes = new Set<object>()
  const bindings: PartBinding[] = []
  const layer = (n: PcbNode, name: unknown, flipped: boolean) => {
    if (typeof name !== 'string') throw new CompileError(`<${String(n.type)}> needs a layer${where(n)}`, srcOf(n))
    try {
      return resolveLayer(name, flipped, known)
    } catch (e) {
      throw new CompileError((e as Error).message + where(n), srcOf(n))
    }
  }

  /** A route's own autoroute parameters: `.layers()`, `.vias()` and `.rules()`, layers resolved and lengths in mm. */
  const paramsOf = (n: PcbNode, p: Record<string, any>, ctx: Ctx, fail: (msg: string) => never, lay: (q: unknown) => string, toBoard: (q: unknown) => RouteEnd): JobParams => {
    let raw: Partial<AutoRouteParams> = {}
    try {
      const { viaInPad, ...auto } = (p.auto ?? {}) as Record<string, unknown>
      // viaInPad is a per-route parameter the board-wide check does not know
      if (viaInPad !== undefined && typeof viaInPad !== 'boolean') fail(`viaInPad must be true or false, got ${JSON.stringify(viaInPad)}`)
      raw = checkAutoroute({ ...auto, ...(p.layers !== undefined ? { layers: p.layers } : {}), ...(p.via !== undefined ? { via: p.via } : {}) }, 'route')
      if (viaInPad !== undefined) raw.viaInPad = viaInPad as boolean
    } catch (e) {
      if (e instanceof CompileError) throw e
      fail((e as Error).message)
    }
    const params: JobParams = {}
    for (const [k, v] of Object.entries(raw)) if (v !== undefined && k !== 'via' && k !== 'avoid' && k !== 'layers' && k !== 'prefer') (params as any)[k] = v
    if (raw.layers) params.layers = raw.layers.map(lay)
    if (raw.prefer) params.prefer = Object.fromEntries(Object.entries(raw.prefer).map(([k, v]) => [lay(k), v]))
    if (raw.via) {
      try {
        params.via = { ...(raw.via.drill !== undefined ? { drill: mm(raw.via.drill) } : {}), ...(raw.via.size !== undefined ? { size: mm(raw.via.size) } : {}) }
      } catch (e) {
        fail((e as Error).message)
      }
    }
    if (raw.avoid)
      params.avoid = raw.avoid.map((a): JobAvoid => {
        if (a && typeof a === 'object' && !Array.isArray(a) && !isPinRef(a) && 'w' in a && 'h' in a) {
          let x = 0,
            y = 0,
            w = 0,
            h = 0
          try {
            x = mm(a.x)
            y = mm(a.y)
            w = mm(a.w)
            h = mm(a.h)
          } catch (e) {
            fail(`autoroute avoid: ${(e as Error).message}`)
          }
          return {
            ring: applyRing(ctx.m, [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ]),
            ...(a.layer !== undefined ? { layer: lay(a.layer) } : {}),
          }
        }
        return { pos: toBoard(a) }
      })
    return params
  }
  let routes = 0,
    forks = 0
  /** The jobs of one `route()`: its trunk, then each branch, then each extra end, in board mm. */
  const routeJobs = (n: PcbNode, p: Record<string, any>, ctx: Ctx, origin: { src?: Src; chain?: Src[] }): void => {
    const fail = (msg: string): never => {
      throw new CompileError(msg + where(n), srcOf(n))
    }
    if (!(COMPILED in n)) Object.defineProperty(n, COMPILED, { value: true })
    placedRoutes.add(n)
    const lay = (q: unknown) => layer(n, q, ctx.flipped)
    // positions are in the enclosing group's frame; a pin handle is absolute
    // they give the route its net when no pad does
    const viaNets: unknown[] = []
    const toBoard = (q: unknown): RouteEnd => {
      if (isPinRef(q) || isRoutePoint(q)) return q
      // reachable on every copper layer the via spans
      if (isNode(q) && q.type === 'via') {
        const vp = propsOf(q)
        let xy: Pt = [0, 0]
        try {
          const [x, y] = parseAt(vp.at)
          xy = [x, y]
        } catch (e) {
          fail(`route end: the via ${(e as Error).message}`)
        }
        const pair = ((vp.layers ?? ['F.Cu', 'B.Cu']) as unknown[]).map(lay)
        const cu = copperLayers(copper),
          i0 = cu.indexOf(pair[0]),
          i1 = cu.indexOf(pair[1])
        if (i0 < 0 || i1 < 0) fail(`route end: the via spans ${pair.join(' and ')}, which are not both copper layers of this board`)
        if (vp.net !== undefined && vp.net !== null && vp.net !== '') viaNets.push(vp.net)
        return { at: apply(ctx.m, xy), layers: cu.slice(Math.min(i0, i1), Math.max(i0, i1) + 1) } as RouteEnd
      }
      let xy: [unknown, unknown] = [0, 0],
        lname: unknown
      try {
        if (typeof q === 'string') {
          const c = coordString(q)
          if (!c) fail(`route end ${JSON.stringify(q)} is no coordinate; a pad is named by its handle, such as J1['A4'] or U1.PA9`)
          xy = [c!.x, c!.y]
          lname = c!.layer
        } else if (Array.isArray(q)) {
          xy = [q[0], q[1]]
          lname = q[2]
        } else if (q && typeof q === 'object' && 'at' in q && typeof (q as any).at !== 'function') {
          const [x, y] = endAt((q as any).at)
          xy = [x, y]
          lname = (q as any).layer
        } else fail(`route: bad position ${JSON.stringify(q)}`)
      } catch (e) {
        if (e instanceof CompileError) throw e
        fail((e as Error).message)
      }
      let pt: [number, number] = [0, 0]
      try {
        pt = [mm(xy[0] as any), mm(xy[1] as any)]
      } catch (e) {
        fail((e as Error).message)
      }
      const [bx, by] = apply(ctx.m, pt)
      return lname === undefined || lname === null ? { at: [bx, by] } : { at: [bx, by], layer: lay(lname) }
    }
    /** A waypoint in the frame of the route: a coordinate without a layer, or a via. */
    const waypoint = (q: unknown): Pt => {
      let v = q
      if (isNode(v) && v.type === 'via') v = { at: propsOf(v).at }
      try {
        if (typeof v === 'string') {
          const c = coordString(v)
          if (c && c.layer === undefined) return [c.x, c.y]
          if (c)
            fail(
              `route chain: the waypoint ${JSON.stringify(v)} names a layer; a waypoint is on the layer the chain is on, so write it as '${c.x} ${c.y}' and change layer with .via('${c.layer}') before it`,
            )
        } else if (isCoordTuple(v)) {
          if (v[2] === undefined) return [mm(v[0] as any), mm(v[1] as any)]
          fail(
            `route chain: the waypoint ${JSON.stringify(v)} names a layer; a waypoint is on the layer the chain is on, so write it as [${v[0]}, ${v[1]}] and change layer with .via('${v[2]}') before it`,
          )
        } else if (v && typeof v === 'object' && !Array.isArray(v) && 'at' in v && !(v as any).layer) {
          const [x, y] = endAt((v as any).at)
          return [x, y]
        }
      } catch (e) {
        if (e instanceof CompileError) throw e
        fail(`route chain: ${(e as Error).message}`)
      }
      return fail(`route chain: ${describeEnd(q)} is no waypoint; a waypoint is a position such as '5 16' or a via`)
    }
    const width = (v: unknown, what: string): number => {
      let x = NaN
      try {
        x = mm(v as any)
      } catch (e) {
        fail(`${what}: ${(e as Error).message}`)
      }
      if (!(x > 0)) fail(`${what} must be positive, got ${JSON.stringify(v)}`)
      return x
    }
    const id = boundId(n) ?? `route:${routes + 1}`
    routes++
    ROUTE_IDS.set(n, id)
    // a bound route's chain is written in its circuit's build
    const owner = routeOwner(n)
    flat.routeScopes[id] = { ...(owner ? { def: circuitKey(owner.def) } : defOf(ctx.levels)), within: withinOf(ctx.levels) }
    const start = describeEnd(p.from ?? p.net)
    const ends: any[] = p.ends ?? []
    const cmds: ChainCommand[] = p.chain ?? []
    const netEnd = ends.length === 1 && isNet(ends[0]) ? ends[0] : undefined
    const nested = cmds.some(c => c.op === 'branch')
    const tree =
      p.whole || netEnd !== undefined || ends.length > 1 || cmds.length > 0 ? JSON.stringify([...[p.from ?? p.net, ...ends].map(describeEnd), chainText(cmds)]) : undefined
    // jobs after the trunk: branches in chain order, then the extra ends
    const later: AutoRouteJob[] = []
    /** The steps of a chain in board-frame-free form; each branch becomes a job of its own after the trunk. */
    const stepsOf = (list: ChainCommand[], w0: number | undefined, owner: string): RouteStep[] => {
      let w = w0
      return list.map((c): RouteStep => {
        const at = c.src ? { src: c.src } : {}
        switch (c.op) {
          case 'to': {
            const xy = waypoint(c.target)
            return { op: c.auto ? 'X' : 'L', x: xy[0], y: xy[1], rel: false, ...at }
          }
          case 'W':
            w = width(c.width, `${owner} width`)
            return { op: 'W', width: w, ...at }
          case 'branch': {
            const k = ++forks
            const bw = c.width !== undefined ? width(c.width, 'branch width') : w
            // its slot first: a branch's own branches come after it, as their forks are on its chain
            const slot = later.push(undefined as unknown as AutoRouteJob) - 1
            later[slot] = branchJob(c, k, bw)
            return { op: 'B', id: k, ...at }
          }
          case 'U':
            return { ...c, layer: lay(c.layer) }
          default:
            return { ...c }
        }
      })
    }
    const finish = (steps: RouteStep[], who: string, end: boolean): RouteStep[] => {
      const last = steps[steps.length - 1]
      if (end) return last?.op === 'Z' || last?.op === 'XZ' ? steps : [...steps, { op: 'XZ' }]
      if (last?.op === 'Z' || last?.op === 'XZ') fail(`${who}: .${last.op === 'Z' ? 'Z' : 'X'}() runs to the route's end, but it has none; give the end, route(a, b)`)
      return steps
    }
    const branchJob = (c: Extract<ChainCommand, { op: 'branch' }>, k: number, w: number | undefined): AutoRouteJob => {
      const job: AutoRouteJob = { ...base(), fork: k, to: toBoard(c.end), sub: true, infer: true }
      if (w !== undefined) job.width = w
      if (c.current !== undefined) job.current = c.current
      job.steps = finish(stepsOf(c.chain, w, 'branch'), `branch to ${describeEnd(c.end)}`, true)
      job.path = stepsText(job.steps)
      return job
    }
    const params = paramsOf(n, p, ctx, fail, lay, toBoard)
    const base = (): AutoRouteJob => ({
      params,
      ref: ctx.fp?.rec.ref,
      ...origin,
      m: ctx.m,
      route: id,
      ...(tree !== undefined ? { tree } : {}),
      // drawn copper starts on the front of its group, the back in a group on side B
      ...(p.layer !== undefined ? { layer: lay(p.layer) } : ctx.flipped && coordinate(p.from) ? { layer: lay('F.Cu') } : {}),
      ...(p.direct ? { direct: true } : {}),
      ...(p.loop ? { loop: true } : {}),
      ...(p.net === null ? { netless: true } : {}),
      ...(typeof p.solver === 'function' ? { solver: p.solver } : {}),
    })
    const job: AutoRouteJob = base()
    if (p.current !== undefined) job.current = p.current
    if (p.width !== undefined) job.width = width(p.width, 'route width')
    const lone = !ends.length && !p.whole
    if (p.whole) {
      if (cmds.length) fail('route(NET) routes every pad of the net and takes no chain; a chain runs from one end, route(a, b)')
      job.whole = true
      if (p.root !== undefined) job.root = toBoard(p.root)
    } else if (p.pair) {
      job.from = toBoard(p.from[0])
      job.to = toBoard(ends[0][0])
      job.pair = { fromN: toBoard(p.from[1]), toN: toBoard(ends[0][1]) }
      const len = (k: string, v: unknown): number => {
        let x = NaN
        try {
          x = mm(v as any)
        } catch (e) {
          fail(`route ${k}: ${(e as Error).message}`)
        }
        if (!(Number.isFinite(x) && (k === 'gap' ? x > 0 : x >= 0))) fail(`route ${k} must be a ${k === 'gap' ? 'positive' : 'non-negative'} length, got ${JSON.stringify(v)}`)
        return x
      }
      if (p.gap !== undefined) job.pair.gap = len('gap', p.gap)
      if (p.skew !== undefined) job.pair.skew = len('skew', p.skew)
    } else {
      job.from = toBoard(p.from)
      if (netEnd !== undefined) job.toNet = net(netEnd)
      else if (ends.length) job.to = toBoard(ends[0])
    }
    if (!p.whole) {
      job.infer = true
      const steps = finish(stepsOf(cmds, job.width, 'route'), `route(${start})`, !lone)
      if (lone) {
        const drawn = coordinate(p.from)
        if (!steps.length) fail(drawn ? `route(${start}) draws nothing; give its chain, such as .H(9)` : `route(${start}) has no end; give it, route(a, b)`)
        if (!drawn && steps[steps.length - 1].op !== 'B')
          fail(`route(${start}) ends in the open: its chain stops short of any end; give the end, route(a, b), or end the chain in .branch(…)`)
        if (drawn && p.net === undefined) fail(`route(${start}) is drawn copper from a coordinate, so it needs .net(n), or .net(null) for copper on no net`)
      }
      if (steps.length) {
        job.steps = steps
        job.path = stepsText(steps)
      }
    }
    if (p.net === null) {
      if (job.steps?.some(st => st.op === 'X' || st.op === 'XZ') || later.length || p.whole)
        fail(`route(${start}).net(null): copper on no net is drawn by hand; an automatic leg or a branch needs a net`)
    } else {
      const nn = net(p.net ?? (viaNets.length ? viaNets[0] : undefined))
      if (nn !== undefined) job.net = nn
      for (const v of viaNets.slice(p.net === undefined ? 1 : 0)) {
        const other = net(v)
        if (other !== nn) fail(`route ends at a via of ${other}, but the route is on ${nn}`)
      }
    }
    if (p.whole && job.net === undefined) fail('route(NET) needs a net')
    if (p.netN !== undefined) {
      if (!job.pair) return fail('a second net is for a differential pair only, route([aP, aN], [bP, bN]).net(P, N)')
      const n2 = net(p.netN)
      if (n2 !== undefined) job.pair.net = n2
    }
    const tree1 = ends.length > 1 || nested || p.whole || netEnd !== undefined
    const one = (what: string) => {
      if (tree1)
        fail(
          `${what} needs a route between two ends, route(a, b); this one has ${p.whole ? 'every pad of a net' : nested ? 'branches' : netEnd !== undefined ? 'a net as its end' : `${ends.length + 1} ends`}`,
        )
      if (lone) fail(`${what} needs a route between two ends, route(a, b)`)
    }
    if (p.impedance !== undefined) {
      one('an impedance')
      if (!(typeof p.impedance === 'number' && Number.isFinite(p.impedance) && p.impedance > 0))
        fail(`route impedance must be a positive number of ohms, got ${JSON.stringify(p.impedance)}`)
      job.impedance = p.impedance
    }
    if (p.neck !== undefined)
      try {
        job.neck = checkNeck(p.neck, 'route neck')
      } catch (e) {
        fail((e as Error).message)
      }
    if (p.corner !== undefined)
      try {
        job.corner = checkCorner(p.corner, 'route corner')
      } catch (e) {
        fail((e as Error).message)
      }
    if (p.teardrops !== undefined)
      try {
        flat.routeTeardrops[id] = checkTeardrops(p.teardrops, 'route')
      } catch (e) {
        fail((e as Error).message)
      }
    const lenOf = (k: string, v: unknown, positive: boolean): number => {
      let x = NaN
      try {
        x = mm(v as any)
      } catch (e) {
        fail(`route ${k}: ${(e as Error).message}`)
      }
      if (!(Number.isFinite(x) && (positive ? x > 0 : x >= 0))) fail(`route ${k} must be a ${positive ? 'positive' : 'non-negative'} length, got ${JSON.stringify(v)}`)
      return x
    }
    if (p.length !== undefined) {
      one('a length target')
      const o = p.length
      const spec: NonNullable<AutoRouteJob['length']> = {}
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const k of ['min', 'max', 'target', 'tolerance'] as const) if (o[k] !== undefined) spec[k] = lenOf(`length ${k}`, o[k], k !== 'tolerance' && k !== 'min')
        if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) fail(`route length: min ${spec.min} is above max ${spec.max}`)
        if (spec.target === undefined && spec.min === undefined && spec.max === undefined) fail('route length needs min, max or target')
      } else spec.target = lenOf('length', o, true)
      job.length = spec
    }
    if (p.match !== undefined) {
      one('a match group')
      const m = typeof p.match === 'string' ? { group: p.match } : p.match
      if (!m || typeof m.group !== 'string' || !m.group.trim()) fail(`route match needs a group name, got ${JSON.stringify(p.match)}`)
      job.match = { group: m.group, ...(m.tolerance !== undefined ? { tolerance: lenOf('match tolerance', m.tolerance, false) } : {}) }
    }
    flat.autoRoutes.push(job)
    // a branch or an extra end shares the trunk's net, which the pads may give later
    const shared = (j: AutoRouteJob) => (job.net !== undefined && j.net === undefined ? { ...j, net: job.net } : j)
    for (const j of later) flat.autoRoutes.push(shared(j))
    for (const e of ends.slice(1)) {
      const j: AutoRouteJob = { ...base(), from: toBoard(e), to: job.from, sub: true, infer: true }
      if (job.width !== undefined) j.width = job.width
      flat.autoRoutes.push(shared(j))
    }
  }

  // a font path is relative to the file that declares it
  const fontErr = (msg: string, n: PcbNode) => new CompileError(`<text> ${msg}${where(n)}`, srcOf(n))
  const fontFile = (e: unknown, base: string | undefined, n: PcbNode, what: string): OutlineFont => {
    const o: FontSpec | null = e && typeof e === 'object' && typeof (e as any).file === 'string' ? (e as FontSpec) : null
    if (!o || !o.file.trim()) throw fontErr(`${what} must be { file }, such as { file: './fonts/RobotoSlab-Bold.ttf' }, got ${JSON.stringify(e)}`, n)
    if (o.weight !== undefined && !(typeof o.weight === 'number' && o.weight > 0)) throw fontErr(`${what} weight must be a number such as 700, got ${JSON.stringify(o.weight)}`, n)
    const p = platform()
    const path = p.path
    const abs = o.path ?? (o.file.startsWith('file:') ? p.fromUrl(o.file) : path.isAbsolute(o.file) ? o.file : path.resolve(base ? path.dirname(base) : '', o.file))
    try {
      return loadOutlineFont(abs, o.weight)
    } catch (err) {
      throw fontErr(`${what}: ${(err as Error).message}`, n)
    }
  }
  const fileOf = (n: PcbNode | undefined) => {
    const s = n && srcOf(n)
    return s?.file ? absFile(s.file, opts.files, platform().path, opts.sourceRoot) : undefined
  }
  const fontOf = (f: unknown, n: PcbNode): OutlineFont | null => {
    if (strokeFontName(f)) return null
    if (typeof f !== 'string') throw fontErr(`font must be a name: "hershey", "newstroke" or a name in the fonts of <PCB>, got ${JSON.stringify(f)}`, n)
    const own = boardFonts && typeof boardFonts === 'object' ? (boardFonts as Record<string, unknown>)[f] : undefined
    if (own !== undefined) return fontFile(own, fileOf(node), n, `font "${f}" of <PCB ${flat.name}> fonts`)
    const known = Object.keys(boardFonts && typeof boardFonts === 'object' ? boardFonts : {})
    throw fontErr(
      `font ${JSON.stringify(f)} is not in the fonts of <PCB>; ${known.length ? `the names are ${known.map(k => JSON.stringify(k)).join(', ')}, and ` : ''}"hershey" and "newstroke" are the stroke fonts`,
      n,
    )
  }

  let halted = false
  const boundary = opts.previewBefore
  const sameSource = (a: string, b: string) => absFile(a, opts.files, platform().path, opts.sourceRoot) === absFile(b, opts.files, platform().path, opts.sourceRoot)
  const walk = (c: Child, ctx: Ctx): void => {
    if (halted) return
    if (c === null || c === undefined || c === false || typeof c === 'string' || typeof c === 'number') return
    if (Array.isArray(c)) {
      for (const k of c) walk(k, ctx)
      return
    }
    const list = childList(c)
    if (list) {
      // any other iterable, a generator included, is read once
      list.forEach((k, i) => {
        if (k !== null && typeof k === 'object' && !isNode(k) && !childList(k))
          throw new CompileError(`unexpected child ${JSON.stringify(k)}, yield ${i + 1} of an iterable child${where(cur)}`, cur && srcOf(cur))
        if (partOf(k))
          throw new CompileError(
            `${partOf(k)!.label} is a part, not an element: place it as a JSX element, <R1 at="12 5" />; it is yield ${i + 1} of an iterable child${where(cur)}`,
            cur && srcOf(cur),
          )
        if (typeof k === 'function' || typeof k === 'symbol' || typeof k === 'bigint' || k === true)
          throw new CompileError(`unexpected child ${String(k)}, yield ${i + 1} of an iterable child${where(cur)}`, cur && srcOf(cur))
        walk(k as Child, ctx)
      })
      return
    }
    if (partOf(c)) throw new CompileError(`${partOf(c)!.label} is a part, not an element: place it as a JSX element, <R1 at="12 5" />${where(cur)}`, cur && srcOf(cur))
    if (!isNode(c)) throw new CompileError(`unexpected child ${JSON.stringify(c)}`)
    const n = c
    pulse()
    const self = srcOf(n)
    if (boundary && self && sameSource(self.file, boundary.file) && self.line === boundary.line && self.col === boundary.col) {
      halted = true
      return
    }
    cur = n
    if (typeof n.type === 'function') {
      const props = propsOf(n)
      if (n.children.length) props.children = n.children.length === 1 ? n.children[0] : n.children
      const st = partOf(n.type)
      if (st) {
        const o = ctx.own?.get(st)
        if (o) o.used = true
        placePart(st, o?.node ?? n, o ? propsOf(o.node) : props, ctx)
        return
      }
      let out: Child
      try {
        out = renderComponent<Child>(n.type, props)
      } catch (e) {
        if (isSchematicError(e)) throw new CompileError(e.message + where(n), self)
        throw e
      }
      if (partOf(out))
        throw new CompileError(
          `<${n.type.name || 'Component'}> made the part ${partOf(out)!.label} instead of an element: as JSX, a footprint needs a ref or an at${where(n)}`,
          self,
        )
      walk(out, { ...ctx, site: ctx.site ?? self, chain: chained(ctx, self) })
      return
    }
    const p = propsOf(n)
    // a route() inside a helper also carries the helper's call site, innermost
    const call = rangeOf((n.props?.__src as { call?: unknown } | undefined)?.call)
    const chain = call ? [...ctx.chain, { ...call, call: true as const }] : ctx.chain
    const origin = { src: self, ...(chain.length ? { chain } : {}) }
    switch (n.type) {
      case 'board':
        throw new CompileError(`<PCB> can only be the root${where(n)}`, srcOf(n))
      case 'g': {
        const mark = p[LAYOUT_PROP] as LayoutMark | undefined
        if (mark) {
          const site = rangeOf(mark.src) ?? ctx.chain.at(-1) ?? self
          const prev = layoutAt.get(mark.inst)
          const path = instancePath(mark.inst).join('/')
          if (prev)
            throw new CompileError(
              `the circuit instance ${path} is laid out twice on <PCB ${flat.name}>: by ${prev.name} at ${loc(prev.src)} and by ${mark.name} at ${loc(site)}`,
              site,
            )
          const active: ActiveLayout = { inst: mark.inst, name: mark.name, key: mark.key, src: site }
          layoutAt.set(mark.inst, active)
          const own = ownPlacements(mark, ctx.own, path, site)
          const pending: Pending = { path, at: mark.at, snap: mark.snap, done: false, ...(site ? { src: site } : {}) }
          walkGroup(n, p, { ...ctx, layouts: [...ctx.layouts, active], levels: [...ctx.levels, { path, key: mark.key }], own, pending })
          if (!pending.done)
            flat.placements.push({
              inst: path,
              computed: true,
              m: ctx.grid?.m ?? ctx.m,
              grid: ctx.grid?.name ?? null,
              ...(site ? { src: site } : {}),
              ...defOf(ctx.levels),
              within: [...withinOf(ctx.levels), path],
            })
          for (const c of mark.own) {
            const o = [...own.values()].find(x => x.node === c)
            if (o && !o.used) throw new CompileError(`<${mark.name}> places no part of ${path} that ${describeOwn(o.node)} could replace`, srcOf(o.node))
          }
          return
        }
        walkGroup(n, p, ctx)
        return
      }
      case 'footprint': {
        if (ctx.fp) throw new CompileError(`<footprint ${p.ref}> inside another footprint${where(n)}`, srcOf(n))
        const bind = ctx.part && !ctx.part.rec && String(p.ref) === ctx.part.id ? ctx.part : undefined
        if (!bind)
          throw new CompileError(
            `<footprint> draws the footprint of a part and is placed through it: define it with defineFootprint, make a part, const U1 = MyFootprint(…), and place <U1 at="…" />${where(n)}`,
            srcOf(n),
          )
        for (const k of ['nets', 'net'])
          if (p[k] !== undefined) throw new CompileError(`${bind.st.label}: <footprint ${k}> is not taken; a part's pads get their nets from .connect()${where(n)}`, srcOf(n))
        // the part's name for messages, before the refs are final
        const who = bind.st.explicitRef ?? bind.st.boundRef ?? bind.st.label
        const [x, y, r] = parseAt(p.at)
        const flip = sideFlip(p.side)
        const m = mul(ctx.m, placement(x, y, r, flip))
        const flipped = ctx.flipped !== flip
        const rec: Footprint = {
          ref: String(p.ref),
          value: String(p.value ?? ''),
          id: String(p.id ?? ''),
          at: apply(m, [0, 0]),
          rot: rotationOf(m),
          side: flipped ? 'B' : 'F',
          fields: { ...(p.fields ?? {}) },
          bom: p.bom !== false,
          pos: p.pos !== false,
          description: p.description,
          pads: [],
          src: ctx.site ?? self,
        }
        // out of the BOM and the placement file, still on the board and in the DRC
        if (p.dnp !== undefined && typeof p.dnp !== 'boolean') throw new CompileError(`${who}: dnp must be true or false${where(n)}`, srcOf(n))
        if (p.dnp) {
          rec.dnp = true
          rec.bom = false
          rec.pos = false
        }
        const chain = chained(ctx, self)
        if (chain.length) rec.chain = chain
        if (p.height !== undefined) rec.height = mm(p.height, 1)
        if (p.model !== undefined) {
          if (!p.model || typeof p.model !== 'object' || (typeof p.model.kind !== 'string' && typeof (p.model as any).file !== 'string' && !('step' in p.model)))
            throw new CompileError(`${who}: model needs a kind, or file for a model file${where(n)}`, srcOf(n))
          try {
            rec.model = footprintModel(p.model, who, [rec.src, ...chain], opts.files, opts.sourceRoot)
          } catch (e: any) {
            throw new CompileError(e.message + where(n), srcOf(n))
          }
        }
        if (flat.footprints.some(f => f.ref === rec.ref)) throw new CompileError(`duplicate ref ${rec.ref}${where(n)}`, srcOf(n))
        if (p['ref:at'] === false) REF_AT.set(rec, false)
        else if (p['ref:at'] !== undefined && p['ref:at'] !== null) {
          let ra: [number, number, number] = [0, 0, 0]
          try {
            ra = parseAt(p['ref:at'])
          } catch (e) {
            throw new CompileError(`${who}: ref:at ${(e as Error).message}, or false for no silk ref${where(n)}`, rec.src ?? srcOf(n))
          }
          REF_AT.set(rec, { at: apply(m, [ra[0], ra[1]]), rot: rotationOf(mul(m, placement(0, 0, ra[2], false))) })
        }
        if (bind.refSrc) REF_SRC.set(rec, bind.refSrc)
        flat.footprints.push(rec)
        fpFrame.set(rec, m)
        bind.st.footprintId = rec.id || bind.st.footprintId
        const fp = { rec, pads: [] as Pad[], label: who }
        walkChildren(n, { ...ctx, m, flipped, fp, chain, part: undefined })
        cur = n
        if (p.netTie !== undefined) {
          try {
            rec.netTie = netTieGroups(p.netTie, fp.pads)
          } catch (e) {
            throw new CompileError(`${bind.st.label}: netTie ${(e as Error).message}${where(n)}`, srcOf(n))
          }
        }
        if (p.thermal !== undefined) {
          const own = srcOf(n),
            placed = rec.src && rec.src !== own ? rec.src : undefined
          padThermals(bind.st.label, p.thermal, fp.pads, placed ? ` (${loc(placed)}${own ? `, footprint at ${loc(own)}` : ''})` : where(n), placed ?? own)
        }
        // a pad's own setting wins over the footprint's and the part's .rules()
        {
          let own: RuleSet<PartRuleKey> = {}
          if (p.rules !== undefined) {
            try {
              own = ruleOverrides(p.rules, PART_RULE_KEYS, `${bind.st.label}: rules`)
            } catch (e) {
              throw new CompileError((e as Error).message + where(n), srcOf(n))
            }
          }
          const merged = mergeRuleSets(own, bind.st.rules)
          for (const k of PART_RULE_KEYS) {
            const v = merged[k]
            if (v === undefined) continue
            if (k === 'thermal') {
              const a = (v as { angle?: 90 | 45 }).angle
              if (a !== undefined) for (const pad of fp.pads) if (pad.thermalAngle === undefined) pad.thermalAngle = a
              continue
            }
            if (k === 'clearance') {
              for (const pad of fp.pads)
                if (pad.clearance === undefined && pad.clearanceTo === undefined) {
                  if (typeof v === 'number') pad.clearance = v
                  else pad.clearanceTo = { ...(v as object) }
                  pad.override = { ...(pad.override ?? {}), clearance: 'part' }
                }
              continue
            }
            for (const pad of fp.pads)
              if (pad[k] === undefined) {
                pad[k] = v as number
                pad.override = { ...(pad.override ?? {}), [k]: 'part' }
              }
          }
        }
        {
          bind.rec = rec
          bind.pads = fp.pads
          // an NC pad takes no net; any other pad must equal a pin's name or number
          try {
            bind.padPins = pinsOfPads(bind.st, fp.pads)
          } catch (e) {
            if (isSchematicError(e)) throw new CompileError(e.message + where(n), srcOf(n))
            throw e
          }
          const seen = new Set<string>()
          fp.pads.forEach((pad, i) => {
            const pin = bind.padPins![i]
            if (pin === null) {
              if (pad.type !== 'npth' && pad.num !== '') pad.net = undefined
              return
            }
            seen.add(pin)
            const c = bind.st.conn.get(pin)
            if (c === undefined) return
            pad.net = isNC(c) ? undefined : net(c)
          })
          const missing = bind.st.pins.filter(q => !seen.has(q))
          if (missing.length) throw new CompileError(`${bind.st.label}: no pad for pin${missing.length > 1 ? 's' : ''} ${missing.join(', ')} on its footprint${where(n)}`, srcOf(n))
        }
        return
      }
      case 'pad': {
        if (p.num === undefined) throw new CompileError(`<pad> needs a num${where(n)}`, srcOf(n))
        const [x, y, r] = parseAt(p.at)
        const m = mul(ctx.m, placement(x, y, r, false))
        const num = String(p.num),
          name = String(p.name ?? num)
        const dimensions = (value: any, field: string): [number, number] => {
          try {
            const dims = size2(value)
            for (const [i, v] of dims.entries()) if (!(v > 0)) throw new Error(`${field}[${i}] must be positive`)
            return dims
          } catch (e) {
            throw new CompileError(`<pad ${num}> ${field}: ${(e as Error).message}${where(n)}`, srcOf(n))
          }
        }
        const [w, h] = dimensions(p.size, 'size')
        const drill = p.drill !== undefined ? dimensions(p.drill, 'drill') : null
        const type = (p.type ?? (drill ? 'tht' : 'smd')) as Pad['type']
        if (p.roundness !== undefined && !Number.isFinite(p.roundness)) throw new CompileError(`<pad ${num}> roundness must be finite${where(n)}`, srcOf(n))
        const shape = (p.shape ?? (type === 'smd' ? 'roundrect' : 'circle')) as Pad['shape']
        if (type === 'npth' && !drill) throw new CompileError(`npth pad ${num} needs a drill${where(n)}`, srcOf(n))
        let ring: Ring
        if (shape === 'custom') {
          const pts = p.points
          if (!Array.isArray(pts) || pts.length < 3 || !pts.every((q: unknown) => Array.isArray(q) && q.length === 2 && q.every(v => typeof v === 'number' && Number.isFinite(v))))
            throw new CompileError(`<pad ${num}> shape "custom" needs points, a list of at least three [x, y] in mm${where(n)}`, srcOf(n))
          ring = pts.map((q: [number, number]) => [q[0], q[1]] as Pt)
        } else ring = padRing(shape, w, h, p.roundness)
        const flipped = ctx.flipped
        const layersIn: string[] = p.layers ?? (type === 'smd' ? ['F.Cu'] : type === 'npth' ? [] : copperLayers(copper))
        const layersOut = layersIn.map(l => layer(n, l, flipped))
        if (p.net !== undefined) throw new CompileError(`<pad ${num} net> is not taken; a part's pads get their nets from .connect()${where(n)}`, srcOf(n))
        if (p.nc !== undefined && typeof p.nc !== 'boolean') throw new CompileError(`<pad ${num}> nc must be true or false${where(n)}`, srcOf(n))
        const pad = add<Pad>(
          {
            kind: 'pad',
            layer: layersOut[0] ?? 'F.Cu',
            ref: ctx.fp?.rec.ref,
            ...origin,
            num,
            name,
            at: apply(m, [0, 0]),
            rot: rotationOf(m),
            shape,
            size: [w, h],
            drill,
            type,
            layers: layersOut,
            poly: applyRing(m, ring),
            maskExpansion: p.maskExpansion !== undefined ? mm(p.maskExpansion) : undefined,
            paste: p.paste === undefined ? type === 'smd' : p.paste !== false,
            mirrored: isMirrored(m),
          },
          ctx,
        )
        if (p.nc) markNcPad(pad)
        if (p.thermal !== undefined) padThermal(pad, p.thermal, `<pad ${num}> thermal`, where(n), srcOf(n))
        if (p.clearance !== undefined || p.holeClearance !== undefined || p.pasteShrink !== undefined) {
          let o: RuleSet<'clearance' | 'holeClearance' | 'pasteShrink'>
          try {
            o = ruleOverrides(
              { clearance: p.clearance, holeClearance: p.holeClearance, pasteShrink: p.pasteShrink },
              ['clearance', 'holeClearance', 'pasteShrink'] as const,
              `<pad ${num}>`,
            )
          } catch (e) {
            throw new CompileError((e as Error).message + where(n), srcOf(n))
          }
          for (const [k, v] of Object.entries(o) as ['clearance' | 'holeClearance' | 'pasteShrink', number | object][]) {
            if (k === 'clearance' && typeof v === 'object') pad.clearanceTo = { ...v }
            else pad[k] = v as number
            pad.override = { ...(pad.override ?? {}), [k]: 'pad' }
          }
        }
        try {
          padPaste(pad, p, ring, w, h, m, flat.rules)
        } catch (e) {
          throw new CompileError(`<pad ${num}> ${(e as Error).message}${where(n)}`, srcOf(n))
        }
        // an NPTH opens the mask on both sides, as KiCad does: the pad grown by its expansion, or the hole when the pad is no larger than its drill
        if (p.mask !== undefined && typeof p.mask !== 'boolean') throw new CompileError(`<pad ${num}> mask must be true or false${where(n)}`, srcOf(n))
        if (type === 'npth' && p.mask !== false) {
          const masks = layersOut.filter(l => l.endsWith('.Mask'))
          const padSized = Math.min(w, h) > Math.max(...drill!) + 1e-9 || layersOut.some(l => l.endsWith('.Cu'))
          const hole = drill![0] === drill![1] ? padRing('circle', drill![0], drill![0]) : padRing('oval', drill![0], drill![1])
          pad.maskRings = polysToRings(offset([padSized ? pad.poly : applyRing(m, hole)], pad.maskExpansion ?? flat.rules.maskExpansion))
          if (!masks.length) pad.layers.push('F.Mask', 'B.Mask')
        }
        if (ctx.fp) {
          ctx.fp.rec.pads.push(pad.id)
          ctx.fp.pads.push(pad)
        }
        return
      }
      case 'track': {
        if (p.from !== undefined || p.whole) {
          routeJobs(n, p, ctx, origin)
          return
        }
        // the raw polyline the compiler makes; copper drawn by hand is a route() chain
        const l = layer(n, p.layer, ctx.flipped)
        let width = 0
        try {
          width = mm(p.width)
        } catch (e) {
          throw new CompileError(`<track> width: ${(e as Error).message}${where(n)}`, srcOf(n))
        }
        if (!Array.isArray(p.points)) throw new CompileError(`<track> takes points${where(n)}`, srcOf(n))
        const pts = p.points.map((q: any) => {
          const [x, y] = endAt(q)
          return [x, y] as [number, number]
        })
        if (pts.length >= 2) add<Track>({ kind: 'track', layer: l, net: net(p.net), ref: ctx.fp?.rec.ref, ...origin, pts: applyRing(ctx.m, pts), width }, ctx)
        return
      }
      case 'via': {
        const [x, y] = parseAt(p.at)
        const { drill, size } = resolveVia(flat.rules, flat.via, { drill: mm(p.drill, viaDrill), size: mm(p.size, viaSize) })
        if (!(drill > 0)) throw new CompileError(`<via> drill must be positive${where(n)}`, srcOf(n))
        if (!(size > 0)) throw new CompileError(`<via> size must be positive${where(n)}`, srcOf(n))
        const ls = (p.layers ?? ['F.Cu', 'B.Cu']).map((q: string) => layer(n, q, ctx.flipped)) as [string, string]
        add<Via>(
          {
            kind: 'via',
            layer: ls[0],
            net: net(p.net),
            ref: ctx.fp?.rec.ref,
            ...origin,
            at: apply(ctx.m, [x, y]),
            drill,
            size,
            layers: ls,
          },
          ctx,
        )
        return
      }
      case 'zone': {
        const l = layer(n, p.layer, ctx.flipped)
        const subs = parsePath(String(p.d)).filter(s => s.pts.length >= 3)
        const rings = subs.map(s => applyRing(ctx.m, s.pts))
        const prims = subs.some(s => hasArc(s.prims)) ? subs.map(s => applyPrims(ctx.m, s.prims)) : undefined
        add<Zone>(
          {
            kind: 'zone',
            layer: l,
            net: net(p.net),
            ref: ctx.fp?.rec.ref,
            ...origin,
            outline: rings,
            priority: p.priority ?? 0,
            clearance: p.clearance !== undefined ? mm(p.clearance) : undefined,
            minWidth: p.minWidth !== undefined ? mm(p.minWidth) : undefined,
            fill: [],
            ...(prims?.some(hasArc) ? { prims } : {}),
            ...(p.connect !== undefined ? { connect: thermalConnection(p.connect, 'pour() connect', where(n), srcOf(n)) } : {}),
            ...(p.islands !== undefined ? { islands: islandsOf(p.islands, n) } : {}),
          },
          ctx,
        )
        return
      }
      case 'keepout': {
        const cu = copperLayers(copper)
        const names: unknown[] = p.layers ?? cu
        if (!Array.isArray(names) || !names.length) throw new CompileError(`keepout() layers must be a list of copper layers, or left out for every one${where(n)}`, srcOf(n))
        const ls = [...new Set(names.map(q => layer(n, q, ctx.flipped)))]
        for (const l of ls) if (!cu.includes(l)) throw new CompileError(`keepout() layer ${l} is not a copper layer${where(n)}`, srcOf(n))
        if (typeof p.d !== 'string') throw new CompileError(`keepout() needs an area${where(n)}`, srcOf(n))
        const flag = (k: string) => {
          const v = p[k]
          if (v !== undefined && typeof v !== 'boolean') throw new CompileError(`keepout() ${k} must be true or false${where(n)}`, srcOf(n))
          return v !== false
        }
        // counter-clockwise, so pours and the router can union and subtract with the nonzero rule
        const ccw = (r: Ring): Ring => {
          let a = 0
          for (let i = 0; i < r.length; i++) {
            const q = r[(i + 1) % r.length]
            a += r[i][0] * q[1] - q[0] * r[i][1]
          }
          return a < 0 ? [...r].reverse() : r
        }
        const rings = parsePath(p.d)
          .filter(sp => sp.pts.length >= 3)
          .map(sp => ccw(applyRing(ctx.m, sp.pts)))
        if (!rings.length) throw new CompileError(`keepout() area has no closed area${where(n)}`, srcOf(n))
        if (p.except !== undefined && !Array.isArray(p.except)) throw new CompileError(`keepout() except must be a list of nets${where(n)}`, srcOf(n))
        const except = [
          ...new Set(
            ((p.except ?? []) as unknown[]).map(q => {
              const name = net(isPinRef(q) ? q.net : q)
              if (name === undefined) throw new CompileError(`keepout() except takes nets, got ${String(q)}${where(n)}`, srcOf(n))
              return name
            }),
          ),
        ]
        flat.keepouts.push(
          local(
            {
              layers: cu.filter(l => ls.includes(l)),
              outline: rings,
              tracks: flag('tracks'),
              vias: flag('vias'),
              pours: flag('pours'),
              ...(except.length ? { except } : {}),
              ...(ctx.fp ? { ref: ctx.fp.rec.ref } : {}),
              ...origin,
            },
            ctx,
          ),
        )
        return
      }
      case 'stitch': {
        const fail = (msg: string): never => {
          throw new CompileError(`stitch() ${msg}${where(n)}`, srcOf(n))
        }
        if (ctx.fp) fail('is a board element, not one of a footprint')
        const name = net(isPinRef(p.net) ? p.net.net : p.net)
        if (name === undefined) fail('needs a net')
        const pitch = mm(p.pitch, 4)
        if (!(pitch > 0)) fail('pitch must be more than 0')
        const cu = copperLayers(copper)
        let ls: string[] | undefined
        if (p.layers !== undefined) {
          if (!Array.isArray(p.layers) || !p.layers.length) fail('layers must be a list of copper layers')
          ls = [...new Set((p.layers as unknown[]).map(q => layer(n, q, ctx.flipped)))]
          for (const l of ls) if (!cu.includes(l)) fail(`layer ${l} is not a copper layer`)
          ls = cu.filter(l => ls!.includes(l))
        }
        const v = p.via ?? {}
        const { drill, size } = resolveVia(flat.rules, flat.via, { drill: mm(v.drill, viaDrill), size: mm(v.size, viaSize) })
        if (!(drill > 0) || !(size > drill)) fail(`via size ${size} must be more than its drill ${drill}`)
        const padClearance = p.padClearance !== undefined ? mm(p.padClearance) : undefined
        if (padClearance !== undefined && !(padClearance >= 0)) fail('padClearance must be 0 or more')
        let area: Ring[] | undefined
        if (p.area !== undefined) {
          if (typeof p.area !== 'string') fail('area must be an SVG path')
          area = parsePath(p.area)
            .filter(sp => sp.pts.length >= 3)
            .map(sp => applyRing(ctx.m, sp.pts))
          if (!area.length) fail('area has no closed area')
        }
        const grid = p.grid !== undefined ? mm(p.grid) : undefined
        if (grid !== undefined && !(grid > 0)) fail('grid must be more than 0')
        let at0: [number, number] | undefined
        if (p.origin !== undefined) {
          try {
            const [x, y] = parseAt(p.origin)
            at0 = apply(ctx.m, [x, y])
          } catch (e) {
            fail(`origin: ${(e as Error).message}`)
          }
        }
        flat.stitches.push(
          local(
            {
              net: name!,
              pitch,
              ...(ls ? { layers: ls } : {}),
              ...(padClearance !== undefined ? { padClearance } : {}),
              drill,
              size,
              silk: !!p.avoid?.silk,
              courtyard: !!p.avoid?.courtyard,
              ...(grid !== undefined ? { grid } : {}),
              ...(at0 ? { origin: at0 } : {}),
              ...(area ? { area } : {}),
              ...origin,
            },
            ctx,
          ),
        )
        return
      }
      case 'patch':
        flat.patches.push(patchOf(n))
        return
      case 'mate': {
        const fail = (msg: string): never => {
          throw new CompileError(`<mate>: ${msg}${where(n)}`, self)
        }
        const [x, y, r] = parseAt(p.at)
        const flip = sideFlip(p.side)
        const m = mul(ctx.m, placement(x, y, r, flip))
        flat.mates.push(
          local({ name: mateName(p.name, fail), at: apply(m, [0, 0]), rot: rotationOf(m), side: ctx.flipped !== flip ? 'B' : 'F', ...(self ? { src: self } : {}) }, ctx),
        )
        return
      }
      case 'reference':
        ;(flat.references ??= []).push({ props: p, m: ctx.m, ...(self ? { src: self } : {}) })
        return
      case 'path':
      case 'line':
      case 'circle':
      case 'rect': {
        const l = layer(n, p.layer, ctx.flipped)
        const width = mm(p.width, defaultWidth(l))
        let paths: Ring[] = [],
          closed: boolean[] = []
        // [] stands for a path without arcs; kept only when some path has an arc
        const prims: Prim[][] = []
        if (n.type === 'path')
          for (const s of parsePath(String(p.d))) {
            paths.push(s.pts)
            closed.push(s.closed)
            prims.push(s.prims)
          }
        else if (n.type === 'line') {
          paths.push([
            [mm(p.x1), mm(p.y1)],
            [mm(p.x2), mm(p.y2)],
          ])
          closed.push(false)
        } else if (n.type === 'circle') {
          const cx = mm(p.cx, 0),
            cy = mm(p.cy, 0),
            r = mm(p.r)
          paths.push(circleRing(cx, cy, r))
          closed.push(true)
          if (r > 0) prims.push(circlePrims(cx, cy, r))
        } else {
          const w = mm(p.w),
            h = mm(p.h),
            x = mm(p.x),
            y = mm(p.y),
            rx = mm(p.rx, 0)
          const r = rx > 0 ? roundedRect(w, h, rx) : padRing('rect', w, h)
          const t = (q: Pt): Pt => [q[0] + x + w / 2, q[1] + y + h / 2]
          paths.push(r.map(t))
          closed.push(true)
          if (rx > 0) prims.push(applyPrims([1, 0, 0, 1, x + w / 2, y + h / 2], roundedRectPrims(w, h, rx)))
        }
        const arcs = prims.some(hasArc) ? prims.map(q => applyPrims(ctx.m, q)) : undefined
        add<Graphic>(
          {
            kind: 'graphic',
            layer: l,
            net: net(p.net),
            ref: ctx.fp?.rec.ref,
            ...origin,
            paths: paths.map(r => applyRing(ctx.m, r)),
            closed,
            width,
            fill: !!p.fill,
            ...(arcs?.some(hasArc) ? { prims: arcs } : {}),
          },
          ctx,
        )
        return
      }
      case 'text': {
        const l = layer(n, p.layer, ctx.flipped)
        const [x, y, r] = parseAt(p.at)
        let m = mul(ctx.m, placement(x, y, r, false))
        // back-side text reads mirrored whatever the groups did
        const mirrored = l.startsWith('B.')
        if (isMirrored(m) !== mirrored) m = mul(m, placement(0, 0, 0, true))
        const text = n.children
          .flat()
          .filter(c => typeof c === 'string' || typeof c === 'number')
          .join('')
        const font = fontOf(p.font, n)
        const size = mm(p.size, 1)
        const placeText = (it: Text) => {
          if (!ctx.fp)
            flat.placements.push({
              text: it,
              m: ctx.m,
              grid: null,
              ...(p.grid !== undefined ? { snap: placementSnap(p.grid) } : {}),
              ...(self ? { src: self } : {}),
              at: [x, y, r],
              ...defOf(ctx.levels),
              within: withinOf(ctx.levels),
            })
        }
        const silk = l.endsWith('.SilkS')
        if (font) {
          const anchor: Text['anchor'] = p.anchor ?? 'middle'
          const width = p.width === undefined ? undefined : mm(p.width, size)
          if (width !== undefined && !(width > 0))
            throw new CompileError(`<text> width must be a positive length, the glyph width, got ${JSON.stringify(p.width)}${where(n)}`, srcOf(n))
          const laid = outlineText(text, font, { size, anchor, ...(width !== undefined ? { width } : {}) })
          if (laid.missing.length) {
            const k = `${font.family} ${font.style}`
            for (const ch of laid.missing) (missingOutline.get(k) ?? missingOutline.set(k, new Set()).get(k)!).add(ch)
          }
          const dy = size - laid.height / 2
          const tr = (r: Ring): Ring =>
            applyRing(
              m,
              r.map(([a, b]) => [a, b + dy] as [number, number]),
            ).map(([a, b]) => [nm(a), nm(b)] as [number, number])
          let polys = laid.polys.map(q => ({ outer: tr(q.outer), holes: q.holes.map(tr) }))
          // ink thinner than silkMinWidth grows by half the deficit, so the thinnest stroke prints at the minimum
          if (p.thicken === true && silk) {
            const thin = thinInk(polys, flat.rules.silkMinWidth)
            if (thin)
              polys = offsetPolys(polys, (flat.rules.silkMinWidth - thin.width) / 2 + 0.001).map(q => ({
                outer: q.outer.map(([a, b]) => [nm(a), nm(b)] as [number, number]),
                holes: q.holes.map(h => h.map(([a, b]) => [nm(a), nm(b)] as [number, number])),
              }))
          } else if (p.thicken !== undefined && typeof p.thicken !== 'boolean')
            throw new CompileError(`<text> thicken must be true or false, got ${JSON.stringify(p.thicken)}${where(n)}`, srcOf(n))
          flat.outlineFonts[`${font.family} ${font.style}`] ??= {
            ...(font.copyright ? { copyright: font.copyright } : {}),
            ...(font.license ? { license: font.license } : {}),
            ...(font.licenseURL ? { licenseURL: font.licenseURL } : {}),
          }
          placeText(
            add<Text>(
              {
                kind: 'text',
                layer: l,
                net: net(p.net),
                ref: ctx.fp?.rec.ref,
                ...origin,
                at: apply(m, [0, 0]),
                rot: rotationOf(m),
                size,
                thickness: 0,
                ...(width !== undefined && width !== size ? { width } : {}),
                text,
                anchor,
                mirrored,
                strokes: [],
                font: `${font.family} ${font.style}`,
                polys,
              },
              ctx,
            ),
          )
          return
        }
        const thickness = silk ? Math.max(mm(p.thickness, flat.rules.silkMinWidth), flat.rules.silkMinWidth) : mm(p.thickness, 0.15)
        const anchor: Text['anchor'] = p.anchor ?? 'middle'
        const width = p.width === undefined ? undefined : mm(p.width, size)
        if (width !== undefined && !(width > 0))
          throw new CompileError(`<text> width must be a positive length, the glyph width, got ${JSON.stringify(p.width)}${where(n)}`, srcOf(n))
        const stroke = strokeFontName(p.font)!
        const laid = strokeText(text, { size, thickness, anchor, ...(width !== undefined ? { width } : {}), font: stroke })
        for (const ch of laid.missing) (missingGlyphs.get(stroke) ?? missingGlyphs.set(stroke, new Set()).get(stroke)!).add(ch)
        // `at` is the vertical centre, from the cap line of the first line to the baseline of the last
        const dy = size - laid.height / 2
        const strokes = laid.strokes.map(s =>
          applyRing(
            m,
            s.map(([a, b]) => [a, b + dy] as [number, number]),
          ).map(([a, b]) => [nm(a), nm(b)] as [number, number]),
        )
        placeText(
          add<Text>(
            {
              kind: 'text',
              layer: l,
              net: net(p.net),
              ref: ctx.fp?.rec.ref,
              ...origin,
              at: apply(m, [0, 0]),
              rot: rotationOf(m),
              size,
              thickness,
              ...(width !== undefined && width !== size ? { width } : {}),
              text,
              anchor,
              mirrored,
              strokes,
              ...(stroke === 'newstroke' ? { font: 'newstroke' } : {}),
            },
            ctx,
          ),
        )
        return
      }
      default:
        throw new CompileError(`unknown element <${String(n.type)}>${where(n)}`, srcOf(n))
    }
  }
  const islandsOf = (v: unknown, n: PcbNode): IslandMode => {
    try {
      checkIslands(v, 'pour()')
    } catch (e) {
      throw new CompileError((e as Error).message + where(n), srcOf(n))
    }
    return typeof v === 'object' ? { minArea: (v as { minArea: number }).minArea } : (v as IslandMode)
  }
  /** A `<g>`: its name, grid and frame, then its children. */
  const walkGroup = (n: PcbNode, p: Record<string, any>, ctx: Ctx): void => {
    const self = srcOf(n)
    const outer = ctx.levels
    if (p.name !== undefined) {
      if (typeof p.name !== 'string' || !/^[A-Za-z_][\w-]*$/.test(p.name))
        throw new CompileError(`<g name>: ${JSON.stringify(p.name)} is not a name such as "Power"${where(n)}`, srcOf(n))
      const path = [...ctx.groups, p.name].join('/')
      if (groupAt.has(path)) throw new CompileError(`two <g> are named ${path} on <PCB ${flat.name}>, at ${loc(groupAt.get(path))} and at ${loc(self)}`, self)
      groupAt.set(path, self)
      ctx = { ...ctx, groups: [...ctx.groups, p.name], levels: [...ctx.levels, { path, key: groupKey(path, self) }] }
    }
    const snap = placementSnap(p.grid)
    const contentsGrid = isGrid(p.grid) ? p.grid : undefined
    if (contentsGrid?.spec.frame !== undefined && (p.at !== undefined || p.side !== undefined))
      throw new CompileError(`<g grid>: the grid ${p.grid.name} adopts the frame of a part, so this <g> takes no at or side${where(n)}`, srcOf(n), 'grid-frame')
    const [x, y, r] = parseAt(ctx.grid && typeof p.at === 'string' ? inGridUnits(p.at, ctx.grid.pitch) : p.at)
    const flip = sideFlip(p.side)
    const base = ctx.grid?.m ?? ctx.m
    const m = mul(base, placement(x, y, r, flip))
    if (p.name !== undefined)
      flat.placements.push({
        group: ctx.groups.join('/'),
        m: base,
        grid: ctx.grid?.name ?? null,
        ...(contentsGrid ? { rotationGrid: contentsGrid.name } : {}),
        ...(snap !== undefined ? { snap } : {}),
        ...(self ? { src: self } : {}),
        at: [x, y, r],
        side: flip ? 'B' : 'F',
        ...defOf(outer),
        within: withinOf(ctx.levels),
      })
    if (inLibrary(ctx)) ctx = { ...ctx, own: undefined }
    const lay = ctx.pending
    if (lay && !lay.done && lay.at !== undefined && p.at === lay.at) {
      lay.done = true
      const k = ctx.levels.findIndex(l => l.path === lay.path)
      flat.placements.push({
        inst: lay.path,
        m: base,
        grid: ctx.grid?.name ?? null,
        ...(contentsGrid ? { rotationGrid: contentsGrid.name } : {}),
        ...(lay.snap !== undefined || snap !== undefined ? { snap: lay.snap ?? snap } : {}),
        ...(lay.src ? { src: lay.src } : {}),
        at: [x, y, r],
        side: flip ? 'B' : 'F',
        ...defOf(ctx.levels.slice(0, k)),
        within: withinOf(ctx.levels.slice(0, k + 1)),
      })
    }
    // a start-only position is not worth a call-site level
    const inner = { ...ctx, m, flipped: ctx.flipped !== flip, chain: chained(ctx, rangeOf(n.props.__src)), grid: ctx.grid ? { ...ctx.grid, m } : null }
    if (!contentsGrid) walkChildren(n, inner)
    else attachGrid(contentsGrid, n, inner, false)
  }
  /** The own placements of a layout element's children over those of the layouts around it; each must place a part of the instance once. */
  const ownPlacements = (mark: LayoutMark, outer: Map<PartState, Own> | undefined, path: string, site?: Src): Map<PartState, Own> => {
    if (opts.library && (path === opts.library || path.startsWith(opts.library + '/'))) return new Map()
    const out = new Map(outer)
    for (const c of mark.own) {
      const st = isNode(c) && typeof c.type === 'function' ? partOf(c.type) : undefined
      const at = isNode(c) ? srcOf(c) : site
      if (!st) throw new CompileError(`<${mark.name}> takes as children only placements of the parts of ${path}, such as <${path.replace(/\//g, '.')}.R1 at="13 0" />`, at)
      if (!memberPath(mark.inst, st)) throw new CompileError(`<${mark.name}>: ${st.label} is no part of ${path}; a layout element's children place its own instance's parts`, at)
      if (out.has(st)) throw new CompileError(`${st.label} has two own placements, at ${loc(srcOf(out.get(st)!.node))} and at ${loc(at)}`, at)
      out.set(st, { node: c as PcbNode, used: false })
    }
    return out
  }
  const walkChildren = (n: PcbNode, ctx: Ctx) => {
    for (const k of n.children) walk(k, ctx)
  }

  /** A part element, `<R1 at="12 5" />`: render its footprint with a placeholder ref, which the registry replaces once every part is known. */
  const placePart = (st: PartState, n: PcbNode, props: Record<string, any>, ctx: Ctx) => {
    const self = srcOf(n)
    if (placedAt.has(st)) throw new CompileError(`${st.label} is placed twice on <PCB ${flat.name}>: at ${loc(placedAt.get(st))} and at ${loc(self)}`, self)
    if (ctx.fp) throw new CompileError(`${st.label} is placed inside the footprint of ${ctx.fp.label}${where(n)}`, self)
    const sym = Object.keys(props).filter(k => k === 'rot' || k === 'flip' || k === 'symbol')
    if (sym.length)
      throw new CompileError(
        `${st.label}: ${sym.join(', ')} belong${sym.length === 1 ? 's' : ''} to its symbol inside <Schematic>; on the board, at="x y rot" turns it and side="B" puts it on the bottom${where(n)}`,
        self,
      )
    const other = Object.keys(props).filter(k => !PLACE_PROPS.has(k))
    if (other.length)
      throw new CompileError(
        `${st.label}: a placement takes at, side, grid, locked, ref:at and thermal, not ${other.join(', ')}; the part's ref, nets, sourcing and options are set where it is made${where(n)}`,
        self,
      )
    placedAt.set(st, self)
    const bind: PartBinding = { st, id: `${PLACEHOLDER}${st.seq}`, layouts: ctx.layouts, site: self, refSrc: rangeOf(n.props?.__refSrc), groups: ctx.groups }
    bindings.push(bind)
    const fail = (msg: string): never => {
      throw new CompileError(`${st.label}: ${msg}${where(n)}`, self)
    }
    if (props.locked !== undefined && typeof props.locked !== 'boolean') fail('locked must be true or false')
    const { 'at:initial': initial, 'at:cost': cost, 'at:solver': solver, 'at:follow': follow, name, grid, locked, ...place } = props
    const snap = placementSnap(grid)
    if (ctx.grid && typeof place.at === 'string') place.at = inGridUnits(place.at, ctx.grid.pitch)
    const auto = autoPlacement(place.at, { initial, cost, solver, follow }, fail)
    if (auto) place.at = auto.start.join(' ')
    if (ctx.grid) ctx = { ...ctx, m: ctx.grid.m }
    const fields = Object.keys(st.sourced).length ? { fields: { ...st.sourced } } : {}
    const fpProps = { ...st.props, ...(st.value !== undefined ? { value: st.value } : {}), ...place, ...fields, ref: bind.id }
    const out = renderComponent<Child>(footprintRender(st.footprint), fpProps)
    walk(out, { ...ctx, site: ctx.site ?? self, chain: chained(ctx, self), part: bind })
    if (!bind.rec) throw new CompileError(`${st.label}: its footprint rendered no <footprint> with the ref it was given${where(n)}`, self)
    if (locked) bind.rec.locked = true
    if (ctx.grid) partGrid.set(bind.rec, ctx.grid.name)
    const owned = ctx.own?.get(st)?.node === n
    const k = ownLayout(ctx.layouts, st)
    const lay = k < 0 ? undefined : ctx.layouts[k]
    const of = owned ? (lay ? { owned: instancePath(lay.inst).join('/') } : {}) : lay?.src ? { layout: { src: lay.src, member: memberPath(lay.inst, st)!.join('.') } } : {}
    // an own placement is written around the layout element it replaces a placement of
    const at = lay ? ctx.levels.findIndex(l => l.path === instancePath(lay.inst).join('/')) : -1
    const def = defOf(owned ? ctx.levels.slice(0, at) : ctx.levels)
    flat.placements.push({
      fp: bind.rec,
      ...(snap !== undefined ? { snap } : {}),
      m: ctx.m,
      grid: ctx.grid?.name ?? null,
      ...(self ? { src: self } : {}),
      ...of,
      ...def,
      within: withinOf(owned ? ctx.levels.slice(0, at + 1) : ctx.levels),
    })
    if (auto) flat.placeJobs.push({ ...auto, fp: bind.rec, m: ctx.m, flip: sideFlip(place.side), ...(self ? { src: self } : {}) })
    if (name !== undefined) flat.mates.push(local({ name: mateName(name, fail), fp: bind.rec, ...(self ? { src: self } : {}) }, ctx))
  }

  const fpFrame = new Map<Footprint, Mat>()
  const partGrid = new Map<Footprint, string>()
  const gridNames = new Map<string, Src | undefined>()
  const pending: { g: Grid; n: PcbNode; ctx: Ctx }[] = []
  const gridReads: { name: string; src?: Src; reads: unknown[]; parent: string | null; frame?: unknown }[] = []
  const anchorOf = (part: unknown): Anchor | null => {
    const st = partOf(part)
    const b = st && bindings.find(x => x.st === st)
    const m = b?.rec && fpFrame.get(b.rec)
    if (!b || !m) return null
    return {
      m,
      pad: q => {
        const i = b.pads!.findIndex((pad, k) => (q.pad !== undefined ? pad.num === q.pad || pad.name === q.pad : b.padPins?.[k] === q.pin))
        return i < 0 ? null : (b.pads![i].at as [number, number])
      },
    }
  }
  /** Walk `n`'s children under the grid `g` attached in `ctx`'s frame; deferred while a part its origin reads is not placed, unless `provisional`. */
  const attachGrid = (g: Grid, n: PcbNode, ctx: Ctx, provisional: boolean): void => {
    const reads: unknown[] = []
    const { m, missing } = gridFrame(g, ctx.m, anchorOf, reads)
    if (missing && !provisional) {
      pending.push({ g, n, ctx })
      return
    }
    const self = srcOf(n)
    if (gridNames.has(g.name)) throw new CompileError(`two grids are named ${g.name} on <PCB ${flat.name}>, attached at ${loc(gridNames.get(g.name))} and at ${loc(self)}`, self)
    gridNames.set(g.name, self)
    flat.grids.push(gridRecord(g, m, null, self))
    gridReads.push({ name: g.name, ...(g.src ? { src: g.src } : {}), reads, parent: ctx.grid?.name ?? null, frame: g.spec.frame })
    walkChildren(n, { ...ctx, grid: { name: g.name, pitch: gridPitch(g), m } })
  }
  /** The grids deferred for an anchor placed later, in rounds; what is left reads a part placed under itself and is walked as it is, for the cycle check. */
  const walkPending = (): void => {
    while (pending.length) {
      const round = pending.splice(0)
      for (const x of round) attachGrid(x.g, x.n, x.ctx, false)
      if (pending.length < round.length) continue
      for (const x of pending.splice(0)) attachGrid(x.g, x.n, x.ctx, true)
    }
  }
  /** `<PCB grids>`: grids no element attaches, in the board frame. */
  const listGrids = (list: unknown, n: PcbNode): void => {
    if (list === undefined) return
    if (!Array.isArray(list) || !list.every(isGrid)) throw new CompileError(`<PCB ${flat.name}> grids is a list of defineGrid grids${where(n)}`, srcOf(n))
    for (const g of list) {
      if (gridNames.has(g.name)) continue
      const reads: unknown[] = []
      const { m } = gridFrame(g, IDENTITY, anchorOf, reads)
      gridNames.set(g.name, undefined)
      flat.grids.push(gridRecord(g, m, null))
    }
  }

  const missingGlyphs = new Map<string, Set<string>>()
  const missingOutline = new Map<string, Set<string>>()
  const layoutAt = new Map<InstanceState, ActiveLayout>()
  const groupAt = new Map<string, Src | undefined>()
  const scope = beginCompile(flat.rules)
  try {
    const root: Ctx = { m: IDENTITY, flipped: false, fp: null, chain: [], layouts: [], levels: [], groups: [], grid: null }
    if (boardGrid !== undefined && !isGrid(boardGrid))
      throw new CompileError(`<PCB ${p.name}> grid: a grid is made by defineGrid(name, { pitch }), got ${JSON.stringify(boardGrid)}${where(node)}`, srcOf(node))
    if (boardGrid === undefined) walkChildren(node, root)
    else attachGrid(boardGrid, node, root, false)
    walkPending()
    listGrids(boardGrids, node)
    for (const d of gridReads) {
      const rec = (r: unknown) => bindings.find(b => b.st === partOf(r))?.rec
      flat.gridDeps.push({
        ...d,
        frame: d.frame === undefined ? null : (rec(d.frame) ?? null),
        reads: d.reads.map(rec).filter((r): r is Footprint => !!r),
        unplaced: d.reads.filter(r => !rec(r)).map(r => partOf(r)?.label ?? String(r)),
      })
    }
  } finally {
    endCompile(scope)
  }
  if (boundary && !halted) throw new CompileError('The failing expression has no placement boundary', boundary)
  if (!boundary) unplacedRoutes(flat, srcOf(node), bindings, placedRoutes, opts.files)
  for (const b of bindings) {
    for (let i = b.st.owner; i; i = i.parent ?? undefined) {
      const lay = layoutAt.get(i)
      if (!lay) continue
      const own = new Set<InstanceState>()
      for (let j: InstanceState | null = b.st.owner!; j; j = j.parent) own.add(j)
      if (b.layouts.some(l => own.has(l.inst))) break
      const local = [...instancePath(b.st.owner!), b.st.key ?? '?'].join('/')
      throw new CompileError(
        `${b.st.label}, ${local}, is placed at ${loc(b.site)} outside a layout, while ${lay.name} lays out ${instancePath(i).join('/')} at ${loc(lay.src)}`,
        b.site,
      )
    }
  }
  schematicPass(flat, { bindings, snapshot: scope.parts, instances: scope.instances, netObjs, layoutAt, groupAt, refStyle, library: opts.library, incomplete: !!boundary })
  netRulesPass(flat, netObjs)
  classPass(flat, (q, name) => layer(node, q, false) ?? name)
  for (const [f, set] of missingOutline) console.warn(`pcbjs: ${flat.name}: no glyph for ${[...set].map(c => JSON.stringify(c)).join(', ')} in ${f}, drawn as its .notdef glyph`)
  for (const [f, set] of missingGlyphs)
    console.warn(`pcbjs: ${flat.name}: no glyph for ${[...set].map(c => JSON.stringify(c)).join(', ')} in ${f === 'hershey' ? 'hershey-simplex' : f}, drawn as a box`)
  flat.patches.push(...patchList(opts.patches, 'the .patches.ts file'))
  if (opts.library) scopeLibrary(flat, opts.library, localObjects)
  return flat
}

/** The member keys from an instance down to one of its parts, `['LDO1', 'C1']`; null when the part is not under it. */
export function memberPath(inst: InstanceState, st: PartState): string[] | null {
  const out: string[] = []
  let key = st.key
  for (let i: InstanceState | null | undefined = st.owner; i; i = i.parent) {
    if (key === undefined) return null
    out.unshift(key)
    if (i === inst) return out
    const parent = i.parent
    key = parent ? [...parent.members].find(([, m]) => m === i)?.[0] : undefined
  }
  return null
}

/** The index of the innermost layout around a part that lays out its instance, where an own placement of the part would go; -1 for none. */
function ownLayout(layouts: ActiveLayout[], st: PartState): number {
  for (let i = layouts.length - 1; i >= 0; i--) if (memberPath(layouts[i].inst, st)) return i
  return -1
}
/** The definition of the innermost of these levels, whose source writes what it holds. */
const defOf = (levels: Level[]): { def?: string } => (levels.length ? { def: levels[levels.length - 1].key } : {})
const withinOf = (levels: Level[]): string[] => levels.map(l => l.path)
/** A named group's key, its `<g>` as `${file}#${line}:${col}`, as its circuit record's `def`. */
export const groupKey = (path: string, src: Src | undefined): string => (src ? `${src.file}#${src.line}:${src.col}` : path)

const describeOwn = (n: PcbNode): string => `<${(typeof n.type === 'function' && partOf(n.type)?.label) || 'element'}>`

/** A named point's name: letters, digits, _ and -, as a ref. */
function mateName(v: unknown, fail: (msg: string) => never): string {
  if (typeof v !== 'string' || !/^[A-Za-z_][\w-]*$/.test(v)) fail(`name must be a name such as "hdr", got ${JSON.stringify(v)}`)
  return v as string
}

/** The auto slots of a placement and its at:* props checked, with the pose to draw it at until it is placed; null for a fixed placement. */
function autoPlacement(
  at: unknown,
  o: { initial: unknown; cost: unknown; solver: unknown; follow: unknown },
  fail: (msg: string) => never,
): Omit<PlaceJob, 'fp' | 'm' | 'flip' | 'src'> | null {
  let fixed: PlaceJob['fixed'] | null = null
  try {
    fixed = autoAt(at === undefined && o.follow !== undefined ? 'auto' : (at as string | undefined))
  } catch (e) {
    fail((e as Error).message)
  }
  const given = AUTO_PROPS.filter(k => o[k.slice(3) as keyof typeof o] !== undefined)
  if (!fixed) {
    if (given.length) fail(`${given.join(', ')} ${given.length > 1 ? 'need' : 'needs'} a slot of at left auto, such as at="auto" or at="10 auto 90"`)
    return null
  }
  for (const k of ['cost', 'solver'] as const) if (o[k] !== undefined && typeof o[k] !== 'function') fail(`at:${k} takes a function, got ${typeof o[k]}`)
  if (o.follow !== undefined) {
    const f = o.follow as Record<string, unknown>
    if (!f || typeof f !== 'object' || f.route === undefined) fail('at:follow takes { route, near?, side?, distance? }')
    const bad = Object.keys(f).find(k => !['route', 'near', 'side', 'distance'].includes(k))
    if (bad) fail(`at:follow takes route, near, side and distance, not ${bad}`)
    if (f.side !== undefined && f.side !== 'left' && f.side !== 'right') fail(`at:follow side is 'left' or 'right' of the route seen from its start, got ${JSON.stringify(f.side)}`)
    if (fixed[0] !== null || fixed[1] !== null) fail('at:follow places x and y beside the route; leave them auto, at="auto" or at="auto auto 90"')
    if (o.cost !== undefined || o.solver !== undefined) fail('at:follow places the part after routing; it takes no at:cost or at:solver')
  }
  let initial: [number, number, number] | undefined
  if (o.initial !== undefined)
    try {
      initial = parseAt(o.initial as string)
    } catch (e) {
      fail(`at:initial ${(e as Error).message}`)
    }
  const start = fixed.map((v, i) => v ?? initial?.[i] ?? 0) as [number, number, number]
  return {
    fixed,
    start,
    ...(initial ? { initial } : {}),
    ...(o.cost !== undefined ? { cost: o.cost as PlaceJob['cost'] } : {}),
    ...(o.solver !== undefined ? { solver: o.solver as PlaceJob['solver'] } : {}),
    ...(o.follow !== undefined ? { follow: { ...(o.follow as object) } as PlaceJob['follow'] } : {}),
  }
}

/** A list of patch() nodes as patches; anything else in it is a compile error. */
function patchList(v: unknown, what: string): Patch[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new CompileError(`${what} must be a list of patch() calls, got ${typeof v}`)
  return v.map((n, i) => {
    if (!isPatchNode(n)) throw new CompileError(`${what}: entry ${i + 1} is not a patch() call`)
    return patchOf(n)
  })
}

function unwrap(c: Child): PcbNode | null {
  if (Array.isArray(c)) {
    const nodes = c.filter(isNode)
    return nodes.length === 1 ? nodes[0] : null
  }
  if (!isNode(c)) return null
  if (typeof c.type === 'function') {
    const props = propsOf(c)
    if (c.children.length) props.children = c.children.length === 1 ? c.children[0] : c.children
    return unwrap(c.type(props))
  }
  return c
}

function sideFlip(side: unknown): boolean {
  if (side === undefined || side === null || side === 'F') return false
  if (side === 'B') return true
  throw new CompileError(`bad side ${JSON.stringify(side)}: side is "F" or "B"`)
}

function defaultWidth(layer: string): number {
  if (layer === 'Edge.Cuts') return 0.05
  // 0.15: the thinnest legend line JLCPCB and PCBWay print, and BASE.silkMinWidth
  if (layer.endsWith('.SilkS')) return 0.15
  if (layer.endsWith('.CrtYd')) return 0.05
  if (layer.endsWith('.Fab')) return 0.1
  return 0.1
}

interface NetObj {
  name: string
  class?: string
  local: boolean
  seq: number
  classes: Set<string>
  path?: string[]
  rules?: { clearance?: number | KindClearanceMM }
}

/** Where a part sits in declaration order: its own sequence at the board level, else its outermost instance's, then the key positions down to it. */
function orderKey(st: PartState): number[] {
  if (!st.owner) return [st.seq]
  const idx: number[] = []
  let m: PartState | InstanceState = st
  for (let o: InstanceState | null = st.owner; o; o = o.parent) {
    idx.unshift([...o.members.values()].indexOf(m))
    m = o
  }
  return [m.seq, ...idx]
}
function byOrder(a: PartState, b: PartState): number {
  const x = orderKey(a),
    y = orderKey(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
  return x.length - y.length
}

const refKey = (r: string): [string, number, string] => {
  const m = /^([A-Za-z_]*)(\d*)(.*)$/.exec(r)!
  return [m[1], m[2] ? Number(m[2]) : -1, m[3]]
}
function byRef(a: string, b: string): number {
  const x = refKey(a),
    y = refKey(b)
  return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0)
}

/** The digits of the instance indices from the outermost down, `2` for CH2, `12` for Power1/LDO2. */
const indexDigits = (i: InstanceState): string => (i.parent ? indexDigits(i.parent) : '') + i.index
/** A circuit part's ref: its local name's letters, the instance indices, its local digits, `R201` for CH2/R01. */
function instanceRef(st: PartState): string {
  const [, letters, digits] = /^(.*?)(\d*)$/.exec(st.key!)!
  return `${letters}${indexDigits(st.owner!)}${digits}`
}

/** Bound routes of the files this board was built from that it never placed: a compile error naming them. */
function unplacedRoutes(flat: Flat, root: Src | undefined, bindings: PartBinding[], placed: Set<object>, modules?: ReadonlySet<string>): void {
  const files = new Set<string>()
  const own = root?.file
  if (own) files.add(own)
  for (const b of bindings) if (b.st.declFile && !b.st.owner) files.add(b.st.declFile)
  // a module outside this compile's graph is another project's, though its file has the same name relative to its root
  const insts = new Set<InstanceState>()
  for (const b of bindings) for (let i = b.st.owner; i; i = i.parent ?? undefined) insts.add(i)
  for (const i of insts)
    for (const [k, r] of i.routes)
      if (!placed.has(r))
        throw new CompileError(
          `the route ${[...instancePath(i), k].join('.')} of the circuit ${i.circuit} is never placed on <PCB ${flat.name}>; place it in the layout, {g.${k}}`,
          (r as PcbNode).props?.__src ? rangeOf((r as PcbNode).props.__src) : root,
        )
  const left = realm().registry.routes.filter(r => r.file !== undefined && files.has(r.file) && !placed.has(r.node) && !(r.abs && modules?.size && !modules.has(r.abs)))
  if (!left.length) return
  throw new CompileError(
    `${left.map(r => `the route ${r.name}${r.src ? ` at ${loc(r.src)}` : ''}`).join(', ')} ${left.length > 1 ? 'are' : 'is'} bound but never placed on <PCB ${flat.name}>; place ${left.length > 1 ? 'them' : 'it'}, {${left[0].name}}, or remove ${left.length > 1 ? 'them' : 'it'}`,
    left[0].src,
  )
}

/** Name the placed parts, rewrite the placeholder refs, build the netlist and the ERC findings. A part is named by its binding or its `ref` option, a circuit part by its instance. */
function schematicPass(
  flat: Flat,
  s: {
    bindings: PartBinding[]
    snapshot: PartState[]
    instances: InstanceState[]
    netObjs: Map<string, NetObj>
    layoutAt: Map<InstanceState, ActiveLayout>
    groupAt: Map<string, Src | undefined>
    refStyle: 'flat' | 'hierarchical'
    library?: string
    incomplete?: boolean
  },
) {
  const nameSite = (st: PartState) => loc(st.explicitRef === undefined ? (st.boundSrc ?? st.src) : st.src)
  const hierarchical = (st: PartState) => [...instancePath(st.owner!), st.key].join('_').replace(/\W+/g, '_').replace(/_$/, '').toUpperCase()
  const named = (st: PartState): string | undefined => (st.owner ? (s.refStyle === 'hierarchical' ? hierarchical(st) : instanceRef(st)) : (st.explicitRef ?? st.boundRef))
  const placed = new Set(s.bindings.map(b => b.st))
  const files = new Set(s.bindings.flatMap(b => (!b.st.render && b.st.declFile ? [b.st.declFile] : [])))
  // those declared in those files, and those whose parts it placed or laid out
  const tops = new Set<InstanceState>()
  for (const i of s.instances) if (!i.parent && i.declFile && files.has(i.declFile)) tops.add(i)
  for (const b of s.bindings) if (b.st.owner) tops.add(topInstance(b.st.owner))
  for (const i of s.layoutAt.keys()) tops.add(topInstance(i))
  const onBoard: InstanceState[] = []
  const visit = (i: InstanceState) => {
    onBoard.push(i)
    for (const m of i.members.values()) if (isInstanceState(m)) visit(m)
  }
  for (const i of [...tops].sort((a, c) => a.seq - c.seq)) visit(i)
  const paths = new Map<string, InstanceState>()
  for (const i of onBoard) {
    const k = instancePath(i).join('/')
    const other = paths.get(k)
    if (other)
      throw new CompileError(
        `two circuit instances on <PCB ${flat.name}> are named ${k}${other.src ? `, from ${loc(other.src)}` : ''}${i.src ? ` and ${loc(i.src)}` : ''}; give them distinct indices`,
        i.src,
      )
    paths.set(k, i)
  }
  // an unplaced instance under a placed parent is one error for all its parts
  const touched = (i: InstanceState) => s.layoutAt.has(i) || instanceParts(i).some(st => placed.has(st))
  const unplacedCircuits = onBoard.filter(i => !touched(i) && (!i.parent || touched(i.parent)))
  const silent = new Set(unplacedCircuits.flatMap(instanceParts))
  const candidates = new Set(s.snapshot.filter(st => st.declFile && files.has(st.declFile)))
  for (const i of onBoard) for (const st of instanceParts(i)) candidates.add(st)
  const unplaced = [...candidates].filter(st => !placed.has(st)).sort(byOrder)
  const lost = [
    ...unplacedCircuits.map(i => `the instance ${instancePath(i).join('/')} of ${i.circuit}${i.src ? ` at ${loc(i.src)}` : ''}`),
    ...unplaced.filter(st => !silent.has(st)).map(st => `${named(st) ?? st.label}${st.src ? ` at ${loc(st.src)}` : ''}`),
  ]
  if (lost.length && !s.library && !s.incomplete)
    throw new CompileError(
      `${lost.join(', ')} ${lost.length > 1 ? 'are' : 'is'} declared but never placed on <PCB ${flat.name}>; place ${lost.length > 1 ? 'them' : 'it'} or remove ${lost.length > 1 ? 'them' : 'it'}`,
      unplacedCircuits[0]?.src ?? unplaced[0]?.src,
    )

  const refs = new Map<PartState, string>()
  const owners = new Map<string, PartState>()
  for (const b of s.bindings) {
    const r = named(b.st)
    if (r === undefined) continue
    const other = owners.get(r)
    if (other)
      throw new CompileError(`two parts are named ${r}: ${other.label} at ${nameSite(other)} and ${b.st.label} at ${nameSite(b.st)}; rename one`, b.st.boundSrc ?? b.st.src)
    owners.set(r, b.st)
    refs.set(b.st, r)
  }
  if (s.library)
    for (const st of unplaced) {
      const ref = named(st)
      if (ref) refs.set(st, ref)
    }
  const nameless = s.bindings.find(b => !refs.has(b.st))
  if (nameless) {
    const st = nameless.st
    let k = 1
    while (owners.has(`${st.prefix}${k}`)) k++
    const name = `${st.prefix}${k}`
    throw new CompileError(
      `${st.label} has no name: bind it to a constant, const ${name} = ${st.label}…, or give a part made in a loop its ref, { ref: '${name}' }${st.src ? ` (${loc(st.src)})` : ''}`,
      st.src ?? nameless.site,
    )
  }

  const byId = new Map(s.bindings.map(b => [b.id, refs.get(b.st)!]))
  const fix = (r: string | undefined) => (r !== undefined && r.startsWith(PLACEHOLDER) ? (byId.get(r) ?? r) : r)
  for (const f of flat.footprints) f.ref = fix(f.ref)!
  for (const it of flat.items) if (it.ref !== undefined) it.ref = fix(it.ref)
  for (const j of flat.autoRoutes) if (j.ref !== undefined) j.ref = fix(j.ref)
  for (const k of flat.keepouts) if (k.ref !== undefined) k.ref = fix(k.ref)
  for (const b of s.bindings) flat.partRefs.set(b.st, refs.get(b.st)!)
  padEnds(flat, s.bindings)

  const erc: DrcMarker[] = []
  const netOf = (st: PartState, pin: string) => {
    const c = st.conn.get(pin)
    return { net: c === undefined || isNC(c) ? null : netInfo(c)!.name, nc: !!c && isNC(c) }
  }
  const parts: BoardSchematicPart[] = []
  const exported = (st: PartState) => {
    const e = flat.exports?.parts.get(st)
    return e ? { export: e } : {}
  }
  const groupsOf = new Map(s.bindings.map(b => [b.st, b.groups]))
  const hier = (st: PartState, ref: string) => (st.owner ? { path: instancePath(st.owner), local: st.key ?? ref } : { path: groupsOf.get(st) ?? [], local: ref })
  const pinsOfNet = new Map<string, string[]>()
  const addPin = (net: string | undefined, label: string) => {
    if (net === undefined) return
    const l = pinsOfNet.get(net) ?? []
    if (!l.includes(label)) l.push(label)
    pinsOfNet.set(net, l)
  }
  for (const b of s.bindings) {
    const ref = refs.get(b.st)!,
      rec = b.rec!
    b.pads!.forEach((pad, i) => {
      const pin = b.padPins![i]
      if (pin !== null) addPin(pad.net, `${ref}.${pin}`)
    })
    parts.push({
      ref,
      value: rec.value,
      footprint: rec.id,
      prefix: b.st.prefix,
      pins: b.st.pins.map(pin => ({ name: pin, ...netOf(b.st, pin) })),
      placed: true,
      ...((b.st.src ?? rec.src) ? { src: b.st.src ?? rec.src } : {}),
      ...hier(b.st, ref),
      ...exported(b.st),
    })
    // a part never connected is copper on no net, such as a mounting hole's ring
    for (const pin of b.st.conn.size ? b.st.pins : []) {
      if (b.st.conn.has(pin)) continue
      const pad = b.pads!.find((_, i) => b.padPins![i] === pin)
      erc.push(
        marker({
          severity: 'warning',
          rule: 'unconnected-pin',
          args: { pin: `${ref}/${pin}`, label: b.st.label },
          refs: [`${ref}/${pad?.num || pin}`],
          at: pad ? pad.at : [0, 0],
          ...(pad ? { items: [pad.id] } : {}),
        }),
      )
    }
  }
  if (s.library)
    for (const st of unplaced) {
      const path = st.owner ? instancePath(st.owner).join('/') : ''
      if (path !== s.library && !path.startsWith(s.library + '/')) continue
      const ref = refs.get(st)
      if (!ref) continue
      flat.partRefs.set(st, ref)
      const pins = st.pins.map(pin => ({ name: pin, ...netOf(st, pin) }))
      for (const pin of pins)
        if (pin.net) {
          addPin(pin.net, `${ref}.${pin.name}`)
          const info = netInfo(st.conn.get(pin.name)!)!
          if (!s.netObjs.has(info.name)) s.netObjs.set(info.name, { ...info, classes: new Set(info.class ? [info.class] : []) })
        }
      parts.push({
        ref,
        value: st.value ?? '',
        footprint: st.footprintId,
        prefix: st.prefix,
        pins,
        placed: false,
        ...hier(st, ref),
        ...exported(st),
        ...(st.src ? { src: st.src } : {}),
      })
    }
  parts.sort((a, c) => byRef(a.ref, c.ref))

  const declared = [...s.netObjs.values()].sort((a, c) => a.seq - c.seq)
  const names = [...declared.map(d => d.name), ...[...flat.netNames].filter(n => !s.netObjs.has(n)).sort()]
  const nets = names.map(name => {
    const d = s.netObjs.get(name)
    const e = flat.exports?.nets.get(name)
    return { name, ...(d?.class ? { class: d.class } : {}), local: !!d?.local, pins: pinsOfNet.get(name) ?? [], ...(d?.path ? { path: d.path } : {}), ...(e ? { export: e } : {}) }
  })
  const padAt = (label: string | undefined): [number, number] => {
    if (!label) return [0, 0]
    const dot = label.lastIndexOf('.'),
      ref = label.slice(0, dot),
      pin = label.slice(dot + 1)
    const f = flat.footprints.find(x => x.ref === ref)
    const b = s.bindings.find(x => x.rec === f)
    const pad = b?.pads!.find((_, i) => b.padPins![i] === pin)
    return pad ? pad.at : [0, 0]
  }
  for (const d of declared) {
    const pins = pinsOfNet.get(d.name) ?? []
    if (pins.length < 2)
      erc.push(
        marker({
          severity: 'warning',
          rule: 'single-pin-net',
          args: { net: d.name, ...(pins.length ? { pin: pins[0] } : {}) },
          refs: [`net:${d.name}`, ...pins.map(l => `${l.slice(0, l.lastIndexOf('.'))}/${l.slice(l.lastIndexOf('.') + 1)}`)],
          at: padAt(pins[0]),
        }),
      )
    if (d.classes.size > 1)
      erc.push(marker({ severity: 'warning', rule: 'net-class', args: { net: d.name, classes: [...d.classes] }, refs: [`net:${d.name}`], at: padAt(pins[0]) }))
  }
  const circuits: BoardSchematicCircuit[] = onBoard.map(i => {
    const own: string[] = [],
      children: string[] = []
    for (const m of i.members.values())
      if (isInstanceState(m)) children.push(m.name)
      else {
        const r = refs.get(m)
        if (r !== undefined) own.push(r)
      }
    const lay = s.layoutAt.get(i)
    return {
      path: instancePath(i),
      name: i.name,
      ...(i.binding ? { binding: i.binding } : {}),
      kind: 'circuit' as const,
      def: circuitKey(i.def),
      circuit: i.circuit,
      ...(lay ? { layout: lay.key } : {}),
      ...(i.parent ? { parent: instancePath(i.parent).join('/') } : {}),
      parts: own,
      children,
      placed: instanceParts(i).every(st => placed.has(st)),
    }
  })
  for (const [g, src] of s.groupAt) {
    const path = g.split('/')
    const under = (q: string[]) => q.length === path.length + 1 && path.every((x, i) => x === q[i])
    circuits.push({
      path,
      name: path.at(-1)!,
      kind: 'group',
      def: groupKey(g, src),
      ...(path.length > 1 ? { parent: path.slice(0, -1).join('/') } : {}),
      parts: s.bindings.filter(b => !b.st.owner && b.groups.join('/') === g).map(b => refs.get(b.st)!),
      children: [...s.groupAt.keys()]
        .map(k => k.split('/'))
        .filter(under)
        .map(q => q.at(-1)!),
      placed: true,
    })
  }
  flat.schematic = { parts, nets, circuits }
  flat.erc = erc.sort((a, c) => (a.severity === c.severity ? 0 : a.severity === 'error' ? -1 : 1))
}

/** `net.rules({ clearance })`: each such net gets an anonymous class `net:<name>`, its class's fields with the rules on top. */
function netRulesPass(flat: Flat, netObjs: Map<string, NetObj>): void {
  const ruled = [...netObjs.values()].filter(d => d.rules && Object.keys(d.rules).length)
  if (!ruled.length) return
  const table = { ...flat.classes }
  for (const d of ruled) {
    const n = flat.schematic.nets.find(x => x.name === d.name)
    if (!n) continue
    const base = n.class !== undefined ? table[n.class] : undefined
    const name = `net:${d.name}`
    const c = d.rules!.clearance,
      { clearance: _c, clearanceTo: _t, ...rest } = base ?? { ...CLASS_DEFAULTS }
    // objects by kind merge; otherwise the net's clearance replaces its class's
    const kinds = typeof c === 'object' ? (base?.clearanceTo ? { ...base.clearanceTo, ...c } : { ...c }) : undefined
    table[name] =
      c === undefined ? { ...(base ?? { ...CLASS_DEFAULTS }) } : { ...rest, ...(kinds ? { clearanceTo: kinds as ResolvedNetClass['clearanceTo'] } : { clearance: c as number }) }
    n.class = name
  }
  flat.classes = table
}

/** Apply net classes, `.impedance()` and pair settings to the routes once the netlist is known, all under the route's own fields. */
function classPass(flat: Flat, lay: (q: unknown, name: string) => string): void {
  const table = flat.classes
  const hasTable = Object.keys(table).length > 0
  if (!hasTable && !flat.autoRoutes.some(j => j.pair || j.impedance !== undefined)) return
  const netClass = new Map<string, string>()
  for (const n of flat.schematic.nets) if (n.class) netClass.set(n.name, n.class)
  const padsOf = new Map<string, Pad[]>()
  for (const it of flat.items)
    if (it.kind === 'pad' && it.ref !== undefined) {
      const l = padsOf.get(it.ref) ?? []
      l.push(it)
      padsOf.set(it.ref, l)
    }
  const refOf = new Map<PartState, string>(flat.partRefs)
  const padAt = (q: unknown): Pad | undefined => {
    if (isPinRef(q)) {
      const st = partOf(q.part),
        ref = st && refOf.get(st)
      if (!st || !ref) return undefined
      const pads = padsOf.get(ref) ?? []
      return q.pad !== undefined ? (pads.find(p => p.num === q.pad) ?? pads.find(p => p.name === q.pad)) : pads.find(p => pinOfPad(st.pins, p) === q.pin)
    }
    if (typeof q === 'string') {
      let c: ReturnType<typeof coordString> = null
      try {
        c = coordString(q)
      } catch {
        return undefined
      }
      if (c) return undefined
      const dot = q.indexOf('.'),
        pads = padsOf.get(q.slice(0, dot)) ?? [],
        k = q.slice(dot + 1)
      return pads.find(p => p.num === k) ?? pads.find(p => p.name === k)
    }
    return undefined
  }
  const r2 = (v: number) => Math.round(v * 100) / 100
  const padName = (p: Pad | undefined, q: unknown) => (p ? `${p.ref}/${p.num}` : JSON.stringify(isPinRef(q) ? q.pin : q))
  const solved = new Map<AutoRouteJob, { z: number; layer: string; pad?: Pad }>()
  for (const job of flat.autoRoutes) {
    const pa = job.from !== undefined ? padAt(job.from) : undefined
    const fail = (msg: string): never => {
      throw new CompileError(`${msg}${job.src ? ` (${loc(job.src)})` : ''}`, job.src)
    }
    let net = job.net ?? (job.infer ? (pa?.net ?? (job.to !== undefined ? padAt(job.to)?.net : undefined)) : undefined)
    if (job.pair) {
      const pb = padAt(job.to),
        na = padAt(job.pair.fromN),
        nb = padAt(job.pair.toN)
      const side = (x: Pad | undefined, qx: unknown, y: Pad | undefined, qy: unknown, which: string): string | undefined => {
        if (x?.net && y?.net && x.net !== y.net)
          fail(`pair route: ${which} endpoints must be on the same net
  ${padName(x, qx)}: ${x.net}
  ${padName(y, qy)}: ${y.net}
Check the connector pin mapping and the [P, N] order at both ends of the pair.`)
        return x?.net ?? y?.net
      }
      // with pads they must agree
      const given = job.pair.net
      const pNet = side(pa, job.from, pb, job.to, 'P') ?? job.net,
        nNet = side(na, job.pair.fromN, nb, job.pair.toN, 'N') ?? given
      if (given !== undefined && nNet !== given) fail(`pair route is given the N net ${given}, but its N ends are on ${nNet}`)
      const all = `${padName(pa, job.from)}, ${padName(na, job.pair.fromN)}, ${padName(pb, job.to)} and ${padName(nb, job.pair.toN)}`
      if (pNet === undefined || nNet === undefined)
        fail(`pair route: neither ${pNet === undefined ? 'P' : 'N'} end is a pad on a net; the ends are ${all}; give both nets with .net(P, N)`)
      if (pNet === nNet) fail(`pair route: the P and N ends ${all} are all on net ${pNet}; a pair joins two nets, P first in each array`)
      if (job.net !== undefined && job.net !== pNet) fail(`pair route is given the net ${job.net}, but its P ends are on ${pNet}`)
      job.net = net = pNet
      job.pair.net = nNet
    }
    const name = net !== undefined ? netClass.get(net) : undefined
    const c = name !== undefined ? table[name] : undefined
    // the router's start layer: the route's layer, else the pad's copper layer, F.Cu first
    const startLayer = () => {
      const def = job.layer ?? 'F.Cu',
        cu = pa ? pa.layers.filter(l => l.endsWith('.Cu')) : []
      return cu.length && !cu.includes(def) ? cu[0] : def
    }
    if (job.pair) {
      const start = startLayer()
      // without a width of its own, a class gap is held as well
      let w = job.width,
        g = job.pair.gap ?? (job.width === undefined ? c?.gap : undefined)
      const solve = (z: number, what: string) => {
        if (w !== undefined && g !== undefined) return
        let geo = { width: 0, gap: 0 }
        try {
          geo = pairGeometry(flat.stackup, start, z, { ...(w !== undefined ? { width: w } : {}), ...(g !== undefined ? { gap: g } : {}) })
        } catch (e) {
          fail(`${what}, ${z} ohms differential on ${start}: ${(e as Error).message}`)
        }
        if (w === undefined) solved.set(job, { z, layer: start, pad: pa })
        w ??= r2(geo.width)
        g ??= r2(geo.gap)
      }
      if (job.impedance !== undefined) solve(job.impedance, 'pair route impedance')
      else {
        w ??= c?.width
        g ??= c?.gap
        if (c?.impedance !== undefined) solve(c.impedance, `net class ${name}`)
      }
      w ??= flat.rules.minTrackWidth
      g ??= w
      job.width = w
      job.pair.gap = g
      job.pair.skew ??= c?.skew ?? CLASS_DEFAULTS.skew
      job.pair.uncoupled = c?.uncoupled ?? CLASS_DEFAULTS.uncoupled
    } else if (job.width === undefined && job.impedance !== undefined) {
      const start = startLayer()
      try {
        job.width = r2(traceWidth(flat.stackup, start, job.impedance))
      } catch (e) {
        fail(`route impedance, ${job.impedance} ohms on ${start}: ${(e as Error).message}`)
      }
      solved.set(job, { z: job.impedance, layer: start, pad: pa })
    }
    if (!c) continue
    if (c.neck) job.neck = { ...c.neck, ...(job.neck ?? {}) }
    if (c.corner !== undefined) job.corner ??= c.corner
    const resolve = (l: string) => {
      try {
        return lay(l, l)
      } catch (e) {
        return fail(`net class ${name}: ${(e as Error).message}`)
      }
    }
    if (job.width === undefined) {
      if (c.width !== undefined) job.width = c.width
      else if (c.impedance !== undefined) {
        const start = startLayer()
        try {
          job.width = r2(traceWidth(flat.stackup, start, c.impedance))
        } catch (e) {
          fail(`net class ${name}, ${c.impedance} ohms on ${start}: ${(e as Error).message}`)
        }
        solved.set(job, { z: c.impedance, layer: start, pad: pa })
      }
    }
    const params: JobParams = {}
    const a = c.autoroute
    if (a) {
      for (const [k, v] of Object.entries(a)) if (v !== undefined && k !== 'via' && k !== 'avoid' && k !== 'layers' && k !== 'prefer') (params as any)[k] = v
      if (a.layers) params.layers = a.layers.map(resolve)
      if (a.prefer) params.prefer = Object.fromEntries(Object.entries(a.prefer).map(([k, v]) => [resolve(k), v]))
      if (a.via) params.via = { ...(a.via.drill !== undefined ? { drill: mm(a.via.drill) } : {}), ...(a.via.size !== undefined ? { size: mm(a.via.size) } : {}) }
      if (a.avoid)
        params.avoid = a.avoid.map((q): JobAvoid =>
          q && typeof q === 'object' && !Array.isArray(q) && !isPinRef(q) && 'w' in q
            ? (() => {
                const x = mm(q.x),
                  y = mm(q.y),
                  w = mm(q.w),
                  h = mm(q.h)
                return {
                  ring: [
                    [x, y],
                    [x + w, y],
                    [x + w, y + h],
                    [x, y + h],
                  ] as Pt[],
                  ...(q.layer !== undefined ? { layer: resolve(q.layer) } : {}),
                }
              })()
            : { pos: q as RouteEnd },
        )
    }
    if (c.layers) params.layers = c.layers.map(resolve)
    if (c.via) params.via = { ...(params.via ?? {}), ...c.via }
    if (Object.keys(params).length) job.params = mergeAutoroute(params, job.params)
  }
  impedanceWidth(flat, solved)
  if (!hasTable) return
  const anchor = (net: string): Pt => {
    for (const it of flat.items) if (it.kind === 'pad' && it.net === net) return it.at
    return [0, 0]
  }
  const unknown: DrcMarker[] = []
  for (const n of flat.schematic.nets)
    if (n.class && !table[n.class])
      unknown.push(
        marker({ severity: 'warning', rule: 'net-class', args: { net: n.name, undefined: n.class, classes: Object.keys(table) }, refs: [`net:${n.name}`], at: anchor(n.name) }),
      )
  if (unknown.length) flat.erc = [...flat.erc, ...unknown].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1))
}

/** ERC `impedance-width`: a solved width over twice the smaller side of the start pad, reported instead of the router's `no path found`. */
function impedanceWidth(flat: Flat, solved: Map<AutoRouteJob, { z: number; layer: string; pad?: Pad }>): void {
  const out: DrcMarker[] = []
  for (const [job, s] of solved) {
    const p = s.pad,
      w = job.width
    if (!p || w === undefined) continue
    const side = Math.min(p.size[0], p.size[1])
    if (!(w > 2 * side + 1e-9)) continue
    const what = job.pair ? `the pair of nets ${job.net} and ${job.pair.net}, ${s.z} ohms differential,` : `the route of net ${job.net ?? p.net ?? '?'}, ${s.z} ohms,`
    out.push(
      marker({
        severity: 'warning',
        rule: 'impedance-width',
        args: { what, width: w, ...(job.pair ? { gap: job.pair.gap ?? 0 } : {}), side, pad: `${p.ref}/${p.num}` },
        measured: { value: w, unit: 'mm' },
        required: { value: 2 * side, unit: 'mm' },
        at: p.at,
        layer: s.layer,
        items: [p.id],
        ...(job.src ? { src: job.src } : {}),
      }),
    )
  }
  if (out.length) flat.erc = [...flat.erc, ...out].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1))
}

/** The net tie groups of a footprint checked against its pads: lists of two or more pad numbers it has, each pad in one group. */
function netTieGroups(tie: unknown, pads: Pad[]): string[][] {
  if (!Array.isArray(tie)) throw new Error(`must be a list of pad number groups such as [['1', '2'], ['3', '4']], got ${JSON.stringify(tie)}`)
  const nums = new Set(pads.map(p => p.num)),
    seen = new Set<string>()
  return tie.map(g => {
    if (!Array.isArray(g) || g.length < 2) throw new Error(`groups need two or more pad numbers, got ${JSON.stringify(g)}`)
    return g.map(v => {
      const k = String(v)
      if (!nums.has(k)) throw new Error(`names pad ${JSON.stringify(k)}, which the footprint does not have`)
      if (seen.has(k)) throw new Error(`lists pad ${JSON.stringify(k)} twice`)
      seen.add(k)
      return k
    })
  })
}

/** Keep routing and placement inside a reusable layout, with source frames still in board coordinates. */
function scopeLibrary(flat: Flat, ref: string, local: WeakSet<object>): void {
  const inside = (path: string) => path === ref || path.startsWith(ref + '/')
  const parts = new Set(flat.schematic.parts.filter(p => inside(p.path.join('/'))).map(p => p.ref))
  const kept = flat.items.filter(it => (local.has(it) || parts.has(it.ref ?? '')) && it.layer !== 'Edge.Cuts')
  const ids = new Map(kept.map((it, i) => [it.id, i + 1]))
  for (const it of kept) it.id = ids.get(it.id)!
  flat.items = kept
  flat.footprints = flat.footprints.filter(f => parts.has(f.ref))
  const members = flat.schematic.parts.filter(p => parts.has(p.ref))
  const localName = (p: (typeof members)[number]) => [...p.path, p.local ?? p.ref].join('/').slice(ref.length + 1)
  const counts = new Map<string, number>()
  const labels = new Map<string, string>()
  for (const p of [...members].sort((a, b) => localName(a).localeCompare(localName(b), 'en', { numeric: true }))) {
    const index = counts.get(p.prefix) ?? 0
    labels.set(p.ref, `${p.prefix}${index}`)
    counts.set(p.prefix, index + 1)
  }
  flat.schematic.parts = flat.schematic.parts.map(p => (labels.has(p.ref) ? { ...p, displayRef: labels.get(p.ref)! } : p))
  for (const fp of flat.footprints) {
    fp.displayRef = labels.get(fp.ref)
    const src = flat.placements.find(p => p.fp === fp)?.src
    if (src) fp.src = src
  }
  for (const fp of flat.footprints) fp.pads = fp.pads.flatMap(id => (ids.has(id) ? [ids.get(id)!] : []))
  const endpoint = (p: RouteEnd | undefined) => {
    if (!isPinRef(p)) return true
    const st = partOf(p.part)
    return !!st && parts.has(flat.partRefs.get(st) ?? '')
  }
  flat.autoRoutes = flat.autoRoutes.filter(
    r => !!r.route && flat.routeScopes[r.route]?.within.some(inside) && endpoint(r.from) && endpoint(r.to) && endpoint(r.root) && endpoint(r.pair?.fromN) && endpoint(r.pair?.toN),
  )
  const routes = new Set(flat.autoRoutes.flatMap(r => (r.route ? [r.route] : [])))
  flat.routeScopes = Object.fromEntries(Object.entries(flat.routeScopes).filter(([id]) => routes.has(id)))
  flat.placeJobs = flat.placeJobs.filter(j => parts.has(j.fp.ref))
  flat.placements = flat.placements.filter(p => p.within.some(inside) || (!!p.fp && parts.has(p.fp.ref)) || (!!p.group && inside(p.group)) || (!!p.inst && inside(p.inst)))
  flat.keepouts = flat.keepouts.filter(k => local.has(k) || parts.has(k.ref ?? ''))
  flat.stitches = flat.stitches.filter(k => local.has(k))
  flat.mates = flat.mates.filter(k => local.has(k) || ('fp' in k && parts.has(k.fp.ref)))
  flat.references = []
  flat.patches = []
  flat.sch = undefined
  flat.erc = []
  flat.partRefs = new Map([...flat.partRefs].filter(([, name]) => parts.has(name)))
  flat.schematic = {
    ...flat.schematic,
    parts: flat.schematic.parts.filter(p => parts.has(p.ref)),
    nets: flat.schematic.nets
      .map(n => ({
        ...n,
        ...(n.path && inside(n.path.join('/')) ? { displayName: n.name.slice(ref.length + 1) } : {}),
        pins: n.pins.filter(p => [...parts].some(ref => p.startsWith(ref + '.'))),
      }))
      .filter(n => n.pins.length),
    circuits: flat.schematic.circuits.filter(c => inside(c.path.join('/'))).map(c => ({ ...c, parts: c.parts.filter(p => parts.has(p)) })),
  }
  flat.netNames = new Set(flat.schematic.nets.map(n => n.name))
  const grids = new Set(flat.placements.flatMap(p => [p.grid, p.rotationGrid].filter((g): g is string => !!g)))
  flat.grids = flat.grids.filter(g => grids.has(g.name))
  flat.gridDeps = flat.gridDeps.filter(g => grids.has(g.name)).map(g => ({ ...g, reads: g.reads.filter(fp => parts.has(fp.ref)) }))
}
