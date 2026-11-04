// What the compiled boards say about the code, computed once per set of boards: the boards of a file, its source ranges, routes,
// findings and parts; every capability reads it instead of walking the boards per request.

import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { RouteInfo, SiteData, SiteFootprint, SiteItem, SourceRange } from '@pcbjs/core/site-data'
import type { Position, Range } from '@pcbjs/core/protocol'
import { toRange, toSite } from '@pcbjs/core/internal/textdoc'
import type { BoardRef } from './host.js'
import type { DocModel } from './doc.js'
import type { HintGrid } from './units.js'
import type { SegmentContext } from './segments.js'

/** A DRC or ERC finding at its source, 1-based. */
export interface Marker {
  file: string
  line: number
  col: number
  endLine?: number
  endCol?: number
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
  kind: 'DRC' | 'ERC'
  target?: string
}

/** A board that drew from a file, with the file's key on it and its source ranges there. */
export interface FileBoard {
  ref: BoardRef
  rel: string
  ranges: SourceRange[]
}

/** The innermost source range at a position, the board it is on and that board's ranges of the file. */
export interface RangeHit {
  ref: BoardRef
  range: SourceRange
  ranges: SourceRange[]
}

/** A route whose helper was called in a file, with the offset of its call site in the text. */
export interface CallRoute {
  route: RouteInfo
  at: number
  key: string
}

export interface PartHit {
  fp: SiteFootprint
  site: SiteData
  root: string
}

export interface FileFacts {
  readonly file: string
  /** the boards that drew from the file, with their ranges */
  readonly boards: FileBoard[]
  /** the boards whose root holds the file or that drew from it outside their root; every board when none does */
  readonly all: BoardRef[]
  /** the innermost source range at a position, on the given boards of the file or on all of them */
  rangeAt(p: Position, boards?: FileBoard[]): RangeHit | undefined
  /** the routes whose element starts at a 1-based line and column of the file */
  routesAt(start: [number, number]): RouteInfo[]
  /** the findings at a 1-based line and column of the file */
  findingsAt(start: [number, number]): Marker[]
  /** the findings in the file */
  markers(): Marker[]
  /** the routes whose helper was called in this file, each with its call site in the text */
  callRoutes(doc: DocModel): CallRoute[]
  /** the names of the functions called in this file that made routes: `chain` in `chain(SIG, J1[3], U2.IN)` */
  helpers(doc: DocModel): Set<string>
  /** the routes a helper call around an offset made: those of the innermost call expression that holds a call site */
  routesOfCall(doc: DocModel, offset: number): RouteInfo[]
  /** the footprints the code may mean by a part name, on the file's boards */
  parts(name: string): PartHit[]
  /** the net of the pad a part name and pad number or name reach, one per part the name may mean; undefined when none has the pad */
  padNets(ref: string, pad: string): (string | null)[] | undefined
  /** the grid of the placement whose element starts at a 1-based line and column, on the first board that places it */
  gridAt(line: number, col: number): { project: string; board: string; grid: HintGrid } | null
}

export interface BoardFacts {
  readonly boards: readonly BoardRef[]
  forFile(file: string): FileFacts
  /** the footprints a part name may mean on any board */
  partsNamed(name: string): PartHit[]
  /** every board's findings, each once */
  markers(): Marker[]
}

let last: BoardFacts | null = null

/** The facts of these boards: the same object while every board is the same, shared by every connection of the process. */
export function boardFacts(boards: BoardRef[]): BoardFacts {
  if (last && sameBoards(last.boards, boards)) return last
  return (last = factsOf(boards))
}

const sameBoards = (a: readonly BoardRef[], b: readonly BoardRef[]) => a.length === b.length && a.every((x, i) => x.site === b[i].site && x.root === b[i].root)

function factsOf(boards: BoardRef[]): BoardFacts {
  const files = new Map<string, FileFacts>()
  const named = new Map<string, PartHit[]>()
  let found: Marker[] | null = null
  return {
    boards,
    forFile: file => {
      let f = files.get(file)
      if (!f) files.set(file, (f = fileFacts(boards, file)))
      return f
    },
    partsNamed: name => {
      let p = named.get(name)
      if (!p) named.set(name, (p = partsNamed(boards, name)))
      return p
    },
    markers: () => (found ??= unique(boards.flatMap(markersOf))),
  }
}

