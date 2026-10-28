// Teardrops as KiCad 7's straight ones, filled graphics of the track's net; one too close to anything shrinks, else is dropped with `teardrop-dropped`.
import type { Board, DrcMarker, Graphic, Item, Pad, Pt, Ring, Track, Via } from '@pcbjs/core/model'
import type { ResolvedTeardrops, TeardropLevel, TeardropSize } from '@pcbjs/core/teardrop'
import { area, bbox, difference, offset, overlaps, pointInRing, polysToRings } from './geom.js'
import { copperLayers } from './layers.js'
import { copperBox, copperLayersOf, copperRings } from './copper.js'
import { Grid, type Box } from './spatial.js'
import { classOf, itemClearance, maxClearance, maxHoleClearance } from './netclass.js'
import { circleRing } from './path.js'
import { padLabel } from './drc.js'

/** The steps a teardrop that meets something shrinks through: its length, and its width over the track's, times each. */
const SHRINK = [1, 0.75, 0.5]
/** No teardrop where the track is this wide against the pad's smaller side or wider, as KiCad's default filter. */
const WIDTH_FILTER = 0.9

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k]
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1]
const len = (a: Pt) => Math.hypot(a[0], a[1])
const nm = (v: number) => Math.round(v * 1e6) / 1e6
const f3 = (v: number) => String(Math.round(v * 1000) / 1000)
const sizeOf = (s: TeardropSize, d: number) => ('ratio' in s ? s.ratio * d : s.mm)

/** Where the polyline from its first point, inside `ring`, crosses out of it: the point, the segment's direction and what is left of it. */
function exitOf(seq: Ring, ring: Ring): { at: Pt; u: Pt; rest: number } | null {
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i],
      b = seq[i + 1],
      ab = sub(b, a),
      l = len(ab)
    if (l < 1e-9 || pointInRing(b, ring)) continue
    let t = 0
    for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
      const p = ring[k],
        e = sub(ring[j], p),
        den = ab[0] * e[1] - ab[1] * e[0]
      if (Math.abs(den) < 1e-15) continue
      const ap = sub(p, a),
        tt = (ap[0] * e[1] - ap[1] * e[0]) / den,
        s = (ap[0] * ab[1] - ap[1] * ab[0]) / den
      if (tt >= 0 && tt <= 1 && s >= 0 && s <= 1 && tt > t) t = tt
    }
    const u: Pt = [ab[0] / l, ab[1] / l]
    return { at: add(a, ab, t), u, rest: l * (1 - t) }
  }
  return null
}

