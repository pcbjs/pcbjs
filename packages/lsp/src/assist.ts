// The assist mode's context: a chain call or an `at` waiting for its argument at the cursor, and what the board knows of it; docs/editing.md, Assist.
import { isAbsolute, relative, resolve } from 'node:path'
import ts from 'typescript'
import type { SiteData } from '@pcbjs/core/site-data'
import { shapeOf } from '@pcbjs/core/site-shapes'
import { lengthMm, parseToken } from '@pcbjs/core/internal/units'
import { parsePoint } from './values.js'
import type { DocModel } from './doc.js'
import { siteIn } from './edits.js'
import type { AssistContext, EndCandidate, EndSlot } from '@pcbjs/core/protocol'
import type { ProjectAssist } from './host.js'
import { instanceIn } from '@pcbjs/core/internal/instances'

type Pt = [number, number]

/** The chain commands that take a point the dots can give. */
export const ASSIST_COMMANDS: ReadonlySet<string> = new Set(['L', 'l', 'H', 'h', 'V', 'v', 'X'])
/** How many arguments each command takes when written with numbers. */
const ARITY: Record<string, number> = { L: 2, l: 2, H: 1, h: 1, V: 1, v: 1, X: 1 }

/** Where the cursor waits for an argument, offsets of the text. */
export interface AssistSpot {
  /** a chain command, or `at` */
  command: string
  /** the argument text a pick replaces, inside the parentheses or the quotes */
  start: number
  end: number
  /** the method name, which a pick may change, `l` to `X` */
  name: number
  /** the call has no closing parenthesis yet: a pick writes one */
  open: boolean
  /** the arguments as typed so far */
  typed: string
  /** a chain: the `route` call's offset, its first end as written, and the calls before the cursor's */
  route?: { start: number; from: string; calls: { method: string; name: number; args: string[] }[] }
  /** an `at`: the element's `<` */
  element?: number
  /** a route end: the slot, whether a pick appends after a written end, and every end written in the call but the one replaced */
  ends?: { slot: number; append: boolean; written: string[] }
}

const unwrap = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression
  return e
}

/** The `route(...)` call a chain call hangs from, and the calls between, outermost last; null when the chain is not on a route. */
function routeOf(e: ts.Expression): { call: ts.CallExpression; calls: ts.CallExpression[] } | null {
  const calls: ts.CallExpression[] = []
  e = unwrap(e)
  for (let depth = 0; depth < 64; depth++) {
    if (!ts.isCallExpression(e)) return null
    const callee = unwrap(e.expression)
    if (ts.isIdentifier(callee)) return callee.text === 'route' ? { call: e, calls: calls.reverse() } : null
    if (!ts.isPropertyAccessExpression(callee)) return null
    calls.push(e)
    e = unwrap(callee.expression)
  }
  return null
}

/** The assist spot at an offset: inside an empty, unclosed or short argument list of a chain command, at the end of its arguments, or in an empty `at`. */
export function assistSpot(sf: ts.SourceFile, offset: number): AssistSpot | null {
  const text = sf.text
  let out: AssistSpot | null = null
  const visit = (n: ts.Node): void => {
    if (out || n.getStart(sf) > offset || n.end < offset) return
    if (ts.isCallExpression(n)) out = chainSpot(n, sf, text, offset)
    else if (ts.isJsxAttribute(n)) out = atSpot(n, sf, text, offset)
    if (!out) ts.forEachChild(n, visit)
  }
  visit(sf)
  return out ?? endSpot(text, offset)
}

