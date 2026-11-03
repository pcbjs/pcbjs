// copper of one net on one layer drawn as one region, and the item under a point of it; free of three.js, so Node imports it in the tests
import ClipperLib from 'clipper-lib'
import { RingIndex } from './shapes.js'

type Ring = [number, number][]
type Pt = [number, number]
type CPath = { X: number; Y: number }[]

/** Clipper units per mm: 10 nm, as @pcbjs/compile uses. */
const S = 1e5
const toC = (r: Ring): CPath => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }))
const fromC = (p: CPath): Ring => p.map(({ X, Y }) => [X / S, Y / S])

/** Where any ring fills, an outer counting +1 and a hole -1, less the `cuts`: outers come out positive and holes negative, as signedArea counts them. */
export function unionRings(rings: Ring[], cuts: Ring[] = []): Ring[] {
  const c = new ClipperLib.Clipper()
  c.AddPaths(rings.map(toC), ClipperLib.PolyType.ptSubject, true)
  if (cuts.length) c.AddPaths(cuts.map(toC), ClipperLib.PolyType.ptClip, true)
  const out: CPath[] = []
  const op = cuts.length ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion
  c.Execute(op, out, ClipperLib.PolyFillType.pftPositive, ClipperLib.PolyFillType.pftNonZero)
  return out.map(fromC)
}

function segDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2
}

/** The items of a merged region by their rings, in document order, and the rank of each: a lower rank wins, a pad over its pour. */
export class ItemPicker {
  private rings: Ring[][]
  private rank: number[]
  private index: RingIndex[][] | null = null
  constructor(rings: Ring[][], rank: number[]) {
    this.rings = rings
    this.rank = rank
  }
  /** The item under a board point: of those containing it the lowest rank, the last on a tie; else the nearest within `tol` mm, a point on a wall or the mask's flare; -1 for none. */
  at(p: Pt, tol = 0.05): number {
    const index = (this.index ??= this.rings.map(rs => rs.map(r => new RingIndex(r))))
    let best = -1
    for (let i = 0; i < index.length; i++) {
      let inside = false
      for (const r of index[i]) if (r.inside(p)) inside = !inside
      if (inside && (best < 0 || this.rank[i] <= this.rank[best])) best = i
    }
    if (best >= 0) return best
    let near = tol * tol
    for (let i = 0; i < index.length; i++)
      for (const r of index[i]) {
        const b = r.box
        if (p[0] < b[0] - tol || p[0] > b[2] + tol || p[1] < b[1] - tol || p[1] > b[3] + tol) continue
        const ring = r.ring
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
          const d = segDist2(p, ring[j], ring[k])
          if (d < near) {
            near = d
            best = i
          }
        }
      }
    return best
  }
}
