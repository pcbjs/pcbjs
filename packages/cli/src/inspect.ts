import { relative } from 'node:path'
import type { Board, Footprint, Graphic, Item, Pad, Prim, Ring, Text, Track, Via, Zone } from '@pcbjs/core/model'
import { copperLayers, resolveLayer } from '@pcbjs/compile/layers'
import { pairsOf } from '@pcbjs/compile/pair-info'
import { polylineLength } from '@pcbjs/compile/length'
import { variantSlug } from '@pcbjs/core/variants'
import { routeInfos } from '@pcbjs/export/site-data'
import { resolveConfig } from './config.js'
import { pluginState } from './plugin.js'
import { compileServer, compileSlots, errorText } from './check.js'
import { BoardIndex, boardFindings, boardLabel, fmtPt, routeSrcText } from '@pcbjs/export/findings'
import type { BoardSlot } from './boards.js'
import { askDev, devLine, devServerOf, realEntry, secs, type InspectRequest } from './dev-reuse.js'
import { inspectReferences } from './references.js'
import { inspectSchematic } from './inspect-sch.js'
import { padMask, padPaste } from '@pcbjs/export/pads'
import { netCopper, polysArea } from '@pcbjs/export/copper-area'
import { bareHole } from '@pcbjs/compile/bare'
import { MODEL_LABEL, modelSource, type ModelSource } from '@pcbjs/core/model-source'

export interface InspectOptions {
  entry?: string; root?: string; config?: string; json?: boolean; target?: string; verbose?: boolean
  /** one query; `requests` takes several, answered from one compile */
  query?: string; lengths?: boolean; layer?: string
  requests?: InspectRequest[]
  /** compile here even when a running dev server holds a current board */
  fresh?: boolean
}

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const r3 = (v: number) => Math.round(v * 1000) / 1000
const pt = (p: [number, number]): [number, number] => [r3(p[0]), r3(p[1])]
const srcText = (ix: BoardIndex, s?: { file: string; line: number; col: number }) => (s ? `${ix.rel(s.file)}:${s.line}:${s.col}` : undefined)

/** The 95th percentile of the nearest-neighbour distance, null for fewer than two points. */
export function stitchP95(pts: [number, number][]): number | null {
  if (pts.length < 2) return null
  const d = pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map(q => Math.hypot(q[0] - p[0], q[1] - p[1])))).sort((a, b) => a - b)
  return Math.round(d[Math.min(d.length - 1, Math.ceil(0.95 * d.length) - 1)] * 1000) / 1000
}

/** Print columns padded to their widest cell. */
export function table(rows: string[][], indent = '  '): string[] {
  const w: number[] = []
  for (const r of rows) r.forEach((c, i) => { w[i] = Math.max(w[i] ?? 0, c.length) })
  return rows.map(r => indent + r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('  ').trimEnd())
}

const padsOf = (b: Board, fp: Footprint): Pad[] => fp.pads.map(id => b.items.find(i => i.id === id)).filter((p): p is Pad => !!p && p.kind === 'pad')

/** Whether a pad turned by `rot` degrees has its footprint x along the board's y. */
const quarter = (rot: number) => Math.abs(Math.round(((rot % 180) + 180) % 180) - 90) < 1e-6
const square = (rot: number) => Math.abs(((rot % 90) + 90) % 90) < 1e-6 || Math.abs(((rot % 90) + 90) % 90 - 90) < 1e-6
/** A pad's size in board axes as KiCad plots it: swapped for a quarter turn, the copper extent at any other angle. */
function boardSize(p: Pad): [number, number] {
  if (square(p.rot)) return quarter(p.rot) ? [r3(p.size[1]), r3(p.size[0])] : [r3(p.size[0]), r3(p.size[1])]
  const xs = p.poly.map(q => q[0]), ys = p.poly.map(q => q[1])
  return xs.length ? [r3(Math.max(...xs) - Math.min(...xs)), r3(Math.max(...ys) - Math.min(...ys))] : [r3(p.size[0]), r3(p.size[1])]
}
/** A pad's drill in board axes, an oval slot swapped as its pad. */
const boardDrill = (p: Pad): [number, number] | null => (p.drill && square(p.rot) && quarter(p.rot) ? [p.drill[1], p.drill[0]] : p.drill)

const drillText = ([w, h]: [number, number]) => (w === h ? f2(w) : `${f2(w)} x ${f2(h)} slot`)

