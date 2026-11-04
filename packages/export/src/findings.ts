// No Node imports: the viewer shows findings too.
import { sourcePath } from './source-path.js'
import type { Board, DrcMarker, Item, Pad, Pt, RoutingReport } from '@pcbjs/core/model'
import type { Src } from '@pcbjs/core/internal/types'
import type { Finding, Mark, SourceRef } from '@pcbjs/core/finding'
import { isOwnFile } from '@pcbjs/core/internal/provenance'
import { boardIndex, isTreeRef, parseRef, refNet, refRoute, resolveRef, type RefIndex } from '@pcbjs/core/ref'
import type { SiteFinding } from '@pcbjs/core/site-data'

export type { Finding, Mark, SourceRef }

/** Where a marker points: the code to change, the route call a helper made, and the route. */
export interface MarkerContext {
  src?: Src
  via?: Src
  route?: string
  /** whether `src` is where the part was placed rather than the item itself */
  placed?: boolean
}

const SEV = { error: 'error  ', warning: 'warning', info: 'info   ' } as const
const r2 = (v: number) => Math.round(v * 100) / 100
const fmt = (v: number) => r2(v).toFixed(2)
export const fmtPt = (p: Pt) => `(${fmt(p[0])}, ${fmt(p[1])})`

export class BoardIndex {
  readonly items = new Map<number, Item>()
  /** a part's tree path, `CH2/R01`, for one in an instance or a named <g> */
  readonly paths = new Map<string, string>()
  readonly partSrc = new Map<string, Src>()
  readonly fpSrc = new Map<string, Src>()
  readonly refs = new Set<string>()
  readonly routes = new Map<string, NonNullable<Board['routes']>[number]>()
  /** what references resolve against on this board */
  readonly refIndex: RefIndex
  readonly layers: Set<string>
  constructor(
    readonly board: Board,
    readonly root = '',
  ) {
    for (const r of board.routes ?? []) this.routes.set(r.id, r)
    this.refIndex = boardIndex(board)
    this.layers = new Set(board.layers.map(l => l.id))
    for (const it of board.items) this.items.set(it.id, it)
    for (const p of board.schematic?.parts ?? []) {
      this.refs.add(p.ref)
      if (p.path?.length) this.paths.set(p.ref, [...p.path, p.local ?? p.ref].join('/'))
      if (p.src) this.partSrc.set(p.ref, p.src)
    }
    for (const f of board.footprints) {
      this.refs.add(f.ref)
      if (f.src) this.fpSrc.set(f.ref, f.src)
    }
  }
  rel(file: string): string {
    return sourcePath(this.root, file)
  }
  inProject(file: string): boolean {
    return !/[\\/]node_modules[\\/]/.test(file) && !isOwnFile(file) && (!/^([\\/]|[A-Za-z]:)/.test(file) || !this.root || this.rel(file) !== file)
  }
  /** The part a reference names or holds a pad of, a declared part never placed by its ref; undefined for any other reference. */
  partOf(ref: string): string | undefined {
    try {
      const r = resolveRef(this.refIndex, ref)
      return r.kind === 'part' || r.kind === 'pad' ? r.ref : undefined
    } catch {
      return this.refs.has(ref) ? ref : undefined
    }
  }
  // where the footprint was placed, else where the part was declared
  placement(ref: string): Src | undefined {
    return this.fpSrc.get(ref) ?? this.partSrc.get(ref)
  }
}