function fileFacts(every: BoardRef[], file: string): FileFacts {
  const boards: FileBoard[] = []
  const owners: BoardRef[] = []
  for (const ref of every) {
    const rel = keyOf(ref.root, file)
    if (rel === undefined) continue
    const ranges = ref.site.sources?.[rel]
    const outside = rel.startsWith('../')
    if (!outside || ranges?.length || (ref.site.routes ?? []).some(r => (r.call && sameFile(ref.root, r.call.file, file)) || r.src?.file === rel)) owners.push(ref)
    if (ranges?.length) boards.push({ ref, rel, ranges })
  }
  const all = owners.length ? owners : every
  const calls = new WeakMap<DocModel, CallRoute[]>()
  const named = new Map<string, PartHit[]>()
  let mine: Marker[] | null = null
  const markers = () => (mine ??= unique(all.flatMap(markersOf)).filter(m => sameFile('', m.file, file)))
  const callRoutes = (doc: DocModel) => {
    let c = calls.get(doc)
    if (!c) calls.set(doc, (c = routesCalledIn(all, file, doc)))
    return c
  }
  const parts = (name: string) => {
    let p = named.get(name)
    if (!p) named.set(name, (p = partsNamed(all, name)))
    return p
  }
  return {
    file,
    boards,
    all,
    rangeAt: (p, on = boards) => rangeAt(on, p),
    routesAt: start => routesAt(all, file, start),
    findingsAt: start => markers().filter(m => m.line === start[0] && m.col === start[1]),
    markers,
    callRoutes,
    helpers: doc => {
      const out = new Set<string>()
      for (const c of callRoutes(doc)) {
        const m = /[A-Za-z_$][\w$]*/y
        m.lastIndex = c.at
        const w = m.exec(doc.text)?.[0]
        if (w) out.add(w)
      }
      return out
    },
    routesOfCall: (doc, offset) => {
      const routes = callRoutes(doc)
      if (!routes.length) return []
      const spans = doc
        .callSpans()
        .filter(sp => sp.start <= offset && offset <= sp.end)
        .sort((a, b) => a.end - a.start - (b.end - b.start))
      for (const sp of spans) {
        const rs = routes.filter(r => r.at >= sp.start && r.at < sp.end).map(r => r.route)
        if (rs.length) return rs
      }
      return []
    },
    parts,
    gridAt: (line, col) => gridAt(all, file, line, col),
    padNets: (ref, pad) => {
      const out: (string | null)[] = []
      for (const { fp } of parts(ref)) {
        const p = fp.pads.find(x => x.num === pad) ?? fp.pads.find(x => x.name === pad)
        if (p) out.push(p.net ?? null)
      }
      return out.length ? out : undefined
    },
  }
}

/** What the segments of a file may offer: the layers of its boards, the pads of a named part and the route helpers it calls. */
export function segmentContext(f: FileFacts, doc: DocModel): SegmentContext {
  const sites = f.boards.length ? f.boards.map(b => b.ref) : f.all
  const layers = [...new Set(sites.flatMap(s => s.site.layers.map(l => l.name)))]
  return {
    layers: layers.length ? layers : undefined,
    pads: ref => {
      const hit = partsNamed(sites, ref)[0]
      return hit?.fp.pads.map(p => ({ num: p.num, name: p.name, net: p.net }))
    },
    routeHelpers: f.helpers(doc),
  }
}

function rangeAt(boards: FileBoard[], p: Position): RangeHit | undefined {
  const { line, col } = toSite(p)
  let best: RangeHit | undefined
  for (const b of boards)
    for (const r of b.ranges) {
      if (before([line, col], r.start) || before(r.end, [line, col - 1])) continue
      if (!best || size(r) < size(best.range)) best = { ref: b.ref, range: r, ranges: b.ranges }
    }
  return best
}

