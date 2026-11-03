// The reference grammar every surface names things with, see docs/refs.md: a slash path of tree names and typed `kind:value` segments.
import type { Board, DrcMarker, Footprint, Item, Net, PairInfo, Pad, Poly, Pt, RouteRecord, Via, Zone } from './model.js'
import type { SiteData, SiteFootprint, SiteItem } from './site-data.js'
import { sha1 } from './sha1.js'

export const REF_KINDS = ['board', 'net', 'route', 'leg', 'pt', 'pair', 'drc', 'erc', 'item', 'span', 'plane', 'region', 'panel'] as const
export type RefKind = (typeof REF_KINDS)[number]
/** One segment: a typed `kind:value`, or a tree name with `kind` null. */
export interface Seg {
  kind: RefKind | null
  value: string
}

export class RefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefError'
  }
}

const NAME = /^[A-Za-z0-9_.+-]+$/
const LAYER = /^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*$/
const NET = /^[^\s/]+(?:\/[^\s/]+)*$/
const VALUE: Record<RefKind, RegExp> = {
  board: NAME,
  net: NET,
  route: NAME,
  leg: /^[1-9]\d*$/,
  pt: /^(?:0|[1-9]\d*)$/,
  pair: /^[1-9]\d*$/,
  drc: /^[A-Za-z0-9_.-]+:[0-9a-f]{12}$/,
  erc: /^[A-Za-z0-9_.-]+:[0-9a-f]{12}$/,
  item: /^[0-9a-f]{12}(?:~(?:[2-9]|[1-9]\d+))?$/,
  span: /^[A-Za-z0-9_+.-]+$/,
  plane: /^[A-Za-z0-9_+.-]+:[^\s/]+(?:\/[^\s/]+)*$/,
  region: /^[0-9a-f]+$/,
  panel: NAME,
}
/** The kinds a segment may follow; absent kinds start a reference. */
const UNDER: Partial<Record<RefKind, RefKind[]>> = { leg: ['route'], pt: ['route'], region: ['plane'] }
/** Kinds whose value takes the untyped segments after it, as a net named `P1/CC1`. */
const SLASHED = new Set<RefKind>(['net', 'plane'])

const isKind = (k: string): k is RefKind => (REF_KINDS as readonly string[]).includes(k)

function typed(text: string): Seg | null {
  const c = text.indexOf(':')
  if (c <= 0) return null
  const kind = text.slice(0, c)
  return isKind(kind) ? { kind, value: text.slice(c + 1) } : null
}

/** A reference's segments; a RefError names what is wrong. */
export function parseRef(text: string): Seg[] {
  if (typeof text !== 'string' || !text) throw new RefError('a reference is not empty')
  const parts = text.split('/')
  const out: Seg[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) throw new RefError(`${JSON.stringify(text)}: an empty segment`)
    const t = typed(p)
    const last = out[out.length - 1]
    if (!t && last?.kind && SLASHED.has(last.kind)) {
      last.value += `/${p}`
      continue
    }
    out.push(t ?? { kind: null, value: p })
  }
  for (const s of out) check(text, s)
  order(text, out)
  return out
}

function check(text: string, s: Seg): void {
  if (s.kind === null) {
    if (!NAME.test(s.value)) throw new RefError(`${JSON.stringify(text)}: ${JSON.stringify(s.value)} is no name; a name is letters, digits and _ - . +`)
    return
  }
  if (!VALUE[s.kind].test(s.value)) throw new RefError(`${JSON.stringify(text)}: ${s.kind}:${s.value} is not a ${s.kind} reference, ${EXAMPLE[s.kind]}`)
  if (s.kind === 'span' && !spanLayers(s.value)) throw new RefError(`${JSON.stringify(text)}: span:${s.value} names no layer pair, ${EXAMPLE.span}`)
  if (s.kind === 'plane' && !LAYER.test(s.value.slice(0, s.value.indexOf(':')))) throw new RefError(`${JSON.stringify(text)}: plane:${s.value} names no layer, ${EXAMPLE.plane}`)
}

