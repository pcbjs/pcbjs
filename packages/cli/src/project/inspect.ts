// What `inspect` prints of a compiled board: positions, routes with their lengths, layers, references and the schematic, as text or JSON.
import type { Board, Item, Pad, Pt, Ring, Via, Zone } from '@pcbjs/core/model'
import { copperLayers, resolveLayer } from '@pcbjs/compile/internal/layers'
import { flagLayer } from '@pcbjs/core/internal/layers'
import { pairsOf } from '@pcbjs/compile/internal/pair-info'
import { polysArea } from '@pcbjs/compile/internal/geom'
import {
  groupRecord,
  itemRecord,
  legRecord,
  netRecord,
  padRecord,
  pairRecord,
  partRecord,
  planeRecord,
  ptRecord,
  recordCtx,
  regionRecord,
  routeRecord,
  sourceRange,
  spanRecord,
  type Ctx,
} from '@pcbjs/compile/internal/records'
import type { ItemRecord, PadRecord, PartRecord, RouteRecord, SourceRange } from '@pcbjs/compile/query'
import { variantSlug } from '@pcbjs/core/internal/variants'
import { BoardIndex, boardFindings, boardLabel, findingLine } from '@pcbjs/export/internal/findings'
import { boardIndex, regionHash, resolveRef, RefError, type Resolved } from '@pcbjs/core/ref'
import type { InspectRequest } from './dev-reuse.js'
import { inspectReferences } from './references.js'
import { inspectSchematic } from './inspect-sch.js'
import { padMask, padPaste } from '@pcbjs/export/internal/pads'
import { netCopper } from '@pcbjs/export/internal/copper-area'
import { MODEL_LABEL, type ModelSource } from '@pcbjs/core/internal/model-source'

