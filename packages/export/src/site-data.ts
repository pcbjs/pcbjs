import type { Board, Footprint, Pad, Pt, SchematicExport, Track } from '@pcbjs/core/model'
import type { Src } from '@pcbjs/core'
import type { RouteInfo, SiteData, SiteFootprint, SiteItem, SourceIndex, SourceRange } from '@pcbjs/core/site-data'
import { holesMarkup, layerMarkup, viewBox } from './svg.js'
import { bbox as ringsBbox, pointInRing } from '@pcbjs/compile/geom'
import { siteItems } from './items.js'
import { siteModel } from './models.js'
import { routesCopper, type RouteCopper } from '@pcbjs/compile/pair-info'
import { bareHole } from '@pcbjs/compile/bare'
import { referenceLayer, referenceMarkup, siteReferences } from './reference.js'
import { SCH_THEMES, schematicMarkup, schematicStyle } from './sch-svg.js'

export type * from '@pcbjs/core/site-data'

function defOf(fp: Footprint, rel: (p: string) => string, abs: (p: string) => string): { def?: SiteFootprint['def'] } {
  const d = [...(fp.chain ?? [])].reverse().find(ranged)
  if (!d || (fp.src && d.file === fp.src.file && d.line === fp.src.line && d.col === fp.src.col)) return {}
  return { def: { file: rel(d.file), line: d.line, col: d.col, endLine: d.endLine!, endCol: d.endCol!, abs: abs(d.file) } }
}

const exported = (e: SchematicExport | undefined, rel: (p: string) => string) => (e ? { export: { name: e.name, ...(e.module ? { module: rel(e.module) } : {}) } } : {})

export function siteData(board: Board, opts: { root: string; fabUrl: string; fabName: string; fabFiles: string[]; fabStatus: string; svgUrl: string; dev: boolean; bom: SiteData['bom'] }): SiteData {
  const rel = (p: string) => (p.startsWith(opts.root) ? p.slice(opts.root.length).replace(/^[\\/]/, '') : p)
  // the transform gives paths relative to the root, jsxDEV absolute ones
  const abs = (p: string) => (/^([\\/]|[A-Za-z]:)/.test(p) ? p : `${opts.root.replace(/[\\/]$/, '')}/${p}`)
  const sources = sourceIndex(board, rel)
  return {
    name: board.name, title: board.title, revision: board.revision, copper: board.copper, thickness: board.thickness, rules: board.rules, stackup: board.stackup,
    viewBox: viewBox(board), bbox: board.bbox,
    layers: [...[...board.layers].sort((a, b) => a.order - b.order).map(l => ({ id: l.id, name: l.name, kind: l.kind, side: l.side, color: l.color, order: l.order, svg: layerMarkup(board, l.id) + referenceMarkup(board, l.id) })), ...referenceLayer(board)],
    holes: holesMarkup(board),
    outline: [...board.outline].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a))).map(r => r.map(([x, y]) => [round(x), round(y)] as [number, number])),
    drills: board.items.flatMap(it => it.kind === 'via' ? [{ x: round(it.at[0]), y: round(it.at[1]), d: it.drill }]
      : it.kind === 'pad' && it.drill ? [padDrill(it)] : []),
    nets: board.nets.map(n => n.name),
    footprints: board.footprints.map(fp => ({
      ref: fp.ref, value: fp.value, id: fp.id, at: fp.at, rot: Math.round(fp.rot * 100) / 100, side: fp.side, bom: fp.bom, fields: fp.fields, description: fp.description,
      src: fp.src ? { file: rel(fp.src.file), line: fp.src.line, col: fp.src.col, ...ranged(fp.src) ? { endLine: fp.src.endLine, endCol: fp.src.endCol } : {}, abs: abs(fp.src.file) } : undefined,
      ...defOf(fp, rel, abs),
      body: bodyBox(board, fp), bbox: footprintBbox(board, fp), height: fp.height ?? (bareHole(board, fp) ? 0 : 1), ...siteModel(fp.model, rel),
      pads: fp.pads.map(id => board.items[id - 1]).filter(it => it && it.kind === 'pad').map(it => it.kind === 'pad' ? { num: it.num, name: it.name, net: it.net, at: it.at } : null!).filter(Boolean),
    })),
    drc: board.drc, erc: board.erc,
    schematic: {
      parts: board.schematic.parts.map(p => ({ ...p, path: [...(p.path ?? [])], local: p.local ?? p.ref, pins: p.pins.map(q => ({ ...q })), src: p.src ? { file: rel(p.src.file), line: p.src.line, col: p.src.col } : undefined, ...exported(p.export, rel) })),
      nets: board.schematic.nets.map(n => ({ ...n, pins: [...n.pins], ...(n.path ? { path: [...n.path] } : {}), ...exported(n.export, rel) })),
      circuits: (board.schematic.circuits ?? []).map(c => ({ ...c, path: [...c.path], parts: [...c.parts], children: [...c.children] })),
      ...(board.schematic.drawing ? { drawing: schDrawing(board.schematic.drawing, rel), svg: { markup: schematicMarkup(board.schematic.drawing, board), style: schematicStyle(), themes: structuredClone(SCH_THEMES) } } : {}),
    },
    ratsnest: board.ratsnest, unconnected: board.unconnected, stats: board.stats, bom: opts.bom, sourcingTags: [...(board.sourcingTags ?? [])],
    fab: { url: opts.fabUrl, name: opts.fabName, files: opts.fabFiles, status: opts.fabStatus }, svgUrl: opts.svgUrl,
    generatedAt: new Date().toISOString(), dev: opts.dev,
    ...(board.variant ? { variant: { ...board.variant, names: [...board.variant.names] } } : {}),
    ...(Object.keys(sources).length ? { sources } : {}),
    items: withPairs(board, siteItems(board)),
    ...(board.keepouts?.length ? { keepouts: board.keepouts.map(k => ({
      layers: [...k.layers], outline: k.outline.map(r => r.map(([x, y]) => [round(x), round(y)] as [number, number])), tracks: k.tracks, vias: k.vias, pours: k.pours, ...(k.ref ? { ref: k.ref } : {}), ...(k.src ? { src: { file: rel(k.src.file), line: k.src.line, col: k.src.col } } : {}),
    })) } : {}),
    ...(board.routing ? { routing: structuredClone(board.routing) } : {}),
    ...siteReferences(board, rel),
    ...routeInfos(board, s => ({ file: rel(s.file), line: s.line, col: s.col, ...(ranged(s) ? { endLine: s.endLine, endCol: s.endCol } : {}) })),
    // not enumerable on the board, so a spread or JSON of it drops them: copied by name
    ...(board.timings ? { timings: { ...board.timings } } : {}),
  }
}

