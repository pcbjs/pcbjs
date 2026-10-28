// Polygon operations on Clipper, integer coordinates in 10 nm units.
import ClipperLib from 'clipper-lib'
import type { Mat, Poly, Pt, Ring } from '@pcbjs/core/model'

const S = 1e5

// Clipper 6 inserts local minima and scanbeams by walking a list, O(n^2) for a pour with a hole per pad; these sort once in the same order, results unchanged.
function patchClipper(proto: any) {
  if (Object.prototype.hasOwnProperty.call(proto, '__pcbjsLm')) return
  proto.__pcbjsLm = true
  proto.InsertLocalMinima = function (this: any, lm: any) {
    ;(this.__lmQueue ??= []).push(lm)
  }
  const settle = (self: any) => {
    const q: any[] | undefined = self.__lmQueue
    if (!q || !q.length) return
    const all: any[] = []
    for (let i = q.length - 1; i >= 0; i--) all.push(q[i])
    for (let lm = self.m_MinimaList; lm !== null; lm = lm.Next) all.push(lm)
    all.sort((x, y) => y.Y - x.Y) // stable: the queue, newest first, before the older list
    for (let i = 0; i < all.length; i++) all[i].Next = i + 1 < all.length ? all[i + 1] : null
    self.m_MinimaList = all[0]
    self.__lmQueue = []
  }
  const dispose = proto.DisposeLocalMinimaList
  proto.DisposeLocalMinimaList = function (this: any) {
    this.__lmQueue = []
    return dispose.call(this)
  }
  proto.Reset = function (this: any) {
    settle(this)
    this.m_CurrentLM = this.m_MinimaList
    if (this.m_CurrentLM === null) return
    this.m_Scanbeam = null
    let tail: any = null
    for (let lm = this.m_MinimaList; lm !== null; lm = lm.Next) {
      if (tail === null || lm.Y !== tail.Y) {
        const sb = new ClipperLib.Scanbeam()
        sb.Y = lm.Y
        sb.Next = null
        if (tail === null) this.m_Scanbeam = sb
        else tail.Next = sb
        tail = sb
      }
      for (const e of [lm.LeftBound, lm.RightBound]) {
        if (e === null) continue
        e.Curr.X = e.Bot.X
        e.Curr.Y = e.Bot.Y
        if (ClipperLib.use_xyz) e.Curr.Z = e.Bot.Z
        e.OutIdx = ClipperLib.ClipperBase.Unassigned
      }
    }
    this.m_ActiveEdges = null
  }
}
patchClipper(ClipperLib.ClipperBase.prototype)
patchClipper(ClipperLib.Clipper.prototype)
type CPt = { X: number; Y: number }
type CPath = CPt[]

const toC = (r: Ring): CPath => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }))
const fromC = (p: CPath): Ring => p.map(({ X, Y }) => [X / S, Y / S])

export function polyToRings(p: Poly): Ring[] {
  return [p.outer, ...p.holes]
}
export function polysToRings(ps: Poly[]): Ring[] {
  return ps.flatMap(polyToRings)
}

function treeToPolys(tree: any): Poly[] {
  const ex = ClipperLib.JS.PolyTreeToExPolygons(tree)
  return ex.map((e: any) => ({ outer: fromC(e.outer), holes: e.holes.map(fromC) }))
}

function execute(type: number, subject: Ring[], clip: Ring[]): Poly[] {
  const c = new ClipperLib.Clipper()
  if (subject.length) c.AddPaths(subject.map(toC), ClipperLib.PolyType.ptSubject, true)
  if (clip.length) c.AddPaths(clip.map(toC), ClipperLib.PolyType.ptClip, true)
  const tree = new ClipperLib.PolyTree()
  c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return treeToPolys(tree)
}

