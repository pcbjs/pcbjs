// Nets, no-connects and pin handles as values, recognised by their `$$` brand; the schematic errors and their hints.
import { type InstanceState, instancePath } from './part.js'
import type { KindClearanceMM } from './model.js'
import type { Net, NetRules, NoConnect, PinRef } from './types.js'
import { type RuleSet, mergeRuleSets, ruleOverrides } from './netclass.js'
import { realm } from './realm.js'

const registry = () => realm().registry

const NET_META = Symbol.for('pcbjs.net.meta')

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

/** A pin left open on purpose: `Q1.connect({ 1: SIG, 2: NC, 3: SW })`. */
export const NC: NoConnect = Object.freeze({ $$: 'nc' as const })

export const isNet = (v: unknown): v is Net => !!v && typeof v === 'object' && (v as any).$$ === 'net' && typeof (v as any).name === 'string'
export const isNC = (v: unknown): v is NoConnect => !!v && typeof v === 'object' && (v as any).$$ === 'nc'
export const isPinRef = (v: unknown): v is PinRef => !!v && typeof v === 'object' && (v as any).$$ === 'pin' && typeof (v as any).pin === 'string'

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
