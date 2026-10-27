// KiCad's frame is pcbjs's: mm, x right, y down, rotation counter-clockwise on screen.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { atom, atoms, child, children, flag, head, isList, num, nums, parseSExpr, type SExpr, type SList } from './sexpr.js'
import { arcPoints, circlePoints, fmt, nm, normAngle, rotate, same, svgArcTo, type Pt } from './geom.js'
import { offset as offsetPolys, polysToRings, strokeOpen, union } from '@pcbjs/compile/geom'

export type KPadKind = 'smd' | 'thru_hole' | 'np_thru_hole' | 'connect'
export type KPadShape = 'circle' | 'rect' | 'oval' | 'roundrect' | 'trapezoid' | 'custom'

/** A pad's own copper shape or one padstack layer's, pad-local mm before the pad's rotation. */
export interface KPadShapeDef {
  shape: KPadShape
  size: Pt
  /** the shape's centre from the hole, KiCad's `(drill … (offset x y))` */
  offset: Pt
  rratio?: number
  chamferRatio?: number
  /** chamfered corners: top_left, top_right, bottom_left, bottom_right */
  chamfer?: string[]
  /** trapezoid `rect_delta` */
  delta?: Pt
  /** custom pads, pad-local */
  anchor?: 'rect' | 'circle'
  primitives?: KGraphic[]
}

export interface KPad extends KPadShapeDef {
  num: string
  kind: KPadKind
  /** centre of the hole, or of the pad without one, in the footprint frame */
  at: Pt
  /** degrees in the footprint frame */
  rot: number
  /** drill width and height; equal for a round hole */
  drill?: Pt
  layers: string[]
  maskMargin?: number
  pasteMargin?: number
  pasteRatio?: number
  /** the pad's own clearance, over the board's */
  clearance?: number
  /** KiCad's zone_connect: 0 none, 1 thermal, 2 solid, 3 thermal for through-hole only */
  zoneConnect?: number
  thermalGap?: number
  thermalWidth?: number
  thermalAngle?: number
  pinFunction?: string
  pinType?: string
  net?: string
  /** pad_prop_heatsink, pad_prop_fiducial_glob and the like */
  property?: string
  /** padstack layers with their own shape: "Inner", "B.Cu" and the like */
  stack?: (KPadShapeDef & { layer: string })[]
  /** remove_unused_layers: copper only where it connects, outer layers kept with keep_end_layers, `zones` from zone_layer_connections */
  removeUnused?: { keepEnds: boolean; zones: string[] }
}

/** A point of a polygon, or an arc of three points inside its `pts`. */
export type KPolyPt = Pt | { start: Pt; mid: Pt; end: Pt }

export interface KGraphic {
  kind: 'line' | 'arc' | 'circle' | 'rect' | 'poly' | 'curve'
  layer: string
  width: number
  fill: boolean
  start?: Pt
  mid?: Pt
  end?: Pt
  center?: Pt
  pts?: KPolyPt[]
}

export interface KText {
  kind: 'reference' | 'value' | 'user'
  text: string
  at: Pt
  rot: number
  layer: string
  /** cap height and glyph width */
  size: Pt
  thickness: number
  hidden: boolean
  justify: string[]
  /** a TrueType face, KiCad's `(face "Roboto Slab")`; absent for KiCad's stroke font */
  face?: string
  bold?: boolean
  italic?: boolean
}

export interface KModel {
  path: string
  offset: [number, number, number]
  scale: [number, number, number]
  rotate: [number, number, number]
  hidden: boolean
}

export interface KZone {
  layers: string[]
  net?: string
  name?: string
  /** a rule area: what may not enter; absent for a copper zone */
  keepout?: { tracks: boolean; vias: boolean; pads: boolean; pours: boolean; footprints: boolean }
  polygons: KPolyPt[][]
  priority: number
  clearance?: number
  minThickness?: number
  /** connect_pads: yes, no, thru_hole_only, or undefined for thermal reliefs */
  connect?: 'yes' | 'no' | 'thru_hole_only'
  thermalGap?: number
  thermalWidth?: number
}

export interface KAttrs {
  type?: 'smd' | 'through_hole'
  bom: boolean
  pos: boolean
  dnp: boolean
  boardOnly: boolean
}

/** A footprint in its own frame, front side up. */
export interface KFootprint {
  name: string
  /** the library nickname of a `Lib:Name` id */
  lib?: string
  descr?: string
  tags?: string
  properties: Record<string, string>
  attrs: KAttrs
  pads: KPad[]
  graphics: KGraphic[]
  texts: KText[]
  zones: KZone[]
  models: KModel[]
  /** footprint-wide pad defaults */
  maskMargin?: number
  pasteMargin?: number
  pasteRatio?: number
  zoneConnect?: number
  /** a part override of every pad's clearance */
  clearance?: number
  /** `net_tie_pad_groups`: groups of pad numbers whose copper touches by design, each pad keeping its net */
  netTie?: string[][]
  /** on a board: the placement as KiCad writes it */
  at?: [number, number, number]
  side?: 'F' | 'B'
  file?: string
  version?: number
}

const pt = (l: SList | undefined): Pt => [num(l, 1, 0), num(l, 2, 0)]
const strokeWidth = (l: SList): number => {
  const s = child(l, 'stroke')
  if (s) return num(child(s, 'width'), 1, 0)
  return num(child(l, 'width'), 1, 0)
}
const fillOf = (l: SList): boolean => {
  const f = child(l, 'fill')
  if (!f) return false
  const v = atom(f, 1)
  return v === 'yes' || v === 'solid' || v === 'true'
}
const layerOf = (l: SList): string => atom(child(l, 'layer')) ?? ''

function polyPts(l: SList | undefined): KPolyPt[] {
  const out: KPolyPt[] = []
  for (const e of l ?? []) {
    if (!isList(e)) continue
    if (e[0] === 'xy') out.push(pt(e))
    else if (e[0] === 'arc') out.push({ start: pt(child(e, 'start')), mid: pt(child(e, 'mid')), end: pt(child(e, 'end')) })
  }
  return out
}