export function markerContext(ix: BoardIndex, m: DrcMarker): MarkerContext {
  const involved: Item[] = (m.items ?? []).map(id => ix.items.get(id)).filter((x): x is Item => !!x)
  const one = <T>(xs: (T | undefined)[]): T | undefined => {
    const s = new Set(xs.filter((x): x is T => x !== undefined))
    return s.size === 1 ? [...s][0] : undefined
  }
  let route = (m.refs ?? []).map(refRoute).find(r => r !== null) ?? undefined
  if (!route && !['route-failed', 'unconnected', 'length-match'].includes(m.rule))
    route = one(involved.map(it => (it.kind === 'track' || it.kind === 'via' ? it.route : undefined)))
  let src: Src | undefined = m.src
  let placed = false
  // the call chain and the route call it leads to: the route's own, else the chain of the item that gives the source
  const rt = route ? ix.routes.get(route) : undefined
  let chain: Src[] | undefined = rt?.chain
  let callee: Src | undefined = rt?.src ?? m.src
  if (!src)
    for (const it of involved) {
      // a pad's own range is inside its footprint's definition, the same for every instance: the placement says which one
      if (it.kind === 'pad' && it.ref && ix.placement(it.ref)) {
        src = ix.placement(it.ref)
        placed = true
        break
      }
      if (it.src && ix.inProject(it.src.file)) {
        src = it.src
        if (!rt) {
          chain = it.chain
          callee = it.src
        }
        break
      }
      if (it.ref && ix.placement(it.ref)) {
        src = ix.placement(it.ref)
        placed = true
        break
      }
    }
  if (!src)
    for (const r of m.refs ?? []) {
      const part = ix.partOf(r)
      const s = part && ix.placement(part)
      if (s) {
        src = s
        placed = true
        break
      }
    }
  // a route made inside a helper: the helper's call site is the code to change, the route call inside it comes after "via"
  const call = src && callee ? [...(chain ?? [])].reverse().find(c => c.call) : undefined
  return { src: call ?? src, ...(call ? { via: callee } : {}), ...(route ? { route } : {}), ...(placed && !call ? { placed } : {}) }
}

const srcText = (ix: BoardIndex, s: Src) => `${ix.rel(s.file)}:${s.line}:${s.col}`

/** A source position as a finding's `src` holds it, 1-based, end inclusive. */
export function sourceRef(ix: BoardIndex, s: Src, role: SourceRef['role']): SourceRef {
  return { file: ix.rel(s.file), start: [s.line, s.col], end: [s.endLine ?? s.line, s.endCol ?? s.col], role }
}

/** The source of a route as the src column shows it: `main.tsx:139:6 via main.tsx:93:70` for one made inside a helper. */
export function routeSrcText(ix: BoardIndex, r: { src?: Src; chain?: Src[] }): string | undefined {
  if (!r.src) return undefined
  const call = [...(r.chain ?? [])].reverse().find(c => c.call)
  return call ? `${srcText(ix, call)} via ${srcText(ix, r.src)}` : srcText(ix, r.src)
}

const EPS = 1e-6
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS
const sameSeg = (a: [Pt, Pt], b: [Pt, Pt]) => (same(a[0], b[0]) && same(a[1], b[1])) || (same(a[0], b[1]) && same(a[1], b[0]))
const sideOf = (layer: string): 'F' | 'B' => (layer.startsWith('B.') ? 'B' : 'F')

/** A DRC finding's mark: the ratsnest line of its net its evidence lies on, a failed leg's own line when none, else a dot on its layer when the board has it, else on the top copper. */
export function drcMark(ix: BoardIndex, m: DrcMarker): Mark {
  const net = (m.refs ?? []).map(refNet).find(n => n !== null)
  const segs = m.witness?.segments ?? []
  const rats = ix.board.ratsnest
  const i = rats.findIndex(r => (!net || r.net === net) && segs.some(s => sameSeg(s, [r.from, r.to])))
  if (i >= 0) return { line: [rats[i].from, rats[i].to], rats: i, layer: 'F.Cu' }
  if (m.rule === 'route-failed' && segs.length) return { line: segs[segs.length - 1], rats: null, layer: 'F.Cu' }
  const layer = [m.layer, m.witness?.layer].find((l): l is string => !!l && ix.layers.has(l)) ?? 'F.Cu'
  return { at: m.at, layer, side: sideOf(layer) }
}