function chainSpot(n: ts.CallExpression, sf: ts.SourceFile, text: string, offset: number): AssistSpot | null {
  if (!ts.isPropertyAccessExpression(n.expression)) return null
  const method = n.expression.name.text
  if (!ASSIST_COMMANDS.has(method)) return null
  const route = routeOf(n.expression.expression)
  if (!route) return null
  const paren = text.indexOf('(', n.expression.name.end)
  if (paren < 0 || offset <= paren) return null
  const closed = text[n.end - 1] === ')' && n.end - 1 > paren
  const close = closed ? n.end - 1 : lineEnd(text, paren + 1)
  if (offset > close) return null
  const typed = text.slice(paren + 1, close)
  const args = n.arguments.filter(a => a.end <= close)
  const atEnd = !typed.slice(offset - paren - 1).trim()
  const short = args.length < (ARITY[method] ?? 1) && !(args.length === 1 && ts.isStringLiteralLike(unwrap(args[0])))
  if (!(!typed.trim() || !closed || short || atEnd)) return null
  if (method === 'X' && closed && !typed.trim() && !atEnd) return null
  const from = route.call.arguments[0]
  return {
    command: method,
    start: paren + 1,
    end: close,
    name: n.expression.name.getStart(sf),
    open: !closed,
    typed,
    route: {
      start: route.call.getStart(sf),
      from: from ? from.getText(sf) : '',
      calls: route.calls.map(c => {
        const pa = c.expression as ts.PropertyAccessExpression
        return { method: pa.name.text, name: pa.name.getStart(sf), args: c.arguments.map(a => a.getText(sf)) }
      }),
    },
  }
}

/** The end of an unclosed call's partial argument: the first closer, separator or line end. */
function lineEnd(text: string, from: number): number {
  let i = from
  while (i < text.length && !/[\n)\]};]/.test(text[i])) i++
  return i
}

function atSpot(n: ts.JsxAttribute, sf: ts.SourceFile, text: string, offset: number): AssistSpot | null {
  if (!ts.isIdentifier(n.name) || n.name.text !== 'at') return null
  const init = n.initializer
  if (!init || !ts.isStringLiteral(init)) return null
  const s = init.getStart(sf) + 1
  const q = text[s - 1]
  const closed = init.end - 1 > s - 1 && text[init.end - 1] === q
  const e = closed ? init.end - 1 : s + init.text.length
  if (offset < s || offset > e || init.text.trim()) return null
  const el = n.parent.parent
  return { command: 'at', start: s, end: e, name: s, open: !closed, typed: init.text, element: el.getStart(sf) }
}

/** What the code at the cursor can name, from the language service: each value whose type is a part or a circuit instance, and every value name. */
export interface CodeScope {
  values: ScopeValue[]
  names: ReadonlySet<string>
}
export interface ScopeValue {
  /** the identifier at the cursor */
  id: string
  kind: 'part' | 'circuit'
  /** the name its declaration binds, through imports and destructuring: `CH2` for `ch2` of `import { CH2 as ch2 }` */
  origin: string
  /** the instance name a string argument of its initializing call gives, `CH2` of `ledChannel(ports, 'CH2')` */
  arg?: string
  /** a parameter, such as a layout render's `g`, which holds each instance that render lays out */
  param?: true
}

/** How the code at the cursor names a board's parts and instances. */
interface Names {
  /** the identifier holding a board-level part or a top-level instance, its own name when nothing holds it but the name is in scope, else null */
  head(own: string, kind: 'part' | 'circuit' | 'route'): string | null
  /** the board's name for an identifier the code wrote: `CH2` for `ch2` */
  back(id: string): string
}
function namesAt(site: SiteData, scope: CodeScope | undefined, rel = ''): Names {
  if (!scope) return { head: own => own, back: id => id }
  const top = site.schematic.circuits.filter(c => c.path.length === 1)
  // the instances a render in this file lays out: its parameter names each of them, the first standing for all in a written end
  const drawn = [...new Set((site.edit ?? []).flatMap(e => (e.layout && e.src.at?.file === rel ? [(instanceIn(e.frames, site.schematic.circuits) ?? '').split('/')[0]] : [])))]
  const holds = (v: ScopeValue, own: string, kind: string) =>
    v.kind === kind && (kind === 'part' ? v.origin === own : v.arg === own || top.some(c => c.path[0] === own && c.binding === v.origin) || (!!v.param && drawn.includes(own)))
  const heads = new Map<string, string | null>()
  return {
    head(own, kind) {
      const key = `${kind}:${own}`
      if (!heads.has(key)) heads.set(key, scope.values.find(v => holds(v, own, kind))?.id ?? (scope.names.has(own) ? own : null))
      return heads.get(key)!
    },
    back(id) {
      const v = scope.values.find(x => x.id === id)
      if (!v) return id
      if (v.kind === 'part') return v.origin
      return top.find(c => c.binding === v.origin || c.path[0] === v.arg)?.path[0] ?? (v.param ? drawn[0] : undefined) ?? id
    },
  }
}

