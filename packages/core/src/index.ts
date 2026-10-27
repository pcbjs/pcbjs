import { h } from './jsx-runtime.js'
import type { At, IslandMode, AutoRouteParams, BoardProps, Child, KeepoutProps, Length, LengthSpec, NeckSpec, NetLike, TeardropSpec, PcbNode, PinRef, Pos, RouteBuilder, RouteFn, Src, StitchProps, ThermalConnection, TrackProps, ViaNode, ViaProps, ZoneProps } from './types.js'
import { isNC, isNet, isPinRef, schematicRegistry } from './schematic.js'
import { mm } from './units.js'
import type { RouteStep } from './model.js'
import { isOwnFile } from './own-files.js'
import { checkTeardrops } from './teardrop.js'

export type * from './types.js'
export { h, Fragment, isNode, childList } from './jsx-runtime.js'
export { mm, deg, at, size2 } from './units.js'
export type { UserConfig } from './config.js'
export { defineConfig } from './config.js'
export type { FontSpec } from './types.js'
export { defineDefaultBoard, defineDefaultRules, resetDefaults, BASE_BOARD, BASE_RULES, mergeRules } from './defaults.js'
export type { BoardSpec, ResolvedBoardSpec } from './defaults.js'
export { isBoundPCB } from './preset.js'
export type { BoundPCB, PresetSpec, PresetBoardProps } from './preset.js'
export { variants, isVariants, variantSlug } from './variants.js'
export { nets, local, bus, NC, part, defineFootprint, source, isNet, isNC, isPart, isPinRef, SchematicError, bindRef } from './schematic.js'
export { resolveSourcing } from './sourcing.js'
export { reference } from './reference.js'
export type { ReferenceOptions, ReferenceMate, ReferenceShow, ReferenceStack } from './reference.js'
export { circuit, group, layout, isCircuit, isCircuitInstance } from './circuit.js'
export { Schematic, Sym, Label, Power, Sheet, Text, schematic, wire, isSchematicDrawing, schematicDrawing } from './sch-elements.js'
export type { SchematicProps, SymProps, LabelProps, PowerProps, SheetProps, TextProps, SchAt, WireBuilder, SchematicModule } from './sch-elements.js'
export { defineSymbol, SYMBOLS } from './sch-symbol.js'
export type { SymbolDef, SymbolSpec, SymbolPinSpec, PinSide } from './sch-symbol.js'
export type { Circuit, CircuitInstance, CircuitInstanceBase, CircuitMembers, CircuitOwn, Group, GroupBase, Layout, LayoutProps, NetsProxy, Ports, InstanceOf } from './circuit.js'
export type { Sourcing } from './site-data.js'
export type { PartInit, PartArgs, SourcedPart, SourcedCircuit } from './schematic.js'
export type { BoundVariants, VariantTarget, VariantObject, VariantSpec } from './variants.js'

/** The board root. `<PCB name="Blinky">…</PCB>` */
export default function PCB(props: BoardProps): PcbNode {
  const { children, ...rest } = props
  return h('board', rest, children)
}
export { PCB }

/** The legacy `route(net, opts)`: `from` and `to` make one routed connection, `d` alone an SVG path or RouteFn, neither the whole net. */
export interface RouteOptions {
  from?: Pos
  to?: Pos
  width: Length
  layer?: string
  layers?: string[]
  via?: { drill?: Length; size?: Length }
  d?: string | RouteFn
  /** the algorithm for a `from`/`to` connection: "maze" (default), "straight" or a RouteFn */
  algorithm?: 'maze' | 'straight' | RouteFn
  /** autoroute parameters for this track, merged over the board's */
  auto?: Partial<AutoRouteParams>
  points?: At[]
}
export interface PourOptions { clearance?: Length; priority?: number; minWidth?: Length; connect?: ThermalConnection; islands?: IslandMode }
export interface ViaOptions { drill?: Length; size?: Length; layers?: [string, string] }
export type StitchOptions = Omit<StitchProps, 'net'>

