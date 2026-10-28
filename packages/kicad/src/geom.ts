export type Pt = [number, number]

/** A number rounded to the nanometre, KiCad's internal unit, with -0 made 0. */
export function nm(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}
export function fmt(v: number): string {
  return String(nm(v))
}

/** Rotate a point by `deg` counter-clockwise on screen, y down: KiCad's and pcbjs's rotation. */
export function rotate(p: Pt, deg: number): Pt {
  if (!deg) return p
  const t = (deg * Math.PI) / 180,
    c = Math.cos(t),
    s = Math.sin(t)
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]
}

/** An angle in degrees folded into (-180, 180], rounded to 1e-6. */
export function normAngle(a: number): number {
  let r = ((a % 360) + 360) % 360
  if (r > 180) r -= 360
  return nm(r)
}

export function circleThrough(a: Pt, m: Pt, b: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]))
  if (Math.abs(d) < 1e-12) return null
  const sq = (p: Pt) => p[0] * p[0] + p[1] * p[1]
  const ux = (sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d
  const uy = (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) }
}

/** The arc from a through m to b; a positive sweep in radians is clockwise on screen, SVG's sweep flag 1. */
export function arcThrough(a: Pt, m: Pt, b: Pt): { c: Pt; r: number; a0: number; sweep: number } | null {
  const k = circleThrough(a, m, b)
  if (!k) return null
  const ang = (p: Pt) => Math.atan2(p[1] - k.c[1], p[0] - k.c[0])
  const a0 = ang(a),
    am = ang(m),
    ab = ang(b)
  const tau = 2 * Math.PI
  const pos = (x: number) => ((x % tau) + tau) % tau
  const dm = pos(am - a0),
    db = pos(ab - a0)
  // the direction that passes the mid point before the end
  const sweep = dm <= db ? (db === 0 ? tau : db) : -(tau - db)
  return { c: k.c, r: k.r, a0, sweep }
}

/** The SVG `A` command from a through m to b; `L` when collinear. */
export function svgArcTo(a: Pt, m: Pt, b: Pt): string {
  const k = arcThrough(a, m, b)
  if (!k) return `L ${fmt(b[0])} ${fmt(b[1])}`
  const large = Math.abs(k.sweep) > Math.PI ? 1 : 0
  const sweep = k.sweep > 0 ? 1 : 0
  return `A ${fmt(k.r)} ${fmt(k.r)} 0 ${large} ${sweep} ${fmt(b[0])} ${fmt(b[1])}`
}

/** Points along the arc from a through m to b, at most 5 degrees apart. */
export function arcPoints(a: Pt, m: Pt, b: Pt): Pt[] {
  const k = arcThrough(a, m, b)
  if (!k) return [a, b]
  const n = Math.max(4, Math.ceil(Math.abs(k.sweep) / (Math.PI / 36)))
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = k.a0 + (k.sweep * i) / n
    out.push([k.c[0] + k.r * Math.cos(t), k.c[1] + k.r * Math.sin(t)])
  }
  out[0] = a
  out[n] = b
  return out
}

export function circlePoints(c: Pt, r: number, n = 64): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)])
  }
  return out
}

export const same = (a: Pt, b: Pt, tol = 1e-6): boolean => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol
