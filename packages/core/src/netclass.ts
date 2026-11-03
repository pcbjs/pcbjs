// Classes merge by name, then field by field, base first: defaults, preset or target, <PCB classes>; lookups are in @pcbjs/compile.
import type { AutoRouteParams, Length, NetClass } from './types.js'
import { mm } from './units.js'
import type { KindClearanceMM } from './model.js'
import { clearanceValue, mergeClearance } from './clearance.js'
import { checkAutoroute, mergeAutoroute } from './board-spec.js'
import { checkTeardrops, type TeardropLevel } from './teardrop.js'

/** A net class with its lengths in mm and its defaults filled in. Layer names stay as written; flatten resolves them per route. */
export interface ResolvedNetClass {
  width?: number
  clearance?: number
  /** a clearance by the other item's kind, instead of `clearance`, for the class's tracks and vias */
  clearanceTo?: Omit<KindClearanceMM, 'self'>
  gap?: number
  impedance?: number
  /** default 0.1 */
  skew: number
  /** default 5 */
  uncoupled: number
  /** default 0.1 */
  tolerance: number
  via?: { drill?: number; size?: number }
  layers?: string[]
  autoroute?: Partial<AutoRouteParams>
  /** neck-down at the pads, mm */
  neck?: { width?: number; length?: number }
  /** the corner radius of manual commands, mm, or 'none' */
  corner?: number | 'none'
  /** false for none, else fields over the board's, {} for the board's own */
  teardrops?: false | TeardropLevel
  /** loops in the nets' copper are intended */
  loops?: boolean
}

export const CLASS_DEFAULTS = { skew: 0.1, uncoupled: 5, tolerance: 0.1 } as const
const CLASS_KEYS = new Set(['width', 'clearance', 'gap', 'impedance', 'skew', 'uncoupled', 'tolerance', 'via', 'layers', 'autoroute', 'neck', 'corner', 'teardrops', 'loops'])
const LENGTH_KEYS = ['width', 'gap', 'skew', 'uncoupled', 'tolerance'] as const

/** Check a class table as a level gives it. Throws a plain Error naming the level and the class. */
export function checkClasses(v: unknown, where: string): Record<string, NetClass> {
  if (v === undefined || v === null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${where} classes must be an object of class names to net classes`)
  for (const [name, c] of Object.entries(v as Record<string, unknown>)) {
    const at = `${where} class ${JSON.stringify(name)}`
    if (!name.trim()) throw new Error(`${where} classes: a class name must not be empty`)
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`${at} must be an object such as { width: 0.3 }`)
    const o = c as Record<string, unknown>
    for (const k of Object.keys(o)) if (!CLASS_KEYS.has(k)) throw new Error(`${at}: unknown field ${JSON.stringify(k)} (known: ${[...CLASS_KEYS].join(', ')})`)
    if (o.clearance !== undefined) clearanceValue(o.clearance, at, false)
    for (const k of LENGTH_KEYS)
      if (o[k] !== undefined) {
        let x: number
        try {
          x = mm(o[k] as Length)
        } catch (e) {
          throw new Error(`${at}: ${k}: ${(e as Error).message}`)
        }
        if (!(Number.isFinite(x) && (k === 'skew' || k === 'uncoupled' || k === 'tolerance' ? x >= 0 : x > 0)))
          throw new Error(`${at}: ${k} must be a ${k === 'width' || k === 'gap' ? 'positive' : 'non-negative'} length, got ${JSON.stringify(o[k])}`)
      }
    if (o.impedance !== undefined && !(typeof o.impedance === 'number' && Number.isFinite(o.impedance) && o.impedance > 0))
      throw new Error(`${at}: impedance must be a positive number of ohms, got ${JSON.stringify(o.impedance)}`)
    if (o.via !== undefined) {
      if (!o.via || typeof o.via !== 'object' || Array.isArray(o.via)) throw new Error(`${at}: via must be an object { drill?, size? }`)
      for (const [k, x] of Object.entries(o.via)) {
        if (k !== 'drill' && k !== 'size') throw new Error(`${at}: via has an unknown field ${JSON.stringify(k)}`)
        let n: number
        try {
          n = mm(x as Length)
        } catch (e) {
          throw new Error(`${at}: via ${k}: ${(e as Error).message}`)
        }
        if (!(n > 0)) throw new Error(`${at}: via ${k} must be positive, got ${JSON.stringify(x)}`)
      }
    }
    if (o.neck !== undefined) checkNeck(o.neck, at)
    if (o.corner !== undefined) checkCorner(o.corner, at)
    if (o.teardrops !== undefined) checkTeardrops(o.teardrops, at)
    if (o.layers !== undefined && !(Array.isArray(o.layers) && o.layers.length && o.layers.every(l => typeof l === 'string')))
      throw new Error(`${at}: layers must be a list of copper layer names`)
    if (o.autoroute !== undefined) checkAutoroute(o.autoroute, at)
    if (o.loops !== undefined && typeof o.loops !== 'boolean') throw new Error(`${at}: loops must be true or false, got ${JSON.stringify(o.loops)}`)
  }
  return v as Record<string, NetClass>
}

/** Check a neck-down spec `{ width?, length? }`: width positive, length non-negative. Throws a plain Error naming `at`. */
export function checkNeck(v: unknown, at: string): { width?: number; length?: number } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${at}: neck must be an object { width?, length? }`)
  const out: { width?: number; length?: number } = {}
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue
    if (k !== 'width' && k !== 'length') throw new Error(`${at}: neck has an unknown field ${JSON.stringify(k)}, it takes width and length`)
    let n: number
    try {
      n = mm(x as Length)
    } catch (e) {
      throw new Error(`${at}: neck ${k}: ${(e as Error).message}`)
    }
    if (!(Number.isFinite(n) && (k === 'width' ? n > 0 : n >= 0)))
      throw new Error(`${at}: neck ${k} must be a ${k === 'width' ? 'positive' : 'non-negative'} length, got ${JSON.stringify(x)}`)
    out[k] = n
  }
  return out
}

