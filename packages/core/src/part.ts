// Parts and circuit instances as the compiler knows them: their state, refs, pins and pads, bound routes.
import type { Component, Connection, Net, Part, PartOptions, PartRules, PcbNode, PinList, PinRef, RoutePoint, Src } from './types.js'
import type { FootprintPoint } from './grid.js'
import { NC, PROBES, SchematicError, didYouMean, isNC, isNet, netOwner } from './nets.js'
import { PART_RULE_KEYS, type PartRuleKey, type RuleSet, mergeRuleSets, ruleOverrides } from './netclass.js'
import { anchorModel, childList, h, isNode } from './jsx-runtime.js'
import { callerSite } from './provenance.js'
import { claimFile, realm } from './realm.js'
import { footprintRender } from './footprint.js'

const registry = () => realm().registry
const PART_STATE = Symbol.for('pcbjs.part.state')

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
  /** the `ref` option */
  explicitRef?: string
  /** the name of the binding that holds it, `const R1 = …`, and where that name is */
  boundRef?: string
  boundSrc?: Src
  src?: Src
  /** created inside a component while a board rendered */
  render: boolean
  /** for messages, such as R0603("330") */
  label: string
  part: Part<any>
  /** sourcing keys and BOM fields of `.source()` calls, merged in call order */
  sourced: Record<string, string>
  /** `.rules()` overrides in mm, merged in call order */
  rules: RuleSet<PartRuleKey>
  /** the owning circuit instance, and the part's key there, `R1` for Buck1.R1 */
  owner?: InstanceState
  key?: string
  /** the declaring file: its own, or that of its outermost circuit instance */
  declFile?: string
}

