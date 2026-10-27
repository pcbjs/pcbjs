// RS-274X with X2 attributes; a layer without arcs has no G75, G02 or G03.
import type { Board, Graphic, Item, Pad, Prim, Ring, Text } from '@pcbjs/core/model'
import type { Finish } from '@pcbjs/core/types'
import { bbox, bboxOverlap, offset, overlaps, pointInRing, polysToRings, union } from '@pcbjs/compile/geom'
import { copperRings } from '@pcbjs/compile/copper'
import { copperLayers } from '@pcbjs/compile/layers'
import { hasArc } from '@pcbjs/compile/path'
import { padMask, padPaste } from './pads.js'
import { maskOpenings } from '@pcbjs/compile/mask'
import { createRequire } from 'node:module'

export { maskOpenings }

/** The version of @pcbjs/export, which every generated file names. */
export const VERSION: string = createRequire(import.meta.url)('../package.json').version

const U = 1e6 // FSLAX46Y46: 1 unit = 1 nm... 6 decimals of mm
const coord = (v: number) => Math.round(v * U).toString()
const xy = (x: number, y: number) => `X${coord(x)}Y${coord(-y)}` // Gerber y is up
const EPS = 1e-9
const same = (a: Ring[number], b: Ring[number]) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS
// so no D01 has zero length
const dedupe = (pts: Ring): Ring => pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]))

/** `empty` is true when the file draws nothing, as a paste layer of a board without SMD pads on that side. */
export interface GerberFile { name: string; text: string; fileFunction: string; empty: boolean }

export function fileFunction(board: Board, layer: string): string | null {
  const cu = copperLayers(board.copper) // F.Cu first: L1 is the top
  const i = cu.indexOf(layer)
  if (i >= 0) return `Copper,L${i + 1},${i === 0 ? 'Top' : i === cu.length - 1 ? 'Bot' : 'Inr'}`
  const side = layer.startsWith('F.') ? 'Top' : 'Bot'
  if (layer.endsWith('.Mask')) return `Soldermask,${side}`
  if (layer.endsWith('.Paste')) return `Paste,${side}`
  if (layer.endsWith('.SilkS')) return `Legend,${side}`
  if (layer.endsWith('.Fab')) return `AssemblyDrawing,${side}`
  if (layer.endsWith('.CrtYd')) return `Other,Courtyard${side}`
  if (layer === 'Edge.Cuts') return 'Profile,NP'
  if (layer === 'Dwgs.User') return 'Other,Drawings'
  if (layer === 'Cmts.User') return 'Other,Comments'
  return null
}

export function gerberExtension(layer: string): string {
  const m: Record<string, string> = { 'F.Cu': 'gtl', 'B.Cu': 'gbl', 'F.Mask': 'gts', 'B.Mask': 'gbs', 'F.Paste': 'gtp', 'B.Paste': 'gbp', 'F.SilkS': 'gto', 'B.SilkS': 'gbo', 'Edge.Cuts': 'gm1' }
  if (m[layer]) return m[layer]
  const inner = /^In(\d+)\.Cu$/.exec(layer)
  if (inner) return `g${inner[1]}`
  return 'gbr'
}

// the centre's offset from the start point, y up like every Gerber coordinate
const ij = (from: Ring[number], c: Ring[number]) => `I${coord(c[0] - from[0])}J${coord(-(c[1] - from[1]))}`
const q = (p: Ring[number]) => `${coord(p[0])},${coord(p[1])}`

// an arc whose ends round to one point would be a full circle under G75, so it becomes a line; null when the primitives no longer follow `pts`
function writable(prims: Prim[] | undefined, pts: Ring): Prim[] | null {
  if (!prims?.length || !hasArc(prims) || pts.length < 2) return null
  const near = (a: Ring[number], b: Ring[number]) => Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6
  if (!near(prims[0].from, pts[0]) || !near(prims[prims.length - 1].to, pts[pts.length - 1])) return null
  const out: Prim[] = []
  for (const p of prims) {
    if (q(p.from) === q(p.to)) continue
    out.push(p)
  }
  return out.length ? out : null
}

