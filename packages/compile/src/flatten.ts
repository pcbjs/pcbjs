import type { AutoRoute, AutoRouteParams, Child, IslandMode, PcbNode, PinRef, Pos, ResolvedRules as Rules, Src, Stackup, ThermalConnection } from '@pcbjs/core/types'
import { defaultVia, withMaskColor } from '@pcbjs/core/rules'
import { defaultLayer, type ResolvedBoardSpec } from '@pcbjs/core/defaults'
import { checkTeardrops, type TeardropLevel } from '@pcbjs/core/teardrop'
import { checkAutoroute, checkIslands, mergeAutoroute, resolveBoardSpec } from '@pcbjs/core/board-spec'
import { recolor, type VariantSpec } from '@pcbjs/core/variants'
import { childList, isNode } from '@pcbjs/core/jsx-runtime'
import { schematicDrawing, type SchematicModule } from '@pcbjs/core/sch-elements'
import { at as parseAt, coordString, mm, size2 } from '@pcbjs/core/units'
import { type AutoRouteJob, type Keepout, type JobAvoid, type JobParams, type Board, type BoardSchematic, type BoardSchematicCircuit, type BoardSchematicPart, type SchematicExport, type DrcMarker, type Footprint, type Graphic, type Item, type KindClearanceMM, type LayerDef, type Pad, type Prim, type Pt, type Ring, type RouteStep, type Text, type Track, type Via, type Zone } from '@pcbjs/core/model'
import { beginCompile, endCompile, SchematicError, instanceParts, instancePath, isInstanceState, isNC, isNet, isPinRef, markNcPad, netInfo, partOf, pinsOfPads, renderComponent, isSchematicError, sourcingOf, topInstance, type InstanceState, type PartState } from '@pcbjs/core/schematic'
import { absFile, footprintModel, isStepSpec, nodeApi } from './models.js'
import { LAYOUT_PROP, type LayoutMark } from '@pcbjs/core/circuit'
import { apply, applyRing, bbox, IDENTITY, intersection, isMirrored, mul, offset, placement, polysToRings, rotationOf, type Mat } from './geom.js'
import { applyPrims, circlePrims, circleRing, hasArc, padRing, parsePath, pathCommands, roundedRect, roundedRectPrims } from './path.js'
import { copperLayers, layerTable, resolveLayer } from './layers.js'
import { strokeFontName, strokeText } from '@pcbjs/core/text'
import { configFonts, loadOutlineFont, offsetPolys, outlineText, thinInk, type OutlineFont } from '@pcbjs/core/outline'
import type { FontSpec } from '@pcbjs/core/types'
import { parseRoutePath } from './route-path.js'
import type { ResolvedNetClass } from './netclass.js'
import { pairGeometry, traceWidth } from '@pcbjs/core/impedance'
import { CLASS_DEFAULTS, checkCorner, checkNeck } from './netclass.js'
import { mergeRuleSets, pinOfPad, PART_RULE_KEYS, ruleOverrides, type PartRuleKey, type RuleSet } from '@pcbjs/core/schematic'

const nm = (v: number) => Math.round(v * 1e6) / 1e6 || 0

/** A pad's paste openings in board mm on `pad.pasteRings`, when they differ from its copper less pasteShrink: custom windows, KiCad's paste margin and ratio, or a window grid. */
function padPaste(pad: Pad, p: Record<string, any>, ring: Ring, w: number, h: number, m: Mat, rules: Rules): void {
  if (p.pasteRatio !== undefined) {
    if (typeof p.pasteRatio !== 'number' || !Number.isFinite(p.pasteRatio) || p.pasteRatio <= -0.5) throw new Error(`pasteRatio must be a number above -0.5, a fraction of the pad size per side, got ${JSON.stringify(p.pasteRatio)}`)
    pad.pasteRatio = p.pasteRatio
  }
  const v = p.paste
  if (v === false || !pad.paste) return
  if (Array.isArray(v)) {
    if (!v.length || !v.every((r: unknown) => Array.isArray(r) && r.length >= 3 && r.every(q => Array.isArray(q) && q.length === 2 && q.every(x => typeof x === 'number' && Number.isFinite(x)))))
      throw new Error('paste must be true, false, a list of polygons of at least three [x, y] in mm in the pad frame, or { rows, cols, coverage }')
    pad.pasteRings = v.map((r: [number, number][]) => applyRing(m, r.map(q => [q[0], q[1]] as Pt)))
    return
  }
  const grid = v && typeof v === 'object' ? v as { rows: unknown; cols: unknown; coverage?: unknown } : undefined
  if (v !== undefined && v !== true && !grid) throw new Error(`paste must be true, false, polygons or { rows, cols, coverage }, got ${JSON.stringify(v)}`)
  if (grid) {
    const bad = Object.keys(grid).find(k => k !== 'rows' && k !== 'cols' && k !== 'coverage')
    if (bad || !Number.isInteger(grid.rows) || !Number.isInteger(grid.cols) || (grid.rows as number) < 1 || (grid.cols as number) < 1)
      throw new Error(`paste windows need whole rows and cols of 1 or more${bad ? `, not ${bad}` : ''}, got ${JSON.stringify(v)}`)
    if (grid.coverage !== undefined && !(typeof grid.coverage === 'number' && grid.coverage > 0 && grid.coverage <= 1)) throw new Error(`paste coverage must be above 0 and at most 1, got ${JSON.stringify(grid.coverage)}`)
  }
  const own = pad.override?.pasteShrink !== undefined
  if (!grid && !own && pad.pasteRatio === undefined) return
  const shrink = pad.pasteShrink ?? rules.pasteShrink, ratio = pad.pasteRatio ?? 0
  const mx = ratio * w - shrink, my = ratio * h - shrink
  let base: Ring[]
  if (pad.shape === 'custom') base = mx ? polysToRings(offset([ring], mx)) : [ring]
  else if (pad.shape === 'circle') base = Math.min(w, h) / 2 + mx > 0 ? [circleRing(0, 0, Math.min(w, h) / 2 + mx)] : []
  else {
    const W = w + 2 * mx, H = h + 2 * my
    if (!(W > 0 && H > 0)) base = []
    else if (pad.shape === 'roundrect') base = [roundedRect(W, H, Math.max(0, Math.min(w, h) * Math.min(Math.max(p.roundness ?? 0.25, 0), 0.5) + Math.min(mx, my)))]
    else base = [padRing(pad.shape, W, H)]
  }
  if (grid && base.length) {
    const b = bbox(base), rows = grid.rows as number, cols = grid.cols as number, s = Math.sqrt((grid.coverage as number | undefined) ?? 0.5)
    const cw = b.w / cols, ch = b.h / rows, ww = (cw * s) / 2, wh = (ch * s) / 2
    const wins: Ring[] = []
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const cx = b.x + cw * (j + 0.5), cy = b.y + ch * (i + 0.5)
      wins.push([[cx - ww, cy - wh], [cx + ww, cy - wh], [cx + ww, cy + wh], [cx - ww, cy + wh]])
    }
    base = pad.shape === 'rect' ? wins : polysToRings(intersection(wins, base))
  }
  pad.pasteRings = base.map(r => applyRing(m, r))
}

export interface Flat {
  name: string; title: string; revision: string; copper: number; thickness: number; stackup: Stackup; rules: Rules
  layers: LayerDef[]; items: Item[]; footprints: Footprint[]; netNames: Set<string>
  /** tracks to route once everything else is flattened, in document order */
  autoRoutes: AutoRouteJob[]
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
  /** reference() elements in document order, resolved once the board is flattened */
  references?: import('./reference.js').ReferenceJob[]
  /** <PCB schematic>, the picture compileSchematic draws */
  sch?: unknown
  /** the exports of a <PCB schematic> module that are parts or nets, nets by name */
  exports?: { parts: Map<PartState, SchematicExport>; nets: Map<string, SchematicExport> }
}

/** A footprint's own silk ref placement from `refAt`: false for none, else the position and rotation on the board. */
export const REF_AT = new WeakMap<Footprint, false | { at: Pt; rot: number }>()

/** Options of a compile. `files` are the modules the entry imports; out-of-line `source(factory, value, …)` calls made elsewhere are ignored. */
export interface CompileOptions {
  files?: ReadonlySet<string>
  /** the route cache: false for none, `{ dir }` for its files; in memory by default, `.pcbjs/routes` in a pcbjs project; `draft` reads the files but never writes them */
  routeCache?: false | { dir?: string; draft?: boolean }
  /** compiles the entries reference() names, each in a run of its own; the CLI passes one, see references.md */
  references?: import('./reference.js').ReferenceResolver
  /** A footprint model's box in the footprint frame, mm, z up from the board face, or null when unknown; see references.md. */
  modelBox?: import('./reference.js').ModelBoxLoader
  /** called as the router takes each leg, cached or routed, in its first pass and in every negotiation round */
  progress?: (p: import('./autoroute.js').RouteProgress) => void
}

/** The part refs of a compiled board, for resolving pin handles such as `J1[3]`. */
export const PART_REFS = new WeakMap<Board, Map<PartState, string>>()

/** A placed part while its footprint is walked: the placeholder ref it was given, its pads once walked, and the layouts around it. */
interface PartBinding { st: PartState; id: string; rec?: Footprint; pads?: Pad[]; padPins?: (string | null)[]; layouts: ActiveLayout[]; site?: Src
  /** the rule overrides of the placement, `rules={{ … }}`, in mm */
  rules?: RuleSet<PartRuleKey> }
/** A layout being walked: the instance it places, its name and where it was called. */
interface ActiveLayout { inst: InstanceState; name: string; src?: Src }
const PLACEHOLDER = '\u0000part:'

interface Ctx {
  m: Mat
  flipped: boolean
  fp: { rec: Footprint; nets: Record<string, unknown>; pads: Pad[] } | null
  /** where the design placed the outermost component around this node: a footprint's part points there, not at its <footprint> */
  site?: Src
  /** the enclosing call sites from the entry down, outermost first */
  chain: Src[]
  /** the part whose footprint is being rendered, until its <footprint> is reached */
  part?: PartBinding
  /** the circuit layouts around this node, outermost first */
  layouts: ActiveLayout[]
}

// `net:pad1` is the JSX-legal spelling of pad number 1, since `net:1` is not a valid attribute name.
const PAD_ALIAS = /^pad(\d+)$/
/** Set on a route node once it is compiled, see the fluent path in @pcbjs/core: no fluent call may follow. */
const COMPILED = Symbol.for('pcbjs.route.compiled')
/** A command of a route chain, see `chain` in @pcbjs/core. */
type ChainCommand = RouteStep | { op: 'to'; auto: boolean; target: unknown; src?: Src }
/** A route end for a message: J1.B6 for a pin or pad handle, "via" for a via node, the value as JSON otherwise. */
const LENGTH = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*[a-zA-Z]*\s*$/
const isLength = (v: unknown) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && LENGTH.test(v))
/** A coordinate tuple, one position: [x, y] or [x, y, layer] with lengths for x and y. */
export const isCoordTuple = (v: unknown): v is [unknown, unknown, unknown?] =>
  Array.isArray(v) && (v.length === 2 || (v.length === 3 && (v[2] === undefined || typeof v[2] === 'string'))) && isLength(v[0]) && isLength(v[1])
/** A pair end [P, N]: two handles or two positions, never a coordinate tuple. */
export const isPairEnd = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2 && !isCoordTuple(v)
function describeEnd(q: unknown): string {
  if (isPairEnd(q)) return `[${q.map(describeEnd).join(', ')}]`
  if (isPinRef(q)) { const st = partOf(q.part); return `${st ? st.label : 'a part'}.${q.pad ?? q.pin}` }
  if (isNode(q) && q.type === 'via') return `the via at ${JSON.stringify(q.props.at)}`
  return JSON.stringify(q) ?? String(q)
}
/** The route chain as the string grammar writes it, for the lock key of the route. */
const stepsText = (steps: readonly RouteStep[]): string => steps.map(st => {
  switch (st.op) {
    case 'L': case 'X': return `${st.rel ? st.op.toLowerCase() : st.op} ${st.x} ${st.y}`
    case 'H': return `${st.rel ? 'h' : 'H'} ${st.x}`
    case 'V': return `${st.rel ? 'v' : 'V'} ${st.y}`
    case 'U': return `@${st.layer}${st.cross ? ' cross' : ''}`
    default: return st.op
  }
}).join(' ')

