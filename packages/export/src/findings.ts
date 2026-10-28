// No Node imports: the viewer shows findings too.
import type { Board, DrcMarker, Item, Pad, Pt, RoutingReport } from '@pcbjs/core/model'
import type { Src } from '@pcbjs/core/types'
import { isOwnFile } from '@pcbjs/core/own-files'

/** A part involved in a finding: its ref and, inside a circuit instance, its instance path such as `CH2/R`. */
/** A part in a finding; `path` its circuit instance path, `name` its export name in the schematic module where that is not the ref. */
export interface FindingRef {
  ref: string
  path?: string
  name?: string
}

export interface Finding {
  /** stable across runs of the same design: a hash of the kind, rule, items and position rounded to 0.01 mm, plus the message when there are no items */
  id: string
  kind: 'drc' | 'erc'
  severity: 'error' | 'warning' | 'info'
  rule: string
  message: string
  layer?: string
  /** board mm; null when the finding has no position, such as a part that is never placed */
  at: Pt | null
  /** the item ids the checker named */
  items: number[]
  refs: FindingRef[]
  /** `file:line:col` of the code to change, relative to the project root, when known: for a route made inside a helper, where the helper was called */
  src?: string
  /** the route call inside the helper when `src` is the helper's call site, `file:line:col` */
  via?: string
  /** the one net the finding concerns, when it concerns one */
  net?: string
  /** the one route the finding concerns, `route:<n>`, see `pcbjs inspect --lengths` */
  route?: string
  /** the one footprint every involved item belongs to, such as the pads of a header placed over the edge */
  part?: string
}

/** What the site data adds to a marker. */
export interface MarkerContext {
  src?: Src
  refs: FindingRef[]
  extra?: string
  via?: Src
  net?: string
  route?: string
  part?: string
}

const SEV = { error: 'error  ', warning: 'warning', info: 'info   ' } as const
const r2 = (v: number) => Math.round(v * 100) / 100
const fmt = (v: number) => r2(v).toFixed(2)
export const fmtPt = (p: Pt) => `(${fmt(p[0])}, ${fmt(p[1])})`

/** 12 hex digits of two FNV-1a passes, enough to tell findings of one board apart. */
export function hash(text: string): string {
  let a = 0x811c9dc5,
    b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
    b ^= b >>> 13
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0').slice(0, 4)
}

export function findingId(kind: string, m: Pick<DrcMarker, 'rule' | 'items' | 'at' | 'message'>): string {
  const items = [...(m.items ?? [])].sort((x, y) => x - y)
  const at = m.at ? `${r2(m.at[0])},${r2(m.at[1])}` : ''
  return hash(`${kind}|${m.rule}|${items.join(',')}|${at}${items.length ? '' : '|' + m.message}`)
}

export class BoardIndex {
  readonly items = new Map<number, Item>()
  readonly paths = new Map<string, string>()
  readonly names = new Map<string, string>()
  readonly partSrc = new Map<string, Src>()
  readonly fpSrc = new Map<string, Src>()
  readonly refs = new Set<string>()
  readonly routes = new Map<string, NonNullable<Board['routes']>[number]>()
  constructor(
    readonly board: Board,
    readonly root = '',
  ) {
    for (const r of board.routes ?? []) this.routes.set(r.id, r)
    for (const it of board.items) this.items.set(it.id, it)
    for (const p of board.schematic?.parts ?? []) {
      this.refs.add(p.ref)
      if (p.path?.length) this.paths.set(p.ref, [...p.path, p.local ?? p.ref].join('/'))
      else if (p.export && p.export.name !== p.ref) this.names.set(p.ref, p.export.name)
      if (p.src) this.partSrc.set(p.ref, p.src)
    }
    for (const f of board.footprints) {
      this.refs.add(f.ref)
      if (f.src) this.fpSrc.set(f.ref, f.src)
    }
  }
  rel(file: string): string {
    const r = this.root.replace(/[\\/]$/, '')
    return r && file.startsWith(r + '/') ? file.slice(r.length + 1) : file
  }
  inProject(file: string): boolean {
    return !file.includes('/node_modules/') && !isOwnFile(file) && (!/^([\\/]|[A-Za-z]:)/.test(file) || !this.root || file.startsWith(this.root))
  }
  refOf(ref: string): FindingRef {
    const path = this.paths.get(ref),
      name = this.names.get(ref)
    return path ? { ref, path } : name ? { ref, name } : { ref }
  }
  // where the footprint was placed, else where the part was declared
  placement(ref: string): Src | undefined {
    return this.fpSrc.get(ref) ?? this.partSrc.get(ref)
  }
}

