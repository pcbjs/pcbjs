// The live rebuild's affected set, pipeline.md amendment five: what an edit makes stale in the last snapshot, before any stage runs.
import type { Board, Item } from '@pcbjs/core/model'
import type { SourceRange } from '@pcbjs/core/site-data'
import type { BoardOut } from './project.js'
import { pointMap } from './textmap.js'
import type { Invalidate } from '@pcbjs/core/protocol'
import { resolveRef, siteIndex } from '@pcbjs/core/ref'

/** A file's lines, from 1, that an edit changed in the text the snapshot compiled. */
export type Spans = [number, number][]
/** One edited file, its spans null when the text it had is not known. */
export interface Edit {
  rel: string
  abs: string
  spans: Spans | null
}

type Box = [number, number, number, number]
/** mm a leg's copper may lie from a moved part and still be rerouted around it */
const REACH = 1

/** The lines of `before` that `after` changed or dropped, as spans; an insertion between lines changes none. */
export function changedSpans(before: string, after: string): Spans {
  if (before === after) return []
  const map = pointMap(before, after)
  const a = before.split('\n'),
    b = after.split('\n')
  const out: Spans = []
  for (let l = 1; l <= a.length; l++) {
    const m = map([l, 1])
    if (m && b[m[0] - 1] === a[l - 1]) continue
    const last = out.at(-1)
    if (last && last[1] === l - 1) last[1] = l
    else out.push([l, l])
  }
  return out
}

const overlaps = (r: SourceRange, spans: Spans) => spans.some(([a, b]) => r.start[0] <= b && r.end[0] >= a)
const within = (o: SourceRange, r: SourceRange) =>
  (o.start[0] > r.start[0] || (o.start[0] === r.start[0] && o.start[1] >= r.start[1])) && (o.end[0] < r.end[0] || (o.end[0] === r.end[0] && o.end[1] <= r.end[1])) && o !== r

/** The innermost source calls of one file the spans touch: the uids of their items and their parts. */
export function editedIn(ranges: SourceRange[], spans: Spans): { uids: Set<string>; refs: Set<string> } {
  const uids = new Set<string>()
  const refs = new Set<string>()
  const hit = ranges.filter(r => overlaps(r, spans))
  for (const r of hit.filter(r => !hit.some(o => within(o, r)))) {
    r.uids.forEach(u => uids.add(u))
    r.refs.forEach(x => refs.add(x))
  }
  return { uids, refs }
}

/** The ids of a board's items of these uids or of these parts. */
export const touchedIds = (board: Board, uids: ReadonlySet<string>, refs: ReadonlySet<string> = new Set()): Set<number> =>
  new Set(board.items.filter(it => (it.uid && uids.has(it.uid)) || (it.ref && refs.has(it.ref))).map(it => it.id))