class Writer {
  lines: string[] = []
  apertures = new Map<string, number>()
  private next = 10
  private current = -1
  polarity: 'D' | 'C' = 'D'
  private mode: 'G01' | 'G02' | 'G03' = 'G01'
  // set once an arc is written: the header then carries G75
  arcs = false
  private interp(g: 'G01' | 'G02' | 'G03') { if (g !== this.mode) { this.lines.push(`${g}*`); this.mode = g } }
  private draw(prims: Prim[]) {
    for (const p of prims) {
      if (p.kind === 'line') { this.interp('G01'); this.lines.push(`${xy(p.to[0], p.to[1])}D01*`) }
      else {
        // clockwise on the y-down board is clockwise in the y-up Gerber too: the picture is the same, only the axis flips
        this.interp(p.cw ? 'G02' : 'G03'); this.arcs = true
        this.lines.push(`${xy(p.to[0], p.to[1])}${ij(p.from, p.center)}D01*`)
      }
    }
    this.interp('G01')
  }
  stroke(def: string, prims: Prim[] | undefined, pts: Ring): boolean {
    const ps = writable(prims, pts)
    if (!ps) return false
    this.select(this.aperture(def))
    this.lines.push(`${xy(ps[0].from[0], ps[0].from[1])}D02*`)
    this.draw(ps)
    return true
  }
  // the primitives must close on their start
  regionPrims(prims: Prim[], pts: Ring): boolean {
    const ps = writable(prims, pts.length ? [...pts, pts[0]] : pts)
    if (!ps || q(ps[0].from) !== q(ps[ps.length - 1].to)) return false
    this.lines.push('G36*')
    this.lines.push(`${xy(ps[0].from[0], ps[0].from[1])}D02*`)
    this.draw(ps)
    this.lines.push('G37*')
    return true
  }
  aperture(def: string): number {
    let d = this.apertures.get(def)
    if (d === undefined) { d = this.next++; this.apertures.set(def, d) }
    return d
  }
  select(d: number) { if (d !== this.current) { this.lines.push(`D${d}*`); this.current = d } }
  setPolarity(p: 'D' | 'C') { if (p !== this.polarity) { this.lines.push(`%LP${p}*%`); this.polarity = p } }
  flash(def: string, x: number, y: number) { this.select(this.aperture(def)); this.lines.push(`${xy(x, y)}D03*`) }
  polyline(def: string, pts: Ring, close = false) {
    if (pts.length < 2) return
    pts = dedupe(pts)
    this.select(this.aperture(def))
    this.lines.push(`${xy(pts[0][0], pts[0][1])}D02*`)
    for (let i = 1; i < pts.length; i++) this.lines.push(`${xy(pts[i][0], pts[i][1])}D01*`)
    // a polyline that already ends on its first point is closed: another segment would have zero length
    if (close && pts.length > 1 && !same(pts[pts.length - 1], pts[0])) this.lines.push(`${xy(pts[0][0], pts[0][1])}D01*`)
  }
  region(ring: Ring) {
    ring = dedupe(ring)
    if (ring.length > 1 && same(ring[ring.length - 1], ring[0])) ring = ring.slice(0, -1)
    if (ring.length < 3) return
    this.lines.push('G36*')
    this.lines.push(`${xy(ring[0][0], ring[0][1])}D02*`)
    for (let i = 1; i < ring.length; i++) this.lines.push(`${xy(ring[i][0], ring[i][1])}D01*`)
    this.lines.push(`${xy(ring[0][0], ring[0][1])}D01*`)
    this.lines.push('G37*')
  }
  // false writes polygons in list order, for the self check's tests only
  nest = true
  // a parent goes before the islands inside its holes, so its clear holes never erase them
  polys(ps: { outer: Ring; holes: Ring[] }[]) {
    for (const p of this.nest ? nestOrder(ps) : ps) {
      this.setPolarity('D'); this.region(p.outer)
      if (p.holes.length) { this.setPolarity('C'); for (const h of p.holes) this.region(h) }
    }
    this.setPolarity('D')
  }
  // dark only, holes cut in along a cut line so nothing drawn earlier is erased; without a cut line the holes fall back to clear
  darkPolys(ps: { outer: Ring; holes: Ring[] }[]) {
    if (!this.nest) { this.polys(ps); return }
    for (const p of ps) {
      const ring = p.holes.length ? cutIn(p.outer, p.holes) : p.outer
      if (ring) { this.setPolarity('D'); this.region(ring) }
      else this.polys([p])
    }
    this.setPolarity('D')
  }
}