/** An ERC finding's mark: on the first pad it names, else the origin of the first part, else its own point; none for a point on the sheet or no point at all. */
export function ercMark(ix: BoardIndex, m: DrcMarker): Mark {
  const named = (m.refs ?? []).flatMap(r => {
    try {
      const t = resolveRef(ix.refIndex, r)
      return t.kind === 'pad' || t.kind === 'part' ? [t] : []
    } catch {
      return []
    }
  })
  const fp = (ref: string) => ix.refIndex.parts.find(p => p.ref === ref)!.part
  const pad = named.find(t => t.kind === 'pad')
  if (pad?.kind === 'pad') return { at: pad.pad.at, layer: `${fp(pad.ref).side}.Cu`, side: fp(pad.ref).side }
  const part = named.find(t => t.kind === 'part')
  if (part?.kind === 'part') return { at: part.footprint.at, layer: `${part.footprint.side}.Cu`, side: part.footprint.side }
  return m.layer !== 'sch' && (m.at[0] || m.at[1]) ? { at: m.at, layer: 'F.Cu', side: 'F' } : null
}

/** Every DRC and ERC finding of a compiled board in the shape of `check --json`, each with its mark. */
export function boardFindings(board: Board, root = ''): Finding[] {
  const ix = new BoardIndex(board, root)
  return [...board.drc.map(m => findingOf(ix, 'drc', m)), ...board.erc.map(m => findingOf(ix, 'erc', m))]
}

function findingOf(ix: BoardIndex, kind: 'drc' | 'erc', m: DrcMarker): Finding {
  const c = markerContext(ix, m)
  const noPos = kind === 'erc' && m.at[0] === 0 && m.at[1] === 0 && !m.items?.length
  const target = ix.board.variant?.name
  return {
    id: m.id ?? '',
    fingerprint: m.fingerprint ?? '',
    kind,
    severity: m.severity,
    rule: m.rule,
    board: ix.board.name,
    ...(target !== undefined ? { target } : {}),
    ...(m.layer ? { layer: m.layer } : {}),
    at: noPos ? null : [r2(m.at[0]), r2(m.at[1])],
    refs: [...(m.refs ?? [])],
    items: (m.items ?? []).flatMap(id => ix.items.get(id)?.uid ?? []),
    ...(m.measured ? { measured: m.measured } : {}),
    ...(m.required ? { required: m.required } : {}),
    ...(m.witness ? { witness: m.witness } : {}),
    ...(m.provenance ? { provenance: m.provenance } : {}),
    ...(m.args ? { args: m.args } : {}),
    src: findingSrc(ix, m, c),
    message: m.message,
    ...(c.route ? { route: c.route } : {}),
    mark: kind === 'drc' ? drcMark(ix, m) : ercMark(ix, m),
  }
}

/** The ranges of a finding: the code to change, with a helper's call site first, then the rule levels that set its value. */
function findingSrc(ix: BoardIndex, m: DrcMarker, c: MarkerContext = markerContext(ix, m)): SourceRef[] {
  const role = m.rule === 'patch-stale' ? 'patch' : c.via ? 'call' : c.placed ? 'part' : 'item'
  const src: SourceRef[] = c.src ? [sourceRef(ix, c.src, role)] : []
  if (c.via) src.push(sourceRef(ix, c.via, 'item'))
  for (const p of m.provenance ?? []) if (p.src) src.push(p.src)
  return src
}

/** The findings as the site carries them, DRC and ERC apart, each with `path` the instance paths of its parts. */
export function siteFindings(board: Board, root: string): { drc: SiteFinding[]; erc: SiteFinding[] } {
  const ix = new BoardIndex(board, root)
  const row =
    (kind: 'drc' | 'erc') =>
    (m: DrcMarker): SiteFinding => {
      const f = findingOf(ix, kind, m)
      const paths = [...new Set(f.refs.flatMap(r => ix.paths.get(ix.partOf(r) ?? '') ?? []))]
      return paths.length ? { ...f, path: paths } : f
    }
  return { drc: board.drc.map(row('drc')), erc: board.erc.map(row('erc')) }
}

