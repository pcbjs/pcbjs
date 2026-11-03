// State lives on globalThis and instances are recognised by a Symbol.for key, never instanceof: the CLI's copy compiles what Vite's copy made.
import { placementSnap, type Grid, type PlacementGrid } from './grid.js'
import { h } from './jsx-runtime.js'
import type { At, Child, Connection, Net, NoConnect, PcbNode, RouteBuilder, Side } from './types.js'
import { INSTANCE_STATE, instanceOf, isRouteNode, ownRoute, routeOwner, partOf, type InstanceState, type PartState } from './part.js'
import { PROBES, SchematicError, isNC, isNet, netProxy } from './nets.js'
import { claimFile } from './realm.js'
import { callerSite } from './provenance.js'
import { realm } from './realm.js'

type Required_<K extends string> = K extends `${string}?` ? never : K
type Optional_<K extends string> = K extends `${infer N}?` ? N : never

/** The ports of a circuit by name, `Ports<'VIN' | 'GND'>`; a name ending in `?` may be passed `NC`. */
export type Ports<K extends string = never> = { readonly [N in Required_<K>]: Net } & { readonly [N in Optional_<K>]: Net | NoConnect }

/** A proxy of nets: every key read gives the net of that name, the same object for the same key. */
export type NetsProxy = { readonly [name: string]: Net }

/** The second argument of a build: the instance's private nets, such as `Buck1/FB`. */
export interface CircuitOwn {
  nets: NetsProxy
  /** `nets` under the name `local()` has for components */
  local: NetsProxy
}

/** What a circuit holds: parts, nested circuit instances and routes its layouts place, by key. */
export type CircuitMembers = { readonly [key: string]: { readonly $$: 'part' } | CircuitInstanceBase<any> | RouteBuilder }

/** The fixed properties of every circuit instance. */
export interface CircuitInstanceBase<P = {}> {
  readonly $$: 'circuit'
  /** from the index of the call: `CH2` for `channel(ports, 'CH2')`, `channel2` for `channel(ports, 2)` */
  readonly name: string
  /** the circuit() name */
  readonly circuit: string
  /** the instance path, outermost first, such as ['Power1', 'LDO1'] */
  readonly path: readonly string[]
  /** the nets the caller connected to the ports */
  readonly ports: Readonly<P>
  /** private nets, `Buck1.nets.FB` is `Buck1/FB` */
  readonly nets: NetsProxy
  /** Define a layout restricted to this instance. */
  layout(render: (g: this, props: LayoutProps) => Child, name?: string): Layout<this>
}

/** A circuit instance: the members by key, `Buck1.R1` and a route `Buck1.vccTrunk`, plus `name`, `circuit`, `path`, `ports` and `nets`. */
export type CircuitInstance<T extends CircuitMembers = CircuitMembers, P = {}> = CircuitInstanceBase<P> & { readonly [K in keyof T]: T[K] }

/** An instance index: a number, `2`, or a name ending in digits, `'CH2'`; its digits go into the refs of the instance's parts. */
export type InstanceIndex = number | string

/** A circuit definition: call it with the port nets and an index to make an instance, `channel({ VCC, SW }, 2)`. */
export interface Circuit<P = {}, T extends CircuitMembers = CircuitMembers> {
  (ports: P, index: InstanceIndex): CircuitInstance<T, P>
  /** the circuit() name */
  readonly name: string
  readonly $$: 'circuit-def'
  /** Define a reusable layout for this circuit. */
  layout(render: (g: CircuitInstance<T, P>, props: LayoutProps) => Child, name?: string): Layout<CircuitInstance<T, P>>
}

/** The props of a layout: where it goes, and anything else the render function takes. */
export interface LayoutProps {
  grid?: Grid | PlacementGrid
  at?: At
  side?: Side
  /** this instance's own placements of its parts, `<CH1.R at="13 0" />`, each in place of the layout's and in the same frame */
  children?: Child
  [k: string]: any
}

/** The instance type of a circuit definition. */
export type InstanceOf<C> = C extends Circuit<infer P, infer T> ? CircuitInstance<T, P> : C extends CircuitInstanceBase<any> ? C : never

/** A component that places one instance, `<BuckCompact g={Buck1} at="10 10" />`. */
export interface Layout<I = CircuitInstance<any, any>> {
  (props: { g: I } & LayoutProps): PcbNode
  /** the layout name, which the viewer shows */
  readonly name: string
  /** the circuit() name it lays out */
  readonly circuit: string
}

