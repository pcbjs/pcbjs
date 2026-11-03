// rings travel flat: every point in one Float64Array, the point count of each ring in a Uint32Array
import type { SiteData } from '@pcbjs/core/site-data'
import type { FlatRings } from '@pcbjs/core/site-shapes'
import { RingIndex, ringsToPolys } from './shapes.js'
import { unionRings } from './merge.js'
import { extrude, type Layer, type P, type Poly } from './extrude.js'

type Ring = [number, number][]
export type { FlatRings }

export type GeoJob =
  /** an item's rings extruded from z = 0 to z = 1; with `merge`, the rings of several items unioned first and the drill rings in `merge` cut out */
  | { kind: 'unit'; key: string; rings: FlatRings; merge?: FlatRings }
  /** the mask skin over an item, a thin lens from z = -t to t whose waist is `flare` wider, so the mask slopes down to the board round it; cutouts are the mask openings that fall inside it; `merge` as for a unit */
  | { kind: 'skin'; key: string; rings: FlatRings; t: number; flare: number; cutouts?: FlatRings; merge?: FlatRings }
  /** the outline extruded `depth` with holes: further outline rings inside the first, drills packed by packDrills, openings as rings */
  | { kind: 'slab'; key: string; outline: FlatRings; drills: Float64Array; openings?: FlatRings; depth: number }

/** Non-indexed positions and normals, groups as start, count, index triples, sphere as x, y, z, r; null position for no shape. */
export interface GeoResult {
  key: string
  position: Float32Array | null
  normal: Float32Array | null
  groups: number[]
  sphere: number[]
}

export function flatten(rings: Ring[]): FlatRings {
  let n = 0
  for (const r of rings) n += r.length
  const xy = new Float64Array(n * 2),
    len = new Uint32Array(rings.length)
  let k = 0
  rings.forEach((r, i) => {
    len[i] = r.length
    for (const p of r) {
      xy[k++] = p[0]
      xy[k++] = p[1]
    }
  })
  return { xy, len }
}

export function unflatten(f: FlatRings): Ring[] {
  const out: Ring[] = []
  let k = 0
  for (const n of f.len) {
    const r: Ring = new Array(n)
    for (let i = 0; i < n; i++, k += 2) r[i] = [f.xy[k], f.xy[k + 1]]
    out.push(r)
  }
  return out
}

