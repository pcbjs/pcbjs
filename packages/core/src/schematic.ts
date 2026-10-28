// State lives on globalThis and values are recognised by their `$$` brand, never instanceof: the CLI's copy compiles what Vite's copy made.
import { h } from './jsx-runtime.js'
import type {
  Child,
  Component,
  Connection,
  Rules,
  FootprintFactory,
  Length,
  Net,
  NetRules,
  NoConnect,
  Part,
  PartOptions,
  PartRules,
  PcbNode,
  PinList,
  PinRef,
  SourcingSpec,
  Src,
} from './types.js'
import { mm } from './units.js'
import { clearanceValue, mergeClearance } from './clearance.js'
import type { KindClearanceMM } from './model.js'
import { anchorModel, childList, isNode } from './jsx-runtime.js'

const NET_META = Symbol.for('pcbjs.net.meta')
const PART_STATE = Symbol.for('pcbjs.part.state')
const REGISTRY = Symbol.for('pcbjs.schematic')

/** A mistake in the schematic, thrown where it is made: a wrong pin count, an unknown pin, a pin connected twice. */
export class SchematicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchematicError'
  }
}

/** True for a SchematicError from any copy of this module. */
export const isSchematicError = (e: unknown): e is SchematicError => !!e && typeof e === 'object' && (e as Error).name === 'SchematicError'

interface NetMeta {
  seq: number
  scope: string | InstanceState | null
  rules?: { clearance?: number | KindClearanceMM }
}

/** The keys of PartRules, the rule overrides of a part. */
export const PART_RULE_KEYS = ['clearance', 'edgeClearance', 'holeClearance', 'trackWidth', 'thermal'] as const
export type PartRuleKey = (typeof PART_RULE_KEYS)[number]
/** Rule overrides in mm: `clearance` a length or one per kind of the other item, `thermal` the spoke angle, the rest lengths. */
export type RuleSet<K extends string> = { [P in K]?: P extends 'clearance' ? number | KindClearanceMM : P extends 'thermal' ? { angle?: 90 | 45 } : number }

/** Rule overrides of a lower level merged with an upper one's, key by key; two clearance objects merge kind by kind. */
export function mergeRuleSets<K extends string>(lower: RuleSet<K>, upper: RuleSet<K> | undefined): RuleSet<K> {
  const out: Record<string, unknown> = { ...lower }
  for (const [k, v] of Object.entries(upper ?? {})) {
    if (v === undefined) continue
    out[k] =
      k === 'clearance' ? mergeClearance(out[k] as number | object | undefined, v as number | object) : k === 'thermal' ? { ...((out[k] as object) ?? {}), ...(v as object) } : v
  }
  return out as RuleSet<K>
}

/** Rule overrides checked and in mm: keys among `keys`, non-negative lengths, a positive track width; throws naming `where`. */
export function ruleOverrides<K extends string>(v: unknown, keys: readonly K[], where: string, self = true): RuleSet<K> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error(`${where} must be an object such as { clearance: 0.2 }, got ${v === null ? 'null' : Array.isArray(v) ? 'an array' : JSON.stringify(v)}`)
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k === '__src' || x === undefined) continue
    if (!(keys as readonly string[]).includes(k)) throw new Error(`${where}: unknown rule ${JSON.stringify(k)}; it takes ${keys.join(', ')}`)
    if (k === 'clearance') {
      out[k] = clearanceValue(x, where, self)
      continue
    }
    if (k === 'thermal') {
      out[k] = thermalRule(x, where)
      continue
    }
    let n: number
    try {
      n = mm(x as Length)
    } catch (e) {
      throw new Error(`${where}: ${k}: ${(e as Error).message}`)
    }
    if (!(Number.isFinite(n) && (k === 'trackWidth' ? n > 0 : n >= 0)))
      throw new Error(`${where}: ${k} must be a ${k === 'trackWidth' ? 'positive' : 'non-negative'} length, got ${JSON.stringify(x)}`)
    out[k] = n
  }
  return out as RuleSet<K>
}

/** A part's thermal rule, `{ angle: 45 }`. */
function thermalRule(x: unknown, where: string): { angle?: 90 | 45 } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`${where}: thermal must be an object such as { angle: 45 }, got ${JSON.stringify(x)}`)
  const out: { angle?: 90 | 45 } = {}
  for (const [k, a] of Object.entries(x)) {
    if (a === undefined) continue
    if (k !== 'angle') throw new Error(`${where}: thermal has an unknown field ${JSON.stringify(k)}; it takes angle`)
    if (a !== 90 && a !== 45) throw new Error(`${where}: thermal angle must be 90 or 45, got ${JSON.stringify(a)}`)
    out.angle = a
  }
  return out
}

/** What the compiler knows about a part. Internal, reached through `partOf`. */
export interface PartState {
  seq: number
  footprint: Component
  /** footprint props every placement gets */
  props: Record<string, any>
  value?: string
  pins: string[]
  /** pads left unconnected on purpose: no net, no pin, no ERC */
  nc: Set<string>
  prefix: string
  /** the footprint id for the netlist of an unplaced part */
  footprintId: string
  conn: Map<string, Connection>
  explicitRef?: string
  /** the ref from the module-level binding, `const R1 = …`, and where that name is */
  boundRef?: string
  boundSrc?: Src
  src?: Src
  /** created inside a component while a board rendered */
  render: boolean
  /** for messages, such as R0603("330") */
  label: string
  part: Part<any>
  /** sourcing keys of the part options */
  source: Record<string, string>
  /** sourcing keys of `.source()` calls, merged in call order */
  sourced: Record<string, string>
  /** `.rules()` overrides in mm, merged in call order */
  rules: RuleSet<PartRuleKey>
  /** the owning circuit instance, and the part's key there, `R1` for Buck1.R1 */
  owner?: InstanceState
  key?: string
  /** the declaring file: its own, or that of its outermost circuit instance */
  declFile?: string
}