/** What the edits make stale on one board target: the innermost source calls they touch, what depends on those, the legs near them, the pours of their layers and the findings naming any. */
export function affected(c: Pick<BoardOut, 'board' | 'site' | 'files'>, run: number, edits: Edit[]): Invalidate {
  const { board, site } = c
  const ids = new Set<number>()
  const refs = new Set<string>()
  for (const { rel, abs, spans } of edits) {
    const ranges = site.sources?.[rel]
    // a file the board reads that draws nothing itself, a config or a helper module: everything it may change
    if (!ranges?.length || spans === null) {
      if (ranges?.length || c.files.includes(abs)) everything(board, ids, refs)
      continue
    }
    const e = editedIn(ranges, spans)
    touchedIds(board, e.uids).forEach(id => ids.add(id))
    e.refs.forEach(x => refs.add(x))
  }
  downstream(board, refs)
  for (const it of board.items) if (it.ref && refs.has(it.ref)) ids.add(it.id)
  const routes = touchedRoutes(board, ids, refs)
  const layers = new Set<string>()
  const nets = new Set<string>()
  for (const it of board.items) {
    if (it.kind !== 'zone' && (ids.has(it.id) || ((it.kind === 'track' || it.kind === 'via') && it.route && routes.has(it.route)))) {
      ids.add(it.id)
      for (const l of it.kind === 'pad' ? it.layers : it.kind === 'via' ? it.layers : [it.layer]) layers.add(l)
      if (it.net && (it.kind === 'pad' || it.kind === 'track')) nets.add(it.net)
    }
  }
  for (const it of board.items) if (it.kind === 'zone' && (layers.has(it.layer) || layers.has('*.Cu'))) ids.add(it.id)
  const uid = new Map(board.items.map(it => [it.id, it.uid]))
  const uids = new Set([...ids].flatMap(id => uid.get(id) ?? []))
  const partOf = (r: string) => {
    try {
      const t = resolveRef(siteIndex(site), r)
      return t.kind === 'part' || t.kind === 'pad' ? t.ref : ''
    } catch {
      return ''
    }
  }
  const findings = [...site.drc, ...site.erc].filter(m => m.items.some(u => uids.has(u)) || (m.route !== undefined && routes.has(m.route)) || m.refs.some(r => refs.has(partOf(r))))
  return {
    board: board.name,
    ...(board.variant ? { target: board.variant.name } : {}),
    run,
    refs: [...[...refs].sort(), ...[...nets].sort().map(n => `net:${n}`)],
    uids: [...uids].sort(),
    findings: findings.map(m => m.id),
  }
}

function everything(board: Board, ids: Set<number>, refs: Set<string>): void {
  for (const it of board.items) ids.add(it.id)
  for (const fp of board.footprints) refs.add(fp.ref)
}

/** The parts placed relative to a part in the set, through the dependency graph, added to it. */
function downstream(board: Board, refs: Set<string>): void {
  const g = board.deps
  if (!g) return
  let grew = true
  while (grew) {
    grew = false
    for (const [from, to] of g.edges) {
      const a = g.nodes[from],
        b = g.nodes[to]
      if (refs.has(b.ref) && !refs.has(a.ref) && (a.kind === 'part' || a.kind === 'follower' || a.kind === 'grid')) {
        refs.add(a.ref)
        grew = true
      }
    }
  }
}

/** The routes whose copper is in the set, whose ends sit on a part in it, or whose copper passes within REACH of one. */
function touchedRoutes(board: Board, ids: Set<number>, refs: Set<string>): Set<string> {
  const boxes = board.footprints.filter(fp => refs.has(fp.ref)).flatMap(fp => (fp.pads.length ? [boxOf(board.items.filter(it => it.ref === fp.ref))] : []))
  const near = (b: Box) => boxes.some(o => b[0] <= o[2] + REACH && b[2] >= o[0] - REACH && b[1] <= o[3] + REACH && b[3] >= o[1] - REACH)
  const copper = new Map<string, Item[]>()
  for (const it of board.items) if ((it.kind === 'track' || it.kind === 'via') && it.route) copper.set(it.route, [...(copper.get(it.route) ?? []), it])
  const out = new Set<string>()
  for (const r of board.routes ?? []) {
    const items = copper.get(r.id) ?? []
    const ends = [...(r.pts ?? []), ...(r.legs ?? []).flatMap(l => [l.from, l.to])]
    if (items.some(it => ids.has(it.id)) || (items.length && near(boxOf(items))) || ends.some(p => near([p[0], p[1], p[0], p[1]]))) out.add(r.id)
  }
  return out
}

function boxOf(items: Item[]): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity]
  const add = ([x, y]: [number, number]) => {
    b[0] = Math.min(b[0], x)
    b[1] = Math.min(b[1], y)
    b[2] = Math.max(b[2], x)
    b[3] = Math.max(b[3], y)
  }
  for (const it of items) {
    if (it.kind === 'pad') it.poly.forEach(add)
    else if (it.kind === 'track') it.pts.forEach(add)
    else if (it.kind === 'via') add(it.at)
    else if (it.kind === 'graphic') it.paths.forEach(p => p.forEach(add))
  }
  return b
}