// within half a millimetre
function padNear(ix: BoardIndex, net: string, p: Pt): Pad | undefined {
  let best: Pad | undefined,
    d = 0.25
  for (const it of ix.board.items) {
    if (it.kind !== 'pad' || it.net !== net) continue
    const e = (it.at[0] - p[0]) ** 2 + (it.at[1] - p[1]) ** 2
    if (e < d) {
      d = e
      best = it
    }
  }
  return best
}

export function markerContext(ix: BoardIndex, m: DrcMarker): MarkerContext {
  const involved: Item[] = (m.items ?? []).map(id => ix.items.get(id)).filter((x): x is Item => !!x)
  let extra: string | undefined
  if (m.rule === 'unconnected') {
    const net = /^net (\S+) /.exec(m.message)?.[1]
    const rn = ix.board.ratsnest.find(r => r.net === net && Math.abs((r.from[0] + r.to[0]) / 2 - m.at[0]) < 1e-6 && Math.abs((r.from[1] + r.to[1]) / 2 - m.at[1]) < 1e-6)
    if (rn) {
      const end = (p: Pt) => {
        const pad = padNear(ix, rn.net, p)
        if (pad) involved.push(pad)
        return pad ? `${pad.ref ? pad.ref + '.' : ''}${pad.num} at ${fmtPt(p)}` : fmtPt(p)
      }
      extra = `from ${end(rn.from)} to ${end(rn.to)}`
    }
  }
  // a marker without items placed on a pad, such as a single-pad net: that pad
  if (!involved.length && (m.at[0] !== 0 || m.at[1] !== 0)) {
    const pad = ix.board.items.find((it): it is Pad => it.kind === 'pad' && Math.abs(it.at[0] - m.at[0]) < 1e-3 && Math.abs(it.at[1] - m.at[1]) < 1e-3)
    if (pad) involved.push(pad)
  }
  const refs: string[] = []
  for (const it of involved) if (it.ref && !refs.includes(it.ref)) refs.push(it.ref)
  if (!refs.length) {
    for (const t of m.message.match(/[A-Za-z_][\w]*/g) ?? []) if (ix.refs.has(t) && !refs.includes(t)) refs.push(t)
  }
  // the net and the route: the marker's own, a route-failed's leg, else what the involved items agree on
  const own = involved.filter(it => it.kind !== 'pad' || !m.items?.length || m.items.includes(it.id))
  const one = <T>(xs: (T | undefined)[]): T | undefined => {
    const s = new Set(xs.filter((x): x is T => x !== undefined))
    return s.size === 1 ? [...s][0] : undefined
  }
  let net = m.net ?? m.route?.net ?? (m.rule === 'unconnected' ? /^net (\S+) /.exec(m.message)?.[1] : undefined)
  let route = m.routeId
  if (!route && m.rule === 'route-failed' && m.src) {
    const same = (s?: Src) => !!s && s.file === m.src!.file && s.line === m.src!.line && s.col === m.src!.col
    route = [...ix.routes.values()].find(r => same(r.src) && (m.route?.net === undefined || r.net === m.route.net))?.id
  }
  if (!route && !['route-failed', 'unconnected', 'length-match'].includes(m.rule)) route = one(own.map(it => (it.kind === 'track' || it.kind === 'via' ? it.route : undefined)))
  if (!net && m.rule !== 'route-failed') net = one(own.map(it => it.net))
  const part = own.length && own.every(it => it.ref && it.ref === own[0].ref) ? own[0].ref : undefined
  let src: Src | undefined = m.src
  // the call chain and the route call it leads to: the route's own, else the chain of the item that gives the source
  const rt = route ? ix.routes.get(route) : undefined
  let chain: Src[] | undefined = rt?.chain
  let callee: Src | undefined = rt?.src ?? m.src
  if (!src)
    for (const it of involved) {
      // a pad's own range is inside its footprint's definition, the same for every instance: the placement says which one
      if (it.kind === 'pad' && it.ref && ix.placement(it.ref)) {
        src = ix.placement(it.ref)
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
        break
      }
    }
  if (!src)
    for (const r of refs) {
      const s = ix.placement(r)
      if (s) {
        src = s
        break
      }
    }
  // a route made inside a helper: the helper's call site is the code to change, the route call inside it comes after "via"
  const call = src && callee ? [...(chain ?? [])].reverse().find(c => c.call) : undefined
  return {
    src: call ?? src,
    ...(call ? { via: callee } : {}),
    refs: refs.map(r => ix.refOf(r)),
    extra,
    ...(net ? { net } : {}),
    ...(route ? { route } : {}),
    ...(part ? { part } : {}),
  }
}

