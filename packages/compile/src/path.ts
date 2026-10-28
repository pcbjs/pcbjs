import type { Mat, Pt, Prim, Ring } from '@pcbjs/core/model'

export interface SubPath {
  pts: Ring
  closed: boolean
  /** the subpath as lines and arcs, end to end; a closed subpath includes its closing line */
  prims: Prim[]
}

const TOL = 0.005 // mm chord error

const TOKEN = /([MmLlHhVvZzCcSsQqTtAa])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g

/** One drawing command of a path: its characters in `d`, end exclusive, and what it draws. */
export interface PathCommand {
  start: number
  end: number
  pts: Ring
  prims: Prim[]
}

export function parsePath(d: string): SubPath[] {
  return walkPath(d).subpaths
}

/** The drawing commands of a path, one per command and implicit repeat, pen moves left out. */
export function pathCommands(d: string): PathCommand[] {
  return walkPath(d).cmds.filter(c => c.pts.length >= 2)
}

function walkPath(d: string): { subpaths: SubPath[]; cmds: PathCommand[] } {
  const out: SubPath[] = []
  const cmds: PathCommand[] = []
  let cur = null as SubPath | null
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0
  let cmd = ''
  let lastCtrl: Pt | null = null
  const toks: { v: string | number; s: number; e: number }[] = []
  for (const m of d.matchAll(TOKEN)) toks.push({ v: m[1] ? m[1] : parseFloat(m[2]), s: m.index!, e: m.index! + m[0].length })
  let i = 0
  const num = () => {
    const v = toks[i++]?.v
    if (typeof v !== 'number') throw new Error(`path: expected a number after ${cmd} in ${JSON.stringify(d)}`)
    return v
  }
  let drawn: Ring = []
  let drawnPrims: Prim[] = []
  const start = (px: number, py: number) => {
    cur = { pts: [[px, py]], closed: false, prims: [] }
    out.push(cur)
    sx = px
    sy = py
  }
  const prim = (p: Prim) => {
    cur!.prims.push(p)
    drawnPrims.push(p)
  }
  // line false: a chord of an arc whose primitive is added once the arc is drawn
  const lineTo = (px: number, py: number, line = true) => {
    if (!cur) start(x, y)
    if (line && (px !== x || py !== y)) prim({ kind: 'line', from: [x, y], to: [px, py] })
    cur!.pts.push([px, py])
    drawn.push([px, py])
    x = px
    y = py
  }
  const curveTo = (px: number, py: number) => lineTo(px, py)
  while (i < toks.length) {
    const first = i
    const t = toks[i].v
    if (typeof t === 'string') {
      cmd = t
      i++
    } else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
    const rel = cmd === cmd.toLowerCase()
    const rx = rel ? x : 0,
      ry = rel ? y : 0
    drawn = [[x, y]]
    drawnPrims = []
    let pen = false
    switch (cmd.toUpperCase()) {
      case 'M': {
        const px = num() + rx,
          py = num() + ry
        start(px, py)
        x = px
        y = py
        lastCtrl = null
        pen = true
        break
      }
      case 'L': {
        lineTo(num() + rx, num() + ry)
        lastCtrl = null
        break
      }
      case 'H': {
        lineTo(num() + rx, y)
        lastCtrl = null
        break
      }
      case 'V': {
        lineTo(x, num() + ry)
        lastCtrl = null
        break
      }
      case 'Z': {
        if (cur) {
          cur.closed = true
          if (x !== sx || y !== sy) {
            drawn.push([sx, sy])
            // an arc's last chord point can miss its exact end by rounding: no closing line for that
            if (Math.hypot(x - sx, y - sy) > 1e-9) prim({ kind: 'line', from: [x, y], to: [sx, sy] })
          }
          x = sx
          y = sy
          cur = null
        }
        lastCtrl = null
        break
      }
      case 'C': {
        const c1: Pt = [num() + rx, num() + ry],
          c2: Pt = [num() + rx, num() + ry],
          p: Pt = [num() + rx, num() + ry]
        cubic([x, y], c1, c2, p, curveTo)
        lastCtrl = c2
        break
      }
      case 'S': {
        const c1: Pt = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]
        const c2: Pt = [num() + rx, num() + ry],
          p: Pt = [num() + rx, num() + ry]
        cubic([x, y], c1, c2, p, curveTo)
        lastCtrl = c2
        break
      }
      case 'Q': {
        const c: Pt = [num() + rx, num() + ry],
          p: Pt = [num() + rx, num() + ry]
        quad([x, y], c, p, curveTo)
        lastCtrl = c
        break
      }
      case 'T': {
        const c: Pt = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]
        const p: Pt = [num() + rx, num() + ry]
        quad([x, y], c, p, curveTo)
        lastCtrl = c
        break
      }
      case 'A': {
        const r1 = num(),
          r2 = num(),
          phi = num(),
          large = num() !== 0,
          sweep = num() !== 0
        const px = num() + rx,
          py = num() + ry
        const from: Pt = [x, y]
        const arc = arcTo(from, r1, r2, phi, large, sweep, [px, py], lineTo)
        if (arc) prim({ kind: 'arc', from, to: [px, py], center: arc.center, cw: arc.cw })
        lastCtrl = null
        break
      }
      default:
        throw new Error(`path: unknown command ${cmd}`)
    }
    if (!pen) cmds.push({ start: toks[first].s, end: toks[i - 1].e, pts: drawn, prims: drawnPrims })
  }
  return { subpaths: out, cmds }
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, emit: (x: number, y: number) => void) {
  const n = Math.max(4, Math.ceil(Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 0.2))
  for (let i = 1; i <= n; i++) {
    const t = i / n,
      u = 1 - t
    emit(
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    )
  }
}
function quad(p0: Pt, p1: Pt, p2: Pt, emit: (x: number, y: number) => void) {
  const n = Math.max(4, Math.ceil(Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) / 0.2))
  for (let i = 1; i <= n; i++) {
    const t = i / n,
      u = 1 - t
    emit(u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])
  }
}

