import { ANGLE_UNITS, LENGTH_UNITS, NUM_RE, angleDeg, formatToken, lengthMm, parseToken, type AtValue, type Token } from '@pcbjs/core/internal/units'
import { isCopper, LAYER_IDS } from '@pcbjs/core/internal/layers'

/** The token with `mm` millimetres, in the unit it was written in. */
export function withMm(t: Token, mm: number): Token {
  const k = LENGTH_UNITS[t.unit] ?? 1
  return { num: mm / k, unit: t.unit }
}

export function withDeg(t: Token, deg: number): Token {
  const k = ANGLE_UNITS[t.unit] ?? 1
  return { num: deg / k, unit: t.unit }
}

/** Move by dx, dy millimetres, each field in its own unit. */
export function nudgeAt(a: AtValue, dx: number, dy: number): AtValue {
  return { ...a, x: withMm(a.x, (lengthMm(a.x) ?? 0) + dx), y: withMm(a.y, (lengthMm(a.y) ?? 0) + dy) }
}

/** Turn by `by` degrees, normalised to [0, 360). A missing rotation is added in the style of the other fields. */
export function rotateAt(a: AtValue, by: number): AtValue {
  const cur = a.rot ?? { num: 0, unit: a.x.unit || a.y.unit ? 'deg' : '' }
  const deg = ((((angleDeg(cur) ?? 0) + by) % 360) + 360) % 360
  return { ...a, rot: withDeg(cur, deg) }
}

/** Set one field from what the user typed: a bare number keeps the unit of the field, a number with a unit replaces it. */
export function setAtField(a: AtValue, field: 'x' | 'y' | 'rot', typed: string): AtValue | undefined {
  const t = parseToken(typed)
  if (!t) return undefined
  const old = field === 'rot' ? (a.rot ?? { num: 0, unit: a.x.unit || a.y.unit ? 'deg' : '' }) : a[field]
  const next = t.unit ? t : { num: t.num, unit: old.unit }
  if (field === 'rot' ? angleDeg(next) === undefined : lengthMm(next) === undefined) return undefined
  return { ...a, [field]: next }
}

export interface PointValue {
  x: Token
  y: Token
  layer?: string
  sep: string
}

export function parsePoint(s: string): PointValue | undefined {
  const trimmed = s.trim()
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length < 2 || parts.length > 3) return undefined
  const x = parseToken(parts[0])
  const y = parseToken(parts[1])
  if (!x || !y || lengthMm(x) === undefined || lengthMm(y) === undefined) return undefined
  const sep = /^\S+(\s+)/.exec(trimmed)?.[1] ?? ' '
  return parts[2] ? { x, y, layer: parts[2], sep } : { x, y, sep }
}

export function formatPoint(p: PointValue): string {
  const parts = [formatToken(p.x), formatToken(p.y)]
  if (p.layer) parts.push(p.layer)
  return parts.join(p.sep)
}

/** True when a route end string is a coordinate: its first token is a number. `"D1.K"` is a pad. */
export function isCoordinate(s: string): boolean {
  return NUM_RE.test(s.trim()) && !!parsePoint(s)
}

const SIDE_FLIP: Record<string, string> = { F: 'B', B: 'F' }

/** F to B and back. */
export function toggleSide(s: string): string | undefined {
  return SIDE_FLIP[s]
}

export interface LayerInfo {
  name: string
  copper: boolean
}

export const STANDARD_LAYERS: LayerInfo[] = LAYER_IDS.map(name => ({ name, copper: isCopper(name) }))

/** The layers to offer: the board's own when the server reported them, else the standard set. Copper only when asked. */
export function layerChoices(boardLayers: string[] | undefined, copperOnly: boolean): LayerInfo[] {
  let list = STANDARD_LAYERS
  if (boardLayers?.length) {
    list = boardLayers.map(name => STANDARD_LAYERS.find(l => l.name === name) ?? { name, copper: isCopper(name) })
  }
  return copperOnly ? list.filter(l => l.copper) : list
}

/** The layer id `name` is, as written, undefined when it is none. */
export function canonicalLayer(name: string): string | undefined {
  return LAYER_IDS.includes(name) ? name : undefined
}

export interface Range {
  min: number
  max: number
  step: number
}

const TRACKISH = new Set(['route', 'via', 'pour'])

/** Slider range in mm for a numeric kind, by the element or call it sits on, widened to include the current value. */
export function numericRange(kind: string, owner: string | undefined, current?: number): Range {
  const o = (owner ?? '').toLowerCase()
  let r: [number, number]
  if (kind === 'width') r = TRACKISH.has(o) ? [0.1, 2] : [0.05, 2]
  else if (kind === 'size') r = o === 'text' ? [0.5, 5] : o === 'pad' || o === 'via' ? [0.2, 5] : [0.1, 10]
  else if (kind === 'drill') r = [0.2, 3]
  else if (kind === 'thickness') r = o === 'pcb' || o === 'board' ? [0.4, 3.2] : [0.05, 1]
  else r = [0, 10]
  let [min, max] = r
  if (current !== undefined && Number.isFinite(current)) {
    if (current < min) min = Math.max(0, Math.floor(current * 20) / 20)
    if (current > max) max = Math.ceil(current * 20) / 20
  }
  return { min, max, step: 0.05 }
}