const DEF = Symbol.for('pcbjs.circuit.def')
const KEY = Symbol.for('pcbjs.circuit.key')
/** A definition's key by the file that declares it, `lib/led-channel.sch.ts#ledChannel`; its name alone when no user file does. */
const keyHere = (name: string): string => {
  const s = callerSite()
  return s ? `${s.file}#${name}` : name
}
/** The key of a circuit definition, as the circuit records name it in `def`. */
export const circuitKey = (def: object): string => (def as any)[KEY] ?? (def as any).name
const IDENT = /^[A-Za-z_]\w*$/
const RESERVED = new Set(['$$', 'name', 'circuit', 'path', 'ports', 'nets', 'layout'])

/** The name and index digits of an instance from the index of its call. */
function indexName(circuitName: string, index: unknown): { name: string; index: string } {
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0) return { name: `${circuitName}${index}`, index: String(index) }
  const m = typeof index === 'string' ? /^[A-Za-z_][A-Za-z_]*?(\d+)$/.exec(index) : null
  if (m) return { name: index as string, index: m[1] }
  throw new SchematicError(
    `${circuitName}(ports, index): an instance needs an index, a whole number such as 2 or a name ending in digits such as 'CH2', got ${index === undefined ? 'none' : JSON.stringify(index)}`,
  )
}

/** The public object of an instance: its members as properties, the fixed ones as getters, frozen. */
function publicInstance(inst: InstanceState): any {
  const pub: any = {}
  Object.defineProperty(pub, INSTANCE_STATE, { value: inst })
  Object.defineProperty(pub, '$$', { value: 'circuit', enumerable: true })
  Object.defineProperty(pub, 'name', { get: () => inst.name, enumerable: true })
  Object.defineProperty(pub, 'circuit', { value: inst.circuit, enumerable: true })
  Object.defineProperty(pub, 'path', { get: () => pathOf(inst), enumerable: true })
  Object.defineProperty(pub, 'ports', { value: inst.ports, enumerable: true })
  Object.defineProperty(pub, 'nets', { value: inst.nets, enumerable: true })
  Object.defineProperty(pub, 'layout', { value: (render: (g: any, props: LayoutProps) => Child, name?: string) => layout(pub, render, name) })
  for (const [k, m] of inst.members) Object.defineProperty(pub, k, { value: 'members' in m ? m.instance : m.part, enumerable: true })
  for (const [k, r] of inst.routes) Object.defineProperty(pub, k, { value: r, enumerable: true })
  return Object.freeze(pub)
}
const pathOf = (i: InstanceState): string[] => {
  const out: string[] = []
  for (let x: InstanceState | null = i; x; x = x.parent) out.unshift(x.name)
  return out
}

/** A new instance state, registered with its parent's build or, at the top, with the registry. */
function newInstance(circuitName: string, def: object, name: string, index: string, ports: Record<string, Connection>): InstanceState {
  const r = realm().registry
  const parent = r.building.at(-1) ?? null
  const src = callerSite()
  const inst: InstanceState = {
    seq: ++r.seq,
    circuit: circuitName,
    def,
    name,
    index,
    parent,
    members: new Map(),
    routes: new Map(),
    ports,
    src,
    declFile: parent ? parent.declFile : src?.file,
    instance: null,
    nets: null!,
    made: [],
  }
  inst.nets = netProxy(undefined, inst)
  if (parent) parent.made.push(inst)
  else claimFile(inst.declFile)
  return inst
}

/** Register a finished top-level instance, or forget a failed one and its parts. */
function settle(inst: InstanceState, ok: boolean): void {
  const r = realm().registry
  if (ok) {
    if (!inst.parent) r.instances.push(inst)
    return
  }
  const drop = new Set<PartState>()
  const walk = (i: InstanceState) => {
    for (const m of i.made)
      if ('members' in m) walk(m)
      else drop.add(m)
  }
  walk(inst)
  if (drop.size) r.parts = r.parts.filter(p => !drop.has(p))
}