type Box = NonNullable<ItemRecord['bbox']>

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const fmtPt = (p: readonly number[]) => `(${f2(p[0])}, ${f2(p[1])})`
const r3 = (v: number) => Math.round(v * 1000) / 1000
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const pt = (p: [number, number]): [number, number] => [r3(p[0]), r3(p[1])]
const srcText = (s: SourceRange | null | undefined) => (s ? `${s.file}:${s.line}:${s.col}` : undefined)
/** A route made inside a helper names the helper's call site first. */
const routeSrc = (r: RouteRecord) => (r.call ? `${srcText(r.call)} via ${srcText(r.source)}` : srcText(r.source))
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`

/** The 95th percentile of the nearest-neighbour distance, null for fewer than two points. */
export function stitchP95(pts: [number, number][]): number | null {
  if (pts.length < 2) return null
  const d = pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map(q => Math.hypot(q[0] - p[0], q[1] - p[1])))).sort((a, b) => a - b)
  return Math.round(d[Math.min(d.length - 1, Math.ceil(0.95 * d.length) - 1)] * 1000) / 1000
}

/** Print columns padded to their widest cell. */
export function table(rows: string[][], indent = '  '): string[] {
  const w: number[] = []
  for (const r of rows)
    r.forEach((c, i) => {
      w[i] = Math.max(w[i] ?? 0, c.length)
    })
  return rows.map(
    r =>
      indent +
      r
        .map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i])))
        .join('  ')
        .trimEnd(),
  )
}

const drillText = ([w, h]: [number, number]) => (w === h ? f2(w) : `${f2(w)} x ${f2(h)} slot`)

export function frameOf(b: Board, entry: string) {
  const bb = b.bbox
  return {
    board: boardLabel(b),
    entry,
    units: 'mm',
    axes: 'x right, y down, rotation counter-clockwise on screen',
    outline: { x: [r3(bb.x), r3(bb.x + bb.w)], y: [r3(bb.y), r3(bb.y + bb.h)], w: r3(bb.w), h: r3(bb.h) },
    copper: copperLayers(b.copper),
    ...(b.variant ? { targets: b.variant.names } : {}),
  }
}

export interface InspectResult {
  text: string[]
  json: unknown
  found: boolean
}

/** As the viewer writes it; `max` null for none. */
const rangeText = (t: { min: number; max: number | null }) => (t.max === null ? `>= ${f2(t.min)}` : Math.abs(t.max - t.min) < 1e-6 ? f2(t.min) : `${f2(t.min)} to ${f2(t.max)}`)

/** A net, a pair id or a net of a pair, or a match group. */
function routeMatch(b: Board, query: string): (r: RouteRecord) => boolean {
  const pairNets = new Map((b.pairs ?? []).map(p => [p.id, p.nets as string[]]))
  return r => r.net === query || r.pair === query || r.group === query || (!!r.pair && !!pairNets.get(r.pair)?.includes(query))
}

/** One board's record context and index, shared by the requests of one compile. */
interface Scope {
  c: Ctx
  ix: BoardIndex
  routes?: RouteRecord[]
}
const scopes = new WeakMap<Board, Scope>()
function scopeOf(b: Board, root: string): Scope {
  const s = scopes.get(b)
  if (s?.c.root === root) return s
  const fresh = { c: recordCtx(b, boardFindings(b, root), root), ix: new BoardIndex(b, root) }
  scopes.set(b, fresh)
  return fresh
}

/** The routes of the length table: those that placed copper or failed, in PCB tree order. */
function routeRows(s: Scope, query?: string): RouteRecord[] {
  const match = query ? routeMatch(s.c.b, query) : null
  s.routes ??= (s.c.b.routes ?? []).map(r => routeRecord(s.c, r)).filter(r => r.net && r.status !== 'unrouted')
  return s.routes.filter(r => !match || match(r))
}

/** Per layer: the fill area in mm², the pieces with the area of each, the islands the last fill removed and the zone ids. */
export function zoneRows(zones: Zone[]) {
  const by = new Map<
    string,
    { layer: string; area: number; pieces: number; fill: { zone: number; area: number }[]; islandsRemoved: { count: number; area: number }; ids: number[]; uids: string[] }
  >()
  for (const z of zones) {
    const row = by.get(z.layer) ?? { layer: z.layer, area: 0, pieces: 0, fill: [], islandsRemoved: { count: 0, area: 0 }, ids: [], uids: [] }
    by.set(z.layer, row)
    for (const p of z.fill) {
      const a = polysArea([p])
      row.area += a
      row.fill.push({ zone: z.id, area: r3(a) })
    }
    row.pieces += z.fill.length
    row.islandsRemoved.count += z.islandsRemoved?.count ?? 0
    row.islandsRemoved.area += z.islandsRemoved?.area ?? 0
    row.ids.push(z.id)
    row.uids.push(z.uid ?? '')
  }
  return [...by.values()].map(r => ({ ...r, area: r3(r.area), islandsRemoved: { count: r.islandsRemoved.count, area: r3(r.islandsRemoved.area) } }))
}

/** `grow` is the half width of a stroke; null for no points. */
function inkBox(lists: readonly (readonly Pt[])[], grow = 0): Box | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const l of lists)
    for (const [x, y] of l) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  return x0 <= x1 ? { x: r4(x0 - grow), y: r4(y0 - grow), w: r4(x1 - x0 + 2 * grow), h: r4(y1 - y0 + 2 * grow) } : null
}
const corners = (bx: Box): Pt[] => [
  [bx.x, bx.y],
  [r4(bx.x + bx.w), r4(bx.y + bx.h)],
]
const boxText = (bx: Box | null) => (bx ? `${fmtPt([bx.x, bx.y])} to ${fmtPt([r4(bx.x + bx.w), r4(bx.y + bx.h)])}  ${f2(bx.w)} x ${f2(bx.h)}` : '-')

function drawingShape(g: ItemRecord): string {
  const paths = g.paths ?? [],
    closed = g.closed ?? []
  const ps = (g.prims ?? []).flat()
  const lines = g.prims ? ps.filter(q => q.kind === 'line').length : paths.reduce((s, r, i) => s + Math.max(0, r.length - 1) + (closed[i] && r.length > 2 ? 1 : 0), 0)
  const arcs = ps.filter(q => q.kind === 'arc').length
  const parts = [lines ? plural(lines, 'line') : '', arcs ? plural(arcs, 'arc') : ''].filter(Boolean)
  return `${parts.join(', ') || 'empty'}${paths.length > 1 ? ` in ${paths.length} paths` : ''}${g.fill ? ' filled' : closed.some(Boolean) ? ' closed' : ''}`
}

/** An item as `--layer` lists it: its record with its ink on the layer, a pad's as its opening there. */
type LayerRow = ItemRecord & { bounds: Box | null; summary: string; rings?: Pt[][] }

const shownKind = (r: ItemRecord) => (r.type === 'graphic' ? 'drawing' : r.type)

function layerRow(r: ItemRecord, rings: Ring[] | null): LayerRow {
  switch (r.type) {
    case 'text':
      return {
        ...r,
        bounds: inkBox([...r.strokes!, ...(r.glyphs ?? []).map(g => g.outer)], r.thickness! / 2),
        summary: r.glyphs ? `${r.glyphs.length} glyph polygons` : `${r.strokes!.length} strokes`,
      }
    case 'graphic':
      return { ...r, bounds: inkBox(r.paths!, r.fill ? 0 : r.width! / 2), summary: drawingShape(r) }
    case 'track':
      return { ...r, bounds: inkBox([r.pts!], r.width! / 2), summary: `width ${f2(r.width!)}, length ${f2(r.length!)}` }
    case 'zone':
      return { ...r, bounds: r.bbox, summary: `fill ${f2(r.area!)} mm² in ${plural(r.pieces!, 'piece')}` }
    case 'pad':
      return {
        ...r,
        bounds: inkBox(rings!),
        summary: `pad ${r.part ?? ''}/${r.num} ${r.shape}${r.drill ? ' drilled' : ''}`,
        rings: rings!.map(x => x.map(q => pt(q as [number, number]))),
      }
    case 'via':
      return { ...r, bounds: inkBox([[r.at!]], (r.size as number) / 2), summary: `via ${f2(r.size as number)} drill ${f2(r.drill as number)}` }
  }
}

/** Text strokes and glyphs, drawings, tracks, pours, pads and vias on one layer, each with its ink bounds. */
export function layerItems(c: Ctx, layer: string): LayerRow[] {
  const { b } = c
  const cu = copperLayers(b.copper)
  const viaOn = (v: Via) => {
    const i = cu.indexOf(v.layers[0]),
      j = cu.indexOf(v.layers[1]),
      k = cu.indexOf(layer)
    return k >= 0 && k >= Math.min(i, j) && k <= Math.max(i, j)
  }
  // mask and paste as the Gerbers draw them, copper on any other layer the pad lists
  const side = /^([FB])\.(Mask|Paste)$/.exec(layer)
  const padRings = (p: Pad): Ring[] | null =>
    side ? (side[2] === 'Mask' ? padMask(p, side[1], b.rules) : padPaste(p, side[1], b.rules)) : p.layers.includes(layer) ? [p.poly] : null
  const rows: LayerRow[] = []
  for (const i of b.items) {
    const rings = i.kind === 'pad' ? padRings(i) : null
    const on = i.kind === 'pad' ? !!rings?.length : i.kind === 'via' ? viaOn(i) : i.layer === layer
    if (on) rows.push(layerRow(itemRecord(c, i), rings))
  }
  return rows
}

function inspectLayer(c: Ctx, ix: BoardIndex, name: string, filter?: string): { text: string[]; json: Record<string, unknown>; found: boolean } {
  const { b } = c
  let layer: string
  try {
    layer = resolveLayer(flagLayer(name) ?? name, false, new Set(b.layers.map(l => l.id)))
  } catch (e) {
    return { text: [(e as Error).message], json: { error: (e as Error).message, layers: b.layers.map(l => l.id) }, found: false }
  }
  const def = b.layers.find(l => l.id === layer)!
  let items = layerItems(c, layer)
  if (filter) {
    const want = filter.toLowerCase()
    items = items.filter(i => (i.part !== undefined && (i.part.toLowerCase() === want || ix.paths.get(i.part)?.toLowerCase() === want)) || i.net?.toLowerCase() === want)
  }
  const count: Record<string, number> = {}
  for (const i of items) count[shownKind(i)] = (count[shownKind(i)] ?? 0) + 1
  const all = inkBox(items.flatMap(i => (i.bounds ? [corners(i.bounds)] : [])))
  const text = [
    `layer ${layer}  ${def.name}${filter ? `  of ${filter}` : ''}  ${plural(items.length, 'item')}${
      items.length
        ? `: ${Object.entries(count)
            .map(([k, n]) => plural(n, k))
            .join(', ')}  bounds ${boxText(all)}`
        : ''
    }`,
  ]
  if (items.length)
    text.push(
      ...table([
        ['item', 'uid', 'kind', 'ref', 'text', 'bounds', 'shape', 'src'],
        ...items.map(i => [
          `#${i.id}`,
          i.ref,
          shownKind(i),
          i.part ?? '-',
          i.text !== undefined ? JSON.stringify(i.text) : '-',
          boxText(i.bounds),
          i.summary,
          srcText(i.source) ?? '-',
        ]),
      ]),
    )
  return { text, json: { layer, name: def.name, kind: def.kind, side: def.side, ...(filter ? { filter } : {}), bounds: all, items }, found: true }
}

