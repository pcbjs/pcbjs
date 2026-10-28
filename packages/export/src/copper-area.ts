import type { Board, Pad, Poly, Ring, Via } from '@pcbjs/core/model'
import { copperLayers } from '@pcbjs/compile/layers'
import { copperRings } from '@pcbjs/compile/copper'
import { difference, orientRings, polysToRings, strokeOpen, union } from '@pcbjs/compile/geom'
import { circleRing } from '@pcbjs/compile/path'

// mm²
export function polysArea(ps: Poly[]): number {
  const ring = (r: Ring) => {
    let a = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
    return Math.abs(a / 2)
  }
  return ps.reduce((s, p) => s + ring(p.outer) - p.holes.reduce((h, r) => h + ring(r), 0), 0)
}

// a slot as the stroke between its end centres, as the drill file routes it
function holeRings(it: Pad | Via): Ring[] {
  if (it.kind === 'via') return [circleRing(it.at[0], it.at[1], it.drill / 2)]
  const [w, h] = it.drill!
  if (Math.abs(w - h) < 1e-9) return [circleRing(it.at[0], it.at[1], w / 2)]
  const len = Math.abs(w - h),
    a = (((w > h ? 0 : 90) - it.rot) * Math.PI) / 180
  const dx = (len / 2) * Math.cos(a),
    dy = (len / 2) * Math.sin(a)
  return polysToRings(
    strokeOpen(
      [
        [it.at[0] - dx, it.at[1] - dy],
        [it.at[0] + dx, it.at[1] + dy],
      ],
      Math.min(w, h),
    ),
  )
}

/** One net's copper on each layer it has any, drills cut out, top to bottom: the region, its area in mm², and each fill piece's area by zone id. */
export function netCopper(b: Board, net: string): { layer: string; area: number; region: Poly[]; fill: { zone: number; area: number }[] }[] {
  const cu = copperLayers(b.copper)
  const items = b.items.filter(i => i.net === net)
  const holes = b.items.filter((i): i is Pad | Via => i.kind === 'via' || (i.kind === 'pad' && !!i.drill)).flatMap(holeRings)
  const out = []
  for (const layer of cu) {
    const k = cu.indexOf(layer)
    const rings = items.flatMap(i => {
      if (i.kind === 'via') {
        const a = cu.indexOf(i.layers[0]),
          c = cu.indexOf(i.layers[1])
        return k >= Math.min(a, c) && k <= Math.max(a, c) ? orientRings(copperRings(i, layer)) : []
      }
      // a pad's or a filled drawing's rings run either way; Clipper's own strokes and fills are oriented already
      return i.kind === 'pad' || i.kind === 'graphic' ? orientRings(copperRings(i, layer)) : copperRings(i, layer)
    })
    if (!rings.length) continue
    const region = difference(polysToRings(union(rings)), holes)
    const fill = items.flatMap(i => (i.kind === 'zone' && i.layer === layer ? i.fill.map(p => ({ zone: i.id, area: polysArea([p]) })) : []))
    out.push({ layer, area: polysArea(region), region, fill })
  }
  return out
}
