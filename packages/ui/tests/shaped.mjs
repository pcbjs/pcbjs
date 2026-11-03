// A hand-made board whose items carry their rings, as the layers facet's rows and the shapes facet: each row with its box, each footprint pad with its item's uid.
import { pack } from '@pcbjs/core/site-shapes'

const boxOf = rings => {
  const pts = rings.flat()
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]
}

export function shaped(site) {
  const items = site.items ?? []
  const rows = items.map(({ rings, covered, ...row }) => ({ ...row, ...(rings?.length ? { box: boxOf(rings) } : {}) }))
  const covered = side => pack(items.flatMap(it => (it.covered?.[side] ? [[it.id, it.covered[side]]] : [])))
  const uidOf = (ref, num) => rows.find(x => x.kind === 'pad' && x.ref === ref && x.pad === num)?.uid
  const footprints = site.footprints?.map(f => ({ ...f, pads: (f.pads ?? []).map(p => (uidOf(f.ref, p.num) ? { ...p, uid: uidOf(f.ref, p.num) } : p)) }))
  return {
    ...site,
    ...(site.items ? { items: rows } : {}),
    ...(footprints ? { footprints } : {}),
    shapes: { rings: pack(items.map(it => [it.id, it.rings ?? []])), covered: { F: covered('F'), B: covered('B') }, openings: { F: pack([]), B: pack([]) } },
  }
}