/** A graphic item, fp_* or gr_* or a custom pad primitive, by its head without the prefix. */
export function readGraphic(l: SList, layer = layerOf(l)): KGraphic | null {
  const kind = head(l).replace(/^(fp|gr)_/, '')
  const base = { layer, width: strokeWidth(l), fill: fillOf(l) }
  switch (kind) {
    case 'line': return { kind: 'line', ...base, start: pt(child(l, 'start')), end: pt(child(l, 'end')) }
    case 'arc': {
      const s = pt(child(l, 'start')), e = pt(child(l, 'end'))
      if (child(l, 'mid')) return { kind: 'arc', ...base, start: s, mid: pt(child(l, 'mid')), end: e }
      // the old form: start is the centre, end the start point, angle the sweep in degrees
      const centre = s, from = e, sweep = num(child(l, 'angle'), 1, 0)
      const at = (deg: number): Pt => { const q = rotate([from[0] - centre[0], from[1] - centre[1]], -deg); return [centre[0] + q[0], centre[1] + q[1]] }
      return { kind: 'arc', ...base, start: from, mid: at(sweep / 2), end: at(sweep) }
    }
    case 'circle': return { kind: 'circle', ...base, center: pt(child(l, 'center')), end: pt(child(l, 'end')) }
    case 'rect': return { kind: 'rect', ...base, start: pt(child(l, 'start')), end: pt(child(l, 'end')) }
    case 'poly': {
      // a custom pad primitive without a fill token is filled
      const filled = child(l, 'fill') ? base.fill : true
      return { kind: 'poly', ...base, fill: filled, pts: polyPts(child(l, 'pts')) }
    }
    case 'curve': return { kind: 'curve', ...base, pts: polyPts(child(l, 'pts')) }
    default: return null
  }
}

function readShapeDef(l: SList, shape: string, offset: Pt): KPadShapeDef {
  const sz = nums(l, 'size')
  const d: KPadShapeDef = { shape: shape as KPadShape, size: [sz[0] ?? 0, sz[1] ?? sz[0] ?? 0], offset }
  const rr = child(l, 'roundrect_rratio')
  if (rr) d.rratio = num(rr)
  const cr = child(l, 'chamfer_ratio')
  if (cr) d.chamferRatio = num(cr)
  const ch = child(l, 'chamfer')
  if (ch) d.chamfer = atoms(ch)
  const dl = child(l, 'rect_delta')
  if (dl) d.delta = pt(dl)
  return d
}

function readPad(l: SList): KPad {
  const number = atom(l, 1) ?? ''
  const kind = (atom(l, 2) ?? 'smd') as KPadKind
  const shape = atom(l, 3) ?? 'rect'
  const at = nums(l, 'at')
  const dr = child(l, 'drill')
  let drill: Pt | undefined
  let off: Pt = [0, 0]
  if (dr) {
    const vals = dr.slice(1).filter((v): v is string => typeof v === 'string' && v !== 'oval').map(Number)
    const oval = dr.includes('oval')
    if (vals.length && vals[0] > 0) drill = oval ? [vals[0], vals[1] ?? vals[0]] : [vals[0], vals[0]]
    const o = child(dr, 'offset')
    if (o) off = pt(o)
  }
  const pad: KPad = { num: number, kind, at: [at[0] ?? 0, at[1] ?? 0], rot: at[2] ?? 0, ...readShapeDef(l, shape, off), layers: atoms(child(l, 'layers')) }
  if (drill) pad.drill = drill
  if (shape === 'custom') {
    const o = child(l, 'options')
    pad.anchor = (atom(child(o, 'anchor')) as 'rect' | 'circle' | undefined) ?? 'rect'
    pad.primitives = (child(l, 'primitives') ?? []).filter(isList).map(e => readGraphic(e, '')).filter((g): g is KGraphic => !!g)
  }
  const opt = (name: string) => { const c = child(l, name); return c ? num(c) : undefined }
  const mm = opt('solder_mask_margin'); if (mm !== undefined) pad.maskMargin = mm
  const pm = opt('solder_paste_margin'); if (pm !== undefined) pad.pasteMargin = pm
  const cl = opt('clearance'); if (cl !== undefined) pad.clearance = cl
  const pr = opt('solder_paste_margin_ratio') ?? opt('solder_paste_ratio'); if (pr !== undefined) pad.pasteRatio = pr
  // KiCad 7 writes the flags bare, 8 and newer as (remove_unused_layers yes)
  const removeUnused = l.find(e => e === 'remove_unused_layers' || head(e) === 'remove_unused_layers')
  if (removeUnused && (removeUnused === 'remove_unused_layers' || atom(removeUnused as SList) !== 'no')) {
    const keepEnds = l.find(e => e === 'keep_end_layers' || head(e) === 'keep_end_layers')
    pad.removeUnused = { keepEnds: !!keepEnds && (keepEnds === 'keep_end_layers' || atom(keepEnds as SList) !== 'no'), zones: atoms(child(l, 'zone_layer_connections')) }
  }
  const zc = opt('zone_connect'); if (zc !== undefined) pad.zoneConnect = zc
  const tg = opt('thermal_gap'); if (tg !== undefined) pad.thermalGap = tg
  const tw = opt('thermal_bridge_width') ?? opt('thermal_width'); if (tw !== undefined) pad.thermalWidth = tw
  const ta = opt('thermal_bridge_angle'); if (ta !== undefined) pad.thermalAngle = ta
  const pf = atom(child(l, 'pinfunction')); if (pf !== undefined) pad.pinFunction = pf
  const pinType = atom(child(l, 'pintype')); if (pinType !== undefined) pad.pinType = pinType
  const prop = atom(child(l, 'property')); if (prop !== undefined) pad.property = prop
  const net = child(l, 'net')
  if (net) { const name = net.length > 2 ? atom(net, 2) : atom(net, 1); if (name) pad.net = name }
  const ps = child(l, 'padstack')
  if (ps) {
    pad.stack = []
    for (const ly of children(ps, 'layer')) {
      const shp = atom(child(ly, 'shape')) ?? shape
      const o = child(ly, 'offset')
      pad.stack.push({ layer: atom(ly, 1) ?? '', ...readShapeDef(ly, shp, o ? pt(o) : [0, 0]) })
    }
  }
  return pad
}