const EXAMPLE: Record<RefKind, string> = {
  board: 'such as board:Blinky',
  net: 'such as net:VCC',
  route: 'such as route:3 or route:vccTrunk',
  leg: '1-based, such as route:3/leg:2',
  pt: 'such as route:3/pt:0 for the start',
  pair: 'such as pair:1',
  drc: 'such as drc:clearance:0123456789ab',
  erc: 'such as erc:single-pin-net:0123456789ab',
  item: 'such as item:0123456789ab or item:0123456789ab~2',
  span: 'such as span:F.Cu..In2.Cu',
  plane: 'such as plane:In1.Cu:GND',
  region: 'such as plane:In1.Cu:GND/region:0123456789ab',
  panel: 'such as panel:Main/B3/U1',
}

/** The two layers of a `span:` value, null when it is not `<layer>..<layer>`. */
export function spanLayers(value: string): [string, string] | null {
  const k = value.indexOf('..')
  if (k <= 0) return null
  const a = value.slice(0, k),
    b = value.slice(k + 2)
  return LAYER.test(a) && LAYER.test(b) ? [a, b] : null
}

// board first; a tree path, or one typed head with what may sit under it; a panel takes a tree path after it
function order(text: string, segs: Seg[]): void {
  const bad = (why: string): never => {
    throw new RefError(`${JSON.stringify(text)}: ${why}`)
  }
  let i = segs[0].kind === 'board' ? 1 : 0
  if (segs.slice(i).some(s => s.kind === 'board')) bad('board: comes first')
  if (i === segs.length) return
  let head = segs[i]
  if (head.kind === null) {
    const t = segs.findIndex((s, k) => k > i && s.kind !== null)
    if (t < 0) return
    if (segs[t].kind !== 'route') bad('a tree path holds no typed segment but a route of an instance, such as CH2/route:vccTrunk')
    head = segs[t]
    i = t
  }
  if (UNDER[head.kind!]) bad(`${head.kind}: sits under ${UNDER[head.kind!]!.join(' or ')}:`)
  const rest = segs.slice(i + 1)
  if (head.kind === 'panel') {
    if (!rest.length || rest.some(s => s.kind !== null)) bad('panel: takes a tree path after it, such as panel:Main/B3/U1')
    return
  }
  if (!rest.length) return
  const next = rest[0]
  const under: RefKind[] = head.kind === 'net' ? ['span'] : head.kind === 'route' ? ['leg', 'pt'] : head.kind === 'plane' ? ['region'] : []
  if (rest.length > 1 || !next.kind || !under.includes(next.kind))
    bad(under.length ? `${head.kind}: takes ${under.map(k => `${k}:`).join(' or ')} under it` : `${head.kind}: takes nothing under it`)
}

export const printRef = (segs: readonly Seg[]): string => segs.map(s => (s.kind ? `${s.kind}:${s.value}` : s.value)).join('/')

/** A pad as references name it: `R201/2`. */
export const padRef = (ref: string, num: string): string => `${ref}/${num}`

/** The rows a resolver reads, of a compiled board or of its joined facets; each side keeps its own row types. */
export interface RefRows {
  part: unknown
  pad: { num: string; name: string }
  net: unknown
  route: { id: string; pts?: readonly Pt[]; legs?: readonly { from: Pt; to: Pt }[] }
  pair: unknown
  item: unknown
  via: { layers: readonly string[]; net?: string }
  zone: { layer: string; net?: string; fill?: readonly Poly[] }
  finding: unknown
}
/** A compiled board's rows: the model objects themselves. */
export interface BoardRows extends RefRows {
  part: Footprint
  pad: Pad
  net: Net
  route: RouteRecord
  pair: PairInfo
  item: Item
  via: Via
  zone: Zone
  finding: DrcMarker
}

/** What references resolve against: one board's parts with their tree paths and pads, groups, nets, routes, pairs, items by uid, vias, pours and findings by id. */
export interface RefIndex<R extends RefRows = BoardRows> {
  board: string
  /** every part's full tree path, outermost first */
  parts: { ref: string; path: string[]; part: R['part']; pads: R['pad'][] }[]
  /** every named `<g>` and circuit instance with the refs of the parts under it */
  groups: { path: string[]; parts: string[] }[]
  nets: Map<string, R['net']>
  routes: R['route'][]
  pairs: Map<string, R['pair']>
  items: Map<string, R['item']>
  vias: R['via'][]
  zones: R['zone'][]
  findings: Map<string, R['finding']>
}