/** What the compiler knows about a circuit instance; name and path are read at compile time, since a parent may adopt it under a key. */
export interface InstanceState {
  seq: number
  circuit: string
  /** null for the object form */
  def: object | null
  name: string
  explicitName: boolean
  parent: InstanceState | null
  /** parts and child instances in key order */
  members: Map<string, PartState | InstanceState>
  ports: Record<string, Connection>
  /** made by a build with ports: its parts connect only to its ports and private nets */
  form: 'build' | 'object'
  src?: Src
  /** the file of the call that made the outermost instance */
  declFile?: string
  instance: any
  nets: Record<string, Net>
  /** made while its build ran; each must come back under a key */
  made: (PartState | InstanceState)[]
}

/** The path of an instance, outermost first. */
export function instancePath(i: InstanceState): string[] {
  const out: string[] = []
  for (let x: InstanceState | null = i; x; x = x.parent) out.unshift(x.name)
  return out
}
/** The outermost instance an instance belongs to. */
export function topInstance(i: InstanceState): InstanceState {
  let x = i
  while (x.parent) x = x.parent
  return x
}
/** Every part of an instance and of its descendants, in key order. */
export function instanceParts(i: InstanceState): PartState[] {
  const out: PartState[] = []
  for (const m of i.members.values())
    if (isInstanceState(m)) out.push(...instanceParts(m))
    else out.push(m)
  return out
}
export const isInstanceState = (m: PartState | InstanceState): m is InstanceState => 'members' in m

/** An out-of-line `source()` call: for some parts, or for every part a factory makes with one value. */
interface SourceRule {
  seq: number
  parts?: Set<PartState>
  factory?: Component
  value?: string
  spec: Record<string, string>
  src?: Src
}

interface RenderScope {
  stack: string[]
  counts: Map<string, number>
  rules?: Readonly<Rules>
}
interface Registry {
  seq: number
  netSeq: number
  /** advanced every compile; a module evaluated again starts its parts in a newer epoch */
  epoch: number
  localCount: number
  parts: PartState[]
  fileEpoch: Map<string, number>
  /** out-of-line source() calls, replaced per file like the parts */
  sources: SourceRule[]
  sourceEpoch: Map<string, number>
  render: RenderScope | null
  /** running circuit builds, innermost last */
  building: InstanceState[]
  /** instances made outside any build, replaced per file like the parts */
  instances: InstanceState[]
  instanceEpoch: Map<string, number>
  /** maps evaluated code back to source; set by the dev server and the build, which hold the source maps */
  mapSrc: ((src: Src) => Src) | null
}
function registry(): Registry {
  const g = globalThis as any
  const r = (g[REGISTRY] ??= { seq: 0, netSeq: 0, epoch: 0, localCount: 0, parts: [], fileEpoch: new Map(), render: null, mapSrc: null })
  // a registry from an older copy of this module lacks these lists
  r.sources ??= []
  r.sourceEpoch ??= new Map()
  r.building ??= []
  r.instances ??= []
  r.instanceEpoch ??= new Map()
  return r
}

/** A ref name a variable may give its part: capital letters, then digits, `R1` or `LED12`. */
export const BOUND_REF = /^[A-Z]+[0-9]+$/

/** Called by the source-range transform for a module-level `const R1 = …`: a part made at module level takes the name as its ref, first name wins. */
export function bindRef<T>(value: T, name: string, src?: Src): T {
  if (typeof name !== 'string' || !BOUND_REF.test(name)) return value
  const st = partOf(value)
  if (!st || st.owner || st.render || st.boundRef !== undefined) return value
  st.boundRef = name
  if (src && typeof src.file === 'string') st.boundSrc = { file: src.file, line: src.line, col: src.col }
  return value
}
;(globalThis as any)[Symbol.for('pcbjs.bindRef')] = bindRef

/** Install or remove, with null, the stack position to source mapper. */
export function setSourceMapper(fn: ((src: Src) => Src) | null): void {
  registry().mapSrc = fn
}

/** The registry, for circuit.ts. */
export const schematicRegistry = (): Registry => registry()

function makeNet(name: string, cls: string | undefined, scope: string | InstanceState | null): Net {
  const n: any = { $$: 'net', name }
  if (cls !== undefined) n.class = cls
  if (scope !== null) n.local = true
  const meta: NetMeta = { seq: ++registry().netSeq, scope }
  Object.defineProperty(n, NET_META, { value: meta })
  // non-enumerable, so a net still prints and compares as before
  Object.defineProperty(n, 'rules', {
    value: (r: NetRules): Net => {
      let got: RuleSet<'clearance'>
      try {
        got = ruleOverrides(r, ['clearance'] as const, `net ${name}.rules`, false)
      } catch (e) {
        throw new SchematicError((e as Error).message)
      }
      meta.rules = mergeRuleSets(meta.rules ?? {}, got)
      return n
    },
  })
  return Object.freeze(n) as Net
}

/** Keys a proxy answers with undefined: probes made by await, JSON and test tools. */
export const PROBES = new Set(['then', 'toJSON', '$$typeof', 'asymmetricMatch', 'nodeType', '__esModule', 'constructor', 'prototype'])