function readText(l: SList): KText {
  const h = head(l)
  let kind: KText['kind'] = 'user', text = ''
  if (h === 'property') {
    const name = atom(l, 1) ?? ''
    kind = name === 'Reference' ? 'reference' : name === 'Value' ? 'value' : 'user'
    text = atom(l, 2) ?? ''
  } else {
    const k = atom(l, 1)
    kind = k === 'reference' ? 'reference' : k === 'value' ? 'value' : 'user'
    text = atom(l, 2) ?? ''
  }
  const at = nums(l, 'at')
  const effects = child(l, 'effects')
  const font = child(effects, 'font')
  const size = nums(font, 'size')
  const hidden = flag(l, 'hide') || flag(effects, 'hide')
  return {
    kind, text, at: [at[0] ?? 0, at[1] ?? 0], rot: at[2] ?? 0, layer: layerOf(l),
    size: [size[0] ?? 1, size[1] ?? size[0] ?? 1], thickness: num(child(font, 'thickness'), 1, 0.15), hidden,
    justify: atoms(child(effects, 'justify')), ...fontFace(font),
  }
}

/** The face, bold and italic of a `(font …)`: `(bold yes)` in KiCad 7 and later, a bare `bold` before. */
export function fontFace(font: SList | undefined): { face?: string; bold?: boolean; italic?: boolean } {
  const out: { face?: string; bold?: boolean; italic?: boolean } = {}
  const face = atom(child(font, 'face'), 1)
  if (face) out.face = face
  if (flag(font, 'bold')) out.bold = true
  if (flag(font, 'italic')) out.italic = true
  return out
}

export function readZone(l: SList): KZone {
  const layers = [...atoms(child(l, 'layers')), ...atoms(child(l, 'layer'))]
  const ko = child(l, 'keepout')
  const allowed = (k: string) => atom(child(ko, k)) !== 'not_allowed'
  const cp = child(l, 'connect_pads')
  const cpMode = atom(cp, 1)
  const fill = child(l, 'fill')
  const net = child(l, 'net_name') ?? child(l, 'net')
  const netName = net ? (net.length > 2 ? atom(net, 2) : atom(net, 1)) : undefined
  const z: KZone = {
    layers, polygons: children(l, 'polygon').map(p => polyPts(child(p, 'pts'))), priority: num(child(l, 'priority'), 1, 0),
  }
  if (netName && !/^\d+$/.test(netName)) z.net = netName
  else if (netName && child(l, 'net_name')) z.net = netName
  const name = atom(child(l, 'name')); if (name) z.name = name
  if (ko) z.keepout = { tracks: !allowed('tracks'), vias: !allowed('vias'), pads: !allowed('pads'), pours: !allowed('copperpour'), footprints: !allowed('footprints') }
  const cl = child(cp, 'clearance'); if (cl) z.clearance = num(cl)
  if (cpMode === 'yes' || cpMode === 'no' || cpMode === 'thru_hole_only') z.connect = cpMode
  const mt = child(l, 'min_thickness'); if (mt) z.minThickness = num(mt)
  const tg = child(fill, 'thermal_gap'); if (tg) z.thermalGap = num(tg)
  const tw = child(fill, 'thermal_bridge_width'); if (tw) z.thermalWidth = num(tw)
  return z
}

function readModel(l: SList): KModel {
  const xyz = (name: string, d: number): [number, number, number] => {
    const c = child(child(l, name), 'xyz')
    return c ? [num(c, 1, d), num(c, 2, d), num(c, 3, d)] : [d, d, d]
  }
  let offset = xyz('offset', 0)
  // KiCad 5 wrote the offset as (at (xyz …)) in inches
  if (!child(l, 'offset') && child(l, 'at')) offset = xyz('at', 0).map(v => nm(v * 25.4)) as [number, number, number]
  return { path: atom(l, 1) ?? '', offset, scale: xyz('scale', 1), rotate: xyz('rotate', 0), hidden: flag(l, 'hide') }
}

/** Read a parsed (footprint …) or (module …) list; a board footprint is brought to its own frame, front side up. */
export function readFootprintList(l: SList, o: { board?: boolean; file?: string } = {}): KFootprint {
  const id = atom(l, 1) ?? ''
  const colon = id.indexOf(':')
  const fp: KFootprint = {
    name: colon >= 0 ? id.slice(colon + 1) : id, ...(colon >= 0 ? { lib: id.slice(0, colon) } : {}),
    properties: {}, attrs: { bom: true, pos: true, dnp: false, boardOnly: false },
    pads: [], graphics: [], texts: [], zones: [], models: [],
  }
  if (o.file) fp.file = o.file
  const v = child(l, 'version'); if (v) fp.version = num(v)
  const d = atom(child(l, 'descr')); if (d) fp.descr = d
  const t = atom(child(l, 'tags')); if (t) fp.tags = t
  const attr = atoms(child(l, 'attr'))
  if (attr.includes('smd')) fp.attrs.type = 'smd'
  else if (attr.includes('through_hole')) fp.attrs.type = 'through_hole'
  if (attr.includes('exclude_from_bom') || attr.includes('virtual')) fp.attrs.bom = false
  if (attr.includes('exclude_from_pos_files') || attr.includes('virtual')) fp.attrs.pos = false
  if (attr.includes('dnp')) fp.attrs.dnp = true
  if (attr.includes('board_only')) fp.attrs.boardOnly = true
  const mm = child(l, 'solder_mask_margin'); if (mm) fp.maskMargin = num(mm)
  const pm = child(l, 'solder_paste_margin'); if (pm) fp.pasteMargin = num(pm)
  const pr = child(l, 'solder_paste_ratio') ?? child(l, 'solder_paste_margin_ratio'); if (pr) fp.pasteRatio = num(pr)
  const zc = child(l, 'zone_connect'); if (zc) fp.zoneConnect = num(zc)
  const fcl = child(l, 'clearance'); if (fcl && num(fcl)) fp.clearance = num(fcl)
  const tie = atoms(child(l, 'net_tie_pad_groups')).map(g => g.split(',').map(x => x.trim()).filter(Boolean)).filter(g => g.length >= 2)
  if (tie.length) fp.netTie = tie
  for (const e of l) {
    if (!isList(e)) continue
    switch (e[0]) {
      case 'property': {
        const name = atom(e, 1) ?? '', val = atom(e, 2) ?? ''
        fp.properties[name] = val
        if (name === 'Reference' || name === 'Value' || layerOf(e)) fp.texts.push(readText(e))
        break
      }
      case 'fp_text': {
        const tx = readText(e)
        if (tx.kind === 'reference') fp.properties.Reference ??= tx.text
        if (tx.kind === 'value') fp.properties.Value ??= tx.text
        fp.texts.push(tx)
        break
      }
      case 'pad': fp.pads.push(readPad(e)); break
      case 'zone': fp.zones.push(readZone(e)); break
      case 'model': fp.models.push(readModel(e)); break
      default:
        if (/^fp_(line|arc|circle|rect|poly|curve)$/.test(String(e[0]))) { const g = readGraphic(e); if (g) fp.graphics.push(g) }
    }
  }
  if (o.board) {
    const at = nums(l, 'at')
    fp.at = [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0]
    fp.side = (atom(child(l, 'layer')) ?? 'F.Cu').startsWith('B.') ? 'B' : 'F'
    toOwnFrame(fp)
  }
  return fp
}

