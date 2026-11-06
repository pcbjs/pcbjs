import type { Board, DrcMarker, Graphic, Item, Pad, Pt, Ring, Text, Via, Zone } from '@pcbjs/core/model'
import { area, bbox, centroid, contactPoint, difference, intersection, offset, overlaps, polysToRings, strokeClosed, strokeOpen } from './geom.js'
import { copperLayers } from './layers.js'
import { copperBox, copperLayersOf, copperRings, copperSet, grownSet, sameNet } from './copper.js'
import { joined, netTied, type Connectivity } from './connectivity.js'
import { contactNear, distance, EdgeSet, gap, Grid, inRings, overlapsNear, ringEdges, ringsGap, segDist } from './spatial.js'
import { hasPadOverrides, itemClearance, CLASS_DEFAULTS, maxClearance, maxHoleClearance, ownHoleClearance, ownProvenance, pairProvenance, rulesLevel } from './netclass.js'
import { marker } from './messages.js'
import type { Quantity } from '@pcbjs/core/finding'
import { coupledGap, pairsOf, routesCopper } from './pair-info.js'
import { joinsSolidly, thermalReport } from './zones.js'
import { copperWeightRule, holeClearanceOn, holeToHole } from '@pcbjs/core/internal/rules'
import { OZ } from '@pcbjs/core/internal/stackups'
import { thinInk } from '@pcbjs/core/internal/outline'
import { referenceDrc } from './drc-reference.js'
import { loopFindings } from './loops.js'
import { maskDrawings, padMask } from './mask.js'
import type { EdgeBand, EdgeBandKind, ResolvedRules as Rules } from '@pcbjs/core/internal/types'
import { isPinRef } from '@pcbjs/core/internal/nets'
import { partOf, pinOfPad, type PartState } from '@pcbjs/core/internal/part'
import { CompileError } from './flatten.js'
import { pulse } from './cancel.js'

/** Pads of one footprint with the same number are one pad drawn in parts, such as a KiCad padstack with a shape per layer. */
const onePad = (a: Item, b: Item): boolean => a.kind === 'pad' && b.kind === 'pad' && a.ref !== undefined && a.ref === b.ref && a.num !== '' && a.num === b.num

/** A copper item as findings name it. */
const label = (it: Item): string => (it.kind === 'pad' ? padLabel(it) : it.ref ? `${it.kind} of ${it.ref}` : `${it.kind}${it.net ? ` ${it.net}` : ''}`)

/** `short` and `clearance`: copper of two nets touching, or nearer than their clearance, over the candidate pairs connectivity found. */
export function clearanceChecks(board: Board, conn: Connectivity): DrcMarker[] {
  const out: DrcMarker[] = []
  const r = board.rules
  const classed = maxClearance(board) > r.clearance || hasPadOverrides(board) || !!board.classes
  // pads of one net tie group touch by design
  const tied = netTied(board)
  for (const { layer, a, b, short } of conn.near) {
    pulse()
    if (onePad(a, b) || tied?.(a, b)) continue
    const args = { a: label(a), an: a.net ?? 'no net', b: label(b), bn: b.net ?? 'no net' }
    if (short) {
      const at = contactNear(copperSet(a, layer), copperSet(b, layer))
      out.push(marker({ severity: 'error', rule: 'short', args, at, layer, items: [a.id, b.id], witness: { layer, points: [at] } }))
      continue
    }
    // a net pair's clearance is the largest of the rules' and their classes'
    const c = classed ? itemClearance(board, a, b) : r.clearance
    if (!tooClose(a, b, layer, c)) continue
    const near = gap(copperSet(a, layer), copperSet(b, layer)),
      g = grownOf(c)
    out.push(
      marker({
        severity: 'error',
        rule: 'clearance',
        args,
        measured: mm(near.d),
        required: mm(c),
        provenance: classed ? pairProvenance(board, a, b) : [rulesLevel('clearance', r.clearance)],
        at: contactNear(grownSet(a, layer, g), grownSet(b, layer, g)),
        layer,
        items: [a.id, b.id],
        witness: { layer, points: near.pts },
      }),
    )
  }

  return out
}

/** `track-width`: a track under the minimum width, or under the trackWidth of a pad it joins. */
export function trackWidthChecks(board: Board): DrcMarker[] {
  const out: DrcMarker[] = []
  const r = board.rules
  const narrow = board.items.filter((p): p is Pad => p.kind === 'pad' && p.trackWidth !== undefined && p.net !== undefined)
  const ngrid = narrow.length ? new Grid(narrow.map(p => bbox([p.poly]))) : null
  for (const it of board.items) {
    if (it.kind !== 'track') continue
    let min = r.minTrackWidth,
      by: Pad | undefined
    if (ngrid) {
      const ends = [it.pts[0], it.pts[it.pts.length - 1]]
      for (const e of ends)
        for (const k of ngrid.query({ x: e[0], y: e[1], w: 0, h: 0 }, it.width / 2)) {
          const p = narrow[k]
          if (p.net !== it.net || !p.layers.includes(it.layer) || !(inRings(e, [p.poly]) || ringsGap([p.poly], [[e, e, e]]) <= it.width / 2 + EPS)) continue
          if (by === undefined || p.trackWidth! > min) {
            min = p.trackWidth!
            by = p
          }
        }
    }
    if (it.width < min - (by ? EPS : 0))
      out.push(
        marker({
          severity: 'error',
          rule: 'track-width',
          args: { net: it.net ?? '', ...(by ? { pad: padLabel(by) } : {}) },
          measured: mm(it.width),
          required: mm(min),
          provenance: by ? ownProvenance(board, by, 'trackWidth', min) : [rulesLevel('minTrackWidth', min)],
          at: it.pts[0],
          layer: it.layer,
          items: [it.id],
          witness: { layer: it.layer, segments: it.pts.slice(1).map((q, i) => [it.pts[i], q]) },
        }),
      )
  }

  return out
}