export function netProxy(classes: Record<string, { class?: string } | undefined> | undefined, scope: string | InstanceState | null, prefix = ''): Record<string, Net> {
  const cache = new Map<string, Net>()
  return new Proxy({} as Record<string, Net>, {
    get(_t, k) {
      if (typeof k === 'symbol' || PROBES.has(k)) return undefined
      let n = cache.get(k)
      if (!n) cache.set(k, (n = makeNet(prefix + k, classes?.[k]?.class, scope)))
      return n
    },
    has: (_t, k) => typeof k === 'string',
    set() {
      throw new SchematicError('nets() is read-only: declare a net by reading it, const { GND } = nets()')
    },
  })
}

/** Declare nets by name, `const { GND } = nets()`; a string first is a prefix, `nets('P1').CC1` is `P1/CC1`. */
export function nets(classes?: Record<string, { class?: string }>): { readonly [name: string]: Net }
export function nets(prefix: string, classes?: Record<string, { class?: string }>): { readonly [name: string]: Net }
export function nets(a?: string | Record<string, { class?: string }>, b?: Record<string, { class?: string }>): { readonly [name: string]: Net } {
  if (typeof a === 'string') {
    const p = a.replace(/\/+$/, '')
    if (!p) throw new TypeError(`nets(${JSON.stringify(a)}): the namespace prefix must be a non-empty name such as 'P1'`)
    checkClasses(b, `nets(${JSON.stringify(a)}, …)`)
    return netProxy(b, null, `${p}/`)
  }
  if (b !== undefined) throw new TypeError("nets(classes, …): a second argument follows only a prefix, nets('P1', { VBUS: { class: 'power' } })")
  checkClasses(a, 'nets(…)')
  return netProxy(a, null)
}

function checkClasses(c: unknown, call: string): void {
  if (c === undefined) return
  if (c === null || typeof c !== 'object' || Array.isArray(c))
    throw new TypeError(
      `${call}: takes a namespace prefix string or a class table such as { VIN: { class: 'power' } }, got ${Array.isArray(c) ? 'an array' : c === null ? 'null' : typeof c}`,
    )
  for (const [k, v] of Object.entries(c))
    if (v === null || typeof v !== 'object' || (v.class !== undefined && typeof v.class !== 'string'))
      throw new TypeError(`${call}: the entry ${JSON.stringify(k)} must be { class: 'name' }, got ${JSON.stringify(v)}`)
}

/** Nets private to one instance, named after its path such as `LedChannel#2/led`; outside a render after `label`. */
export function local(label?: string): { readonly [name: string]: Net } {
  const r = registry()
  const path = r.render?.stack.join('/')
  const scope = label ?? (path || `local#${++r.localCount}`)
  return netProxy(undefined, scope)
}

/** `n` nets named `name0` to `name<n-1>`: `bus('D', 8)`. */
export function bus(name: string, n: number, opts: { class?: string } = {}): Net[] {
  if (!Number.isInteger(n) || n < 1) throw new SchematicError(`bus(${JSON.stringify(name)}, ${n}): the width must be a positive integer`)
  return Array.from({ length: n }, (_, i) => makeNet(`${name}${i}`, opts.class, null))
}

/** A pin left open on purpose: `Q1.connect(SIG, NC, SW)`. */
export const NC: NoConnect = Object.freeze({ $$: 'nc' as const })

export const isNet = (v: unknown): v is Net => !!v && typeof v === 'object' && (v as any).$$ === 'net' && typeof (v as any).name === 'string'
export const isNC = (v: unknown): v is NoConnect => !!v && typeof v === 'object' && (v as any).$$ === 'nc'
export const isPinRef = (v: unknown): v is PinRef => !!v && typeof v === 'object' && (v as any).$$ === 'pin' && typeof (v as any).pin === 'string'
export const isPart = (v: unknown): v is Part<any> => typeof v === 'function' && !!(v as any)[PART_STATE]

/** The board-level name of a net, qualified with the owning instance path for a private net. */
export function netInfo(v: unknown): { name: string; class?: string; local: boolean; seq: number; path?: string[]; rules?: { clearance?: number | KindClearanceMM } } | null {
  if (!isNet(v)) return null
  const meta = (v as any)[NET_META] as NetMeta | undefined
  const scope = meta?.scope ?? null
  const rules = meta?.rules ? { rules: { ...meta.rules } } : {}
  if (scope !== null && typeof scope === 'object') {
    const path = instancePath(scope)
    return { name: `${path.join('/')}/${v.name}`, class: v.class, local: true, seq: meta?.seq ?? Infinity, path, ...rules }
  }
  return { name: scope ? `${scope}/${v.name}` : v.name, class: v.class, local: scope !== null, seq: meta?.seq ?? Infinity, ...rules }
}

/** The circuit instance that owns a private net, or null. */
export function netOwner(v: Net): InstanceState | null {
  const scope = ((v as any)[NET_META] as NetMeta | undefined)?.scope
  return scope && typeof scope === 'object' ? scope : null
}

/** The state behind a Part, or null for anything else. */
export function partOf(v: unknown): PartState | null {
  return typeof v === 'function' ? ((v as any)[PART_STATE] ?? null) : null
}

/** The declared pin a key names, by name only; a number is a pad number, never a position. */
export function canonicalPin(pins: readonly string[], key: unknown): string | null {
  const s = String(key)
  return pins.includes(s) ? s : null
}

/** The pin a pad belongs to: by the pad's name, else its number, never by position. */
export function pinOfPad(pins: readonly string[], pad: { num: string; name: string }): string | null {
  if (pins.includes(pad.name)) return pad.name
  if (pins.includes(pad.num)) return pad.num
  return null
}

