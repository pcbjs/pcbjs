// The reader covers only what gerber.ts writes, so an export bug cannot pass as an orderable set.
import type { Board, DrcMarker, Pad, Poly, Pt, Ring } from '@pcbjs/core/model'
import { area, bbox, centroid, clipRings, offsetRings, pointInPoly, polysToRings, strokeOpen, union, unionEvenOdd } from '@pcbjs/compile/geom'
import { copperLayers } from '@pcbjs/compile/layers'
import { copperLayersOf, copperRings } from '@pcbjs/compile/copper'
import { chainRings } from '@pcbjs/compile/path'
import { connectivity } from '@pcbjs/compile/connectivity'
import type { GerberFile } from './gerber.js'

// mm², once edge noise is gone
export const FAB_TOLERANCE = 0.01
// mm: differences thinner than twice this are arc chords, the model's and the reader's arcs part by up to about 10 um
const NOISE = 0.006
const CHORD = 0.001 // mm, the reader's arc chord error

export interface ReadGerber { polys: Poly[]; paths: Ring[] }

function disc(cx: number, cy: number, r: number): Ring {
  const n = Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - CHORD / Math.max(r, CHORD)))))
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as Pt)
}

/** Read a Gerber that pcbjs wrote, in board mm, y down; throws on anything outside that subset. */
export function readGerber(text: string): ReadGerber {
  let scale = 1e6, x = 0, y = 0, mode: 'G01' | 'G02' | 'G03' = 'G01', multi = false
  const apertures = new Map<number, number>()
  let ap = -1, polarity: 'D' | 'C' = 'D', inRegion = false
  let acc: Ring[] = [] // the dark area so far, as rings
  let batch: Ring[] = [], batchPolarity: 'D' | 'C' = 'D'
  let path: Pt[] = [] // the draw under way, in Gerber coordinates
  let contour: Pt[] = [], contours: Pt[][] = []
  const paths: Ring[] = []
  const flip = (r: Pt[]): Ring => r.map(([a, b]) => [a, -b] as Pt)
  const flushBatch = () => {
    if (!batch.length) return
    acc = batchPolarity === 'D' ? clipRings('union', [...acc, ...batch]) : clipRings('difference', acc, batch)
    batch = []
  }
  const add = (rings: Ring[]) => {
    if (batchPolarity !== polarity) { flushBatch(); batchPolarity = polarity }
    batch.push(...rings)
  }
  const flushPath = () => {
    if (path.length >= 2) {
      const ring = flip(path)
      paths.push(ring)
      add(polysToRings(strokeOpen(ring, apertures.get(ap) ?? 0)))
    }
    path = []
  }
  const arc = (from: Pt, to: Pt, c: Pt, cw: boolean): Pt[] => {
    const r = Math.hypot(from[0] - c[0], from[1] - c[1])
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0])
    let sweep = Math.atan2(to[1] - c[1], to[0] - c[0]) - a0
    if (cw) { if (sweep >= 0) sweep -= 2 * Math.PI } else if (sweep <= 0) sweep += 2 * Math.PI
    const step = r > CHORD ? 2 * Math.acos(1 - CHORD / r) : Math.PI / 2
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / step))
    const out: Pt[] = []
    for (let i = 1; i < n; i++) { const a = a0 + (sweep * i) / n; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]) }
    out.push(to)
    return out
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%')) {
      const body = line.slice(1, -1).replace(/\*$/, '')
      let m: RegExpExecArray | null
      if ((m = /^FSLAX(\d)(\d)Y(\d)(\d)$/.exec(body))) scale = 10 ** Number(m[2])
      else if (body === 'MOMM') { /* mm */ }
      else if (body === 'MOIN') throw new Error('inch Gerbers are not read')
      else if ((m = /^ADD(\d+)C,([\d.]+)$/.exec(body))) apertures.set(Number(m[1]), Number(m[2]))
      else if (/^ADD/.test(body)) throw new Error(`aperture ${body} is not one pcbjs writes`)
      else if ((m = /^LP([DC])$/.exec(body))) { flushPath(); polarity = m[1] as 'D' | 'C' }
      else if (/^(TF|TA|TO|TD)/.test(body)) { /* attributes */ }
      else throw new Error(`unknown extended command %${body}*%`)
      continue
    }
    if (line.startsWith('G04')) continue
    const m = /^(G0[123])?(?:X(-?\d+))?(?:Y(-?\d+))?(?:I(-?\d+))?(?:J(-?\d+))?(D0[123])?\*$/.exec(line)
    if (m && (m[2] !== undefined || m[3] !== undefined || m[6])) {
      if (m[1]) mode = m[1] as typeof mode
      const nx = m[2] !== undefined ? Number(m[2]) / scale : x, ny = m[3] !== undefined ? Number(m[3]) / scale : y
      const ci = m[4] !== undefined ? Number(m[4]) / scale : 0, cj = m[5] !== undefined ? Number(m[5]) / scale : 0
      const d = m[6] ?? 'D01'
      if (d === 'D02') {
        if (inRegion) { if (contour.length) contours.push(contour); contour = [[nx, ny]] }
        else { flushPath(); path = [[nx, ny]] }
      } else if (d === 'D03') {
        if (inRegion) throw new Error('flash inside a region')
        flushPath()
        add([disc(nx, -ny, (apertures.get(ap) ?? 0) / 2)])
      } else {
        const pts: Pt[] = mode === 'G01' ? [[nx, ny]] : (() => {
          if (!multi) throw new Error('arc without G75')
          return arc([x, y], [nx, ny], [x + ci, y + cj], mode === 'G02')
        })()
        if (inRegion) { if (!contour.length) contour = [[x, y]]; contour.push(...pts) }
        else { if (!path.length) path = [[x, y]]; path.push(...pts) }
      }
      x = nx; y = ny
      continue
    }
    if (m && m[1] && !m[6]) { mode = m[1] as typeof mode; continue }
    if (line === 'G75*') { multi = true; continue }
    if (line === 'G74*') throw new Error('single quadrant arcs are not read')
    if (line === 'G36*') { flushPath(); inRegion = true; contour = []; contours = []; continue }
    if (line === 'G37*') {
      if (contour.length) contours.push(contour)
      // a region fills its contour whichever way it runs: a mirrored pad runs clockwise, and must not cancel the copper under it
      add(contours.filter(c => c.length >= 3).map(c => positive(flip(c))))
      inRegion = false; contour = []; contours = []
      continue
    }
    const sel = /^D(\d+)\*$/.exec(line)
    if (sel && Number(sel[1]) >= 10) {
      flushPath()
      if (!apertures.has(Number(sel[1]))) throw new Error(`aperture D${sel[1]} is not defined`)
      ap = Number(sel[1]); continue
    }
    if (line === 'M02*') break
    throw new Error(`unknown statement ${line}`)
  }
  flushPath()
  flushBatch()
  return { polys: union(acc), paths }
}