function padJson(p: Pad) {
  return {
    num: p.num, name: p.name, net: p.net ?? null, at: pt(p.at), size: boardSize(p), shape: p.shape, rot: r3(p.rot), layers: p.layers, drill: boardDrill(p),
    footprintSize: [r3(p.size[0]), r3(p.size[1])], footprintDrill: p.drill,
  }
}
/** `cw` is clockwise on screen. */
export function primJson(q: Prim) {
  return q.kind === 'arc' ? { kind: 'arc' as const, from: pt(q.from as [number, number]), to: pt(q.to as [number, number]), center: pt(q.center as [number, number]), cw: q.cw } : { kind: 'line' as const, from: pt(q.from as [number, number]), to: pt(q.to as [number, number]) }
}
export function trackJson(t: Track) {
  return { id: t.id, layer: t.layer, width: t.width, length: r3(polylineLength(t.pts)), pts: t.pts.map(p => pt(p as [number, number])), ...(t.prims?.some(q => q.kind === 'arc') ? { prims: t.prims.map(primJson) } : {}), route: t.route ?? null, ...(t.pair ? { pair: t.pair, role: t.role ?? 'P' } : {}) }
}
export function graphicJson(g: Graphic) {
  return { id: g.id, layer: g.layer, ...(g.net ? { net: g.net } : {}), width: g.width, fill: g.fill, closed: g.closed, paths: g.paths.map(r => r.map(p => pt(p as [number, number]))), ...(g.prims?.some(ps => ps.some(q => q.kind === 'arc')) ? { prims: g.prims.map(ps => ps.map(primJson)) } : {}) }
}
const modelOf = (b: Board, fp: Footprint) => modelSource(fp.model, fp.height ?? (bareHole(b, fp) ? 0 : 1))

function fpJson(ix: BoardIndex, b: Board, fp: Footprint) {
  const path = ix.paths.get(fp.ref)
  return { ref: fp.ref, ...(path ? { path } : {}), value: fp.value, footprint: fp.id, at: pt(fp.at), rot: r3(fp.rot), side: fp.side, model: MODEL_LABEL[modelOf(b, fp)], src: srcText(ix, fp.src) ?? null }
}

export function frameOf(b: Board, entry: string) {
  const bb = b.bbox
  return {
    board: boardLabel(b), entry, units: 'mm', axes: 'x right, y down, rotation counter-clockwise on screen',
    outline: { x: [r3(bb.x), r3(bb.x + bb.w)], y: [r3(bb.y), r3(bb.y + bb.h)], w: r3(bb.w), h: r3(bb.h) },
    copper: copperLayers(b.copper),
    ...(b.variant ? { targets: b.variant.names } : {}),
  }
}

export interface InspectResult { text: string[]; json: unknown; found: boolean }

/** As the viewer writes it. */
const rangeText = (t: { min: number; max: number }) => (Math.abs(t.max - t.min) < 1e-6 ? f2(t.min) : t.max >= 1e6 ? `>= ${f2(t.min)}` : `${f2(t.min)} to ${f2(t.max)}`)

/** A net, a pair id or a net of a pair, or a match group. */
function routeMatch(b: Board, query: string): (r: { net: string; pair?: string; group?: string }) => boolean {
  const pairNets = new Map((b.pairs ?? []).map(p => [p.id, p.nets as string[]]))
  return r => r.net === query || r.pair === query || r.group === query || (!!r.pair && !!pairNets.get(r.pair)?.includes(query))
}

/** Status is ok, short, long, failed when a leg did not route, or - without a target. */
function routeRows(b: Board, ix: BoardIndex, query?: string) {
  const all = routeInfos(b).routes ?? []
  const match = query ? routeMatch(b, query) : null
  const failed = new Set(boardFindings(b, ix.root).flatMap(f => (f.rule === 'route-failed' && f.route ? [f.route] : [])))
  const rows = all.filter(r => !match || match(r)).map(r => {
    const t = r.target ?? null
    const status = failed.has(r.id) ? 'failed' : !t ? '-' : r.length < t.min - 1e-6 ? 'short' : r.length > t.max + 1e-6 ? 'long' : 'ok'
    const rec = ix.routes.get(r.id)
    return { id: r.id, net: r.net, pair: r.pair ?? null, length: r3(r.length), target: t && { min: r3(t.min), max: t.max >= 1e6 ? null : r3(t.max) }, group: r.group ?? null,
      skew: r.skew ?? null, tuned: rec?.tuned ?? 0, status, src: (rec ? routeSrcText(ix, rec) : undefined) ?? srcText(ix, r.src) ?? null }
  })
  // a route that placed no copper is not in the length table: it shows as failed with no length
  const shown = new Set(rows.map(r => r.id))
  for (const rec of b.routes ?? []) {
    if (shown.has(rec.id) || !failed.has(rec.id) || rec.net === undefined || (match && !match({ net: rec.net, pair: rec.pair, group: rec.group }))) continue
    rows.push({ id: rec.id, net: rec.net, pair: rec.pair ?? null, length: 0, target: null, group: rec.group ?? null, skew: null, tuned: 0, status: 'failed', src: routeSrcText(ix, rec) ?? null })
  }
  const num = (id: string) => Number(id.replace(/\D+/g, '')) || 0
  return rows.sort((x, y) => num(x.id) - num(y.id))
}