const srcText = (ix: BoardIndex, s: Src) => `${ix.rel(s.file)}:${s.line}:${s.col}`

/** The source of a route as the src column shows it: `main.tsx:139:6 via main.tsx:93:70` for one made inside a helper. */
export function routeSrcText(ix: BoardIndex, r: { src?: Src; chain?: Src[] }): string | undefined {
  if (!r.src) return undefined
  const call = [...(r.chain ?? [])].reverse().find(c => c.call)
  return call ? `${srcText(ix, call)} via ${srcText(ix, r.src)}` : srcText(ix, r.src)
}

export function boardFindings(board: Board, root = ''): Finding[] {
  const ix = new BoardIndex(board, root)
  const one =
    (kind: 'drc' | 'erc') =>
    (m: DrcMarker): Finding => {
      const c = markerContext(ix, m)
      const noPos = kind === 'erc' && m.at[0] === 0 && m.at[1] === 0 && !m.items?.length
      return {
        id: findingId(kind, m),
        kind,
        severity: m.severity,
        rule: m.rule,
        message: c.extra ? `${m.message}, ${c.extra}` : m.message,
        ...(m.layer ? { layer: m.layer } : {}),
        at: noPos ? null : [r2(m.at[0]), r2(m.at[1])],
        items: [...(m.items ?? [])],
        refs: c.refs,
        ...(c.src ? { src: srcText(ix, c.src) } : {}),
        ...(c.via ? { via: srcText(ix, c.via) } : {}),
        ...(c.net ? { net: c.net } : {}),
        ...(c.route ? { route: c.route } : {}),
        ...(c.part ? { part: c.part } : {}),
      }
    }
  return [...board.drc.map(one('drc')), ...board.erc.map(one('erc'))]
}

export function siteMarkers(board: Board, markers: DrcMarker[], root: string): (DrcMarker & { src?: { file: string; line: number; col: number }; path?: string[] })[] {
  const ix = new BoardIndex(board, root)
  return markers.map(m => {
    const c = markerContext(ix, m)
    const paths = c.refs.flatMap(r => (r.path ? [r.path] : []))
    return { ...m, ...(c.src ? { src: { file: ix.rel(c.src.file), line: c.src.line, col: c.src.col } } : {}), ...(paths.length ? { path: paths } : {}) }
  })
}

/** The refs column: `R2 (CH2/R), R3 (Rpull), Q1`. */
export const refsText = (refs: FindingRef[]): string => refs.map(r => ((r.path ?? r.name) ? `${r.ref} (${r.path ?? r.name})` : r.ref)).join(', ')

export function findingLine(f: Finding): string {
  return (
    [
      SEV[f.severity],
      f.kind === 'erc' ? `ERC ${f.rule}` : f.rule,
      f.layer,
      f.at ? `at ${fmtPt(f.at)}` : undefined,
      f.refs.length ? refsText(f.refs) : undefined,
      f.route,
      f.src && f.via ? `${f.src} via ${f.via}` : f.src,
    ]
      .filter(Boolean)
      .join('  ') + `: ${f.message}`
  )
}