// area in mm² and the centre of the largest piece, slivers thinner than 2 NOISE gone
function solid(diff: Ring[]): { area: number; at: Pt | null } {
  const core = offsetRings(diff, -NOISE)
  if (!core.length) return { area: 0, at: null }
  // grown back, so the area counts what a fab would see
  const grown = offsetRings(core, NOISE)
  let total = 0, big: Ring | null = null, bigArea = 0
  for (const r of grown) {
    const a = area([r])
    total += a
    if (a > bigArea) { bigArea = a; big = r }
  }
  return { area: total, at: big ? centroid([big]) : null }
}

const positive = (r: Ring): Ring => (area([r]) < 0 ? r.slice().reverse() : r)

// each item's rings are made to cover the item on its own before the merge: a pad mirrored to the back runs clockwise
export function modelCopper(board: Board, layer: string, cu = copperLayers(board.copper)): Poly[] {
  const rings: Ring[] = []
  for (const it of board.items) {
    if (!copperLayersOf(it, cu).includes(layer)) continue
    const rs = copperRings(it, layer)
    if (it.kind === 'pad') rings.push(...rs.map(positive))
    else if (it.kind === 'graphic' && it.fill) rings.push(...polysToRings(union(rs)))
    else rings.push(...rs)
  }
  return union(rings)
}

const r2 = (v: number) => Math.round(v * 100) / 100
const mm2 = (v: number) => (v >= 0.1 ? r2(v) : Math.round(v * 1e4) / 1e4)

// the group of each pad by its index in `pads`, -1 for a pad on no piece
function padGroups(board: Board, pieces: Map<string, Poly[]>, cu: string[]): { pads: Pad[]; group: number[] } {
  const ids = new Map<string, number>()
  const parent: number[] = []
  const node = (layer: string, i: number) => { const k = `${layer}:${i}`; let n = ids.get(k); if (n === undefined) { n = parent.length; ids.set(k, n); parent.push(n) } return n }
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const join = (a: number, b: number) => { parent[find(a)] = find(b) }
  const boxes = new Map([...pieces].map(([l, ps]) => [l, ps.map(p => bbox([p.outer]))]))
  const at = (layer: string, p: Pt): number => {
    const ps = pieces.get(layer), bs = boxes.get(layer)
    if (!ps || !bs) return -1
    for (let i = 0; i < ps.length; i++) {
      const b = bs[i]
      if (p[0] < b.x || p[0] > b.x + b.w || p[1] < b.y || p[1] > b.y + b.h) continue
      if (pointInPoly(p, ps[i])) return node(layer, i)
    }
    return -1
  }
  const pads = board.items.filter((it): it is Pad => it.kind === 'pad' && it.net !== undefined && copperLayersOf(it, cu).length > 0)
  const index = new Map(pads.map((p, i) => [p, i]))
  const first: number[] = pads.map(() => -1)
  for (const it of board.items) {
    if (it.kind !== 'pad' && it.kind !== 'via') continue
    const plated = it.kind === 'via' || (it.drill && it.type !== 'npth')
    const ns = copperLayersOf(it, cu).map(l => at(l, it.at)).filter(n => n >= 0)
    if (plated) for (let i = 1; i < ns.length; i++) join(ns[0], ns[i])
    const i = it.kind === 'pad' ? index.get(it) : undefined
    if (i !== undefined && ns.length) first[i] = ns[0]
  }
  return { pads, group: pads.map((_, i) => (first[i] >= 0 ? find(first[i]) : -1)) }
}

