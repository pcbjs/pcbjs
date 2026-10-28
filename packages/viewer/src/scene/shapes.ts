type Ring = [number, number][]

/** Signed area in board coordinates: positive for an outer ring of the items export, negative for a hole. */
export function signedArea(r: Ring): number {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return a / 2
}

export function inside(p: [number, number], r: Ring): boolean {
  let c = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i],
      [xj, yj] = r[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

type Box = [number, number, number, number]
function boxOf(r: Ring): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of r) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}
const holds = (a: Box, b: Box) => b[0] >= a[0] && b[1] >= a[1] && b[2] <= a[2] && b[3] <= a[3]
const meets = (a: Box, b: Box) => b[0] <= a[2] && b[2] >= a[0] && b[1] <= a[3] && b[3] >= a[1]

/** A ring with its edges bucketed by y: inside() in about constant time for the long rings of a pour. */
export class RingIndex {
  readonly ring: Ring
  readonly box: Box
  private y0: number
  private k: number
  private bands: number[][] | null = null
  constructor(ring: Ring) {
    this.ring = ring
    this.box = boxOf(ring)
    const n = ring.length
    this.y0 = this.box[1]
    const bandsN = n > 48 ? Math.min(4096, Math.ceil(n / 4)) : 0
    this.k = bandsN ? bandsN / Math.max(1e-9, this.box[3] - this.box[1]) : 0
    if (!bandsN) return
    const bands: number[][] = Array.from({ length: bandsN }, () => [])
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = Math.min(ring[i][1], ring[j][1]),
        b = Math.max(ring[i][1], ring[j][1])
      const lo = Math.max(0, Math.floor((a - this.y0) * this.k)),
        hi = Math.min(bandsN - 1, Math.floor((b - this.y0) * this.k))
      for (let q = lo; q <= hi; q++) bands[q].push(i)
    }
    this.bands = bands
  }
  inside(p: [number, number]): boolean {
    const b = this.box
    if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return false
    if (!this.bands) return inside(p, this.ring)
    const r = this.ring,
      n = r.length
    const band = this.bands[Math.min(this.bands.length - 1, Math.max(0, Math.floor((p[1] - this.y0) * this.k)))]
    let c = false
    for (const i of band) {
      const j = i === 0 ? n - 1 : i - 1
      const [xi, yi] = r[i],
        [xj, yj] = r[j]
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
}

/** Polygons from rings, each hole in the smallest outer containing it; `cutouts` are extra holes used only when wholly inside. */
export function ringsToPolys(rings: Ring[], cutouts: Ring[] = []): { outer: Ring; holes: Ring[] }[] {
  const outers: { ring: RingIndex; area: number; holes: Ring[] }[] = []
  const holes: RingIndex[] = []
  for (const r of rings) {
    const a = signedArea(r)
    if (a > 0) outers.push({ ring: new RingIndex(r), area: a, holes: [] })
    else if (a < 0) holes.push(new RingIndex(r))
  }
  for (const h of holes) {
    let best: (typeof outers)[number] | null = null
    for (const o of outers) if ((!best || o.area < best.area) && holds(o.ring.box, h.box) && o.ring.inside(h.ring[0])) best = o
    best?.holes.push(h.ring)
  }
  for (const c of cutouts) {
    const cb = boxOf(c)
    const o = outers.find(o => holds(o.ring.box, cb) && c.every(p => o.ring.inside(p)))
    if (o && !holes.some(h => meets(h.box, cb) && c.some(p => h.inside(p)))) o.holes.push([...c].reverse())
  }
  return outers.map(o => ({ outer: o.ring.ring, holes: o.holes }))
}

/** Rings of the filled paths of a layer's markup, `M x yLx y...Z` as ringPath writes them; stroked paths are skipped. */
export function markupRings(svg: string): { id: number | null; rings: Ring[] }[] {
  const out: { id: number | null; rings: Ring[] }[] = []
  for (const m of svg.matchAll(/<path\b([^>]*)>/g)) {
    const a = m[1]
    if (/fill="none"/.test(a)) continue
    const d = /\bd="([^"]*)"/.exec(a)?.[1]
    if (!d) continue
    const id = /data-id="(\d+)"/.exec(a)?.[1]
    const rings: Ring[] = []
    for (const sub of d.split(/Z/i)) {
      const nums = sub
        .replace(/[ML]/g, ' ')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(n => !isNaN(n))
      if (nums.length < 6) continue
      const r: Ring = []
      for (let i = 0; i + 1 < nums.length; i += 2) r.push([nums[i], nums[i + 1]])
      rings.push(r)
    }
    if (rings.length) out.push({ id: id ? +id : null, rings })
  }
  return out
}