/** The one net a finding concerns, from its refs. */
export const findingNet = (f: Pick<Finding, 'refs'>): string | undefined => {
  const nets = f.refs.flatMap(r => refNet(r) ?? [])
  return nets.length === 1 ? nets[0] : undefined
}

/** The one part every ref of a finding names a pad or drawing of. */
export const findingPart = (f: Pick<Finding, 'refs'>): string | undefined => {
  const parts = f.refs.map(r => (isTreeRef(r) ? parseRef(r)[0].value : null))
  return parts.length && parts.every(p => p && p === parts[0]) ? parts[0]! : undefined
}

/** `file:line:col` of the code to change, and of the route call a helper made after `via`. */
export function srcLine(f: Pick<Finding, 'src'>): string | undefined {
  const at = (s: SourceRef) => `${s.file}:${s.start[0]}:${s.start[1]}`
  const [a, b] = f.src
  if (!a) return undefined
  return a.role === 'call' && b ? `${at(a)} via ${at(b)}` : at(a)
}

/** The refs column. */
export const refsText = (refs: readonly string[]): string => refs.join(', ')

/** One finding as `check` prints it, without its id. */
export function findingLine(f: Finding): string {
  return (
    [
      SEV[f.severity],
      f.kind === 'erc' ? `ERC ${f.rule}` : f.rule,
      f.layer,
      f.at ? `at ${fmtPt(f.at)}` : undefined,
      f.refs.length ? refsText(f.refs) : undefined,
      f.route && !f.refs.includes(f.route) ? f.route : undefined,
      srcLine(f),
    ]
      .filter(Boolean)
      .join('  ') + `: ${f.message}`
  )
}

export interface FindingDiff {
  added: Finding[]
  fixed: Finding[]
  unchanged: number
}

const gap = (a: Pt | null, b: Pt | null) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : a || b ? Infinity : 0)

/** The findings of two compiles matched by fingerprint, then within a fingerprint by nearest `at`. */
export function diffFindings(prev: Finding[], next: Finding[]): FindingDiff {
  const left = new Map<string, Finding[]>()
  for (const f of prev) left.set(f.fingerprint, [...(left.get(f.fingerprint) ?? []), f])
  const added: Finding[] = []
  let unchanged = 0
  for (const f of next) {
    const pool = left.get(f.fingerprint)
    if (!pool?.length) {
      added.push(f)
      continue
    }
    let k = 0
    for (let i = 1; i < pool.length; i++) if (gap(pool[i].at, f.at) < gap(pool[k].at, f.at)) k = i
    pool.splice(k, 1)
    unchanged++
  }
  return { added, fixed: [...left.values()].flat(), unchanged }
}

/** The finding of `prev` as `next` reports it, by fingerprint then nearest `at`; null when none matches. */
export function matchFinding(f: Pick<Finding, 'fingerprint' | 'at'>, next: readonly Finding[]): Finding | null {
  let best: Finding | null = null
  for (const x of next) if (x.fingerprint === f.fingerprint && (!best || gap(x.at, f.at) < gap(best.at, f.at))) best = x
  return best
}

export const diffText = (added: number, fixed: number, unchanged: number): string => `${added} new, ${fixed} fixed, ${unchanged} unchanged`
export const diffLine = (d: FindingDiff): string => diffText(d.added.length, d.fixed.length, d.unchanged)

export interface TargetFindings {
  target?: string
  findings: Finding[]
}

export interface FormatOptions {
  /** most finding lines to print per rule; the rest of a rule is counted in one "and N more" line */
  cap?: number
  indent?: string
  /** what the "and N more" lines point at */
  more?: string
  /** every finding on its own line: no folding of unconnected nets or of one footprint's findings, no cap */
  all?: boolean
}