/** Union of rings (holes must be oriented opposite to their outer, as Clipper outputs them). */
export function union(rings: Ring[]): Poly[] {
  if (!rings.length) return []
  return execute(ClipperLib.ClipType.ctUnion, rings, [])
}
/** The region inside an odd number of the rings, whatever their direction: how a fab reads closed outline contours. */
export function unionEvenOdd(rings: Ring[]): Poly[] {
  if (!rings.length) return []
  const c = new ClipperLib.Clipper()
  c.AddPaths(rings.map(toC), ClipperLib.PolyType.ptSubject, true)
  const tree = new ClipperLib.PolyTree()
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd)
  return treeToPolys(tree)
}
const CLIP = { union: ClipperLib.ClipType.ctUnion, difference: ClipperLib.ClipType.ctDifference, intersection: ClipperLib.ClipType.ctIntersection, xor: ClipperLib.ClipType.ctXor }
/** A boolean operation as plain rings, outers positive and holes negative; skips the costly PolyTree when only area and place matter. */
export function clipRings(op: keyof typeof CLIP, subject: Ring[], clip: Ring[] = []): Ring[] {
  if (!subject.length && !clip.length) return []
  const c = new ClipperLib.Clipper()
  if (subject.length) c.AddPaths(subject.map(toC), ClipperLib.PolyType.ptSubject, true)
  if (clip.length) c.AddPaths(clip.map(toC), ClipperLib.PolyType.ptClip, true)
  const out = new ClipperLib.Paths()
  c.Execute(CLIP[op], out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return out.map(fromC)
}
/** `offset` with its result as plain rings, as clipRings returns them. */
export function offsetRings(rings: Ring[], delta: number): Ring[] {
  if (!rings.length) return []
  const co = new ClipperLib.ClipperOffset(2, 0.005 * S)
  co.AddPaths(rings.map(toC), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const out = new ClipperLib.Paths()
  co.Execute(out, delta * S)
  return out.map(fromC)
}
export function difference(subject: Ring[], clip: Ring[]): Poly[] {
  if (!subject.length) return []
  if (!clip.length) return union(subject)
  return execute(ClipperLib.ClipType.ctDifference, subject, clip)
}
export function intersection(a: Ring[], b: Ring[]): Poly[] {
  if (!a.length || !b.length) return []
  return execute(ClipperLib.ClipType.ctIntersection, a, b)
}

/** Offset closed polygons by delta (negative shrinks), round joins. */
export function offset(rings: Ring[], delta: number): Poly[] {
  if (!rings.length) return []
  if (delta === 0) return union(rings)
  const co = new ClipperLib.ClipperOffset(2, 0.005 * S)
  co.AddPaths(rings.map(toC), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const tree = new ClipperLib.PolyTree()
  co.Execute(tree, delta * S)
  return treeToPolys(tree)
}

/** The outline of a stroked open polyline with round caps and joins. */
export function strokeOpen(pts: Ring, width: number): Poly[] {
  if (pts.length === 1) pts = [pts[0], pts[0]]
  const co = new ClipperLib.ClipperOffset(2, 0.005 * S)
  co.AddPaths([toC(pts)], ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound)
  const tree = new ClipperLib.PolyTree()
  co.Execute(tree, (width / 2) * S)
  return treeToPolys(tree)
}
/** The outline of a stroked closed ring. */
export function strokeClosed(pts: Ring, width: number): Poly[] {
  const co = new ClipperLib.ClipperOffset(2, 0.005 * S)
  co.AddPaths([toC(pts)], ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedLine)
  const tree = new ClipperLib.PolyTree()
  co.Execute(tree, (width / 2) * S)
  return treeToPolys(tree)
}

export function area(rings: Ring[]): number {
  return rings.reduce((s, r) => s + ClipperLib.Clipper.Area(toC(r)) / (S * S), 0)
}

export function overlaps(a: Ring[], b: Ring[]): boolean {
  return Math.abs(area(polysToRings(intersection(a, b)))) > 1e-9
}

/** True when `p` lies inside `r`, by the crossing rule; a point on the edge may go either way. */
export function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i],
      [xj, yj] = r[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
/** True when `p` lies in the polygon: inside its outer and in none of its holes. */
export function pointInPoly(p: Pt, poly: Poly): boolean {
  return pointInRing(p, poly.outer) && !poly.holes.some(h => pointInRing(p, h))
}

/** Closed rings oriented by containment: outlines positive, cutouts negative, as Clipper reads them; depth from each ring's first point. */
export function orientRings(rings: Ring[]): Ring[] {
  const boxes = rings.map(r => bbox([r]))
  return rings.map((r, i) => {
    const p = r[0]
    let depth = 0
    rings.forEach((o, j) => {
      if (j === i) return
      const b = boxes[j]
      if (p[0] < b.x || p[0] > b.x + b.w || p[1] < b.y || p[1] > b.y + b.h) return
      if (pointInRing(p, o)) depth++
    })
    const positive = area([r]) > 0
    return positive === (depth % 2 === 0) ? r : r.slice().reverse()
  })
}

export function bbox(rings: Ring[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
export function bboxOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  return a.x - pad <= b.x + b.w && b.x - pad <= a.x + a.w && a.y - pad <= b.y + b.h && b.y - pad <= a.y + a.h
}

export function centroid(rings: Ring[]): Pt {
  let n = 0,
    sx = 0,
    sy = 0
  for (const r of rings)
    for (const [x, y] of r) {
      sx += x
      sy += y
      n++
    }
  return n ? [sx / n, sy / n] : [0, 0]
}

/** A point representative of where two polygon sets come closest: centroid of their expanded overlap. */
export function contactPoint(a: Ring[], b: Ring[]): Pt {
  const inter = polysToRings(intersection(a, b))
  if (inter.length) return centroid(inter)
  return centroid([...a, ...b])
}

// affine transforms, SVG matrix convention
export type { Mat }
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}
/** translate(x, y) · rotate(deg, counter-clockwise on screen) · mirror-x(if flip) */
export function placement(x: number, y: number, rotDeg: number, flip: boolean): Mat {
  const a = (rotDeg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a)
  // screen is y-down, so counter-clockwise on screen is a negative mathematical angle
  const rot: Mat = [c, -s, s, c, 0, 0]
  const t: Mat = [1, 0, 0, 1, x, y]
  const f: Mat = flip ? [-1, 0, 0, 1, 0, 0] : IDENTITY
  return mul(mul(t, rot), f)
}
export function apply(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}
export function applyRing(m: Mat, r: Ring): Ring {
  return r.map(p => apply(m, p))
}
export function isMirrored(m: Mat): boolean {
  return m[0] * m[3] - m[1] * m[2] < 0
}
export function rotationOf(m: Mat): number {
  // rotation of the x axis, counter-clockwise on screen, in degrees
  const mir = isMirrored(m)
  const ax = mir ? -m[0] : m[0],
    ay = mir ? -m[1] : m[1]
  return ((-Math.atan2(ay, ax) * 180) / Math.PI + 360) % 360
}
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  const a = m[3] / det,
    b = -m[1] / det,
    c = -m[2] / det,
    d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}