const isProps = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !isNet(v)
/** A via node, a route end: what `via()` returns, or a `<via>` element. */
export const isViaNode = (v: unknown): v is ViaNode => !!v && typeof v === 'object' && (v as PcbNode).$$ === 'pcb' && (v as PcbNode).type === 'via'
/** A plain options object, not a position: no pin handle, no tuple, no `{ at }`. */
const isOptions = (v: unknown): v is Record<string, any> => isProps(v) && !Array.isArray(v) && !isPinRef(v) && !isViaNode(v) && !('at' in v)
/** The `__src` the source-range transform adds to the last object argument, or to a trailing argument of its own. */
function takeSrc(args: unknown[]): { __src?: unknown } {
  for (let i = args.length - 1; i >= 0; i--) { const a = args[i] as any; if (a && typeof a === 'object' && a.__src) return { __src: a.__src } }
  return {}
}
const strip = (o: unknown): Record<string, any> => { if (!isProps(o)) return {}; const { __src: _, ...rest } = o; return rest }
/** A position without the `__src` the transform may have put into it. */
const bare = (v: unknown): unknown => (isProps(v) && !Array.isArray(v) && !isPinRef(v) && !isViaNode(v) && '__src' in v ? strip(v) : v)

/** A stack frame position, absolute path, 1-based. */
type Frame = { file: string; line: number; col: number }
const FRAME = /\(?(?:file:\/\/)?((?:[A-Za-z]:)?[\\/][^():]+):(\d+):(\d+)\)?\s*$/
const userFrame = (f: string) => !/[\\/]node_modules[\\/]/.test(f) && !isOwnFile(f)
/** Where the helper that made a route was called from, by the stack past the innermost function around the call; undefined inline or without a source mapper. */
function callSite(src: unknown): Frame | undefined {
  const s = src as { file?: unknown; line?: unknown; endLine?: unknown; fn?: { line?: unknown; endLine?: unknown } } | undefined
  const map = schematicRegistry().mapSrc
  if (!map || !s || typeof s.file !== 'string' || typeof s.line !== 'number') return undefined
  const first = s.line, last = typeof s.endLine === 'number' ? s.endLine : first
  const fn = s.fn && typeof s.fn.line === 'number' && typeof s.fn.endLine === 'number' ? { line: s.fn.line, endLine: s.fn.endLine } : undefined
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 60
  const stack = new Error().stack ?? ''
  Error.stackTraceLimit = limit
  const raw: Frame[] = []
  for (const l of stack.split('\n').slice(1)) {
    const m = FRAME.exec(l)
    if (m && userFrame(m[1])) raw.push({ file: m[1], line: +m[2], col: +m[3] })
  }
  // mapping goes through Vite's stack rewriting, so only the frames looked at are mapped
  const mapped = new Map<number, Frame>()
  const at = (k: number): Frame | undefined => {
    if (k >= raw.length) return undefined
    let v = mapped.get(k)
    if (!v) { try { v = map(raw[k]) } catch { v = raw[k] } mapped.set(k, v) }
    return v
  }
  // a file outside the root, `../lib/wire.ts`, leaves the root unknown, so the call site keeps its absolute path
  const rel = s.file.replace(/^(?:\.\.\/)+/, '')
  const outside = rel !== s.file
  let i = 0
  for (; i < Math.min(raw.length, 4); i++) { const f = at(i)!; if (f.file.replace(/\\/g, '/').endsWith('/' + rel) && f.line >= first && f.line <= last) break }
  if (i >= Math.min(raw.length, 4)) return undefined
  const own = at(i)!, root = outside ? '\0' : own.file.slice(0, own.file.length - rel.length)
  const entry = at(raw.length - 1)!.file
  let up: Frame | undefined
  for (let k = i + 1; k < raw.length && k < i + 24; k++) {
    const f = at(k)!
    if (f.file !== own.file) { up = f; break }
    if (own.file !== entry) continue
    // in the entry, frames inside the helper are its callbacks; the first one outside is the call
    if (fn) { if (f.line < fn.line || f.line > fn.endLine) { up = f; break } continue }
    // no function around the call: an inline route in a .map or JSX is no helper
    break
  }
  if (!up) return undefined
  return { file: up.file.startsWith(root) ? up.file.slice(root.length) : up.file, line: up.line, col: up.col }
}
/** The `__src` of a route call with its caller, see callSite. */
function withCall(src: { __src?: unknown }): { __src?: unknown } {
  const call = callSite(src.__src)
  return call ? { __src: { ...(src.__src as object), call } } : src
}

