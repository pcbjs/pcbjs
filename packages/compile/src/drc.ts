import type { Board, DrcMarker, Graphic, Item, Pad, Pt, Ring, Text, Via, Zone } from '@pcbjs/core/model'
import { bbox, centroid, contactPoint, difference, intersection, offset, overlaps, polysToRings, strokeClosed, strokeOpen } from './geom.js'
import { copperLayers } from './layers.js'
import { copperBox, copperIndex, copperLayersOf, copperRings, grownIndex } from './copper.js'
import { joined, netTied, pairKey, type Connectivity } from './connectivity.js'
import { contactNear, Grid, overlapsNear, RingIndex } from './spatial.js'
import { clearanceSource, hasPadOverrides, itemClearance, CLASS_DEFAULTS, maxClearance, maxHoleClearance, ownHoleClearance, pairSource } from './netclass.js'
import { coupledGap, pairsOf, routesCopper } from './pair-info.js'
import { joinsSolidly, thermalReport } from './zones.js'
import { copperWeightRule, holeClearanceOn, holeToHole } from '@pcbjs/core/rules'
import { OZ } from '@pcbjs/core/stackups'
import { thinInk } from '@pcbjs/core/outline'
import { referenceDrc } from './drc-reference.js'
import { loopFindings } from './loops.js'
import { maskDrawings, padMask } from './mask.js'
import type { EdgeBand, EdgeBandKind, ResolvedRules as Rules } from '@pcbjs/core/types'
import { isPinRef, partOf, pinOfPad, type PartState } from '@pcbjs/core/schematic'
import { CompileError } from './flatten.js'

/** Pads of one footprint with the same number are one pad drawn in parts, such as a KiCad padstack with a shape per layer. */
const onePad = (a: Item, b: Item): boolean => a.kind === 'pad' && b.kind === 'pad' && a.ref !== undefined && a.ref === b.ref && a.num !== '' && a.num === b.num

