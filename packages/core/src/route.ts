// The copper helpers, route(), pour(), via(), stitch() and keepout(), and the route builder with its chain.
import type {
  At,
  AutoRouteParams,
  Current,
  KeepoutOptions,
  Length,
  LengthSpec,
  NeckSpec,
  Net,
  TeardropSpec,
  PcbNode,
  PinRef,
  RouteEnd,
  PourOptions,
  RouteBuilder,
  RoutePoint,
  Rotation,
  Src,
  StitchOptions,
  ViaNode,
  ViaOptions,
} from './types.js'
import { isNC, isNet, isPinRef } from './nets.js'
import { NUM_RE, deg, mm, parseToken } from './units.js'
import type { RouteStep } from './model.js'
import { stackHere, userFrames, type Frame } from './provenance.js'
import { CHAIN, CHAIN_NAMES, isGeometric, type ChainSpec } from './syntax.js'
import { checkTeardrops } from './teardrop.js'
import { platform } from './platform.js'
import { realm } from './realm.js'

const isProps = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !isNet(v)
/** A via node, a route end: what `via()` returns. */
export const isViaNode = (v: unknown): v is ViaNode => !!v && typeof v === 'object' && (v as PcbNode).$$ === 'pcb' && (v as PcbNode).type === 'via'
/** The trailing `{ __src }` the source-range transform adds when the last argument is not an object literal. */
const srcOnly = (v: unknown) => isProps(v) && !Array.isArray(v) && Object.keys(v).length === 1 && '__src' in v
/** The `__src` the source-range transform adds to the last object argument, or to a trailing argument of its own. */
function takeSrc(args: unknown[]): { __src?: unknown } {
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i] as any
    if (a && typeof a === 'object' && a.__src) return { __src: a.__src }
  }
  return {}
}
const strip = (o: unknown): Record<string, any> => {
  if (!isProps(o)) return {}
  const { __src: _, ...rest } = o
  return rest
}
/** A position without the `__src` the transform may have put into it. */
const bare = (v: unknown): unknown => (isProps(v) && !Array.isArray(v) && !isPinRef(v) && !isViaNode(v) && '__src' in v ? strip(v) : v)
/** A node of a copper helper; the helpers are the only way to make these, JSX has no element for them. */
const node = (type: string, props: Record<string, any>): PcbNode => ({ $$: 'pcb', type, props, children: [] })