/** What a reference names on one board. */
export type Resolved<R extends RefRows = BoardRows> =
  | { kind: 'part'; ref: string; path: string; footprint: R['part'] }
  | { kind: 'pad'; ref: string; pad: R['pad'] }
  | { kind: 'group'; path: string; parts: string[] }
  | { kind: 'net'; net: R['net'] }
  | { kind: 'route'; route: R['route'] }
  | { kind: 'leg'; route: R['route']; leg: number; from: Pt; to: Pt }
  | { kind: 'pt'; route: R['route']; pt: number; at: Pt }
  | { kind: 'pair'; pair: R['pair'] }
  | { kind: 'item'; item: R['item'] }
  | { kind: 'finding'; finding: R['finding']; check: 'drc' | 'erc' }
  | { kind: 'span'; layers: [string, string]; net?: string; vias: R['via'][] }
  | { kind: 'plane'; layer: string; net: string; zones: R['zone'][] }
  | { kind: 'region'; layer: string; net: string; zone: R['zone']; fill: Poly }

type Sch = { parts: readonly { ref: string; path?: string[]; local?: string }[]; circuits: readonly { path: string[] }[] }

/** Each part's tree path, its instance path and local name else its ref, and each group with the parts under it. */
export function partTree(refs: readonly string[], sch: Sch | undefined): Pick<RefIndex, 'groups'> & { parts: { ref: string; path: string[] }[] } {
  const by = new Map((sch?.parts ?? []).map(p => [p.ref, p]))
  const parts = refs.map(ref => {
    const p = by.get(ref)
    return { ref, path: p?.path?.length ? [...p.path, p.local ?? ref] : [ref] }
  })
  const groups = (sch?.circuits ?? []).map(c => ({
    path: c.path,
    parts: parts.filter(p => p.path.length > c.path.length && c.path.every((x, i) => p.path[i] === x)).map(p => p.ref),
  }))
  return { parts, groups }
}

/** The index of a compiled board; built per call, since the pipeline replaces a board's items between calls. */
export function boardIndex(b: Board): RefIndex {
  const byId = new Map(b.items.map(it => [it.id, it]))
  const fps = new Map(b.footprints.map(f => [f.ref, f]))
  const tree = partTree(
    b.footprints.map(f => f.ref),
    b.schematic,
  )
  const padsOf = (f: Footprint) => f.pads.map(id => byId.get(id)).filter((x): x is Pad => x?.kind === 'pad')
  return {
    board: b.name,
    parts: tree.parts.map(p => ({ ...p, part: fps.get(p.ref)!, pads: padsOf(fps.get(p.ref)!) })),
    groups: tree.groups,
    nets: new Map(b.nets.map(n => [n.name, n])),
    routes: b.routes ?? [],
    pairs: new Map((b.pairs ?? []).map(p => [p.id, p])),
    items: new Map(b.items.flatMap(it => (it.uid ? [[it.uid, it] as const] : []))),
    vias: b.items.filter((it): it is Via => it.kind === 'via'),
    zones: b.items.filter((it): it is Zone => it.kind === 'zone'),
    findings: new Map([...b.drc, ...b.erc].flatMap(m => (m.id ? [[m.id, m] as const] : []))),
  }
}

const endsWith = (path: string[], tail: string[]) => tail.length <= path.length && tail.every((x, i) => path[path.length - tail.length + i] === x)
const several = (what: string, paths: string[]): never => {
  throw new RefError(`${what} names several: ${paths.join(', ')}`)
}

