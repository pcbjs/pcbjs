import type { At, Length, Rotation } from './types.js'

/** mm per unit, the input units of pcbjs. A bare number is mm. */
export const LENGTH_UNITS: Readonly<Record<string, number>> = { '': 1, mm: 1, cm: 10, m: 1000, mil: 0.0254, in: 25.4, um: 0.001, nm: 1e-6 }
/** degrees per unit. A bare number is degrees. */
export const ANGLE_UNITS: Readonly<Record<string, number>> = { '': 1, deg: 1, rad: 180 / Math.PI }

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`
/** A number at the start of a string. */
export const NUM_RE = new RegExp(`^${NUMBER}`)
const TOKEN = new RegExp(`^(${NUMBER})([a-zA-Z]*)$`)
const SPACED = new RegExp(String.raw`^(${NUMBER})\s+([a-zA-Z]+)$`)

/** A number token as written, its unit right after it: `12.5mm` is { num: 12.5, unit: 'mm' }. */
export interface Token {
  num: number
  unit: string
}

export function parseToken(s: string): Token | undefined {
  const m = TOKEN.exec(s.trim())
  return m ? { num: parseFloat(m[1]), unit: m[2] } : undefined
}

/** A number as a JavaScript literal writes it: no unit, no plus sign, no space. */
export const isPlainNumber = (s: string): boolean => s === s.trim() && !s.startsWith('+') && parseToken(s)?.unit === ''

/** A number without float noise: at most `digits` decimals, no trailing zeros, never `-0`. */
export function formatNum(n: number, digits = 4): string {
  const r = parseFloat(n.toFixed(digits))
  return Object.is(r, -0) || r === 0 ? '0' : String(r)
}

export const formatToken = (t: Token): string => formatNum(t.num) + t.unit

export function lengthMm(t: Token): number | undefined {
  const k = LENGTH_UNITS[t.unit]
  return k === undefined || !Number.isFinite(t.num * k) ? undefined : t.num * k
}

export function angleDeg(t: Token): number | undefined {
  const k = ANGLE_UNITS[t.unit]
  return k === undefined || !Number.isFinite(t.num * k) ? undefined : t.num * k
}

/** A position string as written: each field a token, and the separator between them, a space by default. */
export interface AtValue {
  x: Token
  y: Token
  rot?: Token
  sep: string
}

export function parseAt(s: string): AtValue | undefined {
  const trimmed = s.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2 || parts.length > 3) return undefined
  const toks = parts.map(parseToken)
  if (toks.some(t => !t)) return undefined
  const [x, y, rot] = toks as Token[]
  if (lengthMm(x) === undefined || lengthMm(y) === undefined || (rot && angleDeg(rot) === undefined)) return undefined
  const sep = /^\S+(\s+)/.exec(trimmed)?.[1] ?? ' '
  return rot ? { x, y, rot, sep } : { x, y, sep }
}

export function formatAt(a: AtValue): string {
  const parts = [formatToken(a.x), formatToken(a.y)]
  if (a.rot) parts.push(formatToken(a.rot))
  return parts.join(a.sep)
}

/** The hint for a unit set apart from its number, empty for anything else. */
function spacedHint(v: string): string {
  const m = typeof v === 'string' ? SPACED.exec(v.trim()) : null
  return m ? `: write the unit next to the number, "${m[1]}${m[2]}"` : ''
}

function finite(n: number, field: string): number {
  if (!Number.isFinite(n)) throw new Error(`${field} must be finite`)
  return n
}

/** Length to millimetres. Numbers are already mm. */
export function mm(v: Length | undefined, dflt?: number): number {
  if (v === undefined || v === null || v === '') {
    if (dflt === undefined) throw new Error('missing length')
    return finite(dflt, 'length')
  }
  if (typeof v === 'number') return finite(v, 'length')
  const t = typeof v === 'string' ? parseToken(v) : undefined
  if (!t) throw new Error(`bad length ${JSON.stringify(v)}${spacedHint(v)}`)
  if (!Number.isFinite(t.num * (LENGTH_UNITS[t.unit] ?? 1))) throw new Error('length must be finite')
  const n = lengthMm(t)
  if (n === undefined) throw new Error(`unknown unit ${JSON.stringify(t.unit)} in ${JSON.stringify(v)}: use ${Object.keys(LENGTH_UNITS).filter(Boolean).join(', ')}`)
  return finite(n, 'length')
}

/** Rotation to degrees: a number or "90" is degrees, "90deg" too, "1.57rad" is radians. */
export function deg(v: Rotation | undefined, dflt = 0): number {
  if (v === undefined || v === null || v === '') return finite(dflt, 'rotation')
  if (typeof v === 'number') return finite(v, 'rotation')
  const t = typeof v === 'string' ? parseToken(v) : undefined
  if (t && !Number.isFinite(t.num * (ANGLE_UNITS[t.unit] ?? 1))) throw new Error('rotation must be finite')
  const n = t && angleDeg(t)
  if (n === undefined) throw new Error(`bad rotation ${JSON.stringify(v)}${spacedHint(v) || ': use degrees such as 90 or "90deg", or radians such as "1.57rad"'}`)
  return finite(n, 'rotation')
}

/** "x y [rot]" -> [x mm, y mm, rot deg]. */
export function at(v: At | undefined): [number, number, number] {
  if (v === undefined) return [0, 0, 0]
  if (typeof v !== 'string') throw new Error(`bad position ${JSON.stringify(v)}: expected a string "x y [rot]", such as \`\${x} \${y}\``)
  const parts = v.trim().split(/\s+/)
  if (parts.length < 2 || parts.length > 3)
    throw new Error(`bad position ${JSON.stringify(v)}: expected "x y [rot]"${parts.length > 3 ? spacedHint(parts.slice(0, 2).join(' ')) : ''}`)
  return [mm(parts[0]), mm(parts[1]), deg(parts[2])]
}

