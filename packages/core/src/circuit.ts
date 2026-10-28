// State lives on globalThis and instances are recognised by a Symbol.for key, never instanceof: the CLI's copy compiles what Vite's copy made.
import { h } from './jsx-runtime.js'
import type { At, Child, Connection, Net, NoConnect, PcbNode, Side } from './types.js'
import {
  INSTANCE_STATE,
  PROBES,
  SchematicError,
  callerSite,
  instanceOf,
  isNC,
  isNet,
  netProxy,
  partOf,
  schematicRegistry,
  type InstanceState,
  type PartState,
} from './schematic.js'

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

/** What a circuit holds: parts and nested circuit instances or groups, by key. */
export type CircuitMembers = { readonly [key: string]: { readonly $$: 'part' } | GroupBase }

/** The fixed properties of every circuit instance and every group. */
export interface GroupBase {
  readonly $$: 'circuit'
  /** given by `named()`, the call, group() or its key in another circuit, else the circuit name plus a counter */
  readonly name: string
  /** the circuit() name, or "group" for a group */
  readonly circuit: string
  /** the instance path, outermost first, such as ['Power', 'LDO'] */
  readonly path: readonly string[]
}

/** A group: the object given to group() plus `name`, `circuit` and `path`. */
export type Group<T extends object> = T & GroupBase

/** The fixed properties of every circuit instance. */
export interface CircuitInstanceBase<P = {}> extends GroupBase {
  /** the nets the caller connected to the ports */
  readonly ports: Readonly<P>
  /** private nets, `Buck1.nets.FB` is `Buck1/FB` */
  readonly nets: NetsProxy
}

/** A circuit instance: the members by key, `Buck1.R1`, plus `name`, `circuit`, `path`, `ports` and `nets`. */
export type CircuitInstance<T extends CircuitMembers = CircuitMembers, P = {}> = CircuitInstanceBase<P> & { readonly [K in keyof T]: T[K] }

type CallArgs<P> = {} extends P ? [ports?: P, name?: string] : [ports: P, name?: string]

/** A circuit definition: call it with the port nets and an optional name to make an instance. */
export interface Circuit<P = {}, T extends CircuitMembers = CircuitMembers> {
  (...args: CallArgs<P>): CircuitInstance<T, P>
  /** the same circuit naming its instance: `buck.named('Buck1')({ VIN, VOUT, GND })` */
  named(name: string): {} extends P ? (ports?: P) => CircuitInstance<T, P> : (ports: P) => CircuitInstance<T, P>
  /** the circuit() name */
  readonly name: string
  readonly $$: 'circuit-def'
}

/** The props of a layout: where it goes, and anything else the render function takes. */
export interface LayoutProps {
  at?: At
  side?: Side
  [k: string]: any
}

/** The instance type of a circuit definition. */
export type InstanceOf<C> = C extends Circuit<infer P, infer T> ? CircuitInstance<T, P> : C extends GroupBase ? C : never

/** A component that places one instance, `<BuckCompact g={Buck1} at="10 10" />`. */
export interface Layout<I = CircuitInstance<any, any>> {
  (props: { g: I } & LayoutProps): PcbNode
  /** the layout name, which the viewer shows */
  readonly name: string
  /** the circuit() name it lays out */
  readonly circuit: string
}

const DEF = Symbol.for('pcbjs.circuit.def')
const IDENT = /^[A-Za-z_]\w*$/
const RESERVED = new Set(['$$', 'name', 'circuit', 'path', 'ports', 'nets'])

const checkName = (where: string, name: unknown): string => {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new SchematicError(`${where}: the instance name ${JSON.stringify(name)} must be an identifier such as "Buck1"`)
  return name
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
  for (const [k, m] of inst.members) Object.defineProperty(pub, k, { value: 'members' in m ? m.instance : m.part, enumerable: true })
  return Object.freeze(pub)
}
const pathOf = (i: InstanceState): string[] => {
  const out: string[] = []
  for (let x: InstanceState | null = i; x; x = x.parent) out.unshift(x.name)
  return out
}