/** A key that survives unrelated edits, for the diff between two compiles: kind, rule, message and position to 0.1 mm. */
export const diffKey = (f: Finding): string => `${f.kind}|${f.rule}|${f.message}|${f.at ? f.at.map(v => Math.round(v * 10) / 10).join(',') : ''}`

export interface FindingDiff {
  added: Finding[]
  fixed: Finding[]
  unchanged: number
}

export function diffFindings(prev: Finding[], next: Finding[]): FindingDiff {
  const left = new Map<string, Finding[]>()
  for (const f of prev) {
    const k = diffKey(f)
    left.set(k, [...(left.get(k) ?? []), f])
  }
  const added: Finding[] = []
  let unchanged = 0
  for (const f of next) {
    const l = left.get(diffKey(f))
    if (l?.length) {
      l.pop()
      unchanged++
    } else added.push(f)
  }
  return { added, fixed: [...left.values()].flat(), unchanged }
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
      if (e.f.kind === 'drc' && e.f.rule === 'route-failed' && e.f.net) {
        const s = failed.get(e.f.net) ?? new Set<string>()
        failed.set(e.f.net, s)
        s.add(e.f.route ?? '')
      }
    const folded = new Map<string, Line[]>()
    const keyOf = (e: Line): string | null => {
      if (e.f.kind === 'drc' && e.f.rule === 'unconnected') return e.f.net && failed.has(e.f.net) ? `net|${e.f.net}` : null
      if (e.f.part && e.f.rule !== 'route-failed') return `part|${e.f.kind}|${e.f.rule}|${e.f.severity}|${e.f.part}`
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
        const ids = [...failed.get(f.net!)!].filter(Boolean)
        const msg = `net ${f.net} is not fully connected${n > 1 ? ` in ${n} places` : ''}: ${ids.length > 1 ? `routes ${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : ids.length ? `route ${ids[0]}` : 'a route of it'} failed, see route-failed`
        out.push({ f, n: 1, count: n, targets: targetsOf, text: [SEV[f.severity], f.rule, f.net].join('  ') + `: ${msg}` })
      } else {
        const head = [SEV[f.severity], f.kind === 'erc' ? `ERC ${f.rule}` : f.rule, refsText(f.refs), f.src && f.via ? `${f.src} via ${f.via}` : f.src].filter(Boolean).join('  ')
        out.push({
          f,
          n: 1,
          count: n,
          targets: targetsOf,
          text: `${head}: ${n} findings on ${f.part}, the first at ${f.at ? fmtPt(f.at) : '-'}${f.layer ? ` on ${f.layer}` : ''}: ${f.message}`,
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
    g.lines.push(`${e.text ?? findingLine(e.f)}${!e.text && e.n > 1 ? `  x${e.n}` : ''}${who}`)
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
export const boardLabel = (b: Pick<Board, 'name' | 'revision' | 'variant'>): string => `${b.name}${b.revision ? ' ' + b.revision : ''}${b.variant ? ` [${b.variant.name}]` : ''}`

const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function boardLine(b: Board, entry: string, ms: number): string {
  const s = b.stats
  const t = timingsText((b as Board & { timings?: unknown }).timings)
  const stats = [unit(s.footprints, 'footprint'), unit(s.pads, 'pad'), unit(s.tracks, 'track'), unit(s.vias, 'via'), unit(s.zones, 'zone'), unit(s.nets, 'net')].join(', ')
  return `${boardLabel(b)}  ${entry}  ${stats}  ${checkText(b)}${failing(b) ? '  FAIL' : ''}  ${msText(ms)}${t ? `: ${t}` : ''}`
}

/** `routing 80 legs, 80 routed, 0 failed, 78 cached, 2 locked, 0 ripped, 0 rounds`, or '' for a board the autorouter had nothing to do on. */
export function routingText(r: RoutingReport | undefined): string {
  if (!r || (!r.legs && !r.shared)) return ''
  return `routing ${unit(r.legs, 'leg')}, ${r.routed} routed, ${r.failed} failed, ${r.cached} cached, ${r.locked} locked, ${r.ripped ?? 0} ripped, ${unit(r.rounds ?? 0, 'round')}`
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