export function drc(board: Board, conn: Connectivity): DrcMarker[] {
  const out: DrcMarker[] = []
  const r = board.rules
  const cu = copperLayers(board.copper)
  const label = (it: Item) => (it.kind === 'pad' ? padLabel(it) : it.ref ? `${it.kind} of ${it.ref}` : `${it.kind}${it.net ? ` ${it.net}` : ''}`)

  const shorted = new Set(conn.shorts.map(([a, b]) => `${a.id}:${b.id}`))
  const apart = conn.apart ?? new Set<string>()
  // a net pair's clearance is the largest of the rules' and their classes'
  const reach = maxClearance(board)
  const classed = reach > r.clearance || hasPadOverrides(board) || !!board.classes
  // pads of one net tie group touch by design
  const tied = netTied(board)
  for (const layer of cu) {
    const on = board.items.filter(it => copperLayersOf(it, cu).includes(layer) && copperRings(it, layer).length)
    // grid candidates come in the order of a loop over every pair
    const grid = new Grid(on.map(it => copperBox(it, layer)))
    for (let i = 0; i < on.length; i++) {
      const a = on[i]
      for (const j of grid.query(grid.boxes[i], reach)) {
        if (j <= i) continue
        const b = on[j]
        if (a.net !== undefined && a.net === b.net) continue
        if (onePad(a, b) || tied?.(a, b)) continue
        const ca = copperIndex(a, layer),
          cb = copperIndex(b, layer)
        if (shorted.has(`${a.id}:${b.id}`) || (!apart.has(pairKey(layer, a, b)) && overlapsNear(ca, cb))) {
          out.push({
            severity: 'error',
            rule: 'short',
            message: `${label(a)} (${a.net ?? 'no net'}) touches ${label(b)} (${b.net ?? 'no net'}) on ${layer}`,
            at: contactNear(ca, cb),
            layer,
            items: [a.id, b.id],
          })
        } else {
          const c = classed ? itemClearance(board, a, b) : r.clearance,
            grow = c / 2 - 0.0005
          const ga = grownIndex(a, layer, grow),
            gb = grownIndex(b, layer, grow)
          if (overlapsNear(ga, gb)) {
            const by = classed ? pairSource(board, a, b) : ''
            out.push({
              severity: 'error',
              rule: 'clearance',
              message: `${label(a)} (${a.net ?? 'no net'}) is ${f3(ringsGap(copperRings(a, layer), copperRings(b, layer)))} mm from ${label(b)} (${b.net ?? 'no net'}) on ${layer}, closer than ${c} mm${by ? ` (${by})` : ''}`,
              at: contactNear(ga, gb),
              layer,
              items: [a.id, b.id],
            })
          }
        }
      }
    }
  }

  // a track joining a pad with a trackWidth override is held to that width, the larger of two such pads
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
          if (p.net !== it.net || !p.layers.includes(it.layer) || !(inside(e, [p.poly]) || ringsGap([p.poly], [[e, e, e]]) <= it.width / 2 + EPS)) continue
          if (by === undefined || p.trackWidth! > min) {
            min = p.trackWidth!
            by = p
          }
        }
    }
    if (it.width < min - (by ? EPS : 0))
      out.push({
        severity: 'error',
        rule: 'track-width',
        message: `track ${it.net ?? ''} is ${it.width} mm wide, minimum ${min} mm${by ? ` (${clearanceSource(board, by, 'trackWidth')}, joining ${padLabel(by)})` : ''}`,
        at: it.pts[0],
        layer: it.layer,
        items: [it.id],
      })
  }

  if (board.outline.length) {
    const insets = new Map<number, Ring[]>()
    const innerOf = (c: number) => {
      let v = insets.get(c)
      if (!v) insets.set(c, (v = polysToRings(offset(board.outline, -c + 0.0005))))
      return v
    }
    for (const layer of cu)
      for (const it of board.items) {
        if (it.kind === 'zone' || !copperLayersOf(it, cu).includes(layer)) continue
        const rings = copperRings(it, layer)
        if (!rings.length) continue
        const c = it.kind === 'pad' && it.edgeClearance !== undefined ? it.edgeClearance : r.edgeClearance
        const outside = difference(rings, innerOf(c))
        const by = c !== r.edgeClearance || (it.kind === 'pad' && it.edgeClearance !== undefined) ? clearanceSource(board, it, 'edgeClearance') : ''
        if (outside.length)
          out.push({
            severity: 'error',
            rule: 'edge-clearance',
            message: `${label(it)} is closer than ${c} mm to the board edge on ${layer}${by ? ` (${by})` : ''}`,
            at: centroid(outside.map(p => p.outer)),
            layer,
            items: [it.id],
          })
      }
  } else {
    out.push({ severity: 'warning', rule: 'outline', message: 'Edge.Cuts does not form a closed outline', at: [0, 0] })
  }

  // courtyards: an overlap under COURTYARD_TOLERANCE deep passes, as KiCad's courtyard check passes it
  for (const side of ['F.CrtYd', 'B.CrtYd']) {
    const cy = board.items
      .filter((it): it is Graphic => it.kind === 'graphic' && it.layer === side && !!it.ref)
      .map(it => ({ it, rings: it.paths.filter((p, i) => it.closed[i] && p.length >= 3) as Ring[] }))
      .filter(e => e.rings.length)
    const grid = new Grid(cy.map(e => bbox(e.rings)))
    for (let i = 0; i < cy.length; i++)
      for (const j of grid.query(grid.boxes[i]))
        if (j > i && cy[i].it.ref !== cy[j].it.ref && overlaps(cy[i].rings, cy[j].rings) && deepOverlap(cy[i].rings, cy[j].rings))
          out.push({
            severity: 'warning',
            rule: 'courtyard',
            message: `courtyards of ${cy[i].it.ref} and ${cy[j].it.ref} overlap`,
            at: contactPoint(cy[i].rings, cy[j].rings),
            layer: side,
            items: [cy[i].it.id, cy[j].it.id],
          })
  }

  thermalChecks(board, out)
  holeChecks(board, out, label)
  silkChecks(board, out)
  maskWebChecks(board, out)
  pairChecks(board, out)
  lengthChecks(board, out)
  silkEdgeChecks(board, out)
  edgeBandChecks(board, out)

  conn.ratsnest.forEach((rn, i) => {
    // a split pour names its pieces, so a pad in a cut-off piece can be found
    const w = conn.islands?.[i]
    out.push({
      severity: 'error',
      rule: 'unconnected',
      message: `net ${rn.net} is not fully connected${w ? `: ${w[0]}, is apart from ${w[1]}` : ''}`,
      at: [(rn.from[0] + rn.to[0]) / 2, (rn.from[1] + rn.to[1]) / 2],
      net: rn.net,
    })
  })
  for (const net of conn.singles) out.push({ severity: 'warning', rule: 'single-pad', message: `net ${net} has only one pad`, at: anchorOfNet(board, net), net })

  out.push(...referenceDrc(board), ...loopFindings(board))
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
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
    out.push({
      severity: 'warning',
      rule: 'copper-weight',
      at: [0, 0],
      message: `${layers.join(' and ')} ${layers.length > 1 ? 'are' : 'is'} ${oz} oz copper, which fabs make at clearance ${need.clearance} mm and track width ${need.minTrackWidth} mm or more, but the rules have ${low.join(' and ')}; raise them in rules, such as rules={{ clearance: ${need.clearance}, minTrackWidth: ${need.minTrackWidth} }}`,
    })
  }
  return out
}

