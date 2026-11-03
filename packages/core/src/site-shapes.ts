// The items' rings of the shapes facet, packed flat, and their reading by item id; free of Node, see SiteShapes.
import type { PackedRings, SiteData, SiteShapes } from './site-data.js'

type Ring = [number, number][]
/** Rings flat: every point's x and y in one array, the point count of each ring in another. */
export interface FlatRings {
  xy: Float64Array
  len: Uint32Array
}

/** Each item's rings packed, in the order given. */
export function pack(entries: Iterable<readonly [number, readonly Ring[]]>): PackedRings {
  const out: PackedRings = { ids: [], n: [], len: [], xy: [] }
  for (const [id, rings] of entries) {
    out.ids.push(id)
    out.n.push(rings.length)
    for (const r of rings) {
      out.len.push(r.length)
      for (const p of r) out.xy.push(p[0], p[1])
    }
  }
  return out
}

/** One set after the other. */
export const joinPacked = (a: PackedRings, b: PackedRings): PackedRings => ({ ids: [...a.ids, ...b.ids], n: [...a.n, ...b.n], len: [...a.len, ...b.len], xy: [...a.xy, ...b.xy] })
/** The shapes of a board and those of a sketch drawn over it. */
export const joinShapes = (a: SiteShapes, b: SiteShapes): SiteShapes => ({
  rings: joinPacked(a.rings, b.rings),
  covered: { F: joinPacked(a.covered.F, b.covered.F), B: joinPacked(a.covered.B, b.covered.B) },
  openings: { F: joinPacked(a.openings.F, b.openings.F), B: joinPacked(a.openings.B, b.openings.B) },
})

/** Where an item's rings start: its first ring, its ring count and its first point. */
interface At {
  r: number
  n: number
  p: number
  /** its rings once read */
  rings?: Ring[]
}
const indexes = new WeakMap<PackedRings, Map<number, At>>()
function indexOf(s: PackedRings): Map<number, At> {
  let m = indexes.get(s)
  if (m) return m
  m = new Map()
  let r = 0,
    p = 0
  for (let i = 0; i < s.ids.length; i++) {
    m.set(s.ids[i], { r, n: s.n[i], p })
    for (let k = 0; k < s.n[i]; k++) p += s.len[r + k]
    r += s.n[i]
  }
  indexes.set(s, m)
  return m
}

/** An item's rings, read once, undefined when the set leaves it out. */
export function ringsIn(s: PackedRings, id: number): Ring[] | undefined {
  const at = indexOf(s).get(id)
  return at && (at.rings ??= unpack(s, at.r, at.n, at.p))
}

/** An item's rings flat, undefined when the set leaves it out. */
export function flatIn(s: PackedRings, id: number): FlatRings | undefined {
  const at = indexOf(s).get(id)
  if (!at) return undefined
  let points = 0
  for (let k = 0; k < at.n; k++) points += s.len[at.r + k]
  return { xy: Float64Array.from(s.xy.slice(at.p * 2, (at.p + points) * 2)), len: Uint32Array.from(s.len.slice(at.r, at.r + at.n)) }
}

/** An item's rings on the board, none while the board holds no shapes. */
export const shapeOf = (site: Pick<SiteData, 'shapes'>, id: number): Ring[] => (site.shapes && ringsIn(site.shapes.rings, id)) ?? []
/** An item's rings flat, null while the board holds no shapes or none of the item. */
export const flatOf = (site: Pick<SiteData, 'shapes'>, id: number): FlatRings | null => (site.shapes && flatIn(site.shapes.rings, id)) ?? null
/** The part of an item under a side's mask; undefined when it is wholly covered. */
export const coveredOf = (site: Pick<SiteData, 'shapes'>, id: number, side: 'F' | 'B'): Ring[] | undefined => site.shapes && ringsIn(site.shapes.covered[side], id)

/** Every ring of the set in order. */
export const allRings = (s: PackedRings): Ring[] => unpack(s, 0, s.len.length, 0)

function unpack(s: PackedRings, r: number, n: number, p: number): Ring[] {
  const out: Ring[] = []
  let k = p * 2
  for (let j = 0; j < n; j++) {
    const len = s.len[r + j],
      ring: Ring = new Array(len)
    for (let i = 0; i < len; i++, k += 2) ring[i] = [s.xy[k], s.xy[k + 1]]
    out.push(ring)
  }
  return out
}
