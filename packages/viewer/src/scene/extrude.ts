// the triangles of three.js's ExtrudeGeometry, lids triangulated per cell: earcut on a thousand holes takes seconds, on cells milliseconds
// coordinates are three.js x, y: callers flip the board's y before
import * as THREE from 'three'

export type P = [number, number]
export interface Poly { outer: P[]; holes: P[][] }
/** A layer of the extrusion: its z, and how far its rings move out along the bevel vectors, mm. */
export interface Layer { z: number; bs: number }
export interface Extruded { position: Float32Array; normal: Float32Array; groups: number[] }

/** Holes per cell above which a polygon is cut. */
const CELL_HOLES = 24

/** Shoelace area, three.js sign: positive counter-clockwise. */
export function area(r: P[]): number {
  let a = 0
  for (let p = r.length - 1, q = 0; q < r.length; p = q++) a += r[p][0] * r[q][1] - r[q][0] * r[p][1]
  return a / 2
}

/** Drop consecutive points closer than ExtrudeGeometry's merge threshold and a closing duplicate. */
function merged(r: P[]): P[] {
  const out: P[] = []
  for (const p of r) {
    const q = out[out.length - 1]
    if (q) {
      const s = Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(q[0]), Math.abs(q[1])) * 1e-10
      if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= s * s) continue
    }
    out.push(p)
  }
  while (out.length > 1) {
    const p = out[0], q = out[out.length - 1]
    const s = Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(q[0]), Math.abs(q[1])) * 1e-10
    if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= s * s) out.pop(); else break
  }
  return out
}

/** The outer clockwise and the holes counter-clockwise, as ExtrudeGeometry leaves them. */
function oriented(p: Poly): Poly | null {
  const outer = merged(p.outer)
  if (outer.length < 3 || area(outer) === 0) return null
  if (area(outer) > 0) outer.reverse()
  const holes: P[][] = []
  for (const h of p.holes) {
    const m = merged(h)
    if (m.length < 3 || area(m) === 0) continue
    if (area(m) < 0) m.reverse()
    holes.push(m)
  }
  return { outer, holes }
}

/** ExtrudeGeometry's bevel vector: where a point moves for a unit outset of its two edges, with sharp corners capped. */
function bevelVec(pt: P, prev: P, next: P): P {
  const vpx = pt[0] - prev[0], vpy = pt[1] - prev[1]
  const vnx = next[0] - pt[0], vny = next[1] - pt[1]
  const vpl2 = vpx * vpx + vpy * vpy
  const col = vpx * vny - vpy * vnx
  let tx: number, ty: number, shrink: number
  if (Math.abs(col) > Number.EPSILON) {
    const vpl = Math.sqrt(vpl2), vnl = Math.sqrt(vnx * vnx + vny * vny)
    const psx = prev[0] - vpy / vpl, psy = prev[1] + vpx / vpl
    const nsx = next[0] - vny / vnl, nsy = next[1] + vnx / vnl
    const sf = ((nsx - psx) * vny - (nsy - psy) * vnx) / (vpx * vny - vpy * vnx)
    tx = psx + vpx * sf - pt[0]
    ty = psy + vpy * sf - pt[1]
    const l2 = tx * tx + ty * ty
    if (l2 <= 2) return [tx, ty]
    shrink = Math.sqrt(l2 / 2)
  } else {
    let same = false
    if (vpx > Number.EPSILON) { if (vnx > Number.EPSILON) same = true }
    else if (vpx < -Number.EPSILON) { if (vnx < -Number.EPSILON) same = true }
    else if (Math.sign(vpy) === Math.sign(vny)) same = true
    if (same) { tx = -vpy; ty = vpx; shrink = Math.sqrt(vpl2) }
    else { tx = vpx; ty = vpy; shrink = Math.sqrt(vpl2 / 2) }
  }
  return [tx / shrink, ty / shrink]
}

type Node = { p: P; cross: number }

