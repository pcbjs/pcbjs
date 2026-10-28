import type { ResolvedRules, Rules, ThermalRules } from './types.js'

/** Deep-freeze a plain object or array and return it. */
export function deepFreeze<T>(v: T): Readonly<T> {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Object.keys(v as object)) deepFreeze((v as any)[k])
  }
  return v
}

/** A deep copy of plain objects and arrays; functions, such as a RouteFn, and other objects are kept by reference. */
export function cloneData<T>(v: T): T {
  if (Array.isArray(v)) return v.map(cloneData) as T
  if (v && typeof v === 'object' && isPlain(v)) {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = cloneData(x)
    return o as T
  }
  return v
}
const isPlain = (v: object) => {
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

/** `base` with the defined keys of `overrides` on top; `thermal`, `edge` and the hole clearance sides merge key by key. */
export function mergeRules(base: Rules, ...overrides: (Partial<Rules> | null | undefined)[]): Rules {
  const out: Rules = { ...base }
  for (const o of overrides) {
    if (!o) continue
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue
      const was = (out as any)[k]
      if ((k === 'holeClearance' || k === 'minHoleToHole') && v && typeof v === 'object') {
        const sides = k === 'holeClearance' ? ['inner', 'outer'] : ['pad', 'via']
        ;(out as any)[k] = { ...(typeof was === 'number' ? Object.fromEntries(sides.map(s => [s, was])) : (was ?? {})), ...v }
        continue
      }
      ;(out as any)[k] = (k === 'thermal' || k === 'edge' || k === 'maskWebByColor') && was && v && typeof v === 'object' ? { ...was, ...v } : v
    }
    // a maskWeb given without a colour table overrides the colours below
    if (o.maskWeb !== undefined && o.maskWebByColor === undefined) delete out.maskWebByColor
  }
  return out
}

/** The rules with `maskWeb` picked by the mask colour from `maskWebByColor`, and the table dropped. */
export function withMaskColor<R extends Pick<Rules, 'maskWeb' | 'maskWebByColor'>>(r: R, color: string | undefined): R {
  if (!r.maskWebByColor) return r
  const { maskWebByColor: table, ...out } = r
  const hit = color === undefined ? undefined : Object.entries(table).find(([c]) => c.toLowerCase() === color.toLowerCase())
  return (hit ? { ...out, maskWeb: hit[1] } : out) as R
}

/** The cross-fab rule set: each minimum meets the strictest of JLCPCB, PCBWay, OSH Park, Eurocircuits 6C and Advanced PCB, checked 2026-10-23. */
export const BASE: Readonly<ResolvedRules> = deepFreeze({
  // OSH Park 2-layer 6 mil, the strictest of the five; the others accept 0.1 to 0.15
  clearance: 0.1524,
  minTrackWidth: 0.1524,
  // OSH Park keeps copper 15 mil (0.381) from the edge; 0.4 also clears a JLCPCB V-score
  edgeClearance: 0.4,
  // OSH Park asks 2 mil on 2-layer boards, JLCPCB takes 1:1; Advanced PCB's 0.076 is in its own preset
  maskExpansion: 0.05,
  pasteShrink: 0,
  zoneMinWidth: 0.25,
  // JLCPCB PTH to track 0.28 is the strictest, OSH Park 4-layer and Advanced PCB 0.254
  holeClearance: 0.3,
  // a 0.30 / 0.60 via with a 0.15 ring, above every fab minimum
  minViaDrill: 0.3,
  minViaDiameter: 0.6,
  // PCBWay and Eurocircuits 0.15, OSH Park and Advanced PCB 0.127, JLCPCB 0.05
  minAnnularRing: 0.15,
  // JLCPCB 2-layer PTH ring 0.18 absolute, 0.20 general; Advanced PCB 0.178
  minPadAnnularRing: 0.2,
  minDrill: 0.3,
  // JLCPCB pad hole to pad hole 0.45 is the strictest
  minHoleToHole: 0.5,
  // JLCPCB and PCBWay 0.15, OSH Park and Advanced PCB 0.127
  silkMinWidth: 0.15,
  // JLCPCB's smallest text height 1.0, PCBWay 0.8
  silkMinHeight: 1,
  // JLCPCB pad to silkscreen 0.15
  silkToPad: 0.15,
})