/** The context of a spot on each board built from the file; `scope` names the handles as the code at the cursor can write them. */
export function assistContexts(spot: AssistSpot, doc: DocModel, boards: { root: string; site: SiteData }[], scope?: CodeScope): ProjectAssist[] {
  const file = doc.file,
    sf = doc.sf()
  return boards.flatMap((b): ProjectAssist[] => {
    if (b.site.variant && b.site.variant.index !== 0) return []
    const rel = relPath(b.root, file)
    if (!usesFile(b.site, b.root, file)) return []
    const names = namesAt(b.site, scope, rel)
    const base = {
      project: b.root,
      board: b.site.name,
      command: spot.command,
      relative: /^[lhv]$/.test(spot.command),
      typed: typedMm(spot.typed),
      file,
      start0: spot.start,
      end0: spot.end,
      name0: spot.name,
      open: spot.open,
    }
    if (spot.element !== undefined) return [{ ...base, ...placed(b.site, rel, sf, spot.element) }]
    if (spot.ends) return [{ ...base, ...ended(b.site, rel, sf, spot, names) }]
    return [{ ...base, ...chained(b.site, rel, sf, spot, names) }]
  })
}

const relPath = (root: string, file: string) => relative(root, file).split('\\').join('/')
const abs = (root: string, f: string) => (isAbsolute(f) ? f : resolve(root, f))
function usesFile(site: SiteData, root: string, file: string): boolean {
  return Object.keys(site.sources ?? {}).some(k => abs(root, k) === file) || site.footprints.some(f => f.src && abs(root, f.src.file) === file)
}

