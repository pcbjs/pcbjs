import type { Board, DrcMarker, Item, Keepout, Ring, RouteFailure } from '@pcbjs/core/model'
import { area, centroid, intersection, overlaps, polysToRings } from './geom.js'
import { copperLayers } from './layers.js'
import { copperLayersOf, copperRings } from './copper.js'

const fmt = (v: number) => String(Math.round(v * 1000) / 1000)
/** mm², below which the part of a pour inside a keepout is rounding, not copper */
const ZONE_SLIVER = 1e-3
const where = (s: { file: string; line: number; col: number } | undefined) => (s ? ` (${s.file}:${s.line}:${s.col})` : '')

/** An item as a finding names it: its kind, part or pad, net and source. */
export function itemLabel(it: Item): string {
  const base = it.kind === 'pad' ? `pad ${it.ref}.${it.num}` : it.ref ? `${it.kind} of ${it.ref}` : it.kind
  return `${base}${it.net ? ` (${it.net})` : ''}${where(it.src)}`
}

/** A thin band along the straight line of a leg, 0.02 mm wide, for overlap tests. */
function band(f: RouteFailure): Ring {
  const dx = f.to.x - f.from.x, dy = f.to.y - f.from.y, len = Math.hypot(dx, dy) || 1, w = 0.01
  const nx = (-dy / len) * w, ny = (dx / len) * w, ex = (dx / len) * w, ey = (dy / len) * w
  return [[f.from.x - ex + nx, f.from.y - ey + ny], [f.from.x - ex - nx, f.from.y - ey - ny], [f.to.x + ex - nx, f.to.y + ey - ny], [f.to.x + ex + nx, f.to.y + ey + ny]]
}

/** The track keepouts across a failed leg's straight line when, together, they cut it on every layer tried. */
export function blockingKeepouts(board: Board, f: RouteFailure): Keepout[] {
  const line = [band(f)]
  const ks = (board.keepouts ?? []).filter(k => k.tracks && !(f.net !== undefined && k.except?.includes(f.net)) && f.layers.some(l => k.layers.includes(l)) && overlaps(line, k.outline))
  return f.layers.every(l => ks.some(k => k.layers.includes(l))) ? ks : []
}

const keepoutText = (ks: Keepout[], layers: string[]) =>
  `; blocked by the keepout${ks.length > 1 ? 's' : ''} ${ks.map(k => `${k.ref ? `${k.ref} ` : ''}${where(k.src).trim() || 'without a source'}`).join(', ')} on ${[...new Set(ks.flatMap(k => k.layers.filter(l => layers.includes(l))))].join(', ')}`

/** One route-failed error per failed leg. */
export function routeFailedFindings(board: Board, failures: RouteFailure[]): DrcMarker[] {
  const byId = new Map(board.items.map(it => [it.id, it]))
  return failures.map(f => {
    const leg = f.legs > 1 ? `leg ${f.leg} of ${f.legs} of ` : ''
    const blockers = f.blockers.map(id => byId.get(id)).filter((it): it is Item => !!it)
    const ks = blockingKeepouts(board, f)
    const message = f.message ?? `cannot route ${leg}net ${f.net ?? '(no net)'} from (${fmt(f.from.x)}, ${fmt(f.from.y)}) on ${f.from.layer} to (${fmt(f.to.x)}, ${fmt(f.to.y)}) on ${f.to.layer}, layers ${f.layers.join(', ')}: ${f.reason}${ks.length ? keepoutText(ks, f.layers) : ''}${blockers.length ? `; nearest obstacles: ${blockers.map(itemLabel).join(', ')}` : ''}`
    const m: DrcMarker = {
      severity: 'error', rule: 'route-failed', message, at: [(f.from.x + f.to.x) / 2, (f.from.y + f.to.y) / 2], layer: f.from.layer, items: f.blockers,
      route: { ...(f.net !== undefined ? { net: f.net } : {}), leg: f.leg, legs: f.legs, from: f.from, to: f.to, layers: f.layers },
    }
    if (f.src) m.src = f.src
    return m
  })
}

/** One keepout error per item whose copper of a forbidden kind enters a keepout on one of its layers. */
export function keepoutFindings(board: Board): DrcMarker[] {
  const out: DrcMarker[] = []
  const cu = copperLayers(board.copper)
  const kinds = (k: Keepout, it: Item) => it.kind === 'track' ? k.tracks : it.kind === 'via' ? k.vias : it.kind === 'zone' ? k.pours : false
  for (const k of board.keepouts ?? []) {
    for (const it of board.items) {
      if (!kinds(k, it) || it.net !== undefined && k.except?.includes(it.net)) continue
      for (const layer of copperLayersOf(it, cu)) {
        if (!k.layers.includes(layer)) continue
        const rings = copperRings(it, layer)
        if (!rings.length || !overlaps(rings, k.outline)) continue
        const inter = polysToRings(intersection(rings, k.outline))
        // a pour cut by the keepout keeps slivers from the rounding of its min-width shrink and regrow
        if (it.kind === 'zone' && Math.abs(area(inter)) < ZONE_SLIVER) continue
        const m: DrcMarker = { severity: 'error', rule: 'keepout', message: `${itemLabel(it)} is inside the keepout${where(k.src)} on ${layer}`, at: centroid(inter.length ? inter : rings), layer, items: [it.id] }
        if (it.src) m.src = it.src
        out.push(m)
        break
      }
    }
  }
  for (const z of board.items) {
    if (z.kind !== 'zone' || z.fill.length) continue
    const ks = (board.keepouts ?? []).filter(k => k.pours && k.layers.includes(z.layer) && !(z.net !== undefined && k.except?.includes(z.net)) && overlaps(z.outline, k.outline))
    if (!ks.length) continue
    const m: DrcMarker = { severity: 'warning', rule: 'pour-in-keepout', message: `pour${z.net ? ` of ${z.net}` : ''}${where(z.src)} on ${z.layer} has no fill: the keepout${ks.length > 1 ? 's' : ''} ${ks.map(k => `${k.ref ? `${k.ref} ` : ''}${where(k.src).trim() || 'without a source'}`).join(', ')} forbid${ks.length > 1 ? '' : 's'} pours there`, at: centroid(z.outline), layer: z.layer, items: [z.id] }
    if (z.src) m.src = z.src
    if (z.net) m.net = z.net
    out.push(m)
  }
  return out
}

/** Every finding of this module, for compile/index.ts to merge into board.drc. */
export function routeFindings(board: Board, failures: RouteFailure[]): DrcMarker[] {
  return [...routeFailedFindings(board, failures), ...keepoutFindings(board)]
}