function anchorOfNet(board: Board, net: string) {
  const it = board.items.find(i => i.net === net && i.kind === 'pad')
  return it && it.kind === 'pad' ? it.at : ([0, 0] as [number, number])
}

const EPS = 1e-6
/** How deep two courtyards may overlap before `courtyard` reports them, mm: 10 µm, below which KiCad passes them too. */
export const COURTYARD_TOLERANCE = 0.01
/** Whether two sets of rings still overlap once each is shrunk by half the tolerance: the overlap is at least that deep. */
const deepOverlap = (a: Ring[], b: Ring[]): boolean => overlaps(polysToRings(offset(a, -COURTYARD_TOLERANCE / 2)), polysToRings(offset(b, -COURTYARD_TOLERANCE / 2)))
const f3 = (v: number) => String(Math.round(v * 1000) / 1000)

/** A pad as findings name it: `pad J1.15`, or an unnumbered hole by its position, `unplated hole of J1 at (3.2, 4)`. */
/** Thermal reliefs: pads joined to a pour by fewer spokes than minSpokes, and spokes thinner than the zone min width. */
function thermalChecks(board: Board, out: DrcMarker[]) {
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
    const t = thermalReport(z)
    if (!t) continue
    const pour = `the ${z.net ?? 'no net'} pour on ${z.layer}`
    if (t.spokeWidth < t.minWidth - 1e-9 && t.pads.some(p => p.spokes > 0))
      out.push({
        severity: 'warning',
        rule: 'thermal-spoke-width',
        message: `thermal spokes of ${pour} are ${f3(t.spokeWidth)} mm wide, narrower than its min width ${f3(t.minWidth)} mm; they are kept`,
        at: t.pads[0].pad.at,
        layer: z.layer,
        items: [z.id],
      })
    for (const { pad, spokes } of t.pads) {
      if (!(spokes > 0 && spokes < t.minSpokes)) continue
      const tracks = joining(pad, z.layer)
      if (spokes + tracks >= t.minSpokes || joinedElsewhere(pad, z)) continue
      out.push({
        severity: 'warning',
        rule: 'thermal-spokes',
        message: `${padLabel(pad)} (${pad.net}) joins ${pour} through ${spokes} of ${t.spokes} thermal spokes${tracks ? ` and ${tracks} track${tracks > 1 ? 's' : ''} or via${tracks > 1 ? 's' : ''}` : ''}, fewer than ${t.minSpokes}`,
        at: pad.at,
        layer: z.layer,
        items: [pad.id, z.id],
      })
    }
  }
}