/** Vite's mapping of a frame in Node; a platform that maps frames has mapped them already. */
const frameMap = (): ((f: Frame) => Frame) | undefined => realm().mapSrc ?? (platform().frame ? f => f : undefined)
/** Where the helper that made a route was called from, by the stack past the innermost function around the call; undefined inline or without a source mapper. */
function callSite(src: unknown): Frame | undefined {
  const s = src as { file?: unknown; line?: unknown; endLine?: unknown; fn?: { line?: unknown; endLine?: unknown } } | undefined
  const map = frameMap()
  if (!map || !s || typeof s.file !== 'string' || typeof s.line !== 'number') return undefined
  const first = s.line,
    last = typeof s.endLine === 'number' ? s.endLine : first
  const fn = s.fn && typeof s.fn.line === 'number' && typeof s.fn.endLine === 'number' ? { line: s.fn.line, endLine: s.fn.endLine } : undefined
  const raw = userFrames(stackHere(60))
  // mapping goes through Vite's stack rewriting, so only the frames looked at are mapped
  const mapped = new Map<number, Frame>()
  const at = (k: number): Frame | undefined => {
    if (k >= raw.length) return undefined
    let v = mapped.get(k)
    if (!v) {
      try {
        v = map(raw[k])
      } catch {
        v = raw[k]
      }
      mapped.set(k, v)
    }
    return v
  }
  // a file outside the root, `../lib/wire.ts`, leaves the root unknown, so the call site keeps its absolute path
  const rel = s.file.replace(/^(?:\.\.\/)+/, '')
  const outside = rel !== s.file
  let i = 0
  for (; i < Math.min(raw.length, 4); i++) {
    const f = at(i)!
    if (f.file.replace(/\\/g, '/').endsWith('/' + rel) && f.line >= first && f.line <= last) break
  }
  if (i >= Math.min(raw.length, 4)) return undefined
  const own = at(i)!,
    root = outside ? '\0' : own.file.slice(0, own.file.length - rel.length)
  const entry = at(raw.length - 1)!.file
  let up: Frame | undefined
  for (let k = i + 1; k < raw.length && k < i + 24; k++) {
    const f = at(k)!
    if (f.file !== own.file) {
      up = f
      break
    }
    if (own.file !== entry) continue
    // in the entry, frames inside the helper are its callbacks; the first one outside is the call
    if (fn) {
      if (f.line < fn.line || f.line > fn.endLine) {
        up = f
        break
      }
      continue
    }
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
function builder(n: PcbNode): RouteBuilder {
  const p = n.props
  const def = (name: string, f: (...a: any[]) => void) =>
    Object.defineProperty(n, name, {
      value: (...a: any[]) => {
        f(...a)
        return n
      },
      enumerable: false,
      configurable: true,
    })
  def('layer', (l: string) => {
    p.layer = l
  })
  def('layers', (ls: string[]) => {
    if (!Array.isArray(ls)) throw new TypeError('route().layers() takes a list of layer names')
    p.layers = [...ls]
  })
  def('vias', (v: false | { drill?: Length; size?: Length }) => {
    if (v === false) p.auto = { ...(p.auto ?? {}), maxVias: 0 }
    else if (v && typeof v === 'object' && !Array.isArray(v)) p.via = { ...v }
    else throw new TypeError(`route().vias() takes false or { drill, size }, got ${JSON.stringify(v)}`)
  })
  def('rules', (r: Partial<AutoRouteParams>) => {
    const own = (['layers', 'via', 'priority'] as const).find(k => r && k in r)
    if (own) throw new TypeError(`route().rules() takes no ${own}; it has its own method, .${own === 'via' ? 'vias({ drill, size })' : `${own}(…)`}`)
    if (r && r.maxVias === 0) throw new TypeError('route().rules({ maxVias: 0 }): forbid vias with .vias(false)')
    p.auto = { ...(p.auto ?? {}), ...(r ?? {}) }
  })
  def('priority', (k: number) => {
    p.auto = { ...(p.auto ?? {}), priority: k }
  })
  def('net', (v: Net | null, vN?: Net) => {
    if (vN !== undefined && !p.pair) throw new TypeError('route().net(P, N) takes a second net for a differential pair only, a route with array ends')
    if (v === undefined) throw new TypeError('route().net() takes a net, or null for copper on no net')
    p.net = v
    if (vN !== undefined) p.netN = vN
  })
  def('root', (end: unknown) => {
    if (!p.whole) throw new TypeError('route().root() names the root of route(NET), which routes every pad of the net; route(a, b, …) starts at a')
    p.root = bare(end)
  })
  def('neck', (spec: NeckSpec) => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError(`route().neck() takes { width?, length? }, got ${JSON.stringify(spec)}`)
    const bad = Object.keys(spec).find(k => k !== 'width' && k !== 'length')
    if (bad) throw new TypeError(`route().neck() takes { width?, length? }, got the field ${JSON.stringify(bad)}`)
    p.neck = { ...spec }
  })
  def('teardrops', (on: boolean | TeardropSpec) => {
    try {
      checkTeardrops(on, 'route().teardrops()')
    } catch (e) {
      throw new TypeError((e as Error).message)
    }
    p.teardrops = typeof on === 'boolean' ? on : { ...on }
  })
  def('corner', (r: Length | 'none') => {
    if (r !== 'none' && typeof r !== 'number' && typeof r !== 'string') throw new TypeError(`route().corner() takes a radius or 'none', got ${JSON.stringify(r)}`)
    p.corner = r
  })
  const point = (pt: number | 'end'): RoutePoint => Object.freeze({ $$: 'route-pt' as const, route: n as RouteBuilder, pt })
  Object.defineProperty(n, 'start', { get: () => point(0), enumerable: false, configurable: true })
  Object.defineProperty(n, 'end', { get: () => point('end'), enumerable: false, configurable: true })
  Object.defineProperty(n, 'pt', {
    value: (k: number) => {
      if (!Number.isInteger(k) || k < 0) throw new TypeError(`route().pt(k) takes a whole number, 0 the start and k where the k-th chain call ends, got ${JSON.stringify(k)}`)
      return point(k)
    },
    enumerable: false,
    configurable: true,
  })
  for (const k of ['direct', 'loop'] as const)
    def(k, (on: boolean = true) => {
      if (typeof on !== 'boolean') throw new TypeError(`route().${k}() takes true or false`)
      if (on) p[k] = true
      else delete p[k]
    })
  const pairOnly = (m: string) => {
    if (!p.pair) throw new TypeError(`route().${m}() is for a differential pair, a route with array ends such as route([J1.DP, J1.DN], [U1.DP, U1.DN])`)
  }
  def('gap', (g: Length) => {
    pairOnly('gap')
    p.gap = g
  })
  def('skew', (s: Length) => {
    pairOnly('skew')
    p.skew = s
  })
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
      if ('target' in spec && spec.target !== undefined && (spec.min !== undefined || spec.max !== undefined))
        throw new TypeError('route().length({ ... }) takes target with tolerance, or min and max, not both')
      p.length = { ...spec }
    } else if (typeof spec === 'number' || typeof spec === 'string') {
      if (typeof spec === 'number' && !(Number.isFinite(spec) && spec > 0)) throw new TypeError(`route().length() takes a positive length in mm, got ${JSON.stringify(spec)}`)
      p.length = spec
    } else throw new TypeError(`route().length() takes a length in mm or { min?, max?, target?, tolerance? }, got ${JSON.stringify(spec)}`)
  })
  def('current', (a: Current) => {
    p.current = amps(a, 'route().current()')
  })
  def('solver', (fn: unknown) => {
    if (typeof fn !== 'function') throw new TypeError('route().solver() takes a function (request, ctx) => { tracks, vias } or null')
    if (p.pair) throw new TypeError('route().solver(): a differential pair is laid out by the router; a solver takes single routes')
    p.solver = fn
  })
  def('topology', () => {
    throw new TypeError('route().topology() is reserved: fly-by, star and other bus topologies arrive with beta3')
  })
  def('match', (group: string, tolerance?: Length) => {
    if (typeof group !== 'string' || !group.trim()) throw new TypeError(`route().match() takes a group name, such as .match('DQ'), got ${JSON.stringify(group)}`)
    p.match = { group, ...(tolerance !== undefined ? { tolerance } : {}) }
  })
  chain(n, p, p.chain, def, w => {
    p.width = w
  })
  // the transform appends `.__at({ file, line, col, endLine, endCol })` after each command
  def('__at', (src: unknown) => {
    const cmds: ChainCommand[] = p.chain
    const s = src as Src | undefined
    if (cmds.length && s && typeof s.file === 'string' && typeof s.line === 'number' && typeof s.col === 'number')
      cmds[cmds.length - 1] = {
        ...cmds[cmds.length - 1],
        src: {
          file: s.file,
          line: s.line,
          col: s.col,
          ...(typeof s.endLine === 'number' && typeof s.endCol === 'number' ? { endLine: s.endLine, endCol: s.endCol } : {}),
          ...(typeof s.hash === 'string' ? { hash: s.hash } : {}),
        },
      }
  })
  return n as RouteBuilder
}