/** A via's route id, or `stitch` for a via of stitch(). */
const viaRoute = (v: Via): string | null => v.route ?? (v.stitch ? 'stitch' : null)

/** Per layer: the fill area in mm², the pieces with the area of each, the islands the last fill removed and the zone ids. */
export function zoneRows(zones: Zone[]) {
  const by = new Map<string, { layer: string; area: number; pieces: number; fill: { zone: number; area: number }[]; islandsRemoved: { count: number; area: number }; ids: number[] }>()
  for (const z of zones) {
    const row = by.get(z.layer) ?? { layer: z.layer, area: 0, pieces: 0, fill: [], islandsRemoved: { count: 0, area: 0 }, ids: [] }
    by.set(z.layer, row)
    for (const p of z.fill) { const a = polysArea([p]); row.area += a; row.fill.push({ zone: z.id, area: r3(a) }) }
    row.pieces += z.fill.length
    row.islandsRemoved.count += z.islandsRemoved?.count ?? 0
    row.islandsRemoved.area += z.islandsRemoved?.area ?? 0
    row.ids.push(z.id)
  }
  return [...by.values()].map(r => ({ ...r, area: r3(r.area), islandsRemoved: { count: r.islandsRemoved.count, area: r3(r.islandsRemoved.area) } }))
}

type Box = { x: [number, number]; y: [number, number] }
/** `grow` is the half width of a stroke; null for no points. */
function boxOf(lists: Ring[], grow = 0): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const l of lists) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return x0 <= x1 ? { x: [r3(x0 - grow), r3(x1 + grow)], y: [r3(y0 - grow), r3(y1 + grow)] } : null
}
const boxText = (bx: Box | null) => (bx ? `${fmtPt([bx.x[0], bx.y[0]])} to ${fmtPt([bx.x[1], bx.y[1]])}  ${f2(bx.x[1] - bx.x[0])} x ${f2(bx.y[1] - bx.y[0])}` : '-')

function shapeOf(g: Graphic): string {
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  const ps = g.prims?.flat() ?? []
  const lines = g.prims ? ps.filter(q => q.kind === 'line').length : g.paths.reduce((s, r, i) => s + Math.max(0, r.length - 1) + (g.closed[i] && r.length > 2 ? 1 : 0), 0)
  const arcs = ps.filter(q => q.kind === 'arc').length
  const parts = [lines ? n(lines, 'line') : '', arcs ? n(arcs, 'arc') : ''].filter(Boolean)
  return `${parts.join(', ') || 'empty'}${g.paths.length > 1 ? ` in ${g.paths.length} paths` : ''}${g.fill ? ' filled' : g.closed.some(Boolean) ? ' closed' : ''}`
}