/** Take the members a build returns, by key, into the instance; a part's key is its local name, which a binding of another name contradicts. */
function adopt(inst: InstanceState, members: unknown, where: string): void {
  if (!members || typeof members !== 'object' || Array.isArray(members) || partOf(members) || instanceOf(members))
    throw new SchematicError(`${where} must give an object of parts, circuit instances and routes by key, such as { R01: R0603('10k').connect(…) }`)
  const seen = new Set<PartState | InstanceState>()
  for (const [k, v] of Object.entries(members)) {
    if (RESERVED.has(k)) throw new SchematicError(`${where}: the key ${JSON.stringify(k)} is reserved for the instance itself; rename the member`)
    if (!IDENT.test(k)) throw new SchematicError(`${where}: the key ${JSON.stringify(k)} must be an identifier such as "R01"`)
    if (isRouteNode(v)) {
      const owner = routeOwner(v)
      if (owner && owner !== inst) throw new SchematicError(`${where}: ${k}, a route, already belongs to the circuit instance ${pathOf(owner).join('/')}`)
      if (!ownRoute(v, k, inst)) throw new SchematicError(`${where}: a route is bound to another name but returned under the key ${k}; a route has one name`)
      inst.routes.set(k, v)
      continue
    }
    const st = partOf(v),
      child = instanceOf(v)
    const m: PartState | InstanceState | null = st ?? child
    if (!m) throw new SchematicError(`${where}: ${k} is neither a part, a circuit instance nor a route`)
    if (seen.has(m)) throw new SchematicError(`${where}: ${k} is the same ${st ? 'part' : 'instance'} as another key`)
    seen.add(m)
    if (st) {
      if (st.owner !== inst)
        throw new SchematicError(
          st.owner
            ? `${where}: ${k}, ${st.label}, already belongs to the circuit instance ${pathOf(st.owner).join('/')}`
            : `${where}: ${k}, ${st.label}, is made outside the build; make the parts of a circuit inside its build function`,
        )
      const own = st.explicitRef ?? st.boundRef
      if (own !== undefined && own !== k)
        throw new SchematicError(`${where}: ${st.label} is named ${own} but returned under the key ${k}; a part has one name, return it as { ${own} }`)
      st.key = k
    } else if (child!.parent !== inst)
      throw new SchematicError(
        child!.parent
          ? `${where}: ${k}, the instance ${pathOf(child!).join('/')}, already belongs to another circuit instance`
          : `${where}: ${k}, the instance ${child!.name}, is made outside the build; make nested circuit instances inside the build function`,
      )
    inst.members.set(k, m)
  }
  for (const m of inst.made)
    if (!seen.has(m)) {
      const what = 'members' in m ? `the instance ${m.name} of ${m.circuit}` : partOf(m.part)!.label
      throw new SchematicError(`${where}: ${what} is made in the build but not returned; return it under its name, such as { R01 }`)
    }
  const names = new Map<string, string>()
  for (const [k, m] of inst.members)
    if ('members' in m) {
      const other = names.get(m.name)
      if (other !== undefined) throw new SchematicError(`${where}: ${other} and ${k} are both instances named ${m.name}`)
      names.set(m.name, k)
    }
}

/** The ports as a build sees them: reading a port the caller left out throws, naming it. */
function portView(circuitName: string, ports: Record<string, Connection>): Record<string, Connection> {
  return new Proxy(ports, {
    get(t, k) {
      if (typeof k === 'symbol') return Reflect.get(t, k)
      if (k in t) return t[k]
      if (PROBES.has(k)) return undefined
      throw new SchematicError(`${circuitName}(…): the port ${k} is not connected; pass a Net, or NC for a port the circuit tolerates open`)
    },
    set() {
      throw new SchematicError(`${circuitName}: the ports are read-only`)
    },
  })
}