const padRows = (pads: PadRecord[], withRef: boolean) =>
  table([
    ['pad', 'name', 'net', 'centre', 'size', 'layers', 'uid'],
    ...pads.map(p => [
      withRef ? `${p.part}/${p.num}` : p.num,
      p.name || '-',
      p.net ?? '-',
      fmtPt(p.at),
      `${f2(p.size[0])} x ${f2(p.size[1])} ${p.shape}${p.drill ? ` drill ${drillText(p.drill)}` : ''}`,
      p.layers.join(' '),
      p.uid,
    ]),
  ])

const shownPath = (p: PartRecord) => (p.path === p.ref ? undefined : p.path)
const SOURCE_OF = Object.fromEntries(Object.entries(MODEL_LABEL).map(([k, v]) => [v, k])) as Record<string, ModelSource>

/** With `lengths` the route table, with `layer` every item on the layer, narrowed to the query's part or net when given. */
export function inspectBoard(b: Board, entry: string, root: string, query?: string, opts: Omit<InspectRequest, 'query'> = {}): InspectResult {
  const s = scopeOf(b, root)
  const { c, ix } = s
  const fr = frameOf(b, entry)
  const text = [
    `${fr.board}  ${entry}  ${fr.units}, ${fr.axes}`,
    `outline  x ${f2(fr.outline.x[0])} to ${f2(fr.outline.x[1])}, y ${f2(fr.outline.y[0])} to ${f2(fr.outline.y[1])}, ${f2(fr.outline.w)} x ${f2(fr.outline.h)}  copper ${fr.copper.join(' ')}${b.variant ? `  target ${b.variant.name} of ${b.variant.names.join(', ')}` : ''}`,
  ]

  if (opts.layer) {
    const r = inspectLayer(c, ix, opts.layer, query)
    text.push(...r.text)
    return { text, json: { frame: fr, ...r.json }, found: r.found }
  }
  if (opts.report === 'references') {
    const r = inspectReferences(b, root)
    return { ...r, text: [...text, ...r.text] }
  }
  if (opts.report === 'sch') {
    const r = inspectSchematic(b, root)
    return { ...r, text: [...text, ...r.text] }
  }
  if (opts.report === 'grids') {
    const grids = (b.grids ?? []).map(g => ({ ...g, src: srcText(sourceRange(g.src, root)) ?? null, attach: srcText(sourceRange(g.attach, root)) ?? null }))
    if (!grids.length) text.push('no grids')
    else
      text.push(
        ...table([
          ['grid', 'pitch', 'minor', 'origin', 'angle', 'frame', 'used', 'src'],
          ...grids.map(g => [
            g.name,
            `${r3(g.pitch)} mm`,
            g.minor.join(' ') || '-',
            `${f2(g.origin[0])} ${f2(g.origin[1])}`,
            `${r3(g.angle)}${g.mirror ? ' mirrored' : ''}`,
            g.frame ?? '-',
            g.used.join(' ') || '-',
            g.src ?? '-',
          ]),
        ]),
      )
    return { text, json: { frame: fr, grids }, found: true }
  }
  if (opts.lengths) {
    const rows = routeRows(s, query)
    if (!rows.length) text.push(query ? `no route of the net, pair or group ${query}` : 'no routes')
    else text.push(...routeTable(rows))
    return { text, json: { frame: fr, routes: rows }, found: rows.length > 0 || !query }
  }
  if (!query) {
    const parts = [...b.footprints].sort((a, x) => a.ref.localeCompare(x.ref, undefined, { numeric: true })).map(fp => partRecord(c, fp))
    text.push(
      ...table([
        ['ref', 'path', 'value', 'at', 'rot', 'side', 'pads', 'model', 'src'],
        ...parts.map(p => [p.ref, shownPath(p) ?? '-', p.value ?? '-', fmtPt(p.at), String(r3(p.rot)), p.side, String(p.pads.length), p.model, srcText(p.source) ?? '-']),
      ]),
    )
    const models = { file: 0, generated: 0, none: 0, missing: 0 } as Record<ModelSource, number>
    for (const p of parts) models[SOURCE_OF[p.model]]++
    text.push(`models  ${models.file} file, ${models.generated} generated, ${models.missing} no model, ${models.none} no body`)
    return { text, json: { frame: fr, parts, models }, found: true }
  }

  type Answer = { text: string[]; json: Record<string, unknown>; found: boolean }
  const records = (items: Item[]) => items.map(i => itemRecord(c, i))
  const asPart = (ref: string): Answer => {
    const p = partRecord(c, c.fps.get(ref)!)
    const path = shownPath(p)
    const text = [
      `${ref}${path ? ` (${path})` : ''}  ${p.value ?? ''}  ${p.footprint}  at ${fmtPt(p.at)}  rot ${r3(p.rot)}  side ${p.side}  model ${p.model}${p.source ? `  ${srcText(p.source)}` : ''}`,
      ...padRows(p.pads, false),
    ]
    const graphics = records(b.items.filter(i => i.kind === 'graphic' && i.ref === ref))
    return { text, json: { frame: fr, part: p, ...(graphics.length ? { graphics } : {}) }, found: true }
  }
  const asNet = (query: string): Answer | null => {
    const text: string[] = []
    const net = b.nets.find(n => n.name === query) ?? b.nets.find(n => n.name.toLowerCase() === query.toLowerCase())
    if (!net) return null
    const mine = (kind: Item['kind']) => b.items.filter(i => i.kind === kind && i.net === net.name)
    const pads = (mine('pad') as Pad[]).map(p => padRecord(c, p))
    const vias = records(mine('via'))
    const tracks = records(mine('track'))
    const zones = mine('zone') as Zone[]
    const pours = zoneRows(zones)
    const copper = netCopper(b, net.name).map(x => ({ layer: x.layer, area: r3(x.area) }))
    const graphics = records(mine('graphic'))
    text.push(
      `net ${net.name}  ${plural(pads.length, 'pad')}, ${plural(vias.length, 'via')}, ${plural(tracks.length, 'track')}, ${plural(zones.length, 'zone')}${zones.length ? ` on ${[...new Set(zones.map(z => z.layer))].join(' ')}` : ''}${copper.length ? `  copper ${copper.map(x => `${x.layer} ${x.area.toFixed(1)} mm²`).join(', ')}` : ''}`,
    )
    if (pads.length) text.push(...padRows(pads, true))
    if (pours.length)
      text.push(
        ...table([
          ['zone', 'fill', 'pieces', 'islands removed', 'zones'],
          ...pours.map(z => [
            z.layer,
            `${f2(z.area)} mm²`,
            String(z.pieces),
            z.islandsRemoved.count ? `${z.islandsRemoved.count}, ${f2(z.islandsRemoved.area)} mm²` : '0',
            z.ids.map((id, i) => `#${id} ${z.uids[i]}`).join(', '),
          ]),
        ]),
      )
    if (vias.length) text.push(...viaTable(vias))
    const stitched = vias.filter(v => v.stitch)
    const stitch = stitched.length ? { count: stitched.length, p95: stitchP95(stitched.map(v => v.at!)) } : null
    if (stitch) text.push(`stitch  ${plural(stitch.count, 'via')}, nearest neighbour 95th percentile ${stitch.p95 === null ? '-' : `${f2(stitch.p95)} mm`}`)
    // a pair's tracks follow in its own table
    const single = tracks.filter(t => t.pair === undefined)
    if (single.length) text.push(...trackTable(single))
    const gaps = b.ratsnest.filter(r => r.net === net.name)
    const failed = b.drc.filter(d => d.rule === 'route-failed' && (d.refs?.includes(`net:${net.name}`) || /nets? (\S+) and (\S+)/.exec(d.message)?.slice(1).includes(net.name)))
    if (gaps.length) text.push(`unconnected  ${plural(gaps.length, 'gap')}: ${gaps.map(g => `${fmtPt(g.from)} to ${fmtPt(g.to)}`).join(', ')}`)
    for (const d of failed) text.push(`route failed  ${d.message}`)
    const pairs = pairsOf(b).filter(p => p.nets.includes(net.name))
    const pairJson = pairs.map(p => {
      const role = p.nets[0] === net.name ? 'P' : 'N',
        partner = p.nets[role === 'P' ? 1 : 0] ?? null
      const width = p.info?.width ?? p.P[0]?.width ?? 0,
        gap = p.info?.gap ?? null
      text.push(
        `pair ${p.id}  ${role} of ${p.nets[0] ?? '?'}/${p.nets[1] ?? '?'}  partner ${partner ?? '-'}  width ${f2(width)}  gap ${gap === null ? '-' : f2(gap)}  length ${p.nets[0] ?? 'P'} ${f2(p.lengthP)} ${p.nets[1] ?? 'N'} ${f2(p.lengthN)} with vias  skew ${f2(Math.abs(p.lengthP - p.lengthN))}${p.info ? ` of ${f2(p.info.skew)}` : ''}${p.info ? `  uncoupled ${f2(p.info.uncoupled)} of ${f2(p.info.maxUncoupled)}` : ''}`,
      )
      const rows = records([...p.P, ...p.N])
      text.push(...table([['track', 'role', 'net', 'layer', 'width', 'length'], ...rows.map(t => [`#${t.id}`, t.role ?? 'P', t.net ?? '-', t.layer, f2(t.width!), f2(t.length!)])]))
      return {
        id: p.id,
        role,
        partner,
        width,
        gap,
        length: { P: r3(p.lengthP), N: r3(p.lengthN) },
        skew: r3(Math.abs(p.lengthP - p.lengthN)),
        ...(p.info ? { allowedSkew: p.info.skew, uncoupled: r3(p.info.uncoupled), allowedUncoupled: p.info.maxUncoupled } : {}),
        tracks: rows,
      }
    })
    const singles = routeRows(s, net.name).filter(r => !r.pair)
    for (const r of singles)
      text.push(
        `route ${r.ref}  length ${f2(r.length)} with vias${r.target ? `  target ${rangeText(r.target)} ${r.status}` : ''}${r.group ? `  group ${r.group}` : ''}${r.tuned ? `  tuned ${f2(r.tuned)}` : ''}${r.source ? `  ${routeSrc(r)}` : ''}`,
      )
    return {
      text,
      json: {
        frame: fr,
        net: netRecord(c, net.name),
        ...(singles.length ? { routes: singles } : {}),
        pads,
        vias,
        tracks,
        ...(graphics.length ? { graphics } : {}),
        copper,
        zones: pours,
        ...(stitch ? { stitch } : {}),
        unconnected: gaps.map(g => ({ from: pt(g.from), to: pt(g.to) })),
        failed: failed.map(d => ({ message: d.message, at: pt(d.at as [number, number]) })),
        ...(pairJson.length ? { pairs: pairJson } : {}),
      },
      found: true,
    }
  }

  const answer = (r: Resolved): Answer => {
    switch (r.kind) {
      case 'part':
        return asPart(r.ref)
      case 'pad': {
        const pad = padRecord(c, r.pad)
        return { text: padRows([pad], true), json: { frame: fr, pad }, found: true }
      }
      case 'group': {
        const parts = r.parts.flatMap(ref => (c.fps.has(ref) ? [partRecord(c, c.fps.get(ref)!)] : []))
        const text = [
          `group ${r.path}  ${plural(parts.length, 'part')}`,
          ...table([['ref', 'path', 'value', 'at', 'side'], ...parts.map(p => [p.ref, shownPath(p) ?? '-', p.value ?? '-', fmtPt(p.at), p.side])]),
        ]
        return { text, json: { frame: fr, group: groupRecord(r.path, r.parts), parts }, found: true }
      }
      case 'net':
        return asNet(r.net.name)!
      case 'route':
        return asRoute(c, fr, r.route)
      case 'leg': {
        const leg = legRecord(r.route.id, r.leg, r.from, r.to)
        return { text: [`${leg.ref}  from ${fmtPt(leg.from)} to ${fmtPt(leg.to)}`], json: { frame: fr, leg }, found: true }
      }
      case 'pt': {
        const p = ptRecord(r.route.id, r.pt, r.at)
        return { text: [`${p.ref}  at ${fmtPt(p.at)}`], json: { frame: fr, pt: p }, found: true }
      }
      case 'pair': {
        const routes = routeRows(s, r.pair.id)
        const p = pairRecord(c, r.pair)
        const text = [
          `pair ${p.ref}  ${p.nets.join('/')}  width ${f2(p.width)}  gap ${f2(p.gap)}  skew allowed ${f2(p.skew)}  uncoupled ${f2(p.uncoupled)} of ${f2(p.maxUncoupled)}`,
          ...routeTable(routes),
        ]
        return { text, json: { frame: fr, pair: p, routes }, found: true }
      }
      case 'item':
        return asItem(fr, itemRecord(c, r.item))
      case 'finding': {
        const f = c.findings.find(x => x.id === r.finding.id)!
        return { text: [`${findingLine(f)}  ${f.id}`, `fingerprint ${f.fingerprint}`], json: { frame: fr, finding: f }, found: true }
      }
      case 'span': {
        const span = spanRecord(query, r.layers, r.vias, r.net)
        const vias = records(r.vias)
        const text = [`span ${r.layers.join('..')}${r.net !== undefined ? ` of ${r.net}` : ''}  ${plural(vias.length, 'via')}`, ...viaTable(vias)]
        return { text, json: { frame: fr, span, vias }, found: true }
      }
      case 'plane': {
        const plane = planeRecord(query, r.layer, r.net, r.zones)
        const z = zoneRows(r.zones)[0]
        const regions = r.zones.flatMap(zone => zone.fill.map(p => regionRecord(`${plane.ref}/region:${regionHash(p)}`, r.layer, r.net, zone, p)))
        const text = [
          `plane ${r.layer}:${r.net}  fill ${f2(z.area)} mm² in ${plural(z.pieces, 'piece')}`,
          ...table([['region', 'zone', 'area'], ...regions.map(x => [x.hash, x.zone ?? '-', `${f2(x.area)} mm²`])]),
        ]
        return { text, json: { frame: fr, plane, zones: zoneRows(r.zones), regions }, found: true }
      }
      case 'region': {
        const g = regionRecord(query, r.layer, r.net, r.zone, r.fill)
        return { text: [`region ${g.hash} of ${g.net} on ${g.layer}  ${f2(g.area)} mm²  zone ${g.zone}  bounds ${boxText(g.bbox)}`], json: { frame: fr, region: g }, found: true }
      }
    }
  }

  let resolved: Resolved | null = null,
    why = ''
  try {
    resolved = resolveRef(boardIndex(b), query)
  } catch (e) {
    if (!(e instanceof RefError)) throw e
    why = e.message
  }
  // a bare name that names no part may be a net; a name both a part and a net prints both
  const bare = !/[:/]/.test(query)
  const net = bare ? (b.nets.find(n => n.name === query) ?? (resolved ? undefined : b.nets.find(n => n.name.toLowerCase() === query.toLowerCase()))) : undefined
  if (resolved?.kind === 'part' && net) {
    const p = answer(resolved),
      nt = asNet(net.name)!
    text.push(`${query} is both a part and a net: both follow; net:${query} asks for the net`, '', ...p.text, '', ...nt.text)
    const { frame: _f, ...rest } = nt.json
    return { text, json: { ...p.json, net: rest }, found: true }
  }
  const one = resolved ? answer(resolved) : net ? asNet(net.name) : null
  if (one) {
    text.push(...one.text)
    return { ...one, text }
  }
  const refs = b.footprints.map(f => f.ref).sort((a, x) => a.localeCompare(x, undefined, { numeric: true }))
  text.push(why || `nothing named ${query}`, `refs: ${refs.join(' ')}`, `nets: ${b.nets.map(n => n.name).join(' ')}`)
  return { text, json: { frame: fr, error: why || `nothing named ${query}`, refs, nets: b.nets.map(n => n.name) }, found: false }
}