/** Assign footprint nets to pads: a key matches a pad num, then a pin name, then `pad<N>` as number N. Returns the keys that matched. */
function assignNets(nets: Record<string, unknown>, pads: Pad[], net: (name: unknown) => string | undefined): Set<string> {
  const used = new Set<string>()
  const literal = new Set(pads.flatMap(p => [p.num, p.name]))
  for (const pad of pads) {
    let k = pad.num in nets ? pad.num : pad.name in nets ? pad.name : null
    if (k === null && /^\d+$/.test(pad.num) && `pad${pad.num}` in nets && !literal.has(`pad${pad.num}`)) k = `pad${pad.num}`
    if (k !== null) { pad.net = net(nets[k]); used.add(k) }
  }
  return used
}

function thermalConnection(v: unknown, what: string, at: string, src?: Src): ThermalConnection {
  if (v !== 'thermal' && v !== 'solid' && v !== 'none') throw new CompileError(`${what} must be 'thermal', 'solid' or 'none', got ${JSON.stringify(v)}${at}`, src)
  return v
}

/** A pad's `thermal`, a connection or `{ connect?, angle? }`, onto the pad. */
function padThermal(pad: Pad, v: unknown, what: string, at: string, src?: Src): void {
  if (!v || typeof v !== 'object' || Array.isArray(v)) { pad.thermal = thermalConnection(v, what, at, src); return }
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
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new CompileError(`${ref}: thermal must map pad numbers or names to 'thermal', 'solid' or 'none', such as { EP: 'solid' }${at}`, src)
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
  for (const it of flat.items) if (it.kind === 'pad' && it.ref !== undefined) { const l = padsOf.get(it.ref) ?? []; l.push(it); padsOf.set(it.ref, l) }
  const choices = (q: unknown): Pad[] | null => {
    if (!isPinRef(q)) return null
    const st = partOf(q.part), b = st && byState.get(st)
    if (!st || !b || !b.pads || !b.rec) return null
    if (q.pad === undefined) return b.pads.filter((_, i) => b.padPins![i] === q.pin)
    const hit = b.pads.filter(p => p.num === q.pad)
    const list = hit.length ? hit : b.pads.filter(p => p.name === q.pad)
    if (!list.length) throw new CompileError(`${b.rec.ref}.pad(${JSON.stringify(q.pad)}): ${st.label} has no pad numbered or named ${JSON.stringify(q.pad)}; its pads are ${[...new Set(b.pads.filter(p => p.num !== '').map(p => p.num))].join(', ')}`, st.src)
    return list
  }
  const pointsOf = (q: unknown): Pt[] => {
    const c = choices(q)
    if (c) return c.map(p => p.at)
    if (typeof q === 'string') {
      const dot = q.indexOf('.')
      const pads = padsOf.get(q.slice(0, dot)) ?? [], k = q.slice(dot + 1)
      const pad = pads.find(p => p.num === k) ?? pads.find(p => p.name === k)
      return pad ? [pad.at] : []
    }
    if (q && typeof q === 'object' && !Array.isArray(q) && 'at' in q) { try { const [x, y] = parseAt((q as any).at); return [[x, y]] } catch { return [] } }
    return []
  }
  const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
  const pick = (q: unknown, toward: Pt[]): Pos | null => {
    const c = choices(q)
    if (!c || (c.length < 2 && (q as PinRef).pad === undefined)) return null
    let best = c[0]
    if (toward.length) {
      let bd = Infinity
      for (const p of c) { const d = Math.min(...toward.map(t => d2(p.at, t))); if (d < bd) { bd = d; best = p } }
    }
    const same = (padsOf.get(best.ref!) ?? []).filter(p => p.num === best.num)
    if (same[0] === best) return `${best.ref}.${best.num}` as Pos
    if ((q as PinRef).pad !== undefined) throw new CompileError(`${best.ref}.pad(${JSON.stringify((q as PinRef).pad)}): several pads are numbered ${JSON.stringify(best.num)}; name the pad by a unique number`, partOf((q as PinRef).part)?.src)
    return null
  }
  for (const j of flat.autoRoutes) {
    if (j.from === undefined || j.to === undefined) continue
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
  constructor(message: string, public src?: Src) { super(message) }
}

/** The `__src` prop the source-range transform injects: the element or call with its full range. */
function rangeOf(v: unknown): Src | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.file !== 'string' || typeof o.line !== 'number' || typeof o.col !== 'number') return undefined
  const s: Src = { file: o.file, line: o.line, col: o.col }
  if (typeof o.endLine === 'number' && typeof o.endCol === 'number') { s.endLine = o.endLine; s.endCol = o.endCol }
  return s
}
/** The element's own position: the transform's range when present, else the start jsxDEV recorded. */
const srcOf = (n: PcbNode): Src | undefined => rangeOf(n.props?.__src) ?? n.src
const where = (n: PcbNode | undefined) => { const s = n && srcOf(n); return s ? ` (${s.file}:${s.line}:${s.col})` : '' }
const loc = (s: Src | undefined) => (s ? `${s.file}:${s.line}:${s.col}` : 'an element without a source position')
const base = (f: string) => f.split(/[\\/]/).pop() ?? f
/** The props without `__src`, so it never reaches fields, nets, pads or a component's rest spread. */
function propsOf(n: PcbNode): Record<string, any> {
  const { __src: _, ...p } = n.props ?? {}
  return p
}
/** The position just inside the quotes of the element's path literal, when it is plain text so runtime offsets are source offsets. */
function literalOf(n: PcbNode): { line: number; col: number } | undefined {
  const o = n.props?.__src
  const lit = o && typeof o === 'object' ? (o as any).lit : undefined
  if (!(o as any)?.raw || !lit || typeof lit.line !== 'number' || typeof lit.col !== 'number') return undefined
  return { line: lit.line, col: lit.col }
}
/** The source range of characters a to b, end exclusive, of a path string starting at `lit`; a newline resets the column. */
export function segmentSrc(file: string, lit: { line: number; col: number }, d: string, a: number, b: number): Src {
  let line = lit.line, col = lit.col, sl = line, sc = col
  const last = Math.max(a, b - 1)
  for (let k = 0; k <= last; k++) {
    if (k === a) { sl = line; sc = col }
    if (k === last) break
    if (d[k] === '\n') { line++; col = 1 } else col++
  }
  return { file, line: sl, col: sc, endLine: line, endCol: col, seg: d.slice(a, b) }
}
const chained = (ctx: Ctx, self: Src | undefined) => (self ? [...ctx.chain, self] : ctx.chain)

/** The <PCB> element at the root of an entry, its components called. Throws when there is none or it has no name. */
export function rootBoard(root: Child): PcbNode {
  const node = unwrap(root)
  if (!node || node.type !== 'board') throw new CompileError('the entry must default-export a <PCB> element')
  if (!propsOf(node).name) throw new CompileError('<PCB> needs a name', srcOf(node))
  return node
}

/** The variant targets a root carries, or null for a single-target board. */
export function variantsOf(node: PcbNode): VariantSpec[] | null {
  const v = node.props?.variants
  return Array.isArray(v) ? v : null
}