/** Check a corner radius: a positive length or 'none'. Throws a plain Error naming `at`. */
export function checkCorner(v: unknown, at: string): number | 'none' {
  if (v === 'none') return 'none'
  let n = NaN
  try {
    n = mm(v as Length)
  } catch (e) {
    throw new Error(`${at}: corner: ${(e as Error).message}`)
  }
  if (!(Number.isFinite(n) && n > 0)) throw new Error(`${at}: corner must be a positive length or 'none', got ${JSON.stringify(v)}`)
  return n
}

/** Class tables merged lowest first: by class name, then field by field; `via` merges its keys, `autoroute` like the board's. */
export function mergeClasses(...levels: (Record<string, NetClass> | null | undefined)[]): Record<string, NetClass> {
  const out: Record<string, NetClass> = {}
  for (const l of levels) {
    if (!l) continue
    for (const [name, c] of Object.entries(l)) {
      if (!c) continue
      const prev: Record<string, any> = { ...(out[name] ?? {}) }
      for (const [k, v] of Object.entries(c)) {
        if (v === undefined) continue
        if (k === 'via' || k === 'neck') prev[k] = { ...(prev[k] ?? {}), ...(v as object) }
        else if (k === 'autoroute') prev.autoroute = mergeAutoroute(prev.autoroute ?? {}, v as object)
        else if (k === 'layers') prev.layers = [...(v as string[])]
        else if (k === 'clearance') prev.clearance = mergeClearance(prev.clearance, v as number | object)
        else if (k === 'teardrops') prev.teardrops = v && typeof v === 'object' && prev.teardrops && typeof prev.teardrops === 'object' ? { ...prev.teardrops, ...v } : v
        else prev[k] = v
      }
      out[name] = prev as NetClass
    }
  }
  return out
}

/** A class table in mm with the defaults filled in. */
export function resolveClasses(t: Record<string, NetClass>): Record<string, ResolvedNetClass> {
  const out: Record<string, ResolvedNetClass> = {}
  for (const [name, c] of Object.entries(t)) {
    const r: ResolvedNetClass = {
      skew: c.skew !== undefined ? mm(c.skew) : CLASS_DEFAULTS.skew,
      uncoupled: c.uncoupled !== undefined ? mm(c.uncoupled) : CLASS_DEFAULTS.uncoupled,
      tolerance: c.tolerance !== undefined ? mm(c.tolerance) : CLASS_DEFAULTS.tolerance,
    }
    if (c.width !== undefined) r.width = mm(c.width)
    if (c.clearance !== undefined) {
      const v = clearanceValue(c.clearance, `class ${JSON.stringify(name)}`, false)
      if (typeof v === 'number') r.clearance = v
      else r.clearanceTo = v as ResolvedNetClass['clearanceTo']
    }
    if (c.gap !== undefined) r.gap = mm(c.gap)
    if (c.impedance !== undefined) r.impedance = c.impedance
    if (c.via) r.via = { ...(c.via.drill !== undefined ? { drill: mm(c.via.drill) } : {}), ...(c.via.size !== undefined ? { size: mm(c.via.size) } : {}) }
    if (c.layers) r.layers = [...c.layers]
    if (c.neck) r.neck = checkNeck(c.neck, `class ${JSON.stringify(name)}`)
    if (c.corner) r.corner = checkCorner(c.corner, `class ${JSON.stringify(name)}`)
    if (c.teardrops !== undefined) {
      const t = checkTeardrops(c.teardrops, `class ${JSON.stringify(name)}`)
      r.teardrops = t === true ? {} : t
    }
    if (c.autoroute && Object.keys(c.autoroute).length) r.autoroute = { ...c.autoroute }
    if (c.loops) r.loops = true
    out[name] = r
  }
  return out
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