/** What `text` names on the board an index holds; a RefError when nothing or several things match, listing each full path. */
export function resolveRef<R extends RefRows>(ix: RefIndex<R>, text: string): Resolved<R> {
  const segs = parseRef(text)
  let i = 0
  if (segs[0].kind === 'board') {
    if (segs[0].value !== ix.board) throw new RefError(`${text}: names board ${segs[0].value}, this is ${ix.board}`)
    i = 1
  }
  const rest = segs.slice(i)
  if (!rest.length) throw new RefError(`${text}: names the board only`)
  const head = rest[0]
  const at = rest.findIndex(s => s.kind === 'route')
  if (head.kind === null && at > 0) return routeRef<R>(instanceRoute(ix, rest.slice(0, at + 1), text), rest[at + 1], text)
  if (head.kind === null)
    return treeRef(
      ix,
      rest.map(s => s.value),
      text,
    )
  const sub = rest[1]
  switch (head.kind) {
    case 'net': {
      const net = ix.nets.get(head.value) ?? missing(text, `no net ${head.value}`)
      return sub ? span(ix, sub.value, head.value) : { kind: 'net', net }
    }
    case 'route': {
      const id = `route:${head.value}`
      const own = ix.routes.find(r => r.id === id)
      if (own || /^\d+$/.test(head.value)) return routeRef<R>(own ?? missing(text, `no ${id}, or it is bound and answers to its name`), sub, text)
      return routeRef<R>(instanceRoute(ix, [head], text), sub, text)
    }
    case 'pair': {
      const pair = ix.pairs.get(`pair:${head.value}`) ?? missing(text, `no pair:${head.value}`)
      return { kind: 'pair', pair }
    }
    case 'drc':
    case 'erc': {
      const id = `${head.kind}:${head.value}`
      const finding = ix.findings.get(id) ?? missing(text, `no finding ${id} in this compile`)
      return { kind: 'finding', finding, check: head.kind }
    }
    case 'item': {
      const uid = `item:${head.value}`
      const item = ix.items.get(uid) ?? missing(text, `no ${uid}`)
      return { kind: 'item', item }
    }
    case 'span':
      return span(ix, head.value)
    case 'plane':
      return plane(ix, head.value, sub?.value, text)
    case 'panel':
      throw new RefError(`${text}: this board is no panel`)
  }
  throw new RefError(`${text}: ${head.kind}: starts no reference`)
}

/** A route, or a leg or point of it. */
function routeRef<R extends RefRows>(route: R['route'], sub: Seg | undefined, text: string): Resolved<R> {
  if (!sub) return { kind: 'route', route }
  const k = Number(sub.value)
  if (sub.kind === 'leg') {
    const leg = route.legs?.[k - 1] ?? missing(text, `${route.id} has ${route.legs?.length ?? 0} automatic leg${route.legs?.length === 1 ? '' : 's'}`)
    return { kind: 'leg', route, leg: k, from: leg.from, to: leg.to }
  }
  const at = route.pts?.[k] ?? missing(text, `${route.id} has points pt:0 to pt:${Math.max(0, (route.pts?.length ?? 1) - 1)}`)
  return { kind: 'pt', route, pt: k, at }
}

/** A route of a circuit instance by any unique tail of its path, `CH2/route:vccTrunk`. */
function instanceRoute<R extends RefRows>(ix: RefIndex<R>, segs: Seg[], text: string): R['route'] {
  const tail = printRef(segs)
  const hits = ix.routes.filter(r => r.id === tail || r.id.endsWith(`/${tail}`))
  if (hits.length > 1)
    several(
      text,
      hits.map(r => r.id),
    )
  return hits[0] ?? missing(text, `no route ${tail}; a route of an instance is one its build returns, placed by its layout`)
}

const missing = (text: string, why: string): never => {
  throw new RefError(`${text}: ${why}`)
}

/** A tree path: a part, a named `<g>` or instance, or a pad of a part by number then pin name. */
function treeRef<R extends RefRows>(ix: RefIndex<R>, names: string[], text: string): Resolved<R> {
  const part = (p: RefIndex<R>['parts'][number]): Resolved<R> => ({ kind: 'part', ref: p.ref, path: p.path.join('/'), footprint: p.part })
  if (names.length === 1) {
    const s = names[0]
    const own = ix.parts.find(p => p.ref === s)
    if (own) return part(own)
    const gs = ix.groups.filter(g => g.path[g.path.length - 1] === s)
    if (gs.length > 1)
      several(
        text,
        gs.map(g => g.path.join('/')),
      )
    if (gs.length) return { kind: 'group', path: gs[0].path.join('/'), parts: gs[0].parts }
    const locals = ix.parts.filter(p => p.path.length > 1 && p.path[p.path.length - 1] === s)
    if (locals.length > 1)
      several(
        text,
        locals.map(p => p.path.join('/')),
      )
    if (locals.length) return part(locals[0])
    return missing(text, `no part, group or instance named ${s}`)
  }
  const ps = ix.parts.filter(p => endsWith(p.path, names))
  const gs = ix.groups.filter(g => endsWith(g.path, names))
  if (ps.length + gs.length > 1) several(text, [...ps.map(p => p.path.join('/')), ...gs.map(g => g.path.join('/'))])
  if (ps.length) return part(ps[0])
  if (gs.length) return { kind: 'group', path: gs[0].path.join('/'), parts: gs[0].parts }
  const owner = treeRef(ix, names.slice(0, -1), names.slice(0, -1).join('/'))
  if (owner.kind !== 'part') return missing(text, `${names.slice(0, -1).join('/')} is no part; a pad sits under a part`)
  const pin = names[names.length - 1]
  const pads = ix.parts.find(p => p.ref === owner.ref)!.pads
  const pad = pads.find(p => p.num === pin) ?? pads.find(p => p.name === pin)
  if (!pad) return missing(text, `${owner.ref} has no pad ${pin}; pads ${pads.map(p => (p.name && p.name !== p.num ? `${p.num} ${p.name}` : p.num)).join(', ')}`)
  return { kind: 'pad', ref: owner.ref, pad }
}