// parents first, by how many outers contain them; stable within a depth
export function nestOrder<T extends { outer: Ring; holes: Ring[] }>(ps: T[]): T[] {
  if (ps.length < 2 || !ps.some(p => p.holes.length)) return ps
  const boxes = ps.map(p => bbox([p.outer]))
  const depth = ps.map((p, i) => {
    const q = p.outer[0]
    let d = 0
    for (let j = 0; j < ps.length; j++) {
      const b = boxes[j]
      if (j === i || !ps[j].holes.length || q[0] < b.x || q[0] > b.x + b.w || q[1] < b.y || q[1] > b.y + b.h) continue
      if (pointInRing(q, ps[j].outer)) d++
    }
    return d
  })
  if (depth.every(d => d === 0)) return ps
  return ps.map((p, i) => ({ p, i })).sort((a, b) => depth[a.i] - depth[b.i] || a.i - b.i).map(x => x.p)
}

// twice the signed area
const signed2 = (r: Ring) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0)
// touching included
function meet(a: Ring[number], b: Ring[number], c: Ring[number], d: Ring[number]): boolean {
  const o = (p: Ring[number], q: Ring[number], r: Ring[number]) => { const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); return Math.abs(v) <= 1e-12 ? 0 : v > 0 ? 1 : -1 }
  const on = (p: Ring[number], q: Ring[number], r: Ring[number]) => Math.min(p[0], q[0]) - EPS <= r[0] && r[0] <= Math.max(p[0], q[0]) + EPS && Math.min(p[1], q[1]) - EPS <= r[1] && r[1] <= Math.max(p[1], q[1]) + EPS
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b)
  if (o1 !== o2 && o3 !== o4) return true
  return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b))
}
const closedRing = (r: Ring): Ring => { r = dedupe(r); return r.length > 1 && same(r[r.length - 1], r[0]) ? r.slice(0, -1) : r }

// fully coincident cut-ins, which Gerber allows; holes go left to right, each from its leftmost point; null when a hole finds no cut line
export function cutIn(outer: Ring, holes: Ring[]): Ring | null {
  let ring = closedRing(outer)
  if (ring.length < 3) return null
  if (signed2(ring) < 0) ring = [...ring].reverse()
  const hs = holes.map(closedRing).filter(h => h.length >= 3).map(h => (signed2(h) > 0 ? [...h].reverse() : h))
  const order = hs.map(h => {
    let k = 0
    for (let i = 1; i < h.length; i++) if (h[i][0] < h[k][0] || (h[i][0] === h[k][0] && h[i][1] < h[k][1])) k = i
    return { h, k }
  }).sort((a, b) => a.h[a.k][0] - b.h[b.k][0])
  for (let n = 0; n < order.length; n++) {
    const { h, k } = order[n], P = h[k]
    const rest = order.slice(n + 1).map(o => o.h)
    const key = (p: Ring[number]) => `${coord(p[0])},${coord(p[1])}`
    const count = new Map<string, number>()
    for (const p of ring) count.set(key(p), (count.get(key(p)) ?? 0) + 1)
    const cands = ring.map((p, i) => ({ i, d: Math.hypot(p[0] - P[0], p[1] - P[1]) }))
      .filter(c => c.d > EPS && count.get(key(ring[c.i])) === 1).sort((a, b) => a.d - b.d)
    const clear = (V: Ring[number], r: Ring, skip: (j: number) => boolean) => {
      for (let j = 0; j < r.length; j++) if (!skip(j) && meet(P, V, r[j], r[(j + 1) % r.length])) return false
      return true
    }
    let at = -1
    for (const c of cands) {
      const V = ring[c.i], m = ring.length, hm = h.length
      if (!clear(V, ring, j => j === c.i || (j + 1) % m === c.i)) continue
      if (!clear(V, h, j => j === k || (j + 1) % hm === k)) continue
      if (!rest.every(r => clear(V, r, () => false))) continue
      const mid: Ring[number] = [(P[0] + V[0]) / 2, (P[1] + V[1]) / 2]
      if (!pointInRing(mid, ring) || pointInRing(mid, h)) continue
      at = c.i; break
    }
    if (at < 0) return null
    ring = [...ring.slice(0, at + 1), ...h.slice(k), ...h.slice(0, k), P, ring[at], ...ring.slice(at + 1)]
  }
  return ring
}