/** The builder methods of a route node, which change its props in place and return it. */
function builder(node: PcbNode): RouteBuilder {
  const p = node.props
  const def = (name: string, f: (...a: any[]) => void) =>
    Object.defineProperty(node, name, { value: (...a: any[]) => { f(...a); return node }, enumerable: false, configurable: true })
  def('width', (w: Length) => { p.width = w })
  def('layer', (l: string) => { p.layer = l })
  def('layers', (ls: string[]) => { if (!Array.isArray(ls)) throw new TypeError('route().layers() takes a list of layer names'); p.layers = [...ls] })
  def('vias', (v: boolean | { drill?: Length; size?: Length }) => {
    if (v === false) p.auto = { ...(p.auto ?? {}), maxVias: 0 }
    else if (v === true) { if (p.auto) { const { maxVias: _, ...r } = p.auto; p.auto = r } }
    else if (v && typeof v === 'object') p.via = { ...v }
    else throw new TypeError('route().vias() takes true, false or { drill, size }')
  })
  def('rules', (r: Partial<AutoRouteParams>) => { p.auto = { ...(p.auto ?? {}), ...(r ?? {}) } })
  def('priority', (n: number) => { p.auto = { ...(p.auto ?? {}), priority: n } })
  def('net', (n: NetLike, nN?: NetLike) => {
    if (nN !== undefined && !p.pair) throw new TypeError('route().net(P, N) takes a second net for a differential pair only, a route with array ends')
    p.net = n
    if (nN !== undefined) p.netN = nN
  })
  def('neck', (spec: NeckSpec) => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError(`route().neck() takes { width?, length? }, got ${JSON.stringify(spec)}`)
    const bad = Object.keys(spec).find(k => k !== 'width' && k !== 'length')
    if (bad) throw new TypeError(`route().neck() takes { width?, length? }, got the field ${JSON.stringify(bad)}`)
    p.neck = { ...spec }
  })
  def('teardrops', (on: boolean | TeardropSpec) => {
    try { checkTeardrops(on, 'route().teardrops()') } catch (e) { throw new TypeError((e as Error).message) }
    p.teardrops = typeof on === 'boolean' ? on : { ...on }
  })
  def('corner', (r: Length | 'none') => {
    if (r !== 'none' && typeof r !== 'number' && typeof r !== 'string') throw new TypeError(`route().corner() takes a radius or 'none', got ${JSON.stringify(r)}`)
    p.corner = r
  })
  for (const k of ['lock', 'direct', 'loop'] as const)
    def(k, (on: boolean = true) => { if (typeof on !== 'boolean') throw new TypeError(`route().${k}() takes true or false`); if (on) p[k] = true; else delete p[k] })
  const pairOnly = (m: string) => { if (!p.pair) throw new TypeError(`route().${m}() is for a differential pair, a route with array ends such as route([J1.DP, J1.DN], [U1.DP, U1.DN])`) }
  def('gap', (g: Length) => { pairOnly('gap'); p.gap = g })
  def('skew', (s: Length) => { pairOnly('skew'); p.skew = s })
  def('impedance', (z: number) => {
    if (typeof z !== 'number' || !Number.isFinite(z) || z <= 0) throw new TypeError(`route().impedance() takes a positive number of ohms, got ${JSON.stringify(z)}`)
    p.impedance = z
  })
  def('length', (spec: Length | LengthSpec) => {
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      const keys = Object.keys(spec).filter(k => (spec as any)[k] !== undefined)
      const bad = keys.find(k => !['min', 'max', 'target', 'tolerance'].includes(k))
      if (bad) throw new TypeError(`route().length() takes a length or { min?, max?, target?, tolerance? }, got the field ${JSON.stringify(bad)}`)
      if (!keys.some(k => k !== 'tolerance')) throw new TypeError('route().length({ ... }) needs min, max or target')
      if ('target' in spec && spec.target !== undefined && (spec.min !== undefined || spec.max !== undefined)) throw new TypeError('route().length({ ... }) takes target with tolerance, or min and max, not both')
      p.length = { ...spec }
    } else if (typeof spec === 'number' || typeof spec === 'string') {
      if (typeof spec === 'number' && !(Number.isFinite(spec) && spec > 0)) throw new TypeError(`route().length() takes a positive length in mm, got ${JSON.stringify(spec)}`)
      p.length = spec
    } else throw new TypeError(`route().length() takes a length in mm or { min?, max?, target?, tolerance? }, got ${JSON.stringify(spec)}`)
  })
  def('match', (group: string, tolerance?: Length) => {
    if (typeof group !== 'string' || !group.trim()) throw new TypeError(`route().match() takes a group name, such as .match('DQ'), got ${JSON.stringify(group)}`)
    p.match = { group, ...(tolerance !== undefined ? { tolerance } : {}) }
  })
  chain(node, def)
  return node as RouteBuilder
}