export const padLabel = (p: Pad): string =>
  p.num ? `pad ${p.ref ?? ''}.${p.num}` : `${p.type === 'npth' ? 'unplated hole' : 'unnumbered pad'}${p.ref ? ` of ${p.ref}` : ''} at (${f3(p.at[0])}, ${f3(p.at[1])})`

/** Whether a point lies inside a set of rings, even-odd, so the holes of a polygon count as outside. */
function inside(p: Pt, rings: Ring[]): boolean {
  let n = false
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) n = !n
  return n
}

/** The edges of a set of rings, each closed. */
function* edges(rings: Ring[]): Generator<[Pt, Pt]> {
  for (const r of rings) for (let i = 0; i < r.length; i++) yield [r[i], r[(i + 1) % r.length]]
}

/** The measured gap between two copper shapes, edge to edge: 0 when they touch or one contains the other. */
function ringsGap(a: Ring[], b: Ring[]): number {
  if (!a.length || !b.length) return 0
  if ((a[0][0] && inside(a[0][0], b)) || (b[0][0] && inside(b[0][0], a))) return 0
  let d = Infinity
  const eb = [...edges(b)]
  for (const [p, q] of edges(a)) for (const [u, v] of eb) d = Math.min(d, segDist(p, q, u, v))
  return d === Infinity ? 0 : d
}

/** The gap from the edge of a hole to a copper shape: negative when the copper covers part of the hole. */
function holeGap(h: { a: Pt; b: Pt; r: number }, rings: Ring[]): number {
  if (inside(h.a, rings)) return -h.r
  let d = Infinity
  for (const [u, v] of edges(rings)) d = Math.min(d, segDist(h.a, h.b, u, v))
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

function holesOf(board: Board, label: (it: Item) => string): Hole[] {
  const out: Hole[] = []
  for (const it of board.items) {
    if (it.kind === 'via') out.push({ it, a: it.at, b: it.at, r: it.drill / 2, name: label(it) })
    else if (it.kind === 'pad' && it.drill) {
      const [w, h] = it.drill,
        r = Math.min(w, h) / 2,
        half = Math.abs(w - h) / 2
      // rotated counter-clockwise on screen, y down
      const t = (it.rot * Math.PI) / 180,
        c = Math.cos(t),
        s = Math.sin(t)
      const d: Pt = w >= h ? [c * half, -s * half] : [s * half, c * half]
      out.push({ it, a: [it.at[0] - d[0], it.at[1] - d[1]], b: [it.at[0] + d[0], it.at[1] + d[1]], r, name: label(it) })
    }
  }
  return out
}

function segDist(p: Pt, q: Pt, a: Pt, b: Pt): number {
  const pt = (x: Pt, u: Pt, v: Pt) => {
    const dx = v[0] - u[0],
      dy = v[1] - u[1],
      n = dx * dx + dy * dy
    const t = n ? Math.max(0, Math.min(1, ((x[0] - u[0]) * dx + (x[1] - u[1]) * dy) / n)) : 0
    return Math.hypot(x[0] - u[0] - t * dx, x[1] - u[1] - t * dy)
  }
  const cross = (o: Pt, u: Pt, v: Pt) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0])
  const d1 = cross(a, b, p),
    d2 = cross(a, b, q),
    d3 = cross(p, q, a),
    d4 = cross(p, q, b)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(pt(p, a, b), pt(q, a, b), pt(a, p, q), pt(b, p, q))
}

const holeRing = (h: Hole, grow: number): Ring[] => polysToRings(strokeOpen([h.a, h.b], 2 * (h.r + grow)))