const circleDef = (d: number) => `C,${(Math.round(d * 1e4) / 1e4).toFixed(4)}`

/** `nest: false` writes nested polygons in list order, so the self check's tests can show that bug is caught. */
export function gerberLayer(board: Board, layer: string, date: string, opts: { nest?: boolean } = {}): GerberFile | null {
  const fn = fileFunction(board, layer)
  if (!fn) return null
  const w = new Writer()
  if (opts.nest === false) w.nest = false
  const isCu = layer.endsWith('.Cu')
  const isMask = layer.endsWith('.Mask'), isPaste = layer.endsWith('.Paste')
  const side = layer.startsWith('F.') ? 'F' : layer.startsWith('B.') ? 'B' : null
  const cu = copperLayers(board.copper)
  const spans = (ls: [string, string]) => { const a = cu.indexOf(ls[0]), b = cu.indexOf(ls[1]), i = cu.indexOf(layer); return i >= Math.min(a, b) && i <= Math.max(a, b) }

  // one unioned set of zone fills: one zone's clear holes must not erase another zone's copper
  if (isCu) {
    const fills = board.items.flatMap(it => it.kind === 'zone' && it.layer === layer ? polysToRings(it.fill) : [])
    if (fills.length) w.polys(union(fills))
  }
  for (const it of board.items) {
    if (it.kind === 'pad') padOut(w, it, layer, board, isCu, isMask, isPaste, side)
    else if (it.kind === 'track' && it.layer === layer) { if (!w.stroke(circleDef(it.width), it.prims, it.pts)) w.polyline(circleDef(it.width), it.pts) }
    else if (it.kind === 'via' && isCu && spans(it.layers)) w.flash(circleDef(it.size), it.at[0], it.at[1])
    else if (it.kind === 'graphic' && it.layer === layer) {
      // a filled path's holes are cut into its own region: a clear hole would also erase what the layer drew there before
      if (it.fill) { if (!filledArcs(w, it.paths, it.prims)) w.darkPolys(offset(it.paths.filter(r => r.length >= 3), 0)) }
      else it.paths.forEach((p, i) => { if (!w.stroke(circleDef(it.width), it.prims?.[i], it.closed[i] && p.length ? [...p, p[0]] : p)) w.polyline(circleDef(it.width), p, it.closed[i]) })
    }
    else if (it.kind === 'text' && it.layer === layer) {
      // outline text: each glyph a dark region, its counters cut in with a cut line so they erase nothing drawn before
      if (it.polys) w.darkPolys(it.polys)
      else for (const s of it.strokes) w.polyline(circleDef(it.thickness), s)
    }
  }
  // the legend never prints on bare copper: the mask openings it touches are cleared from it, as KiCad's --subtract-soldermask does
  if (layer.endsWith('.SilkS') && side) {
    const cut = silkOverOpenings(board, layer, side)
    if (cut.length) { w.setPolarity('C'); for (const r of cut) w.region(r); w.setPolarity('D') }
  }
  const head = [
    `%TF.GenerationSoftware,pcbjs,pcbjs,${VERSION}*%`,
    `%TF.CreationDate,${date}*%`,
    `%TF.ProjectId,${board.name.replace(/[^A-Za-z0-9]/g, '_')},${'00000000-0000-0000-0000-000000000000'},${board.revision || 'rev?'}*%`,
    `%TF.SameCoordinates,Original*%`,
    `%TF.FileFunction,${fn}*%`,
    `%TF.FilePolarity,${isMask ? 'Negative' : 'Positive'}*%`,
    `%FSLAX46Y46*%`,
    `%MOMM*%`,
    `%LPD*%`,
    `G01*`,
    ...(w.arcs ? ['G75*'] : []),
    `G04 APERTURE LIST*`,
    ...[...w.apertures].map(([def, d]) => `%ADD${d}${def}*%`),
    `G04 APERTURE END LIST*`,
  ]
  const text = [...head, ...w.lines, 'M02*', ''].join('\n')
  return { name: `${board.name}-${layer.replace('.', '_')}.${gerberExtension(layer)}`, text, fileFunction: fn, empty: !w.lines.length }
}