/** Set on a route node by the compiler once it has read it: the fluent path is closed from then on. */
const COMPILED = Symbol.for('pcbjs.route.compiled')

/** One command of a `route(a)` chain: a route path step, or `to` a target, straight or automatic; the last is a `to`. */
export type ChainCommand = RouteStep | { op: 'to'; auto: boolean; target: unknown; src?: Src }

/** The `route(a)` chain methods; each command takes its source range from a following `__at(range)`, else from the stack. */
function chain(node: PcbNode, def: (name: string, f: (...a: any[]) => void) => void): void {
  const p = node.props
  const push = (name: string, c: ChainCommand) => {
    if ((node as any)[COMPILED]) throw new TypeError(`route().${name}(): the route is compiled already; write its chain before the board compiles`)
    if (p.path !== undefined) throw new TypeError(`route().${name}(): this route has the path string ${JSON.stringify(p.path)}; write the path as a string or as a chain, not both`)
    if (!p.chain) throw new TypeError(`route().${name}(): route(a, b) has its end already; a chain starts from one end, route(a).${name}(…)`)
    const src = stepSite(p.__src, name)
    ;(p.chain as ChainCommand[]).push(src ? { ...c, src } : c)
  }
  const len = (name: string, v: unknown, what: string): number => {
    let x = NaN
    try { x = mm(v as Length) } catch { /* reported below */ }
    if (!Number.isFinite(x)) throw new TypeError(`route().${name}() takes ${what}, a length in mm or with a unit such as '10mil', got ${JSON.stringify(v)}`)
    return x
  }
  def('L', (x: unknown, y: unknown) => push('L', { op: 'L', x: len('L', x, 'x'), y: len('L', y, 'y'), rel: false }))
  def('l', (x: unknown, y: unknown) => push('l', { op: 'L', x: len('l', x, 'dx'), y: len('l', y, 'dy'), rel: true }))
  def('H', (x: unknown) => push('H', { op: 'H', x: len('H', x, 'x'), rel: false }))
  def('h', (x: unknown) => push('h', { op: 'H', x: len('h', x, 'dx'), rel: true }))
  def('V', (y: unknown) => push('V', { op: 'V', y: len('V', y, 'y'), rel: false }))
  def('v', (y: unknown) => push('v', { op: 'V', y: len('v', y, 'dy'), rel: true }))
  def('via', (layer: unknown) => {
    if (typeof layer !== 'string' || !layer.trim()) throw new TypeError(`route().via() takes the layer to continue on, such as 'B.Cu', got ${JSON.stringify(layer)}`)
    push('via', { op: 'U', layer })
  })
  def('cross', (layer: unknown) => {
    if (!p.pair) throw new TypeError('route().cross() is for a differential pair, a route with array ends such as route([J1.DP, J1.DN])')
    if (typeof layer !== 'string' || !layer.trim()) throw new TypeError(`route().cross() takes the layer the pair continues on, such as 'B.Cu', got ${JSON.stringify(layer)}`)
    push('cross', { op: 'U', layer, cross: true })
  })
  for (const [name, auto] of [['Z', false], ['X', true]] as const) def(name, (target: unknown, ...more: unknown[]) => {
    if (target === undefined || more.some(m => !(isProps(m) && Object.keys(m).length === 1 && '__src' in m))) throw new TypeError(`route().${name}() takes one target: a pin or pad handle, a via, a "REF.PAD" string or a position such as '5 16' or [5, 16]`)
    push(name, { op: 'to', auto, target: Array.isArray(target) && pairEnds(target, 'chain') ? target.map(bare) : bare(target) })
  })
  // the transform appends `.__at({ file, line, col, endLine, endCol })` after each command
  def('__at', (src: unknown) => {
    const cmds: ChainCommand[] | undefined = p.chain
    const s = src as Src | undefined
    if (cmds?.length && s && typeof s.file === 'string' && typeof s.line === 'number' && typeof s.col === 'number')
      cmds[cmds.length - 1] = { ...cmds[cmds.length - 1], src: { file: s.file, line: s.line, col: s.col, ...(typeof s.endLine === 'number' && typeof s.endCol === 'number' ? { endLine: s.endLine, endCol: s.endCol } : {}) } }
  })
}