/** Numbers of a typed argument list in mm: `9`, `'2mm'`, `5, 16` or `'5 16'`. */
function typedMm(typed: string): number[] {
  return typed
    .replace(/['"`]/g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(t => parseToken(t))
    .map(t => (t ? lengthMm(t) : undefined))
    .filter((v): v is number => v !== undefined && Number.isFinite(v))
}

const sideOfLayer = (l: string | null): 'F' | 'B' | null => (l === 'F.Cu' ? 'F' : l === 'B.Cu' ? 'B' : null)
const unquote = (s: string) => s.replace(/^['"`]|['"`]$/g, '')

/** A route's start for the calls typed so far: the compiled point before the cursor's call, else the first end. */
type Resolved = Pick<AssistContext, 'ref' | 'start' | 'pad' | 'layer' | 'net' | 'side' | 'grid' | 'width'>

function chained(site: SiteData, rel: string, sf: ts.SourceFile, spot: AssistSpot, names: Names): Resolved {
  const r = spot.route!
  const at = siteIn(sf, r.start)
  const node = site.edit?.find(e => e.src.chain && e.src.chain.file === rel && e.src.chain.line === at.line && e.src.chain.col === at.col) ?? null
  const info = node ? site.routes?.find(x => x.id === node.ref) : undefined
  const first = firstEnd(site, r.from, names)
  // the steps written before the cursor's call, each ending at the next point
  const before = node?.steps?.filter(s => s.src && posBefore(s.src, siteIn(sf, spot.name))).length ?? 0
  const moved = r.calls.some(c => /^([LlHhVvAaX]|via)$/.test(c.method))
  const start = info?.pts?.[before] ?? (moved ? null : first.at)
  let layer = first.layer
  let width: number | null = null
  let net = info?.net ?? first.net
  for (const c of r.calls) {
    if (c.method === 'layer' && c.args[0]) layer = unquote(c.args[0])
    if (c.method === 'via' && c.args[0]) layer = unquote(c.args[0])
    if (c.method === 'width' && c.args[0]) width = typedMm(c.args[0])[0] ?? width
    if (c.method === 'net' && c.args[0] && !net) net = c.args[0]
  }
  width ??= (site.items ?? []).find(it => it.kind === 'track' && node && it.route === node.ref)?.width ?? site.rules.minTrackWidth ?? null
  return {
    ref: node?.ref ?? null,
    start: start ? ([start[0], start[1]] as Pt) : null,
    pad: moved ? null : first.pad,
    layer,
    net: net ?? null,
    side: sideOfLayer(layer),
    grid: gridAround(site, rel, sf, r.start),
    width,
  }
}

const posBefore = (a: { line: number; col: number }, b: { line: number; col: number }) => a.line < b.line || (a.line === b.line && a.col < b.col)

/** The first end of a route as written: a pad handle `J1[1]`, `U1.VIN` or `ch2.R[2]`, a route point, or a coordinate string. */
function firstEnd(site: SiteData, written: string, names: Names): { at: Pt | null; layer: string; net: string | null; pad: string | null } {
  const from = written.trim().replace(/^[A-Za-z_$][\w$]*/, id => names.back(id))
  const pt = /^['"`](.*)['"`]$/.exec(from.trim())
  if (pt) {
    const p = parsePoint(pt[1])
    const x = p && lengthMm(p.x),
      y = p && lengthMm(p.y)
    return { at: x !== undefined && y !== undefined ? [x!, y!] : null, layer: p?.layer ?? 'F.Cu', net: null, pad: null }
  }
  const point = /^([\w.]+)\.(start|end|pt\(\s*(\d+)\s*\))$/.exec(from.trim())
  const route = point && (site.routes ?? []).find(r => routeHandle(r) === point[1])
  if (route?.pts?.length) {
    const k = point![2] === 'start' ? 0 : point![2] === 'end' ? route.pts.length - 1 : +point![3]
    const p = route.pts[k]
    if (p) return { at: [p[0], p[1]], layer: 'F.Cu', net: route.net ?? null, pad: null }
  }
  const m = /^([\w.]+?)(?:\[\s*['"`]?([\w+\-]+)['"`]?\s*\]|\.([\w+\-]+))$/.exec(from.trim())
  if (!m) return { at: null, layer: 'F.Cu', net: null, pad: null }
  const key = m[2] ?? m[3]
  const fp = site.footprints.find(f => f.ref === m[1]) ?? partByLocal(site, m[1]) ?? partByExport(site, m[1])
  const pad = fp?.pads.find(p => p.num === key) ?? fp?.pads.find(p => p.name === key)
  if (!fp || !pad) return { at: null, layer: 'F.Cu', net: null, pad: null }
  return { at: [pad.at[0], pad.at[1]], layer: fp.side === 'B' ? 'B.Cu' : 'F.Cu', net: pad.net ?? null, pad: `${fp.ref}/${pad.num}` }
}

/** A part named as the code names a member, `CH1.R` for the part at path CH1 with the local name R. */
function partByLocal(site: SiteData, name: string) {
  const parts = name.split('.')
  const local = parts.pop()!
  const sp = site.schematic.parts.find(p => p.local === local && p.path.join('/') === parts.join('/'))
  return sp ? site.footprints.find(f => f.ref === sp.ref) : undefined
}

/** A board-level part named by its export, `led` for the part the compiler called D1. */
function partByExport(site: SiteData, name: string) {
  const sp = site.schematic.parts.find(p => !p.path.length && p.export?.name === name)
  return sp ? site.footprints.find(f => f.ref === sp.ref) : undefined
}

/** The innermost grid whose attaching element holds the offset, else the board's. */
function gridAround(site: SiteData, rel: string, sf: ts.SourceFile, offset: number): string | null {
  const grids = (site.grids ?? []).filter(g => g.attach && g.attach.file === rel)
  if (!grids.length) return null
  let best: string | null = null
  const visit = (n: ts.Node): void => {
    if (n.getStart(sf) > offset || n.end < offset) return
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const at = siteIn(sf, n.getStart(sf))
      const g = grids.find(x => x.attach!.line === at.line && x.attach!.col === at.col)
      if (g) best = g.name
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return best
}

/** An `at` waiting for its value: the part its element placed, its side and its grid. */
function placed(site: SiteData, rel: string, sf: ts.SourceFile, element: number): Resolved {
  const at = siteIn(sf, element)
  const node = site.edit?.find(e => e.src.at && e.src.at.file === rel && e.src.at.line === at.line && e.src.at.col === at.col) ?? null
  return { ref: node?.ref ?? null, start: null, pad: null, layer: null, net: null, side: node?.side ?? 'F', grid: node?.grid ?? null, width: null }
}

/** Where a `route(` call waits for an end: an empty slot, a partial name being typed, or the end of a written end, which a pick follows. */
export function endSpot(text: string, offset: number): AssistSpot | null {
  const paren = openParen(text, offset)
  if (paren < 0) return null
  const name = /\broute\s*$/.exec(text.slice(Math.max(0, paren - 64), paren))
  if (!name) return null
  const name0 = paren - name[0].length
  if (name0 > 0 && /[\w$.]/.test(text[name0 - 1])) return null
  const args = argSpans(text, paren + 1)
  const slot = args.spans.findIndex(([s, e]) => offset >= s && offset <= e)
  if (slot < 0) return null
  const [s, e] = args.spans[slot]
  const raw = text.slice(s, e)
  const lead = raw.length - raw.trimStart().length
  const typed = text.slice(s + lead, offset)
  if (text.slice(offset, e).trim()) return null
  const arg = (k: number) => text.slice(args.spans[k][0], args.spans[k][1]).trim()
  if (arg(0).startsWith('[')) return null
  const done = /([\])'"`]|\.start|\.end)$/.test(typed)
  if (typed && !done && !/^[A-Za-z_$][\w$.]*(\[\s*['"`]?[\w+\-]*)?$/.test(typed)) return null
  const append = done
  const written = args.spans.map((_, k) => arg(k)).filter((a, k) => a && (append || k !== slot))
  return {
    command: 'end',
    start: append ? offset : s + lead,
    end: offset,
    name: name0,
    open: !args.closed,
    typed,
    ends: { slot, append, written },
  }
}

const OPEN = '([{',
  CLOSE = ')]}'
/** The `(` whose argument list holds the offset at its own depth, else -1. */
function openParen(text: string, offset: number): number {
  let depth = 0
  for (let i = offset - 1, n = 0; i >= 0 && n < 4000; i--, n++) {
    const c = text[i]
    if (CLOSE.includes(c)) depth++
    else if (OPEN.includes(c)) {
      if (depth === 0) return c === '(' ? i : -1
      depth--
    } else if (c === ';' && depth === 0) return -1
  }
  return -1
}

/** The spans of the arguments after a `(`, split at commas of its own depth, and whether a `)` closes them; a line that starts JSX ends an unclosed one. */
function argSpans(text: string, from: number): { spans: [number, number][]; closed: boolean } {
  const spans: [number, number][] = []
  let depth = 0,
    s = from,
    q = ''
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === q) q = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') q = c
    else if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) {
      if (depth === 0) {
        spans.push([s, i])
        return { spans, closed: c === ')' }
      }
      depth--
    } else if (c === ',' && depth === 0) {
      spans.push([s, i])
      s = i + 1
    } else if ((c === '\n' && depth === 0 && /^\s*[<{}/]/.test(text.slice(i + 1, i + 80))) || c === ';') {
      spans.push([s, i])
      return { spans, closed: false }
    }
  }
  spans.push([s, text.length])
  return { spans, closed: false }
}

/** The context of a route end slot: the first end, and every pad and bound route point as a candidate, its net first. */
function ended(site: SiteData, rel: string, sf: ts.SourceFile, spot: AssistSpot, names: Names): Resolved & { ends: EndSlot } {
  const e = spot.ends!
  const first = e.slot > 0 || e.append ? firstEnd(site, e.written[0] ?? '', names) : null
  const at = siteIn(sf, spot.name)
  const own = site.edit?.find(n => n.src.chain && n.src.chain.file === rel && n.src.chain.line === at.line && n.src.chain.col === at.col)?.ref ?? null
  const net = first?.net ?? null
  const taken = new Set(e.written.map(w => w.replace(/\s+/g, '')))
  const every = [...padCandidates(site, names), ...pointCandidates(site, own, names)]
  const open = new Set(site.ratsnest.map(r => r.net))
  let all: Candidate[]
  if (net) {
    // the far ends A can legally reach: its net's terminals on another island than A's
    const island = islandsOf(site, net)
    const home = every.find(c => c.ref === first?.pad || c.handle === e.written[0]?.replace(/\s+/g, ''))
    const mine = home ? island(home) : null
    all = every.filter(c => c.net === net && (mine === null || island(c) !== mine))
  } else all = every.filter(c => !!c.net && open.has(c.net))
  all = all.filter(c => !taken.has(c.handle) && c.ref !== first?.pad).sort((a, b) => natural(a.handle, b.handle))
  const out = [...new Set(all.flatMap(c => (c.out ? [c.out] : [])))].sort(natural)
  return {
    ref: own,
    start: first?.at ?? null,
    pad: first?.pad ?? null,
    layer: first?.layer ?? null,
    net,
    side: sideOfLayer(first?.layer ?? null),
    grid: null,
    width: null,
    ends: {
      slot: e.slot,
      append: e.append,
      net,
      candidates: all.filter(c => !c.out).map(({ out: _, ...c }) => c),
      ...(out.length ? { notes: out.map(n => `${n} is not in scope here`) } : {}),
    },
  }
}

/** A candidate before the scope check: `out` names the part or instance no identifier at the cursor reaches. */
type Candidate = EndCandidate & { out?: string }

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
const labelOf = (head: string, net: string | null | undefined) => (net ? `${head} · ${net}` : head)

/** How code names a part: its export at the board level, else its instance path and local name, `CH2.R`. */
export function partHandle(site: SiteData, ref: string): string {
  const sp = site.schematic.parts.find(p => p.ref === ref)
  if (!sp) return ref
  return sp.path.length ? [...sp.path, sp.local].join('.') : (sp.export?.name ?? sp.local ?? ref)
}
/** A pad's handle: `J1[2]` by number, `J1['B4']` when the number is not one. */
export const padHandle = (part: string, num: string) => (/^\d+$/.test(num) ? `${part}[${num}]` : `${part}['${num}']`)

/** A part's handle as the code at the cursor writes it, `ch2.R` for the part R of the instance `ch2` holds; `out` the name nothing in scope reaches. */
function scopedPart(site: SiteData, ref: string, names: Names): { part: string; out?: string } {
  const own = partHandle(site, ref).split('.')
  const kind = site.schematic.parts.find(p => p.ref === ref)?.path.length ? 'circuit' : 'part'
  const head = names.head(own[0], kind)
  return head === null ? { part: own.join('.'), out: own[0] } : { part: [head, ...own.slice(1)].join('.') }
}

function padCandidates(site: SiteData, names: Names): Candidate[] {
  return site.footprints.flatMap(fp => {
    const { part, out } = scopedPart(site, fp.ref, names)
    return fp.pads
      .filter(p => p.num)
      .map(p => ({
        ...(out ? { out } : {}),
        handle: padHandle(part, p.num),
        label: labelOf(p.name && p.name !== p.num ? `${p.num} ${p.name}` : p.num, p.net),
        kind: 'pad' as const,
        ref: `${fp.ref}/${p.num}`,
        num: p.num,
        ...(p.name ? { name: p.name } : {}),
        net: p.net ?? null,
        at: [p.at[0], p.at[1]] as Pt,
        side: fp.side,
      }))
  })
}

/** A bound route's handle, `vccTrunk` or `CH2.vccTrunk` for one an instance's layout made; null for a route known by number. */
function routeHandle(r: { id: string }): string | null {
  const m = /^(?:(.+)\/)?route:([^/]+)$/.exec(r.id)
  if (!m || /^\d+$/.test(m[2])) return null
  return m[1] ? `${m[1].split('/').join('.')}.${m[2]}` : m[2]
}

/** The points of every bound route but the one being written: `.start`, `.pt(k)` and `.end`, through the instance's identifier at the cursor. */
function pointCandidates(site: SiteData, own: string | null, names: Names): Candidate[] {
  return (site.routes ?? []).flatMap(r => {
    const h = routeHandle(r)?.split('.')
    const pts = r.pts ?? []
    if (!h || r.id === own || !pts.length) return []
    const head = names.head(h[0], h.length > 1 ? 'circuit' : 'route')
    const route = [head ?? h[0], ...h.slice(1)].join('.')
    const last = pts.length - 1
    return pts.map((p, k) => {
      const end = k === 0 ? 'start' : k === last ? 'end' : `pt(${k})`
      return {
        ...(head === null ? { out: h[0] } : {}),
        handle: `${route}.${end}`,
        label: labelOf(k === 0 || k === last ? end : `pt ${k}`, r.net),
        kind: 'point' as const,
        ref: `${r.id}/pt:${k}`,
        net: r.net ?? null,
        at: [p[0], p[1]] as Pt,
        side: 'F' as const,
      }
    })
  })
}

/** The edit a pick of `handle` makes in an end slot: `, J1[2]` after a written end, else the handle in place; `next` follows a lone first end with `, ` so the cursor waits in the second slot. */
export function endEdit(text: string, a: { start0: number; end0: number; ends?: EndSlot }, handle: string, next = false): { start: number; end: number; newText: string } {
  if (a.ends?.append) return { start: a.start0, end: a.end0, newText: `, ${handle}` }
  const pre = text[a.start0 - 1] === ',' ? ' ' : ''
  const lone = a.ends?.slot === 0 && !/^\s*,/.test(text.slice(a.end0))
  return { start: a.start0, end: a.end0, newText: `${pre}${handle}${next && lone ? ', ' : ''}` }
}

/** The completion of an end slot: the candidates and labels the views annotate, merged over the boards. */
export function endCompletions(
  text: string,
  contexts: AssistContext[],
): { handle: string; label: string; kind: 'pad' | 'point'; boards: string[]; edit: { start: number; end: number; newText: string } }[] {
  const out = new Map<string, ReturnType<typeof endCompletions>[number]>()
  for (const c of contexts)
    for (const k of c.ends?.candidates ?? []) {
      const had = out.get(k.handle)
      if (had) had.boards.push(c.board)
      else out.set(k.handle, { handle: k.handle, label: k.label, kind: k.kind, boards: [c.board], edit: endEdit(text, c, k.handle) })
    }
  return [...out.values()]
}

type Ring = readonly (readonly [number, number])[]
type Box = [number, number, number, number]
const boxOf = (rings: readonly Ring[]): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of rings)
    for (const [x, y] of r) {
      b[0] = Math.min(b[0], x)
      b[1] = Math.min(b[1], y)
      b[2] = Math.max(b[2], x)
      b[3] = Math.max(b[3], y)
    }
  return b
}
function inside(p: readonly [number, number], r: Ring): boolean {
  let n = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) n = !n
  return n
}
function crossing(a: Ring, b: Ring): boolean {
  const o = (p: readonly number[], q: readonly number[], r: readonly number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  for (let i = 0, j = a.length - 1; i < a.length; j = i++)
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) if (o(a[j], a[i], b[l]) !== o(a[j], a[i], b[k]) && o(b[l], b[k], a[j]) !== o(b[l], b[k], a[i])) return true
  return false
}
/** Two copper outlines touch: an edge crosses, or one holds a corner of the other. */
const touch = (a: readonly Ring[], b: readonly Ring[]) => a.some(r => b.some(q => crossing(r, q) || (q.length > 0 && inside(q[0], r)) || (r.length > 0 && inside(r[0], q))))

/** The island of each terminal of a net: its pads, tracks, vias and pours joined where their copper touches on a shared layer, as the routed connectivity joins them. */
function islandsOf(site: SiteData, net: string): (c: EndCandidate) => number | null {
  const items = (site.items ?? []).filter(it => it.net === net && it.kind !== 'graphic' && it.kind !== 'text' && shapeOf(site, it.id).length)
  const up = items.map((_, i) => i)
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])))
  const boxes = items.map(it => boxOf(shapeOf(site, it.id)))
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = boxes[i],
        b = boxes[j]
      if (a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3]) continue
      if (!items[i].layers.some(l => items[j].layers.includes(l))) continue
      if (find(i) !== find(j) && touch(shapeOf(site, items[i].id), shapeOf(site, items[j].id))) up[find(i)] = find(j)
    }
  return c => {
    const route = c.kind === 'point' ? c.ref.replace(/\/pt:\d+$/, '') : null
    const i = items.findIndex(it =>
      route ? it.route === route : it.kind === 'pad' && it.ref === c.ref.slice(0, c.ref.lastIndexOf('/')) && shapeOf(site, it.id).some(r => inside(c.at, r)),
    )
    return i < 0 ? null : find(i)
  }
}