/** `edge-clearance` for copper too near the outline, `outline` for a board without one. */
export function edgeChecks(board: Board): DrcMarker[] {
  const out: DrcMarker[] = []
  const cu = copperLayers(board.copper)
  const r = board.rules
  if (board.outline.length) {
    const insets = new Map<number, Ring[]>()
    const innerOf = (c: number) => {
      let v = insets.get(c)
      if (!v) insets.set(c, (v = polysToRings(offset(board.outline, -c + 0.0005))))
      return v
    }
    for (const layer of cu)
      for (const it of board.items) {
        pulse()
        if (it.kind === 'zone' || !copperLayersOf(it, cu).includes(layer)) continue
        const rings = copperRings(it, layer)
        if (!rings.length) continue
        const c = it.kind === 'pad' && it.edgeClearance !== undefined ? it.edgeClearance : r.edgeClearance
        const outside = difference(rings, innerOf(c))
        const own = c !== r.edgeClearance || (it.kind === 'pad' && it.edgeClearance !== undefined)
        if (outside.length)
          out.push(
            marker({
              severity: 'error',
              rule: 'edge-clearance',
              args: { a: label(it) },
              required: mm(c),
              provenance: own ? ownProvenance(board, it, 'edgeClearance', c) : [rulesLevel('edgeClearance', c)],
              at: centroid(outside.map(p => p.outer)),
              layer,
              items: [it.id],
              witness: { layer, rings: polysToRings(outside) },
            }),
          )
      }
  } else {
    out.push(marker({ severity: 'warning', rule: 'outline', at: [0, 0], layer: 'Edge.Cuts' }))
  }

  return out
}

/** `courtyard`: two parts' courtyards overlapping deeper than COURTYARD_TOLERANCE, as KiCad's courtyard check passes it. */
export function courtyardChecks(board: Board): DrcMarker[] {
  const out: DrcMarker[] = []
  for (const side of ['F.CrtYd', 'B.CrtYd']) {
    const cy = board.items
      .filter((it): it is Graphic => it.kind === 'graphic' && it.layer === side && !!it.ref)
      .map(it => ({ it, rings: it.paths.filter((p, i) => it.closed[i] && p.length >= 3) as Ring[] }))
      .filter(e => e.rings.length)
    const grid = new Grid(cy.map(e => bbox(e.rings)))
    for (let i = 0; i < cy.length; i++)
      for (const j of grid.query(grid.boxes[i]))
        if (j > i && cy[i].it.ref !== cy[j].it.ref && overlaps(cy[i].rings, cy[j].rings) && deepOverlap(cy[i].rings, cy[j].rings)) {
          const lap = polysToRings(intersection(cy[i].rings, cy[j].rings))
          out.push(
            marker({
              severity: 'warning',
              rule: 'courtyard',
              args: { a: cy[i].it.ref!, b: cy[j].it.ref! },
              measured: { value: um(Math.abs(area(lap))), unit: 'mm2' },
              at: contactPoint(cy[i].rings, cy[j].rings),
              layer: side,
              items: [cy[i].it.id, cy[j].it.id],
              witness: { layer: side, rings: lap },
            }),
          )
        }
  }

  return out
}

/** `unconnected` per ratsnest line, `single-pad` per net with one pad. */
export function unconnectedChecks(board: Board, conn: Connectivity): DrcMarker[] {
  const out: DrcMarker[] = []
  conn.ratsnest.forEach((rn, i) => {
    // a split pour names its pieces, so a pad in a cut-off piece can be found
    const w = conn.islands?.[i]
    const a = padNear(board, rn.net, rn.from),
      b = padNear(board, rn.net, rn.to)
    const end = (pad: Pad | undefined, p: Pt) => (pad ? `${pad.ref ? pad.ref + '/' : ''}${pad.num} at ${ptText(p)}` : ptText(p))
    out.push(
      marker({
        severity: 'error',
        rule: 'unconnected',
        args: { net: rn.net, ...(w ? { apart: [w[0], w[1]] } : {}), from: end(a, rn.from), to: end(b, rn.to) },
        refs: [`net:${rn.net}`, ...[a, b].flatMap(p => (p?.ref !== undefined && p.num ? [`${p.ref}/${p.num}`] : []))],
        at: [(rn.from[0] + rn.to[0]) / 2, (rn.from[1] + rn.to[1]) / 2],
        witness: { segments: [[rn.from, rn.to]] },
      }),
    )
  })
  pulse()
  for (const net of conn.singles) {
    const pad = board.items.find((i): i is Pad => i.kind === 'pad' && i.net === net)
    const refs = [`net:${net}`, ...(pad?.ref !== undefined && pad.num ? [`${pad.ref}/${pad.num}`] : [])]
    out.push(marker({ severity: 'warning', rule: 'single-pad', args: { net }, refs, at: pad ? pad.at : [0, 0] }))
  }

  return out
}

/** A check that writes its findings into `out`, as one list. */
export const collect =
  (check: (board: Board, out: DrcMarker[]) => void) =>
  (board: Board): DrcMarker[] => {
    const out: DrcMarker[] = []
    check(board, out)
    return out
  }

/** ERC `copper-weight`: copper over 1 oz needs the wider clearance and track width of COPPER_WEIGHT_RULES; one warning per board. */
export function copperWeightErc(board: Board): DrcMarker[] {
  const r = board.rules
  const heavy = new Map<number, string[]>()
  for (const l of board.stackup?.layers ?? []) {
    if (l.type !== 'copper') continue
    const oz = l.weight ?? Math.round((l.thickness / OZ) * 2) / 2
    if (copperWeightRule(oz)) heavy.set(oz, [...(heavy.get(oz) ?? []), l.name])
  }
  const out: DrcMarker[] = []
  for (const [oz, layers] of heavy) {
    const need = copperWeightRule(oz)!
    const low = [
      r.clearance < need.clearance - 1e-9 ? `clearance ${r.clearance} mm` : '',
      r.minTrackWidth < need.minTrackWidth - 1e-9 ? `minTrackWidth ${r.minTrackWidth} mm` : '',
    ].filter(Boolean)
    if (!low.length) continue
    out.push(
      marker({
        severity: 'warning',
        rule: 'copper-weight',
        at: [0, 0],
        args: { layers, oz, clearance: need.clearance, width: need.minTrackWidth, low },
      }),
    )
  }
  return out
}

const EPS = 1e-6
/** Clipper's round offsets fall short of the true arc by up to two and a quarter of their 5 µm chords a side, so in this band under a limit its boolean decides as it always did, mm. */
const CHORDS = 0.03
/** Past a limit by more than Clipper's 10 nm rounding reaches, mm. */
const SLACK = 0.0001
/** What the clearance test grows each side by: half the clearance less half a micron. */
const grownOf = (c: number) => c / 2 - 0.0005