/** Text strokes and glyphs, drawings, tracks, pours, pads and vias on one layer, each with its ink bounds. */
export function layerItems(b: Board, ix: BoardIndex, layer: string) {
  const cu = copperLayers(b.copper)
  const viaOn = (v: Via) => { const i = cu.indexOf(v.layers[0]), j = cu.indexOf(v.layers[1]), k = cu.indexOf(layer); return k >= 0 && k >= Math.min(i, j) && k <= Math.max(i, j) }
  // mask and paste as the Gerbers draw them, copper on any other layer the pad lists
  const side = /^([FB])\.(Mask|Paste)$/.exec(layer)
  const padRings = (p: Pad): Ring[] | null => (side ? (side[2] === 'Mask' ? padMask(p, side[1], b.rules) : padPaste(p, side[1], b.rules)) : p.layers.includes(layer) ? [p.poly] : null)
  const on = (i: Item) => (i.kind === 'pad' ? !!padRings(i)?.length : i.kind === 'via' ? viaOn(i) : i.layer === layer)
  const common = (i: Item) => ({ id: i.id, kind: i.kind === 'graphic' ? 'drawing' as const : i.kind, ...(i.ref ? { ref: i.ref, ...(ix.paths.get(i.ref) ? { path: ix.paths.get(i.ref) } : {}) } : {}), ...(i.net ? { net: i.net } : {}),
    src: srcText(ix, i.src) ?? srcText(ix, i.ref ? b.footprints.find(f => f.ref === i.ref)?.src : undefined) ?? null })
  return b.items.filter(on).map(i => {
    if (i.kind === 'text') {
      const t = i as Text, half = t.thickness / 2
      const glyphs = (t.polys ?? []).map(p => ({ bounds: boxOf([p.outer]), outer: p.outer.map(q => pt(q as [number, number])), holes: p.holes.map(h => h.map(q => pt(q as [number, number]))) }))
      return { ...common(i), text: t.text, ...(t.font ? { font: t.font } : {}), at: pt(t.at), rot: r3(t.rot), size: r3(t.size), thickness: r3(t.thickness), mirrored: t.mirrored,
        bounds: boxOf([...t.strokes, ...(t.polys ?? []).map(p => p.outer)], half), shape: t.polys?.length ? `${glyphs.length} glyph polygons` : `${t.strokes.length} strokes`,
        strokes: t.strokes.map(r => ({ bounds: boxOf([r], half), pts: r.map(q => pt(q as [number, number])) })), ...(glyphs.length ? { glyphs } : {}) }
    }
    if (i.kind === 'graphic') return { ...common(i), ...graphicJson(i), kind: 'drawing' as const, bounds: boxOf(i.paths, i.fill ? 0 : i.width / 2), shape: shapeOf(i) }
    if (i.kind === 'track') return { ...common(i), ...trackJson(i), bounds: boxOf([i.pts], i.width / 2), shape: `width ${f2(i.width)}, length ${f2(polylineLength(i.pts))}` }
    if (i.kind === 'zone') { const z = zoneRows([i])[0]; return { ...common(i), priority: i.priority, bounds: boxOf(i.fill.map(p => p.outer)) ?? boxOf(i.outline), fill: { area: z.area, pieces: z.pieces }, ...(i.islandsRemoved ? { islandsRemoved: i.islandsRemoved } : {}), shape: `fill ${f2(z.area)} mm² in ${z.pieces} piece${z.pieces === 1 ? '' : 's'}` } }
    if (i.kind === 'pad') {
      const rings = padRings(i)!
      return { ...common(i), num: i.num, at: pt(i.at), shape: `pad ${i.ref ?? ''}.${i.num} ${i.shape}${i.drill ? ' drilled' : ''}`, bounds: boxOf(rings), rings: rings.map(r => r.map(q => pt(q as [number, number]))) }
    }
    const v = i as Via
    return { ...common(i), at: pt(v.at), size: v.size, drill: v.drill, layers: v.layers, bounds: boxOf([[[v.at[0], v.at[1]]]], v.size / 2), shape: `via ${f2(v.size)} drill ${f2(v.drill)}` }
  })
}