function routesAt(boards: BoardRef[], file: string, start: [number, number]): RouteInfo[] {
  const out: RouteInfo[] = []
  const seen = new Set<string>()
  for (const b of boards) {
    const rel = keyOf(b.root, file)
    for (const r of b.site.routes ?? []) {
      const id = `${b.site.name}|${r.id}`
      if (!r.src || r.src.file !== rel || r.src.line !== start[0] || r.src.col !== start[1] || seen.has(id)) continue
      seen.add(id)
      out.push(r)
    }
  }
  return out
}

function routesCalledIn(boards: BoardRef[], file: string, doc: DocModel): CallRoute[] {
  const out: CallRoute[] = []
  const seen = new Set<string>()
  for (const b of boards)
    for (const r of b.site.routes ?? []) {
      if (!r.call || !sameFile(b.root, r.call.file, file)) continue
      const id = `${b.site.name}|${r.id}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ route: r, at: doc.span(r.call).start, key: `${r.call.line}:${r.call.col}` })
    }
  return out
}

function gridAt(boards: BoardRef[], file: string, line: number, col: number): { project: string; board: string; grid: HintGrid } | null {
  for (const ref of boards) {
    const rel = keyOf(ref.root, file)
    const n = rel === undefined ? undefined : ref.site.edit?.find(e => e.grid && e.src.at?.file === rel && e.src.at.line === line && e.src.at.col === col)
    const g = n && ref.site.grids?.find(x => x.name === n.grid)
    if (!g) continue
    const own = g.src && !g.src.file.startsWith('..') ? g.src : (g.attach ?? g.src)
    const at = own ? { file: abs(ref.root, own.file), line: own.line, col: own.col } : undefined
    return { project: ref.root, board: ref.site.name, grid: { name: g.name, pitch: g.pitch, origin: g.origin, angle: g.angle, ...(at ? { at } : {}) } }
  }
  return null
}

const markerMemo = new WeakMap<SiteData, Marker[]>()
/** A board's findings at their sources, a point finding spread over the source range that starts there. */
function markersOf(ref: BoardRef): Marker[] {
  let out = markerMemo.get(ref.site)
  if (out) return out
  out = []
  for (const [kind, list] of [
    ['DRC', ref.site.drc ?? []],
    ['ERC', ref.site.erc ?? []],
  ] as const) {
    for (const m of list) {
      const s = m.src?.[0]
      if (!s) continue
      const file = isAbsolute(s.file) ? s.file : resolve(ref.root, s.file)
      const rel = keyOf(ref.root, file)
      const point = s.end[0] === s.start[0] && s.end[1] === s.start[1]
      const r = point && rel !== undefined ? ref.site.sources?.[rel]?.find(x => x.start[0] === s.start[0] && x.start[1] === s.start[1]) : undefined
      out.push({
        file,
        line: s.start[0],
        col: s.start[1],
        endLine: r?.end[0] ?? s.end[0],
        endCol: r?.end[1] ?? s.end[1],
        severity: m.severity,
        rule: m.rule,
        message: m.message,
        kind,
        target: ref.site.variant?.name,
      })
    }
  }
  markerMemo.set(ref.site, out)
  return out
}

/** Markers each once by file, start, rule and message, the first kept. */
function unique(ms: Marker[]): Marker[] {
  const seen = new Set<string>()
  return ms.filter(m => {
    const key = `${m.file}|${m.line}|${m.col}|${m.rule}|${m.message}`
    return !seen.has(key) && !!seen.add(key)
  })
}

const itemMemo = new WeakMap<SiteData, Map<string, SiteItem>>()
/** A board's items by uid. */
export function itemsOf(site: SiteData): Map<string, SiteItem> {
  let m = itemMemo.get(site)
  if (!m) itemMemo.set(site, (m = new Map((site.items ?? []).flatMap(it => (it.uid ? [[it.uid, it] as const] : [])))))
  return m
}

const pathMemo = new WeakMap<SiteData, Map<string, { path: string; local: string }>>()
/** A part's instance path and its key in the instance, `A` and `QH` for Q1 of A, by ref; parts at the board level are absent. */
export function partPaths(site: SiteData): Map<string, { path: string; local: string }> {
  let out = pathMemo.get(site)
  if (out) return out
  out = new Map()
  for (const p of site.schematic?.parts ?? []) if (p.path?.length) out.set(p.ref, { path: p.path.join('/'), local: p.local ?? p.ref })
  pathMemo.set(site, out)
  return out
}

/** A part's reference as the tree names it, `CH2/R01`, and a pad's under it; anything else as it is. */
export function pathRef(site: SiteData, ref: string): string {
  const [head, ...rest] = ref.split('/')
  const p = site.schematic.parts.find(x => x.ref === head)
  if (!p?.path?.length || ref.includes(':')) return ref
  return [...p.path, p.local ?? head, ...rest].join('/')
}

/** The footprints a part name may mean: a ref, the variable a board level part was declared as, or a member `A.CF` of an instance or group. */
function partsNamed(boards: BoardRef[], name: string): PartHit[] {
  const out: PartHit[] = []
  const seen = new Set<string>()
  const add = ({ site, root }: BoardRef, ref: string) => {
    const fp = site.footprints.find(x => x.ref === ref)
    if (fp && !seen.has(`${site.name}|${ref}`)) {
      seen.add(`${site.name}|${ref}`)
      out.push({ fp, site, root })
    }
  }
  for (const b of boards) if (b.site.footprints.some(x => x.ref === name)) add(b, name)
  if (out.length) return out
  const dot = name.lastIndexOf('.')
  for (const b of boards) {
    const parts = b.site.schematic?.parts ?? []
    if (dot > 0) {
      const inst = name.slice(0, dot).split('.'),
        local = name.slice(dot + 1)
      const same = parts.filter(p => (p.local ?? p.ref) === local && p.path?.length)
      // the handle names the instance by its binding, `ch2.R01`, or by its name
      const bound = (b.site.schematic?.circuits ?? []).filter(c => c.binding === inst[0]).map(c => [...c.path, ...inst.slice(1)].join('.'))
      const exact = same.filter(p => p.path!.join('.') === inst.join('.') || bound.includes(p.path!.join('.')) || p.path!.at(-1) === inst.at(-1))
      for (const p of exact.length ? exact : same) add(b, p.ref)
    } else {
      for (const p of parts) {
        if (p.path?.length || !p.src) continue
        const text = declLine(isAbsolute(p.src.file) ? p.src.file : resolve(b.root, p.src.file), p.src.line)
        const m = text && /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/.exec(text.slice(0, Math.max(p.src.col - 1, 0)))
        if (m?.[1] === name) add(b, p.ref)
      }
    }
  }
  return out
}

const declCache = new Map<string, { stamp: string; lines: string[] }>()
/** A line of a declaration file by real path, the file read once per modification. */
function declLine(file: string, line: number): string | undefined {
  let stamp: string
  try {
    const st = statSync(file)
    stamp = `${st.size}:${st.mtimeMs}`
  } catch {
    return undefined
  }
  let e = declCache.get(file)
  if (!e || e.stamp !== stamp) {
    try {
      e = { stamp, lines: readFileSync(file, 'utf8').split('\n') }
    } catch {
      return undefined
    }
    declCache.set(file, e)
  }
  return e.lines[line - 1]
}

/** `file` relative to `root` with forward slashes as the source index keys it, `../lib/wire.ts` outside; undefined on another drive. */
export function keyOf(root: string, file: string): string | undefined {
  const rel = relative(root, file)
  if (!rel || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

/** Whether a source path of a board, relative to its root or absolute, names `file`. */
export const abs = (root: string, f: string) => resolve(root, f)
export const sameFile = (root: string, src: string, file: string) => {
  const a = abs(root, src),
    b = resolve(file)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
/** A position as a source range end, 1-based. */
export const tuple = (p: Position): [number, number] => {
  const s = toSite(p)
  return [s.line, s.col]
}
export const before = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
export const contains = (outer: SourceRange, inner: SourceRange) => !before(inner.start, outer.start) && !before(outer.end, inner.end)
/** A range's extent for picking the innermost: lines first, then columns. */
export const size = (r: SourceRange) => (r.end[0] - r.start[0]) * 1e6 + (r.end[1] - r.start[1])
/** A source range, 1-based with an inclusive end, as an LSP range. */
export const lspRange = (r: SourceRange): Range => toRange({ line: r.start[0], col: r.start[1], endLine: r.end[0], endCol: r.end[1] })
