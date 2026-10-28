// Offsets are UTF-16 code units of the document text.

import { detect, encodeValue, type Hit } from './detect.js'
import { summary } from './describe.js'
import { commands, parsePath, setCommand, validate, serialise, type Grammar, type Row } from './path-model.js'
import {
  angleDeg,
  canonicalLayer,
  formatAt,
  formatNum,
  formatPoint,
  formatToken,
  layerChoices,
  lengthMm,
  nudgeAt,
  numericRange,
  parseAt,
  parsePoint,
  parseToken,
  rotateAt,
  toggleSide,
  withDeg,
  withMm,
  type Token,
} from './values.js'
import type { Constraints, SegmentKind } from './protocol.js'

export interface OffsetEdit {
  start: number
  end: number
  newText: string
}
export interface RawPresentation {
  label: string
  detail?: string
  edit: OffsetEdit
}
export interface RawSegment {
  start: number
  end: number
  kind: SegmentKind
  value: string
  label: string
  constraints: Constraints
  presentations: RawPresentation[]
  error?: string
  /** the literal the segment is in */
  hit: Hit
}

export interface PadFact {
  num: string
  name: string
  net?: string
}

/** What the segments may know of the compiled board: its layer names and the pads of a part by ref. */
export interface SegmentContext {
  layers?: string[]
  /** the pads of a part as the code names it: a ref, a variable, or a member of an instance or group such as `A.CF` */
  pads?(ref: string): PadFact[] | undefined
  /** the functions of this file's call sites that made routes, whose pad arguments are route ends */
  routeHelpers?: ReadonlySet<string>
}

const COPPER_OWNERS = new Set(['route', 'track', 'via', 'zone'])
const PRESETS_MM = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
const IMPEDANCES = [50, 85, 90, 100]

/** Every segment of a file, in document order. */
export function segmentsOf(text: string, fileName: string, ctx: SegmentContext = {}): RawSegment[] {
  let hits: Hit[] = []
  try {
    hits = detect(text, fileName, { routeHelpers: ctx.routeHelpers })
  } catch {
    return []
  }
  return hits.flatMap(h => build(h, ctx))
}

/** The innermost segment at an offset with its presentations computed for writing `value`, or with `error` set. */
export function typedSegment(text: string, fileName: string, ctx: SegmentContext, offset: number, value: string): RawSegment | undefined {
  const seg = innermost(segmentsOf(text, fileName, ctx), offset)
  if (!seg) return undefined
  const r = typedEdit(seg, value, ctx)
  if ('error' in r) return { ...seg, presentations: [], error: r.error }
  return { ...seg, presentations: [{ label: r.newText === seg.value ? seg.value : r.label, edit: r.edit }] }
}

export function innermost<T extends { start: number; end: number }>(segs: T[], offset: number): T | undefined {
  let best: T | undefined
  for (const s of segs) if (s.start <= offset && offset <= s.end && (!best || s.end - s.start < best.end - best.start)) best = s
  return best
}

/** The edit that writes a new value into the whole literal of a hit, or the reason it cannot. */
function write(hit: Hit, value: string): OffsetEdit | { error: string } {
  const enc = encodeValue(hit, value)
  if ('error' in enc) return enc
  return { start: hit.start, end: hit.end, newText: enc.text }
}

function pres(hit: Hit, value: string, detail?: string, label = value): RawPresentation[] {
  if (value === hit.value) return []
  const e = write(hit, value)
  return 'error' in e ? [] : [{ label, ...(detail ? { detail } : {}), edit: e }]
}

const isCopper = (h: Hit) => !!h.context.chain || COPPER_OWNERS.has(h.context.owner) || (h.context.owner === 'pad' && h.context.prop === 'layers')

function title(h: Hit): string {
  const c = h.context
  return `${c.owner || 'value'} ${c.prop}${c.index !== undefined ? `[${c.index}]` : ''}`
}

function base(h: Hit, kind: SegmentKind, constraints: Constraints = {}): RawSegment {
  return { start: h.start, end: h.end, kind, value: h.value, label: title(h), constraints, presentations: [], hit: h }
}