function checkPorts(circuitName: string, ports: unknown): Record<string, Connection> {
  if (ports === undefined || ports === null) return Object.freeze({}) as Record<string, Connection>
  if (typeof ports !== 'object' || Array.isArray(ports) || isNet(ports) || isNC(ports))
    throw new SchematicError(`${circuitName}(…) takes its ports as an object of nets, such as { VIN, VOUT: V5, GND }`)
  const out: Record<string, Connection> = {}
  for (const [k, v] of Object.entries(ports)) {
    if (k === '__src') continue
    if (v === undefined) continue
    if (!isNet(v) && !isNC(v))
      throw new SchematicError(`${circuitName}(…): the port ${k} needs a Net from nets() or NC, got ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    out[k] = v
  }
  return Object.freeze(out)
}

/** Define a circuit with ports and private nets, `circuit('channel', (ports, { nets }) => ({ R01, D01 }))`; each call makes an instance with an index. */
export function circuit<P extends object = {}, T extends CircuitMembers = CircuitMembers>(name: string, build: (ports: P, own: CircuitOwn) => T): Circuit<P, T>
export function circuit(name: string, build: unknown): any {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new SchematicError(`circuit(): the name ${JSON.stringify(name)} must be an identifier such as "buck"`)
  if (typeof build !== 'function') throw new SchematicError(`circuit(${JSON.stringify(name)}, build): build must be a function of the ports that returns the parts by name`)
  const def: any = function (ports?: unknown, index?: unknown) {
    const conn = checkPorts(name, ports)
    const id = indexName(name, index)
    const inst = newInstance(name, def, id.name, id.index, conn)
    const r = realm().registry
    r.building.push(inst)
    try {
      let out: unknown
      try {
        out = (build as Function)(portView(name, conn), { nets: inst.nets, local: inst.nets })
      } finally {
        r.building.pop()
      }
      adopt(inst, out, `the circuit ${name}`)
    } catch (e) {
      settle(inst, false)
      throw e
    }
    settle(inst, true)
    return (inst.instance = publicInstance(inst))
  }
  Object.defineProperty(def, 'name', { value: name })
  Object.defineProperty(def, '$$', { value: 'circuit-def' })
  Object.defineProperty(def, DEF, { value: true })
  Object.defineProperty(def, KEY, { value: keyHere(name) })
  Object.defineProperty(def, 'layout', { value: (render: (g: any, props: LayoutProps) => Child, name?: string) => layout(def, render, name) })
  return def
}

/** True for a circuit instance. */
export const isCircuitInstance = (v: unknown): v is CircuitInstance => !!instanceOf(v)
/** True for a circuit definition made by circuit() with a build function. */
export const isCircuit = (v: unknown): v is Circuit<any, any> => typeof v === 'function' && !!(v as any)[DEF]

/** The marker the flattener reads on a <g> a layout renders. */
export const LAYOUT_PROP = '__layout'
export interface LayoutMark {
  inst: InstanceState
  name: string
  /** the layout's key, `lib/led-channel.layout.tsx#LedChannelRow` */
  key: string
  src?: unknown
  /** the children of the layout element: one instance's own placements, each in place of the layout's placement of that part */
  own: unknown[]
  snap?: { pitch: number; maxLevel?: number }
  /** the element's `at` and `side`, which the render places the instance with; the compiler finds the `<g>` that takes this `at` */
  at?: unknown
  side?: unknown
}

/** A component placing one instance, `layout(buck, (g, { at }) => <g at={at}>…</g>)`; the name defaults to the render function's. */
export function layout<C extends Circuit<any, any> | CircuitInstanceBase<any>>(
  target: C,
  render: (g: InstanceOf<C>, props: LayoutProps) => Child,
  name?: string,
): Layout<InstanceOf<C>> {
  const one = instanceOf(target)
  if (!one && !isCircuit(target)) throw new SchematicError('layout() takes a circuit from circuit() or a circuit instance, then a render function')
  if (typeof render !== 'function') throw new SchematicError('layout(circuit, render): the render function is missing')
  const circuitName = one ? one.circuit : ((target as any).name as string)
  const lname = name ?? (render.name || `${circuitName}Layout`)
  const key = keyHere(lname)
  const fn: any = function (props: Record<string, any> = {}) {
    const { g, __src, children, ...rest } = props ?? {}
    const inst = instanceOf(g)
    if (!inst) throw new SchematicError(`<${lname}> needs g={…}, an instance of the circuit ${circuitName}`)
    if (one ? inst !== one : inst.def !== target)
      throw new SchematicError(
        `<${lname}> lays out ${one ? `the instance ${one.name}` : `the circuit ${circuitName}`}, but g is ${pathOf(inst).join('/')}, an instance of ${inst.circuit}`,
      )
    const own = children === undefined ? [] : [children].flat(Infinity).filter(c => c !== null && c !== undefined && c !== false)
    const mark: LayoutMark = { inst, name: lname, key, own, snap: placementSnap(rest.grid), at: rest.at, side: rest.side, ...(__src ? { src: __src } : {}) }
    return h('g', { [LAYOUT_PROP]: mark, ...(__src ? { __src } : {}) }, render(g, rest))
  }
  Object.defineProperty(fn, 'name', { value: lname })
  Object.defineProperty(fn, 'circuit', { value: circuitName })
  return fn
}