/** F.* to B.* and back, `*.Cu` and the like unchanged. */
export function swapSide(layer: string): string {
  if (layer.startsWith('F.')) return 'B.' + layer.slice(2)
  if (layer.startsWith('B.')) return 'F.' + layer.slice(2)
  return layer
}
const flipPt = (p: Pt): Pt => [p[0], nm(-p[1])]
const flipPolyPts = (pts: KPolyPt[]): KPolyPt[] => pts.map(q => Array.isArray(q) ? flipPt(q) : { start: flipPt(q.start), mid: flipPt(q.mid), end: flipPt(q.end) })
function flipGraphic(g: KGraphic, layers = true): KGraphic {
  const out: KGraphic = { ...g, layer: layers ? swapSide(g.layer) : g.layer }
  for (const k of ['start', 'mid', 'end', 'center'] as const) if (g[k]) out[k] = flipPt(g[k]!)
  if (g.kind === 'rect' && g.start && g.end) { out.start = flipPt(g.start); out.end = flipPt(g.end) }
  if (g.pts) out.pts = flipPolyPts(g.pts)
  return out
}
const CORNER_FLIP: Record<string, string> = { top_left: 'bottom_left', bottom_left: 'top_left', top_right: 'bottom_right', bottom_right: 'top_right' }
function flipShape<T extends KPadShapeDef>(s: T): T {
  const out = { ...s, offset: flipPt(s.offset) }
  if (s.delta) out.delta = [s.delta[0], nm(-s.delta[1])]
  if (s.chamfer) out.chamfer = s.chamfer.map(c => CORNER_FLIP[c] ?? c)
  if (s.primitives) out.primitives = s.primitives.map(g => flipGraphic(g, false))
  return out
}

// a board file holds absolute pad and text angles, and a back part flipped top to bottom with its layers swapped
function toOwnFrame(fp: KFootprint): void {
  const a = fp.at![2]
  const back = fp.side === 'B'
  fp.pads = fp.pads.map(p => {
    let q: KPad = { ...p, rot: normAngle(p.rot - a) }
    if (back) {
      q = flipShape(q)
      q.at = flipPt(q.at)
      q.rot = normAngle(-q.rot)
      q.layers = q.layers.map(swapSide)
      if (q.stack) q.stack = q.stack.map(s => ({ ...flipShape(s), layer: swapSide(s.layer) }))
    }
    return q
  })
  fp.texts = fp.texts.map(t => {
    const q = { ...t, rot: normAngle(t.rot - a) }
    if (back) { q.at = flipPt(q.at); q.rot = normAngle(-q.rot); q.layer = swapSide(q.layer) }
    return q
  })
  // a footprint's zones are stored in board coordinates
  const [x0, y0] = fp.at!
  const local = (p: Pt): Pt => { const q = rotate([p[0] - x0, p[1] - y0], -a); return [nm(q[0]), nm(q[1])] }
  fp.zones = fp.zones.map(z => ({ ...z, polygons: z.polygons.map(poly => poly.map(q => Array.isArray(q) ? local(q) : { start: local(q.start), mid: local(q.mid), end: local(q.end) })) }))
  if (back) {
    fp.graphics = fp.graphics.map(g => flipGraphic(g))
    fp.zones = fp.zones.map(z => ({ ...z, layers: z.layers.map(swapSide), polygons: z.polygons.map(flipPolyPts) }))
  }
}

/** Read a `.kicad_mod`, its text or a path. */
export function readKicadMod(source: string): KFootprint {
  const isText = source.trimStart().startsWith('(')
  const text = isText ? source : readFileSync(source, 'utf8')
  const l = parseSExpr(text)
  if (head(l) !== 'footprint' && head(l) !== 'module') throw new Error(`${isText ? 'the text' : source} is not a KiCad footprint: it starts with (${head(l)} …)`)
  const fp = readFootprintList(l, isText ? {} : { file: source })
  if (!fp.name && !isText) fp.name = basename(source).replace(/\.kicad_mod$/, '')
  return fp
}

/** A pcbjs element as data: what `h(type, props, ...children)` takes and the TSX printer writes. */
export interface ElementSpec {
  type: string
  props: Record<string, unknown>
  children?: (string | number)[]
}

/** The pcbjs layer of a KiCad layer: user layers go to Cmts.User, Margin and the adhesive layers are dropped. */
export function pcbjsLayer(layer: string): string | null {
  if (/^(F|B)\.(Cu|SilkS|Mask|Paste|Fab|CrtYd)$/.test(layer) || /^In\d+\.Cu$/.test(layer) || layer === 'Edge.Cuts' || layer === 'Dwgs.User' || layer === 'Cmts.User') return layer
  if (layer === 'F.Silkscreen') return 'F.SilkS'
  if (layer === 'B.Silkscreen') return 'B.SilkS'
  if (layer === 'F.Courtyard') return 'F.CrtYd'
  if (layer === 'B.Courtyard') return 'B.CrtYd'
  if (/^(Eco\d\.User|User\.\d+|User\.Drawings|User\.Comments|User\.Eco\d)$/.test(layer)) return layer === 'User.Drawings' ? 'Dwgs.User' : 'Cmts.User'
  return null
}

const xy = (p: Pt) => `${fmt(p[0])} ${fmt(p[1])}`

export function polyPath(pts: KPolyPt[]): string {
  if (!pts.length) return ''
  const first = Array.isArray(pts[0]) ? pts[0] : pts[0].start
  let d = `M ${xy(first)}`
  let cur = first
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i]
    if (Array.isArray(q)) { if (i > 0) d += ` L ${xy(q)}`; cur = q }
    else {
      if (!same(cur, q.start)) d += ` L ${xy(q.start)}`
      d += ` ${svgArcTo(q.start, q.mid, q.end)}`
      cur = q.end
    }
  }
  return d + ' Z'
}

