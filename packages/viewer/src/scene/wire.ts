// the exploded view's parts planes as line segments: the outline and an inner grid, pure math so it runs in tests
export type Ring = readonly (readonly [number, number])[]

/** Every ring's edges as x0, y0, x1, y1 runs. */
export function outlineSegs(rings: readonly Ring[]): number[] {
  const out: number[] = []
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) out.push(r[j][0], r[j][1], r[i][0], r[i][1])
  return out
}

/** The crossings of the line `axis` = v with the rings' edges, sorted along the line. */
function crossings(rings: readonly Ring[], axis: 0 | 1, v: number): number[] {
  const o = 1 - axis, out: number[] = []
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j], b = r[i]
    if ((a[axis] > v) !== (b[axis] > v)) out.push(a[o] + ((v - a[axis]) * (b[o] - a[o])) / (b[axis] - a[axis]))
  }
  return out.sort((p, q) => p - q)
}

/** Lines every `step` mm across the rings' box, kept where they are inside by the even-odd rule, so cutouts stay open; x0, y0, x1, y1 runs. */
export function gridSegs(rings: readonly Ring[], step: number): number[] {
  const pts = rings.flat()
  if (!pts.length || !(step > 0)) return []
  const out: number[] = []
  for (const axis of [0, 1] as const) {
    const lo = Math.min(...pts.map(p => p[axis])), hi = Math.max(...pts.map(p => p[axis]))
    for (let k = Math.floor(lo / step + 1e-9) + 1; k * step < hi - 1e-9; k++) {
      const v = k * step, c = crossings(rings, axis, v)
      for (let i = 0; i + 1 < c.length; i += 2) out.push(...(axis === 0 ? [v, c[i], v, c[i + 1]] : [c[i], v, c[i + 1], v]))
    }
  }
  return out
}