/** A route with its points, legs and copper. */
function asRoute(c: Ctx, fr: ReturnType<typeof frameOf>, r: NonNullable<Board['routes']>[number]) {
  const route = routeRecord(c, r)
  const legs = (r.legs ?? []).map((l, i) => legRecord(r.id, i + 1, l.from, l.to))
  const copper = c.b.items.filter(i => (i.kind === 'track' || i.kind === 'via') && i.route === r.id).map(i => itemRecord(c, i))
  const tracks = copper.filter(i => i.type === 'track'),
    vias = copper.filter(i => i.type === 'via')
  const text = [
    ...(route.net && route.status !== 'unrouted' ? routeTable([route]) : []),
    ...(route.points.length ? [`pts  ${route.points.map((q, i) => `pt:${i} ${fmtPt(q.at)}`).join('  ')}`] : []),
    ...legs.map(l => `${l.ref.slice(r.id.length + 1)}  ${fmtPt(l.from)} to ${fmtPt(l.to)}`),
    ...(tracks.length ? trackTable(tracks) : []),
    ...(vias.length ? viaTable(vias) : []),
  ]
  return { text, json: { frame: fr, route, legs, tracks, vias }, found: true }
}

/** One item by uid: its kind, layer, net, part, route and source. */
function asItem(fr: ReturnType<typeof frameOf>, it: ItemRecord) {
  const layers = it.type === 'via' || it.type === 'pad' ? it.layers!.join(' ') : it.layer
  const of = [it.net ? `net ${it.net}` : 'no net', it.part ? `part ${it.part}` : '', it.route ?? ''].filter(Boolean).join('  ')
  const src = srcText(it.source)
  return { text: [`${it.ref}  #${it.id} ${it.type} on ${layers}  ${of}${src ? `  ${src}` : ''}`], json: { frame: fr, item: it }, found: true }
}