/** Where a chain command was called, spanning the method name, relative to the root like the route's `__src`. */
function stepSite(own: unknown, name: string): Src | undefined {
  const map = schematicRegistry().mapSrc
  const rel = (own as { file?: unknown } | undefined)?.file
  if (!map || typeof rel !== 'string') return undefined
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 12
  const stack = new Error().stack ?? ''
  Error.stackTraceLimit = limit
  for (const l of stack.split('\n').slice(1)) {
    const m = FRAME.exec(l)
    if (!m || !userFrame(m[1])) continue
    let f: Frame = { file: m[1], line: +m[2], col: +m[3] }
    try { f = map(f) } catch { /* keep the raw frame */ }
    if (!f.file.replace(/\\/g, '/').endsWith('/' + rel)) return undefined
    return { file: rel, line: f.line, col: f.col, endLine: f.line, endCol: f.col + name.length - 1 }
  }
  return undefined
}

const LENGTH = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*[a-zA-Z]*\s*$/
/** One end of a pair array: a pin or pad handle, a "REF.PIN" string, a coordinate string, a tuple or `{ at }`; not a length. */
const isEnd = (v: unknown) => isPinRef(v) || isViaNode(v) || Array.isArray(v) || (isProps(v) && 'at' in v) || (typeof v === 'string' && !LENGTH.test(v))
/** The ends of a pair, P first, or null for a coordinate tuple. */
function pairEnds(v: unknown, which: string): unknown[] | null {
  if (!Array.isArray(v) || v.length !== 2) return null
  const ends = v.map(bare)
  const n = ends.filter(isEnd).length
  if (n === 2) return ends
  if (n === 1) throw new TypeError(`route(a, b): the ${which} end ${JSON.stringify(v.map(e => (isPinRef(e) ? `pin ${e.pin}` : e)))} mixes a position and a length; a pair end is [P, N], two positions, and a coordinate is [x, y, layer?]`)
  return null
}