/** A new instance state, registered with its parent's build or, at the top, with the registry. */
function newInstance(circuitName: string, def: object | null, form: InstanceState['form'], name: string | undefined, ports: Record<string, Connection>): InstanceState {
  const r = schematicRegistry()
  const parent = r.building.at(-1) ?? null
  const src = callerSite()
  const inst: InstanceState = {
    seq: ++r.seq,
    circuit: circuitName,
    def,
    name: name ?? '',
    explicitName: name !== undefined,
    parent,
    members: new Map(),
    ports,
    form,
    src,
    declFile: parent ? parent.declFile : src?.file,
    instance: null,
    nets: null!,
    made: [],
  }
  inst.nets = netProxy(undefined, inst)
  if (parent) {
    parent.made.push(inst)
    // provisional until the parent's build returns its key
    if (name === undefined) inst.name = `${circuitName}${parent.made.filter(m => 'members' in m && m.circuit === circuitName).length}`
  } else {
    const file = inst.declFile
    if (file !== undefined) {
      // a module evaluated again in dev replaces the instances it made before
      if ((r.instanceEpoch.get(file) ?? -1) < r.epoch) r.instances = r.instances.filter(i => i.declFile !== file)
      r.instanceEpoch.set(file, r.epoch)
    }
    if (name === undefined) {
      const used = new Set(r.instances.filter(i => i.circuit === circuitName && !i.parent).map(i => i.name))
      let k = 1
      while (used.has(`${circuitName}${k}`)) k++
      inst.name = `${circuitName}${k}`
    }
  }
  return inst
}