/** `<PCB schematic>`: a drawing, or a module namespace whose drawing export is drawn and whose part and net exports are named. */
function schematicProp(flat: Flat, sch: unknown, node: PcbNode): void {
  if (isNode(sch)) { flat.sch = sch; return }
  if (typeof sch !== 'object' || Array.isArray(sch)) throw new CompileError(`<PCB ${flat.name}>: schematic takes a <Schematic> element, schematic({ … }) or a module namespace, import * as sch, got ${typeof sch}${where(node)}`, srcOf(node))
  const ns = sch as SchematicModule
  const drawing = schematicDrawing(ns)
  if (drawing) flat.sch = drawing
  const parts = new Map<PartState, SchematicExport>(), nets = new Map<string, SchematicExport>()
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
  // base <- global defaults (defineDefaultBoard, defineDefaultRules) <- these props; see defaults.ts
  const { name: _name, children: _children, variants: _variants, color: _color, silk: _silk, finish: _finish, refStyle = 'flat', strict = false, silkRefs = true, fonts: boardFonts, schematic: sch, ...spec } = p
  if (typeof silkRefs !== 'boolean') throw new CompileError(`<PCB ${p.name}>: silkRefs must be true or false, got ${JSON.stringify(silkRefs)}${where(node)}`, srcOf(node))
  if (typeof strict !== 'boolean') throw new CompileError(`<PCB ${p.name}>: strict must be true or false, got ${JSON.stringify(strict)}${where(node)}`, srcOf(node))
  if (refStyle !== 'flat' && refStyle !== 'hierarchical') throw new CompileError(`<PCB ${p.name}>: refStyle must be "flat" or "hierarchical", got ${JSON.stringify(refStyle)}${where(node)}`, srcOf(node))
  let board: ResolvedBoardSpec
  try {
    if (!target) board = resolveBoardSpec([defaultLayer(), spec])
    else {
      const level = { ...(target.board ?? {}), ...(target.sourcing ? { sourcing: [...target.sourcing] } : {}), ...(target.rules ? { rules: { ...(target.board?.rules ?? {}), ...target.rules } } : {}) }
      const own = { ...spec, ...(spec.stackup === undefined || spec.stackup === null ? (target.stackup ? { stackup: target.stackup } : {}) : {}) }
      board = resolveBoardSpec([defaultLayer(), level, own], ['default', `target "${target.name}"`, '<PCB>'])
      board.stackup = recolor(board.stackup, target.color, target.silk, target.finish)
    }
  } catch (e) { throw new CompileError(`<PCB ${p.name}>${target ? ` target "${target.name}"` : ''}: ${(e as Error).message}${where(node)}`, srcOf(node)) }
  board.rules = withMaskColor(board.rules, board.stackup.maskColor)
  const copper = board.copper
  const layers = layerTable(copper)
  const known = new Set(layers.map(l => l.id))
  const flat: Flat = {
    name: String(p.name), title: board.title ?? String(p.name), revision: board.revision, copper,
    thickness: board.thickness, stackup: board.stackup, rules: board.rules, layers, items: [], footprints: [], netNames: new Set(), autoRoutes: [], autoroute: board.autoroute, classes: board.classes,
    erc: [], schematic: { parts: [], nets: [], circuits: [] }, partRefs: new Map(), sourcingTags: [...board.sourcing], ...(board.cpl ? { cpl: board.cpl } : {}), fabNotes: board.fabNotes, outlineFonts: {}, teardrops: board.teardrops, routeTeardrops: {},
    keepouts: [], stitches: [], strict, routeSeparately: !!target?.routeSeparately, silkRefs,
  }
  if (sch !== undefined && sch !== null) schematicProp(flat, sch, node)
  const { drill: viaDrill, size: viaSize } = defaultVia(flat.rules)
  let nextId = 1
  const add = <T extends Item>(it: Omit<T, 'id'>): T => { const full = { ...(it as any), id: nextId++ } as T; flat.items.push(full); return full }
  // for messages about nets
  let cur: PcbNode | undefined
  // for strictNets
  const netObjs = new Map<string, NetObj>()
  let stringNet: { name: string; node?: PcbNode } | undefined
  const net = (name: unknown): string | undefined => {
    if (name === undefined || name === null || name === '') return undefined
    if (isNC(name)) throw new CompileError(`NC marks an open pin in connect(), it is not a net${where(cur)}`, cur && srcOf(cur))
    const info = netInfo(name)
    if (info) {
      const seen = netObjs.get(info.name)
      if (!seen) netObjs.set(info.name, { ...info, classes: new Set(info.class ? [info.class] : []) })
      else {
        if (info.class) { seen.classes.add(info.class); seen.class ??= info.class }
        if (info.rules) seen.rules = { ...(seen.rules ?? {}), ...info.rules }
      }
      flat.netNames.add(info.name)
      return info.name
    }
    if (typeof name === 'object' || typeof name === 'function') throw new CompileError(`a net must be a Net from nets() or a name, got ${isPinRef(name) ? 'a pin handle' : typeof name}${where(cur)}`, cur && srcOf(cur))
    const s = String(name)
    stringNet ??= { name: s, node: cur }
    flat.netNames.add(s)
    return s
  }
  const placedAt = new Map<PartState, Src | undefined>()
  const bindings: PartBinding[] = []
  const layer = (n: PcbNode, name: unknown, flipped: boolean) => {
    if (typeof name !== 'string') throw new CompileError(`<${String(n.type)}> needs a layer${where(n)}`, srcOf(n))
    try { return resolveLayer(name, flipped, known) } catch (e) { throw new CompileError((e as Error).message + where(n), srcOf(n)) }
  }

  /** The autoroute job of a <track> without geometry or of route(a, b, path), in board mm; `l` and `width` are the legacy track's own. */
  const autoJob = (n: PcbNode, p: Record<string, any>, ctx: Ctx, origin: { src?: Src; chain?: Src[] }, l?: string, width?: number): AutoRouteJob => {
    const fail = (msg: string): never => { throw new CompileError(msg + where(n), srcOf(n)) }
    const lay = (q: unknown) => layer(n, q, ctx.flipped)
    // positions are in the enclosing group's frame; a "REF.PAD" string and a pin handle are absolute
    // they give the route its net when no pad does
    const viaNets: unknown[] = []
    const toBoard = (q: unknown): Pos => {
      if (isPinRef(q)) return q
      // reachable on every copper layer the via spans
      if (isNode(q) && q.type === 'via') {
        const vp = propsOf(q)
        let xy: Pt = [0, 0]
        try { const [x, y] = parseAt(vp.at); xy = [x, y] } catch (e) { fail(`route end: the via ${(e as Error).message}`) }
        const pair = ((vp.layers ?? ['F.Cu', 'B.Cu']) as unknown[]).map(lay)
        const cu = copperLayers(copper), i0 = cu.indexOf(pair[0]), i1 = cu.indexOf(pair[1])
        if (i0 < 0 || i1 < 0) fail(`route end: the via spans ${pair.join(' and ')}, which are not both copper layers of this board`)
        if (vp.net !== undefined && vp.net !== null && vp.net !== '') viaNets.push(vp.net)
        return { at: apply(ctx.m, xy), layers: cu.slice(Math.min(i0, i1), Math.max(i0, i1) + 1) } as Pos
      }
      let xy: [unknown, unknown] = [0, 0], lname: unknown
      try {
        if (typeof q === 'string') {
          const c = coordString(q)
          if (!c) return q as Pos
          xy = [c.x, c.y]; lname = c.layer
        } else if (Array.isArray(q)) { xy = [q[0], q[1]]; lname = q[2] }
        else if (q && typeof q === 'object' && 'at' in q && typeof (q as any).at !== 'function') { const [x, y] = parseAt((q as any).at); xy = [x, y]; lname = (q as any).layer }
        else fail(`<track> bad route position ${JSON.stringify(q)}`)
      } catch (e) { if (e instanceof CompileError) throw e; fail((e as Error).message) }
      let pt: [number, number] = [0, 0]
      try { pt = [mm(xy[0] as any), mm(xy[1] as any)] } catch (e) { fail((e as Error).message) }
      const [bx, by] = apply(ctx.m, pt)
      return lname === undefined || lname === null ? { at: [bx, by] } : { at: [bx, by], layer: lay(lname) }
    }
    if (p.chain !== undefined) p = chainProps(p)
    /** route(a) and its chain: the last .Z or .X target is the end, earlier ones are waypoints drawn as L or X. */
    function chainProps(p: Record<string, any>): Record<string, any> {
      const cmds = p.chain as ChainCommand[]
      if (p.path !== undefined) fail('a route takes its path as a string or as a chain, not both')
      const last = cmds[cmds.length - 1]
      const start = describeEnd(p.from)
      if (!last || last.op !== 'to') fail(`route(${start}) has no end: finish its chain with .Z(target) for a straight track or .X(target) for an automatic leg`)
      const end = (last as { target: unknown }).target
      if (!!p.pair !== isPairEnd(end)) fail(p.pair ? `route(${start}) starts a differential pair, so its end is a pair too, .X([P, N]) or .Z([P, N])` : `route(${start}) ends at a pair [P, N] but starts at a single end; a differential pair starts at a pair, route([P, N])`)
      const steps: RouteStep[] = cmds.slice(0, -1).map((c): RouteStep => {
        if (c.op !== 'to') return { ...c }
        const xy = waypoint(c.target)
        return { op: c.auto ? 'X' : 'L', x: xy[0], y: xy[1], rel: false, ...(c.src ? { src: c.src } : {}) }
      })
      steps.push({ op: (last as { auto: boolean }).auto ? 'XZ' : 'Z', ...(last.src ? { src: last.src } : {}) })
      const { chain: _, ...rest } = p
      return { ...rest, to: end, steps }
    }
    /** A waypoint in the frame of the route: a coordinate without a layer, or a via. */
    function waypoint(q: unknown): Pt {
      let v = q
      if (isNode(v) && v.type === 'via') v = { at: propsOf(v).at }
      try {
        if (typeof v === 'string') {
          const c = coordString(v)
          if (c && c.layer === undefined) return [c.x, c.y]
          if (c) fail(`route chain: the waypoint ${JSON.stringify(v)} names a layer; a waypoint is on the layer the chain is on, so write it as '${c.x} ${c.y}' and change layer with .via('${c.layer}') before it`)
        } else if (isCoordTuple(v)) {
          if (v[2] === undefined) return [mm(v[0] as any), mm(v[1] as any)]
          fail(`route chain: the waypoint ${JSON.stringify(v)} names a layer; a waypoint is on the layer the chain is on, so write it as [${v[0]}, ${v[1]}] and change layer with .via('${v[2]}') before it`)
        } else if (v && typeof v === 'object' && !Array.isArray(v) && 'at' in v && !(v as any).layer) { const [x, y] = parseAt((v as any).at); return [x, y] }
      } catch (e) { if (e instanceof CompileError) throw e; fail(`route chain: ${(e as Error).message}`) }
      return fail(`route chain: ${describeEnd(q)} is a waypoint, an .X or .Z before the last; a waypoint is a position such as '5 16' or a via, and a pin, a pad or a pair is only the end`)
    }
    const job: AutoRouteJob = { params: {}, ref: ctx.fp?.rec.ref, ...origin }
    let own: Record<string, unknown> = {}
    if (p.from !== undefined || p.to !== undefined) {
      if (p.from === undefined || p.to === undefined) fail('route(a, b) needs both ends')
      if (p.pair) {
        if (!Array.isArray(p.from) || !Array.isArray(p.to) || p.from.length !== 2 || p.to.length !== 2) fail('a differential pair route needs two ends at each side, route([aP, aN], [bP, bN])')
        job.from = toBoard(p.from[0]); job.to = toBoard(p.to[0])
        job.pair = { fromN: toBoard(p.from[1]), toN: toBoard(p.to[1]) }
        const len = (k: string, v: unknown): number => {
          let x = NaN
          try { x = mm(v as any) } catch (e) { fail(`route ${k}: ${(e as Error).message}`) }
          if (!(Number.isFinite(x) && (k === 'gap' ? x > 0 : x >= 0))) fail(`route ${k} must be a ${k === 'gap' ? 'positive' : 'non-negative'} length, got ${JSON.stringify(v)}`)
          return x
        }
        if (p.gap !== undefined) job.pair.gap = len('gap', p.gap)
        if (p.skew !== undefined) job.pair.skew = len('skew', p.skew)
      } else {
        job.from = toBoard(p.from); job.to = toBoard(p.to)
      }
      if (p.impedance !== undefined) {
        if (!(typeof p.impedance === 'number' && Number.isFinite(p.impedance) && p.impedance > 0)) fail(`route impedance must be a positive number of ohms, got ${JSON.stringify(p.impedance)}`)
        job.impedance = p.impedance
      }
      job.infer = true
      if (p.steps !== undefined) {
        const steps = p.steps as RouteStep[]
        job.steps = steps.map(st => (st.op === 'U' ? { ...st, layer: lay(st.layer) } : { ...st }))
        job.path = stepsText(steps)
      }
      if (p.path !== undefined) {
        if (typeof p.path !== 'string') fail('a route path must be a string')
        try { job.steps = parseRoutePath(p.path, lay) } catch (e) { if (e instanceof CompileError) throw e; fail((e as Error).message) }
        const lit = literalOf(n), self = origin.src
        if (lit && self) for (const st of job.steps ?? []) if (st.at) st.src = segmentSrc(self.file, lit, p.path, st.at[0], st.at[1])
      }
      job.m = ctx.m
      if (typeof p.path === 'string') job.path = p.path
      if (!(COMPILED in n)) Object.defineProperty(n, COMPILED, { value: true })
      if (p.lock !== undefined && p.lock !== false) job.lock = true
      if (p.direct) job.direct = true
      if (p.loop) job.loop = true
      if (p.layer !== undefined) job.layer = lay(p.layer)
      if (p.width !== undefined) { try { job.width = mm(p.width) } catch (e) { fail(`route width: ${(e as Error).message}`) } }
      if (job.width !== undefined && !(job.width > 0)) fail(`route width must be positive, got ${job.width}`)
    } else {
      job.layer = l; job.width = width
      const d = p.d
      if (d !== null && typeof d === 'object' && !Array.isArray(d)) {
        const { start, end, ...rest } = d as AutoRoute
        if (start === undefined || end === undefined) fail('<track> d needs start and end')
        job.from = toBoard(start); job.to = toBoard(end)
        own = rest
      } else if (typeof d === 'function') own = { algorithm: d }
      else if (d !== undefined && d !== null) fail('<track> d must be a path string, an AutoRoute object or a RouteFn')
    }
    const nn = net(p.net ?? (viaNets.length ? viaNets[0] : undefined))
    if (nn !== undefined) job.net = nn
    for (const v of viaNets.slice(p.net === undefined ? 1 : 0)) {
      const other = net(v)
      if (other !== nn) fail(`route ends at a via of ${other}, but the route is on ${nn}`)
    }
    if (p.netN !== undefined) {
      if (!job.pair) return fail('a second net is for a differential pair only, route([aP, aN], [bP, bN]).net(P, N)')
      const n2 = net(p.netN)
      if (n2 !== undefined) job.pair.net = n2
    }
    if (p.neck !== undefined) {
      if (job.from === undefined) fail('neck-down needs a route between two ends, route(a, b).neck({ width, length })')
      try { job.neck = checkNeck(p.neck, 'route neck') } catch (e) { fail((e as Error).message) }
    }
    if (p.corner !== undefined) {
      if (job.from === undefined) fail("corners need a route between two ends, route(a, b).corner(r)")
      try { job.corner = checkCorner({ radius: p.corner }, 'route corner') } catch (e) { fail((e as Error).message) }
    }
    if (job.from === undefined && nn === undefined) fail('<track> without d needs a net')
    if (job.from !== undefined) job.route = `route:${flat.autoRoutes.filter(j => j.route !== undefined).length + 1}`
    if (p.teardrops !== undefined) {
      if (job.route === undefined) fail('teardrops need a route between two ends, route(a, b).teardrops(false)')
      try { flat.routeTeardrops[job.route!] = checkTeardrops(p.teardrops, 'route') } catch (e) { fail((e as Error).message) }
    }
    const lenOf = (k: string, v: unknown, positive: boolean): number => {
      let x = NaN
      try { x = mm(v as any) } catch (e) { fail(`route ${k}: ${(e as Error).message}`) }
      if (!(Number.isFinite(x) && (positive ? x > 0 : x >= 0))) fail(`route ${k} must be a ${positive ? 'positive' : 'non-negative'} length, got ${JSON.stringify(v)}`)
      return x
    }
    if (p.length !== undefined) {
      if (job.from === undefined) fail('a length target needs a route between two ends, route(a, b).length(mm)')
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
      if (job.from === undefined) fail('a match group needs a route between two ends, route(a, b).match(group)')
      const m = typeof p.match === 'string' ? { group: p.match } : p.match
      if (!m || typeof m.group !== 'string' || !m.group.trim()) fail(`route match needs a group name, got ${JSON.stringify(p.match)}`)
      job.match = { group: m.group, ...(m.tolerance !== undefined ? { tolerance: lenOf('match tolerance', m.tolerance, false) } : {}) }
    }
    let raw: Partial<AutoRouteParams> = {}
    try {
      const legacy: Record<string, unknown> = {}
      if (p.layers !== undefined) legacy.layers = p.layers
      if (p.via !== undefined) legacy.via = p.via
      // viaInPad is a per-route parameter the board-wide check does not know
      const pull = (o: unknown) => {
        if (!o || typeof o !== 'object' || !('viaInPad' in o)) return o
        const { viaInPad: v, ...rest } = o as Record<string, unknown>
        if (v !== undefined && typeof v !== 'boolean') fail(`viaInPad must be true or false, got ${JSON.stringify(v)}`)
        if (v !== undefined) viaInPad = v as boolean
        return rest
      }
      let viaInPad: boolean | undefined = p.viaInPad
      if (viaInPad !== undefined && typeof viaInPad !== 'boolean') fail(`viaInPad must be true or false, got ${JSON.stringify(viaInPad)}`)
      own = pull(own) as Record<string, unknown>
      raw = mergeAutoroute({}, checkAutoroute(own, '<track> d'), checkAutoroute(legacy, '<track>'), checkAutoroute(pull(p.auto), '<track> auto'))
      if (viaInPad !== undefined) raw.viaInPad = viaInPad
    } catch (e) { if (e instanceof CompileError) throw e; fail((e as Error).message) }
    const params: JobParams = {}
    for (const [k, v] of Object.entries(raw)) if (v !== undefined && k !== 'via' && k !== 'avoid' && k !== 'layers' && k !== 'prefer') (params as any)[k] = v
    if (raw.layers) params.layers = raw.layers.map(lay)
    if (raw.prefer) params.prefer = Object.fromEntries(Object.entries(raw.prefer).map(([k, v]) => [lay(k), v]))
    if (raw.via) {
      try { params.via = { ...(raw.via.drill !== undefined ? { drill: mm(raw.via.drill) } : {}), ...(raw.via.size !== undefined ? { size: mm(raw.via.size) } : {}) } } catch (e) { fail((e as Error).message) }
    }
    if (raw.avoid) params.avoid = raw.avoid.map((a): JobAvoid => {
      if (a && typeof a === 'object' && !Array.isArray(a) && !isPinRef(a) && 'w' in a && 'h' in a) {
        let x = 0, y = 0, w = 0, h = 0
        try { x = mm(a.x); y = mm(a.y); w = mm(a.w); h = mm(a.h) } catch (e) { fail(`autoroute avoid: ${(e as Error).message}`) }
        return { ring: applyRing(ctx.m, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]), ...(a.layer !== undefined ? { layer: lay(a.layer) } : {}) }
      }
      return { pos: toBoard(a) }
    })
    job.params = params
    return job
  }

  // a font path is relative to the file that holds the literal
  const fontErr = (msg: string, n: PcbNode) => new CompileError(`<text> ${msg}${where(n)}`, srcOf(n))
  const fontFile = (e: unknown, base: string | undefined, n: PcbNode, what: string): OutlineFont => {
    const o: FontSpec | null = typeof e === 'string' ? { file: e } : e && typeof e === 'object' && typeof (e as any).file === 'string' ? e as FontSpec : null
    if (!o || !o.file.trim()) throw fontErr(`${what} needs a file, such as './fonts/RobotoSlab-Bold.ttf', got ${JSON.stringify(e)}`, n)
    if (o.weight !== undefined && !(typeof o.weight === 'number' && o.weight > 0)) throw fontErr(`${what} weight must be a number such as 700, got ${JSON.stringify(o.weight)}`, n)
    const node = nodeApi()
    if (!node) throw fontErr(`${what}: outline fonts are read in Node only`, n)
    const { path, url } = node
    const abs = o.path ?? (o.file.startsWith('file:') ? url.fileURLToPath(o.file) : path.isAbsolute(o.file) ? o.file : path.resolve(base ? path.dirname(base) : '', o.file))
    try { return loadOutlineFont(abs, o.weight) } catch (err) { throw fontErr(`${what}: ${(err as Error).message}`, n) }
  }
  const fileOf = (n: PcbNode | undefined) => { const s = n && srcOf(n); return s?.file ? absFile(s.file, opts.files, nodeApi()!.path) : undefined }
  const fontOf = (f: unknown, n: PcbNode): OutlineFont | null => {
    if (strokeFontName(f)) return null
    if (typeof f === 'string') {
      const own = boardFonts && typeof boardFonts === 'object' ? (boardFonts as Record<string, unknown>)[f] : undefined
      if (own !== undefined) return fontFile(own, nodeApi() ? fileOf(node) : undefined, n, `font "${f}" of <PCB ${flat.name}> fonts`)
      const cfg = configFonts()
      if (cfg.fonts[f] !== undefined) {
        const e = cfg.fonts[f]
        return fontFile(e, cfg.root ? `${cfg.root}/pcb.config.ts` : undefined, n, `font "${f}" of pcb.config.ts`)
      }
      const known = [...new Set([...Object.keys(boardFonts && typeof boardFonts === 'object' ? boardFonts : {}), ...Object.keys(cfg.fonts)])]
      throw fontErr(`font ${JSON.stringify(f)} is not in the board's fonts or pcb.config.ts; ${known.length ? `the names are ${known.map(k => JSON.stringify(k)).join(', ')}, and ` : ''}"hershey" and "newstroke" are the stroke fonts`, n)
    }
    return fontFile(f, nodeApi() ? fileOf(n) : undefined, n, 'font')
  }

  const walk = (c: Child, ctx: Ctx): void => {
    if (c === null || c === undefined || c === false || typeof c === 'string' || typeof c === 'number') return
    if (Array.isArray(c)) { for (const k of c) walk(k, ctx); return }
    const list = childList(c)
    if (list) {
      // any other iterable, a generator included, is read once
      list.forEach((k, i) => {
        if (k !== null && typeof k === 'object' && !isNode(k) && !childList(k)) throw new CompileError(`unexpected child ${JSON.stringify(k)}, yield ${i + 1} of an iterable child${where(cur)}`, cur && srcOf(cur))
        if (partOf(k)) throw new CompileError(`${partOf(k)!.label} is a part, not an element: place it as a JSX element, <R1 at="12 5" />; it is yield ${i + 1} of an iterable child${where(cur)}`, cur && srcOf(cur))
        if (typeof k === 'function' || typeof k === 'symbol' || typeof k === 'bigint' || k === true) throw new CompileError(`unexpected child ${String(k)}, yield ${i + 1} of an iterable child${where(cur)}`, cur && srcOf(cur))
        walk(k as Child, ctx)
      })
      return
    }
    if (partOf(c)) throw new CompileError(`${partOf(c)!.label} is a part, not an element: place it as a JSX element, <R1 at="12 5" />${where(cur)}`, cur && srcOf(cur))
    if (!isNode(c)) throw new CompileError(`unexpected child ${JSON.stringify(c)}`)
    const n = c
    const self = srcOf(n)
    cur = n
    if (typeof n.type === 'function') {
      const props = propsOf(n)
      if (n.children.length) props.children = n.children.length === 1 ? n.children[0] : n.children
      const st = partOf(n.type)
      if (st) { placePart(st, n, props, ctx); return }
      let out: Child
      try { out = renderComponent<Child>(n.type, props) } catch (e) { if (isSchematicError(e)) throw new CompileError(e.message + where(n), self); throw e }
      if (partOf(out)) throw new CompileError(`<${n.type.name || 'Component'}> made the part ${partOf(out)!.label} instead of an element: as JSX, a footprint needs a ref or an at${where(n)}`, self)
      walk(out, { ...ctx, site: ctx.site ?? self, chain: chained(ctx, self) })
      return
    }
    const p = propsOf(n)
    // a route() inside a helper also carries the helper's call site, innermost
    const call = rangeOf((n.props?.__src as { call?: unknown } | undefined)?.call)
    const chain = call ? [...ctx.chain, { ...call, call: true as const }] : ctx.chain
    const origin = { src: self, ...(chain.length ? { chain } : {}) }
    switch (n.type) {
      case 'board': throw new CompileError(`<PCB> can only be the root${where(n)}`, srcOf(n))
      case 'g': {
        const mark = p[LAYOUT_PROP] as LayoutMark | undefined
        if (mark) {
          const site = rangeOf(mark.src) ?? ctx.chain.at(-1) ?? self
          const prev = layoutAt.get(mark.inst)
          const path = instancePath(mark.inst).join('/')
          if (prev) throw new CompileError(`the circuit instance ${path} is laid out twice on <PCB ${flat.name}>: by ${prev.name} at ${loc(prev.src)} and by ${mark.name} at ${loc(site)}`, site)
          const active: ActiveLayout = { inst: mark.inst, name: mark.name, src: site }
          layoutAt.set(mark.inst, active)
          ctx = { ...ctx, layouts: [...ctx.layouts, active] }
        }
        const [x, y, r] = parseAt(p.at)
        const flip = sideFlip(p.side)
        // a start-only position is not worth a call-site level
        walkChildren(n, { ...ctx, m: mul(ctx.m, placement(x, y, r, flip)), flipped: ctx.flipped !== flip, chain: chained(ctx, rangeOf(n.props.__src)) })
        return
      }
      case 'footprint': {
        if (ctx.fp) throw new CompileError(`<footprint ${p.ref}> inside another footprint${where(n)}`, srcOf(n))
        if (!p.ref) throw new CompileError(`<footprint> needs a ref${where(n)}`, srcOf(n))
        const [x, y, r] = parseAt(p.at)
        const flip = sideFlip(p.side)
        const m = mul(ctx.m, placement(x, y, r, flip))
        const flipped = ctx.flipped !== flip
        const bind = ctx.part && !ctx.part.rec && String(p.ref) === ctx.part.id ? ctx.part : undefined
        const nets: Record<string, unknown> = { ...(p.nets ?? {}) }
        for (const k of Object.keys(p)) if (k.startsWith('net:')) nets[k.slice(4)] = p[k]
        const rec: Footprint = {
          ref: String(p.ref), value: String(p.value ?? ''), id: String(p.id ?? ''), at: apply(m, [0, 0]), rot: rotationOf(m),
          side: flipped ? 'B' : 'F', fields: { ...(p.fields ?? {}) }, bom: p.bom !== false, pos: p.pos !== false,
          description: p.description, pads: [], src: ctx.site ?? self,
        }
        // out of the BOM and the placement file, still on the board and in the DRC
        if (p.dnp !== undefined && typeof p.dnp !== 'boolean') throw new CompileError(`${rec.ref}: dnp must be true or false${where(n)}`, srcOf(n))
        if (p.dnp) { rec.dnp = true; rec.bom = false; rec.pos = false }
        const chain = chained(ctx, self)
        if (chain.length) rec.chain = chain
        if (p.height !== undefined) rec.height = mm(p.height, 1)
        if (p.model !== undefined) {
          if (!p.model || typeof p.model !== 'object' || (typeof p.model.kind !== 'string' && !isStepSpec(p.model))) throw new CompileError(`${rec.ref}: model needs a kind, or step for a STEP file${where(n)}`, srcOf(n))
          try { rec.model = footprintModel(p.model, rec.ref, [rec.src, ...chain], opts.files) } catch (e: any) { throw new CompileError(e.message + where(n), srcOf(n)) }
        }
        if (flat.footprints.some(f => f.ref === rec.ref)) throw new CompileError(`duplicate ref ${rec.ref}${where(n)}`, srcOf(n))
        if (p.refAt === false) REF_AT.set(rec, false)
        else if (p.refAt !== undefined && p.refAt !== null) {
          let ra: [number, number, number] = [0, 0, 0]
          try { ra = parseAt(p.refAt) } catch (e) { throw new CompileError(`${rec.ref}: refAt ${(e as Error).message}, or false for no silk ref${where(n)}`, rec.src ?? srcOf(n)) }
          REF_AT.set(rec, { at: apply(m, [ra[0], ra[1]]), rot: rotationOf(mul(m, placement(0, 0, ra[2], false))) })
        }
        flat.footprints.push(rec)
        const fp = { rec, nets, pads: [] as Pad[] }
        walkChildren(n, { ...ctx, m, flipped, fp, chain, part: undefined })
        cur = n
        const used = assignNets(nets, fp.pads, net)
        const tie = p.netTie ?? (bind?.st.footprint as { netTie?: unknown } | undefined)?.netTie
        if (tie !== undefined) {
          try { rec.netTie = netTieGroups(tie, fp.pads) } catch (e) { throw new CompileError(`${bind ? bind.st.label : rec.ref}: netTie ${(e as Error).message}${where(n)}`, srcOf(n)) }
        }
        if (p.thermal !== undefined) {
          const own = srcOf(n), placed = rec.src && rec.src !== own ? rec.src : undefined
          padThermals(bind ? bind.st.label : rec.ref, p.thermal, fp.pads, placed ? ` (${loc(placed)}${own ? `, footprint at ${loc(own)}` : ''})` : where(n), placed ?? own)
        }
        // a pad's own setting wins over the footprint's, the part's .rules() and the placement's
        {
          let own: RuleSet<PartRuleKey> = {}
          if (p.rules !== undefined) {
            try { own = ruleOverrides(p.rules, PART_RULE_KEYS, `${bind ? bind.st.label : rec.ref}: rules`) } catch (e) { throw new CompileError((e as Error).message + where(n), srcOf(n)) }
          }
          const merged = mergeRuleSets(mergeRuleSets(own, bind?.st.rules), bind?.rules)
          for (const k of PART_RULE_KEYS) {
            const v = merged[k]
            if (v === undefined) continue
            if (k === 'thermal') { const a = (v as { angle?: 90 | 45 }).angle; if (a !== undefined) for (const pad of fp.pads) if (pad.thermalAngle === undefined) pad.thermalAngle = a; continue }
            if (k === 'clearance') {
              for (const pad of fp.pads) if (pad.clearance === undefined && pad.clearanceTo === undefined) {
                if (typeof v === 'number') pad.clearance = v
                else pad.clearanceTo = { ...(v as object) }
                pad.override = { ...(pad.override ?? {}), clearance: 'part' }
              }
              continue
            }
            for (const pad of fp.pads) if (pad[k] === undefined) { pad[k] = v as number; pad.override = { ...(pad.override ?? {}), [k]: 'part' } }
          }
        }
        if (bind) {
          bind.rec = rec
          bind.pads = fp.pads
          // an NC pad takes no net; any other pad must equal a pin's name or number
          try { bind.padPins = pinsOfPads(bind.st, fp.pads) } catch (e) { if (isSchematicError(e)) throw new CompileError(e.message + where(n), srcOf(n)); throw e }
          const seen = new Set<string>()
          fp.pads.forEach((pad, i) => {
            const pin = bind.padPins![i]
            if (pin === null) { if (pad.type !== 'npth' && pad.num !== '') pad.net = undefined; return }
            seen.add(pin)
            const c = bind.st.conn.get(pin)
            if (c === undefined) return
            pad.net = isNC(c) ? undefined : net(c)
          })
          const missing = bind.st.pins.filter(q => !seen.has(q))
          if (missing.length) throw new CompileError(`${bind.st.label}: no pad for pin${missing.length > 1 ? 's' : ''} ${missing.join(', ')} on its footprint${where(n)}`, srcOf(n))
        }
        const unused = Object.keys(nets).filter(k => !used.has(k))
        const describe = (k: string) => {
          const alias = PAD_ALIAS.exec(k)
          return alias ? `numbered ${alias[1]} or named ${JSON.stringify(k)}` : `named ${JSON.stringify(k)}`
        }
        if (unused.length) throw new CompileError(`${bind ? bind.st.label : rec.ref}: no pad ${unused.map(describe).join(', ')}${where(n)}`, srcOf(n))
        return
      }
      case 'pad': {
        if (p.num === undefined) throw new CompileError(`<pad> needs a num${where(n)}`, srcOf(n))
        const [x, y, r] = parseAt(p.at)
        const m = mul(ctx.m, placement(x, y, r, false))
        const num = String(p.num), name = String(p.name ?? num)
        const [w, h] = size2(p.size)
        const drill = p.drill !== undefined ? size2(p.drill) : null
        const type = (p.type ?? (drill ? 'tht' : 'smd')) as Pad['type']
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
        const netName = net(p.net)
        if (p.nc !== undefined && typeof p.nc !== 'boolean') throw new CompileError(`<pad ${num}> nc must be true or false${where(n)}`, srcOf(n))
        const pad = add<Pad>({
          kind: 'pad', layer: layersOut[0] ?? 'F.Cu', net: netName, ref: ctx.fp?.rec.ref, ...origin,
          num, name, at: apply(m, [0, 0]), rot: rotationOf(m), shape, size: [w, h], drill, type, layers: layersOut,
          poly: applyRing(m, ring), maskExpansion: p.maskExpansion !== undefined ? mm(p.maskExpansion) : undefined,
          paste: p.paste === undefined ? type === 'smd' : p.paste !== false, mirrored: isMirrored(m),
        })
        if (p.nc) markNcPad(pad)
        if (p.thermal !== undefined) padThermal(pad, p.thermal, `<pad ${num}> thermal`, where(n), srcOf(n))
        if (p.clearance !== undefined || p.holeClearance !== undefined || p.pasteShrink !== undefined) {
          let o: RuleSet<'clearance' | 'holeClearance' | 'pasteShrink'>
          try { o = ruleOverrides({ clearance: p.clearance, holeClearance: p.holeClearance, pasteShrink: p.pasteShrink }, ['clearance', 'holeClearance', 'pasteShrink'] as const, `<pad ${num}>`) } catch (e) { throw new CompileError((e as Error).message + where(n), srcOf(n)) }
          for (const [k, v] of Object.entries(o) as ['clearance' | 'holeClearance' | 'pasteShrink', number | object][]) {
            if (k === 'clearance' && typeof v === 'object') pad.clearanceTo = { ...v }
            else pad[k] = v as number
            pad.override = { ...(pad.override ?? {}), [k]: 'pad' }
          }
        }
        try { padPaste(pad, p, ring, w, h, m, flat.rules) } catch (e) { throw new CompileError(`<pad ${num}> ${(e as Error).message}${where(n)}`, srcOf(n)) }
        // an NPTH opens the mask on both sides, as KiCad does: the pad grown by its expansion, or the hole when the pad is no larger than its drill
        if (p.mask !== undefined && typeof p.mask !== 'boolean') throw new CompileError(`<pad ${num}> mask must be true or false${where(n)}`, srcOf(n))
        if (type === 'npth' && p.mask !== false) {
          const masks = layersOut.filter(l => l.endsWith('.Mask'))
          const padSized = Math.min(w, h) > Math.max(...drill!) + 1e-9 || layersOut.some(l => l.endsWith('.Cu'))
          const hole = drill![0] === drill![1] ? padRing('circle', drill![0], drill![0]) : padRing('oval', drill![0], drill![1])
          pad.maskRings = polysToRings(offset([padSized ? pad.poly : applyRing(m, hole)], pad.maskExpansion ?? flat.rules.maskExpansion))
          if (!masks.length) pad.layers.push('F.Mask', 'B.Mask')
        }
        if (ctx.fp) { ctx.fp.rec.pads.push(pad.id); ctx.fp.pads.push(pad) }
        return
      }
      case 'track': {
        if (p.from !== undefined || p.to !== undefined) {
          flat.autoRoutes.push(autoJob(n, p, ctx, origin))
          return
        }
        const l = layer(n, p.layer, ctx.flipped)
        let width = 0
        try { width = mm(p.width) } catch (e) { throw new CompileError(`<track> width: ${(e as Error).message}${where(n)}`, srcOf(n)) }
        const polylines: { pts: Ring; prims?: Prim[]; src?: Src }[] = []
        const lit = literalOf(n)
        if (typeof p.d === 'string') for (const c of pathCommands(p.d)) polylines.push({ pts: c.pts, prims: c.prims, ...(lit && self ? { src: segmentSrc(self.file, lit, p.d, c.start, c.end) } : {}) })
        else if (p.d === undefined && Array.isArray(p.points)) polylines.push({ pts: p.points.map((q: any) => { const [x, y] = parseAt(q); return [x, y] as [number, number] }) })
        else {
          // an autoroute job runs in pipeline() once the whole tree and the outline are known, so it sees every item of the board
          flat.autoRoutes.push(autoJob(n, p, ctx, origin, l, width))
          return
        }
        for (const { pts, prims, src } of polylines) if (pts.length >= 2) {
          // the arc is kept for the exporters while the transform keeps it circular
          const arcs = hasArc(prims) ? applyPrims(ctx.m, prims!) : undefined
          add<Track>({ kind: 'track', layer: l, net: net(p.net), ref: ctx.fp?.rec.ref, ...(src ? { src, chain: [...ctx.chain, self!] } : origin), pts: applyRing(ctx.m, pts), width, ...(hasArc(arcs) ? { prims: arcs } : {}) })
        }
        return
      }
      case 'via': {
        const [x, y] = parseAt(p.at)
        const ls = (p.layers ?? ['F.Cu', 'B.Cu']).map((q: string) => layer(n, q, ctx.flipped)) as [string, string]
        add<Via>({ kind: 'via', layer: ls[0], net: net(p.net), ref: ctx.fp?.rec.ref, ...origin, at: apply(ctx.m, [x, y]), drill: mm(p.drill, viaDrill), size: mm(p.size, viaSize), layers: ls })
        return
      }
      case 'zone': {
        const l = layer(n, p.layer, ctx.flipped)
        const subs = parsePath(String(p.d)).filter(s => s.pts.length >= 3)
        const rings = subs.map(s => applyRing(ctx.m, s.pts))
        const prims = subs.some(s => hasArc(s.prims)) ? subs.map(s => applyPrims(ctx.m, s.prims)) : undefined
        add<Zone>({ kind: 'zone', layer: l, net: net(p.net), ref: ctx.fp?.rec.ref, ...origin, outline: rings, priority: p.priority ?? 0,
          clearance: p.clearance !== undefined ? mm(p.clearance) : undefined, minWidth: p.minWidth !== undefined ? mm(p.minWidth) : undefined, fill: [],
          ...(prims?.some(hasArc) ? { prims } : {}), ...(p.connect !== undefined ? { connect: thermalConnection(p.connect, '<zone> connect', where(n), srcOf(n)) } : {}),
          ...(p.islands !== undefined ? { islands: islandsOf(p.islands, n) } : {}) })
        return
      }
      case 'keepout': {
        const cu = copperLayers(copper)
        if (p.layer !== undefined && p.layers !== undefined) throw new CompileError(`<keepout> takes layer or layers, not both${where(n)}`, srcOf(n))
        const names: unknown[] = p.layers === 'all' || (p.layer === undefined && p.layers === undefined) ? cu : p.layer !== undefined ? [p.layer] : p.layers
        if (!Array.isArray(names) || !names.length) throw new CompileError(`<keepout> layers must be a list of copper layers or "all"${where(n)}`, srcOf(n))
        const ls = [...new Set(names.map(q => q === 'all' ? cu : [layer(n, q, ctx.flipped)]).flat())]
        for (const l of ls) if (!cu.includes(l)) throw new CompileError(`<keepout> layer ${l} is not a copper layer${where(n)}`, srcOf(n))
        if (typeof p.d !== 'string') throw new CompileError(`<keepout> needs a path d${where(n)}`, srcOf(n))
        const flag = (k: string) => { const v = p[k]; if (v !== undefined && typeof v !== 'boolean') throw new CompileError(`<keepout> ${k} must be true or false${where(n)}`, srcOf(n)); return v !== false }
        // counter-clockwise, so pours and the router can union and subtract with the nonzero rule
        const ccw = (r: Ring): Ring => { let a = 0; for (let i = 0; i < r.length; i++) { const q = r[(i + 1) % r.length]; a += r[i][0] * q[1] - q[0] * r[i][1] } return a < 0 ? [...r].reverse() : r }
        const rings = parsePath(p.d).filter(sp => sp.pts.length >= 3).map(sp => ccw(applyRing(ctx.m, sp.pts)))
        if (!rings.length) throw new CompileError(`<keepout> d has no closed area${where(n)}`, srcOf(n))
        if (p.except !== undefined && !Array.isArray(p.except)) throw new CompileError(`<keepout> except must be a list of nets${where(n)}`, srcOf(n))
        const except = [...new Set(((p.except ?? []) as unknown[]).map(q => {
          const name = net(isPinRef(q) ? q.net : q)
          if (name === undefined) throw new CompileError(`<keepout> except takes nets, got ${String(q)}${where(n)}`, srcOf(n))
          return name
        }))]
        flat.keepouts.push({ layers: cu.filter(l => ls.includes(l)), outline: rings, tracks: flag('tracks'), vias: flag('vias'), pours: flag('pours'), ...(except.length ? { except } : {}), ...(ctx.fp ? { ref: ctx.fp.rec.ref } : {}), ...origin })
        return
      }
      case 'stitch': {
        const fail = (msg: string): never => { throw new CompileError(`stitch() ${msg}${where(n)}`, srcOf(n)) }
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
        const drill = mm(v.drill, viaDrill), size = mm(v.size, viaSize)
        if (!(drill > 0) || !(size > drill)) fail(`via size ${size} must be more than its drill ${drill}`)
        const padClearance = p.padClearance !== undefined ? mm(p.padClearance) : undefined
        if (padClearance !== undefined && !(padClearance >= 0)) fail('padClearance must be 0 or more')
        let area: Ring[] | undefined
        if (p.area !== undefined) {
          if (typeof p.area !== 'string') fail('area must be an SVG path')
          area = parsePath(p.area).filter(sp => sp.pts.length >= 3).map(sp => applyRing(ctx.m, sp.pts))
          if (!area.length) fail('area has no closed area')
        }
        const grid = p.grid !== undefined ? mm(p.grid) : undefined
        if (grid !== undefined && !(grid > 0)) fail('grid must be more than 0')
        let at0: [number, number] | undefined
        if (p.origin !== undefined) {
          try { const [x, y] = parseAt(p.origin); at0 = apply(ctx.m, [x, y]) } catch (e) { fail(`origin: ${(e as Error).message}`) }
        }
        flat.stitches.push({ net: name!, pitch, ...(ls ? { layers: ls } : {}), ...(padClearance !== undefined ? { padClearance } : {}), drill, size, silk: !!p.avoid?.silk, courtyard: !!p.avoid?.courtyard,
          ...(grid !== undefined ? { grid } : {}), ...(at0 ? { origin: at0 } : {}), ...(area ? { area } : {}), ...origin })
        return
      }
      case 'reference': (flat.references ??= []).push({ props: p, m: ctx.m, ...(self ? { src: self } : {}) }); return
      case 'path': case 'line': case 'circle': case 'rect': {
        const l = layer(n, p.layer, ctx.flipped)
        const width = mm(p.width, defaultWidth(l))
        let paths: Ring[] = [], closed: boolean[] = []
        // [] stands for a path without arcs; kept only when some path has an arc
        const prims: Prim[][] = []
        if (n.type === 'path') for (const s of parsePath(String(p.d))) { paths.push(s.pts); closed.push(s.closed); prims.push(s.prims) }
        else if (n.type === 'line') { paths.push([[mm(p.x1), mm(p.y1)], [mm(p.x2), mm(p.y2)]]); closed.push(false) }
        else if (n.type === 'circle') { const cx = mm(p.cx, 0), cy = mm(p.cy, 0), r = mm(p.r); paths.push(circleRing(cx, cy, r)); closed.push(true); if (r > 0) prims.push(circlePrims(cx, cy, r)) }
        else {
          const w = mm(p.w), h = mm(p.h), x = mm(p.x), y = mm(p.y), rx = mm(p.rx, 0)
          const r = rx > 0 ? roundedRect(w, h, rx) : padRing('rect', w, h)
          const t = (q: Pt): Pt => [q[0] + x + w / 2, q[1] + y + h / 2]
          paths.push(r.map(t)); closed.push(true)
          if (rx > 0) prims.push(applyPrims([1, 0, 0, 1, x + w / 2, y + h / 2], roundedRectPrims(w, h, rx)))
        }
        const arcs = prims.some(hasArc) ? prims.map(q => applyPrims(ctx.m, q)) : undefined
        add<Graphic>({ kind: 'graphic', layer: l, net: net(p.net), ref: ctx.fp?.rec.ref, ...origin, paths: paths.map(r => applyRing(ctx.m, r)), closed, width, fill: !!p.fill,
          ...(arcs?.some(hasArc) ? { prims: arcs } : {}) })
        return
      }
      case 'text': {
        const l = layer(n, p.layer, ctx.flipped)
        const [x, y, r] = parseAt(p.at)
        let m = mul(ctx.m, placement(x, y, r, false))
        // back-side text reads mirrored whatever the groups did
        const mirrored = l.startsWith('B.')
        if (isMirrored(m) !== mirrored) m = mul(m, placement(0, 0, 0, true))
        const text = n.children.flat().filter(c => typeof c === 'string' || typeof c === 'number').join('')
        const font = fontOf(p.font, n)
        const size = mm(p.size, 1)
        const silk = l.endsWith('.SilkS')
        if (font) {
          const anchor: Text['anchor'] = p.anchor ?? 'middle'
          const width = p.width === undefined ? undefined : mm(p.width, size)
          if (width !== undefined && !(width > 0)) throw new CompileError(`<text> width must be a positive length, the glyph width, got ${JSON.stringify(p.width)}${where(n)}`, srcOf(n))
          const laid = outlineText(text, font, { size, anchor, ...(width !== undefined ? { width } : {}) })
          if (laid.missing.length) { const k = `${font.family} ${font.style}`; for (const ch of laid.missing) (missingOutline.get(k) ?? missingOutline.set(k, new Set()).get(k)!).add(ch) }
          const dy = size - laid.height / 2
          const tr = (r: Ring): Ring => applyRing(m, r.map(([a, b]) => [a, b + dy] as [number, number])).map(([a, b]) => [nm(a), nm(b)] as [number, number])
          let polys = laid.polys.map(q => ({ outer: tr(q.outer), holes: q.holes.map(tr) }))
          // ink thinner than silkMinWidth grows by half the deficit, so the thinnest stroke prints at the minimum
          if (p.thicken === true && silk) {
            const thin = thinInk(polys, flat.rules.silkMinWidth)
            if (thin) polys = offsetPolys(polys, (flat.rules.silkMinWidth - thin.width) / 2 + 0.001).map(q => ({ outer: q.outer.map(([a, b]) => [nm(a), nm(b)] as [number, number]), holes: q.holes.map(h => h.map(([a, b]) => [nm(a), nm(b)] as [number, number])) }))
          } else if (p.thicken !== undefined && typeof p.thicken !== 'boolean') throw new CompileError(`<text> thicken must be true or false, got ${JSON.stringify(p.thicken)}${where(n)}`, srcOf(n))
          flat.outlineFonts[`${font.family} ${font.style}`] ??= { ...(font.copyright ? { copyright: font.copyright } : {}), ...(font.license ? { license: font.license } : {}), ...(font.licenseURL ? { licenseURL: font.licenseURL } : {}) }
          add<Text>({ kind: 'text', layer: l, net: net(p.net), ref: ctx.fp?.rec.ref, ...origin, at: apply(m, [0, 0]), rot: rotationOf(m), size, thickness: 0, ...(width !== undefined && width !== size ? { width } : {}), text, anchor, mirrored, strokes: [], font: `${font.family} ${font.style}`, polys })
          return
        }
        const thickness = silk ? Math.max(mm(p.thickness, flat.rules.silkMinWidth), flat.rules.silkMinWidth) : mm(p.thickness, 0.15)
        const anchor: Text['anchor'] = p.anchor ?? 'middle'
        const width = p.width === undefined ? undefined : mm(p.width, size)
        if (width !== undefined && !(width > 0)) throw new CompileError(`<text> width must be a positive length, the glyph width, got ${JSON.stringify(p.width)}${where(n)}`, srcOf(n))
        const stroke = strokeFontName(p.font)!
        const laid = strokeText(text, { size, thickness, anchor, ...(width !== undefined ? { width } : {}), font: stroke })
        for (const ch of laid.missing) (missingGlyphs.get(stroke) ?? missingGlyphs.set(stroke, new Set()).get(stroke)!).add(ch)
        // `at` is the vertical centre, from the cap line of the first line to the baseline of the last
        const dy = size - laid.height / 2
        const strokes = laid.strokes.map(s => applyRing(m, s.map(([a, b]) => [a, b + dy] as [number, number])).map(([a, b]) => [nm(a), nm(b)] as [number, number]))
        add<Text>({ kind: 'text', layer: l, net: net(p.net), ref: ctx.fp?.rec.ref, ...origin, at: apply(m, [0, 0]), rot: rotationOf(m), size, thickness, ...(width !== undefined && width !== size ? { width } : {}), text, anchor, mirrored, strokes, ...(stroke === 'newstroke' ? { font: 'newstroke' } : {}) })
        return
      }
      default: throw new CompileError(`unknown element <${String(n.type)}>${where(n)}`, srcOf(n))
    }
  }
  const islandsOf = (v: unknown, n: PcbNode): IslandMode => {
    try { checkIslands(v, '<zone>') } catch (e) { throw new CompileError((e as Error).message + where(n), srcOf(n)) }
    return typeof v === 'object' ? { minArea: (v as { minArea: number }).minArea } : v as IslandMode
  }
  const walkChildren = (n: PcbNode, ctx: Ctx) => { for (const k of n.children) walk(k, ctx) }

  /** A part element, `<R1 at="12 5" />`: render its footprint with a placeholder ref, which the registry replaces once every part is known. */
  const placePart = (st: PartState, n: PcbNode, props: Record<string, any>, ctx: Ctx) => {
    const self = srcOf(n)
    if (placedAt.has(st)) throw new CompileError(`${st.label} is placed twice on <PCB ${flat.name}>: at ${loc(placedAt.get(st))} and at ${loc(self)}`, self)
    if (ctx.fp) throw new CompileError(`${st.label} is placed inside the footprint ${ctx.fp.rec.ref}${where(n)}`, self)
    if (props.ref === false) { const { ref: _r, ...rest } = props; props = { ...rest, refAt: rest.refAt ?? false } }
    const sym = Object.keys(props).filter(k => k === 'rot' || k === 'flip' || k === 'symbol')
    if (sym.length) throw new CompileError(`${st.label}: ${sym.join(', ')} belong${sym.length === 1 ? 's' : ''} to its symbol inside <Schematic>; on the board, at="x y rot" turns it and side="B" puts it on the bottom${where(n)}`, self)
    for (const k of Object.keys(props))
      if (k === 'ref' || k === 'nets' || k.startsWith('net:')) throw new CompileError(`${st.label}: a part takes its ref from the registry and its nets from connect(), not from ${k}${where(n)}`, self)
    placedAt.set(st, self)
    const bind: PartBinding = { st, id: `${PLACEHOLDER}${st.seq}`, layouts: ctx.layouts, site: self }
    // they go to the pads once the footprint is walked, not to the footprint component
    if (props.rules !== undefined) {
      try { bind.rules = ruleOverrides(props.rules, PART_RULE_KEYS, `${st.label}: rules`) } catch (e) { throw new CompileError((e as Error).message + where(n), self) }
      const { rules: _r, ...rest } = props
      props = rest
    }
    bindings.push(bind)
    // sourcing order: factory and value rules, part rules, the options, .source()
    const sourced = sourcingOf(st, opts.files)
    const fields = Object.keys(sourced).length || props.fields ? { ...sourced, ...(props.fields ?? {}) } : undefined
    const fpProps = { ...st.props, ...(st.value !== undefined ? { value: st.value } : {}), ...props, ...(fields ? { fields } : {}), ref: bind.id }
    const out = renderComponent<Child>(st.footprint, fpProps)
    walk(out, { ...ctx, site: ctx.site ?? self, chain: chained(ctx, self), part: bind })
    if (!bind.rec) throw new CompileError(`${st.label}: its footprint rendered no <footprint> with the ref it was given${where(n)}`, self)
  }

  const missingGlyphs = new Map<string, Set<string>>()
  const missingOutline = new Map<string, Set<string>>()
  const layoutAt = new Map<InstanceState, ActiveLayout>()
  const scope = beginCompile(flat.rules)
  try { walkChildren(node, { m: IDENTITY, flipped: false, fp: null, chain: [], layouts: [] }) } finally { endCompile(scope) }
  for (const b of bindings) {
    for (let i = b.st.owner; i; i = i.parent ?? undefined) {
      const lay = layoutAt.get(i)
      if (!lay) continue
      const own = new Set<InstanceState>()
      for (let j: InstanceState | null = b.st.owner!; j; j = j.parent) own.add(j)
      if (b.layouts.some(l => own.has(l.inst))) break
      const local = [...instancePath(b.st.owner!), b.st.key ?? '?'].join('.')
      throw new CompileError(`${b.st.label}, ${local}, is placed at ${loc(b.site)} outside a layout, while ${lay.name} lays out ${instancePath(i).join('/')} at ${loc(lay.src)}`, b.site)
    }
  }
  schematicPass(flat, { bindings, snapshot: scope.parts, instances: scope.instances, netObjs, layoutAt, refStyle })
  netRulesPass(flat, netObjs)
  classPass(flat, (q, name) => layer(node, q, false) ?? name)
  if (flat.rules.strictNets && stringNet && (bindings.length || netObjs.size))
    throw new CompileError(`<PCB ${flat.name}> has strictNets: the net ${JSON.stringify(stringNet.name)} is a string${where(stringNet.node)}; use a Net from nets()`, stringNet.node && srcOf(stringNet.node))
  for (const [f, set] of missingOutline) console.warn(`pcbjs: ${flat.name}: no glyph for ${[...set].map(c => JSON.stringify(c)).join(', ')} in ${f}, drawn as its .notdef glyph`)
  for (const [f, set] of missingGlyphs) console.warn(`pcbjs: ${flat.name}: no glyph for ${[...set].map(c => JSON.stringify(c)).join(', ')} in ${f === 'hershey' ? 'hershey-simplex' : f}, drawn as a box`)
  return flat
}

