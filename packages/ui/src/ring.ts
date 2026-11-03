// The rotation ring of the tools, free of Vue and the DOM: a dark band about the anchor's origin with ticks every 15 degrees, majors
// every 90, and a heading triangle outside it pointing inward at the rotation; the 2D view draws it in SVG, the 3D view as meshes. Board mm.
type Pt = [number, number]
type Quad = [Pt, Pt, Pt, Pt]

/** the band's opacity, black */
export const RING_ALPHA = 0.45
/** degrees between ticks, and between major ones */
export const MINOR_TICK = 5
export const MAJOR_TICK = 90
/** the band's width as a share of the radius */
const BAND = 0.08
/** screen pixels: the least and the most band width, the least tick width, the gap between the parts and the band */
const MIN_BAND_PX = 6
const MAX_BAND_PX = 24
const MIN_TICK_PX = 1
const CLEAR_PX = 8

export interface Tick {
  quad: Quad
  major: boolean
  medium: boolean
}
export interface RingShape {
  c: Pt
  /** the band's centre line and its width */
  r: number
  band: number
  ticks: Tick[]
  /** apex first, on the band's outer edge side, pointing at the centre */
  tri: [Pt, Pt, Pt]
}

/** The unit vector at `deg` degrees counter-clockwise on screen, y down. */
const dir = (deg: number): Pt => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)]
const at = (c: Pt, u: Pt, r: number, n: Pt = [0, 0], s = 0): Pt => [c[0] + u[0] * r + n[0] * s, c[1] + u[1] * r + n[1] * s]

/** The board area that keeps a compass about its true pivot visible when framing a group. */
export function compassBox(c: Pt, box: [number, number, number, number]): [number, number, number, number] {
  const r = ringRadius(c, box, 0)
  return [c[0] - r, c[1] - r, r * 2, r * 2]
}

/** The radius whose band clears every corner of a box x y w h about `c`, `px` mm per screen pixel. */
export function ringRadius(c: Pt, box: [number, number, number, number], px: number): number {
  const [x, y, w, h] = box
  const far = Math.max(
    ...[
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].map(p => Math.hypot(p[0] - c[0], p[1] - c[1])),
  )
  const r0 = far + CLEAR_PX * px
  return r0 + bandOf(r0, px) / 2
}

/** The band's width: in proportion to the ring, kept between a few and a couple of dozen screen pixels. */
const bandOf = (r: number, px: number) => Math.min(Math.max(r * BAND, MIN_BAND_PX * px), MAX_BAND_PX * px)

/** The ring of centre-line radius `r` about `c`: ticks counted from `base`, the grid's angle, the triangle at `rot`; every length in proportion to the band, which `px` keeps a few to two dozen pixels wide. */
export function ringShape(c: Pt, r: number, rot: number, base: number, px: number): RingShape {
  const band = bandOf(r, px)
  const inner = r - band / 2,
    outer = r + band / 2
  const ticks: Tick[] = []
  const step = (2 * Math.PI * r) / px / 72 >= 5 ? MINOR_TICK : 15
  for (let k = 0; k < 360 / step; k++) {
    const deg = base + k * step
    const major = (k * step) % MAJOR_TICK === 0
    const u = dir(deg),
      n: Pt = [-u[1], u[0]]
    const medium = (k * step) % 15 === 0
    const half = Math.max(band * (major ? 0.12 : 0.06), MIN_TICK_PX * px) / 2
    // a major spans the band, a minor its outer half
    const from = major ? inner : medium ? r : outer - band * 0.22
    ticks.push({ medium, quad: [at(c, u, from, n, -half), at(c, u, outer, n, -half), at(c, u, outer, n, half), at(c, u, from, n, half)], major })
  }
  const u = dir(rot),
    n: Pt = [-u[1], u[0]]
  const gap = band * 0.25,
    h = band * 1.2
  const tri: [Pt, Pt, Pt] = [at(c, u, outer + gap), at(c, u, outer + gap + h, n, -h * 0.6), at(c, u, outer + gap + h, n, h * 0.6)]
  return { c, r, band, ticks, tri }
}

/** Closed polygons as one SVG path. */
export const polyPath = (polys: readonly Pt[][]): string => polys.map(p => 'M' + p.map(q => `${+q[0].toFixed(4)} ${+q[1].toFixed(4)}`).join('L') + 'Z').join('')