/** Pads `<pad nc>` marked, set by the flattener and shared through globalThis. */
const NC_PADS: WeakSet<object> = ((globalThis as any)[Symbol.for('pcbjs.pads.nc')] ??= new WeakSet())
export const markNcPad = (pad: object): void => {
  NC_PADS.add(pad)
}

/** A pad left unconnected on purpose: `nc` on the pad, or its number or name in the footprint's `nc` list. */
export function isNcPad(st: PartState, pad: { num: string; name: string }): boolean {
  return NC_PADS.has(pad) || st.nc.has(pad.num) || (pad.name !== pad.num && st.nc.has(pad.name))
}

/** The pin of each pad, null for NC and netless pads; throws for a pad that matches no pin and is not NC. */
export function pinsOfPads(st: PartState, pads: readonly { num: string; name: string; type?: string }[]): (string | null)[] {
  return pads.map(pad => {
    if (pad.type === 'npth' || pad.num === '' || isNcPad(st, pad)) return null
    const pin = pinOfPad(st.pins, pad)
    if (pin !== null) return pin
    const label = pad.name !== pad.num ? `${pad.num} "${pad.name}"` : pad.num
    const near = didYouMean(pad.name, st.pins) ?? (pad.name !== pad.num ? didYouMean(pad.num, st.pins) : null)
    throw new SchematicError(
      `${st.label}: pad ${label} of footprint ${st.footprintId} matches no pin${near ? `; did you mean ${near}?` : '.'} Its pins are ${st.pins.join(', ')}. Name the pad after a pin, or mark it unconnected with nc on the pad or in the footprint's nc list`,
    )
  })
}

/** The closest candidate to a mistyped name: a case-only difference or a small edit distance, a swap counting as one edit. */
export function didYouMean(name: string, candidates: readonly string[]): string | null {
  if (!name) return null
  const low = name.toLowerCase()
  const ci = candidates.find(c => c.toLowerCase() === low)
  if (ci !== undefined) return ci
  let best: string | null = null,
    bestD = Infinity
  const limit = Math.max(1, Math.floor(name.length / 3))
  for (const c of candidates) {
    const d = editDistance(low, c.toLowerCase())
    if (d <= limit && d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j),
    prev2 = prev
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1)
    }
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

const HERE = (() => {
  try {
    return new URL('.', import.meta.url).pathname
  } catch {
    return ''
  }
})()
// the parent of every pcbjs package: packages/ in the repository, node_modules/@pcbjs/ installed
const PACKAGES = HERE ? HERE.replace(/[\\/][^\\/]+[\\/]dist[\\/]?$/, '/') : ''

/** The innermost stack frame outside pcbjs and node_modules; `anyPackage` skips every pcbjs package, not only core. */
export function callerSite(anyPackage = false): Src | undefined {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 40
  const stack = new Error().stack ?? ''
  Error.stackTraceLimit = limit
  for (const line of stack.split('\n').slice(1)) {
    const t = line.trim()
    if (!t.startsWith('at ') || t.startsWith('at async ')) continue
    const m = /\(?((?:file:\/\/)?[^()\s]+?):(\d+):(\d+)\)?$/.exec(t)
    if (!m) continue
    let file = m[1]
    if (file.startsWith('file://')) {
      try {
        file = decodeURIComponent(new URL(file).pathname)
      } catch {
        continue
      }
    }
    if (
      file.startsWith('node:') ||
      file.includes('/node_modules/') ||
      (HERE && file.startsWith(HERE)) ||
      (anyPackage && PACKAGES && file.startsWith(PACKAGES) && /^[^\\/]+[\\/]dist[\\/]/.test(file.slice(PACKAGES.length))) ||
      !/^([\\/]|[A-Za-z]:)/.test(file)
    )
      continue
    const raw: Src = { file, line: Number(m[2]), col: Number(m[3]) }
    const map = registry().mapSrc
    if (!map) return raw
    try {
      return map(raw)
    } catch {
      return raw
    }
  }
  return undefined
}

const PART_KEYS = new Set(['value', 'fields', 'source', 'bom', 'pos', 'dnp', 'description', 'height', 'model'])

/** The internal options of `part()`: the public PartOptions plus the factory's footprint props and metadata overrides. */
export interface PartInit extends PartOptions {
  /** footprint props every placement gets, such as `{ pins: 3 }` */
  props?: Record<string, any>
  pins?: readonly string[]
  prefix?: string
  nc?: readonly string[]
}

type FootprintLike = Component & { pins?: PinList; nc?: PinList; prefix?: string; id?: string; displayName?: string }