function inspectLayer(b: Board, ix: BoardIndex, name: string, filter?: string): { text: string[]; json: Record<string, unknown>; found: boolean } {
  let layer: string
  try { layer = resolveLayer(name, false, new Set(b.layers.map(l => l.id))) } catch (e) { return { text: [(e as Error).message], json: { error: (e as Error).message, layers: b.layers.map(l => l.id) }, found: false } }
  const def = b.layers.find(l => l.id === layer)!
  let items = layerItems(b, ix, layer)
  if (filter) {
    const want = filter.toLowerCase()
    items = items.filter(i => ('ref' in i && (i.ref?.toLowerCase() === want || ('path' in i && String(i.path).toLowerCase() === want))) || ('net' in i && i.net?.toLowerCase() === want))
  }
  const count: Record<string, number> = {}
  for (const i of items) count[i.kind] = (count[i.kind] ?? 0) + 1
  const all = boxOf(items.flatMap(i => (i.bounds ? [[[i.bounds.x[0], i.bounds.y[0]], [i.bounds.x[1], i.bounds.y[1]]] as Ring] : [])))
  const text = [`layer ${layer}  ${def.name}${filter ? `  of ${filter}` : ''}  ${items.length} item${items.length === 1 ? '' : 's'}${items.length ? `: ${Object.entries(count).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ')}  bounds ${boxText(all)}` : ''}`]
  if (items.length) text.push(...table([['item', 'kind', 'ref', 'text', 'bounds', 'shape', 'src'],
    ...items.map(i => [`#${i.id}`, i.kind, 'ref' in i && i.ref ? i.ref : '-', 'text' in i ? JSON.stringify(i.text) : '-', boxText(i.bounds), i.shape, i.src ?? '-'])]))
  return { text, json: { layer, name: def.name, kind: def.kind, side: def.side, ...(filter ? { filter } : {}), bounds: all, items }, found: true }
}

/** With `lengths` the route table, with `layer` every item on the layer, narrowed to the query's part or net when given. */
export function inspectBoard(b: Board, entry: string, root: string, query?: string, opts: { lengths?: boolean; layer?: string } = {}): InspectResult {
  const ix = new BoardIndex(b, root)
  const fr = frameOf(b, entry)
  const text = [
    `${fr.board}  ${entry}  ${fr.units}, ${fr.axes}`,
    `outline  x ${f2(fr.outline.x[0])} to ${f2(fr.outline.x[1])}, y ${f2(fr.outline.y[0])} to ${f2(fr.outline.y[1])}, ${f2(fr.outline.w)} x ${f2(fr.outline.h)}  copper ${fr.copper.join(' ')}${b.variant ? `  target ${b.variant.name} of ${b.variant.names.join(', ')}` : ''}`,
  ]
  const fpOf = (ref: string) => b.footprints.find(f => f.ref === ref)
  const padRows = (pads: Pad[], withRef: boolean) => table([
    [...(withRef ? ['pad'] : ['pad']), 'name', 'net', 'centre', 'size', 'layers'],
    ...pads.map(p => [withRef ? `${p.ref ?? ''}.${p.num}` : p.num, p.name || '-', p.net ?? '-', fmtPt(p.at), `${f2(boardSize(p)[0])} x ${f2(boardSize(p)[1])} ${p.shape}${p.drill ? ` drill ${drillText(boardDrill(p)!)}` : ''}`, p.layers.join(' ')]),
  ])

  if (opts.layer) { const r = inspectLayer(b, ix, opts.layer, query); text.push(...r.text); return { text, json: { frame: fr, ...r.json }, found: r.found } }
  if (query === 'references' && !opts.lengths && !b.footprints.some(f => f.ref === query)) { const r = inspectReferences(b, root); return { ...r, text: [...text, ...r.text] } }
  if (query === 'sch' && !opts.lengths && !b.footprints.some(f => f.ref === query)) { const r = inspectSchematic(b, root); return { ...r, text: [...text, ...r.text] } }
  if (opts.lengths) {
    const rows = routeRows(b, ix, query)
    if (!rows.length) text.push(query ? `no route of the net, pair or group ${query}` : 'no routes')
    else text.push(...table([['route', 'net', 'pair', 'length', 'target', 'group', 'skew', 'tuned', 'status', 'src'],
      ...rows.map(r => [r.id, r.net, r.pair ?? '-', f2(r.length), r.target ? rangeText({ min: r.target.min, max: r.target.max ?? 1e6 }) : '-', r.group ?? '-', r.skew === null ? '-' : f2(r.skew), r.tuned ? f2(r.tuned) : '-', r.status, r.src ?? '-'])]))
    return { text, json: { frame: fr, routes: rows }, found: rows.length > 0 || !query }
  }
  if (!query) {
    const rows = [...b.footprints].sort((a, c) => a.ref.localeCompare(c.ref, undefined, { numeric: true }))
    text.push(...table([['ref', 'path', 'value', 'at', 'rot', 'side', 'pads', 'model', 'src'], ...rows.map(fp => [fp.ref, ix.paths.get(fp.ref) ?? '-', fp.value || '-', fmtPt(fp.at), String(r3(fp.rot)), fp.side, String(fp.pads.length), MODEL_LABEL[modelOf(b, fp)], srcText(ix, fp.src) ?? '-'])]))
    const models = { file: 0, generated: 0, none: 0, missing: 0 } as Record<ModelSource, number>
    for (const fp of rows) models[modelOf(b, fp)]++
    text.push(`models  ${models.file} file, ${models.generated} generated, ${models.missing} no model, ${models.none} no body`)
    return { text, json: { frame: fr, footprints: rows.map(fp => fpJson(ix, b, fp)), models }, found: true }
  }

  // a ref, an instance path such as CH2/R or CH2.R or a schematic export name, each with an optional .PAD
  const byPath = new Map<string, string>()
  for (const [ref, path] of ix.paths) { byPath.set(path, ref); byPath.set(path.replace(/\//g, '.'), ref) }
  for (const [ref, name] of ix.names) if (!fpOf(name)) byPath.set(name, ref)
  const refOf = (q: string) => (fpOf(q) ? q : byPath.get(q))
  type Answer = { text: string[]; json: Record<string, unknown>; found: boolean }
  const asPart = (query: string): Answer | null => {
    const text: string[] = []
    const ref = refOf(query)
    if (ref) {
      const fp = fpOf(ref)!
      const path = ix.paths.get(ref) ?? ix.names.get(ref)
      const pads = padsOf(b, fp)
      text.push(`${ref}${path ? ` (${path})` : ''}  ${fp.value}  ${fp.id}  at ${fmtPt(fp.at)}  rot ${r3(fp.rot)}  side ${fp.side}  model ${MODEL_LABEL[modelOf(b, fp)]}${fp.src ? `  ${srcText(ix, fp.src)}` : ''}`)
      text.push(...padRows(pads, false))
      const drawn = b.items.filter((i): i is Graphic => i.kind === 'graphic' && i.ref === ref)
      return { text, json: { frame: fr, footprint: { ...fpJson(ix, b, fp), pads: pads.map(padJson), ...(drawn.length ? { graphics: drawn.map(graphicJson) } : {}) } }, found: true }
    }
    const dot = query.lastIndexOf('.')
    if (dot > 0) {
      const r = refOf(query.slice(0, dot)), pin = query.slice(dot + 1)
      const fp = r ? fpOf(r) : undefined
      if (fp) {
        const pads = padsOf(b, fp).filter(p => p.num === pin || p.name === pin)
        if (!pads.length) {
          text.push(`${r} has no pad ${pin}; pads: ${padsOf(b, fp).map(p => (p.name && p.name !== p.num ? `${p.num} ${p.name}` : p.num)).join(', ')}`)
          return { text, json: { frame: fr, error: `no pad ${pin} on ${r}` }, found: false }
        }
        text.push(...padRows(pads, true))
        return { text, json: { frame: fr, ref: r, pads: pads.map(padJson) }, found: true }
      }
    }
    return null
  }
  const asNet = (query: string): Answer | null => {
    const text: string[] = []
    const net = b.nets.find(n => n.name === query) ?? b.nets.find(n => n.name.toLowerCase() === query.toLowerCase())
    if (net) {
      const pads = b.items.filter((i): i is Pad => i.kind === 'pad' && i.net === net.name)
      const vias = b.items.filter((i): i is Via => i.kind === 'via' && i.net === net.name)
      const trackItems = b.items.filter((i): i is Track => i.kind === 'track' && i.net === net.name)
      const tracks = trackItems.length
      const zones = b.items.filter((i): i is Zone => i.kind === 'zone' && i.net === net.name)
      const pours = zoneRows(zones)
      const copper = netCopper(b, net.name).map(c => ({ layer: c.layer, area: r3(c.area) }))
      const drawn = b.items.filter((i): i is Graphic => i.kind === 'graphic' && i.net === net.name)
      const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
      text.push(`net ${net.name}  ${n(pads.length, 'pad')}, ${n(vias.length, 'via')}, ${n(tracks, 'track')}, ${n(zones.length, 'zone')}${zones.length ? ` on ${[...new Set(zones.map(z => z.layer))].join(' ')}` : ''}${copper.length ? `  copper ${copper.map(c => `${c.layer} ${c.area.toFixed(1)} mm²`).join(', ')}` : ''}`)
      if (pads.length) text.push(...padRows(pads, true))
      if (pours.length) text.push(...table([['zone', 'fill', 'pieces', 'islands removed', 'zones'], ...pours.map(z => [z.layer, `${f2(z.area)} mm²`, String(z.pieces), z.islandsRemoved.count ? `${z.islandsRemoved.count}, ${f2(z.islandsRemoved.area)} mm²` : '0', z.ids.map(id => `#${id}`).join(' ')])]))
      if (vias.length) text.push(...table([['via', 'centre', 'layers', 'size', 'route'], ...vias.map(v => [`#${v.id}`, fmtPt(v.at), v.layers.join('-'), `${f2(v.size)} drill ${f2(v.drill)}`, viaRoute(v) ?? '-'])]))
      const stitched = vias.filter(v => v.stitch)
      const stitch = stitched.length ? { count: stitched.length, p95: stitchP95(stitched.map(v => v.at)) } : null
      if (stitch) text.push(`stitch  ${n(stitch.count, 'via')}, nearest neighbour 95th percentile ${stitch.p95 === null ? '-' : `${f2(stitch.p95)} mm`}`)
      // a pair's tracks follow in its own table
      const paired = new Set(trackItems.filter(t => t.pair !== undefined).map(t => t.id))
      const single = trackItems.filter(t => !paired.has(t.id))
      if (single.length) text.push(...table([['track', 'layer', 'width', 'length', 'from', 'to', 'route'], ...single.map(t => [`#${t.id}`, t.layer, String(r3(t.width)), f2(polylineLength(t.pts)), fmtPt(t.pts[0]), fmtPt(t.pts[t.pts.length - 1]), t.route ?? '-'])]))
      const gaps = b.ratsnest.filter(r => r.net === net.name)
      const failed = b.drc.filter(d => d.rule === 'route-failed' && (d.route?.net === net.name || /nets? (\S+) and (\S+)/.exec(d.message)?.slice(1).includes(net.name)))
      if (gaps.length) text.push(`unconnected  ${gaps.length} gap${gaps.length === 1 ? '' : 's'}: ${gaps.map(g => `${fmtPt(g.from)} to ${fmtPt(g.to)}`).join(', ')}`)
      for (const d of failed) text.push(`route failed  ${d.message}`)
      const pairs = pairsOf(b).filter(p => p.nets.includes(net.name))
      const pairJson = pairs.map(p => {
        const role = p.nets[0] === net.name ? 'P' : 'N', partner = p.nets[role === 'P' ? 1 : 0] ?? null
        const width = p.info?.width ?? p.P[0]?.width ?? 0, gap = p.info?.gap ?? null
        text.push(`pair ${p.id}  ${role} of ${p.nets[0] ?? '?'}/${p.nets[1] ?? '?'}  partner ${partner ?? '-'}  width ${f2(width)}  gap ${gap === null ? '-' : f2(gap)}  length ${p.nets[0] ?? 'P'} ${f2(p.lengthP)} ${p.nets[1] ?? 'N'} ${f2(p.lengthN)} with vias  skew ${f2(Math.abs(p.lengthP - p.lengthN))}${p.info ? ` of ${f2(p.info.skew)}` : ''}${p.info ? `  uncoupled ${f2(p.info.uncoupled)} of ${f2(p.info.maxUncoupled)}` : ''}`)
        const rows = [...p.P, ...p.N].map(t => ({ id: t.id, role: t.role ?? 'P', net: t.net ?? null, layer: t.layer, width: t.width, length: r3(polylineLength(t.pts)) }))
        text.push(...table([['track', 'role', 'net', 'layer', 'width', 'length'], ...rows.map(t => [`#${t.id}`, t.role, t.net ?? '-', t.layer, f2(t.width), f2(t.length)])]))
        return { id: p.id, role, partner, width, gap, length: { P: r3(p.lengthP), N: r3(p.lengthN) }, skew: r3(Math.abs(p.lengthP - p.lengthN)), ...(p.info ? { allowedSkew: p.info.skew, uncoupled: r3(p.info.uncoupled), allowedUncoupled: p.info.maxUncoupled } : {}), tracks: rows }
      })
      const singles = routeRows(b, ix, net.name).filter(r => !r.pair)
      for (const r of singles) text.push(`route ${r.id}  length ${f2(r.length)} with vias${r.target ? `  target ${rangeText({ min: r.target.min, max: r.target.max ?? 1e6 })} ${r.status}` : ''}${r.group ? `  group ${r.group}` : ''}${r.tuned ? `  tuned ${f2(r.tuned)}` : ''}${r.src ? `  ${r.src}` : ''}`)
      return {
        text, json: {
          frame: fr, net: net.name, ...(singles.length ? { routes: singles } : {}), pads: pads.map(p => ({ ref: p.ref ?? null, ...padJson(p) })),
          vias: vias.map(v => ({ id: v.id, at: pt(v.at), layers: v.layers, size: v.size, drill: v.drill, route: viaRoute(v) })),
          tracks: trackItems.map(trackJson),
          ...(drawn.length ? { graphics: drawn.map(graphicJson) } : {}),
          copper,
          zones: pours,
          ...(stitch ? { stitch } : {}),
          unconnected: gaps.map(g => ({ from: pt(g.from), to: pt(g.to) })), failed: failed.map(d => ({ message: d.message, at: pt(d.at as [number, number]) })),
          ...(pairJson.length ? { pairs: pairJson } : {}),
        }, found: true,
      }
    }
    return null
  }

  // a bare query that names both a part and a net prints both
  const m = /^(net|part):(.+)$/i.exec(query)
  const kind = m ? m[1].toLowerCase() : null, q = m ? m[2] : query
  const p = kind === 'net' ? null : asPart(q)
  // beside a part, only a net of exactly that name: the case-blind match is for a query that names nothing else
  const nt = kind === 'part' || (!kind && p?.found && !b.nets.some(n => n.name === q)) ? null : asNet(q)
  const answers = [p, nt].filter((x): x is Answer => !!x)
  // an answer that found nothing, such as a missing pad of a part, stands unless the other kind found something
  const found = answers.filter(x => x.found)
  if (found.length === 2) {
    text.push(`${q} is both a part and a net: both follow; part:${q} or net:${q} asks for one`, '', ...p!.text, '', ...nt!.text)
    const bare = (j: Record<string, unknown>) => { const { frame: _f, ...rest } = j; return rest }
    return { text, json: { frame: fr, query: q, part: bare(p!.json), net: bare(nt!.json) }, found: true }
  }
  const one = found[0] ?? answers[0]
  if (one) { text.push(...one.text); return { ...one, text } }
  const what = kind === 'net' ? 'net' : kind === 'part' ? 'footprint or pad' : 'footprint, pad or net'
  query = q
  const refs = b.footprints.map(f => f.ref).sort((a, c) => a.localeCompare(c, undefined, { numeric: true }))
  text.push(`no ${what} named ${query}`, `refs: ${refs.join(' ')}`, `nets: ${b.nets.map(n => n.name).join(' ')}`)
  return { text, json: { frame: fr, error: `no ${what} named ${query}`, refs, nets: b.nets.map(n => n.name) }, found: false }
}

export function inspectMany(b: Board, entry: string, root: string, requests: InspectRequest[]): InspectResult[] {
  return (requests.length ? requests : [{}]).map(r => inspectBoard(b, entry, root, r.query, { lengths: r.lengths, layer: r.layer }))
}

const requestLabel = (r: InspectRequest) => (r.layer ? `--layer ${r.layer}${r.query ? ` ${r.query}` : ''}` : r.lengths ? `--lengths${r.query ? ` ${r.query}` : ''}` : r.query ?? 'every footprint')

/** Several answers share the frame lines, each under a `== <query>` heading. */
export function inspectOutput(results: InspectResult[], requests: InspectRequest[], json: boolean): string[] {
  if (results.length === 1) return json ? [JSON.stringify(results[0].json, null, 2)] : results[0].text
  if (json) {
    const frame = (results[0].json as { frame?: unknown }).frame
    const each = results.map((r, i) => { const { frame: _, ...rest } = r.json as Record<string, unknown>; return { ...requests[i], found: r.found, ...rest } })
    return [JSON.stringify({ frame, results: each }, null, 2)]
  }
  const out = results[0].text.slice(0, 2)
  results.forEach((r, i) => out.push('', `== ${requestLabel(requests[i])}`, ...r.text.slice(2)))
  return out
}

export async function inspect(opts: InspectOptions): Promise<number> {
  process.env.NODE_ENV ??= 'production'
  const requests: InspectRequest[] = opts.requests ?? [{ ...(opts.query !== undefined ? { query: opts.query } : {}), ...(opts.lengths ? { lengths: true } : {}), ...(opts.layer ? { layer: opts.layer } : {}) }]
  // naming one board of the config picks it, not an override worth a line
  const cfg = await resolveConfig(opts.entry === undefined ? [] : [opts.entry], 'build', opts.config, opts.root, () => {})
  if (cfg.entries.length > 1) throw new Error(`inspect looks at one board, name its entry: ${cfg.entries.map(e => `pcbjs inspect ${e.rel}`).join(', ')}`)
  const entry = cfg.entries[0]
  const print = (results: InspectResult[]) => {
    for (const l of inspectOutput(results, requests, !!opts.json)) console.log(l)
    return results.every(r => r.found) ? 0 : 1
  }
  // a running dev server with a current board answers from its own compile
  const dev = opts.fresh ? null : devServerOf(cfg.root)
  if (dev) {
    const r = await askDev<{ current: boolean; ms: number; age: number; results?: InspectResult[]; error?: string }>(dev.origin, 'inspect', { entry: realEntry(entry.file), requests: JSON.stringify(requests), ...(opts.target ? { target: opts.target } : {}) })
    if (r?.current && r.results) {
      console.error(devLine(dev.origin, [entry.rel], r.ms, r.age))
      return print(r.results)
    }
    if (r?.current && r.error) { console.error(`pcbjs: ${r.error}`); return 1 }
  }
  const state = pluginState(cfg)
  const errors = new Map<BoardSlot, unknown>()
  const t0 = performance.now()
  const server = await compileServer(cfg, state, { verbose: opts.verbose })
  try { await compileSlots(server, cfg, state.slots, errors) } finally { await server.close() }
  const s = state.slots[0]
  if (!s.compiled) {
    const t = errorText(errors.get(s), opts.verbose, cfg.root)
    console.error(`${s.entry.rel}  compile error: ${t.line}`)
    for (const l of t.detail) console.error(`  ${l}`)
    return 1
  }
  console.error(`compiled  ${s.entry.rel}  ${secs(performance.now() - t0)}`)
  const c = pickTarget(s.compiled, opts.target)
  if (typeof c === 'string') { console.error(`pcbjs: ${c}`); return 1 }
  return print(inspectMany(c.board, relative(cfg.root, c.entry.file) || c.entry.rel, cfg.root, requests))
}

/** The compiled target a --target names, the first without one; a message when none matches. */
export function pickTarget<C extends { board: Board }>(compiled: C[], want?: string): C | string {
  const c = want ? compiled.find(c => c.board.variant && (c.board.variant.name === want || variantSlug(c.board.variant.name) === want)) : compiled[0]
  return c ?? `no target ${want}; targets: ${compiled.map(c => c.board.variant?.name).join(', ')}`
}