/** A 64-bit FNV-1a style hash of the rings at 1 µm, with the ring and point counts, as a short string. */
export function hashRings(f: FlatRings, h = [0x811c9dc5, 0x01000193]): string {
  let a = h[0] ^ f.len.length,
    b = h[1] ^ f.xy.length
  for (const n of f.len) {
    a = Math.imul(a ^ n, 16777619)
    b = Math.imul(b ^ n, 2246822519)
  }
  for (let i = 0; i < f.xy.length; i++) {
    const v = Math.round(f.xy[i] * 1000) | 0
    a = Math.imul(a ^ v, 16777619)
    b = Math.imul((b ^ v) + (a >>> 13), 2246822519)
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${f.xy.length}`
}

export function resultBuffers(r: GeoResult): ArrayBuffer[] {
  return r.position ? [r.position.buffer as ArrayBuffer, r.normal!.buffer as ArrayBuffer] : []
}

/** Geometries laid end to end in order, one draw of them all: positions and normals, and the first triangle of each, one more than there are. */
export function concat(parts: readonly ({ position: ArrayLike<number>; normal: ArrayLike<number> } | null)[]): {
  position: Float32Array
  normal: Float32Array
  starts: Uint32Array
} {
  const starts = new Uint32Array(parts.length + 1)
  parts.forEach((p, i) => (starts[i + 1] = starts[i] + (p ? p.position.length / 9 : 0)))
  const n = starts[parts.length] * 9
  const position = new Float32Array(n),
    normal = new Float32Array(n)
  parts.forEach((p, i) => {
    if (!p) return
    position.set(p.position, starts[i] * 9)
    normal.set(p.normal, starts[i] * 9)
  })
  return { position, normal, starts }
}

/** The part a triangle of a concatenation belongs to, by the parts' first triangles; -1 past the end. */
export function partOf(starts: Uint32Array, triangle: number): number {
  let lo = 0,
    hi = starts.length - 2
  if (hi < 0 || triangle < 0 || triangle >= starts[hi + 1]) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= triangle) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Board rings to three.js x, y: y flips. */
const flip = (r: Ring): P[] => r.map(p => [p[0], -p[1]])
const DRILL = 5

/** Drills as x, y, d, len, a per hole; len 0 for a round one. */
export function packDrills(drills: { x: number; y: number; d: number; len?: number; a?: number }[]): Float64Array {
  const out = new Float64Array(drills.length * DRILL)
  drills.forEach((h, i) => out.set([h.x, h.y, h.d, h.len ?? 0, h.a ?? 0], i * DRILL))
  return out
}

/** A drill as ExtrudeGeometry draws an absarc, 48 points round; a slot is a stadium of two such halves, `a` in degrees from +x toward +y. */
function drillRing(x: number, y: number, d: number, len: number, a: number): P[] {
  const r = d / 2,
    half = Math.max(0, len - d) / 2,
    t = (a * Math.PI) / 180
  const ux = Math.cos(t),
    uy = Math.sin(t),
    out: P[] = []
  for (const s of half ? [1, -1] : [1]) {
    const cx = x + s * half * ux,
      cy = y + s * half * uy
    const n = half ? 25 : 48,
      from = half ? t - Math.PI / 2 + (s < 0 ? Math.PI : 0) : 0
    for (let i = 0; i < n; i++) {
      const p = from + (Math.PI * (half ? 1 : 2) * i) / (half ? n - 1 : n)
      out.push([cx + r * Math.cos(p), -(cy + r * Math.sin(p))])
    }
  }
  return out
}

function slabPolys(j: Extract<GeoJob, { kind: 'slab' }>): Poly[] {
  const rings = unflatten(j.outline)
  const outer = new RingIndex(rings[0])
  const holes: P[][] = []
  for (const r of rings.slice(1)) if (outer.inside(r[0])) holes.push(flip(r))
  const dr = j.drills
  for (let i = 0; i < dr.length; i += DRILL) if (outer.inside([dr[i], dr[i + 1]])) holes.push(drillRing(dr[i], dr[i + 1], dr[i + 2], dr[i + 3], dr[i + 4]))
  if (j.openings) for (const r of unflatten(j.openings)) if (r.every(p => outer.inside(p))) holes.push(flip(r))
  return [{ outer: flip(rings[0]), holes }]
}

export function runJob(j: GeoJob): GeoResult {
  let polys: Poly[], layers: Layer[]
  if (j.kind === 'slab') {
    polys = slabPolys(j)
    layers = [
      { z: 0, bs: 0 },
      { z: j.depth, bs: 0 },
    ]
  } else {
    const rings = j.merge ? unionRings(unflatten(j.rings), unflatten(j.merge)) : unflatten(j.rings)
    polys = ringsToPolys(rings, j.kind === 'skin' && j.cutouts ? unflatten(j.cutouts) : []).map(p => ({ outer: flip(p.outer), holes: p.holes.map(flip) }))
    // the skin is ExtrudeGeometry's one-segment bevel round a 1e-4 deep slab: a lens from -t to t, widest at its waist
    layers =
      j.kind === 'skin'
        ? [
            { z: -j.t, bs: 0 },
            { z: 0, bs: j.flare },
            { z: 1e-4, bs: j.flare },
            { z: 1e-4 + j.t, bs: 0 },
          ]
        : [
            { z: 0, bs: 0 },
            { z: 1, bs: 0 },
          ]
  }
  const empty: GeoResult = { key: j.key, position: null, normal: null, groups: [], sphere: [0, 0, 0, 0] }
  if (!polys.length) return empty
  const g = extrude(polys, layers)
  if (!g.position.length) return empty
  return { key: j.key, position: g.position, normal: g.normal, groups: g.groups, sphere: sphereOf(g.position) }
}

/** The bounding sphere as three.js computes it: the centre of the box, the radius to the farthest point. */
function sphereOf(p: Float32Array): number[] {
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i],
      y = p[i + 1],
      z = p[i + 2]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    if (z < z0) z0 = z
    if (z > z1) z1 = z
  }
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    cz = (z0 + z1) / 2
  let r2 = 0
  for (let i = 0; i < p.length; i += 3) r2 = Math.max(r2, (p[i] - cx) ** 2 + (p[i + 1] - cy) ** 2 + (p[i + 2] - cz) ** 2)
  return [cx, cy, cz, Math.sqrt(r2)]
}

/** An item's hole from its second ring and its drill: the ring, its centre and whether it is a slot. Null without one. */
export function holeOf(rings: readonly Ring[], drill: number): { ring: Ring; c: [number, number]; slot: boolean } | null {
  const r = rings[1]
  if (!r) return null
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of r) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  return { ring: r, c: [(x0 + x1) / 2, (y0 + y1) / 2], slot: Math.max(x1 - x0, y1 - y0) > drill * 1.05 }
}

/** The outline rings, the board box without one. */
export function outlineFlat(b: SiteData): FlatRings {
  const bb = b.bbox
  const rect: Ring = [
    [bb.x, bb.y],
    [bb.x + bb.w, bb.y],
    [bb.x + bb.w, bb.y + bb.h],
    [bb.x, bb.y + bb.h],
  ]
  return flatten(b.outline.length ? b.outline : [rect])
}

/** The outline extruded `depth`, cut by the drills and the openings, keyed by all of them. */
export function slabJob(b: SiteData, depth: number, drills: SiteData['drills'], openings: Ring[]): Extract<GeoJob, { kind: 'slab' }> {
  const outline = outlineFlat(b),
    op = openings.length ? flatten(openings) : undefined
  const dr = packDrills(drills)
  const key = `slab:${depth}:${hashRings(outline)}:${hashRings({ xy: dr, len: new Uint32Array([drills.length]) })}:${op ? hashRings(op) : ''}`
  return { kind: 'slab', key, outline, drills: dr, ...(op ? { openings: op } : {}), depth }
}

/** The rough cost of a job, its point count. */
export function jobSize(j: GeoJob): number {
  return (
    (j.kind === 'slab' ? j.outline.xy.length + j.drills.length + (j.openings?.xy.length ?? 0) : j.rings.xy.length + (j.kind === 'skin' && j.cutouts ? j.cutouts.xy.length : 0)) / 2
  )
}