/** Whether two items' copper on a layer comes closer than clearance c: grown each by grownOf(c), it would overlap. */
function tooClose(a: Item, b: Item, layer: string, c: number): boolean {
  const g = grownOf(c),
    ca = copperSet(a, layer),
    cb = copperSet(b, layer)
  const d = distance(ca, cb, 2 * g + SLACK, 2 * g - CHORDS)
  if (d < 2 * g - CHORDS) return true
  if (d >= 2 * g + SLACK) return false
  return overlapsNear(grownSet(a, layer, g), grownSet(b, layer, g))
}

/** Whether copper comes within `reach` of a hole's axis: the hole's `keep`, its capsule of that radius, overlaps it. */
function holeHits(reach: number, axis: EdgeSet, keep: EdgeSet, copper: EdgeSet): boolean {
  const d = distance(axis, copper, reach + SLACK, reach - CHORDS)
  if (d < reach - CHORDS) return true
  if (d >= reach + SLACK) return false
  return overlapsNear(keep, copper)
}
/** How deep two courtyards may overlap before `courtyard` reports them, mm: 10 µm, below which KiCad passes them too. */
export const COURTYARD_TOLERANCE = 0.01
/** Whether two sets of rings still overlap once each is shrunk by half the tolerance: the overlap is at least that deep. */
const deepOverlap = (a: Ring[], b: Ring[]): boolean => overlaps(polysToRings(offset(a, -COURTYARD_TOLERANCE / 2)), polysToRings(offset(b, -COURTYARD_TOLERANCE / 2)))
const f3 = (v: number) => String(Math.round(v * 1000) / 1000)
const mm = (value: number): Quantity => ({ value, unit: 'mm' })
const um = (v: number) => Math.round(v * 1e6) / 1e6
const ptText = (p: Pt) => `(${(Math.round(p[0] * 100) / 100).toFixed(2)}, ${(Math.round(p[1] * 100) / 100).toFixed(2)})`

/** The pad of a net within half a millimetre of a point, the nearest. */
function padNear(board: Board, net: string, p: Pt): Pad | undefined {
  let best: Pad | undefined,
    d = 0.25
  for (const it of board.items) {
    if (it.kind !== 'pad' || it.net !== net) continue
    const e = (it.at[0] - p[0]) ** 2 + (it.at[1] - p[1]) ** 2
    if (e < d) {
      d = e
      best = it
    }
  }
  return best
}

/** A pad as findings name it: `pad J1.15`, or an unnumbered hole by its position, `unplated hole of J1 at (3.2, 4)`. */
/** Thermal reliefs: pads joined to a pour by fewer spokes than minSpokes, and spokes thinner than the zone min width. */
export function thermalChecks(board: Board, out: DrcMarker[]) {
  const zones = board.items.filter((z): z is Zone => z.kind === 'zone')
  // a through-hole pad another pour joins solidly or through enough spokes is connected whatever this pour does
  const joinedElsewhere = (pad: Pad, z: Zone) =>
    zones.some(o => o !== z && o.net === pad.net && (joinsSolidly(o, pad) || (thermalReport(o)?.pads.some(p => p.pad === pad && p.spokes >= thermalReport(o)!.minSpokes) ?? false)))
  // a track or via of the pad's own net that joins it on the pour's layer is a connection as a spoke is, as KiCad counts it
  const own = new Map<string, { items: Item[]; grid: Grid }>()
  const joining = (pad: Pad, layer: string): number => {
    let o = own.get(layer)
    if (!o) {
      const items = board.items.filter(it => (it.kind === 'track' || it.kind === 'via') && it.net !== undefined && copperRings(it, layer).length)
      own.set(layer, (o = { items, grid: new Grid(items.map(it => copperBox(it, layer))) }))
    }
    let n = 0
    for (const k of o.grid.query(copperBox(pad, layer), 0.002)) {
      const it = o.items[k]
      if (it.net === pad.net && joined(it, pad, layer)) n++
    }
    return n
  }
  for (const z of zones) {
    pulse()
    const t = thermalReport(z)
    if (!t) continue
    const pour = `the ${z.net ?? 'no net'} pour on ${z.layer}`
    if (t.spokeWidth < t.minWidth - 1e-9 && t.pads.some(p => p.spokes > 0))
      out.push(
        marker({
          severity: 'warning',
          rule: 'thermal-spoke-width',
          args: { pour },
          measured: mm(t.spokeWidth),
          required: mm(t.minWidth),
          at: t.pads[0].pad.at,
          layer: z.layer,
          items: [z.id],
        }),
      )
    for (const { pad, spokes } of t.pads) {
      pulse()
      if (!(spokes > 0 && spokes < t.minSpokes)) continue
      const tracks = joining(pad, z.layer)
      if (spokes + tracks >= t.minSpokes || joinedElsewhere(pad, z)) continue
      out.push(
        marker({
          severity: 'warning',
          rule: 'thermal-spokes',
          args: { pad: padLabel(pad), net: pad.net ?? '', pour, spokes: t.spokes, tracks },
          measured: { value: spokes, unit: 'count' },
          required: { value: t.minSpokes, unit: 'count' },
          at: pad.at,
          layer: z.layer,
          items: [pad.id, z.id],
        }),
      )
    }
  }
}

export const padLabel = (p: Pad): string =>
  p.num ? `pad ${p.ref ?? ''}/${p.num}` : `${p.type === 'npth' ? 'unplated hole' : 'unnumbered pad'}${p.ref ? ` of ${p.ref}` : ''} at (${f3(p.at[0])}, ${f3(p.at[1])})`

/** The gap from the edge of a hole to a copper shape: negative when the copper covers part of the hole. */
function holeGap(h: { a: Pt; b: Pt; r: number }, rings: Ring[]): number {
  if (inRings(h.a, rings)) return -h.r
  let d = Infinity
  for (const [u, v] of ringEdges(rings)) d = Math.min(d, segDist(h.a, h.b, u, v))
  return d === Infinity ? 0 : d - h.r
}