/** The slots of an `at` with `auto` in it, null for each auto one: "auto" alone frees all three; null when none is auto. */
export function autoAt(v: At | undefined): [number | null, number | null, number | null] | null {
  if (typeof v !== 'string' || !/\bauto\b/.test(v)) return null
  const parts = v.trim().split(/\s+/)
  if (parts.length === 1 && parts[0] === 'auto') return [null, null, null]
  if (parts.length < 2 || parts.length > 3) throw new Error(`bad position ${JSON.stringify(v)}: expected "x y [rot]", each a value or auto`)
  const slot = (s: string | undefined, f: (s: string) => number) => (s === 'auto' ? null : f(s!))
  return [slot(parts[0], s => mm(s)), slot(parts[1], s => mm(s)), parts[2] === undefined ? 0 : slot(parts[2], s => deg(s))]
}

export function size2(v: Length | [Length, Length]): [number, number] {
  return Array.isArray(v) ? [mm(v[0]), mm(v[1])] : [mm(v), mm(v)]
}

/** A coordinate string, "x y [layer]", or null when the first token is not a number, as in "J1.3". */
export function coordString(s: string): { x: number; y: number; layer?: string } | null {
  const t = s.trim().split(/\s+/)
  if (!NUM_RE.test(t[0] ?? '')) return null
  if (t.length < 2 || t.length > 3) throw new Error(`bad position ${JSON.stringify(s)}: expected "x y" or "x y layer"`)
  return { x: mm(t[0]), y: mm(t[1]), ...(t[2] ? { layer: t[2] } : {}) }
}

/** The x and y of a route end's `at`: a position string, or [x, y] as the compiler builds it. */
export function endAt(v: At | readonly [Length, Length]): [number, number] {
  if (Array.isArray(v)) return [mm(v[0]), mm(v[1])]
  const [x, y] = at(v as At)
  return [x, y]
}