/** The pieces of a simple ring on each side of coordinate[axis] = c, a line through none of its points; null when it does not cross. */
export function cutRing(ring: P[], axis: 0 | 1, c: number): P[][] | null {
  const o = 1 - axis
  const nodes: Node[] = []
  const crossings: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    nodes.push({ p: a, cross: -1 })
    if ((a[axis] < c) !== (b[axis] < c)) {
      const t = (c - a[axis]) / (b[axis] - a[axis])
      const q: P = [0, 0]
      q[axis] = c
      q[o] = a[o] + (b[o] - a[o]) * t
      crossings.push(nodes.length)
      nodes.push({ p: q, cross: 0 })
    }
  }
  if (!crossings.length) return null
  if (crossings.length % 2) return null
  // along the line, the inside of a simple ring lies between the first and second crossing, the third and fourth, ...
  const byLine = [...crossings].sort((x, y) => nodes[x].p[o] - nodes[y].p[o])
  const partner = new Map<number, number>()
  for (let i = 0; i < byLine.length; i += 2) { partner.set(byLine[i], byLine[i + 1]); partner.set(byLine[i + 1], byLine[i]) }
  // every point of the ring is in one piece, every crossing in two, one on each side
  const seen = new Uint8Array(nodes.length)
  const pieces: P[][] = []
  const n = nodes.length
  for (let s = 0; s < n; s++) {
    if (seen[s] || nodes[s].cross >= 0) continue
    const piece: P[] = []
    let i = s, guard = 0
    do {
      if (guard++ > 2 * n) return null
      if (nodes[i].cross >= 0) {
        const j = partner.get(i)!
        piece.push(nodes[i].p, nodes[j].p)
        i = (j + 1) % n
      } else {
        if (seen[i]) return null
        seen[i] = 1
        piece.push(nodes[i].p)
        i = (i + 1) % n
      }
    } while (i !== s)
    pieces.push(piece)
  }
  return pieces
}

const pointIn = (p: P, r: P[]) => {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** A line across the polygon at the median hole that crosses no hole and no point of any ring, or null. */
function cutLine(p: Poly, axis: 0 | 1): number | null {
  const spans = p.holes.map(h => { let lo = Infinity, hi = -Infinity; for (const q of h) { if (q[axis] < lo) lo = q[axis]; if (q[axis] > hi) hi = q[axis] } return [lo, hi] as [number, number] })
  spans.sort((a, b) => a[0] - b[0])
  // the gaps between the merged spans, with the count of holes before each
  const gaps: { at: number; before: number }[] = []
  let end = spans[0][1]
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] > end) gaps.push({ at: (end + spans[i][0]) / 2, before: i })
    end = Math.max(end, spans[i][1])
  }
  if (!gaps.length) return null
  const half = spans.length / 2
  const best = gaps.reduce((a, b) => (Math.abs(b.before - half) < Math.abs(a.before - half) ? b : a))
  // off every point of the rings by a hair, so no point lies on the line
  const at = new Set<number>()
  for (const q of p.outer) at.add(q[axis])
  let c = best.at
  for (let k = 0; at.has(c) && k < 8; k++) c += 1e-7
  return at.has(c) ? null : c
}

/** The polygon cut into cells of at most CELL_HOLES holes, as polygons that cover it exactly; itself when it cannot be. */
export function cells(p: Poly, depth = 0): Poly[] {
  if (p.holes.length <= CELL_HOLES || depth > 24) return [p]
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const q of p.outer) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1] }
  const axes: (0 | 1)[] = x1 - x0 >= y1 - y0 ? [0, 1] : [1, 0]
  for (const axis of axes) {
    const c = cutLine(p, axis)
    if (c === null) continue
    const pieces = cutRing(p.outer, axis, c)
    if (!pieces || pieces.length < 2) continue
    // the pieces must cover the ring: their areas add up to its own
    const total = Math.abs(area(p.outer)), sum = pieces.reduce((s, r) => s + Math.abs(area(r)), 0)
    if (Math.abs(total - sum) > 1e-6 * Math.max(1, total)) continue
    const polys: Poly[] = pieces.map(r => ({ outer: r, holes: [] }))
    let lost = false
    for (const h of p.holes) {
      const side = h[0][axis] < c
      const into = polys.find(q => (q.outer[0][axis] < c || (q.outer[0][axis] === c && q.outer[1][axis] < c)) === side && pointIn(h[0], q.outer))
        ?? polys.find(q => pointIn(h[0], q.outer))
      if (!into) { lost = true; break }
      into.holes.push(h)
    }
    if (lost) continue
    return polys.flatMap(q => cells(q, depth + 1))
  }
  return [p]
}