/** A part from a footprint component, whose static `pins` and `prefix`, or `init`, give its metadata. */
export function part<P extends string = string, D extends string = never>(footprint: FootprintLike, init: PartInit = {}): Part<P, D> {
  if (typeof footprint !== 'function') throw new SchematicError('part() needs a footprint component')
  const name = footprint.displayName || footprint.name || 'Footprint'
  const { props: own = {}, pins: pinsOpt, nc: ncOpt, prefix: prefixOpt, value, source: sourceOpt, ...rest } = init
  for (const k of Object.keys(rest)) if (!PART_KEYS.has(k)) throw new SchematicError(`${name}: unknown part option ${JSON.stringify(k)}`)
  const declared = pinsOpt ?? (typeof footprint.pins === 'function' ? footprint.pins(own) : footprint.pins)
  if (!Array.isArray(declared) || !declared.length) throw new SchematicError(`${name} declares no pins: set ${name}.pins = ['1', '2', …] or pass { pins }`)
  const pins = declared.map(String)
  const dup = pins.find((p, i) => pins.indexOf(p) !== i)
  if (dup !== undefined) throw new SchematicError(`${name} declares pin ${JSON.stringify(dup)} twice`)
  const ncList = ncOpt ?? (typeof footprint.nc === 'function' ? footprint.nc(own) : footprint.nc) ?? []
  if (!Array.isArray(ncList)) throw new SchematicError(`${name}: nc must be a list of pad numbers or names`)
  const nc = new Set(ncList.map(String))
  const both = pins.find(p => nc.has(p))
  if (both !== undefined) throw new SchematicError(`${name} declares ${JSON.stringify(both)} both as a pin and as an nc pad`)
  const prefix = String(prefixOpt ?? footprint.prefix ?? 'U')
  if (!/^[A-Za-z_][A-Za-z_]*$/.test(prefix)) throw new SchematicError(`${name}: the ref prefix ${JSON.stringify(prefix)} must be letters`)
  const r = registry()
  const building = r.building.at(-1)
  const v = value === undefined || value === null ? undefined : String(value)
  const st: PartState = {
    seq: ++r.seq,
    footprint,
    props: { ...rest, ...own },
    value: v,
    pins,
    nc,
    prefix,
    footprintId: String(footprint.id ?? name),
    conn: new Map(),
    src: callerSite(true),
    render: !!r.render,
    label: `${name}(${v !== undefined ? JSON.stringify(v) : ''})`,
    part: null!,
    source: {},
    sourced: {},
    rules: {},
  }
  // a model file is relative to the file of this call
  if (st.props.model) st.props.model = anchorModel(st.props.model, st.src?.file)
  if (building) {
    st.owner = building
    st.declFile = building.declFile
    building.made.push(st)
  } else st.declFile = st.src?.file
  if (sourceOpt !== undefined) st.source = sourcingSpec(sourceOpt, `${st.label}: source`)
  // `.net` is read lazily, so a handle taken before connect() still answers after it
  const handle = (p: string, pad?: string): PinRef => {
    const ref = { $$: 'pin' as const, part: proxy, pin: p, ...(pad !== undefined ? { pad } : {}) }
    Object.defineProperty(ref, 'net', { get: () => handleNet(st, p, pad), enumerable: false })
    return Object.freeze(ref) as PinRef
  }
  const pinRefs = new Map<string, PinRef>()
  const pin = (key: unknown): PinRef => {
    const p = canonicalPin(pins, key)
    if (p === null) throw new SchematicError(`${st.label} has no pin ${JSON.stringify(String(key))}; its pins are ${pins.join(', ')}`)
    let ref = pinRefs.get(p)
    if (!ref) pinRefs.set(p, (ref = handle(p)))
    return ref
  }
  const padRefs = new Map<string, PinRef>()
  // checked against the footprint when the board compiles
  const pad = (key: unknown): PinRef => {
    if ((typeof key !== 'string' && typeof key !== 'number') || String(key) === '')
      throw new SchematicError(`${st.label}.pad: needs a pad number or name such as 'B4', got ${String(key)}`)
    const k = String(key)
    let ref = padRefs.get(k)
    if (!ref) padRefs.set(k, (ref = handle(k, k)))
    return ref
  }
  // a numeric key is a pad number; any other key is a pin name first, then a pad name
  let padList: PadInfo[] | null | undefined
  const pads = (): PadInfo[] | null => (padList === undefined ? (padList = padsOf(st)) : padList)
  let padIds: string[] | null | undefined
  const key = (k: string): PinRef => {
    if (/^\d+$/.test(k)) {
      const all = pads()
      const hit = all?.filter(q => q.num === k) ?? []
      // a pin named like a pad number whose pads are exactly that number's is the same copper
      if (pins.includes(k) && (!all || (hit.length > 0 && all.every(q => (q.num === k) === (pinOfPad(pins, q) === k))))) return pin(k)
      if (!all || hit.length) return pad(k)
      const nums = [...new Set(all.map(q => q.num).filter(n => n !== ''))]
      throw new SchematicError(
        `${st.label} has no pad numbered ${JSON.stringify(k)}; a number key is a pad number, never a pin position. Its pads are ${nums.join(', ') || 'none'}; its pins are ${pins.join(', ')}`,
      )
    }
    if (pins.includes(k)) return pin(k)
    // a pad named after a pin is reached through the pin
    if (padIds === undefined) padIds = padIdsOf(st)?.filter(id => !pins.includes(id)) ?? null
    if (padIds?.includes(k)) return pad(k)
    const near = didYouMean(k, [...pins, ...(padIds ?? [])])
    const padText = padIds?.length ? `; its pads are ${padIds.join(', ')}` : ''
    throw new SchematicError(`${st.label} has no pin or pad ${JSON.stringify(k)}${near ? `; did you mean ${near}?` : '.'} Its pins are ${pins.join(', ')}${padText}`)
  }
  // a pin name, else for a number the one pin on that pad
  const connectPin = (k: string): string => {
    if (pins.includes(k)) return k
    const all = /^\d+$/.test(k) ? pads() : null
    const own = [
      ...new Set(
        (all ?? [])
          .filter(q => q.num === k)
          .map(q => pinOfPad(pins, q))
          .filter((q): q is string => q !== null),
      ),
    ]
    if (own.length === 1) return own[0]
    throw new SchematicError(
      `${st.label}.connect: no pin ${JSON.stringify(k)}${own.length > 1 ? `; pad ${k} belongs to pins ${own.join(' and ')}` : ''}; its pins are ${pins.join(', ')}`,
    )
  }
  const connection = (pinName: string, c: unknown): Connection => {
    if (isNC(c)) return c
    if (isNet(c)) {
      crossing(st, pinName, c)
      return c
    }
    throw new SchematicError(`${st.label}.connect: pin ${pinName} needs a Net from nets() or NC, got ${typeof c === 'string' ? JSON.stringify(c) : String(c)}`)
  }
  const join = (pinName: string, c: Connection) => {
    if (st.conn.has(pinName)) throw new SchematicError(`${st.label}.connect: pin ${pinName} is connected twice`)
    st.conn.set(pinName, c)
  }
  function connect(...args: unknown[]): Part<any> {
    const a = args[0]
    if (args.length === 1 && a && typeof a === 'object' && !isNet(a) && !isNC(a)) {
      for (const [k, c] of Object.entries(a)) {
        const p = connectPin(k)
        join(p, connection(p, c))
      }
    } else {
      if (args.length !== pins.length)
        throw new SchematicError(
          `${st.label}.connect: ${args.length} net${args.length === 1 ? '' : 's'} for ${pins.length} pin${pins.length === 1 ? '' : 's'} (${pins.join(', ')})`,
        )
      args.forEach((c, i) => join(pins[i], connection(pins[i], c)))
    }
    return proxy
  }
  function setRef(ref: unknown): Part<any> {
    if (typeof ref !== 'string' || !/^[A-Za-z_][\w]*$/.test(ref)) throw new SchematicError(`${st.label}.ref: ${JSON.stringify(ref)} is not a ref such as "Q9"`)
    st.explicitRef = ref
    return proxy
  }
  function addSource(spec: unknown): Part<any> {
    Object.assign(st.sourced, sourcingSpec(spec, `${st.label}.source`))
    return proxy
  }
  function addRules(r: PartRules): Part<any> {
    try {
      st.rules = mergeRuleSets(st.rules, ruleOverrides(r, PART_RULE_KEYS, `${st.label}.rules`))
    } catch (e) {
      throw new SchematicError((e as Error).message)
    }
    return proxy
  }
  // calling a part is writing it as JSX
  const target = function Part(props?: Record<string, any>): PcbNode {
    return h(proxy as any, props ?? {})
  }
  const proxy: Part<any> = new Proxy(target, {
    get(t, k) {
      if (k === PART_STATE) return st
      if (typeof k === 'symbol') return Reflect.get(t, k)
      switch (k) {
        case '$$':
          return 'part'
        case 'connect':
          return connect
        case 'ref':
          return setRef
        case 'source':
          return addSource
        case 'rules':
          return addRules
        case 'pin':
          return pin
        case 'pad':
          return pad
        case 'value':
          return st.value
        case 'prefix':
          return st.prefix
        case 'pins':
          return [...pins]
      }
      if (PROBES.has(k) && canonicalPin(pins, k) === null) return k === 'prototype' ? Reflect.get(t, k) : undefined
      if (k in t && canonicalPin(pins, k) === null) return Reflect.get(t, k)
      return key(k)
    },
    has: (t, k) => k in t || canonicalPin(pins, k) !== null,
    set() {
      throw new SchematicError(`${st.label} is read-only: use .connect(…), .ref(…), .source(…) and .rules(…)`)
    },
  }) as any
  st.part = proxy
  if (!st.render) {
    // a module evaluated again in dev replaces the parts it made before
    const file = st.declFile
    if (file !== undefined) {
      if ((r.fileEpoch.get(file) ?? -1) < r.epoch) r.parts = r.parts.filter(p => p.declFile !== file)
      r.fileEpoch.set(file, r.epoch)
    }
    r.parts.push(st)
  }
  return proxy as Part<P, D>
}