// writes the rings as regions of their own only when every ring is closed, an outer and apart from the others
function filledArcs(w: Writer, paths: Ring[], prims: Prim[][] | undefined): boolean {
  if (!prims || prims.length !== paths.length) return false
  const rings = paths.map((r, i) => ({ r, p: prims[i] })).filter(x => x.r.length >= 3)
  if (!rings.length) return false
  const u = union(rings.map(x => x.r))
  if (u.length !== rings.length || u.some(p => p.holes.length)) return false
  const at = w.lines.length, arcs = w.arcs
  w.setPolarity('D')
  for (const x of rings) {
    if (!hasArc(x.p)) { w.region(x.r); continue }
    if (!w.regionPrims(x.p, x.r)) { w.lines.length = at; w.arcs = arcs; return false }
  }
  return true
}

// the mask openings the legend overlaps, in board order
function silkOverOpenings(board: Board, layer: string, side: string): Ring[] {
  const silk = board.items.filter((it): it is Graphic | Text => (it.kind === 'graphic' || it.kind === 'text') && it.layer === layer)
  if (!silk.length) return []
  const ink = silk.map(it => ({ it, box: bbox(it.kind === 'text' ? (it.polys ? it.polys.map(q => q.outer) : it.strokes) : it.paths) }))
  const out: Ring[] = []
  for (const o of maskOpenings(board, side)) {
    const b = bbox([o])
    const near = ink.filter(x => bboxOverlap(x.box, b, Math.max(x.it.kind === 'text' ? x.it.thickness : x.it.width, 0)))
    if (near.length && overlaps(near.flatMap(x => copperRings(x.it, layer)), [o])) out.push(o)
  }
  return out
}

function padOut(w: Writer, p: Pad, layer: string, board: Board, isCu: boolean, isMask: boolean, isPaste: boolean, side: string | null) {
  let rings: Ring[] | null = null
  if (isCu) { if (p.layers.includes(layer)) rings = [p.poly] }
  else if (side && isMask) rings = padMask(p, side, board.rules)
  else if (side && isPaste) rings = padPaste(p, side, board.rules)
  if (!rings) return
  if (p.shape === 'circle' && rings.length === 1 && isCu) { w.flash(circleDef(Math.min(...p.size)), p.at[0], p.at[1]); return }
  for (const r of rings) w.region(r)
}

export interface DrillFile { name: string; plated: boolean }

