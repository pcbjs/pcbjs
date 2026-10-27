import type { At, Length, Rotation } from './types.js'

const UNIT: Record<string, number> = { mm: 1, cm: 10, m: 1000, mil: 0.0254, th: 0.0254, in: 25.4, um: 0.001, nm: 1e-6 }

/** Length to millimetres. Numbers are already mm. */
export function mm(v: Length | undefined, dflt?: number): number {
  if (v === undefined || v === null || v === '') {
    if (dflt === undefined) throw new Error('missing length')
    return dflt
  }
  if (typeof v === 'number') return v
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-zA-Z]*)\s*$/.exec(v)
  if (!m) throw new Error(`bad length ${JSON.stringify(v)}`)
  const u = m[2].toLowerCase()
  if (u && !(u in UNIT)) throw new Error(`unknown unit ${JSON.stringify(m[2])} in ${JSON.stringify(v)}`)
  return parseFloat(m[1]) * (u ? UNIT[u] : 1)
}

/** Rotation to degrees. "90deg", "0.5turn", "1.57rad" or a number of degrees. */
export function deg(v: Rotation | undefined, dflt = 0): number {
  if (v === undefined || v === null || v === '') return dflt
  if (typeof v === 'number') return v
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(deg|rad|turn|°)?\s*$/.exec(v)
  if (!m) throw new Error(`bad rotation ${JSON.stringify(v)}`)
  const n = parseFloat(m[1])
  return m[2] === 'rad' ? (n * 180) / Math.PI : m[2] === 'turn' ? n * 360 : n
}

/** "x y [rot]" or tuple -> [x mm, y mm, rot deg]. */
export function at(v: At | undefined): [number, number, number] {
  if (v === undefined) return [0, 0, 0]
  if (Array.isArray(v)) return [mm(v[0]), mm(v[1]), deg(v[2] as Rotation | undefined)]
  const parts = v.trim().split(/[\s,]+/)
  if (parts.length < 2 || parts.length > 3) throw new Error(`bad position ${JSON.stringify(v)}: expected "x y [rot]"`)
  return [mm(parts[0]), mm(parts[1]), deg(parts[2])]
}

export function size2(v: Length | [Length, Length]): [number, number] {
  return Array.isArray(v) ? [mm(v[0]), mm(v[1])] : [mm(v), mm(v)]
}

/** A coordinate string, "x y [layer]", or null when the first token is not a number, as in "J1.3". */
export function coordString(s: string): { x: number; y: number; layer?: string } | null {
  const t = s.trim().split(/\s+/)
  if (!/^[-+]?(\d|\.\d)/.test(t[0] ?? '')) return null
  if (t.length < 2 || t.length > 3) throw new Error(`bad position ${JSON.stringify(s)}: expected "x y" or "x y layer"`)
  return { x: mm(t[0]), y: mm(t[1]), ...(t[2] ? { layer: t[2] } : {}) }
}