export function polyRing(pts: KPolyPt[]): Pt[] {
  const out: Pt[] = []
  for (const q of pts) {
    if (Array.isArray(q)) out.push(q)
    else out.push(...arcPoints(q.start, q.mid, q.end))
  }
  return out
}

/** Join lines and arcs end to end into paths, so a body outline reads as one path. */
export function chainSegments(segs: KGraphic[]): string[] {
  type Seg = { a: Pt; b: Pt; cmd: (from: Pt, rev: boolean) => string }
  const pool: Seg[] = segs.map(g => g.kind === 'arc'
    ? { a: g.start!, b: g.end!, cmd: (_f: Pt, rev: boolean) => rev ? svgArcTo(g.end!, g.mid!, g.start!) : svgArcTo(g.start!, g.mid!, g.end!) }
    : { a: g.start!, b: g.end!, cmd: (_f: Pt, rev: boolean) => `L ${xy(rev ? g.start! : g.end!)}` })
  const out: string[] = []
  while (pool.length) {
    const s = pool.shift()!
    const run: { seg: Seg; rev: boolean }[] = [{ seg: s, rev: false }]
    let start = s.a, end = s.b
    for (let grew = true; grew;) {
      grew = false
      for (let i = 0; i < pool.length; i++) {
        const q = pool[i]
        if (same(q.a, end)) { run.push({ seg: q, rev: false }); end = q.b }
        else if (same(q.b, end)) { run.push({ seg: q, rev: true }); end = q.a }
        else if (same(q.b, start)) { run.unshift({ seg: q, rev: false }); start = q.a }
        else if (same(q.a, start)) { run.unshift({ seg: q, rev: true }); start = q.b }
        else continue
        pool.splice(i, 1)
        grew = true
        break
      }
    }
    let d = `M ${xy(start)}`
    let cur = start
    for (const { seg, rev } of run) { d += ' ' + seg.cmd(cur, rev); cur = rev ? seg.a : seg.b }
    if (run.length > 1 && same(start, end)) d = d.replace(/ L [^ALM]+$/, '') + ' Z'
    out.push(d)
  }
  return out
}

/** Graphics as element specs: lines and arcs chained per layer and width, the rest one element each. */
export function graphicSpecs(graphics: KGraphic[], mapLayer: (l: string) => string | null = pcbjsLayer): ElementSpec[] {
  const out: ElementSpec[] = []
  const runs = new Map<string, KGraphic[]>()
  for (const g of graphics) {
    const layer = mapLayer(g.layer)
    if (!layer) continue
    const w = nm(g.width)
    if (g.kind === 'line' || g.kind === 'arc') {
      const k = `${layer}|${w}`
      if (!runs.has(k)) runs.set(k, [])
      runs.get(k)!.push(g)
      continue
    }
    const fill = g.fill ? { fill: true } : {}
    if (g.kind === 'circle') {
      const r = Math.hypot(g.end![0] - g.center![0], g.end![1] - g.center![1])
      out.push({ type: 'circle', props: { layer, cx: nm(g.center![0]), cy: nm(g.center![1]), r: nm(r), width: w, ...fill } })
    } else if (g.kind === 'rect') {
      const x0 = Math.min(g.start![0], g.end![0]), y0 = Math.min(g.start![1], g.end![1])
      out.push({ type: 'rect', props: { layer, x: nm(x0), y: nm(y0), w: nm(Math.abs(g.end![0] - g.start![0])), h: nm(Math.abs(g.end![1] - g.start![1])), width: w, ...fill } })
    } else if (g.kind === 'poly' && g.pts && g.pts.length >= 2) {
      out.push({ type: 'path', props: { layer, d: g.pts.length >= 3 ? polyPath(g.pts) : `M ${xy(g.pts[0] as Pt)} L ${xy(g.pts[1] as Pt)}`, width: w, ...fill } })
    } else if (g.kind === 'curve' && g.pts && g.pts.length === 4) {
      const [a, b, c, d] = g.pts as Pt[]
      out.push({ type: 'path', props: { layer, d: `M ${xy(a)} C ${xy(b)} ${xy(c)} ${xy(d)}`, width: w } })
    }
  }
  for (const [k, segs] of runs) {
    const [layer, w] = k.split('|')
    for (const d of chainSegments(segs)) out.push({ type: 'path', props: { layer, d, width: Number(w) } })
  }
  const order = (l: string) => ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'F.Fab', 'B.Fab', 'F.CrtYd', 'B.CrtYd'].indexOf(l)
  return fillsFirst(out.map((e, i) => ({ e, i })).sort((p, q) => (order(String(p.e.props.layer)) - order(String(q.e.props.layer))) || p.i - q.i).map(p => p.e))
}