export function gerberJob(board: Board, files: GerberFile[], date: string, drills: DrillFile[] = []): string {
  const job = {
    Header: { GenerationSoftware: { Vendor: 'pcbjs', Application: 'pcbjs', Version: VERSION }, CreationDate: date },
    GeneralSpecs: {
      ProjectId: { Name: board.name, GUID: '00000000-0000-0000-0000-000000000000', Revision: board.revision || 'rev?' },
      Size: { X: Math.round(board.bbox.w * 1000) / 1000, Y: Math.round(board.bbox.h * 1000) / 1000 },
      LayerNumber: board.copper, BoardThickness: board.thickness, Finish: jobFinish(board.stackup.finish),
    },
    DesignRules: [{ Layers: 'Outer', PadToPad: board.rules.clearance, PadToTrack: board.rules.clearance, TrackToTrack: board.rules.clearance, MinLineWidth: board.rules.minTrackWidth, TrackToRegion: board.rules.clearance, RegionToRegion: board.rules.clearance },
      ...(board.copper > 2 ? [{ Layers: 'Inner', PadToPad: board.rules.clearance, PadToTrack: board.rules.clearance, TrackToTrack: board.rules.clearance, MinLineWidth: board.rules.minTrackWidth, TrackToRegion: board.rules.clearance, RegionToRegion: board.rules.clearance }] : [])],
    FilesAttributes: [
      ...files.map(f => ({ Path: f.name, FileFunction: f.fileFunction, FilePolarity: f.fileFunction.startsWith('Soldermask') ? 'Negative' : 'Positive' })),
      ...drills.map(d => ({ Path: d.name, FileFunction: drillFunction(board, d.plated), FilePolarity: 'Positive' })),
    ],
    MaterialStackup: materialStackup(board),
  }
  return JSON.stringify(job, null, 2) + '\n'
}
// Ucamco job format finish names, as KiCad writes them
const FINISH: Record<Finish, string> = {
  HASL: 'HAL SnPb', LeadFreeHASL: 'HAL lead-free', ENIG: 'ENIG', ImmersionSilver: 'Immersion silver',
  ImmersionTin: 'Immersion tin', OSP: 'OSP', HardGold: 'Hard gold',
}
export const jobFinish = (f: Finish | undefined) => (f ? FINISH[f] : 'None')

// top to bottom; dielectrics carry Notes "Core" or "Prepreg"
export function materialStackup(board: Board): Record<string, string | number>[] {
  const s = board.stackup
  const out: Record<string, string | number>[] = []
  const side = (x: 'F' | 'B') => (x === 'F' ? 'Top' : 'Bottom')
  let prevCu = '', d = 0
  const pending: Record<string, string | number>[] = []
  for (const l of s.layers) {
    if (l.type === 'copper') {
      // a dielectric is named after the copper layers around it, as KiCad does: "F.Cu/In1.Cu"
      for (const p of pending) p.Name = `${prevCu}/${l.name}${pending.length > 1 ? ` ${pending.indexOf(p) + 1}` : ''}`
      pending.length = 0
      out.push({ Type: 'Copper', Name: l.name, Thickness: l.thickness })
      prevCu = l.name
    } else if (l.type === 'core' || l.type === 'prepreg') {
      const e: Record<string, string | number> = { Type: 'Dielectric', Name: '', Material: l.material ?? 'FR4', Thickness: l.thickness }
      if (l.er !== undefined) e.DielectricConstant = l.er
      if (l.lossTangent !== undefined) e.LossTangent = l.lossTangent
      e.Notes = `${l.type === 'core' ? 'Core' : 'Prepreg'}: dielectric layer ${++d}`
      pending.push(e); out.push(e)
    } else if ('side' in l) {
      const type = l.type === 'silk' ? 'Legend' : l.type === 'mask' ? 'SolderMask' : 'SolderPaste'
      const name = `${side(l.side)} ${l.type === 'silk' ? 'Silk Screen' : l.type === 'mask' ? 'Solder Mask' : 'Solder Paste'}`
      const e: Record<string, string | number> = { Type: type, Name: name }
      const color = l.color ?? (l.type === 'mask' ? s.maskColor : l.type === 'silk' ? s.silkColor : undefined)
      if (color) e.Color = color
      if (l.thickness !== undefined) e.Thickness = l.thickness
      out.push(e)
    }
  }
  return out
}

export function drillFunction(board: Board, plated: boolean): string {
  return plated ? `Plated,1,${board.copper},PTH` : `NonPlated,1,${board.copper},NPTH`
}
export type { Item }