/** Set on a route node by the compiler once it has read it: the fluent path is closed from then on. */
const COMPILED = Symbol.for('pcbjs.route.compiled')

/** One command of a chain as written: a step, a waypoint still to resolve, a width from here on, a branch, or the finish `Z` or `XZ`. */
export type ChainCommand =
  | Exclude<RouteStep, { op: 'W' | 'B' }>
  | { op: 'to'; auto: boolean; target: unknown; src?: Src }
  | { op: 'W'; width: Length; src?: Src }
  | { op: 'branch'; end: unknown; chain: ChainCommand[]; width?: Length; current?: number; src?: Src }

/** The chain methods on `obj`, a route node or a branch, writing `cmds`; `setWidth` takes a width given before any command. */
function chain(obj: object, p: Record<string, any>, cmds: ChainCommand[], def: (name: string, f: (...a: any[]) => void) => void, setWidth: (w: Length) => void): void {
  const push = (name: string, c: ChainCommand) => {
    if ((p as any)[COMPILED] || (obj as any)[COMPILED]) throw new TypeError(`route().${name}(): the route is compiled already; write its chain before the board compiles`)
    const last = cmds[cmds.length - 1]
    if (last && (last.op === 'Z' || last.op === 'XZ'))
      throw new TypeError(`route().${name}(): the chain ended at .${last.op === 'Z' ? 'Z' : 'X'}() already; a command after the finish has no place to go`)
    const src = stepSite(p.__src, name)
    cmds.push(src ? { ...c, src } : c)
  }
  const len = (name: string, v: unknown, what: string): number => {
    let x = NaN
    try {
      x = mm(v as Length)
    } catch {
      /* reported below */
    }
    if (!Number.isFinite(x)) throw new TypeError(`route().${name}() takes ${what}, a length in mm or with a unit such as '10mil', got ${JSON.stringify(v)}`)
    return x
  }
  const angle = (name: string, v: unknown): number => {
    let x = NaN
    try {
      x = deg(v as Rotation)
    } catch {
      /* reported below */
    }
    if (!Number.isFinite(x) || x === 0 || Math.abs(x) >= 360)
      throw new TypeError(`route().${name}() takes the angle the arc turns through, in degrees or such as '1.2rad', not 0 and less than a full turn, got ${JSON.stringify(v)}`)
    return x
  }
  def('width', (w: Length) => {
    if (w === undefined || (typeof w !== 'number' && typeof w !== 'string')) throw new TypeError(`route().width() takes a length, got ${JSON.stringify(w)}`)
    if (cmds.length) push('width', { op: 'W', width: w })
    else setWidth(w)
  })
  for (const name of CHAIN_NAMES.filter(isGeometric)) {
    const c: ChainSpec = CHAIN[name]
    def(name, (...args: unknown[]) => {
      const own = args.filter(a => !srcOnly(a))
      if (c.waypoint && own.length < 2) return push(name, { op: 'to', auto: false, target: waypoint(name, own[0]) })
      const step: Record<string, unknown> = { op: c.op }
      c.fields.forEach((f, i) => (step[f] = c.args[i] === 'angle' ? angle(name, own[i]) : len(name, own[i], c.rel ? `d${f}` : f)))
      push(name, { ...step, rel: c.rel } as ChainCommand)
    })
  }
  def('via', (layer: unknown, ...rest: unknown[]) => {
    if (typeof layer !== 'string' || !layer.trim()) throw new TypeError(`route().via() takes the layer to continue on, such as 'B.Cu', got ${JSON.stringify(layer)}`)
    const given = rest.find(r => !srcOnly(r))
    const o = given === undefined ? undefined : (strip(given) as { drill?: unknown; size?: unknown })
    if (given !== undefined && (!isProps(given) || Array.isArray(given) || Object.keys(o!).some(k => k !== 'drill' && k !== 'size')))
      throw new TypeError(`route().via(layer, { drill, size }) takes the via's drill and copper size, got ${JSON.stringify(given)}`)
    const drill = o?.drill !== undefined ? { drill: len('via', o.drill, 'the drill') } : {}
    const size = o?.size !== undefined ? { size: len('via', o.size, 'the size') } : {}
    push('via', { op: 'U', layer, ...drill, ...size })
  })
  def('cross', (layer: unknown) => {
    if (!p.pair) throw new TypeError('route().cross() is for a differential pair, a route with array ends such as route([J1.DP, J1.DN], [U1.DP, U1.DN])')
    if (typeof layer !== 'string' || !layer.trim()) throw new TypeError(`route().cross() takes the layer the pair continues on, such as 'B.Cu', got ${JSON.stringify(layer)}`)
    push('cross', { op: 'U', layer, cross: true })
  })
  def('Z', (...args: unknown[]) => {
    if (args.some(a => !srcOnly(a)))
      throw new TypeError("route().Z() takes no target: it runs straight to the route's end, the next argument of route(a, b); a straight track to a point is .L(p)")
    push('Z', { op: 'Z' })
  })
  def('X', (...args: unknown[]) => {
    const own = args.filter(a => !srcOnly(a))
    if (own.length > 1) throw new TypeError('route().X() takes one waypoint, or nothing for an automatic leg to the end')
    if (own.length) push('X', { op: 'to', auto: true, target: waypoint('X', own[0]) })
    else push('X', { op: 'XZ' })
  })
  def('branch', (...fns: unknown[]) => {
    if (p.pair) throw new TypeError('route().branch(): a differential pair has no branches')
    if (!fns.length || fns.some(f => typeof f !== 'function')) throw new TypeError('route().branch() takes sub-chains, such as .branch(b => b(R2[1]).V(2).Z())')
    for (const f of fns as ((b: (end: unknown) => unknown) => unknown)[]) {
      const made: { cmd: ChainCommand & { op: 'branch' }; obj: object }[] = []
      const b = (end: unknown) => {
        if (end === undefined || isNet(end))
          throw new TypeError(
            'route().branch(b => b(end)…): a branch runs to an end, a pin or pad handle, a via or a position; joining the net anywhere is a route of its own, route(a, NET)',
          )
        if (Array.isArray(end) && pairEnds(end, 'branch')) throw new TypeError('route().branch(): a branch runs to one end, not a pair')
        const cmd = { op: 'branch' as const, end: bare(end), chain: [] as ChainCommand[] }
        const obj: Record<string, unknown> = {}
        const own = (name: string, g: (...a: any[]) => void) =>
          Object.defineProperty(obj, name, {
            value: (...a: any[]) => {
              g(...a)
              return obj
            },
            enumerable: false,
          })
        chain(obj, p, cmd.chain, own, w => {
          ;(cmd as { width?: Length }).width = w
        })
        own('current', (a: Current) => {
          ;(cmd as { current?: number }).current = amps(a, 'branch().current()')
        })
        made.push({ cmd, obj })
        return obj
      }
      const got = f(b)
      if (made.length !== 1 || got !== made[0].obj) throw new TypeError('route().branch(b => …) returns the one sub-chain it makes, b(end) and its commands')
      push('branch', made[0].cmd)
    }
  })
}