function build(h: Hit, ctx: SegmentContext): RawSegment[] {
  switch (h.kind) {
    case 'at':
    case 'point':
      return [position(h, ctx)]
    case 'rotation':
      return [angle(h)]
    case 'layer': {
      const copper = isCopper(h)
      const choices = layerChoices(ctx.layers, copper)
      const current = canonicalLayer(h.value) ?? h.value
      const s = base(h, 'layer', { choices: choices.map(l => l.name) })
      s.presentations = choices.filter(l => l.name !== current).flatMap(l => pres(h, l.name, l.aliases.join(', ') || undefined))
      return [s]
    }
    case 'side': {
      const s = base(h, 'enum', { choices: ['F', 'B'] })
      const next = toggleSide(h.value)
      if (next) s.presentations = pres(h, next, /^(b|bottom|back)$/i.test(next) ? 'back side, mirrored' : 'front side')
      return [s]
    }
    case 'copper': {
      const s = base(h, 'enum', { choices: ['2', '4', '6', '8'] })
      s.presentations = ['2', '4', '6', '8'].flatMap(n => pres(h, n, `${n} copper layers`))
      return [s]
    }
    case 'number': {
      const n = Number(h.value)
      const s = base(h, 'number', h.context.prop === 'impedance' ? { unit: 'ohm', min: 1, step: 1 } : { step: 1 })
      const values = h.context.prop === 'impedance' ? IMPEDANCES : [n - 1, n + 1]
      s.presentations = values.flatMap(v => pres(h, formatNum(v), h.context.prop === 'impedance' ? `${v} ohm` : undefined))
      return [s]
    }
    case 'size':
    case 'width':
    case 'thickness':
    case 'drill':
    case 'length':
      return [length(h)]
    case 'routePath':
    case 'svgPath':
      return pathSegments(h, ctx)
    case 'pinRef':
      return [pin(h, ctx)]
    case 'chainCommand':
      return [chainSegment(h, ctx)]
  }
}