/** The finest clearance and track width on heavier outer copper by oz, JLCPCB's 2 oz figures read 2026-10; a weight between entries takes the lighter's. */
export const COPPER_WEIGHT_RULES: Readonly<Record<number, { clearance: number; minTrackWidth: number }>> = deepFreeze({
  2: { clearance: 0.16, minTrackWidth: 0.16 },
})

/** The figures of COPPER_WEIGHT_RULES for a copper weight in oz, or undefined when the weight needs none. */
export function copperWeightRule(oz: number): { oz: number; clearance: number; minTrackWidth: number } | undefined {
  let best: number | undefined
  for (const k of Object.keys(COPPER_WEIGHT_RULES).map(Number)) if (k <= oz + 1e-9 && (best === undefined || k > best)) best = k
  return best === undefined ? undefined : { oz: best, ...COPPER_WEIGHT_RULES[best] }
}

/** Thermal relief defaults, KiCad's: no fab preset documents its own, so every set inherits these. */
export const THERMAL: Readonly<ThermalRules> = deepFreeze({ gap: 0.5, spokeWidth: 0.5, spokes: 4, angle: 90, minSpokes: 2 })

/** The thermal relief rules of a rule set: its `thermal` keys over THERMAL. */
export function thermalRules(r: Pick<Rules, 'thermal'>): ThermalRules {
  return { ...THERMAL, ...Object.fromEntries(Object.entries(r.thermal ?? {}).filter(([, v]) => v !== undefined)) }
}

/** The via the compiler uses when a design gives no size: 0.3 / 0.6 mm, grown to meet the rules if they ask for more. */
export function defaultVia(r: Rules): { drill: number; size: number } {
  const drill = Math.max(0.3, r.minViaDrill, r.minDrill)
  return { drill, size: Math.round(Math.max(0.6, r.minViaDiameter, drill + 2 * r.minAnnularRing) * 1e4) / 1e4 }
}

/** Resolve hole clearances given by side to the larger side, keeping the sides in `holeClearanceBy` and `minHoleToHoleBy`. */
export function resolveRules(r: Rules): ResolvedRules {
  // a set resolved before has its sides made again from its values; the keys keep their order, which the route and tune cache keys hash
  const hc = r.holeClearance,
    hh = r.minHoleToHole
  const out = {} as ResolvedRules
  for (const [k, v] of Object.entries(r)) if (k !== 'holeClearanceBy' && k !== 'minHoleToHoleBy') (out as any)[k] = v
  if (typeof hc === 'object') {
    const inner = hc.inner ?? hc.outer ?? hc.via ?? 0,
      outer = hc.outer ?? hc.inner ?? hc.via ?? 0
    out.holeClearance = Math.max(inner, outer, hc.via ?? 0)
    out.holeClearanceBy = { inner, outer, ...(hc.via !== undefined ? { via: hc.via } : {}) }
  } else out.holeClearance = hc
  if (typeof hh === 'object') {
    const pad = hh.pad ?? hh.via ?? 0,
      via = hh.via ?? hh.pad ?? 0
    out.minHoleToHole = Math.max(pad, via)
    out.minHoleToHoleBy = { pad, via }
  } else out.minHoleToHole = hh
  return out
}

/** Hole to copper clearance on a layer: the via side from a via's hole, else the inner or outer side. */
export function holeClearanceOn(r: ResolvedRules, layer: string, hole: 'pad' | 'via' = 'pad'): number {
  const by = r.holeClearanceBy
  if (!by) return r.holeClearance
  if (hole === 'via' && by.via !== undefined) return by.via
  return layer === 'F.Cu' || layer === 'B.Cu' ? by.outer : by.inner
}

/** Hole to hole minimum: the via side between two vias. */
export function holeToHole(r: ResolvedRules, a: 'pad' | 'via', b: 'pad' | 'via'): number {
  return r.minHoleToHoleBy ? (a === 'via' && b === 'via' ? r.minHoleToHoleBy.via : r.minHoleToHoleBy.pad) : r.minHoleToHole
}