/** A current in amps: a number, or a string in A or mA. */
function amps(v: unknown, what: string): number {
  const m = typeof v === 'string' ? /^\s*(\d+\.?\d*|\.\d+)\s*(A|mA)?\s*$/.exec(v) : null
  const a = typeof v === 'number' ? v : m ? parseFloat(m[1]) * (m[2] === 'mA' ? 1e-3 : 1) : NaN
  if (!(Number.isFinite(a) && a > 0)) throw new TypeError(`${what} takes a positive current in amps, such as 2, '2A' or '500mA', got ${JSON.stringify(v)}`)
  return a
}

/** A waypoint of `.L(p)` or `.X(p)`: a coordinate or a via; a pin, a pad or a net is an end of the route. */
function waypoint(name: string, q: unknown): unknown {
  if (isPinRef(q) || isNet(q) || (Array.isArray(q) && pairEnds(q, 'waypoint')))
    throw new TypeError(`route().${name}(p): a waypoint is a position such as '5 16' or a via; a pin, a pad, a pair or a net is an end, an argument of route(a, b, …)`)
  if (q === undefined) throw new TypeError(`route().${name}() takes a waypoint, such as '5 16'`)
  return bare(q)
}

/** Where a chain command was called, spanning the method name, relative to the root like the route's `__src`. */
function stepSite(own: unknown, name: string): Src | undefined {
  const map = frameMap()
  const rel = (own as { file?: unknown } | undefined)?.file
  if (!map || typeof rel !== 'string') return undefined
  for (const raw of userFrames(stackHere(12))) {
    let f = raw
    try {
      f = map(f)
    } catch {
      /* keep the raw frame */
    }
    if (!f.file.replace(/\\/g, '/').endsWith('/' + rel)) return undefined
    return { file: rel, line: f.line, col: f.col, endLine: f.line, endCol: f.col + name.length - 1 }
  }
  return undefined
}