function routeTable(rows: RouteRecord[]): string[] {
  if (!rows.length) return []
  return table([
    ['route', 'net', 'pair', 'length', 'target', 'group', 'skew', 'tuned', 'status', 'src'],
    ...rows.map(r => [
      r.ref,
      r.net,
      r.pair ?? '-',
      f2(r.length),
      r.target ? rangeText(r.target) : '-',
      r.group ?? '-',
      r.skew === undefined ? '-' : f2(r.skew),
      r.tuned ? f2(r.tuned) : '-',
      r.status === 'ok' && !r.target ? '-' : r.status,
      routeSrc(r) ?? '-',
    ]),
  ])
}

const trackTable = (ts: ItemRecord[]) =>
  table([
    ['track', 'uid', 'layer', 'width', 'length', 'from', 'to', 'route'],
    ...ts.map(t => [`#${t.id}`, t.ref, t.layer, String(r3(t.width!)), f2(t.length!), fmtPt(t.pts![0]), fmtPt(t.pts![t.pts!.length - 1]), t.route ?? '-']),
  ])
const viaTable = (vs: ItemRecord[]) =>
  table([
    ['via', 'uid', 'centre', 'layers', 'size', 'route'],
    ...vs.map(v => [`#${v.id}`, v.ref, fmtPt(v.at!), v.layers!.join('-'), `${f2(v.size as number)} drill ${f2(v.drill as number)}`, v.route ?? (v.stitch ? 'stitch' : '-')]),
  ])