/** What the compiler knows about a circuit instance. */
export interface InstanceState {
  seq: number
  circuit: string
  def: object
  /** `CH2` for `channel(ports, 2)` or `channel(ports, 'CH2')` */
  name: string
  /** the digits of the index, `2`, which go into the refs of its parts */
  index: string
  /** the name of the binding that holds it, `ch2` of `const ch2 = channel(ports, 'CH2')` */
  binding?: string
  parent: InstanceState | null
  /** parts and child instances in key order */
  members: Map<string, PartState | InstanceState>
  /** the routes its build returns, `ch2.vccTrunk`, by key */
  routes: Map<string, object>
  ports: Record<string, Connection>
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

/** The ref style a binding should have: capital letters, then digits, `R1` or `LED12`; another name is a hint, never an error. */
export const BOUND_REF = /^[A-Z]+[0-9]+$/
/** A name a part may take: letters, digits and underscores, starting with a letter. */
const REF = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A route bound to a name, `const vccTrunk = route(…)`. */
export interface BoundRoute {
  name: string
  node: object
  src?: Src
  file?: string
  /** the module that bound it, absolute, which tells two projects' files of one name apart */
  abs?: string
}
const ROUTE_NAME = Symbol.for('pcbjs.route.name')
const ROUTE_OWNER = Symbol.for('pcbjs.route.owner')
/** The name a route node is bound to, or undefined. */
export const routeName = (node: unknown): string | undefined => (node && typeof node === 'object' ? (node as any)[ROUTE_NAME] : undefined)
/** The circuit instance a route belongs to, a member of its build such as `ch2.vccTrunk`, or undefined. */
export const routeOwner = (node: unknown): InstanceState | undefined => (node && typeof node === 'object' ? (node as any)[ROUTE_OWNER] : undefined)
export const isRouteNode = (v: unknown): v is object => !!v && typeof v === 'object' && (v as any).$$ === 'pcb' && (v as any).type === 'track' && typeof (v as any).H === 'function'
/** A point of a route, `vccTrunk.end`. */
export const isRoutePoint = (v: unknown): v is RoutePoint => !!v && typeof v === 'object' && (v as any).$$ === 'route-pt' && isRouteNode((v as any).route)

/** Name a route a member of the instance `inst` under `key`; false when it is bound to another name. */
export function ownRoute(node: object, key: string, inst: InstanceState): boolean {
  const name = routeName(node)
  if (name !== undefined && name !== key) return false
  if (name === undefined) Object.defineProperty(node, ROUTE_NAME, { value: key })
  if (!routeOwner(node)) Object.defineProperty(node, ROUTE_OWNER, { value: inst })
  return true
}

/**
 * Called by the source transform for each binding, `const R1 = …`: a part takes the name as its ref, a route as its id; the first name wins.
 * `local` is a binding inside a function body, which names only the parts of the circuit build running there.
 */
export function bindRef<T>(value: T, name: string, src?: Src, local = false): T {
  if (typeof name !== 'string' || !REF.test(name)) return value
  const site = src && typeof src.file === 'string' ? { file: src.file, line: src.line, col: src.col } : undefined
  if (isRouteNode(value)) {
    const building = local ? registry().building.at(-1) : undefined
    if (building && routeName(value) === undefined) ownRoute(value, name, building)
    if (local || routeName(value) !== undefined) return value
    Object.defineProperty(value, ROUTE_NAME, { value: name })
    const r = registry()
    const file = site?.file
    if (file !== undefined) {
      if ((r.routeEpoch.get(file) ?? -1) < r.epoch) r.routes = r.routes.filter(x => x.file !== file)
      r.routeEpoch.set(file, r.epoch)
    }
    const abs = callerSite()?.file
    r.routes.push({ name, node: value, ...(site ? { src: site, file: site.file } : {}), ...(abs ? { abs } : {}) })
    return value
  }
  const inst = instanceOf(value)
  if (inst) {
    if (!local && inst.binding === undefined) inst.binding = name
    return value
  }
  const st = partOf(value)
  if (!st || st.explicitRef !== undefined || st.boundRef !== undefined) return value
  const building = registry().building.at(-1)
  if (local ? !building || st.owner !== building : st.owner || st.render) return value
  st.boundRef = name
  if (site) st.boundSrc = site
  return value
}
;(globalThis as any)[Symbol.for('pcbjs.bindRef')] = bindRef
export const isPart = (v: unknown): v is Part<any> => typeof v === 'function' && !!(v as any)[PART_STATE]

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

const PART_KEYS = new Set(['ref', 'bom', 'pos', 'dnp', 'height', 'model'])

/** The internal options of `part()`: the value, the public PartOptions, the footprint props and metadata overrides. */
export interface PartInit extends PartOptions {
  value?: string | number
  /** footprint props every placement gets, such as `{ pins: 3 }` */
  props?: Record<string, any>
  pins?: readonly string[]
  prefix?: string
  nc?: readonly string[]
}

type FootprintLike = Component & { pins?: PinList; nc?: PinList; prefix?: string; displayName?: string }

/** A part from a footprint component, whose static `pins` and `prefix`, or `init`, give its metadata. */
export function part<P extends string = string, D extends string = never>(footprint: FootprintLike, init: PartInit = {}): Part<P, D> {
  if (typeof footprint !== 'function') throw new SchematicError('part() needs a footprint component')
  const name = footprint.displayName || footprint.name || 'Footprint'
  const { props: own = {}, pins: pinsOpt, nc: ncOpt, prefix: prefixOpt, value, ref, ...rest } = init
  for (const k of Object.keys(rest))
    if (!PART_KEYS.has(k)) throw new SchematicError(`${name}: unknown part option ${JSON.stringify(k)}; it takes ${[...PART_KEYS].join(', ')}, and sourcing goes to .source({ … })`)
  if (ref !== undefined && (typeof ref !== 'string' || !REF.test(ref))) throw new SchematicError(`${name}: the ref ${JSON.stringify(ref)} must be a name such as "D3"`)
  const declared = pinsOpt ?? (typeof footprint.pins === 'function' ? footprint.pins(own) : footprint.pins) ?? []
  if (!Array.isArray(declared)) throw new SchematicError(`${name}: pins must be a list of names such as ['1', '2']`)
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
    footprintId: name,
    conn: new Map(),
    ...(ref !== undefined ? { explicitRef: ref } : {}),
    src: callerSite(),
    render: !!r.render,
    label: `${name}(${v !== undefined ? JSON.stringify(v) : ''})`,
    part: null!,
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
  // `.net` is read lazily, so a handle taken before connect() still answers after it
  const handle = (p: string, pad?: string): PinRef => {
    const ref = { $$: 'pin' as const, part: proxy, pin: p, ...(pad !== undefined ? { pad } : {}) }
    Object.defineProperty(ref, 'net', { get: () => handleNet(st, p, pad), enumerable: false })
    return Object.freeze(ref) as PinRef
  }
  const pinRefs = new Map<string, PinRef>()
  const pin = (p: string): PinRef => {
    let ref = pinRefs.get(p)
    if (!ref) pinRefs.set(p, (ref = handle(p)))
    return ref
  }
  const padRefs = new Map<string, PinRef>()
  // checked against the footprint when the board compiles
  const pad = (k: string): PinRef => {
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
  const connectPin = (k: string): string => {
    if (pins.includes(k)) return k
    const near = didYouMean(k, pins)
    throw new SchematicError(`${st.label}.connect: no pin ${JSON.stringify(k)}${near ? `; did you mean ${near}?` : ''}; its pins are ${pins.join(', ') || 'none'}`)
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
    if (args.length !== 1 || !a || typeof a !== 'object' || Array.isArray(a) || isNet(a) || isNC(a))
      throw new SchematicError(
        `${st.label}.connect takes one object of nets by pin name, such as { ${pins
          .slice(0, 2)
          .map(p => `${p}: …`)
          .join(', ')} }; its pins are ${pins.join(', ') || 'none'}`,
      )
    for (const [k, c] of Object.entries(a)) {
      if (k === '__src') continue
      const p = connectPin(k)
      join(p, connection(p, c))
    }
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
  let points: Readonly<Record<string, FootprintPoint>> | undefined
  const pointsOf = () =>
    (points ??= Object.freeze(
      Object.fromEntries(
        Object.entries((footprint as { points?: Record<string, readonly [number, number]> }).points ?? {}).map(([k, at]) => [
          k,
          Object.freeze({ $$: 'point' as const, part: proxy, name: k, at: [at[0], at[1]] as [number, number] }),
        ]),
      ),
    ))
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
        case 'source':
          return addSource
        case 'rules':
          return addRules
        case 'value':
          return st.value
        case 'prefix':
          return st.prefix
        case 'pins':
          return [...pins]
        case 'points':
          if (canonicalPin(pins, k) === null) return pointsOf()
      }
      if (PROBES.has(k) && canonicalPin(pins, k) === null) return k === 'prototype' ? Reflect.get(t, k) : undefined
      if (k in t && canonicalPin(pins, k) === null) return Reflect.get(t, k)
      return key(k)
    },
    has: (t, k) => k in t || canonicalPin(pins, k) !== null,
    set() {
      throw new SchematicError(`${st.label} is read-only: use .connect(…), .source(…) and .rules(…)`)
    },
  }) as any
  st.part = proxy
  if (!st.render) {
    // a module evaluated again in dev replaces the parts it made before
    claimFile(st.declFile)
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
    if (c.type === 'footprint' && c.props.id !== undefined) st.footprintId = String(c.props.id)
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
    walk(footprintRender(st.footprint)({ ...st.props, ref: st.explicitRef ?? `${st.prefix}?`, at: '0 0' }), 0)
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
  const owner = st.owner
  if (!owner) return
  if (netOwner(n) === owner) return
  for (const c of Object.values(owner.ports)) if (c === n) return
  const own = netOwner(n)
  const what = own ? `the private net ${instancePath(own).join('/')}/${n.name}` : `the net ${n.name}`
  throw new SchematicError(
    `${st.label}.connect: pin ${pin} of a part in the circuit ${owner.circuit} reaches ${what}, which is neither a port nor one of its own nets; pass it in as a port`,
  )
}