/** SVG endpoint arc to centre form, SVG spec F.6.5, flattened through `emit`; returns the centre of a circular arc, else null. */
function arcTo(
  p0: Pt,
  r1: number,
  r2: number,
  phiDeg: number,
  large: boolean,
  sweep: boolean,
  p1: Pt,
  emit: (x: number, y: number, line?: boolean) => void,
): { center: Pt; cw: boolean } | null {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return null
  r1 = Math.abs(r1)
  r2 = Math.abs(r2)
  if (r1 === 0 || r2 === 0) {
    emit(p1[0], p1[1])
    return null
  }
  const circular = Math.abs(r1 - r2) <= 1e-9 * Math.max(r1, r2)
  const phi = (phiDeg * Math.PI) / 180,
    cp = Math.cos(phi),
    sp = Math.sin(phi)
  const dx = (p0[0] - p1[0]) / 2,
    dy = (p0[1] - p1[1]) / 2
  const x1 = cp * dx + sp * dy,
    y1 = -sp * dx + cp * dy
  const lam = (x1 * x1) / (r1 * r1) + (y1 * y1) / (r2 * r2)
  if (lam > 1) {
    r1 *= Math.sqrt(lam)
    r2 *= Math.sqrt(lam)
  }
  const num = r1 * r1 * r2 * r2 - r1 * r1 * y1 * y1 - r2 * r2 * x1 * x1
  const den = r1 * r1 * y1 * y1 + r2 * r2 * x1 * x1
  let k = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) k = -k
  const cx1 = (k * r1 * y1) / r2,
    cy1 = (-k * r2 * x1) / r1
  const cx = cp * cx1 - sp * cy1 + (p0[0] + p1[0]) / 2
  const cy = sp * cx1 + cp * cy1 + (p0[1] + p1[1]) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1 - cx1) / r1, (y1 - cy1) / r2)
  let dt = ang((x1 - cx1) / r1, (y1 - cy1) / r2, (-x1 - cx1) / r1, (-y1 - cy1) / r2)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  else if (sweep && dt < 0) dt += 2 * Math.PI
  const r = Math.max(r1, r2)
  const n = Math.max(2, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(0, 1 - TOL / r)))))
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n
    const ex = r1 * Math.cos(t),
      ey = r2 * Math.sin(t)
    emit(cp * ex - sp * ey + cx, sp * ex + cp * ey + cy, !circular)
  }
  // on the y-down screen a growing angle turns clockwise: sweep flag 1
  return circular ? { center: [cx, cy], cw: sweep } : null
}

/** True when the primitives hold an arc. */
export function hasArc(prims: Prim[] | undefined): boolean {
  return !!prims && prims.some(p => p.kind === 'arc')
}

/** The signed sweep of an arc in radians, positive when clockwise on the y-down screen, in (-2π, 2π) and never 0. */
export function arcSweep(p: Extract<Prim, { kind: 'arc' }>): number {
  const a0 = Math.atan2(p.from[1] - p.center[1], p.from[0] - p.center[0])
  const a1 = Math.atan2(p.to[1] - p.center[1], p.to[0] - p.center[0])
  let dt = a1 - a0
  if (p.cw) {
    while (dt <= 0) dt += 2 * Math.PI
  } else {
    while (dt >= 0) dt -= 2 * Math.PI
  }
  return dt
}

/** An arc as line primitives, its chords at the chord tolerance. */
export function arcLines(p: Extract<Prim, { kind: 'arc' }>): Prim[] {
  const r = Math.hypot(p.from[0] - p.center[0], p.from[1] - p.center[1])
  const dt = arcSweep(p),
    a0 = Math.atan2(p.from[1] - p.center[1], p.from[0] - p.center[0])
  const n = Math.max(2, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(0, 1 - TOL / Math.max(r, 0.01))))))
  const out: Prim[] = []
  let prev = p.from
  for (let i = 1; i <= n; i++) {
    const a = a0 + (dt * i) / n
    const q: Pt = i === n ? p.to : [p.center[0] + r * Math.cos(a), p.center[1] + r * Math.sin(a)]
    out.push({ kind: 'line', from: prev, to: q })
    prev = q
  }
  return out
}