export function inspectMany(b: Board, entry: string, root: string, requests: InspectRequest[]): InspectResult[] {
  return (requests.length ? requests : [{}]).map(({ query, ...r }) => inspectBoard(b, entry, root, query, r))
}

const requestLabel = (r: InspectRequest) =>
  r.report
    ? `--${r.report}`
    : r.layer
      ? `--layer ${r.layer}${r.query ? ` ${r.query}` : ''}`
      : r.lengths
        ? `--lengths${r.query ? ` ${r.query}` : ''}`
        : (r.query ?? 'every footprint')

/** Several answers share the frame lines, each under a `== <query>` heading. */
export function inspectOutput(results: InspectResult[], requests: InspectRequest[], json: boolean): string[] {
  if (results.length === 1) return json ? [JSON.stringify(results[0].json, null, 2)] : results[0].text
  if (json) {
    const frame = (results[0].json as { frame?: unknown }).frame
    const each = results.map((r, i) => {
      const { frame: _, ...rest } = r.json as Record<string, unknown>
      return { ...requests[i], found: r.found, ...rest }
    })
    return [JSON.stringify({ frame, results: each }, null, 2)]
  }
  const out = results[0].text.slice(0, 2)
  results.forEach((r, i) => out.push('', `== ${requestLabel(requests[i])}`, ...r.text.slice(2)))
  return out
}

/** The compiled target a --target names, the first without one; a message when none matches. */
export function pickTarget<C extends { board: Board }>(compiled: C[], want?: string): C | string {
  const c = want ? compiled.find(c => c.board.variant && (c.board.variant.name === want || variantSlug(c.board.variant.name) === want)) : compiled[0]
  return c ?? `no target ${want}; targets: ${compiled.map(c => c.board.variant?.name).join(', ')}`
}