/** A drilled hole as a capsule: the segment a-b swept by radius r. A round hole has a === b. */
interface Hole {
  it: Pad | Via
  a: Pt
  b: Pt
  r: number
  name: string
}

function padCapsule(pad: Pad, [w, h]: [number, number]): Pick<Hole, 'a' | 'b' | 'r'> {
  const half = Math.abs(w - h) / 2,
    t = (pad.rot * Math.PI) / 180,
    c = Math.cos(t),
    s = Math.sin(t)
  const d: Pt = w >= h ? [c * half, -s * half] : [s * half, c * half]
  return { a: [pad.at[0] - d[0], pad.at[1] - d[1]], b: [pad.at[0] + d[0], pad.at[1] + d[1]], r: Math.min(w, h) / 2 }
}

function padRingWidth(pad: Pad): number {
  const hole = padCapsule(pad, pad.drill!)
  if (pad.shape === 'circle' || pad.shape === 'oval') {
    const d = Math.min(...pad.size)
    const copper = padCapsule(pad, pad.shape === 'circle' ? [d, d] : pad.size)
    return copper.r - hole.r - Math.max(segDist(hole.a, hole.a, copper.a, copper.b), segDist(hole.b, hole.b, copper.a, copper.b))
  }
  const rings = [pad.poly]
  if (!inRings(hole.a, rings) || !inRings(hole.b, rings)) return -hole.r
  let gap = Infinity
  for (const [a, b] of ringEdges(rings)) gap = Math.min(gap, segDist(hole.a, hole.b, a, b))
  return gap - hole.r
}

function holesOf(board: Board, label: (it: Item) => string): Hole[] {
  const out: Hole[] = []
  for (const it of board.items) {
    if (it.kind === 'via') out.push({ it, a: it.at, b: it.at, r: it.drill / 2, name: label(it) })
    else if (it.kind === 'pad' && it.drill) out.push({ it, ...padCapsule(it, it.drill), name: label(it) })
  }
  return out
}

const holeRing = (h: Hole, grow: number): Ring[] => polysToRings(strokeOpen([h.a, h.b], 2 * (h.r + grow)))

/** Drill sizes, annular rings, hole to hole and hole to copper. */
export function holeChecks(board: Board, out: DrcMarker[]) {
  const r = board.rules
  const cu = copperLayers(board.copper)
  for (const it of board.items) {
    pulse()
    if (it.kind === 'via') {
      const ring = (it.size - it.drill) / 2
      const of = (rule: string, measured: number, key: keyof Rules & string, args: Record<string, number> = {}) =>
        out.push(
          marker({
            severity: 'error',
            rule,
            args: { a: label(it), ...args },
            measured: mm(measured),
            required: mm(r[key] as number),
            provenance: [rulesLevel(key, r[key] as number)],
            at: it.at,
            layer: it.layers[0],
            items: [it.id],
          }),
        )
      if (it.drill < r.minViaDrill - EPS) of('via-drill', it.drill, 'minViaDrill')
      else if (it.drill < r.minDrill - EPS) of('drill', it.drill, 'minDrill')
      if (it.size < r.minViaDiameter - EPS) of('via-size', it.size, 'minViaDiameter')
      if (ring < r.minAnnularRing - EPS) of('annular-ring', ring, 'minAnnularRing', { copper: it.size, drill: it.drill })
    } else if (it.kind === 'pad' && it.drill) {
      const d = Math.min(...it.drill)
      const of = (rule: string, measured: number, key: 'minDrill' | 'minPadAnnularRing', args: Record<string, number | boolean> = {}) =>
        out.push(
          marker({
            severity: 'error',
            rule,
            args: { a: label(it), ...args },
            measured: mm(measured),
            required: mm(r[key]),
            provenance: [rulesLevel(key, r[key])],
            at: it.at,
            layer: it.layer,
            items: [it.id],
          }),
        )
      if (d < r.minDrill - EPS) of('drill', d, 'minDrill')
      if (it.type === 'tht' && it.layers.some(l => cu.includes(l))) {
        const ring = padRingWidth(it)
        if (ring < r.minPadAnnularRing - EPS) of('annular-ring', ring, 'minPadAnnularRing', { copper: Math.min(...it.size), drill: d, plated: true })
      }
    }
  }

  const holes = holesOf(board, label)
  // boxes hold each capsule grown by half the spacing, so pairs whose boxes miss are further apart
  const half = Math.max(r.minHoleToHole, 0) / 2 + EPS
  const hgrid = new Grid(
    holes.map(h => {
      const x0 = Math.min(h.a[0], h.b[0]) - h.r - half,
        y0 = Math.min(h.a[1], h.b[1]) - h.r - half
      return { x: x0, y: y0, w: Math.max(h.a[0], h.b[0]) + h.r + half - x0, h: Math.max(h.a[1], h.b[1]) + h.r + half - y0 }
    }),
  )
  for (let i = 0; i < holes.length; i++)
    for (const j of hgrid.query(hgrid.boxes[i])) {
      pulse()
      if (j <= i) continue
      const a = holes[i],
        b = holes[j]
      const reach = a.r + b.r + r.minHoleToHole + Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]) + Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1])
      if (Math.abs(a.a[0] - b.a[0]) > reach || Math.abs(a.a[1] - b.a[1]) > reach) continue
      const gap = segDist(a.a, a.b, b.a, b.b) - a.r - b.r
      // via between two vias, pad between any other two
      const min = holeToHole(r, a.it.kind === 'via' ? 'via' : 'pad', b.it.kind === 'via' ? 'via' : 'pad')
      const kind = r.minHoleToHoleBy ? (a.it.kind === 'via' && b.it.kind === 'via' ? ' (via to via)' : ' (pad)') : ''
      if (gap < min - EPS)
        out.push(
          marker({
            severity: 'error',
            rule: 'hole-to-hole',
            args: { a: a.name, b: b.name, kind },
            measured: mm(gap),
            required: mm(min),
            provenance: [rulesLevel('minHoleToHole', min)],
            at: [(a.a[0] + b.a[0]) / 2, (a.a[1] + b.a[1]) / 2],
            items: [a.it.id, b.it.id],
            witness: { points: [a.a, b.a] },
          }),
        )
    }

  const layerGrids = cu.map(layer => {
    const on = board.items.filter(it => copperLayersOf(it, cu).includes(layer) && copperRings(it, layer).length)
    return { layer, on, grid: new Grid(on.map(it => copperBox(it, layer))) }
  })
  // the larger of the two hole clearances holds: a pad's override, its part's, or the rules', which may be by layer
  const hmax = maxHoleClearance(board),
    overridden = hmax !== r.holeClearance || hasPadOverrides(board)
  for (const h of holes) {
    pulse()
    const keeps = new Map<number, EdgeSet>(),
      axis = new EdgeSet([[h.a, h.b]])
    const keepOf = (c: number) => {
      let k = keeps.get(c)
      if (!k) keeps.set(c, (k = new EdgeSet(holeRing(h, c - 0.0005))))
      return k
    }
    const reach = keepOf(Math.max(ownHoleClearance(h.it, r), hmax))
    const seen = new Set<number>()
    for (const { layer, on, grid } of layerGrids) {
      const lr = { holeClearance: holeClearanceOn(r, layer, h.it.kind === 'via' ? 'via' : 'pad') },
        own = ownHoleClearance(h.it, lr)
      for (const j of grid.query(reach.box)) {
        const it = on[j]
        if (it === h.it || seen.has(it.id)) continue
        pulse()
        if (sameNet(it.net, h.it.net)) continue
        if (onePad(it, h.it)) continue
        const c = overridden ? Math.max(own, ownHoleClearance(it, lr)) : lr.holeClearance
        const keep = keepOf(c)
        const rings = copperSet(it, layer)
        if (holeHits(h.r + c - 0.0005, axis, keep, rings)) {
          seen.add(it.id)
          const gap = holeGap(h, copperRings(it, layer))
          const winner = own >= ownHoleClearance(it, lr) ? h.it : it
          const set = overridden ? ownProvenance(board, winner, 'holeClearance', c) : []
          const level = r.holeClearanceBy
            ? h.it.kind === 'via' && r.holeClearanceBy.via !== undefined
              ? 'via hole'
              : `${layer === 'F.Cu' || layer === 'B.Cu' ? 'outer' : 'inner'} layers`
            : undefined
          const provenance = set.length && set[0].from !== 'rules' ? set : [rulesLevel('holeClearance', lr.holeClearance, level)]
          const at = contactNear(keep, rings)
          out.push(
            marker({
              severity: 'error',
              rule: 'hole-to-copper',
              args: {
                a: label(it),
                an: it.net ?? 'no net',
                hole: h.it.kind === 'pad' && h.it.type === 'npth' ? h.name : `the hole of ${h.name}`,
                hn: h.it.net ?? 'no net',
              },
              measured: mm(gap),
              required: mm(c),
              provenance,
              at,
              layer,
              items: [h.it.id, it.id],
              witness: { layer, points: [h.a, at] },
            }),
          )
        }
      }
    }
  }
}

