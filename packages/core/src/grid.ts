// Named grids: `defineGrid(name, { pitch, minor, origin, angle, frame })`, attached on `<PCB grid>`, `<g grid>` and `<Schematic grid>`; see docs/grids.md.
import { isPart } from './part.js'
import { isPinRef } from './nets.js'
import { callerSite } from './provenance.js'
import { deg, mm } from './units.js'
import type { At, Length, PinRef, Rotation, Side, Src } from './types.js'

type Pt = [number, number]

/** A named point of a footprint from `defineFootprint(render, { points })`, read as `U1.points.center`; `at` in the footprint frame, mm. */
export interface FootprintPoint {
  readonly $$: 'point'
  readonly part: unknown
  readonly name: string
  readonly at: Pt
}

/** What a grid's origin function reads, in the frame the grid attaches to, mm and degrees. */
export interface GridResolver {
  pad(p: PinRef): { at: Pt }
  part(p: unknown): { at: Pt; rot: number; side: Side }
}

export interface GridSpec {
  /** maximum editing subdivision depth; default 2, zero uses only the main pitch */
  maxLevel?: number
  /** mm, or a unit string such as '100mil' */
  pitch: Length
  /** a factor, or a list for recursive subdivision, [2, 5] halves then tenths */
  minor?: number | readonly number[]
  /** a coordinate in the attaching frame in mm or explicit units, a pad handle, a footprint point, or a function of the placed parts */
  origin?: At | PinRef | FootprintPoint | ((r: GridResolver) => At)
  angle?: Rotation
  /** a part whose placed frame the grid adopts, its rotation and side with it */
  frame?: unknown
}

/** A component's editing pitch; coordinate units and enclosed geometry stay unchanged. */
export interface PlacementGrid {
  readonly snap: Length
  readonly maxLevel?: number
}

export interface Grid {
  /** optional editing pitch of the component attaching this grid; leaves its contents unchanged */
  readonly snap?: Length
  readonly maxLevel?: number
  readonly $$: 'grid'
  readonly name: string
  readonly spec: GridSpec
  readonly src?: Src
}

const NAME = /^[A-Za-z_][\w-]*$/

export const isGrid = (v: unknown): v is Grid => !!v && typeof v === 'object' && (v as Grid).$$ === 'grid'
export const isPoint = (v: unknown): v is FootprintPoint => !!v && typeof v === 'object' && (v as FootprintPoint).$$ === 'point'

/** A grid by name: positions under it are grid units, `at="3 4"` three and four pitches from its origin along its angle. */
export function defineGrid(name: string, spec: GridSpec): Grid {
  if (typeof name !== 'string' || !NAME.test(name)) throw new TypeError(`defineGrid(name, spec): the name ${JSON.stringify(name)} must be letters, digits, _ and -, such as "main"`)
  if (!spec || typeof spec !== 'object') throw new TypeError(`defineGrid("${name}", spec) needs { pitch }`)
  const bad = Object.keys(spec).filter(k => !['pitch', 'minor', 'origin', 'angle', 'frame', 'maxLevel', '__src'].includes(k))
  if (bad.length) throw new TypeError(`defineGrid("${name}"): unknown option ${bad.join(', ')}; it takes pitch, minor, origin, angle, frame and maxLevel`)
  const pitch = lengthOf(spec.pitch, `defineGrid("${name}") pitch`)
  if (!(pitch > 0)) throw new TypeError(`defineGrid("${name}") pitch must be positive, got ${JSON.stringify(spec.pitch)}`)
  subdivisionLimit(spec.maxLevel)
  minorOf({ name, spec } as Grid)
  if (spec.angle !== undefined) angleOf(spec.angle, `defineGrid("${name}") angle`)
  const o = spec.origin
  if (o !== undefined && typeof o !== 'string' && typeof o !== 'function' && !isPinRef(o) && !isPoint(o))
    throw new TypeError(`defineGrid("${name}") origin is a coordinate such as '10 5', a pad handle, a footprint point or a function, got ${JSON.stringify(o)}`)
  if (spec.frame !== undefined && !isPart(spec.frame)) throw new TypeError(`defineGrid("${name}") frame is a part, such as U1, whose placed frame the grid adopts`)
  const { __src: _, ...own } = spec as GridSpec & { __src?: unknown }
  const src = callerSite()
  return Object.freeze({ $$: 'grid' as const, name, spec: Object.freeze(own), ...(src ? { src } : {}) })
}

const lengthOf = (v: unknown, what: string): number => {
  try {
    return mm(v as Length)
  } catch (e) {
    throw new TypeError(`${what}: ${(e as Error).message}`)
  }
}
const angleOf = (v: unknown, what: string): number => {
  try {
    return deg(v as Rotation)
  } catch (e) {
    throw new TypeError(`${what}: ${(e as Error).message}`)
  }
}

/** The pitch in mm. */
export const gridPitch = (g: Grid): number => mm(g.spec.pitch)
/** The grid's own angle in degrees, before any frame. */
export const gridAngle = (g: Grid): number => deg(g.spec.angle ?? 0)

/** The subdivision factors, outermost first: `minor: 5` is [5], `[2, 5]` halves then fifths of a half. */
export function minorOf(g: Grid): number[] {
  const m = g.spec.minor
  if (m === undefined) return []
  const list = typeof m === 'number' ? [m] : Array.isArray(m) ? [...m] : null
  if (!list || !list.every(f => Number.isInteger(f) && f >= 2))
    throw new TypeError(`defineGrid("${g.name}") minor is a whole factor of at least 2, or a list of them such as [2, 5], got ${JSON.stringify(m)}`)
  return list
}

/** The built-in schematic grid, 100 mil, when `<Schematic>` names none. */
export const SCH_GRID: Grid = Object.freeze({ $$: 'grid' as const, name: 'sch', spec: Object.freeze({ pitch: '100mil' }) })

/** An `at` under a grid in mm: bare numbers of x and y are pitches, explicit units stay, the rotation and auto slots as written. */
export function gridAt(v: string, pitch: number): string {
  const t = v.trim().split(/\s+/)
  const scale = (s: string | undefined) => (s === undefined || s === 'auto' || /[a-z]\s*$/i.test(s) ? s : `${+(parseFloat(s) * pitch).toFixed(9)}`)
  return [scale(t[0]), scale(t[1]), ...t.slice(2)].filter(s => s !== undefined).join(' ')
}

/** The optional placement snapping pitch, independent of a named grid's coordinate units. */
export function placementSnap(value: unknown): { pitch: number; maxLevel?: number } | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || (!isGrid(value) && (Object.keys(value).some(k => !['snap', 'maxLevel'].includes(k)) || !('snap' in value))))
    throw new TypeError('placement grid needs { snap: length } or a named grid')
  const snap = (value as { snap?: Length }).snap
  if (snap === undefined) return undefined
  const pitch = mm(snap)
  if (!Number.isFinite(pitch) || pitch <= 0) throw new TypeError('placement grid snap must be a positive length')
  const maxLevel = (value as PlacementGrid).maxLevel
  subdivisionLimit(maxLevel)
  return { pitch, ...(maxLevel !== undefined ? { maxLevel } : {}) }
}

/** Bounded subdivision depth keeps grid matching and drawing finite. */
export function subdivisionLimit(value?: number): number {
  if (value === undefined) return 2
  if (!Number.isInteger(value) || value < 0 || value > 16) throw new TypeError('grid maxLevel must be an integer from 0 to 16')
  return value
}