function unwrap(c: Child): PcbNode | null {
  if (Array.isArray(c)) { const nodes = c.filter(isNode); return nodes.length === 1 ? nodes[0] : null }
  if (!isNode(c)) return null
  if (typeof c.type === 'function') {
    const props = propsOf(c)
    if (c.children.length) props.children = c.children.length === 1 ? c.children[0] : c.children
    return unwrap(c.type(props))
  }
  return c
}

function sideFlip(side: unknown): boolean {
  if (side === undefined || side === null) return false
  const s = String(side).toLowerCase()
  if (s === 'b' || s === 'bottom' || s === 'back') return true
  if (s === 'f' || s === 'top' || s === 'front') return false
  throw new CompileError(`bad side ${JSON.stringify(side)}`)
}

function defaultWidth(layer: string): number {
  if (layer === 'Edge.Cuts') return 0.05
  // 0.15: the thinnest legend line JLCPCB and PCBWay print, and BASE.silkMinWidth
  if (layer.endsWith('.SilkS')) return 0.15
  if (layer.endsWith('.CrtYd')) return 0.05
  if (layer.endsWith('.Fab')) return 0.1
  return 0.1
}


interface NetObj { name: string; class?: string; local: boolean; seq: number; classes: Set<string>; path?: string[]; rules?: { clearance?: number | KindClearanceMM } }