/** How far a coupled gap may be off its target before pair-gap fires, mm. */
const GAP_TOLERANCE = 0.01

/** Differential pairs: the gap of the coupled sections, the length difference of the two tracks and the uncoupled length. */
export function pairChecks(board: Board, out: DrcMarker[]) {
  for (const p of pairsOf(board)) {
    if (!p.P.length || !p.N.length) continue
    const name = `pair ${p.nets[0] ?? '?'}/${p.nets[1] ?? '?'} (${p.id})`
    const items = [...p.P, ...p.N].map(t => t.id)
    const rec = board.routes?.find(x => x.pair === p.id),
      rid = rec?.id
    const track = (t: { pts: Pt[] }) => t.pts.slice(1).map((q, i) => [t.pts[i], q] as [Pt, Pt])
    const base = (at: Pt, layer?: string) => ({
      at,
      ...(layer ? { layer } : {}),
      items,
      refs: [p.id, ...(rid ? [rid] : []), ...p.nets.flatMap(n => (n ? [`net:${n}`] : []))],
      args: { pair: name },
      ...(p.info?.src ? { src: p.info.src } : {}),
    })
    if (p.info) {
      const nets = new Set(p.nets)
      const pads = board.items.flatMap(it => (it.kind === 'pad' && it.net !== undefined && nets.has(it.net) ? [it.at] : []))
      const g = coupledGap(p, p.info.gap, pads)
      if (g && Math.abs(g.gap - p.info.gap) > GAP_TOLERANCE + EPS)
        out.push(
          marker({
            severity: 'error',
            rule: 'pair-gap',
            ...base(g.at, g.layer),
            args: { pair: name, tolerance: GAP_TOLERANCE },
            measured: mm(g.gap),
            required: mm(p.info.gap),
          }),
        )
    }
    const allowed = p.info?.skew ?? CLASS_DEFAULTS.skew,
      skew = Math.abs(p.lengthP - p.lengthN)
    if (skew > allowed + EPS)
      out.push(
        marker({
          severity: 'error',
          rule: 'pair-skew',
          ...base(p.P[0].pts[0], p.P[0].layer),
          args: { pair: name, p: p.nets[0] ?? 'P', n: p.nets[1] ?? 'N', lengthP: p.lengthP, lengthN: p.lengthN, ...(rec?.skewNote ? { note: rec.skewNote } : {}) },
          measured: mm(skew),
          required: mm(allowed),
          witness: { segments: [...p.P, ...p.N].flatMap(track) },
        }),
      )
    if (p.info && p.info.uncoupled > p.info.maxUncoupled + EPS)
      out.push(
        marker({
          severity: 'warning',
          rule: 'pair-uncoupled',
          ...base(p.P[0].pts[0], p.P[0].layer),
          measured: mm(p.info.uncoupled),
          required: mm(p.info.maxUncoupled),
        }),
      )
  }
}