// above this many routes, the site lists only the routes with a target, a group or a pair
const ROUTE_LIMIT = 500

// a match group's target runs from the longest member less the tolerance to the longest, cut by the route's own range
export function routeInfos(board: Board, src: (s: Src) => Src = s => s): { routes?: RouteInfo[] } {
  const recs = board.routes ?? []
  if (!recs.length) return {}
  const copper = routesCopper(board)
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4
  const groups = new Map<string, number[]>()
  for (const r of recs) if (r.group !== undefined && copper.has(r.id)) groups.set(r.group, [...(groups.get(r.group) ?? []), copper.get(r.id)!.length])
  const all = recs.length < ROUTE_LIMIT
  const pathOf = instanceSites(board)
  const pairs = pairGroups(board, copper)
  const out: RouteInfo[] = []
  for (const r of recs) {
    const c = copper.get(r.id)
    if (!c || r.net === undefined || !(all || r.target || r.group !== undefined || r.pair)) continue
    let target: { min: number; max: number } | null = r.target ? { min: r.target.min, max: r.target.max ?? Infinity } : null
    const g = r.group !== undefined ? groups.get(r.group) : undefined
    if (g && g.length > 1) {
      const top = Math.max(...g), lo = top - (r.tolerance ?? 0.1)
      target = target ? { min: Math.max(target.min, lo), max: Math.min(target.max, top) } : { min: lo, max: top }
    }
    if (target && !Number.isFinite(target.max)) target.max = 1e6
    // a route made inside a helper: the innermost call site, as the findings name it
    const call = [...(r.chain ?? [])].reverse().find(x => x.call)
    const path = pathOf(r.chain)
    out.push({
      id: r.id, net: r.net, ...(r.pair ? { pair: r.pair } : {}), ...(c.pair !== undefined && pairs.has(r.net) ? { nets: pairs.get(r.net)! } : {}), length: r4(c.length),
      target: target && { min: r4(target.min), max: r4(target.max) }, ...(r.group !== undefined ? { group: r.group } : {}),
      ...(c.skew !== undefined ? { skew: r4(c.skew) } : {}), ...(r.src ? { src: src(r.src) } : {}),
      ...(call && r.src ? { call: src(call) } : {}), ...(path ? { path } : {}),
    })
  }
  return out.length ? { routes: out } : {}
}