const padName = (p: Pad) => `${p.ref ?? '?'}.${p.num}`

export interface FabCheck { findings: DrcMarker[]; layers: string[]; ms: number }

/** Compare a fab set's copper and outline Gerbers with the board; every difference is a DRC error `fab-mismatch`. */
export function checkFab(board: Board, gerbers: GerberFile[]): FabCheck {
  const t0 = performance.now()
  const out: DrcMarker[] = []
  const cu = copperLayers(board.copper)
  const fail = (layer: string, message: string, at: Pt) => out.push({ severity: 'error', rule: 'fab-mismatch', message, at: [r2(at[0]), r2(at[1])], layer })
  const byLayer = new Map<string, GerberFile>()
  for (const g of gerbers) {
    const m = /^Copper,L(\d+)/.exec(g.fileFunction)
    if (m) byLayer.set(cu[Number(m[1]) - 1], g)
    else if (g.fileFunction.startsWith('Profile')) byLayer.set('Edge.Cuts', g)
  }
  const read = (layer: string): ReadGerber | null => {
    const g = byLayer.get(layer)
    if (!g) return null
    try { return readGerber(g.text) } catch (e: any) { fail(layer, `${g.name} cannot be read back: ${e?.message ?? e}`, [0, 0]); return null }
  }
  // the outline: closed contours of the profile, inside an odd number of them is board
  let region: Ring[] | null = null
  const edge = read('Edge.Cuts')
  if (edge && edge.paths.length) {
    const { rings } = chainRings(edge.paths, edge.paths.map(p => p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6))
    if (rings.length) {
      region = polysToRings(unionEvenOdd(rings))
      if (board.outline.length) {
        const d = solid(clipRings('xor', region, board.outline))
        if (d.area > FAB_TOLERANCE) fail('Edge.Cuts', `the outline read back from the Gerber differs from the board's by ${mm2(d.area)} mm²`, d.at!)
      }
    }
  }
  const got = new Map<string, Poly[]>(), want = new Map<string, Poly[]>()
  for (const layer of cu) {
    const g = read(layer)
    if (!g) continue
    const model = modelCopper(board, layer, cu)
    got.set(layer, g.polys); want.set(layer, model)
    const gr = polysToRings(g.polys)
    const d = solid(clipRings('xor', gr, polysToRings(model)))
    if (d.area > FAB_TOLERANCE) fail(layer, `${layer} read back from ${byLayer.get(layer)!.name} differs from the board's copper by ${mm2(d.area)} mm²`, d.at!)
    if (region) {
      const past = solid(clipRings('difference', gr, region))
      if (past.area > FAB_TOLERANCE) fail(layer, `${layer} has ${mm2(past.area)} mm² of copper outside the board outline or inside a cutout`, past.at!)
    }
  }
  // joined as the DRC's connectivity says, each pour piece its own node
  if (got.size === cu.length) {
    const m = padGroups(board, want, cu), g = padGroups(board, got, cu)
    const groups = connectivity(board).groups!
    const joinedBy = m.pads.map((p, i) => (m.group[i] < 0 ? -1 : groups.of(p)))
    const lost = new Set<string>(), shorted = new Set<string>()
    const firstOf = new Map<number, number>(), netOf = new Map<number, string>()
    m.pads.forEach((p, i) => {
      if (joinedBy[i] < 0) return
      const j = firstOf.get(joinedBy[i])
      if (j === undefined) { firstOf.set(joinedBy[i], i); return }
      if (g.group[i] < 0 || g.group[i] !== g.group[j]) {
        const net = p.net!
        if (lost.has(net)) return
        lost.add(net)
        const at = p.at
        fail(copperLayersOf(p, cu)[0], `net ${net}: pad ${padName(p)} is no longer joined to ${padName(m.pads[j])} in the Gerbers`, at)
      }
    })
    g.pads.forEach((p, i) => {
      if (g.group[i] < 0) return
      const other = netOf.get(g.group[i])
      if (other === undefined) { netOf.set(g.group[i], p.net!); return }
      if (other !== p.net && m.group[i] >= 0) {
        const key = [other, p.net!].sort().join('|')
        if (shorted.has(key)) return
        // the model joins them too only when it has a short, which its own DRC reports
        const mj = m.pads.findIndex((q, k) => q.net === other && g.group[k] === g.group[i])
        if (mj >= 0 && m.group[mj] === m.group[i]) return
        shorted.add(key)
        fail(cu[0], `nets ${other} and ${p.net} are joined in the Gerbers at pad ${padName(p)}`, p.at)
      }
    })
  }
  return { findings: out, layers: [...byLayer.keys()], ms: performance.now() - t0 }
}
