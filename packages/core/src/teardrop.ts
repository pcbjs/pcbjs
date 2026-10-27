// The pass that draws teardrops is in @pcbjs/compile/teardrop.
import type { TeardropSpec } from './types.js'
import { mm } from './units.js'

/** A teardrop size: a fraction of the pad's smaller side, or a length in mm. */
export type TeardropSize = { ratio: number } | { mm: number }
/** Teardrop parameters with every field filled in. */
export interface ResolvedTeardrops { pads: 'tht' | 'smd' | 'all'; length: TeardropSize; width: TeardropSize }
/** A partial spec in resolved units, as a level gives it. */
export type TeardropLevel = Partial<ResolvedTeardrops>

/** KiCad's defaults: every pad, half the pad long, 0.9 wide so the wide end stays on the pad. */
export const TEARDROP_DEFAULTS: Readonly<ResolvedTeardrops> = { pads: 'all', length: { ratio: 0.5 }, width: { ratio: 0.9 } }

const KEYS = ['pads', 'length', 'width']

function size(v: unknown, at: string, k: string): TeardropSize {
  if (typeof v === 'number') {
    if (!(Number.isFinite(v) && v > 0 && v <= 4)) throw new Error(`${at}: teardrops ${k} must be a fraction of the pad size above 0 and at most 4, or a length such as '0.5mm', got ${v}`)
    return { ratio: v }
  }
  let n = NaN
  try { n = mm(v as string) } catch { /* reported below */ }
  if (typeof v !== 'string' || !(Number.isFinite(n) && n > 0)) throw new Error(`${at}: teardrops ${k} must be a fraction of the pad size such as 0.5, or a length such as '0.5mm', got ${JSON.stringify(v)}`)
  return { mm: n }
}

/** Check `teardrops` as a board, class or route gives it: true, false or a spec. Throws a plain Error naming `at`. */
export function checkTeardrops(v: unknown, at: string): boolean | TeardropLevel {
  if (typeof v === 'boolean') return v
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${at}: teardrops must be true, false or { pads?, length?, width? }, got ${JSON.stringify(v)}`)
  const o = v as TeardropSpec & Record<string, unknown>
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) throw new Error(`${at}: teardrops has an unknown field ${JSON.stringify(k)} (known: ${KEYS.join(', ')})`)
  const out: TeardropLevel = {}
  if (o.pads !== undefined) {
    if (o.pads !== 'tht' && o.pads !== 'smd' && o.pads !== 'all') throw new Error(`${at}: teardrops pads must be 'tht', 'smd' or 'all', got ${JSON.stringify(o.pads)}`)
    out.pads = o.pads
  }
  if (o.length !== undefined) out.length = size(o.length, at, 'length')
  if (o.width !== undefined) out.width = size(o.width, at, 'width')
  return out
}

/** Teardrops over the levels, lowest first: an object merges and turns them on, false turns them off. */
export function resolveTeardrops(levels: (boolean | TeardropLevel | undefined)[]): { on: boolean; spec: ResolvedTeardrops } {
  let on = false
  const spec: ResolvedTeardrops = { ...TEARDROP_DEFAULTS }
  for (const l of levels) {
    if (l === undefined) continue
    if (typeof l === 'boolean') { on = l; continue }
    on = true
    Object.assign(spec, l)
  }
  return { on, spec }
}