/** One end of a pair array: a pin or pad handle, a coordinate string, a tuple or `{ at }`; not a length. */
const isEnd = (v: unknown) => isPinRef(v) || isViaNode(v) || Array.isArray(v) || (isProps(v) && 'at' in v) || (typeof v === 'string' && !parseToken(v))
/** The ends of a pair, P first, or null for a coordinate tuple. */
function pairEnds(v: unknown, which: string): unknown[] | null {
  if (!Array.isArray(v) || v.length !== 2) return null
  const ends = v.map(bare)
  const n = ends.filter(isEnd).length
  if (n === 2) return ends
  if (n === 1)
    throw new TypeError(
      `route(a, b): the ${which} end ${JSON.stringify(v.map(e => (isPinRef(e) ? `pin ${e.pin}` : e)))} mixes a position and a length; a pair end is [P, N], two positions, and a coordinate is [x, y, layer?]`,
    )
  return null
}

/** A route: `route(a, b, …)` from the first end, the root, to each other end; `route(NET)` every pad of a net; `route(coord).net(n)` drawn copper; array ends make a pair. */
export function route(net: Net): RouteBuilder
export function route(a: RouteEnd, ...ends: (RouteEnd | Net)[]): RouteBuilder
export function route(a: [RouteEnd, RouteEnd], b: [RouteEnd, RouteEnd]): RouteBuilder
export function route(a: unknown, ...rest: unknown[]): RouteBuilder {
  let src = withCall(takeSrc(rest))
  const ends = rest.filter(x => !srcOnly(x)).map(bare)
  if (!ends.length && !src.__src && isProps(a) && !Array.isArray(a) && !isPinRef(a) && !isViaNode(a) && '__src' in a) src = withCall({ __src: (a as any).__src })
  a = bare(a)
  if (a === undefined) throw new TypeError('route() takes its ends, route(a, b), or a net, route(NET)')
  if (isNet(a)) {
    if (ends.length) throw new TypeError('route(NET) routes every pad of the net; to join one end to the copper of the net, put the net last, route(end, NET)')
    return builder(node('track', { net: a, whole: true, chain: [], ...src }))
  }
  const pa = Array.isArray(a) ? pairEnds(a, 'first') : null
  if (pa) {
    const pb = ends.length === 1 ? pairEnds(ends[0], 'second') : null
    if (!pb)
      throw new TypeError(
        ends.length === 1
          ? 'route(a, b): a is a pair end [P, N] but b is a single end; a differential pair has arrays at both ends, route([aP, aN], [bP, bN])'
          : `route([aP, aN], [bP, bN]): a differential pair has two pair ends, got ${ends.length + 1}`,
      )
    return builder(node('track', { from: pa, ends: [pb], pair: true, chain: [], ...src }))
  }
  ends.forEach((e, i) => {
    if (Array.isArray(e) && pairEnds(e, i ? 'next' : 'second'))
      throw new TypeError('route(a, b): b is a pair end [P, N] but a is a single end; a differential pair has arrays at both ends, route([aP, aN], [bP, bN])')
    if (isNet(e) && (i !== 0 || ends.length > 1)) throw new TypeError('route(a, NET): a net as an end joins its copper anywhere, so it is the only end after the first')
    if (e === undefined || e === null) throw new TypeError(`route(a, b, …): end ${i + 2} is ${e}`)
    if (typeof e === 'string' && /\s/.test(e.trim()) && !NUM_RE.test(e.trim()))
      throw new TypeError(`route(a, b, …): ${JSON.stringify(e)} is no end; a chain is written with its methods, such as route(a, b).V(14).H(9).Z()`)
  })
  return builder(node('track', { from: a, ends, chain: [], ...src }))
}