/** Route lengths: a route outside its .length() range, and a match group whose lengths spread wider than its tolerance. */
export function lengthChecks(board: Board, out: DrcMarker[]) {
  if (!board.routes?.length) return
  const copper = routesCopper(board)
  const where = (s: { file: string; line: number; col: number } | undefined) => (s ? ` (${s.file.split(/[\\/]/).pop()}:${s.line}:${s.col})` : '')
  const name = (r: NonNullable<Board['routes']>[number]) => `${r.pair ? `pair ${r.pair}` : 'route'} ${r.id} of net ${r.net ?? '(no net)'}`
  const range = (t: { min: number; max?: number }) =>
    t.max !== undefined ? (Math.abs(t.max - t.min) < EPS ? `${f3(t.min)} mm` : `${f3(t.min)} to ${f3(t.max)} mm`) : `at least ${f3(t.min)} mm`
  const base = (c: ReturnType<typeof copper.get>, r: NonNullable<Board['routes']>[number]) => {
    const t = c!.tracks[0]
    return {
      at: t ? t.pts[0] : (c!.vias[0]?.at ?? ([0, 0] as Pt)),
      ...(t ? { layer: t.layer } : {}),
      items: [...c!.tracks, ...c!.vias].map(i => i.id),
      ...(r.src ? { src: r.src } : {}),
      refs: [r.id, ...(r.net !== undefined ? [`net:${r.net}`] : [])],
      witness: { segments: c!.tracks.flatMap(x => x.pts.slice(1).map((q, i) => [x.pts[i], q] as [Pt, Pt])) },
    }
  }
  for (const r of board.routes) {
    const c = copper.get(r.id)
    if (!r.target || !c) continue
    if (c.length < r.target.min - EPS || c.length > (r.target.max ?? Infinity) + EPS)
      out.push(
        marker({
          severity: 'error',
          rule: 'length',
          args: {
            route: name(r),
            range: range(r.target),
            ...(r.tuned ? { tuned: r.tuned } : {}),
            ...(r.note ? { note: r.note } : c.length > (r.target.max ?? Infinity) ? { long: true } : {}),
          },
          measured: mm(c.length),
          required: mm(c.length < r.target.min ? r.target.min : r.target.max!),
          ...base(c, r),
        }),
      )
  }
  const groups = new Map<string, NonNullable<Board['routes']>>()
  for (const r of board.routes) if (r.group !== undefined && copper.has(r.id)) groups.set(r.group, [...(groups.get(r.group) ?? []), r])
  for (const [group, rs] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (rs.length < 2) continue
    const len = (r: NonNullable<Board['routes']>[number]) => copper.get(r.id)!.length
    const lo = rs.reduce((a, b) => (len(b) < len(a) ? b : a)),
      hi = rs.reduce((a, b) => (len(b) > len(a) ? b : a))
    const tol = lo.tolerance ?? CLASS_DEFAULTS.tolerance,
      spread = len(hi) - len(lo)
    if (spread > tol + EPS)
      out.push(
        marker({
          severity: 'error',
          rule: 'length-match',
          args: {
            group,
            below: rs.filter(r => len(r) < len(hi) - tol - EPS).length,
            count: rs.length,
            lo: name(lo),
            loLength: len(lo),
            loAt: where(lo.src),
            hi: name(hi),
            hiLength: len(hi),
            hiAt: where(hi.src),
            ...(lo.note ? { note: lo.note } : {}),
            caps: rs
              .filter(r => r.caps !== undefined && r !== lo)
              .map(r => `${name(r)} caps the group: its maximum of ${f3(r.target?.max ?? 0)} mm is ${f3(r.caps!)} mm below the longest`),
          },
          measured: mm(spread),
          required: mm(tol),
          ...base(copper.get(lo.id), lo),
          refs: [...rs.map(r => (/^route:\d+$/.test(r.id) ? `net:${r.net}` : r.id))],
        }),
      )
  }
}

/** `mask-web`: mask between two pad openings narrower than `maskWeb`; pairs of one part are one finding per part, naming the narrowest. */
export function maskWebChecks(board: Board, out: DrcMarker[]) {
  const web = board.rules.maskWeb
  if (!(web !== undefined && web > 0)) return
  for (const side of ['F', 'B'] as const) {
    const layer = `${side}.Mask`
    const drawn = maskDrawings(board, side)
      .flatMap(it => copperRings(it, it.layer))
      .filter(q => q.length >= 3)
    const dgrid = drawn.length ? new Grid(drawn.map(q => bbox([q]))) : null
    const ganged = (rings: Ring[]) => !!dgrid && dgrid.query(bbox(rings)).some(k => overlaps(rings, [drawn[k]]))
    const ops: { p: Pad; rings: Ring[] }[] = []
    for (const p of board.items) {
      if (p.kind !== 'pad') continue
      pulse()
      const rings = padMask(p, side, board.rules)
      if (rings?.length && !ganged(rings)) ops.push({ p, rings })
    }
    const grid = new Grid(ops.map(o => bbox(o.rings)))
    const parts = new Map<string, { a: Pad; b: Pad; gap: number; n: number }>()
    const say = (a: Pad, b: Pad, gap: number, more: string) =>
      out.push(
        marker({
          severity: 'warning',
          rule: 'mask-web',
          args: { a: padLabel(a), b: padLabel(b), more },
          measured: mm(gap),
          required: mm(web),
          provenance: [rulesLevel('maskWeb', web)],
          at: [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2],
          layer,
          items: [a.id, b.id],
        }),
      )
    for (let i = 0; i < ops.length; i++)
      for (const j of grid.query(grid.boxes[i], web)) {
        if (j <= i) continue
        pulse()
        const a = ops[i].p,
          b = ops[j].p
        if (onePad(a, b)) continue
        const gap = ringsGap(ops[i].rings, ops[j].rings)
        if (gap <= EPS || gap >= web - EPS) continue
        if (a.ref === undefined || a.ref !== b.ref) {
          say(a, b, gap, '')
          continue
        }
        const e = parts.get(a.ref)
        if (!e) parts.set(a.ref, { a, b, gap, n: 1 })
        else {
          e.n++
          if (gap < e.gap - EPS) Object.assign(e, { a, b, gap })
        }
      }
    for (const [ref, e] of parts) say(e.a, e.b, e.gap, e.n > 1 ? `, and ${e.n - 1} more pair${e.n > 2 ? 's' : ''} of ${ref}` : '')
  }
}