/** Primitives through an affine matrix; arcs stay arcs only under a similarity. */
export function applyPrims(m: Mat, prims: Prim[]): Prim[] {
  const ap = (p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
  const sx = m[0] * m[0] + m[1] * m[1],
    sy = m[2] * m[2] + m[3] * m[3],
    dot = m[0] * m[2] + m[1] * m[3]
  const eps = 1e-9 * Math.max(sx, sy)
  const similar = Math.abs(sx - sy) <= eps && Math.abs(dot) <= eps
  const flip = m[0] * m[3] - m[1] * m[2] < 0
  return prims.flatMap((p): Prim[] => {
    if (p.kind === 'line') return [{ kind: 'line', from: ap(p.from), to: ap(p.to) }]
    if (similar) return [{ kind: 'arc', from: ap(p.from), to: ap(p.to), center: ap(p.center), cw: p.cw !== flip }]
    return arcLines(p).map(l => ({ kind: 'line', from: ap(l.from), to: ap(l.to) }) as Prim)
  })
}

/** A full circle as two half arcs, clockwise on screen from its rightmost point, where `circleRing` starts. */
export function circlePrims(cx: number, cy: number, r: number): Prim[] {
  const a: Pt = [cx + r, cy],
    b: Pt = [cx - r, cy],
    center: Pt = [cx, cy]
  return [
    { kind: 'arc', from: a, to: b, center, cw: true },
    { kind: 'arc', from: b, to: a, center, cw: true },
  ]
}

/** The primitives of `roundedRect(w, h, r)`, centred, starting where its ring starts. */
export function roundedRectPrims(w: number, h: number, r: number): Prim[] {
  r = Math.min(r, w / 2, h / 2)
  if (r <= 0) return []
  const c: Pt[] = [
    [w / 2 - r, h / 2 - r],
    [-w / 2 + r, h / 2 - r],
    [-w / 2 + r, -h / 2 + r],
    [w / 2 - r, -h / 2 + r],
  ]
  const at = (p: Pt, a: number): Pt => [p[0] + r * Math.round(Math.cos(a)), p[1] + r * Math.round(Math.sin(a))]
  const out: Prim[] = []
  for (let k = 0; k < 4; k++) {
    const a0 = (k * Math.PI) / 2
    const from = at(c[k], a0),
      to = at(c[k], a0 + Math.PI / 2),
      next = at(c[(k + 1) % 4], a0 + Math.PI / 2)
    out.push({ kind: 'arc', from, to, center: c[k], cw: true })
    if (to[0] !== next[0] || to[1] !== next[1]) out.push({ kind: 'line', from: to, to: next })
  }
  return out
}

/** Number of segments to draw a full circle of radius r within the chord tolerance. */
export function circleSegments(r: number): number {
  return Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - TOL / Math.max(r, 0.01)))))
}

export function circleRing(cx: number, cy: number, r: number, n = circleSegments(r)): Ring {
  const out: Ring = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

/** Pad outline in pad-local coordinates, centred, unrotated. */
export function padRing(shape: 'circle' | 'rect' | 'roundrect' | 'oval', w: number, h: number, roundness = 0.25): Ring {
  if (shape === 'circle') return circleRing(0, 0, Math.min(w, h) / 2)
  if (shape === 'rect')
    return [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ]
  const r = shape === 'oval' ? Math.min(w, h) / 2 : Math.min(w, h) * Math.min(Math.max(roundness, 0), 0.5)
  return roundedRect(w, h, r)
}

export function roundedRect(w: number, h: number, r: number): Ring {
  r = Math.min(r, w / 2, h / 2)
  if (r <= 0) return padRing('rect', w, h)
  const n = Math.max(4, Math.ceil(circleSegments(r) / 4))
  const out: Ring = []
  const corners: [number, number, number][] = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, 1.5 * Math.PI],
  ]
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n)
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  return out
}

/** Chain open polylines into closed rings by matching end points (for Edge.Cuts). */
export function chainRings(paths: Ring[], closed: boolean[], tol = 0.01): { rings: Ring[]; open: Ring[] } {
  const rings: Ring[] = []
  const open: Ring[] = []
  const pool: Ring[] = []
  paths.forEach((p, i) => {
    if (closed[i] && p.length >= 3) rings.push(p)
    else if (p.length >= 2) pool.push(p.slice())
  })
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol
  while (pool.length) {
    const ring = pool.shift()!
    let grew = true
    while (grew) {
      grew = false
      const end = ring[ring.length - 1]
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i]
        if (near(end, c[0])) {
          ring.push(...c.slice(1))
          pool.splice(i, 1)
          grew = true
          break
        }
        if (near(end, c[c.length - 1])) {
          ring.push(...c.slice(0, -1).reverse())
          pool.splice(i, 1)
          grew = true
          break
        }
      }
    }
    if (ring.length >= 3 && near(ring[0], ring[ring.length - 1])) {
      ring.pop()
      rings.push(ring)
    } else open.push(ring)
  }
  return { rings, open }
}