/** Register a finished top-level instance, or forget a failed one and its parts. */
function settle(inst: InstanceState, ok: boolean): void {
  const r = schematicRegistry()
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

/** Take the members a build or the object form gives, by key, into the instance. */
function adopt(inst: InstanceState, members: unknown, where: string, fresh: boolean): void {
  if (!members || typeof members !== 'object' || Array.isArray(members) || partOf(members) || instanceOf(members))
    throw new SchematicError(`${where} must give an object of parts and circuit instances by key, such as { R1: R0603('10k').connect(…) }`)
  const seen = new Set<PartState | InstanceState>()
  for (const [k, v] of Object.entries(members)) {
    if (RESERVED.has(k)) throw new SchematicError(`${where}: the key ${JSON.stringify(k)} is reserved for the instance itself; rename the member`)
    if (!IDENT.test(k)) throw new SchematicError(`${where}: the key ${JSON.stringify(k)} must be an identifier such as "R1"`)
    const st = partOf(v),
      child = instanceOf(v)
    const m: PartState | InstanceState | null = st ?? child
    if (!m) throw new SchematicError(`${where}: ${k} is neither a part nor a circuit instance`)
    if (seen.has(m)) throw new SchematicError(`${where}: ${k} is the same ${st ? 'part' : 'instance'} as another key`)
    seen.add(m)
    if (st) {
      if (fresh ? st.owner !== inst : st.owner !== undefined)
        throw new SchematicError(
          st.owner
            ? `${where}: ${k}, ${st.label}, already belongs to the circuit instance ${pathOf(st.owner).join('/')}`
            : `${where}: ${k}, ${st.label}, is made outside the build; make the parts of a circuit inside its build function`,
        )
      st.owner = inst
      st.key = k
    } else {
      const c = child!
      if (fresh ? c.parent !== inst : c.parent !== null)
        throw new SchematicError(
          c.parent
            ? `${where}: ${k}, the instance ${pathOf(c).join('/')}, already belongs to another circuit instance`
            : `${where}: ${k}, the instance ${c.name}, is made outside the build; make nested circuit instances inside the build function`,
        )
      if (!fresh) {
        const r = schematicRegistry()
        c.parent = inst
        r.instances = r.instances.filter(i => i !== c)
      }
      if (!c.explicitName) c.name = k
    }
    inst.members.set(k, m)
  }
  // a member a group in the build took belongs to that group
  if (fresh)
    for (const m of inst.made)
      if (!seen.has(m) && ('members' in m ? m.parent === inst : m.owner === inst)) {
        const what = 'members' in m ? `the instance ${m.name} of ${m.circuit}` : partOf(m.part)!.label
        throw new SchematicError(`${where}: ${what} is made in the build but not returned; return it under a key, such as { R1: … }`)
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

/** Define a circuit with ports and private nets, `circuit('buck', (ports, { nets }) => ({ U1, R1 }))`, or the object form for parts made beforehand. */
export function circuit<P extends object = {}, T extends CircuitMembers = CircuitMembers>(name: string, build: (ports: P, own: CircuitOwn) => T): Circuit<P, T>
export function circuit<T extends CircuitMembers>(name: string, members: T): CircuitInstance<T, {}>
export function circuit(name: string, build: unknown): any {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new SchematicError(`circuit(): the name ${JSON.stringify(name)} must be an identifier such as "buck"`)
  if (typeof build !== 'function') {
    // the object form: one instance of parts made beforehand
    const inst = newInstance(name, null, 'object', name, Object.freeze({}) as Record<string, Connection>)
    try {
      adopt(inst, build, `circuit(${JSON.stringify(name)}, { … })`, false)
    } catch (e) {
      settle(inst, false)
      throw e
    }
    settle(inst, true)
    // it sits where its first member was declared, for the numbering
    const seqs = [...inst.members.values()].map(m => m.seq)
    if (seqs.length) inst.seq = Math.min(...seqs)
    return (inst.instance = publicInstance(inst))
  }
  const make = (ports: unknown, instName: string | undefined): any => {
    const conn = checkPorts(name, ports)
    if (instName !== undefined) checkName(`${name}(…)`, instName)
    const inst = newInstance(name, def, 'build', instName, conn)
    const r = schematicRegistry()
    r.building.push(inst)
    try {
      let out: unknown
      try {
        out = (build as Function)(portView(name, conn), { nets: inst.nets, local: inst.nets })
      } finally {
        r.building.pop()
      }
      adopt(inst, out, `the circuit ${name}`, true)
    } catch (e) {
      settle(inst, false)
      throw e
    }
    settle(inst, true)
    return (inst.instance = publicInstance(inst))
  }
  const def: any = function (ports?: unknown, instName?: unknown) {
    if (instName !== undefined && typeof instName !== 'string') throw new SchematicError(`${name}(ports, name): the name must be a string`)
    return make(ports, instName as string | undefined)
  }
  Object.defineProperty(def, 'name', { value: name })
  Object.defineProperty(def, '$$', { value: 'circuit-def' })
  Object.defineProperty(def, DEF, { value: true })
  Object.defineProperty(def, 'named', {
    value: (instName: string) => {
      checkName(`${name}.named`, instName)
      return (ports?: unknown) => make(ports, instName)
    },
  })
  return def
}

const GROUP_RESERVED = new Set(['$$', 'name', 'circuit', 'path'])

/** Name the parts of a plain object, `group('P1', { J, SW })`, so findings say `P1/SW`; no ports, refs stay flat, returns the object. */
export function group<T extends object>(name: string, members: T): Group<T> {
  checkName('group()', name)
  const where = `group(${JSON.stringify(name)}, { … })`
  if (!members || typeof members !== 'object' || Array.isArray(members) || partOf(members) || instanceOf(members) || isNet(members))
    throw new SchematicError(`${where} takes an object of parts by key, such as { J: USB3A(…), SW: TPS2065C(…) }`)
  const r = schematicRegistry()
  const inst = newInstance('group', null, 'object', name, Object.freeze({}) as Record<string, Connection>)
  try {
    if (inst.parent) {
      const twin = inst.parent.made.find(m => m !== inst && 'members' in m && m.name === name && m.circuit === 'group')
      if (twin) throw new SchematicError(`${where}: the group ${name} is already made in this circuit, at ${site(twin as InstanceState)}; give each group its own name`)
    } else {
      const twin = r.instances.find(i => !i.parent && i.name === name && i.declFile === inst.declFile)
      if (twin)
        throw new SchematicError(
          `${where}: the name ${name} is already taken by ${twin.circuit === 'group' ? 'the group' : `the instance of ${twin.circuit}`} at ${site(twin)}; give each group its own name`,
        )
    }
    const building = inst.parent
    const seen = new Set<PartState | InstanceState>()
    const take = (k: string, v: unknown): void => {
      const st = partOf(v),
        child = instanceOf(v)
      if (st) {
        if (seen.has(st)) throw new SchematicError(`${where}: ${k} is the same part as another key`)
        if (st.owner !== undefined && st.owner !== building) throw new SchematicError(`${where}: ${k}, ${st.label}, already belongs to ${pathOf(st.owner).join('/')}`)
        seen.add(st)
        st.owner = inst
        st.key = k
        inst.members.set(k, st)
      } else if (child) {
        if (child === inst || seen.has(child)) throw new SchematicError(`${where}: ${k} is the same instance as another key`)
        if (child.parent !== building)
          throw new SchematicError(
            child.parent
              ? `${where}: ${k}, ${pathOf(child).join('/')}, already belongs to ${pathOf(child.parent).join('/')}`
              : `${where}: ${k}, the instance ${child.name}, is made outside the circuit build this group is made in`,
          )
        seen.add(child)
        if (!building) r.instances = r.instances.filter(i => i !== child)
        child.parent = inst
        if (!child.explicitName) child.name = k
        inst.members.set(k, child)
      } else if (Array.isArray(v)) v.forEach((e, i) => take(`${k}[${i}]`, e))
    }
    for (const [k, v] of Object.entries(members)) {
      const named = partOf(v) || instanceOf(v) || Array.isArray(v)
      if (GROUP_RESERVED.has(k)) throw new SchematicError(`${where}: the key ${JSON.stringify(k)} is reserved for the group itself; rename the field`)
      if (named && !IDENT.test(k)) throw new SchematicError(`${where}: the key ${JSON.stringify(k)} must be an identifier such as "SW"`)
      take(k, v)
    }
    const names = new Map<string, string>()
    for (const [k, m] of inst.members)
      if ('members' in m) {
        const other = names.get(m.name)
        if (other !== undefined) throw new SchematicError(`${where}: ${other} and ${k} are both instances named ${m.name}`)
        names.set(m.name, k)
      }
  } catch (e) {
    settle(inst, false)
    throw e
  }
  settle(inst, true)
  const seqs = [...inst.members.values()].map(m => m.seq)
  if (seqs.length) inst.seq = Math.min(...seqs)
  // the object itself unless frozen; the instance properties are not enumerable
  const out: any = Object.isExtensible(members) ? members : { ...members }
  Object.defineProperty(out, INSTANCE_STATE, { value: inst })
  Object.defineProperty(out, '$$', { value: 'circuit' })
  Object.defineProperty(out, 'name', { get: () => inst.name })
  Object.defineProperty(out, 'circuit', { value: 'group' })
  Object.defineProperty(out, 'path', { get: () => pathOf(inst) })
  return (inst.instance = out)
}
const site = (i: InstanceState) => (i.src ? `${i.src.file}:${i.src.line}` : 'another call')

/** True for a circuit instance. */
export const isCircuitInstance = (v: unknown): v is CircuitInstance => !!instanceOf(v)
/** True for a circuit definition made by circuit() with a build function. */
export const isCircuit = (v: unknown): v is Circuit<any, any> => typeof v === 'function' && !!(v as any)[DEF]

/** The marker the flattener reads on a <g> a layout renders. */
export const LAYOUT_PROP = '__layout'
export interface LayoutMark {
  inst: InstanceState
  name: string
  src?: unknown
}

/** A component placing one instance, `layout(buck, (g, { at }) => <g at={at}>…</g>)`; the name defaults to the render function's. */
export function layout<C extends Circuit<any, any> | GroupBase>(target: C, render: (g: InstanceOf<C>, props: LayoutProps) => Child, name?: string): Layout<InstanceOf<C>> {
  const one = instanceOf(target)
  if (!one && !isCircuit(target)) throw new SchematicError('layout() takes a circuit from circuit() or a circuit instance, then a render function')
  if (typeof render !== 'function') throw new SchematicError('layout(circuit, render): the render function is missing')
  const circuitName = one ? one.circuit : ((target as any).name as string)
  const lname = name ?? (render.name || `${circuitName}Layout`)
  const fn: any = function (props: Record<string, any> = {}) {
    const { g, __src, ...rest } = props ?? {}
    const inst = instanceOf(g)
    if (!inst) throw new SchematicError(`<${lname}> needs g={…}, an instance of the circuit ${circuitName}`)
    if (one ? inst !== one : inst.def !== target)
      throw new SchematicError(
        `<${lname}> lays out ${one ? `the instance ${one.name}` : `the circuit ${circuitName}`}, but g is ${pathOf(inst).join('/')}, an instance of ${inst.circuit}`,
      )
    const mark: LayoutMark = { inst, name: lname, ...(__src ? { src: __src } : {}) }
    return h('g', { [LAYOUT_PROP]: mark, ...(__src ? { __src } : {}) }, render(g, rest))
  }
  Object.defineProperty(fn, 'name', { value: lname })
  Object.defineProperty(fn, 'circuit', { value: circuitName })
  return fn
}