/** A copper pour: `pour(GND, 'B.Cu', rect(30, 20))`; `null` for copper on no net, which fills what no net claims. */
export function pour(net: Net | null, layer: string, area: string, opts?: PourOptions): PcbNode
export function pour(net: unknown, ...rest: unknown[]): PcbNode {
  const [layer, area, opts] = rest.filter(x => !srcOnly(x))
  if (net === undefined || (isProps(net) && !isNet(net))) throw new TypeError('pour(net, layer, area, opts?) takes the net first, null for a pour on no net')
  if (typeof layer !== 'string' || typeof area !== 'string') throw new TypeError("pour(net, layer, area, opts?) needs a layer and an area, such as pour(GND, 'B.Cu', rect(30, 20))")
  return node('zone', { ...strip(opts), ...(net !== null ? { net } : {}), layer, d: area, ...takeSrc(rest) })
}

/** A via, also a route end: `via(GND, '5mm 5mm')`, `via(J1.B6, at, SMALL)`; `null` for a via on no net. */
export function via(net: Net | PinRef | null, at: At, opts?: ViaOptions): ViaNode
export function via(a: unknown, ...rest: unknown[]): ViaNode {
  const [at, opts] = rest.filter(x => !srcOnly(x))
  if (a === undefined || (isProps(a) && !isPinRef(a) && !isNet(a))) throw new TypeError('via(net, at, opts?) takes the net first, null for a via on no net')
  if (at === undefined || (isProps(at) && !Array.isArray(at))) throw new TypeError('via(net, at, opts?) needs a position')
  let net: unknown = a
  if (isPinRef(a)) {
    net = a.net
    if (isNC(net))
      throw new TypeError(`via(${a.pad ?? a.pin}, at): the ${a.pad !== undefined ? 'pad' : 'pin'} is connected to NC, so the via has no net; give the net, via(net, at), or null`)
  }
  return node('via', { ...strip(opts), ...(net !== null ? { net } : {}), at, ...withCall(takeSrc(rest)) }) as ViaNode
}