/** Drill sizes, annular rings, hole to hole and hole to copper. */
function holeChecks(board: Board, out: DrcMarker[], label: (it: Item) => string) {
  const r = board.rules
  const cu = copperLayers(board.copper)
  for (const it of board.items) {
    if (it.kind === 'via') {
      const ring = (it.size - it.drill) / 2
      if (it.drill < r.minViaDrill - EPS)
        out.push({
          severity: 'error',
          rule: 'via-drill',
          message: `${label(it)} has a ${f3(it.drill)} mm drill, minimum via drill ${r.minViaDrill} mm`,
          at: it.at,
          layer: it.layers[0],
          items: [it.id],
        })
      else if (it.drill < r.minDrill - EPS)
        out.push({
          severity: 'error',
          rule: 'drill',
          message: `${label(it)} has a ${f3(it.drill)} mm drill, minimum drill ${r.minDrill} mm`,
          at: it.at,
          layer: it.layers[0],
          items: [it.id],
        })
      if (it.size < r.minViaDiameter - EPS)
        out.push({
          severity: 'error',
          rule: 'via-size',
          message: `${label(it)} is ${f3(it.size)} mm across, minimum via diameter ${r.minViaDiameter} mm`,
          at: it.at,
          layer: it.layers[0],
          items: [it.id],
        })
      if (ring < r.minAnnularRing - EPS)
        out.push({
          severity: 'error',
          rule: 'annular-ring',
          message: `${label(it)} has a ${f3(ring)} mm annular ring (${f3(it.size)} mm copper, ${f3(it.drill)} mm drill), minimum ${r.minAnnularRing} mm`,
          at: it.at,
          layer: it.layers[0],
          items: [it.id],
        })
    } else if (it.kind === 'pad' && it.drill) {
      const d = Math.min(...it.drill)
      if (d < r.minDrill - EPS)
        out.push({ severity: 'error', rule: 'drill', message: `${label(it)} has a ${f3(d)} mm drill, minimum drill ${r.minDrill} mm`, at: it.at, layer: it.layer, items: [it.id] })
      if (it.type === 'tht' && it.layers.some(l => cu.includes(l))) {
        const ring = (Math.min(...it.size) - d) / 2
        if (ring < r.minPadAnnularRing - EPS)
          out.push({
            severity: 'error',
            rule: 'annular-ring',
            message: `${label(it)} has a ${f3(ring)} mm annular ring (${f3(Math.min(...it.size))} mm copper, ${f3(d)} mm drill), minimum ${r.minPadAnnularRing} mm for plated pads`,
            at: it.at,
            layer: it.layer,
            items: [it.id],
          })
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
        out.push({
          severity: 'error',
          rule: 'hole-to-hole',
          message:
            gap < 0
              ? `holes of ${a.name} and ${b.name} overlap, minimum ${min} mm between hole edges${kind}`
              : `holes of ${a.name} and ${b.name} are ${f3(gap)} mm apart edge to edge, minimum ${min} mm${kind}`,
          at: [(a.a[0] + b.a[0]) / 2, (a.a[1] + b.a[1]) / 2],
          items: [a.it.id, b.it.id],
        })
    }

  const layerGrids = cu.map(layer => {
    const on = board.items.filter(it => copperLayersOf(it, cu).includes(layer) && copperRings(it, layer).length)
    return { layer, on, grid: new Grid(on.map(it => copperBox(it, layer))) }
  })
  // the larger of the two hole clearances holds: a pad's override, its part's, or the rules', which may be by layer
  const hmax = maxHoleClearance(board),
    overridden = hmax !== r.holeClearance || hasPadOverrides(board)
  for (const h of holes) {
    const keeps = new Map<number, RingIndex>()
    const keepOf = (c: number) => {
      let k = keeps.get(c)
      if (!k) keeps.set(c, (k = new RingIndex(holeRing(h, c - 0.0005))))
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
        if (it.net !== undefined && it.net === h.it.net) continue
        if (onePad(it, h.it)) continue
        const c = overridden ? Math.max(own, ownHoleClearance(it, lr)) : lr.holeClearance
        const keep = keepOf(c)
        const rings = copperIndex(it, layer)
        if (overlapsNear(keep, rings)) {
          seen.add(it.id)
          const gap = holeGap(h, copperRings(it, layer))
          const by =
            (overridden ? clearanceSource(board, own >= ownHoleClearance(it, lr) ? h.it : it, 'holeClearance') : '') ||
            (r.holeClearanceBy
              ? h.it.kind === 'via' && r.holeClearanceBy.via !== undefined
                ? 'via hole'
                : `${layer === 'F.Cu' || layer === 'B.Cu' ? 'outer' : 'inner'} layers`
              : '')
          out.push({
            severity: 'error',
            rule: 'hole-to-copper',
            message: `${label(it)} (${it.net ?? 'no net'}) ${gap <= 0 ? 'covers' : `is ${f3(gap)} mm from`} ${h.it.kind === 'pad' && h.it.type === 'npth' ? h.name : `the hole of ${h.name}`} (${h.it.net ?? 'no net'}) on ${layer}, closer than ${c} mm${by ? ` (${by})` : ''}`,
            at: contactNear(keep, rings),
            layer,
            items: [h.it.id, it.id],
          })
        }
      }
    }
  }
}

/** How far a coupled gap may be off its target before pair-gap fires, mm. */
const GAP_TOLERANCE = 0.01

/** Differential pairs: the gap of the coupled sections, the length difference of the two tracks and the uncoupled length. */
function pairChecks(board: Board, out: DrcMarker[]) {
  for (const p of pairsOf(board)) {
    if (!p.P.length || !p.N.length) continue
    const name = `pair ${p.nets[0] ?? '?'}/${p.nets[1] ?? '?'} (${p.id})`
    const items = [...p.P, ...p.N].map(t => t.id)
    const rec = board.routes?.find(x => x.pair === p.id),
      rid = rec?.id
    const base = (at: Pt, layer?: string) => ({
      at,
      ...(layer ? { layer } : {}),
      items,
      ...(p.info?.src ? { src: p.info.src } : {}),
      ...(p.nets[0] ? { net: p.nets[0] } : {}),
      ...(rid ? { routeId: rid } : {}),
    })
    if (p.info) {
      const nets = new Set(p.nets)
      const pads = board.items.flatMap(it => (it.kind === 'pad' && it.net !== undefined && nets.has(it.net) ? [it.at] : []))
      const g = coupledGap(p, p.info.gap, pads)
      if (g && Math.abs(g.gap - p.info.gap) > GAP_TOLERANCE + EPS)
        out.push({
          severity: 'error',
          rule: 'pair-gap',
          message: `${name}: the coupled tracks are ${f3(g.gap)} mm apart edge to edge, the pair gap is ${f3(p.info.gap)} mm, allowed off by ${GAP_TOLERANCE} mm`,
          ...base(g.at, g.layer),
        })
    }
    const allowed = p.info?.skew ?? CLASS_DEFAULTS.skew,
      skew = Math.abs(p.lengthP - p.lengthN)
    if (skew > allowed + EPS)
      out.push({
        severity: 'error',
        rule: 'pair-skew',
        message: `${name}: the tracks differ in length by ${f3(skew)} mm, ${p.nets[0] ?? 'P'} ${f3(p.lengthP)} mm and ${p.nets[1] ?? 'N'} ${f3(p.lengthN)} mm with their vias, allowed ${f3(allowed)} mm${rec?.skewNote ? `; ${rec.skewNote}` : ''}`,
        ...base(p.P[0].pts[0], p.P[0].layer),
      })
    if (p.info && p.info.uncoupled > p.info.maxUncoupled + EPS)
      out.push({
        severity: 'warning',
        rule: 'pair-uncoupled',
        message: `${name}: ${f3(p.info.uncoupled)} mm of the two tracks run uncoupled at the ends and the vias, allowed ${f3(p.info.maxUncoupled)} mm`,
        ...base(p.P[0].pts[0], p.P[0].layer),
      })
  }
}

/** Route lengths: a route outside its .length() range, and a match group whose lengths spread wider than its tolerance. */
function lengthChecks(board: Board, out: DrcMarker[]) {
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
      ...(r.net !== undefined ? { net: r.net } : {}),
      routeId: r.id,
    }
  }
  for (const r of board.routes) {
    const c = copper.get(r.id)
    if (!r.target || !c) continue
    if (c.length < r.target.min - EPS || c.length > (r.target.max ?? Infinity) + EPS)
      out.push({
        severity: 'error',
        rule: 'length',
        message: `${name(r)} is ${f3(c.length)} mm long, allowed ${range(r.target)}${r.tuned ? `, ${f3(r.tuned)} mm of it tuned` : ''}${r.note ? `; ${r.note}` : c.length > (r.target.max ?? Infinity) ? '; a route that is too long is never shortened, shorten its path or move its ends' : ''}`,
        ...base(c, r),
      })
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
      out.push({
        severity: 'error',
        rule: 'length-match',
        message: `match group ${group} spreads ${f3(spread)} mm, allowed ${f3(tol)} mm, ${rs.filter(r => len(r) < len(hi) - tol - EPS).length} of ${rs.length} routes below its window: shortest ${name(lo)} at ${f3(len(lo))} mm${where(lo.src)}, longest ${name(hi)} at ${f3(len(hi))} mm${where(hi.src)}${lo.note ? `; ${lo.note}` : ''}${rs
          .filter(r => r.caps !== undefined && r !== lo)
          .map(r => `; ${name(r)} caps the group: its maximum of ${f3(r.target?.max ?? 0)} mm is ${f3(r.caps!)} mm below the longest`)
          .join('')}`,
        ...base(copper.get(lo.id), lo),
        net: undefined,
        routeId: undefined,
      })
  }
}