/** A pad of a footprint rendered outside a board. */
interface PadInfo {
  num: string
  name: string
  nc: boolean
}

/** The pads of a part's footprint in pad order, unnumbered holes left out; null when it does not render outside a board. */
function padsOf(st: PartState): PadInfo[] | null {
  const out: PadInfo[] = []
  const seen = new Set<unknown>()
  const walk = (c: unknown, depth: number): void => {
    if (depth > 64 || c === null || c === undefined || typeof c === 'boolean') return
    const list = childList(c)
    if (list) {
      for (const x of list) walk(x, depth + 1)
      return
    }
    if (!isNode(c) || seen.has(c)) return
    seen.add(c)
    if (c.type === 'pad') {
      const p = c.props as { num?: unknown; name?: unknown; type?: unknown; nc?: unknown }
      const num = p.num === undefined || p.num === null ? '' : String(p.num)
      if (p.type === 'npth' && num === '') return
      const name = p.name === undefined || p.name === null || p.name === '' ? num : String(p.name)
      out.push({ num, name, nc: p.nc === true })
      return
    }
    if (typeof c.type === 'function') {
      if (isPart(c.type)) return
      const kids = c.children
      walk((c.type as Component)({ ...c.props, ...(kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) }), depth + 1)
      return
    }
    walk(c.children, depth + 1)
  }
  try {
    walk((st.footprint as Component)({ ...st.props, ref: st.explicitRef ?? `${st.prefix}?`, at: [0, 0] }), 0)
  } catch {
    return null
  }
  return out
}

/** Pad numbers then names in pad order; null when the footprint does not render outside a board. */
function padIdsOf(st: PartState): string[] | null {
  const pads = padsOf(st)
  if (!pads) return null
  const nums: string[] = [],
    names: string[] = []
  for (const p of pads) {
    if (p.num !== '' && !nums.includes(p.num)) nums.push(p.num)
    if (p.name !== '' && p.name !== p.num && !names.includes(p.name)) names.push(p.name)
  }
  return [...nums, ...names.filter(n => !nums.includes(n))]
}