/** [x0, y0, x1, y1] of a circle, rect or path spec. */
function specBox(e: ElementSpec): [number, number, number, number] | null {
  const p = e.props
  if (e.type === 'circle') { const r = Number(p.r); return [Number(p.cx) - r, Number(p.cy) - r, Number(p.cx) + r, Number(p.cy) + r] }
  if (e.type === 'rect') return [Number(p.x), Number(p.y), Number(p.x) + Number(p.w), Number(p.y) + Number(p.h)]
  if (e.type !== 'path' || typeof p.d !== 'string') return null
  const pts: Pt[] = []
  const tok = p.d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  let cmd = ''
  for (let k = 0; k < tok.length;) {
    if (/[A-Za-z]/.test(tok[k])) { cmd = tok[k++].toUpperCase(); continue }
    const n = cmd === 'A' ? 7 : 2
    const v = tok.slice(k, k + n).map(Number)
    k += n
    if (v.length === n) pts.push([v[n - 2], v[n - 1]])
  }
  if (!pts.length) return null
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Move each filled shape before the earlier items inside its box, so its holes cannot erase them, as the C in a copyright ring. */
export function fillsFirst(specs: ElementSpec[]): ElementSpec[] {
  const out = specs.slice()
  const inside = (a: number[], b: number[]) => a[0] >= b[0] - 1e-6 && a[1] >= b[1] - 1e-6 && a[2] <= b[2] + 1e-6 && a[3] <= b[3] + 1e-6
  for (let i = 1; i < out.length; i++) {
    const e = out[i]
    if (!e.props.fill) continue
    const box = specBox(e)
    if (!box) continue
    let j = -1
    for (let k = 0; k < i; k++) {
      if (out[k].props.layer !== e.props.layer) continue
      const b = specBox(out[k])
      if (b && inside(b, box) && !(out[k].props.fill && inside(box, b))) { j = k; break }
    }
    if (j >= 0) { out.splice(i, 1); out.splice(j, 0, e) }
  }
  return out
}

/** The shift [along, down] from KiCad's stroke text `at` to pcbjs's, after FONT::getLinePositions of KiCad 7 to 9. */
export function kicadStrokeShift(t: Pick<KText, 'size' | 'thickness' | 'justify'>, lines = 1): Pt {
  const h = t.size[0], th = t.thickness, j = t.justify
  const baseline = h * (1 + 1 / 21) - 0.052 * th - (j.includes('top') ? 0 : j.includes('bottom') ? 1.17 * h : 0.585 * h)
  const dy = baseline - h + (h + (lines - 1) * 1.6 * h) / 2
  const dx = (j.includes('left') ? 1 : j.includes('right') ? -1 : 0) * th / 1.52 * (j.includes('mirror') ? -1 : 1)
  return [Math.round(dx * 1e6) / 1e6 || 0, Math.round(dy * 1e6) / 1e6 || 0]
}

/** Text as a spec in NewStroke by default, `outline` for an installed TrueType face, `hershey` for a face not installed here. */
export function textSpec(t: KText, layer: string, text = t.text, outline?: { font: string; size: number; width: number; dy: number }, hershey = false): ElementSpec {
  const [h, w] = t.size
  let at: Pt = t.at
  const anchor = t.justify.includes('left') ? 'start' : t.justify.includes('right') ? 'end' : 'middle'
  // pcbjs puts `at` at the vertical centre; KiCad's top and bottom justification move it half a line
  const shift: Pt = outline || hershey ? [0, (t.justify.includes('top') ? h / 2 : t.justify.includes('bottom') ? -h / 2 : 0) + (outline?.dy ?? 0)] : kicadStrokeShift(t, text.split(/\r?\n/).length)
  if (shift[0] || shift[1]) { const d = rotate(shift, t.rot); at = [at[0] + d[0], at[1] + d[1]] }
  const rot = normAngle(t.rot)
  const props: Record<string, unknown> = { layer, at: rot ? `${fmt(at[0])} ${fmt(at[1])} ${fmt(rot)}deg` : `${fmt(at[0])} ${fmt(at[1])}`, size: nm(outline?.size ?? h) }
  if (outline) {
    if (outline.width !== outline.size) props.width = nm(outline.width)
    props.font = outline.font
  } else {
    if (nm(w) !== nm(h)) props.width = nm(w)
    props.thickness = nm(t.thickness)
    if (!hershey) props.font = 'newstroke'
  }
  if (anchor !== 'middle') props.anchor = anchor
  return { type: 'text', props, children: [text] }
}

/** A pad shape's outline in its own frame, offset applied; null for the plain shapes pcbjs draws itself. */
export function padOutline(s: KPadShapeDef, always = false): Pt[] | null {
  const [w, h] = s.size
  const off = s.offset
  const plain = !off[0] && !off[1]
  const chamfered = s.shape === 'roundrect' || s.shape === 'rect' ? !!(s.chamferRatio && s.chamfer?.length) : false
  if (!always && plain && !chamfered && (s.shape === 'circle' || s.shape === 'rect' || s.shape === 'oval' || s.shape === 'roundrect')) return null
  let ring: Pt[]
  switch (s.shape) {
    case 'circle': ring = circlePoints([0, 0], w / 2); break
    case 'oval': ring = roundedPoly(w, h, Math.min(w, h) / 2, []); break
    case 'rect': ring = roundedPoly(w, h, 0, chamfered ? s.chamfer! : [], (s.chamferRatio ?? 0) * Math.min(w, h)); break
    case 'roundrect': ring = roundedPoly(w, h, (s.rratio ?? 0.25) * Math.min(w, h), chamfered ? s.chamfer! : [], (s.chamferRatio ?? 0) * Math.min(w, h)); break
    case 'trapezoid': {
      const dx = w / 2, dy = h / 2, ddx = (s.delta?.[0] ?? 0) / 2, ddy = (s.delta?.[1] ?? 0) / 2
      ring = [[-dx - ddy, dy + ddx], [dx + ddy, dy - ddx], [dx - ddy, -dy + ddx], [-dx + ddy, -dy - ddx]]
      break
    }
    case 'custom': ring = customOutline(s); break
    default: ring = roundedPoly(w, h, 0, [])
  }
  return ring.map(([x, y]) => [nm(x + off[0]), nm(y + off[1])] as Pt)
}

/** A w by h rectangle with corners of radius r, the listed corners chamfered by c instead. */
function roundedPoly(w: number, h: number, r: number, chamfer: string[], c = 0): Pt[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  c = Math.max(0, Math.min(c, w / 2, h / 2))
  const out: Pt[] = []
  const corners: [string, number, number, number][] = [['bottom_right', w / 2, h / 2, 0], ['bottom_left', -w / 2, h / 2, 90], ['top_left', -w / 2, -h / 2, 180], ['top_right', w / 2, -h / 2, 270]]
  for (const [name, x, y, a0] of corners) {
    const sx = Math.sign(x), sy = Math.sign(y)
    if (chamfer.includes(name) && c > 0) {
      // y down: going round counter-clockwise in the math frame, clockwise on screen
      const p1: Pt = a0 === 0 || a0 === 180 ? [x, y - sy * c] : [x - sx * c, y]
      const p2: Pt = a0 === 0 || a0 === 180 ? [x - sx * c, y] : [x, y - sy * c]
      out.push(p1, p2)
    } else if (r > 0) {
      const cx = x - sx * r, cy = y - sy * r
      for (let i = 0; i <= 8; i++) {
        const t = ((a0 + (90 * i) / 8) * Math.PI) / 180
        out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
      }
    } else out.push([x, y])
  }
  return out
}

/** A custom pad's anchor and primitives unioned, the largest piece kept. */
function customOutline(s: KPadShapeDef): Pt[] {
  const [w, h] = s.size
  const rings: Pt[][] = [s.anchor === 'circle' ? circlePoints([0, 0], w / 2) : [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]]
  const grow = (ring: Pt[], width: number) => width > 0 ? polysToRings(offsetPolys([ring], width / 2)) as Pt[][] : [ring]
  for (const g of s.primitives ?? []) {
    if (g.kind === 'poly' && g.pts) {
      const ring = polyRing(g.pts)
      if (g.fill) rings.push(...grow(ring, g.width))
      else rings.push(...(polysToRings(strokeOpen([...ring, ring[0]], g.width)) as Pt[][]))
    } else if (g.kind === 'line' && g.start && g.end) rings.push(...(polysToRings(strokeOpen([g.start, g.end], g.width)) as Pt[][]))
    else if (g.kind === 'arc' && g.start && g.mid && g.end) rings.push(...(polysToRings(strokeOpen(arcPoints(g.start, g.mid, g.end), g.width)) as Pt[][]))
    else if (g.kind === 'circle' && g.center && g.end) {
      const r = Math.hypot(g.end[0] - g.center[0], g.end[1] - g.center[1])
      if (g.fill || g.width <= 0) rings.push(circlePoints(g.center, r + g.width / 2))
      else rings.push(...(polysToRings(strokeOpen([...circlePoints(g.center, r), circlePoints(g.center, r)[0]], g.width)) as Pt[][]))
    } else if (g.kind === 'rect' && g.start && g.end) {
      const [a, b] = [g.start, g.end]
      const ring: Pt[] = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]
      if (g.fill) rings.push(...grow(ring, g.width))
      else rings.push(...(polysToRings(strokeOpen([...ring, ring[0]], g.width)) as Pt[][]))
    }
  }
  const polys = union(rings)
  if (!polys.length) return rings[0]
  const area = (r: Pt[]) => Math.abs(r.reduce((s_, p, i) => { const q = r[(i + 1) % r.length]; return s_ + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
  return polys.map(p => p.outer as Pt[]).sort((a, b) => area(b) - area(a))[0]
}

const COPPER = /^(F|B)\.Cu$|^In\d+\.Cu$|^\*\.Cu$|^F&B\.Cu$/
const sizeOf = (ring: Pt[]): Pt => {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1])
  return [nm(2 * Math.max(...xs.map(Math.abs))), nm(2 * Math.max(...ys.map(Math.abs)))]
}

function shapeProps(s: KPadShapeDef): Record<string, unknown> {
  const outline = padOutline(s)
  if (outline) return { shape: 'custom', size: sizeOf(outline), points: outline.map(([x, y]) => [x, y]) }
  const [w, h] = s.size
  if (s.shape === 'circle') return { shape: 'circle', size: nm(w) }
  const out: Record<string, unknown> = { shape: s.shape, size: [nm(w), nm(h)] }
  if (s.shape === 'roundrect') out.roundness = nm(s.rratio ?? 0.25)
  return out
}

/** The pcbjs pads of a KiCad pad: none without copper, two when a padstack's front shape differs. */
export function padSpecs(p: KPad, fp: Pick<KFootprint, 'maskMargin' | 'pasteMargin' | 'pasteRatio' | 'zoneConnect'> = {}, copper: string[] = ['F.Cu', 'B.Cu'], windows?: Pt[][]): ElementSpec[] {
  const cu = p.layers.filter(l => COPPER.test(l))
  if (p.kind !== 'np_thru_hole' && !cu.length) return []
  const props: Record<string, unknown> = { num: p.num }
  const at = p.rot ? [nm(p.at[0]), nm(p.at[1]), nm(p.rot)] : [nm(p.at[0]), nm(p.at[1])]
  props.at = at
  // the pad's own shape is its front, unless the padstack lists F.Cu: a back part's stack was flipped
  const stackF = p.stack?.find(s => s.layer === 'F.Cu'), stackB = p.stack?.find(s => s.layer === 'B.Cu'), stackIn = p.stack?.find(s => s.layer === 'Inner')
  const frontShape: KPadShapeDef = stackF ?? p
  const back: KPadShapeDef | undefined = p.stack?.length ? stackB ?? (stackF ? p : stackIn ?? p) : undefined
  const split = !!back && p.kind === 'thru_hole' && JSON.stringify(shapeProps(back)) !== JSON.stringify(shapeProps(frontShape))
  Object.assign(props, shapeProps(split ? back! : frontShape))
  if (p.drill) props.drill = p.drill[0] === p.drill[1] ? nm(p.drill[0]) : [nm(p.drill[0]), nm(p.drill[1])]
  if (p.kind === 'np_thru_hole') props.type = 'npth'
  else if (p.kind === 'thru_hole') { if (!p.drill) props.type = 'tht' }
  const all = cu.includes('*.Cu') || cu.includes('F&B.Cu')
  if (p.kind === 'smd' || p.kind === 'connect') {
    if (!(cu.length === 1 && cu[0] === 'F.Cu')) props.layers = cu
    const paste = p.layers.some(l => /Paste$/.test(l)) && p.kind !== 'connect'
    if (!paste) props.paste = false
  } else if (p.kind === 'thru_hole' && !all) props.layers = cu
  const mask = p.maskMargin ?? fp.maskMargin
  if (mask !== undefined && mask !== 0) props.maskExpansion = nm(mask)
  // KiCad 8 and older write 0 for a clearance that is not set
  if (p.clearance && p.kind !== 'np_thru_hole') props.clearance = nm(p.clearance)
  // a margin or ratio of 0 means the footprint's; a negative margin is a paste shrink, a positive one is written as the window
  const margin = p.pasteMargin || fp.pasteMargin || 0, ratio = p.pasteRatio || fp.pasteRatio || 0
  if (p.kind === 'smd' && props.paste !== false) {
    if (margin > 0) props.paste = pasteRings(split ? back! : frontShape, margin, ratio)
    else {
      if (margin < 0) props.pasteShrink = nm(-margin)
      if (ratio) props.pasteRatio = nm(ratio)
    }
  }
  if (windows?.length && p.kind === 'smd') { delete props.paste; delete props.pasteShrink; delete props.pasteRatio; props.paste = windows.map(r => r.map(([x, y]) => [nm(x), nm(y)])) }
  const zc = p.zoneConnect ?? fp.zoneConnect
  if (zc === 0) props.thermal = 'none'
  else if (zc === 2) props.thermal = 'solid'
  else if (p.kind !== 'np_thru_hole') {
    // KiCad 7 and later lay spokes at 45 degrees on a round pad, 90 on any other
    const a = p.thermalAngle ?? (p.shape === 'circle' ? 45 : 90)
    if ((((a % 90) + 90) % 90) === 45) props.thermal = { angle: 45 }
  }
  if (!split) return [{ type: 'pad', props }]
  // the hole joins every layer, so the back shape stays on all of them and the front shape is added on F.Cu
  const front: Record<string, unknown> = { num: p.num, at, ...shapeProps(frontShape), paste: false }
  if (props.maskExpansion !== undefined) front.maskExpansion = props.maskExpansion
  if (props.thermal !== undefined) front.thermal = props.thermal
  if (props.clearance !== undefined) front.clearance = props.clearance
  return [{ type: 'pad', props }, { type: 'pad', props: front }]
}

const holds = (pad: KPad, q: KPad): boolean => {
  const d = rotate([q.at[0] - pad.at[0], q.at[1] - pad.at[1]], -pad.rot)
  return Math.abs(d[0]) <= pad.size[0] / 2 + 1e-6 && Math.abs(d[1]) <= pad.size[1] / 2 + 1e-6
}

/** A pad shape's paste opening: grown by `ratio` of its size per axis, then by `margin`. */
export function pasteRings(s: KPadShapeDef, margin: number, ratio: number): Pt[][] {
  const grown: KPadShapeDef = ratio ? { ...s, size: [s.size[0] * (1 + 2 * ratio), s.size[1] * (1 + 2 * ratio)] } : s
  const ring = padOutline(grown, true)!
  const rings = margin ? polysToRings(offsetPolys([ring], margin)) as Pt[][] : [ring]
  return rings.map(r => r.map(([x, y]) => [nm(x), nm(y)] as Pt))
}

/** Every copper pad as specs; a paste-only pad becomes the paste window of the pasteless copper pad holding its centre. */
export function footprintPadSpecs(fp: KFootprint, copper: string[] = ['F.Cu', 'B.Cu']): ElementSpec[] {
  const cu = fp.pads.filter(p => p.kind === 'np_thru_hole' || p.layers.some(l => COPPER.test(l)))
  const windows = fp.pads.filter(p => !cu.includes(p) && p.layers.some(l => /Paste$/.test(l)))
  const own = new Map<KPad, Pt[][]>()
  for (const w of windows) {
    const pad = cu.find(c => c.kind === 'smd' && holds(c, w))
    if (!pad || pad.layers.some(l => /Paste$/.test(l))) continue
    const rings = pasteRings(w, w.pasteMargin || 0, w.pasteRatio || 0).map(r => r.map(q => {
      const f = rotate(q, w.rot)
      return rotate([w.at[0] + f[0] - pad.at[0], w.at[1] + f[1] - pad.at[1]], -pad.rot)
    }))
    own.set(pad, [...(own.get(pad) ?? []), ...rings])
  }
  return cu.flatMap(p => padSpecs(own.has(p) ? { ...p, layers: [...p.layers, 'F.Paste'] } : p, fp, copper, own.get(p)))
}

/** User text with literal content; `${REFERENCE}` and the value are left to pcbjs. */
export function footprintTextSpecs(fp: KFootprint, mapLayer: (l: string) => string | null = pcbjsLayer): ElementSpec[] {
  const out: ElementSpec[] = []
  for (const t of fp.texts) {
    if (t.kind !== 'user' || t.hidden || !t.text || /\$\{[^}]+\}/.test(t.text)) continue
    const layer = mapLayer(t.layer)
    if (layer) out.push(textSpec(t, layer))
  }
  return out
}