function span<R extends RefRows>(ix: RefIndex<R>, value: string, net?: string): Resolved<R> {
  const layers = spanLayers(value)!
  const key = [...layers].sort().join()
  const ends = (v: R['via']) => [v.layers[0], v.layers[v.layers.length - 1]].sort().join()
  const vias = ix.vias.filter(v => ends(v) === key && (net === undefined || v.net === net))
  return { kind: 'span', layers, ...(net !== undefined ? { net } : {}), vias }
}

function plane<R extends RefRows>(ix: RefIndex<R>, value: string, region: string | undefined, text: string): Resolved<R> {
  const c = value.indexOf(':')
  const layer = value.slice(0, c),
    net = value.slice(c + 1)
  const zones = ix.zones.filter(z => z.layer === layer && z.net === net)
  if (!zones.length) return missing(text, `no pour of ${net} on ${layer}`)
  if (region === undefined) return { kind: 'plane', layer, net, zones }
  for (const zone of zones) for (const fill of zone.fill ?? []) if (regionHash(fill).startsWith(region)) return { kind: 'region', layer, net, zone, fill }
  return missing(text, `no fill piece ${region} of ${net} on ${layer}`)
}

/** 12 hex over a fill piece's outer ring to 1 µm, FNV-1a, so the viewer and Node agree. */
export function regionHash(p: Poly): string {
  const text = p.outer.map(q => `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`).join(';')
  let a = 0x811c9dc5,
    b = 0x9747b28c
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0').slice(0, 4)
}

/** How a finding names an item: a pad `R201/2`, an unnumbered one its part, a bound route's copper `route:vccTrunk`, other copper `net:<name>`, a part's drawing its ref, else its uid. */
export function itemRef(it: Item): string | undefined {
  if (it.kind === 'pad' && it.ref !== undefined) return it.num ? padRef(it.ref, it.num) : it.ref
  const route = it.kind === 'track' || it.kind === 'via' ? it.route : undefined
  if (route && !/^route:\d+$/.test(route)) return route
  if (it.net) return `net:${it.net}`
  if (it.ref !== undefined) return it.ref
  return it.uid
}

/** A site's route as references read it: its info, else the id and net its copper carries, with the legs its chain's `X` calls span. */
export interface SiteRoute {
  id: string
  net: string
  pair?: string
  /** the instance whose layout made it */
  path?: string
  pts?: Pt[]
  legs?: { from: Pt; to: Pt }[]
}
/** A site's rows: what the joined facets hold. */
export interface SiteRows extends RefRows {
  part: SiteFootprint
  pad: SiteFootprint['pads'][number]
  net: string
  route: SiteRoute
  pair: { id: string; net: string }
  item: SiteItem
  via: SiteItem
  zone: { layer: string; net?: string; item: SiteItem }
  finding: SiteData['drc'][number]
}
/** The facets a site index reads: meta and findings, with the layers' items and routes when they came. */
export type RefSite = Pick<SiteData, 'name' | 'footprints' | 'nets' | 'drc' | 'erc' | 'schematic'> & Partial<Pick<SiteData, 'items' | 'routes' | 'edit'>>

/** The automatic legs of a chain: the span of each `X` call between the points it joins. */
function chainLegs(pts: readonly Pt[] | undefined, steps: readonly { op: string }[] | undefined): { from: Pt; to: Pt }[] | undefined {
  if (!pts || !steps) return undefined
  const legs = steps.flatMap((s, j) => (s.op === 'X' && pts[j] && pts[j + 1] ? [{ from: pts[j], to: pts[j + 1] }] : []))
  return legs.length ? legs : undefined
}