/** The connection of a handle's pin, a pad going through its pin; throws when unconnected or the pad has no pin. */
function handleNet(st: PartState, pin: string, pad?: string): Connection {
  const what = pad === undefined ? `pin ${pin}` : `pad ${pad}`
  const at = `${st.label}.${pad === undefined ? pin : pad}.net`
  let p = pin
  if (pad !== undefined) {
    const all = padsOf(st)
    if (!all) throw new SchematicError(`${at}: the footprint ${st.footprintId} does not render outside a board, so the pin of pad ${pad} is not known`)
    const hit = all.filter(q => q.num === pad)
    const list = hit.length ? hit : all.filter(q => q.name === pad)
    if (!list.length) throw new SchematicError(`${at}: ${st.label} has no pad numbered or named ${JSON.stringify(pad)}`)
    if (list.every(q => q.nc || isNcPad(st, q))) return NC
    const own = list.map(q => pinOfPad(st.pins, q)).find(q => q !== null)
    if (own === undefined) throw new SchematicError(`${at}: pad ${pad} matches no pin of ${st.label}; its pins are ${st.pins.join(', ')}`)
    p = own
  }
  if (!st.conn.size) throw new SchematicError(`${at}: ${st.label} is not connected yet, so ${what} has no net; call .connect(…) on the part before reading .net`)
  const c = st.conn.get(p)
  if (c === undefined) throw new SchematicError(`${at}: ${what}${pad !== undefined ? `, pin ${p},` : ''} of ${st.label} is unconnected; connect it, or connect it to NC`)
  return c
}

/** A circuit with ports: its parts connect only to its ports and private nets, else throw. */
function crossing(st: PartState, pin: string, n: Net): void {
  let owner = st.owner
  while (owner && owner.form !== 'build') owner = owner.parent ?? undefined
  if (!owner) return
  if (netOwner(n) === owner) return
  for (const c of Object.values(owner.ports)) if (c === n) return
  const own = netOwner(n)
  const what = own ? `the private net ${instancePath(own).join('/')}/${n.name}` : `the net ${n.name}`
  throw new SchematicError(
    `${st.label}.connect: pin ${pin} of a part in the circuit ${owner.circuit} reaches ${what}, which is neither a port nor one of its own nets; pass it in as a port`,
  )
}

const isRenderProps = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && ('ref' in v || 'at' in v)

/** How a factory turns its call arguments into part options; by default a value or a PartOptions. */
export type PartArgs = (...args: any[]) => PartInit

const valueArgs: PartArgs = (v?: unknown, source?: unknown) => {
  let init: PartInit
  if (v === undefined || v === null) init = {}
  else if (typeof v === 'string' || typeof v === 'number') init = { value: v }
  else if (typeof v === 'object') init = { ...(v as PartInit) }
  else throw new SchematicError(`a footprint factory takes a value or an options object, got ${String(v)}`)
  if (source !== undefined && source !== null) init.source = { ...(init.source ?? {}), ...(source as SourcingSpec) }
  return init
}

/** The metadata of `defineFootprint`: `pins` inline or `as const` for typed keys, or a function of the props; `nc` pads left open. */
export interface FootprintMeta<P extends string, D extends string | number = never> {
  pins: readonly P[] | ((props: any) => readonly P[])
  /** pad ids inline or `as const`, for typed pad keys such as `J1['B6']`; types only */
  pads?: readonly D[]
  nc?: readonly (string | number)[] | ((props: any) => readonly (string | number)[])
  prefix: string
  id?: string
  name?: string
  args?: PartArgs
  /** net tie groups by pad number, set on the rendered footprint unless it sets its own */
  netTie?: readonly (readonly (string | number)[])[]
  /** the schematic symbol of its parts, or a function of the footprint props; default by prefix and pin names */
  symbol?: import('./sch-symbol.js').SymbolDef | ((props: any) => import('./sch-symbol.js').SymbolDef)
}

/** A footprint component with two modes: JSX props with `ref` or `at` render it, a value or options make a Part. */
export function defineFootprint<const P extends string, Props = any, const D extends string | number = never>(
  render: (props: Props) => Child,
  meta: FootprintMeta<P, D>,
): FootprintFactory<P, Props, `${D}`> {
  const args = meta.args ?? valueArgs
  const tie = meta.netTie === undefined ? undefined : meta.netTie.map(g => g.map(String))
  const draw = (props: Props): Child => {
    const n = render(props) as any
    if (!tie || !n || n.$$ !== 'pcb' || n.type !== 'footprint' || n.props.netTie !== undefined) return n
    return { ...n, props: { ...n.props, netTie: tie } }
  }
  const factory = function (this: unknown, ...a: unknown[]): any {
    if (a.length === 1 && isRenderProps(a[0])) return draw(a[0] as Props)
    return part(factory as any, args(...a))
  }
  const name = meta.name ?? render.name ?? 'Footprint'
  Object.defineProperty(factory, 'name', { value: name })
  Object.defineProperty(factory, 'pins', { value: typeof meta.pins === 'function' ? meta.pins : Object.freeze([...meta.pins]), enumerable: true })
  if (meta.nc !== undefined) Object.defineProperty(factory, 'nc', { value: typeof meta.nc === 'function' ? meta.nc : Object.freeze([...meta.nc].map(String)), enumerable: true })
  Object.defineProperty(factory, 'prefix', { value: meta.prefix, enumerable: true })
  if (meta.id !== undefined) Object.defineProperty(factory, 'id', { value: meta.id, enumerable: true })
  if (tie) Object.defineProperty(factory, 'netTie', { value: tie, enumerable: true })
  if (meta.symbol !== undefined) Object.defineProperty(factory, 'symbol', { value: meta.symbol, enumerable: true })
  return factory as any
}