/** Add a routed board's teardrops and return the `teardrop-dropped` findings; a class's `teardrops` sits between `board` and `routes`. */
export function teardrops(board: Board, own: { on: boolean; spec: ResolvedTeardrops }, routes: Record<string, boolean | TeardropLevel> = {}): DrcMarker[] {
  const specFor = (t: Track): ResolvedTeardrops | null => {
    const r = t.route !== undefined ? routes[t.route] : undefined
    if (r === false) return null
    const c = classOf(board, t.net)?.teardrops
    if (r === undefined && (c === false || (c === undefined && !own.on))) return null
    return { ...own.spec, ...(c || {}), ...(typeof r === 'object' ? r : {}) }
  }
  const tracks = board.items.filter((t): t is Track => t.kind === 'track' && t.net !== undefined && t.pts.length >= 2)
  const jobs = tracks.map(t => ({ t, spec: specFor(t) })).filter(j => j.spec)
  if (!jobs.length) return []

  const cu = copperLayers(board.copper)
  const r = board.rules
  const out: DrcMarker[] = []
  let nextId = board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
  const inner = board.outline.length ? polysToRings(offset(board.outline, -r.edgeClearance + 0.0005)) : null
  const reach = Math.max(maxClearance(board), maxHoleClearance(board)) + 0.01
  // pours aside: their fill comes after and clears around the teardrops
  const layers = new Map<string, { on: Item[]; grid: Grid; pads: Pad[]; padGrid: Grid }>()
  const layerOf = (layer: string) => {
    let l = layers.get(layer)
    if (!l) {
      const on = board.items.filter(it => it.kind !== 'zone' && copperLayersOf(it, cu).includes(layer) && copperRings(it, layer).length)
      const pads = on.filter((p): p is Pad => p.kind === 'pad' && p.net !== undefined)
      layers.set(layer, (l = { on, grid: new Grid(on.map(it => copperBox(it, layer))), pads, padGrid: new Grid(pads.map(p => copperBox(p, layer))) }))
    }
    return l
  }
  const holes = board.items.flatMap((it): { it: Pad | Via; at: Pt; r: number; c: number }[] =>
    it.kind === 'pad' && it.drill
      ? [{ it, at: it.at, r: Math.max(...it.drill) / 2, c: Math.max(r.holeClearance, it.holeClearance ?? 0) }]
      : it.kind === 'via'
        ? [{ it, at: it.at, r: it.drill / 2, c: r.holeClearance }]
        : [],
  )
  const placed: Graphic[] = []

  /** What a teardrop ring of `net` on `layer` would come too close to, in words, or null when it keeps every clearance. */
  const blocker = (ring: Ring, layer: string, net: string, pad: Pad): string | null => {
    const box = bbox([ring]),
      q: Box = { x: box.x, y: box.y, w: box.w, h: box.h }
    const ask = { kind: 'graphic', net }
    const grown = new Map<number, Ring[]>()
    const grow = (c: number) => {
      let g = grown.get(c)
      if (!g) grown.set(c, (g = polysToRings(offset([ring], c - 0.0005))))
      return g
    }
    const l = layerOf(layer)
    for (const k of l.grid.query(q, reach)) {
      const o = l.on[k]
      if (o === pad || (o.net !== undefined && o.net === net)) continue
      const c = itemClearance(board, ask, o)
      if (overlaps(grow(c), copperRings(o, layer)))
        return `${o.kind === 'pad' ? padLabel(o) : o.ref ? `${o.kind} of ${o.ref}` : o.kind} (${o.net ?? 'no net'}), closer than ${c} mm`
    }
    for (const g of placed) {
      if (g.layer !== layer || g.net === net) continue
      const c = itemClearance(board, ask, g)
      if (overlaps(grow(c), g.paths)) return `the teardrop of ${g.net}, closer than ${c} mm`
    }
    for (const h of holes) {
      if (h.it.kind === 'pad' ? h.it.type !== 'npth' && h.it.net === net : h.it.net === net) continue
      if (h.it.kind === 'via' && !copperLayersOf(h.it, cu).includes(layer)) continue
      if (Math.abs(h.at[0] - (box.x + box.w / 2)) > box.w / 2 + h.r + h.c + 0.01 || Math.abs(h.at[1] - (box.y + box.h / 2)) > box.h / 2 + h.r + h.c + 0.01) continue
      if (overlaps(grow(h.c), [circleRing(h.at[0], h.at[1], h.r)]))
        return `the hole of ${h.it.kind === 'pad' ? padLabel(h.it) : `via ${h.it.net ?? ''}`.trim()}, closer than ${h.c} mm`
    }
    if (inner && Math.abs(area(polysToRings(difference([ring], inner)))) > 1e-9) return `the board edge, closer than ${r.edgeClearance} mm`
    for (const k of board.keepouts ?? []) if (k.tracks && k.layers.includes(layer) && !k.except?.includes(net) && overlaps([ring], k.outline)) return 'a keepout'
    return null
  }

  for (const { t, spec } of jobs) {
    const s = spec!
    const l = layerOf(t.layer)
    for (const end of [0, 1]) {
      const seq = end === 0 ? t.pts : [...t.pts].reverse()
      const e = seq[0]
      const pad = l.padGrid
        .query({ x: e[0], y: e[1], w: 0, h: 0 })
        .map(k => l.pads[k])
        .find(p => p.net === t.net && (s.pads === 'all' || p.type === s.pads) && p.type !== 'npth' && pointInRing(e, p.poly))
      if (!pad) continue
      const d = Math.min(...pad.size)
      if (t.width >= WIDTH_FILTER * d) continue
      const x = exitOf(seq, pad.poly)
      if (!x) continue
      // the wide end lies across the track through the pad centre's foot on it
      const n: Pt = [-x.u[1], x.u[0]]
      const base = add(x.at, x.u, -Math.max(dot(sub(x.at, pad.at), x.u), 0))
      let W = sizeOf(s.width, d)
      while (W > t.width * 1.05 && !(pointInRing(add(base, n, W / 2), pad.poly) && pointInRing(add(base, n, -W / 2), pad.poly))) W *= 0.9
      const L = Math.min(sizeOf(s.length, d), x.rest)
      if (W <= t.width * 1.05 || L < t.width / 4) continue
      const ringAt = (k: number): Ring => {
        const a = add(x.at, x.u, L * k),
          w = t.width + (W - t.width) * k
        const ring: Ring = [add(a, n, t.width / 2), add(base, n, w / 2), add(base, n, -w / 2), add(a, n, -t.width / 2)].map(p => [nm(p[0]), nm(p[1])] as Pt)
        return area([ring]) < 0 ? ring.reverse() : ring
      }
      let ring: Ring | null = null,
        why: string | null = null
      for (const k of SHRINK) {
        const cand = ringAt(k)
        why = blocker(cand, t.layer, t.net!, pad)
        if (!why) {
          ring = cand
          break
        }
      }
      if (!ring) {
        out.push({
          severity: 'info',
          rule: 'teardrop-dropped',
          message: `no teardrop where track ${t.net} leaves ${padLabel(pad)} on ${t.layer}: even at ${f3(SHRINK[SHRINK.length - 1] * 100)}% it would meet ${why}`,
          at: x.at,
          layer: t.layer,
          items: [pad.id, t.id],
        })
        continue
      }
      const g: Graphic = { kind: 'graphic', id: nextId++, layer: t.layer, net: t.net, paths: [ring], closed: [true], width: 0, fill: true, teardrop: { pad: pad.id, track: t.id } }
      board.items.push(g)
      placed.push(g)
    }
  }
  return out
}