/** The visible silk reference's position, false when it is hidden or off silk. */
export function refAtOf(fp: KFootprint): string | false | undefined {
  const r = fp.texts.find(t => t.kind === 'reference')
  if (!r) return undefined
  if (r.hidden || !/SilkS$/.test(r.layer)) return false
  return `${fmt(r.at[0])} ${fmt(r.at[1])} ${fmt(normAngle(r.rot))}`
}

export function zoneSpecs(zones: KZone[], copper: string[]): ElementSpec[] {
  const out: ElementSpec[] = []
  for (const z of zones) {
    if (!z.keepout || !(z.keepout.tracks || z.keepout.vias || z.keepout.pours)) continue
    const layers = z.layers.flatMap(l => l === '*.Cu' || l === 'F&B.Cu' ? copper : COPPER.test(l) ? [l] : [])
    if (!layers.length) continue
    for (const poly of z.polygons) {
      const props: Record<string, unknown> = layers.length === copper.length && copper.every(c => layers.includes(c)) ? { layers: 'all' } : layers.length === 1 ? { layer: layers[0] } : { layers }
      props.d = polyPath(poly)
      if (!z.keepout.tracks) props.tracks = false
      if (!z.keepout.vias) props.vias = false
      if (!z.keepout.pours) props.pours = false
      out.push({ type: 'keepout', props })
    }
  }
  return out
}