/** A sourcing spec checked and copied; numbers become strings. */
export function sourcingSpec(spec: unknown, where: string): Record<string, string> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new SchematicError(`${where} needs an object such as { MPN: 'RC0603FR-07330RL' }, got ${String(spec)}`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(spec)) {
    if (k === '__src' || v === undefined) continue
    if (/^mpn:/i.test(k) && !k.slice(4).trim()) throw new SchematicError(`${where}: ${JSON.stringify(k)} needs a tag after the colon, such as "MPN:US"`)
    if (typeof v !== 'string' && typeof v !== 'number') throw new SchematicError(`${where}: ${k} must be a string, got ${typeof v}`)
    out[k] = String(v)
  }
  return out
}

/** Any part, whatever its pin names, as `source()` takes it. */
export type SourcedPart = { readonly $$: 'part' }
/** Any circuit instance, as `source()` takes it: the spec applies to every part in it, nested instances included. */
export type SourcedCircuit = { readonly $$: 'circuit' }

const INSTANCE_STATE = Symbol.for('pcbjs.circuit.state')
/** The state behind a circuit instance, or null for anything else. */
export function instanceOf(v: unknown): InstanceState | null {
  return !!v && typeof v === 'object' ? ((v as any)[INSTANCE_STATE] ?? null) : null
}
export { INSTANCE_STATE }

/** Sourcing out of line: on parts, or on every part a factory makes with one value; a part's own options and `.source()` win. */
export function source(target: SourcedPart | SourcedCircuit | readonly (SourcedPart | SourcedCircuit)[], spec: SourcingSpec): void
export function source(factory: Component, value: string | number, spec: SourcingSpec): void
export function source(target: unknown, a: unknown, b?: unknown): void {
  const r = registry()
  let rule: SourceRule
  if (isPart(target) || instanceOf(target) || Array.isArray(target)) {
    const list = Array.isArray(target) ? target : [target]
    const parts = new Set<PartState>()
    list.forEach((p, i) => {
      const inst = instanceOf(p)
      if (inst) {
        for (const st of instanceParts(inst)) parts.add(st)
        return
      }
      const st = partOf(p)
      if (!st) throw new SchematicError(`source(): item ${i + 1} is not a part or a circuit instance`)
      parts.add(st)
    })
    rule = { seq: 0, parts, spec: sourcingSpec(a, 'source()') }
  } else if (typeof target === 'function') {
    if (typeof a !== 'string' && typeof a !== 'number')
      throw new SchematicError(`source(factory, value, spec) needs a value such as '330', got ${a === undefined ? 'nothing' : typeof a}`)
    const name = (target as any).displayName || target.name || 'Footprint'
    rule = { seq: 0, factory: target as Component, value: String(a), spec: sourcingSpec(b, `source(${name}, ${JSON.stringify(String(a))})`) }
  } else throw new SchematicError('source() takes a part, a circuit instance, an array of them, or a footprint factory and a value')
  rule.seq = ++r.seq
  rule.src = callerSite()
  const file = rule.src?.file
  if (file !== undefined) {
    if ((r.sourceEpoch.get(file) ?? -1) < r.epoch) r.sources = r.sources.filter(x => x.src?.file !== file)
    r.sourceEpoch.set(file, r.epoch)
  }
  r.sources.push(rule)
}

const sameFactory = (a: Component, b: Component): boolean => {
  if (a === b) return true
  // two module copies of one library factory are not ===
  const x = a as any,
    y = b as any
  return x.id !== undefined && x.id === y.id && (x.displayName || x.name) === (y.displayName || y.name)
}
const stripQuery = (f: string) => f.replace(/[?#].*$/, '')

/** A part's sourcing keys, lowest first: factory rules, part rules, options, `.source()`; `files` limits factory rules to those files. */
export function sourcingOf(st: PartState, files?: ReadonlySet<string>): Record<string, string> {
  const rules = registry().sources
  const byFactory = rules.filter(
    x => x.factory && st.value !== undefined && x.value === st.value && sameFactory(x.factory, st.footprint) && (!files || !x.src || files.has(stripQuery(x.src.file))),
  )
  const byPart = rules.filter(x => x.parts?.has(st))
  return Object.assign({}, ...byFactory.map(x => x.spec), ...byPart.map(x => x.spec), st.props.fields ?? {}, st.source, st.sourced)
}

/** The state of one compile, see beginCompile. */
export interface CompileScope {
  parts: PartState[]
  instances: InstanceState[]
  prev: RenderScope | null
}

/** Start a compile: a new epoch, a snapshot of module-level parts, and a render scope. */
export function beginCompile(rules?: Readonly<Rules>): CompileScope {
  const r = registry()
  r.epoch++
  const scope: CompileScope = { parts: [...r.parts], instances: [...r.instances], prev: r.render }
  r.render = { stack: [], counts: new Map(), rules }
  return scope
}
export function endCompile(scope: CompileScope): void {
  registry().render = scope.prev
}

/** The rules of the board being compiled, for a component that sizes itself by them; undefined outside a compile. */
export const boardRules = (): Readonly<Rules> | undefined => registry().render?.rules

/** Call a component in the render scope, so its local() nets are named after the instance path. */
export function renderComponent<T>(fn: Component, props: any): T {
  const r = registry().render
  if (!r) return fn(props) as T
  const name = (fn as any).displayName || fn.name || 'Component'
  const k = (r.counts.get(name) ?? 0) + 1
  r.counts.set(name, k)
  r.stack.push(`${name}#${k}`)
  try {
    return fn(props) as T
  } finally {
    r.stack.pop()
  }
}
