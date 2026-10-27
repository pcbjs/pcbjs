// The resolution between two items is in @pcbjs/compile netclass.ts.
import type { Length } from './types.js'
import type { KindClearanceMM } from './model.js'
import { mm } from './units.js'

/** The kinds of the other item a clearance may name. */
export const CLEARANCE_KINDS = ['pad', 'track', 'via', 'zone', 'text'] as const

/** A clearance checked and in mm: a length, or lengths by the other item's kind, `self` allowed when `self`; throws naming `where`. */
export function clearanceValue(v: unknown, where: string, self: boolean): number | KindClearanceMM {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys: readonly string[] = self ? [...CLEARANCE_KINDS, 'self'] : CLEARANCE_KINDS
    const out: KindClearanceMM = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined || k === '__src') continue
      if (!keys.includes(k)) throw new Error(`${where}: clearance has an unknown kind ${JSON.stringify(k)}; it takes ${keys.join(', ')}`)
      if (k === 'pad' && x && typeof x === 'object' && !Array.isArray(x)) { out.pad = padTypes(x as Record<string, unknown>, where); continue }
      out[k as keyof KindClearanceMM] = length(x, `${where}: clearance ${k}`)
    }
    if (!Object.keys(out).length) throw new Error(`${where}: clearance must name a kind, such as { track: 0.4 }; it takes ${keys.join(', ')}`)
    return out
  }
  return length(v, `${where}: clearance`)
}

/** The pad types a clearance toward pads may name, KiCad's Pad_Type 'Through-hole' and 'SMD'. */
export const PAD_TYPES = ['tht', 'smd'] as const

/** Check a clearance toward pads by their type, `{ tht: 0.5, smd: 0.2 }`, and give it in mm. */
function padTypes(v: Record<string, unknown>, where: string): { tht?: number; smd?: number } {
  const out: { tht?: number; smd?: number } = {}
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue
    if (!(PAD_TYPES as readonly string[]).includes(k)) throw new Error(`${where}: clearance pad has an unknown pad type ${JSON.stringify(k)}; it takes ${PAD_TYPES.join(', ')}`)
    out[k as 'tht' | 'smd'] = length(x, `${where}: clearance pad ${k}`)
  }
  if (!Object.keys(out).length) throw new Error(`${where}: clearance pad must name a pad type, such as { tht: 0.5 }; it takes ${PAD_TYPES.join(', ')}`)
  return out
}

function length(x: unknown, at: string): number {
  let n: number
  try { n = mm(x as Length) } catch (e) { throw new Error(`${at}: ${(e as Error).message}`) }
  if (!(Number.isFinite(n) && n >= 0)) throw new Error(`${at} must be a non-negative length, got ${JSON.stringify(x)}`)
  return n
}

/** A clearance over a lower level's: two objects merge kind by kind, anything else replaces. */
export function mergeClearance<T extends number | object | undefined>(lower: T, upper: T): T {
  if (upper === undefined) return lower
  if (lower && typeof lower === 'object' && typeof upper === 'object') return { ...lower, ...upper }
  return upper
}
