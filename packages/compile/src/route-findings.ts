import type { Board, DrcMarker, Item, Keepout, Ring, RouteFailure, RouteRecord } from '@pcbjs/core/model'
import { area, centroid, intersection, overlaps, polysToRings } from './geom.js'
import { copperLayers } from './layers.js'
import { copperLayersOf, copperRings } from './copper.js'
import { marker } from './messages.js'
import type { TemplateArgs } from '@pcbjs/core/finding'
import type { Src } from '@pcbjs/core/internal/types'

/** mm², below which the part of a pour inside a keepout is rounding, not copper */
const ZONE_SLIVER = 1e-3
const sameSite = (a: Src | undefined, b: Src | undefined) => !!a && !!b && a.file === b.file && a.line === b.line && a.col === b.col
const where = (s: { file: string; line: number; col: number } | undefined) => (s ? ` (${s.file}:${s.line}:${s.col})` : '')

/** An item as a finding names it: its kind, part or pad, net and source. */
export function itemLabel(it: Item): string {
  const base = it.kind === 'pad' ? `pad ${it.ref}/${it.num}` : it.ref ? `${it.kind} of ${it.ref}` : it.kind
  return `${base}${it.net ? ` (${it.net})` : ''}${where(it.src)}`
}

/** A thin band along the straight line of a leg, 0.02 mm wide, for overlap tests. */
function band(f: RouteFailure): Ring {
  const dx = f.to.x - f.from.x,
    dy = f.to.y - f.from.y,
    len = Math.hypot(dx, dy) || 1,
    w = 0.01
  const nx = (-dy / len) * w,
    ny = (dx / len) * w,
    ex = (dx / len) * w,
    ey = (dy / len) * w
  return [
    [f.from.x - ex + nx, f.from.y - ey + ny],
    [f.from.x - ex - nx, f.from.y - ey - ny],
    [f.to.x + ex - nx, f.to.y + ey - ny],
    [f.to.x + ex + nx, f.to.y + ey + ny],
  ]
}

/** The track keepouts across a failed leg's straight line when, together, they cut it on every layer tried. */
export function blockingKeepouts(board: Board, f: RouteFailure): Keepout[] {
  const line = [band(f)]
  const ks = (board.keepouts ?? []).filter(
    k => k.tracks && !(f.net !== undefined && k.except?.includes(f.net)) && f.layers.some(l => k.layers.includes(l)) && overlaps(line, k.outline),
  )
  return f.layers.every(l => ks.some(k => k.layers.includes(l))) ? ks : []
}

const keepoutNames = (ks: Keepout[]) => ks.map(k => `${k.ref ? `${k.ref} ` : ''}${where(k.src).trim() || 'without a source'}`)
const keepoutText = (ks: Keepout[], layers: string[]) =>
  `; blocked by the keepout${ks.length > 1 ? 's' : ''} ${keepoutNames(ks).join(', ')} on ${[...new Set(ks.flatMap(k => k.layers.filter(l => layers.includes(l))))].join(', ')}`

/** One route-failed error per failed leg. */
export function routeFailedFindings(board: Board, failures: RouteFailure[], routes: readonly Pick<RouteRecord, 'id' | 'net' | 'src'>[] = board.routes ?? []): DrcMarker[] {
  const byId = new Map(board.items.map(it => [it.id, it]))
  return failures.map(f => {
    const leg = f.legs > 1 ? `leg ${f.leg} of ${f.legs} of ` : ''
    // the route call that failed, the one whose source the failure carries
    const route = routes.find(r => sameSite(r.src, f.src) && (f.net === undefined || r.net === f.net))?.id
    const blockers = f.blockers.map(id => byId.get(id)).filter((it): it is Item => !!it)
    const ks = blockingKeepouts(board, f)
    const args: TemplateArgs = f.message
      ? { text: f.message }
      : {
          leg,
          net: f.net ?? '(no net)',
          from: [f.from.x, f.from.y],
          fromLayer: f.from.layer,
          to: [f.to.x, f.to.y],
          toLayer: f.to.layer,
          layers: f.layers,
          reason: f.reason,
          blocked: ks.length ? keepoutText(ks, f.layers) : '',
          obstacles: blockers.map(itemLabel),
        }
    const m = marker({
      severity: 'error',
      rule: 'route-failed',
      args,
      at: [(f.from.x + f.to.x) / 2, (f.from.y + f.to.y) / 2],
      layer: f.from.layer,
      items: f.blockers,
      refs: [...(route ? [route] : []), ...(f.net !== undefined ? [`net:${f.net}`] : [])],
      witness: {
        layer: f.from.layer,
        segments: [
          [
            [f.from.x, f.from.y],
            [f.to.x, f.to.y],
          ],
        ],
      },
    })
    if (f.src) m.src = f.src
    return m
  })
}

/** One keepout error per item whose copper of a forbidden kind enters a keepout on one of its layers. */
export function keepoutFindings(board: Board): DrcMarker[] {
  const out: DrcMarker[] = []
  const cu = copperLayers(board.copper)
  const kinds = (k: Keepout, it: Item) => (it.kind === 'track' ? k.tracks : it.kind === 'via' ? k.vias : it.kind === 'zone' ? k.pours : false)
  for (const k of board.keepouts ?? []) {
    for (const it of board.items) {
      if (!kinds(k, it) || (it.net !== undefined && k.except?.includes(it.net))) continue
      for (const layer of copperLayersOf(it, cu)) {
        if (!k.layers.includes(layer)) continue
        const rings = copperRings(it, layer)
        if (!rings.length || !overlaps(rings, k.outline)) continue
        const inter = polysToRings(intersection(rings, k.outline))
        // a pour cut by the keepout keeps slivers from the rounding of its min-width shrink and regrow
        if (it.kind === 'zone' && Math.abs(area(inter)) < ZONE_SLIVER) continue
        const m = marker({
          severity: 'error',
          rule: 'keepout',
          args: { a: itemLabel(it), keepout: where(k.src) },
          at: centroid(inter.length ? inter : rings),
          layer,
          items: [it.id],
          witness: { layer, rings: inter },
        })
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
    const m = marker({
      severity: 'warning',
      rule: 'pour-in-keepout',
      args: { pour: `pour${z.net ? ` of ${z.net}` : ''}${where(z.src)}`, keepouts: keepoutNames(ks) },
      at: centroid(z.outline),
      layer: z.layer,
      items: [z.id],
    })
    if (z.src) m.src = z.src
    if (z.net) m.refs = [`net:${z.net}`]
    out.push(m)
  }
  return out
}