/** Silkscreen line width, and silk over the mask openings of pads: graphics, stroke-font text and outline text. */
export function silkChecks(board: Board, out: DrcMarker[]) {
  const r = board.rules
  const who = (g: Graphic | Text) => (g.kind === 'text' ? `text "${g.text}"${g.ref ? ` of ${g.ref}` : ''}` : g.ref ? `silk of ${g.ref}` : 'silk graphic')
  for (const it of board.items) {
    pulse()
    if (!it.layer.endsWith('.SilkS')) continue
    // outline text: filled glyphs thinner than silkMinWidth, found by an opening of the ink
    if (it.kind === 'text' && it.polys) {
      const thin = thinInk(it.polys, r.silkMinWidth - 0.002)
      if (thin)
        out.push(
          marker({
            severity: 'warning',
            rule: 'silk-width',
            args: { who: who(it), font: it.font ?? '' },
            measured: mm(thin.width),
            required: mm(r.silkMinWidth),
            provenance: [rulesLevel('silkMinWidth', r.silkMinWidth)],
            at: thin.at,
            layer: it.layer,
            items: [it.id],
          }),
        )
      continue
    }
    // the compiler raises text thickness to silkMinWidth, so for text this is a guard
    const width = it.kind === 'graphic' && !it.fill ? it.width : it.kind === 'text' ? it.thickness : null
    if (width !== null && width < r.silkMinWidth - EPS)
      out.push(
        marker({
          severity: 'warning',
          rule: 'silk-width',
          args: { who: who(it as Graphic | Text) },
          measured: mm(width),
          required: mm(r.silkMinWidth),
          provenance: [rulesLevel('silkMinWidth', r.silkMinWidth)],
          at: it.kind === 'text' ? it.at : ((it as Graphic).paths[0]?.[0] ?? [0, 0]),
          layer: it.layer,
          items: [it.id],
        }),
      )
  }

  for (const side of ['F', 'B'] as const) {
    const openings = board.items
      .filter((p): p is Pad => p.kind === 'pad' && p.layers.includes(`${side}.Cu`))
      .map(p => ({ p, rings: polysToRings(offset([p.poly], p.maskExpansion ?? r.maskExpansion)) }))
      .map(o => ({ ...o, box: bbox(o.rings) }))
    if (!openings.length) continue
    const ogrid = new Grid(openings.map(o => o.box))
    for (const g of board.items) {
      pulse()
      if ((g.kind !== 'graphic' && g.kind !== 'text') || g.layer !== `${side}.SilkS`) continue
      const ink =
        g.kind === 'text'
          ? g.polys
            ? polysToRings(g.polys)
            : g.strokes.flatMap(q => polysToRings(strokeOpen(q, g.thickness)))
          : g.fill
            ? g.paths.filter(q => q.length >= 3)
            : g.paths.flatMap((q, i) => polysToRings(g.closed[i] ? strokeClosed(q, g.width) : strokeOpen(q, g.width)))
      if (!ink.length) continue
      // a hair inside the ink, so silk that only touches an opening passes
      const core = polysToRings(offset(ink, -0.001))
      if (!core.length) continue
      const box = bbox(core)
      for (const k of ogrid.query(box)) {
        const o = openings[k]
        if (!overlaps(core, o.rings)) continue
        out.push(
          marker({
            severity: 'warning',
            rule: 'silk-over-pad',
            args: { who: who(g), pad: padLabel(o.p) },
            at: contactPoint(core, o.rings),
            layer: g.layer,
            items: [g.id, o.p.id],
          }),
        )
      }
    }
  }
}

/** The distance from a point to the nearest edge of the rings. */
function toEdge(p: Pt, rings: Ring[]): number {
  let best = Infinity
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i],
        b = r[(i + 1) % r.length]
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
    }
  return best
}

/** DRC `silk-over-edge`: silkscreen graphics and text whose ink runs past the board outline or into a cutout, which the fab cuts off. */
export function silkEdgeChecks(board: Board, out: DrcMarker[]) {
  if (!board.outline.length) return
  const who = (g: Graphic | Text) => (g.kind === 'text' ? `text "${g.text}"${g.ref ? ` of ${g.ref}` : ''}` : g.ref ? `silk of ${g.ref}` : 'silk graphic')
  const box = bbox(board.outline)
  // the ring with the largest box is the outline, the others cutouts, whatever their winding
  const size = (q: Ring) => {
    const b = bbox([q])
    return b.w * b.h
  }
  const outer = board.outline.reduce((x, y) => (size(y) > size(x) ? y : x))
  const cutouts = board.outline.filter(q => q !== outer)
  for (const g of board.items) {
    pulse()
    if ((g.kind !== 'graphic' && g.kind !== 'text') || !g.layer.endsWith('.SilkS')) continue
    const ink = silkInk(g)
    if (!ink.length) continue
    const ib = bbox(ink)
    // the common case needs no clipping
    const inBox = ib.x >= box.x - EPS && ib.y >= box.y - EPS && ib.x + ib.w <= box.x + box.w + EPS && ib.y + ib.h <= box.y + box.h + EPS
    if (inBox && board.outline.length === 1) {
      const o = board.outline[0]
      const rect =
        o.length <= 5 &&
        o.every(p => (Math.abs(p[0] - box.x) < EPS || Math.abs(p[0] - box.x - box.w) < EPS) && (Math.abs(p[1] - box.y) < EPS || Math.abs(p[1] - box.y - box.h) < EPS))
      if (rect) continue
    }
    // a hair inside the ink, so silk that only touches the edge passes
    const core = polysToRings(offset(ink, -0.001))
    if (!core.length) continue
    const past = difference(core, [outer])
    const far = past.length ? Math.max(...past.flatMap(p => p.outer).map(p => toEdge(p, [outer]))) : 0
    // the piece lies between the cutout's edges, so how far it runs across
    const into = cutouts.length ? intersection(core, cutouts) : []
    const across = into.length
      ? Math.max(
          ...into.map(p => {
            const b = bbox([p.outer])
            return Math.max(b.w, b.h)
          }),
        )
      : 0
    if (far < 0.01 && across < 0.01) continue
    const pieces = far >= 0.01 ? past : into
    out.push(
      marker({
        severity: 'warning',
        rule: 'silk-over-edge',
        args: { who: who(g), ...(far >= 0.01 ? {} : { cutout: true }) },
        measured: mm(far >= 0.01 ? far : across),
        at: centroid(pieces.map(p => p.outer)),
        layer: g.layer,
        items: [g.id],
        witness: { layer: g.layer, rings: polysToRings(pieces) },
      }),
    )
  }
}