/** How a factory turns its call arguments into the part's init; by default a value then PartOptions. */
export type PartArgs = (...args: any[]) => PartInit

export const valueArgs: PartArgs = (v?: unknown, opts?: unknown) => {
  // no value: the options are the one argument, F({ ref: 'H1' })
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && opts === undefined) return valueArgs(undefined, v)
  if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number')
    throw new SchematicError(
      `a footprint factory takes the value as a string, R0603('330'), then options, R0603('330', { dnp: true }), or the options alone, R0603({ dnp: true }); got ${typeof v === 'object' ? 'an object' : String(v)} first`,
    )
  if (opts !== undefined && (opts === null || typeof opts !== 'object' || Array.isArray(opts)))
    throw new SchematicError(`a footprint factory takes its options as an object, such as { dnp: true }, got ${String(opts)}`)
  if (opts && 'value' in opts) throw new SchematicError("a footprint factory takes the value as its first argument, R0603('330', { … }), not in the options")
  return { ...((opts as PartInit) ?? {}), ...(v !== undefined && v !== null ? { value: v } : {}) }
}

/** A sourcing spec checked and copied; numbers become strings. */
export function sourcingSpec(spec: unknown, where: string): Record<string, string> {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new SchematicError(`${where} needs an object such as { MPN: 'RC0603FR-07330RL' }, got ${String(spec)}`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(spec)) {
    if (k === '__src' || v === undefined) continue
    if (/^mpn(:|$)/i.test(k) && !/^MPN(:|$)/.test(k)) throw new SchematicError(`${where}: ${JSON.stringify(k)} is spelled MPN, such as "MPN" or "MPN:LCSC"`)
    if (/^mpn:/i.test(k) && !k.slice(4).trim()) throw new SchematicError(`${where}: ${JSON.stringify(k)} needs a tag after the colon, such as "MPN:US"`)
    if (typeof v !== 'string' && typeof v !== 'number') throw new SchematicError(`${where}: ${k} must be a string, got ${typeof v}`)
    out[k] = String(v)
  }
  return out
}

const INSTANCE_STATE = Symbol.for('pcbjs.circuit.state')
/** The state behind a circuit instance, or null for anything else. */
export function instanceOf(v: unknown): InstanceState | null {
  return !!v && typeof v === 'object' ? ((v as any)[INSTANCE_STATE] ?? null) : null
}
export { INSTANCE_STATE }