const quoteOf = (h: Hit) => /^(['"`])/.exec(h.context.args?.find(a => /^['"`]/.test(a)) ?? '')?.[1] ?? "'"

function chainSegment(h: Hit, ctx: SegmentContext): RawSegment {
  const m = h.context.prop
  const args = h.context.args ?? []
  const s: RawSegment = {
    start: h.start,
    end: h.end,
    kind: 'pathCommand',
    value: h.value,
    label: `route chain, .${m}()`,
    constraints: { grammar: 'chain', choices: [...CHAIN_NAMES] },
    presentations: [],
    hit: h,
  }
  const out: RawPresentation[] = []
  const put = (text: string, detail: string, label = text) => {
    if (text !== h.value) out.push({ label, detail, edit: { start: h.start, end: h.end, newText: text } })
  }
  const q = quoteOf(h)
  const up = m.toUpperCase()
  const rel = m !== up && m !== 'via'
  if (m === 'Z' || m === 'X') put(`${m === 'Z' ? 'X' : 'Z'}(${args.join(', ')})`, m === 'Z' ? 'autoroute this leg' : 'a straight track')
  else if (m === 'via') {
    const cur = canonicalLayer(args[0]?.replace(/^['"`]|['"`]$/g, '') ?? '')
    for (const l of layerChoices(ctx.layers, true)) if (l.name !== cur) put(`via(${q}${l.name}${q})`, `via to ${l.name}`)
  } else if (up === 'H' || up === 'V') {
    const other = up === 'H' ? 'V' : 'H'
    put(`${rel ? other.toLowerCase() : other}(${args[0] ?? '0'})`, `a ${other === 'H' ? 'horizontal' : 'vertical'} track`)
  } else if (up === 'L' && args.length === 2) {
    put(`${rel ? 'h' : 'H'}(${args[0]})`, 'a horizontal track')
    put(`${rel ? 'v' : 'V'}(${args[1]})`, 'a vertical track')
  }
  if (m !== 'Z' && m !== 'X') {
    if (m !== 'via') for (const l of ['F.Cu', 'B.Cu']) put(`${h.value}.via(${q}${l}${q})`, `add a via to ${l} after it`)
    out.push({ label: 'delete', detail: 'delete this command', edit: { start: h.context.dot ?? h.start, end: h.end, newText: '' } })
  }
  s.presentations = out
  return s
}

const CHAIN_NAMES = ['L', 'l', 'H', 'h', 'V', 'v', 'via', 'Z', 'X']

/** A typed chain command, `V 16`, `V(16)`, `@B.Cu`, `via B.Cu` or `X`, as the call text, or why it cannot be. */
function chainText(h: Hit, typed: string): string | { error: string } {
  const m = /^\s*(@|[A-Za-z]+)\s*\(?\s*(.*?)\s*\)?\s*$/.exec(typed)
  if (!m) return { error: 'a chain command, such as V 14, L 5 16, @B.Cu or X' }
  const name = m[1] === '@' ? 'via' : m[1] === 'U' || m[1] === 'u' ? 'via' : m[1]
  if (!CHAIN_NAMES.includes(name)) return { error: `${name} is not a chain command: L, l, H, h, V, v, via, Z or X` }
  const raw = m[2].split(/\s*,\s*|\s+/).filter(Boolean)
  const wasEnd = h.context.prop === 'Z' || h.context.prop === 'X'
  if (wasEnd && name !== 'Z' && name !== 'X') return { error: 'this command ends the route: it stays .Z() or .X()' }
  const q = quoteOf(h)
  if (name === 'Z' || name === 'X') return `${name}(${raw.length ? m[2] : (h.context.args ?? []).join(', ')})`
  if (name === 'via') {
    const l = raw[0]?.replace(/^['"`]|['"`]$/g, '')
    if (!l || (!canonicalLayer(l) && !/^[A-Za-z0-9._]+$/.test(l))) return { error: 'via needs a layer, such as B.Cu' }
    return `via(${q}${l}${q})`
  }
  const n = name.toUpperCase() === 'L' ? 2 : 1
  if (raw.length !== n) return { error: `${name} takes ${n === 2 ? 'x and y' : 'one length'}` }
  const lit: string[] = []
  for (const a of raw) {
    const t = parseToken(a)
    if (!t || lengthMm(t) === undefined) return { error: `${JSON.stringify(a)} is not a length` }
    lit.push(t.unit ? `${q}${a}${q}` : a)
  }
  return `${name}(${lit.join(', ')})`
}

function length(h: Hit): RawSegment {
  const t = parseToken(h.value) as Token
  const mm = lengthMm(t) ?? 0
  const r = numericRange(h.kind === 'length' ? 'length' : h.kind, h.context.owner, mm)
  const k = mm && t.num ? mm / t.num : 1
  const unit = t.unit || 'mm'
  const s = base(h, 'length', { unit, min: r.min / k, max: r.max / k, step: r.step / k })
  const set = (v: number) => formatToken(withMm(t, v))
  const out: RawPresentation[] = []
  if (mm - r.step >= r.min - 1e-9) out.push(...pres(h, set(mm - r.step), `-${formatNum(r.step)} mm`))
  if (mm + r.step <= r.max + 1e-9) out.push(...pres(h, set(mm + r.step), `+${formatNum(r.step)} mm`))
  for (const v of PRESETS_MM) if (v >= r.min - 1e-9 && v <= r.max + 1e-9 && Math.abs(v - mm) > 1e-9) out.push(...pres(h, set(v), `${formatNum(v)} mm`))
  s.presentations = dedupe(out)
  return s
}

function angle(h: Hit): RawSegment {
  const t = parseToken(h.value) as Token
  const deg = angleDeg(t) ?? 0
  const s = base(h, 'angle', { unit: t.unit || 'deg', min: 0, max: 360, step: 90 })
  const norm = (d: number) => ((d % 360) + 360) % 360
  const out: RawPresentation[] = []
  out.push(...pres(h, formatToken(withDeg(t, norm(deg + 90))), 'turn 90° counter-clockwise'))
  out.push(...pres(h, formatToken(withDeg(t, norm(deg - 90))), 'turn 90° clockwise'))
  for (const d of [0, 90, 180, 270]) if (Math.abs(norm(deg) - d) > 1e-9) out.push(...pres(h, formatToken(withDeg(t, d)), `${d}°`))
  s.presentations = dedupe(out)
  return s
}

function position(h: Hit, ctx: SegmentContext): RawSegment {
  const s = base(h, 'position', { unit: 'mm', step: 0.1 })
  const out: RawPresentation[] = []
  const moves: [string, number, number][] = [
    ['x -1 mm', -1, 0],
    ['x -0.1 mm', -0.1, 0],
    ['x +0.1 mm', 0.1, 0],
    ['x +1 mm', 1, 0],
    ['y -1 mm', 0, -1],
    ['y -0.1 mm', 0, -0.1],
    ['y +0.1 mm', 0, 0.1],
    ['y +1 mm', 0, 1],
  ]
  if (h.kind === 'at') {
    const a = parseAt(h.value)
    if (a) {
      for (const [d, dx, dy] of moves) out.push(...pres(h, formatAt(nudgeAt(a, dx, dy)), d))
      out.push(...pres(h, formatAt(rotateAt(a, 90)), 'turn 90° counter-clockwise'))
      out.push(...pres(h, formatAt(rotateAt(a, -90)), 'turn 90° clockwise'))
    }
  } else {
    const p = parsePoint(h.value)
    if (p) {
      for (const [d, dx, dy] of moves) out.push(...pres(h, formatPoint({ ...p, x: withMm(p.x, (lengthMm(p.x) ?? 0) + dx), y: withMm(p.y, (lengthMm(p.y) ?? 0) + dy) }), d))
      const current = p.layer ? (canonicalLayer(p.layer) ?? p.layer) : undefined
      for (const l of layerChoices(ctx.layers, true)) if (l.name !== current) out.push(...pres(h, formatPoint({ ...p, layer: l.name }), `on ${l.name}`))
    }
  }
  s.presentations = out
  return s
}

function pin(h: Hit, ctx: SegmentContext): RawSegment {
  const ref = h.context.ref ?? ''
  const pads = ctx.pads?.(ref) ?? []
  const current = h.context.form === 'dotted' ? h.value.slice(ref.length + 1) : h.value
  // a string can name the pin as well as the pad number, `'U2.IN'` or `U2['IN']`; a number literal and `.pad()` only the number
  const named = (p: PadFact) => h.context.quote !== 'number' && h.context.form !== 'pad' && !!p.name && p.name !== p.num && /^[\w+\-]+$/.test(p.name)
  const s = base(h, 'pinRef', { choices: [...new Set([...pads.map(p => p.num), ...pads.filter(named).map(p => p.name!)])] })
  s.label = `pad of ${ref}`
  const text = (v: string) => (h.context.form === 'dotted' ? `${ref}.${v}` : v)
  s.presentations = pads.flatMap(p => {
    const net = p.net ?? 'no net'
    const out: RawPresentation[] = []
    if (p.num !== current && (h.context.quote !== 'number' || /^\d+$/.test(p.num)))
      out.push(...pres(h, text(p.num), [p.name && p.name !== p.num ? p.name : '', net].filter(Boolean).join(' · '), `${ref}.${p.num}`))
    if (named(p) && p.name !== current) out.push(...pres(h, text(p.name!), `pad ${p.num} · ${net}`, `${ref}.${p.name}`))
    return out
  })
  return s
}

/** One segment per command, each edit confined to the command's own text. */
function pathSegments(h: Hit, ctx: SegmentContext): RawSegment[] {
  const grammar: Grammar = h.kind === 'routePath' ? 'route' : 'svg'
  const { rows } = parsePath(h.value, grammar)
  const copper = layerChoices(ctx.layers, true).map(l => l.name)
  return rows.map((row, i) => {
    const start = h.start + (row.start ?? 0)
    const end = h.start + (row.end ?? h.value.length)
    const value = h.value.slice(row.start ?? 0, row.end ?? h.value.length)
    const s: RawSegment = {
      start,
      end,
      kind: 'pathCommand',
      value,
      label: `${grammar === 'route' ? 'route path' : 'path data'}, command ${i + 1}`,
      constraints: { grammar, index: i, choices: commands(grammar) },
      presentations: [],
      hit: h,
    }
    const out: RawPresentation[] = []
    const put = (text: string, detail: string, label = text) => {
      const e = spliceRow(h, rows, i, text, grammar)
      if (!('error' in e)) out.push({ label, detail, edit: e })
    }
    const up = row.cmd === '@' || row.cmd === 'XZ' ? row.cmd : row.cmd.toUpperCase()
    if (up === 'Z' || up === 'XZ') {
      if (grammar === 'route') put(up === 'Z' ? 'XZ' : 'Z', up === 'Z' ? 'autoroute the last leg to b' : 'a straight track to b')
    } else if (up === '@') {
      for (const l of copper) if (l !== canonicalLayer(row.args[0] ?? '')) put(`@${l}`, `via to ${l}`)
    } else if (['L', 'H', 'V', 'X'].includes(up)) {
      const rel = row.cmd !== up
      for (const c of grammar === 'route' ? ['L', 'H', 'V', 'X'] : ['L', 'H', 'V']) {
        if (c === up) continue
        const cmd = rel ? c.toLowerCase() : c
        put(serialise([setCommand(rows, i, cmd, grammar)[i]]), c === 'X' ? 'an automatic leg' : `a ${c === 'L' ? 'line' : c === 'H' ? 'horizontal' : 'vertical'} track`)
      }
    }
    if (grammar === 'route' && up !== 'Z' && up !== 'XZ' && up !== '@')
      for (const l of copper.filter(x => x === 'F.Cu' || x === 'B.Cu')) put(`${value} @${l}`, `add a via to ${l} after it`)
    put('', 'delete this command', 'delete')
    s.presentations = out
    return s
  })
}

/** Replace row i's text with `text`, '' deleting it with the space before it, when the whole path stays valid. */
function spliceRow(h: Hit, rows: Row[], i: number, text: string, grammar: Grammar): OffsetEdit | { error: string } {
  const row = rows[i]
  let a = row.start ?? 0
  let b = row.end ?? h.value.length
  if (!text) {
    // take the separator before the command, or after it for the first
    if (i > 0) while (a > 0 && /[\s,]/.test(h.value[a - 1])) a--
    else while (b < h.value.length && /[\s,]/.test(h.value[b])) b++
  }
  const next = h.value.slice(0, a) + text + h.value.slice(b)
  const parsed = parsePath(next, grammar)
  const errs = parsed.errors.length ? parsed.errors : validate(parsed.rows, grammar)
  if (errs.length) return { error: errs[0] }
  const enc = encodeValue(h, next)
  if ('error' in enc) return enc
  return { start: h.start + a, end: h.start + b, newText: text }
}

function typedEdit(seg: RawSegment, typed: string, ctx: SegmentContext): { edit: OffsetEdit; newText: string; label: string } | { error: string } {
  const h = seg.hit
  const value = typed.trim()
  const whole = (v: string) => {
    const e = write(h, v)
    return 'error' in e ? e : { edit: e, newText: v, label: v }
  }
  switch (seg.kind) {
    case 'length': {
      const t = parseToken(value)
      const old = parseToken(h.value) as Token
      if (!t) return { error: `${JSON.stringify(value)} is not a length` }
      const next = t.unit ? t : { num: t.num, unit: old.unit }
      const mm = lengthMm(next)
      if (mm === undefined) return { error: `${t.unit} is not a length unit` }
      if (mm < 0) return { error: 'a length is not negative' }
      return whole(h.context.quote === 'number' ? formatToken(withMm({ num: 0, unit: old.unit }, mm)) : formatToken(next))
    }
    case 'angle': {
      const t = parseToken(value)
      const old = parseToken(h.value) as Token
      if (!t) return { error: `${JSON.stringify(value)} is not an angle` }
      const next = t.unit ? t : { num: t.num, unit: old.unit }
      if (angleDeg(next) === undefined) return { error: `${t.unit} is not an angle unit` }
      return whole(formatToken(next))
    }
    case 'number':
      if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return { error: `${JSON.stringify(value)} is not a number` }
      return whole(value)
    case 'position':
      if (h.kind === 'at' ? !parseAt(value) : !parsePoint(value))
        return { error: h.kind === 'at' ? 'a position is x y and an optional rotation' : 'a route end is x y and an optional layer' }
      return whole(value)
    case 'layer': {
      const known = canonicalLayer(value) ?? ctx.layers?.find(l => l.toLowerCase() === value.toLowerCase())
      if (!known) return { error: `${value} is not a layer of this board` }
      return whole(value)
    }
    case 'enum': {
      const choices = seg.constraints.choices ?? []
      if (h.kind === 'side' ? !toggleSide(value) : !choices.includes(value))
        return { error: `${value} is not one of ${h.kind === 'side' ? 'F, B, top, bottom, front, back' : choices.join(', ')}` }
      return whole(value)
    }
    case 'pinRef': {
      const ref = h.context.ref ?? ''
      const pad = h.context.form === 'dotted' ? value.replace(new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`), '') : value
      const pads = ctx.pads?.(ref)
      const hit = pads?.find(p => p.num === pad || p.name === pad)
      if (pads && !hit) return { error: `${ref} has no pad ${pad}` }
      const num = hit?.num ?? pad
      if (h.context.quote === 'number' && !/^\d+$/.test(num)) return { error: `${ref}[...] takes a pad number` }
      const r = whole(h.context.form === 'dotted' ? `${ref}.${num}` : num)
      return 'error' in r ? r : { ...r, label: `${ref}.${num}` }
    }
    case 'pathCommand': {
      if (h.kind === 'chainCommand') {
        const t = chainText(h, value)
        return typeof t === 'string' ? { edit: { start: h.start, end: h.end, newText: t }, newText: t, label: t } : t
      }
      const grammar: Grammar = h.kind === 'routePath' ? 'route' : 'svg'
      const { rows } = parsePath(h.value, grammar)
      const e = spliceRow(h, rows, seg.constraints.index ?? 0, value, grammar)
      return 'error' in e ? e : { edit: e, newText: value, label: value || 'delete' }
    }
  }
}

function dedupe(ps: RawPresentation[]): RawPresentation[] {
  const seen = new Set<string>()
  return ps.filter(p => !seen.has(p.edit.newText) && !!seen.add(p.edit.newText))
}

/** One line on what a literal holds, for the hover. */
export function describeHit(h: Hit): string {
  return summary(h)
}