// each explains the next: a failed route, then copper that touches, then copper too close
const LEAD = ['route-failed', 'short', 'clearance', 'hole-to-copper']

// unconnected comes last, since a route that failed or a short explains it
export function ruleRank(f: Pick<Finding, 'kind' | 'rule' | 'severity'>): number {
  if (f.kind === 'drc' && f.rule === 'unconnected') return 9
  const lead = f.kind === 'drc' ? LEAD.indexOf(f.rule) : -1
  if (lead >= 0) return lead
  return f.severity === 'error' ? (f.kind === 'drc' ? 4 : 5) : f.severity === 'info' ? 8 : f.kind === 'drc' ? 6 : 7
}

export const orderFindings = <T extends Pick<Finding, 'kind' | 'rule' | 'severity'>>(fs: readonly T[]): T[] =>
  fs
    .map((f, i) => [f, i] as const)
    .sort(
      (x, y) =>
        ruleRank(x[0]) - ruleRank(y[0]) ||
        (x[0].kind === y[0].kind ? 0 : x[0].kind === 'drc' ? -1 : 1) ||
        (x[0].rule < y[0].rule ? -1 : x[0].rule > y[0].rule ? 1 : 0) ||
        x[1] - y[1],
    )
    .map(([f]) => f)

// one footprint's findings of one rule fold into one line from this many on
const FOLD = 3