/** Where a part sits in declaration order: its own sequence at the board level, else its outermost instance's, then the key positions down to it. */
function orderKey(st: PartState): number[] {
  if (!st.owner) return [st.seq]
  const idx: number[] = []
  let m: PartState | InstanceState = st
  for (let o: InstanceState | null = st.owner; o; o = o.parent) { idx.unshift([...o.members.values()].indexOf(m)); m = o }
  return [m.seq, ...idx]
}
function byOrder(a: PartState, b: PartState): number {
  const x = orderKey(a), y = orderKey(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
  return x.length - y.length
}

const refKey = (r: string): [string, number, string] => { const m = /^([A-Za-z_]*)(\d*)(.*)$/.exec(r)!; return [m[1], m[2] ? Number(m[2]) : -1, m[3]] }
function byRef(a: string, b: string): number {
  const x = refKey(a), y = refKey(b)
  return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0)
}

/** Number the placed parts, rewrite the placeholder refs, build the netlist and the ERC findings; refs the design wrote are reserved first. */
function schematicPass(flat: Flat, s: {
  bindings: PartBinding[]; snapshot: PartState[]; instances: InstanceState[]; netObjs: Map<string, NetObj>
  layoutAt: Map<InstanceState, ActiveLayout>; refStyle: 'flat' | 'hierarchical'
}) {
  const taken = new Set(flat.footprints.filter(f => !f.ref.startsWith(PLACEHOLDER)).map(f => f.ref))
  const refs = new Map<PartState, string>()
  const named = (st: PartState) => st.explicitRef ?? st.boundRef
  const nameSite = (st: PartState) => loc(st.explicitRef === undefined ? st.boundSrc ?? st.src : st.src)
  const owners = new Map<string, PartState>()
  const reserve = (st: PartState): void => {
    const r = named(st)
    if (r === undefined || refs.has(st)) return
    const other = owners.get(r)
    if (other) {
      if (st.explicitRef === undefined && other.explicitRef === undefined)
        throw new SchematicError(`two parts are bound to the ref ${r}: ${other.label} at ${nameSite(other)} and ${st.label} at ${nameSite(st)}; rename one of the variables`)
      throw new CompileError(`duplicate ref ${r}: ${other.label} at ${nameSite(other)} and ${st.label} at ${nameSite(st)} both name it, by .ref() or by the variable they are bound to`, st.src)
    }
    if (taken.has(r)) throw new CompileError(`duplicate ref ${r}: ${st.label} ${st.explicitRef === undefined ? `is bound to the variable ${r} at ${nameSite(st)}` : 'pins it with .ref()'}, and another footprint uses it`, st.src)
    taken.add(r); refs.set(st, r); owners.set(r, st)
  }
  for (const b of s.bindings) reserve(b.st)
  const next = new Map<string, number>()
  const number = (st: PartState): string => {
    if (s.refStyle === 'hierarchical' && st.owner && st.key) {
      const r = [...instancePath(st.owner), st.key].join('_').replace(/\W+/g, '_').replace(/_$/, '').toUpperCase()
      if (taken.has(r)) throw new CompileError(`duplicate ref ${r}: the hierarchical ref of ${st.label} is taken`, st.src)
      taken.add(r)
      return r
    }
    let k = next.get(st.prefix) ?? 1
    while (taken.has(`${st.prefix}${k}`)) k++
    next.set(st.prefix, k + 1)
    const r = `${st.prefix}${k}`
    taken.add(r)
    return r
  }
  for (const b of [...s.bindings].sort((a, c) => byOrder(a.st, c.st))) if (!refs.has(b.st)) refs.set(b.st, number(b.st))
  const placed = new Set(s.bindings.map(b => b.st))
  const files = new Set(s.bindings.flatMap(b => (!b.st.render && b.st.declFile ? [b.st.declFile] : [])))
  // those declared in those files, and those whose parts it placed or laid out
  const tops = new Set<InstanceState>()
  for (const i of s.instances) if (!i.parent && i.declFile && files.has(i.declFile)) tops.add(i)
  for (const b of s.bindings) if (b.st.owner) tops.add(topInstance(b.st.owner))
  for (const i of s.layoutAt.keys()) tops.add(topInstance(i))
  const onBoard: InstanceState[] = []
  const visit = (i: InstanceState) => { onBoard.push(i); for (const m of i.members.values()) if (isInstanceState(m)) visit(m) }
  for (const i of [...tops].sort((a, c) => a.seq - c.seq)) visit(i)
  const paths = new Map<string, InstanceState>()
  for (const i of onBoard) {
    const k = instancePath(i).join('/')
    const other = paths.get(k)
    if (other) throw new CompileError(`two circuit instances on <PCB ${flat.name}> are named ${k}${other.src ? `, from ${loc(other.src)}` : ''}${i.src ? ` and ${loc(i.src)}` : ''}; give them distinct names`, i.src)
    paths.set(k, i)
  }
  // one unplaced-circuit error for all parts of an unplaced instance under a placed parent
  const touched = (i: InstanceState) => s.layoutAt.has(i) || instanceParts(i).some(st => placed.has(st))
  const unplacedCircuits = onBoard.filter(i => !touched(i) && (!i.parent || touched(i.parent)))
  const silent = new Set(unplacedCircuits.flatMap(instanceParts))
  const candidates = new Set(s.snapshot.filter(st => st.declFile && files.has(st.declFile)))
  for (const i of onBoard) for (const st of instanceParts(i)) candidates.add(st)
  const unplaced = [...candidates].filter(st => !placed.has(st)).sort(byOrder)
  for (const st of unplaced) { const r = named(st); refs.set(st, r && !taken.has(r) ? (taken.add(r), r) : number(st)) }

  const byId = new Map(s.bindings.map(b => [b.id, refs.get(b.st)!]))
  const fix = (r: string | undefined) => (r !== undefined && r.startsWith(PLACEHOLDER) ? byId.get(r) ?? r : r)
  for (const f of flat.footprints) f.ref = fix(f.ref)!
  for (const it of flat.items) if (it.ref !== undefined) it.ref = fix(it.ref)
  for (const j of flat.autoRoutes) if (j.ref !== undefined) j.ref = fix(j.ref)
  for (const b of s.bindings) flat.partRefs.set(b.st, refs.get(b.st)!)
  padEnds(flat, s.bindings)

  const erc: DrcMarker[] = []
  const netOf = (st: PartState, pin: string) => {
    const c = st.conn.get(pin)
    return { net: c === undefined || isNC(c) ? null : netInfo(c)!.name, nc: !!c && isNC(c) }
  }
  const parts: BoardSchematicPart[] = []
  const exported = (st: PartState) => { const e = flat.exports?.parts.get(st); return e ? { export: e } : {} }
  const hier = (st: PartState, ref: string) => (st.owner ? { path: instancePath(st.owner), local: st.key ?? ref } : { path: [], local: ref })
  for (const i of unplacedCircuits) {
    const src = i.src
    erc.push({ severity: 'error', rule: 'unplaced-circuit', message: `${instancePath(i).join('/')}, an instance of the circuit ${i.circuit}${src ? ` from ${base(src.file)}:${src.line}` : ''}, is declared but never laid out or placed on the board`, at: [0, 0] })
  }
  const pinsOfNet = new Map<string, string[]>()
  const addPin = (net: string | undefined, label: string) => { if (net === undefined) return; const l = pinsOfNet.get(net) ?? []; if (!l.includes(label)) l.push(label); pinsOfNet.set(net, l) }
  const bound = new Set<Footprint>()
  for (const b of s.bindings) {
    const ref = refs.get(b.st)!, rec = b.rec!
    bound.add(rec)
    b.pads!.forEach((pad, i) => { const pin = b.padPins![i]; if (pin !== null) addPin(pad.net, `${ref}.${pin}`) })
    parts.push({ ref, value: rec.value, footprint: rec.id, prefix: b.st.prefix, pins: b.st.pins.map(pin => ({ name: pin, ...netOf(b.st, pin) })), placed: true, ...(b.st.src ?? rec.src ? { src: b.st.src ?? rec.src } : {}), ...hier(b.st, ref), ...exported(b.st) })
    for (const pin of b.st.pins) {
      if (b.st.conn.has(pin)) continue
      const pad = b.pads!.find((_, i) => b.padPins![i] === pin)
      erc.push({ severity: 'warning', rule: 'unconnected-pin', message: `${ref}.${pin}, ${b.st.label}, is not connected: connect it to a net or to NC`, at: pad ? pad.at : [0, 0], ...(pad ? { items: [pad.id] } : {}) })
    }
  }
  const padsById = new Map(flat.items.flatMap(it => (it.kind === 'pad' ? [[it.id, it] as const] : [])))
  for (const f of flat.footprints) {
    if (bound.has(f)) continue
    const pins: BoardSchematicPart['pins'] = []
    for (const id of f.pads) {
      const pad = padsById.get(id)
      if (!pad || !pad.num || pins.some(q => q.name === pad.num)) continue
      pins.push({ name: pad.num, net: pad.net ?? null, nc: false })
      addPin(pad.net, `${f.ref}.${pad.num}`)
    }
    parts.push({ ref: f.ref, value: f.value, footprint: f.id, prefix: /^[A-Za-z_]*/.exec(f.ref)![0], pins, placed: true, ...(f.src ? { src: f.src } : {}), path: [], local: f.ref })
  }
  for (const st of unplaced) {
    const ref = refs.get(st)!
    parts.push({ ref, value: st.value ?? '', footprint: st.footprintId, prefix: st.prefix, pins: st.pins.map(pin => ({ name: pin, ...netOf(st, pin) })), placed: false, ...(st.src ? { src: st.src } : {}), ...hier(st, ref), ...exported(st) })
    if (silent.has(st)) continue
    erc.push({ severity: 'error', rule: 'unplaced-part', message: `${ref}, ${st.label}${st.src ? ` from ${base(st.src.file)}:${st.src.line}` : ''}, is declared but never placed on the board`, at: [0, 0] })
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
    const dot = label.lastIndexOf('.'), ref = label.slice(0, dot), pin = label.slice(dot + 1)
    const f = flat.footprints.find(x => x.ref === ref)
    const b = s.bindings.find(x => x.rec === f)
    const pad = b ? b.pads!.find((_, i) => b.padPins![i] === pin) : f && f.pads.map(id => padsById.get(id)!).find(q => q && q.num === pin)
    return pad ? pad.at : [0, 0]
  }
  for (const d of declared) {
    const pins = pinsOfNet.get(d.name) ?? []
    if (pins.length < 2) erc.push({ severity: 'warning', rule: 'single-pin-net', message: `net ${d.name} has ${pins.length ? `only one pin, ${pins[0]}` : 'no pins'}`, at: padAt(pins[0]) })
    if (d.classes.size > 1) erc.push({ severity: 'warning', rule: 'net-class', message: `net ${d.name} is declared with the classes ${[...d.classes].join(' and ')}`, at: padAt(pins[0]) })
  }
  const circuits: BoardSchematicCircuit[] = onBoard.map(i => {
    const own: string[] = [], children: string[] = []
    for (const m of i.members.values()) if (isInstanceState(m)) children.push(m.name); else { const r = refs.get(m); if (r !== undefined) own.push(r) }
    const lay = s.layoutAt.get(i)
    return { path: instancePath(i), name: i.name, circuit: i.circuit, ...(lay ? { layout: lay.name } : {}), parts: own, children, placed: instanceParts(i).every(st => placed.has(st)) }
  })
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
    const c = d.rules!.clearance, { clearance: _c, clearanceTo: _t, ...rest } = base ?? { ...CLASS_DEFAULTS }
    // objects by kind merge; otherwise the net's clearance replaces its class's
    const kinds = typeof c === 'object' ? (base?.clearanceTo ? { ...base.clearanceTo, ...c } : { ...c }) : undefined
    table[name] = c === undefined ? { ...(base ?? { ...CLASS_DEFAULTS }) } : { ...rest, ...(kinds ? { clearanceTo: kinds as ResolvedNetClass['clearanceTo'] } : { clearance: c as number }) }
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
  for (const it of flat.items) if (it.kind === 'pad' && it.ref !== undefined) { const l = padsOf.get(it.ref) ?? []; l.push(it); padsOf.set(it.ref, l) }
  const refOf = new Map<PartState, string>(flat.partRefs)
  const padAt = (q: unknown): Pad | undefined => {
    if (isPinRef(q)) {
      const st = partOf(q.part), ref = st && refOf.get(st)
      if (!st || !ref) return undefined
      const pads = padsOf.get(ref) ?? []
      return q.pad !== undefined ? pads.find(p => p.num === q.pad) ?? pads.find(p => p.name === q.pad) : pads.find(p => pinOfPad(st.pins, p) === q.pin)
    }
    if (typeof q === 'string') {
      let c: ReturnType<typeof coordString> = null
      try { c = coordString(q) } catch { return undefined }
      if (c) return undefined
      const dot = q.indexOf('.'), pads = padsOf.get(q.slice(0, dot)) ?? [], k = q.slice(dot + 1)
      return pads.find(p => p.num === k) ?? pads.find(p => p.name === k)
    }
    return undefined
  }
  const r2 = (v: number) => Math.round(v * 100) / 100
  const padName = (p: Pad | undefined, q: unknown) => (p ? `${p.ref}.${p.num}` : JSON.stringify(isPinRef(q) ? q.pin : q))
  const solved = new Map<AutoRouteJob, { z: number; layer: string; pad?: Pad }>()
  for (const job of flat.autoRoutes) {
    const pa = job.from !== undefined ? padAt(job.from) : undefined
    const fail = (msg: string): never => { throw new CompileError(`${msg}${job.src ? ` (${loc(job.src)})` : ''}`, job.src) }
    let net = job.net ?? (job.infer ? pa?.net ?? (job.to !== undefined ? padAt(job.to)?.net : undefined) : undefined)
    if (job.pair) {
      const pb = padAt(job.to), na = padAt(job.pair.fromN), nb = padAt(job.pair.toN)
      const side = (x: Pad | undefined, qx: unknown, y: Pad | undefined, qy: unknown, which: string): string | undefined => {
        if (x?.net && y?.net && x.net !== y.net) fail(`pair route: the ${which} ends ${padName(x, qx)} and ${padName(y, qy)} are on two nets, ${x.net} and ${y.net}`)
        return x?.net ?? y?.net
      }
      // with pads they must agree
      const given = job.pair.net
      const pNet = side(pa, job.from, pb, job.to, 'P') ?? job.net, nNet = side(na, job.pair.fromN, nb, job.pair.toN, 'N') ?? given
      if (given !== undefined && nNet !== given) fail(`pair route is given the N net ${given}, but its N ends are on ${nNet}`)
      const all = `${padName(pa, job.from)}, ${padName(na, job.pair.fromN)}, ${padName(pb, job.to)} and ${padName(nb, job.pair.toN)}`
      if (pNet === undefined || nNet === undefined) fail(`pair route: neither ${pNet === undefined ? 'P' : 'N'} end is a pad on a net; the ends are ${all}; give both nets with .net(P, N)`)
      if (pNet === nNet) fail(`pair route: the P and N ends ${all} are all on net ${pNet}; a pair joins two nets, P first in each array`)
      if (job.net !== undefined && job.net !== pNet) fail(`pair route is given the net ${job.net}, but its P ends are on ${pNet}`)
      job.net = net = pNet
      job.pair.net = nNet
    }
    const name = net !== undefined ? netClass.get(net) : undefined
    const c = name !== undefined ? table[name] : undefined
    // the router's start layer: the route's layer, else the pad's copper layer, F.Cu first
    const startLayer = () => {
      const def = job.layer ?? 'F.Cu', cu = pa ? pa.layers.filter(l => l.endsWith('.Cu')) : []
      return cu.length && !cu.includes(def) ? cu[0] : def
    }
    if (job.pair) {
      const start = startLayer()
      // without a width of its own, a class gap is held as well
      let w = job.width, g = job.pair.gap ?? (job.width === undefined ? c?.gap : undefined)
      const solve = (z: number, what: string) => {
        if (w !== undefined && g !== undefined) return
        let geo = { width: 0, gap: 0 }
        try { geo = pairGeometry(flat.stackup, start, z, { ...(w !== undefined ? { width: w } : {}), ...(g !== undefined ? { gap: g } : {}) }) } catch (e) { fail(`${what}, ${z} ohms differential on ${start}: ${(e as Error).message}`) }
        if (w === undefined) solved.set(job, { z, layer: start, pad: pa })
        w ??= r2(geo.width); g ??= r2(geo.gap)
      }
      if (job.impedance !== undefined) solve(job.impedance, 'pair route impedance')
      else {
        w ??= c?.width; g ??= c?.gap
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
      try { job.width = r2(traceWidth(flat.stackup, start, job.impedance)) } catch (e) { fail(`route impedance, ${job.impedance} ohms on ${start}: ${(e as Error).message}`) }
      solved.set(job, { z: job.impedance, layer: start, pad: pa })
    }
    if (!c) continue
    if (c.neck && job.from !== undefined) job.neck = { ...c.neck, ...(job.neck ?? {}) }
    if (c.corner && job.from !== undefined) job.corner = { ...c.corner, ...(job.corner ?? {}) }
    const resolve = (l: string) => { try { return lay(l, l) } catch (e) { return fail(`net class ${name}: ${(e as Error).message}`) } }
    if (job.width === undefined) {
      if (c.width !== undefined) job.width = c.width
      else if (c.impedance !== undefined) {
        const start = startLayer()
        try { job.width = r2(traceWidth(flat.stackup, start, c.impedance)) } catch (e) { fail(`net class ${name}, ${c.impedance} ohms on ${start}: ${(e as Error).message}`) }
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
      if (a.avoid) params.avoid = a.avoid.map((q): JobAvoid => q && typeof q === 'object' && !Array.isArray(q) && !isPinRef(q) && 'w' in q
        ? (() => { const x = mm(q.x), y = mm(q.y), w = mm(q.w), h = mm(q.h); return { ring: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as Pt[], ...(q.layer !== undefined ? { layer: resolve(q.layer) } : {}) } })()
        : { pos: q as Pos })
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
    if (n.class && !table[n.class]) unknown.push({ severity: 'warning', rule: 'net-class', message: `net ${n.name} has the class ${n.class}, which the board does not define (classes: ${Object.keys(table).join(', ')})`, at: anchor(n.name) })
  if (unknown.length) flat.erc = [...flat.erc, ...unknown].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1))
}

/** ERC `impedance-width`: a solved width over twice the smaller side of the start pad, reported instead of the router's `no path found`. */
function impedanceWidth(flat: Flat, solved: Map<AutoRouteJob, { z: number; layer: string; pad?: Pad }>): void {
  const out: DrcMarker[] = []
  for (const [job, s] of solved) {
    const p = s.pad, w = job.width
    if (!p || w === undefined) continue
    const side = Math.min(p.size[0], p.size[1])
    if (!(w > 2 * side + 1e-9)) continue
    const what = job.pair ? `the pair of nets ${job.net} and ${job.pair.net}, ${s.z} ohms differential,` : `the route of net ${job.net ?? p.net ?? '?'}, ${s.z} ohms,`
    const gap = job.pair ? ` with a ${job.pair.gap} mm gap` : ''
    out.push({ severity: 'warning', rule: 'impedance-width', message: `${what} solves to ${w} mm tracks${gap} on ${s.layer}, more than twice the ${Math.round(side * 1000) / 1000} mm pad ${p.ref}.${p.num} it starts at; it leaves the pad only through a neck-down, .neck(), and fits better on a thinner prepreg such as @pcbjs/fab/JLCPCB/4-Layer-3313, see stackup-and-rules.md Impedance`, at: p.at, layer: s.layer, items: [p.id], ...(job.src ? { src: job.src } : {}) })
  }
  if (out.length) flat.erc = [...flat.erc, ...out].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1))
}

/** The net tie groups of a footprint checked against its pads: lists of two or more pad numbers it has, each pad in one group. */
function netTieGroups(tie: unknown, pads: Pad[]): string[][] {
  if (!Array.isArray(tie)) throw new Error(`must be a list of pad number groups such as [['1', '2'], ['3', '4']], got ${JSON.stringify(tie)}`)
  const nums = new Set(pads.map(p => p.num)), seen = new Set<string>()
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