/** The ink of a silkscreen graphic or text as rings: filled glyphs, stroked text, a filled shape or stroked paths. */
function silkInk(g: Graphic | Text): Ring[] {
  return g.kind === 'text'
    ? g.polys
      ? polysToRings(g.polys)
      : g.strokes.flatMap(q => polysToRings(strokeOpen(q, g.thickness)))
    : g.fill
      ? g.paths.filter(q => q.length >= 3)
      : g.paths.flatMap((q, i) => polysToRings(g.closed[i] ? strokeClosed(q, g.width) : strokeOpen(q, g.width)))
}

const EDGE_KINDS: readonly EdgeBandKind[] = ['courtyard', 'silk', 'pad']

/** The rules with the edge band's `except`, parts and pad handles, as refs and `REF.PAD` keys once refs are final. */
export function resolveEdgeBand(rules: Rules, partRefs: Map<PartState, string>, items: Item[]): Rules {
  const band = rules.edge
  if (!band) return rules
  if (band.width === undefined) throw new CompileError('rules: edge needs a width in mm, such as { edge: { width: 1.2 } }')
  const pads = new Map<string, Pad[]>()
  for (const it of items)
    if (it.kind === 'pad' && it.ref !== undefined) {
      const l = pads.get(it.ref) ?? []
      l.push(it)
      pads.set(it.ref, l)
    }
  const except = new Set<string>()
  const padKey = (p: Pad) => `${p.ref}.${p.num}`
  for (const q of band.except ?? []) {
    if (!isPinRef(q) && !partOf(q)) throw new CompileError(`rules: edge.except takes parts and pad handles, such as J1 or J1[3], got ${JSON.stringify(q)}`)
    const st = partOf(isPinRef(q) ? q.part : q),
      ref = st && partRefs.get(st)
    if (!st || !ref) continue
    if (!isPinRef(q)) {
      except.add(ref)
      continue
    }
    const list = pads.get(ref) ?? []
    const hit =
      q.pad !== undefined
        ? list.some(p => p.num === q.pad)
          ? list.filter(p => p.num === q.pad)
          : list.filter(p => p.name === q.pad)
        : list.filter(p => pinOfPad(st.pins, p) === q.pin)
    for (const p of hit) except.add(padKey(p))
  }
  const out: EdgeBand = { width: band.width, kinds: [...new Set(band.kinds ?? EDGE_KINDS)], refs: [...except] }
  return { ...rules, edge: out }
}

/** The distance from a shape to the nearest edge of the outline or a cutout, 0 where it crosses one. */
function edgeGap(rings: Ring[], outline: Ring[]): number {
  let d = Infinity
  const eo = [...ringEdges(outline)]
  for (const [p, q] of ringEdges(rings))
    for (const [u, v] of eo) {
      d = Math.min(d, segDist(p, q, u, v))
      if (d === 0) return 0
    }
  return d === Infinity ? 0 : d
}

/** DRC `edge-courtyard`, `edge-silk` and `edge-pad`: courtyards, silk ink and pads within the edge band, except those it lets in. */
export function edgeBandChecks(board: Board, out: DrcMarker[]) {
  const band = board.rules.edge
  if (!band || !(band.width > 0) || !board.outline.length) return
  const w = band.width,
    kinds = new Set(band.kinds ?? EDGE_KINDS)
  const except = new Set(band.refs ?? [])
  // a hair less, so a shape just at the band passes
  const inner = polysToRings(offset(board.outline, -w + 0.0005))
  // a band wider than the board leaves no inset
  const check = (rule: string, what: string, rings: Ring[], layer: string | undefined, ids: number[], shape = rings): boolean => {
    if (!rings.length) return true
    const past = difference(rings, inner)
    if (!past.length) return true
    const d = edgeGap(shape, board.outline)
    out.push(
      marker({
        severity: 'error',
        rule,
        args: { what, ...(d < 0.0005 ? { crosses: true } : {}) },
        measured: mm(d),
        required: mm(w),
        provenance: [rulesLevel('edge', w)],
        at: centroid(past.map(p => p.outer)),
        ...(layer ? { layer } : {}),
        items: ids,
        witness: { ...(layer ? { layer } : {}), rings: polysToRings(past) },
      }),
    )
    return false
  }
  if (kinds.has('courtyard'))
    for (const side of ['F.CrtYd', 'B.CrtYd']) {
      const byRef = new Map<string, { rings: Ring[]; ids: number[] }>()
      for (const it of board.items) {
        if (it.kind !== 'graphic' || it.layer !== side || !it.ref || except.has(it.ref)) continue
        const rings = it.paths.flatMap((q, i) => (it.closed[i] && q.length >= 3 ? [q] : q.length >= 2 ? polysToRings(strokeOpen(q, Math.max(it.width, 0.01))) : []))
        if (!rings.length) continue
        const e = byRef.get(it.ref) ?? { rings: [], ids: [] }
        e.rings.push(...rings)
        e.ids.push(it.id)
        byRef.set(it.ref, e)
      }
      for (const [ref, e] of byRef) check('edge-courtyard', `courtyard of ${ref}`, e.rings, side, e.ids)
    }
  if (kinds.has('silk'))
    for (const g of board.items) {
      if ((g.kind !== 'graphic' && g.kind !== 'text') || !g.layer.endsWith('.SilkS') || (g.ref && except.has(g.ref))) continue
      const ink = silkInk(g)
      if (!ink.length) continue
      // a hair inside the ink, as silk-over-edge, so ink that only touches the band passes
      const core = polysToRings(offset(ink, -0.001))
      check(
        'edge-silk',
        `${g.kind === 'text' ? `text "${g.text}"${g.ref ? ` of ${g.ref}` : ''}` : g.ref ? `silk of ${g.ref}` : 'silk graphic'} on ${g.layer}`,
        core,
        g.layer,
        [g.id],
        ink,
      )
    }
  if (kinds.has('pad')) {
    const seen = new Set<string>()
    for (const p of board.items) {
      if (p.kind !== 'pad' || (p.ref && except.has(p.ref)) || except.has(`${p.ref}.${p.num}`)) continue
      const key = p.num && p.ref ? `${p.ref}.${p.num}` : `#${p.id}`
      if (!seen.has(key) && !check('edge-pad', padLabel(p), [p.poly], undefined, [p.id])) seen.add(key)
    }
  }
}