/** Stitching vias from a net's pour fill: `stitch(GND, { pitch: 4 })`. */
export function stitch(net: Net, opts?: StitchOptions): PcbNode
export function stitch(net: unknown, ...rest: unknown[]): PcbNode {
  if (net === undefined || net === null || (isProps(net) && !isNet(net) && !isPinRef(net))) throw new TypeError('stitch(net, opts?) takes the net of the pour it stitches first')
  return node('stitch', { ...strip(rest.filter(x => !srcOnly(x))[0]), net, ...takeSrc(rest) })
}

/** A hard keepout: `keepout(circle(6, 20, 10), { layers: ['B.Cu'] })` on every copper layer unless `layers`; `except` lets those nets in. */
export function keepout(area: string, opts?: KeepoutOptions): PcbNode
export function keepout(area: unknown, ...rest: unknown[]): PcbNode {
  if (typeof area !== 'string')
    throw new TypeError(
      `keepout(area, opts?) takes the area first, an SVG path such as rect(5, 5), with layers in the options, keepout(area, { layers: ['B.Cu'] }), got ${JSON.stringify(area)}`,
    )
  const given = rest.filter(x => !srcOnly(x))
  if (given.length > 1 || (given.length && !isProps(given[0])))
    throw new TypeError(`keepout(area, opts?) takes the area first and the options second, with layers in them, keepout(area, { layers: ['B.Cu'] })`)
  const o = strip(given[0])
  if (o.layers !== undefined && (!Array.isArray(o.layers) || !o.layers.length || o.layers.some((l: unknown) => typeof l !== 'string')))
    throw new TypeError(`keepout(area, { layers }): layers is a list of copper layer names, such as ['B.Cu'], or left out for every one, got ${JSON.stringify(o.layers)}`)
  return node('keepout', { ...o, d: area, ...takeSrc(rest) })
}