/** The copper pad numbers in pad order, each once. */
export function padPins(fp: KFootprint): string[] {
  const out: string[] = []
  for (const p of fp.pads) if (p.num !== '' && p.kind !== 'np_thru_hole' && p.layers.some(l => COPPER.test(l)) && !out.includes(p.num)) out.push(p.num)
  return out
}

/** 'full' and 'open' draw the silk as the footprint has it, 'none' leaves it out. */
export type KicadSilkMode = 'full' | 'open' | 'none'
export const KICAD_SILK_MODES: readonly KicadSilkMode[] = ['full', 'open', 'none']

const silkLayers = (silk: KicadSilkMode) => (l: string) => {
  const out = pcbjsLayer(l)
  return silk === 'none' && out !== null && /SilkS$/.test(out) ? null : out
}

/** Pads, graphics, text and keepouts, in that order. */
export function footprintSpecs(fp: KFootprint, copper = ['F.Cu', 'B.Cu'], o: { silk?: KicadSilkMode } = {}): ElementSpec[] {
  const map = silkLayers(o.silk ?? 'full')
  return [...footprintPadSpecs(fp, copper), ...graphicSpecs(fp.graphics, map), ...footprintTextSpecs(fp, map), ...zoneSpecs(fp.zones, copper)]
}

export { atom, child, children, head, isList, num, nums, parseSExpr }
export type { SExpr, SList }