/** The findings of one board as lines grouped by rule; unless `all`, a failed net's unconnected and one footprint's findings fold. */
export function formatFindings(targets: TargetFindings[], o: FormatOptions = {}): string[] {
  const ind = o.indent ?? '  '
  const all = targets.map(t => t.target).filter((t): t is string => !!t)
  type Line = { f: Finding; n: number; targets: Set<string>; text?: string; count?: number }
  const lines = new Map<string, Line>()
  for (const t of targets) {
    // within one target identical lines count; across targets the same line is one finding
    const seen = new Map<string, number>()
    for (const f of t.findings) {
      const text = findingLine(f)
      const k = seen.get(text) ?? 0
      seen.set(text, k + 1)
      const e = lines.get(text)
      if (!e) lines.set(text, { f, n: 1, targets: new Set(t.target ? [t.target] : []) })
      else {
        if (t.target) e.targets.add(t.target)
        if (k + 1 > e.n) e.n = k + 1
      }
    }
  }
  let list = [...lines.values()]
  if (!o.all) {
    const failed = new Map<string, Set<string>>()
    for (const e of list)
      if (e.f.kind === 'drc' && e.f.rule === 'route-failed' && findingNet(e.f)) {
        const net = findingNet(e.f)!
        const s = failed.get(net) ?? new Set<string>()
        failed.set(net, s)
        s.add(e.f.route ?? '')
      }
    const folded = new Map<string, Line[]>()
    const keyOf = (e: Line): string | null => {
      const net = findingNet(e.f),
        part = findingPart(e.f)
      if (e.f.kind === 'drc' && e.f.rule === 'unconnected') return net && failed.has(net) ? `net|${net}` : null
      if (part && e.f.rule !== 'route-failed') return `part|${e.f.kind}|${e.f.rule}|${e.f.severity}|${part}`
      return null
    }
    for (const e of list) {
      const k = keyOf(e)
      if (k) folded.set(k, [...(folded.get(k) ?? []), e])
    }
    const out: Line[] = []
    const done = new Set<string>()
    for (const e of list) {
      const k = keyOf(e)
      const group = k ? folded.get(k)! : null
      if (!k || !group || (k.startsWith('part|') && group.length < FOLD)) {
        out.push(e)
        continue
      }
      if (done.has(k)) continue
      done.add(k)
      const n = group.reduce((a, x) => a + x.n, 0)
      const targetsOf = new Set(group.flatMap(x => [...x.targets]))
      const f = e.f
      if (k.startsWith('net|')) {
        const net = findingNet(f)!
        const ids = [...failed.get(net)!].filter(Boolean)
        const msg = `net ${net} is not fully connected${n > 1 ? ` in ${n} places` : ''}: ${ids.length > 1 ? `routes ${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : ids.length ? `route ${ids[0]}` : 'a route of it'} failed, see route-failed`
        out.push({ f, n: 1, count: n, targets: targetsOf, text: [SEV[f.severity], f.rule, net].join('  ') + `: ${msg}` })
      } else {
        const head = [SEV[f.severity], f.kind === 'erc' ? `ERC ${f.rule}` : f.rule, findingPart(f), srcLine(f)].filter(Boolean).join('  ')
        out.push({
          f,
          n: 1,
          count: n,
          targets: targetsOf,
          text: `${head}: ${n} findings on ${findingPart(f)}, the first at ${f.at ? fmtPt(f.at) : '-'}${f.layer ? ` on ${f.layer}` : ''}: ${f.message}`,
        })
      }
    }
    list = out
  }
  const groups = new Map<string, { f: Finding; errors: number; warnings: number; infos: number; lines: string[] }>()
  for (const e of list) {
    const key = `${e.f.kind} ${e.f.rule}`
    const g = groups.get(key) ?? { f: e.f, errors: 0, warnings: 0, infos: 0, lines: [] }
    groups.set(key, g)
    // a folded line counts every finding it stands for
    const count = e.count ?? e.n
    if (e.f.severity === 'error') {
      g.errors += count
      if (g.f.severity !== 'error') g.f = e.f
    } else if (e.f.severity === 'info') g.infos += count
    else g.warnings += count
    const who = all.length > 1 && e.targets.size < all.length ? `  [${all.filter(t => e.targets.has(t)).join(', ')}]` : ''
    g.lines.push(`${e.text ?? findingLine(e.f)}${!e.text && e.n > 1 ? `  x${e.n}` : ''}${who}${!e.text && e.f.id ? `  ${e.f.id}` : ''}`)
  }
  const sorted = [...groups.values()].sort((a, b) => ruleRank(a.f) - ruleRank(b.f) || (a.f.kind === b.f.kind ? 0 : a.f.kind === 'drc' ? -1 : 1))
  const out: string[] = []
  const cap = o.all ? Infinity : (o.cap ?? Infinity)
  for (const g of sorted) {
    const count = [
      g.errors ? `${g.errors} error${g.errors === 1 ? '' : 's'}` : '',
      g.warnings ? `${g.warnings} warning${g.warnings === 1 ? '' : 's'}` : '',
      g.infos ? `${g.infos} info` : '',
    ]
      .filter(Boolean)
      .join(', ')
    out.push(`${ind}${g.f.kind.toUpperCase()} ${g.f.rule}: ${count}`)
    for (const l of g.lines.slice(0, cap)) out.push(`${ind}  ${l}`)
    if (g.lines.length > cap) out.push(`${ind}  and ${g.lines.length - cap} more ${g.f.rule}${o.more ? `, ${o.more}` : ''}`)
  }
  return out
}

export function counts(board: Pick<Board, 'drc' | 'erc' | 'unconnected'>) {
  const de = board.drc.filter(d => d.severity === 'error').length,
    ee = board.erc.filter(d => d.severity === 'error').length
  const warn = (ms: DrcMarker[]) => ms.filter(d => d.severity === 'warning').length
  return { drcErrors: de, drcWarnings: warn(board.drc), unconnected: board.unconnected, ercErrors: ee, ercWarnings: warn(board.erc) }
}

export const failing = (board: Pick<Board, 'drc' | 'erc' | 'unconnected'>): boolean => {
  const c = counts(board)
  return !!(c.drcErrors || c.unconnected || c.ercErrors)
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** `DRC 2 errors, 1 warning, 1 unconnected  ERC ok`, or `DRC ok  ERC ok` for a clean board. */
export function checkText(board: Pick<Board, 'drc' | 'erc' | 'unconnected'>): string {
  const c = counts(board)
  const drc =
    c.drcErrors || c.drcWarnings || c.unconnected ? `DRC ${[plural(c.drcErrors, 'error'), plural(c.drcWarnings, 'warning'), `${c.unconnected} unconnected`].join(', ')}` : 'DRC ok'
  const erc = c.ercErrors || c.ercWarnings ? `ERC ${plural(c.ercErrors, 'error')}, ${plural(c.ercWarnings, 'warning')}` : 'ERC ok'
  return `${drc}  ${erc}`
}

export const msText = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)

/** `route 120 ms, zones 80 ms` from a record of ms by phase or a list of { name, ms }. */
export function timingsText(t: unknown): string {
  if (!t || typeof t !== 'object') return ''
  const pairs: [string, number][] = Array.isArray(t)
    ? t.flatMap(e => (e && typeof e === 'object' && typeof (e as any).ms === 'number' ? [[String((e as any).name ?? (e as any).phase), (e as any).ms] as [string, number]] : []))
    : Object.entries(t as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'number' ? [[k, v] as [string, number]] : []))
  // a phase under half a millisecond says nothing
  return pairs
    .filter(([k, v]) => k !== 'total' && v >= 0.5)
    .map(([k, v]) => `${k} ${msText(v)}`)
    .join(', ')
}

/** `Blinky 0.1.0 [House]`. */
export const boardLabel = (b: Pick<Board, 'name' | 'rev' | 'variant'>): string => `${b.name}${b.rev ? ' ' + b.rev : ''}${b.variant ? ` [${b.variant.name}]` : ''}`

const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function boardLine(b: Board, entry: string, ms: number): string {
  const s = b.stats
  const t = timingsText((b as Board & { timings?: unknown }).timings)
  const stats = [unit(s.footprints, 'footprint'), unit(s.pads, 'pad'), unit(s.tracks, 'track'), unit(s.vias, 'via'), unit(s.zones, 'zone'), unit(s.nets, 'net')].join(', ')
  return `${boardLabel(b)}  ${entry}  ${stats}  ${checkText(b)}${failing(b) ? '  FAIL' : ''}  ${msText(ms)}${t ? `: ${t}` : ''}`
}

/** `routing 80 legs, 80 routed, 0 failed, 78 cached, 2 held, 0 ripped, 0 rounds`, or '' for a board the autorouter had nothing to do on. */
export function routingText(r: RoutingReport | undefined): string {
  if (!r || (!r.legs && !r.shared)) return ''
  return `routing ${unit(r.legs, 'leg')}, ${r.routed} routed, ${r.failed} failed, ${r.cached} cached, ${r.held} held, ${r.ripped ?? 0} ripped, ${unit(r.rounds ?? 0, 'round')}`
}

/** `shared rules: clearance 0.2, minTrackWidth 0.15, …` for the targets of a board routed once under the strictest rules. */
export function sharedRulesText(shared: NonNullable<RoutingReport['shared']>): string {
  const rules = Object.entries(shared.rules)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k} ${+(v as number).toFixed(4)}`)
    .join(', ')
  return `shared rules: ${rules}  [${shared.targets.join(', ')}]`
}

/** One routing line per target, one when the targets agree, and the shared rules once per group routed together. */
export function routingLines(boards: Board[], indent = '  '): string[] {
  const out: string[] = []
  const texts = boards.map(b => routingText(b.routing))
  const named = boards.length > 1 && new Set(texts).size > 1
  boards.forEach((b, i) => {
    if (!texts[i] || (!named && i > 0)) return
    out.push(`${indent}${texts[i]}${named && b.variant ? `  [${b.variant.name}]` : ''}`)
  })
  const seen = new Set<string>()
  for (const b of boards) {
    const s = b.routing?.shared
    if (!s) continue
    const t = sharedRulesText(s)
    if (seen.has(t)) continue
    seen.add(t)
    out.push(`${indent}${t}`)
  }
  return out
}