/** `mask-web`: mask between two pad openings narrower than `maskWeb`; pairs of one part are one finding per part, naming the narrowest. */
function maskWebChecks(board: Board, out: DrcMarker[]) {
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
      const rings = padMask(p, side, board.rules)
      if (rings?.length && !ganged(rings)) ops.push({ p, rings })
    }
    const grid = new Grid(ops.map(o => bbox(o.rings)))
    const parts = new Map<string, { a: Pad; b: Pad; gap: number; n: number }>()
    const say = (a: Pad, b: Pad, gap: number, more: string) =>
      out.push({
        severity: 'warning',
        rule: 'mask-web',
        message: `mask web between ${padLabel(a)} and ${padLabel(b)} on ${layer} is ${f3(gap)} mm, narrower than ${web} mm${more}; the fab merges the openings`,
        at: [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2],
        layer,
        items: [a.id, b.id],
      })
    for (let i = 0; i < ops.length; i++)
      for (const j of grid.query(grid.boxes[i], web)) {
        if (j <= i) continue
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
function silkChecks(board: Board, out: DrcMarker[]) {
  const r = board.rules
  const who = (g: Graphic | Text) => (g.kind === 'text' ? `text "${g.text}"${g.ref ? ` of ${g.ref}` : ''}` : g.ref ? `silk of ${g.ref}` : 'silk graphic')
  for (const it of board.items) {
    if (!it.layer.endsWith('.SilkS')) continue
    // outline text: filled glyphs thinner than silkMinWidth, found by an opening of the ink
    if (it.kind === 'text' && it.polys) {
      const thin = thinInk(it.polys, r.silkMinWidth - 0.002)
      if (thin)
        out.push({
          severity: 'warning',
          rule: 'silk-width',
          message: `${who(it)} on ${it.layer} in ${it.font} has strokes ${f3(thin.width)} mm wide, minimum ${r.silkMinWidth} mm; set thicken on the <text>, or use a bolder font or a larger size`,
          at: thin.at,
          layer: it.layer,
          items: [it.id],
        })
      continue
    }
    // the compiler raises text thickness to silkMinWidth, so for text this is a guard
    const width = it.kind === 'graphic' && !it.fill ? it.width : it.kind === 'text' ? it.thickness : null
    if (width !== null && width < r.silkMinWidth - EPS)
      out.push({
        severity: 'warning',
        rule: 'silk-width',
        message: `${who(it as Graphic | Text)} on ${it.layer} is ${f3(width)} mm wide, minimum ${r.silkMinWidth} mm`,
        at: it.kind === 'text' ? it.at : ((it as Graphic).paths[0]?.[0] ?? [0, 0]),
        layer: it.layer,
        items: [it.id],
      })
  }

  for (const side of ['F', 'B'] as const) {
    const openings = board.items
      .filter((p): p is Pad => p.kind === 'pad' && p.layers.includes(`${side}.Cu`))
      .map(p => ({ p, rings: polysToRings(offset([p.poly], p.maskExpansion ?? r.maskExpansion)) }))
      .map(o => ({ ...o, box: bbox(o.rings) }))
    if (!openings.length) continue
    const ogrid = new Grid(openings.map(o => o.box))
    for (const g of board.items) {
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
        out.push({
          severity: 'warning',
          rule: 'silk-over-pad',
          message: `${who(g)} on ${g.layer} runs into the mask opening of ${padLabel(o.p)}; the fab clips it`,
          at: contactPoint(core, o.rings),
          layer: g.layer,
          items: [g.id, o.p.id],
        })
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
function silkEdgeChecks(board: Board, out: DrcMarker[]) {
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
    const what = far >= 0.01 ? `runs ${f3(far)} mm past the board edge` : `runs ${f3(across)} mm into a cutout`
    out.push({
      severity: 'warning',
      rule: 'silk-over-edge',
      message: `${who(g)} on ${g.layer} ${what}; the fab cuts it off`,
      at: centroid((far >= 0.01 ? past : into).map(p => p.outer)),
      layer: g.layer,
      items: [g.id],
    })
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

/** The rules with the edge band's `except` as refs, `J1` or `J1.3`, once refs are final; a ref string naming nothing here throws. */
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
  const refs = new Set(partRefs.values())
  for (const r of pads.keys()) refs.add(r)
  const except = new Set<string>()
  const padKey = (p: Pad) => `${p.ref}.${p.num}`
  for (const q of band.except ?? []) {
    if (typeof q === 'string') {
      if (refs.has(q)) {
        except.add(q)
        continue
      }
      const dot = q.lastIndexOf('.'),
        ref = q.slice(0, dot),
        k = q.slice(dot + 1),
        list = dot > 0 ? (pads.get(ref) ?? []) : []
      const hit = list.filter(p => p.num === k)
      const named = hit.length ? hit : list.filter(p => p.name === k)
      if (!named.length) throw new CompileError(`rules: edge.except names ${JSON.stringify(q)}, which is no part or pad on this board`)
      for (const p of named) except.add(padKey(p))
      continue
    }
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
  const out: EdgeBand = { width: band.width, kinds: [...new Set(band.kinds ?? EDGE_KINDS)], except: [...except] }
  return { ...rules, edge: out }
}

/** The distance from a shape to the nearest edge of the outline or a cutout, 0 where it crosses one. */
function edgeGap(rings: Ring[], outline: Ring[]): number {
  let d = Infinity
  const eo = [...edges(outline)]
  for (const [p, q] of edges(rings))
    for (const [u, v] of eo) {
      d = Math.min(d, segDist(p, q, u, v))
      if (d === 0) return 0
    }
  return d === Infinity ? 0 : d
}

/** DRC `edge-courtyard`, `edge-silk` and `edge-pad`: courtyards, silk ink and pads within the edge band, except those it lets in. */
function edgeBandChecks(board: Board, out: DrcMarker[]) {
  const band = board.rules.edge
  if (!band || !(band.width > 0) || !board.outline.length) return
  const w = band.width,
    kinds = new Set(band.kinds ?? EDGE_KINDS)
  const except = new Set((band.except ?? []).filter((q): q is string => typeof q === 'string'))
  // a hair less, so a shape just at the band passes
  const inner = polysToRings(offset(board.outline, -w + 0.0005))
  // a band wider than the board leaves no inset
  const check = (rule: string, what: string, rings: Ring[], layer: string | undefined, ids: number[], shape = rings): boolean => {
    if (!rings.length) return true
    const past = difference(rings, inner)
    if (!past.length) return true
    const d = edgeGap(shape, board.outline)
    const where = d < 0.0005 ? 'crosses the board edge' : `is ${f3(d)} mm from the board edge`
    out.push({ severity: 'error', rule, message: `${what} ${where}, inside the ${w} mm edge band`, at: centroid(past.map(p => p.outer)), ...(layer ? { layer } : {}), items: ids })
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
