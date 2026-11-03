// the exploded view's layer callouts, laid out on screen each frame: pure math, no three.js, so it runs in tests
export type P2 = [number, number]

/** The convex hull of points, counterclockwise, no collinear points. */
export function hull(pts: readonly P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: P2[] = [],
    up: P2[] = []
  for (const q of p) {
    while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/** A world point to CSS pixels, y down, through a column-major view-projection matrix; null behind the camera. */
export function project(m: ArrayLike<number>, x: number, y: number, z: number, w: number, h: number): P2 | null {
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15]
  if (cw <= 1e-6) return null
  const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw
  const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw
  return [((nx + 1) / 2) * w, ((1 - ny) / 2) * h]
}

/** The rightmost of the hull's vertices at height z on screen; the hull is in world x and y. */
export function anchor(m: ArrayLike<number>, ring: readonly P2[], z: number, w: number, h: number): P2 | null {
  let best: P2 | null = null
  for (const [x, y] of ring) {
    const s = project(m, x, y, z, w, h)
    if (s && (!best || s[0] > best[0])) best = s
  }
  return best
}

export interface Placed {
  at: P2
  label: P2
}

/** Labels in one column `gap` px right of the rightmost anchor, each at its anchor's height, pushed `row` px apart where they would touch, in order. */
export function column(anchors: readonly P2[], row: number, gap: number): Placed[] {
  if (!anchors.length) return []
  const x = Math.max(...anchors.map(a => a[0])) + gap
  const order = anchors.map((_, i) => i).sort((a, b) => anchors[a][1] - anchors[b][1] || a - b)
  const top = (ids: number[]) => ids.reduce((s, i) => s + anchors[i][1], 0) / ids.length - ((ids.length - 1) * row) / 2
  const runs: { ids: number[]; top: number }[] = []
  for (const i of order) {
    let r = { ids: [i], top: anchors[i][1] }
    // a merged run grows upward too, so it may now touch the run above
    for (let p = runs.at(-1); p && p.top + p.ids.length * row > r.top; p = runs.at(-1)) {
      runs.pop()
      const ids = [...p.ids, ...r.ids]
      r = { ids, top: top(ids) }
    }
    runs.push(r)
  }
  const out: Placed[] = new Array(anchors.length)
  for (const r of runs)
    r.ids.forEach((i, k) => {
      out[i] = { at: anchors[i], label: [x, r.top + k * row] }
    })
  return out
}

/** A leader's SVG path: a straight line from the anchor to `stop` px short of the label. */
export function leader({ at, label }: Placed, stop: number): string {
  return `M${at[0].toFixed(1)} ${at[1].toFixed(1)}L${(label[0] - stop).toFixed(1)} ${label[1].toFixed(1)}`
}

export const REST = 0.45,
  DIMMED = 0.18

/** A callout's opacity: none while the stack is closed, opaque for the hovered layer, faint for the others while one is hovered. */
export function calloutOpacity(group: string, hover: string | null, open: boolean): number {
  if (!open) return 0
  return !hover ? REST : hover === group ? 1 : DIMMED
}