/** The face normal of the triangle at `i`, as computeVertexNormals gives it: (c - b) x (a - b), on all three corners. */
function faceNormal(p: Float32Array, n: Float32Array, i: number) {
  const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
  const ux = p[i + 6] - bx, uy = p[i + 7] - by, uz = p[i + 8] - bz, vx = p[i] - bx, vy = p[i + 1] - by, vz = p[i + 2] - bz
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  nx /= l; ny /= l; nz /= l
  n[i] = n[i + 3] = n[i + 6] = nx
  n[i + 1] = n[i + 4] = n[i + 7] = ny
  n[i + 2] = n[i + 5] = n[i + 8] = nz
}

export function extrude(polys: Poly[], layers: Layer[]): Extruded {
  const bevel = layers.some(l => l.bs !== 0)
  const zb = layers[0].z, zt = layers[layers.length - 1].z
  const L = layers.length
  const lids: { xy: Float64Array; faces: number[][] }[] = []
  const rings: P[][] = []
  let lidTris = 0, wallQuads = 0
  for (const raw of polys) {
    const p = oriented(raw)
    if (!p) continue
    for (const cell of cells(p)) {
      const q = oriented(cell)
      if (!q) continue
      const contour = q.outer.map(v => new THREE.Vector2(v[0], v[1]))
      const holes = q.holes.map(h => h.map(v => new THREE.Vector2(v[0], v[1])))
      const faces = THREE.ShapeUtils.triangulateShape(contour, holes) as number[][]
      const all = contour.concat(...holes)
      const xy = new Float64Array(all.length * 2)
      all.forEach((v, i) => { xy[i * 2] = v.x; xy[i * 2 + 1] = v.y })
      lids.push({ xy, faces })
      lidTris += faces.length * 2
    }
    for (const r of [p.outer, ...p.holes]) { rings.push(r); wallQuads += r.length * (L - 1) }
  }
  const lidVerts = lidTris * 3, wallVerts = wallQuads * 6
  const position = new Float32Array((lidVerts + wallVerts) * 3)
  let o = 0
  const put = (x: number, y: number, z: number) => { position[o++] = x; position[o++] = y; position[o++] = z }
  // the bottom turned over, the top as earcut gives it
  for (const { xy, faces } of lids) {
    for (const f of faces) for (let k = 2; k >= 0; k--) put(xy[f[k] * 2], xy[f[k] * 2 + 1], zb)
    for (const f of faces) for (let k = 0; k < 3; k++) put(xy[f[k] * 2], xy[f[k] * 2 + 1], zt)
  }
  // walls from the whole rings, so the cuts leave no seam
  for (const ring of rings) {
    const n = ring.length
    const at = new Float64Array(n * L * 2)
    for (let i = 0; i < n; i++) {
      const m = bevel ? bevelVec(ring[i], ring[(i + n - 1) % n], ring[(i + 1) % n]) : null
      for (let s = 0; s < L; s++) {
        const bs = layers[s].bs
        at[(s * n + i) * 2] = ring[i][0] + (m && bs ? m[0] * bs : 0)
        at[(s * n + i) * 2 + 1] = ring[i][1] + (m && bs ? m[1] * bs : 0)
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = i, k = i - 1 < 0 ? n - 1 : i - 1
      for (let s = 0; s + 1 < L; s++) {
        const z0 = layers[s].z, z1 = layers[s + 1].z
        const a = (s * n + j) * 2, b = (s * n + k) * 2, c = ((s + 1) * n + k) * 2, d = ((s + 1) * n + j) * 2
        put(at[a], at[a + 1], z0); put(at[b], at[b + 1], z0); put(at[d], at[d + 1], z1)
        put(at[b], at[b + 1], z0); put(at[c], at[c + 1], z1); put(at[d], at[d + 1], z1)
      }
    }
  }
  const normal = new Float32Array(position.length)
  for (let i = 0; i < position.length; i += 9) faceNormal(position, normal, i)
  return { position, normal, groups: [0, lidVerts, 0, lidVerts, wallVerts, 1] }
}