/** A track: `route(a)` chains to its last `.Z()` or `.X()`, `route(a, b, path?)` takes a route path, array ends make a pair. */
export function route(props: TrackProps): PcbNode
export function route(net: NetLike, opts: RouteOptions): PcbNode
export function route(a: Pos, b: Pos, path?: string): RouteBuilder
export function route(a: [Pos, Pos], b: [Pos, Pos], path?: string): RouteBuilder
export function route(a: Pos): RouteBuilder
export function route(a: [Pos, Pos]): RouteBuilder
export function route(a: unknown, ...rest: unknown[]): PcbNode {
  const src = withCall(takeSrc(rest))
  // the trailing { __src } the transform adds when the last argument is not an object literal
  const args = rest.filter(x => !(isProps(x) && !Array.isArray(x) && Object.keys(x).length === 1 && '__src' in x))
  if (!args.length && !src.__src && isProps(a) && !Array.isArray(a) && '__src' in a) {
    // route(a) through the transform: the range came inside the argument
    const own = withCall({ __src: (a as any).__src })
    const back = copied(a)
    if (back !== undefined) a = back
    Object.assign(src, own)
  }
  if (isOptions(a) && !args.length) return h('track', a as any)
  if ((typeof a === 'string' || isNet(a)) && isOptions(args[0])) return legacy(a as NetLike, strip(args[0]) as RouteOptions, src)
  if (!args.length) {
    const pa = Array.isArray(a) ? pairEnds(a, 'first') : null
    return builder(h('track', { from: pa ?? bare(a), ...(pa ? { pair: true } : {}), chain: [], ...src }))
  }
  if (args.length > 2) throw new TypeError('route(a, b, path?) takes two ends and an optional route path')
  const path = args[1]
  if (path !== undefined && typeof path !== 'string') throw new TypeError('route(a, b, path?): the route path must be a string such as \'V 14 U B.Cu XZ\'')
  const pa = pairEnds(a, 'first'), pb = pairEnds(args[0], 'second')
  if (!!pa !== !!pb) throw new TypeError(`route(a, b): ${pa ? 'a' : 'b'} is a pair end [P, N] but ${pa ? 'b' : 'a'} is a single end; a differential pair has arrays at both ends, route([aP, aN], [bP, bN], path?)`)
  if (pa && pb) return builder(h('track', { from: pa, to: pb, pair: true, ...(path !== undefined ? { path } : {}), ...src }))
  return builder(h('track', { from: bare(a), to: bare(args[0]), ...(path !== undefined ? { path } : {}), ...src }))
}

/** The argument of route(a) back from the transform's old `Object.assign({}, a, { __src })`, or undefined. */
function copied(a: unknown): any {
  if (!a || typeof a !== 'object' || Array.isArray(a) || isPinRef(a) || isViaNode(a) || !('__src' in a)) return undefined
  const keys = Object.keys(a).filter(k => k !== '__src')
  if (!keys.length || !keys.every((k, i) => k === String(i))) return undefined
  const vals = keys.map(k => (a as any)[k])
  return vals.length > 2 && vals.every(v => typeof v === 'string' && v.length === 1) ? vals.join('') : vals
}

function legacy(net: NetLike, o: RouteOptions, src: { __src?: unknown }): PcbNode {
  if (o.width === undefined) throw new TypeError('route(net, opts) needs a width')
  const layer = o.layer ?? o.layers?.[0] ?? 'F.Cu'
  const props: Record<string, any> = { net, layer, width: o.width, ...src }
  if (o.from !== undefined || o.to !== undefined) {
    if (o.from === undefined || o.to === undefined) throw new TypeError('route(net, opts) needs both from and to')
    if (typeof o.d === 'string') throw new TypeError('route(net, opts) takes from and to, or a path d, not both')
    const algorithm = o.algorithm ?? (typeof o.d === 'function' ? o.d : undefined)
    props.d = { start: o.from, end: o.to, ...(o.layers ? { layers: o.layers } : {}), ...(o.via ? { via: o.via } : {}), ...(algorithm ? { algorithm } : {}) }
  } else {
    if (o.layers) props.layers = o.layers
    if (o.via) props.via = o.via
    if (o.d !== undefined) props.d = o.d
    else if (o.algorithm !== undefined && typeof o.algorithm === 'function') props.d = o.algorithm
    else if (o.algorithm !== undefined) props.auto = { algorithm: o.algorithm }
    if (o.points) props.points = o.points
  }
  if (o.auto) props.auto = { ...(props.auto ?? {}), ...o.auto }
  return h('track', props)
}