/** Every net of each pair group by net: the nets of the pair routes, joined where they share a net or meet across a series part. */
export function pairGroups(board: Board, copper: Map<string, RouteCopper> = routesCopper(board)): Map<string, string[]> {
  const up = new Map<string, string>()
  const find = (x: string): string => { while (up.get(x) !== x) x = up.get(x)!; return x }
  const join = (a: string, b: string) => up.set(find(a), find(b))
  const ends: Track[] = []
  for (const c of copper.values()) {
    if (c.pair === undefined) continue
    const p = c.tracks.find(t => t.role !== 'N')?.net, n = c.tracks.find(t => t.role === 'N')?.net
    if (!p || !n) continue
    for (const x of [p, n]) if (!up.has(x)) up.set(x, x)
    join(p, n)
    ends.push(...c.tracks)
  }
  const base = new Map([...up.keys()].map(x => [x, find(x)]))
  const byId = new Map(board.items.map(it => [it.id, it] as const))
  for (const fp of board.footprints) {
    const pads = fp.pads.map(id => byId.get(id)).filter((it): it is Pad => it?.kind === 'pad' && !!it.net && base.has(it.net))
    const nets = [...new Set(pads.map(p => p.net!))]
    if (fp.pads.length === 2 && nets.length === 2) { join(nets[0], nets[1]); continue }
    if (nets.length !== 4 || pads.length !== 4) continue
    // a part between two pairs, one net a pad, whose tracks leave it in opposite directions: a choke or a renaming ESD array
    const dir = new Map<string, Pt>()
    for (const pad of pads) for (const t of ends) {
      if (t.net !== pad.net) continue
      for (const [a, b] of [[t.pts[0], t.pts[1]], [t.pts.at(-1)!, t.pts.at(-2)!]]) {
        if (!b || !pointInRing(a, pad.poly)) continue
        const k = base.get(pad.net!)!, d = dir.get(k) ?? [0, 0], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        dir.set(k, [d[0] + (b[0] - a[0]) / l, d[1] + (b[1] - a[1]) / l])
      }
    }
    const [u, v] = [...dir.values()]
    if (dir.size === 2 && u[0] * v[0] + u[1] * v[1] < 0) join(nets[0], nets.find(x => base.get(x) !== base.get(nets[0]))!)
  }
  const out = new Map<string, string[]>()
  for (const x of up.keys()) { const g = out.get(find(x)) ?? []; g.push(x); out.set(find(x), g) }
  return new Map([...up.keys()].map(x => [x, out.get(find(x))!]))
}

// the innermost site of the chain whose parts share one instance names it; a site shared by every instance names none
function instanceSites(board: Board): (chain?: Src[]) => string | undefined {
  const parts = new Map((board.schematic?.parts ?? []).filter(p => p.path?.length).map(p => [p.ref, p.path.join('/')]))
  if (!parts.size) return () => undefined
  const key = (s: Src) => `${s.file}:${s.line}:${s.col}`
  const sites = new Map<string, Set<string>>()
  for (const fp of board.footprints) {
    const p = parts.get(fp.ref)
    if (!p) continue
    for (const s of [fp.src, ...(fp.chain ?? [])]) if (s) { const k = key(s); let set = sites.get(k); if (!set) sites.set(k, (set = new Set())); set.add(p) }
  }
  const common = (paths: Set<string>): string => {
    let acc: string[] | null = null
    for (const p of paths) {
      const ps = p.split('/')
      if (acc === null) { acc = ps; continue }
      let n = 0
      while (n < acc.length && n < ps.length && acc[n] === ps[n]) n++
      acc = acc.slice(0, n)
    }
    return (acc ?? []).join('/')
  }
  return chain => {
    for (const s of [...(chain ?? [])].reverse()) {
      const set = sites.get(key(s))
      const p = set && common(set)
      if (p) return p
    }
    return undefined
  }
}

// copied onto the site items so both views can find a pair's two tracks and show the width
function withPairs(board: Board, items: SiteItem[]): SiteItem[] {
  // by id: the router removes a pair's placeholder copper, so ids are not positions in board.items
  const byId = new Map(board.items.map(t => [t.id, t] as const))
  for (const it of items) {
    if (it.kind !== 'track') continue
    const t = byId.get(it.id)
    if (!t || t.kind !== 'track') continue
    it.width = t.width
    if (t.pair !== undefined) { it.pair = t.pair; if (t.role) it.role = t.role }
  }
  return items
}

const ranged = (s: Src): boolean => s.endLine !== undefined && s.endCol !== undefined