const sites = new WeakMap<object, RefIndex<SiteRows>>()
/** The index of a board's joined facets, kept per site object, which a facet arrival replaces. */
export function siteIndex(site: RefSite): RefIndex<SiteRows> {
  let ix = sites.get(site)
  if (ix) return ix
  const items = site.items ?? []
  const fps = new Map(site.footprints.map(f => [f.ref, f]))
  const tree = partTree(
    site.footprints.map(f => f.ref),
    site.schematic,
  )
  const steps = new Map((site.edit ?? []).map(e => [e.ref, e.steps]))
  const routes = new Map<string, SiteRoute>()
  for (const r of site.routes ?? []) {
    const legs = chainLegs(r.pts, steps.get(r.id))
    routes.set(r.id, {
      id: r.id,
      net: r.net,
      ...(r.pair ? { pair: r.pair } : {}),
      ...(r.path ? { path: r.path } : {}),
      ...(r.pts ? { pts: r.pts } : {}),
      ...(legs ? { legs } : {}),
    })
  }
  for (const it of items) if (it.route && it.net !== undefined && !routes.has(it.route)) routes.set(it.route, { id: it.route, net: it.net })
  const pairs = new Map([...routes.values()].flatMap(r => (r.pair ? [[r.pair, { id: r.pair, net: r.net }] as const] : [])))
  ix = {
    board: site.name,
    parts: tree.parts.map(p => ({ ...p, part: fps.get(p.ref)!, pads: fps.get(p.ref)!.pads })),
    groups: tree.groups,
    nets: new Map(site.nets.map(n => [n, n])),
    routes: [...routes.values()],
    pairs,
    items: new Map(items.flatMap(it => (it.uid ? [[it.uid, it] as const] : []))),
    vias: items.filter(it => it.kind === 'via'),
    zones: items.flatMap(it => (it.kind === 'zone' ? [{ layer: it.layers[0], ...(it.net !== undefined ? { net: it.net } : {}), item: it }] : [])),
    findings: new Map([...site.drc, ...site.erc].flatMap(m => (m.id ? [[m.id, m] as const] : []))),
  }
  sites.set(site, ix)
  return ix
}

/** The net a reference names by itself, `VCC` of `net:VCC`; null for any other reference, or a text that is none. */
export function refNet(text: string): string | null {
  const segs = tryParse(text)
  return segs?.length === 1 && segs[0].kind === 'net' ? segs[0].value : null
}

/** The route a reference names or holds a leg or point of, `route:3` of `route:3/leg:2`, `CH2/route:vccTrunk` of its `pt:1`; null for anything else. */
export function refRoute(text: string): string | null {
  const segs = tryParse(text)
  const at = segs ? segs.findIndex(s => s.kind === 'route') : -1
  return segs && at >= 0 ? printRef(segs.slice(segs[0].kind === 'board' ? 1 : 0, at + 1)) : null
}

/** Whether a reference is a tree path alone, a part, group, instance or pad, with no typed segment. */
export const isTreeRef = (text: string): boolean => !!tryParse(text)?.every(s => s.kind === null)

function tryParse(text: string): Seg[] | null {
  try {
    return parseRef(text)
  } catch {
    return null
  }
}

/** 1 nm in mm units. */
const nm = (v: number) => Math.round(v * 1e6)
const pts = (r: readonly Pt[]) => r.map(p => [nm(p[0]), nm(p[1])])

function geometry(it: Item): unknown {
  switch (it.kind) {
    case 'track':
      return [pts(it.pts), nm(it.width)]
    case 'via':
      return [pts([it.at]), nm(it.drill), nm(it.size)]
    case 'pad':
      return [it.num, pts(it.poly)]
    case 'zone':
      return [it.outline.map(pts), it.priority]
    case 'graphic':
      return [it.paths.map(pts), nm(it.width), it.fill]
    case 'text':
      return [it.text, pts([it.at]), nm(it.rot), nm(it.size)]
  }
}

/** What an item is now: 12 hex over its kind, layers, net and geometry to 1 nm, a pour's declared outline and never its fill. Its uid says who made it, its rev whether it changed. */
export const itemRev = (it: Item): string =>
  sha1(JSON.stringify([it.kind, it.kind === 'via' || it.kind === 'pad' ? it.layers : [it.layer], it.net ?? null, geometry(it)])).slice(0, 12)