/** A copper pour: `pour(GND, 'B.Cu', outline)`, or the object form `pour({ net: 'GND', layer: 'B.Cu', d: 'M 0 0 H 30 V 20 H 0 Z' })`. */
export function pour(props: ZoneProps): PcbNode
export function pour(net: NetLike, layer: string, d: string, opts?: PourOptions): PcbNode
export function pour(a: NetLike | ZoneProps, ...rest: unknown[]): PcbNode {
  if (isProps(a) && !rest.length) return h('zone', a as any)
  const [layer, d, opts] = rest
  if (typeof layer !== 'string' || typeof d !== 'string') throw new TypeError('pour(net, layer, d, opts?) needs a layer and a path')
  return h('zone', { ...strip(opts), net: a, layer, d, ...takeSrc(rest) })
}

/** A via, also a route end: `via(GND, '5mm 5mm')`, `via(J1.B6, at, SMALL)` or `via({ net, at })`. */
export function via(props: ViaProps): ViaNode
export function via(net: NetLike | PinRef, at: At, opts?: ViaOptions): ViaNode
export function via(a: NetLike | PinRef | ViaProps, ...rest: unknown[]): ViaNode {
  if (isProps(a) && !isPinRef(a) && !rest.length) return h('via', ((a as any).__src ? { ...a, ...withCall({ __src: (a as any).__src }) } : a) as any) as ViaNode
  const [at, opts] = rest
  if (at === undefined || isProps(at) && !Array.isArray(at)) throw new TypeError('via(net, at, opts?) needs a position')
  let net: unknown = a
  if (isPinRef(a)) {
    net = a.net
    if (isNC(net)) throw new TypeError(`via(${a.pad ?? a.pin}, at): the ${a.pad !== undefined ? 'pad' : 'pin'} is connected to NC, so the via has no net; give the net, via(net, at)`)
  }
  return h('via', { ...strip(opts), net, at, ...withCall(takeSrc(rest)) }) as ViaNode
}

/** Stitching vias from a net's pour fill: `stitch(GND, { pitch: 4 })` or `stitch({ net, pitch })`. */
export function stitch(props: StitchProps): PcbNode
export function stitch(net: NetLike, opts?: StitchOptions): PcbNode
export function stitch(a: NetLike | StitchProps, ...rest: unknown[]): PcbNode {
  // stitch(props) as the source-range transform passes it: stitch(props, { __src })
  if (isProps(a) && rest.every(r => isProps(r) && Object.keys(r).every(k => k === '__src'))) return h('stitch', { ...a, ...takeSrc(rest) } as any)
  return h('stitch', { ...strip(rest[0]), net: a, ...takeSrc(rest) })
}

export interface KeepoutOptions { tracks?: boolean; vias?: boolean; pours?: boolean; except?: NetLike[] }

/** A hard keepout: `keepout('B.Cu', d)`, `keepout('all', d, { pours: false })`; `except` lets those nets in. */
export function keepout(props: KeepoutProps): PcbNode
export function keepout(layers: string | string[], d: string, opts?: KeepoutOptions): PcbNode
export function keepout(a: string | string[] | KeepoutProps, ...rest: unknown[]): PcbNode {
  if (isProps(a) && !Array.isArray(a) && !rest.length) return h('keepout', a as any)
  const [d, opts] = rest
  if (typeof d !== 'string') throw new TypeError("keepout(layers, d, opts?) needs a path, such as keepout('B.Cu', 'M 0 0 H 5 V 5 H 0 Z')")
  const which = a === 'all' ? { layers: 'all' } : typeof a === 'string' ? { layer: a } : Array.isArray(a) ? { layers: [...a] } : null
  if (!which) throw new TypeError('keepout(layers, d): layers is a layer name, a list of layer names or "all"')
  return h('keepout', { ...strip(opts), ...which, d, ...takeSrc(rest) })
}

/** The built-in routing algorithms, usable as `algorithm` or as a whole-net `d`. */

export type { Child }