// a start-only position, from jsxDEV without the transform, counts only for what has no range at all
export function sourceIndex(board: Board, rel: (file: string) => string): SourceIndex {
  const byKey = new Map<string, { file: string; range: SourceRange }>()
  const entry = (s: Src): SourceRange => {
    const file = rel(s.file)
    const end: [number, number] = ranged(s) ? [s.endLine!, s.endCol!] : [s.line, s.col]
    const key = `${file}\0${s.line}:${s.col}:${end[0]}:${end[1]}`
    let e = byKey.get(key)
    if (!e) byKey.set(key, e = { file, range: { start: [s.line, s.col], end, ids: [], refs: [] } })
    if (s.seg !== undefined) e.range.seg = s.seg
    return e.range
  }
  const sitesOf = (src: Src | undefined, chain: Src[] | undefined): Src[] => {
    const all = [...(src ? [src] : []), ...(chain ?? [])]
    const withRange = all.filter(ranged)
    return withRange.length ? withRange : all
  }
  for (const it of board.items) for (const s of sitesOf(it.src, it.chain)) {
    const r = entry(s)
    if (r.ids.at(-1) === it.id) continue
    r.ids.push(it.id)
    if (s !== it.src) (r.outer ??= []).push(it.id)
  }
  for (const fp of board.footprints) for (const s of sitesOf(fp.src, fp.chain)) { const r = entry(s); if (r.refs.at(-1) !== fp.ref) r.refs.push(fp.ref) }
  const out: SourceIndex = {}
  for (const { file, range } of byKey.values()) (out[file] ??= []).push(range)
  const cmp = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1]
  for (const ranges of Object.values(out)) {
    ranges.sort((a, b) => cmp(a.start, b.start) || cmp(b.end, a.end))
    for (const r of ranges) { r.ids.sort((a, b) => a - b); r.outer?.sort((a, b) => a - b); r.refs.sort() }
  }
  return out
}

const round = (v: number) => Math.round(v * 1e4) / 1e4

/** The drawing with its source files relative to the root, as the source index has them. */
function schDrawing(d: import('@pcbjs/core/sch-model').SchDrawing, rel: (p: string) => string): import('@pcbjs/core/sch-model').SchDrawing {
  const s = <T extends { src?: Src }>(x: T): T => (x.src ? { ...x, src: { ...x.src, file: rel(x.src.file) } } : { ...x })
  return { ...d, symbols: d.symbols.map(s), wires: d.wires.map(s), labels: d.labels.map(s), sheets: d.sheets.map(s), texts: d.texts.map(s) }
}

/** A pad's drill; a slot's axis is the one the drill file routes along, see excellon. */
function padDrill(p: Pad): SiteData['drills'][number] {
  const [w, h] = p.drill!, hole = { x: round(p.at[0]), y: round(p.at[1]), d: Math.min(w, h) }
  if (w === h) return hole
  return { ...hole, len: Math.max(w, h), a: round(((((w > h ? 0 : 90) - p.rot) % 180) + 180) % 180) }
}

function area(r: Pt[]): number {
  let a = 0
  for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1 }
  return a / 2
}


// in its own frame: the extent of its Fab graphics, else of its pads
function bodyBox(board: Board, fp: Footprint): SiteFootprint['body'] {
  const a = (fp.rot * Math.PI) / 180
  // the footprint's x and y axes on the y-down board, see placement() in compile/geom.ts
  const u: Pt = [Math.cos(a), -Math.sin(a)], v: Pt = [Math.sin(a), Math.cos(a)]
  const fab = fp.side === 'F' ? 'F.Fab' : 'B.Fab'
  let pts: Pt[] = []
  for (const it of board.items) if (it.kind === 'graphic' && it.ref === fp.ref && it.layer === fab) for (const r of it.paths) pts.push(...r)
  if (!pts.length) for (const id of fp.pads) { const it = board.items[id - 1]; if (it?.kind === 'pad') pts.push(...it.poly) }
  if (!pts.length) pts = [fp.at]
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [px, py] of pts) {
    const dx = px - fp.at[0], dy = py - fp.at[1]
    const lx = dx * u[0] + dy * u[1], ly = dx * v[0] + dy * v[1]
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, ly); y1 = Math.max(y1, ly)
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  return { x: round(fp.at[0] + cx * u[0] + cy * v[0]), y: round(fp.at[1] + cx * u[1] + cy * v[1]), w: round(x1 - x0), h: round(y1 - y0), rot: Math.round(fp.rot * 100) / 100 }
}

// its origin when it has no pads or graphics
function footprintBbox(board: Board, fp: Footprint): SiteFootprint['bbox'] {
  const rings: Pt[][] = []
  for (const it of board.items) {
    if (it.ref !== fp.ref) continue
    if (it.kind === 'pad') rings.push(it.poly)
    else if (it.kind === 'graphic') rings.push(...it.paths)
  }
  if (!rings.length) return { x: round(fp.at[0]), y: round(fp.at[1]), w: 0, h: 0 }
  const b = ringsBbox(rings)
  return { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) }
}
