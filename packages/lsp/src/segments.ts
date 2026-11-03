// Offsets are UTF-16 code units of the document text.

import type ts from 'typescript'
import { detect, encodeValue, type Hit } from './detect.js'
import { summary } from './describe.js'
import { commands, parsePath, setCommand, validate, serialise, type Row } from './path-model.js'
import { angleDeg, isPlainNumber, formatAt, formatNum, formatToken, lengthMm, parseAt, parseToken, type Token } from '@pcbjs/core/internal/units'
import { canonicalLayer, formatPoint, layerChoices, nudgeAt, numericRange, parsePoint, rotateAt, toggleSide, withDeg, withMm } from './values.js'
import type { Constraints, Segment, SegmentKind, SegmentsParams } from '@pcbjs/core/protocol'
import type { DocModel } from './doc.js'
import { widgetOf } from './protocol.js'
import { CHAIN, CHAIN_NAMES, isChain, isCopperHelper, type ChainName, type ChainSpec } from '@pcbjs/core/internal/syntax'

import type { OffsetEdit } from '@pcbjs/core/internal/textdoc'
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

const PRESETS_MM = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
const IMPEDANCES = [50, 85, 90, 100]

/** Every segment of a file, in document order. */
export function segmentsOf(sf: ts.SourceFile, ctx: SegmentContext = {}): RawSegment[] {
  let hits: Hit[] = []
  try {
    hits = detect(sf, { routeHelpers: ctx.routeHelpers })
  } catch {
    return []
  }
  return hits.flatMap(h => build(h, ctx))
}

/** The innermost segment at an offset with its presentations computed for writing `value`, or with `error` set. */
export function typedSegment(sf: ts.SourceFile, ctx: SegmentContext, offset: number, value: string): RawSegment | undefined {
  const seg = innermost(segmentsOf(sf, ctx), offset)
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

const isCopper = (h: Hit) => !!h.context.chain || isCopperHelper(h.context.owner) || (h.context.owner === 'pad' && h.context.prop === 'layers')

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
      s.presentations = choices.filter(l => l.name !== current).flatMap(l => pres(h, l.name))
      return [s]
    }
    case 'side': {
      const s = base(h, 'enum', { choices: ['F', 'B'] })
      const next = toggleSide(h.value)
      if (next) s.presentations = pres(h, next, next === 'B' ? 'back side, mirrored' : 'front side')
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
    case 'svgPath':
      return pathSegments(h)
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
  const c: ChainSpec = CHAIN[m as ChainName]
  const up = m.toUpperCase()
  const rel = c.rel
  const layered = c.args[0] === 'layer'
  const finish = (m === 'Z' || m === 'X') && !args.length
  if (finish) put(`${m === 'Z' ? 'X' : 'Z'}()`, m === 'Z' ? 'an automatic leg to the end' : 'a straight track to the end')
  else if ((m === 'X' || m === 'L') && args.length === 1)
    put(`${m === 'X' ? 'L' : 'X'}(${args[0]})`, m === 'X' ? 'a straight track to the waypoint' : 'an automatic leg to the waypoint')
  else if (layered) {
    const cur = canonicalLayer(args[0]?.replace(/^['"`]|['"`]$/g, '') ?? '')
    for (const l of layerChoices(ctx.layers, true)) if (l.name !== cur) put(`${m}(${q}${l.name}${q})`, `${m} to ${l.name}`)
  } else if (up === 'H' || up === 'V') {
    const other = up === 'H' ? 'V' : 'H'
    put(`${rel ? other.toLowerCase() : other}(${args[0] ?? '0'})`, `a ${other === 'H' ? 'horizontal' : 'vertical'} track`)
  } else if (up === 'L' && args.length === 2) {
    put(`${rel ? 'h' : 'H'}(${args[0]})`, 'a horizontal track')
    put(`${rel ? 'v' : 'V'}(${args[1]})`, 'a vertical track')
  }
  if (!finish) {
    if (!layered) for (const l of ['F.Cu', 'B.Cu']) put(`${h.value}.via(${q}${l}${q})`, `add a via to ${l} after it`)
    out.push({ label: 'delete', detail: 'delete this command', edit: { start: h.context.dot ?? h.start, end: h.end, newText: '' } })
  }
  s.presentations = out
  return s
}

/** A typed chain command, `V 16`, `V(16)`, `A 5 6 90`, `via B.Cu`, `X` or `Z`, as the call text, or why it cannot be. */
function chainText(h: Hit, typed: string): string | { error: string } {
  const m = /^\s*([A-Za-z]+)\s*\(?\s*(.*?)\s*\)?\s*$/.exec(typed)
  if (!m) return { error: 'a chain command, such as V 14, L 5 16, via B.Cu or X' }
  const name = m[1]
  if (!isChain(name)) return { error: `${name} is not a chain command: ${CHAIN_NAMES.join(', ')}` }
  const c: ChainSpec = CHAIN[name]
  const raw = m[2].split(/\s*,\s*|\s+/).filter(Boolean)
  const wasEnd = (h.context.prop === 'Z' || h.context.prop === 'X') && !(h.context.args ?? []).length
  if (wasEnd !== ((name === 'Z' || name === 'X') && !raw.length))
    return { error: wasEnd ? 'this command finishes the route: it stays .Z() or .X()' : '.Z() and .X() finish the route, at its end only' }
  const q = quoteOf(h)
  if (name === 'Z') return raw.length ? { error: '.Z() takes no target; a straight track to a point is .L(p)' } : 'Z()'
  if (c.args[0] === 'layer') {
    const l = raw[0]?.replace(/^['"`]|['"`]$/g, '')
    if (!l || (!canonicalLayer(l) && !/^[A-Za-z0-9._]+$/.test(l))) return { error: `${name} needs a layer, such as B.Cu` }
    return `${name}(${q}${l}${q})`
  }
  // a waypoint of .X(p) is one coordinate string
  if (name === 'X') return raw.length === 2 ? `X(${q}${raw.join(' ')}${q})` : raw.length ? { error: '.X() takes one waypoint, such as X 5 16, or nothing' } : 'X()'
  const n = c.args.length
  if (raw.length !== n) return { error: `${name} takes ${n === 2 ? 'x and y' : n === 3 ? 'x, y and the angle' : 'one length'}` }
  const lit: string[] = []
  for (const [k, a] of raw.entries()) {
    const t = parseToken(a)
    const angle = c.args[k] === 'angle'
    if (!t || (angle ? angleDeg(t) : lengthMm(t)) === undefined) return { error: `${JSON.stringify(a)} is not ${angle ? 'an angle' : 'a length'}` }
    lit.push(t!.unit ? `${q}${a}${q}` : a)
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
  const current = h.value
  // a string can name the pin as well as the pad number, `'U2.IN'` or `U2['IN']`; a number literal and `.pad()` only the number
  const named = (p: PadFact) => h.context.quote !== 'number' && !!p.name && p.name !== p.num && /^[\w+\-]+$/.test(p.name)
  const s = base(h, 'pinRef', { choices: [...new Set([...pads.map(p => p.num), ...pads.filter(named).map(p => p.name!)])] })
  s.label = `pad of ${ref}`
  const text = (v: string) => v
  s.presentations = pads.flatMap(p => {
    const net = p.net ?? 'no net'
    const out: RawPresentation[] = []
    if (p.num !== current && (h.context.quote !== 'number' || /^\d+$/.test(p.num)))
      out.push(...pres(h, text(p.num), [p.name && p.name !== p.num ? p.name : '', net].filter(Boolean).join(' · '), `${ref}/${p.num}`))
    if (named(p) && p.name !== current) out.push(...pres(h, text(p.name!), `pad ${p.num} · ${net}`, `${ref}/${p.name}`))
    return out
  })
  return s
}

/** One segment per command, each edit confined to the command's own text. */
function pathSegments(h: Hit): RawSegment[] {
  const { rows } = parsePath(h.value)
  return rows.map((row, i) => {
    const s: RawSegment = {
      start: h.start + (row.start ?? 0),
      end: h.start + (row.end ?? h.value.length),
      kind: 'pathCommand',
      value: h.value.slice(row.start ?? 0, row.end ?? h.value.length),
      label: `path data, command ${i + 1}`,
      constraints: { grammar: 'svg', index: i, choices: commands() },
      presentations: [],
      hit: h,
    }
    const out: RawPresentation[] = []
    const put = (text: string, detail: string, label = text) => {
      const e = spliceRow(h, rows, i, text)
      if (!('error' in e)) out.push({ label, detail, edit: e })
    }
    const up = row.cmd.toUpperCase()
    if (['L', 'H', 'V'].includes(up)) {
      const rel = row.cmd !== up
      for (const c of ['L', 'H', 'V']) {
        if (c === up) continue
        put(serialise([setCommand(rows, i, rel ? c.toLowerCase() : c)[i]]), `a ${c === 'L' ? 'line' : c === 'H' ? 'horizontal' : 'vertical'} line`)
      }
    }
    put('', 'delete this command', 'delete')
    s.presentations = out
    return s
  })
}

/** Replace row i's text with `text`, '' deleting it with the space before it, when the whole path stays valid. */
function spliceRow(h: Hit, rows: Row[], i: number, text: string): OffsetEdit | { error: string } {
  const row = rows[i]
  let a = row.start ?? 0
  let b = row.end ?? h.value.length
  if (!text) {
    // take the separator before the command, or after it for the first
    if (i > 0) while (a > 0 && /[\s,]/.test(h.value[a - 1])) a--
    else while (b < h.value.length && /[\s,]/.test(h.value[b])) b++
  }
  const next = h.value.slice(0, a) + text + h.value.slice(b)
  const parsed = parsePath(next)
  const errs = parsed.errors.length ? parsed.errors : validate(parsed.rows)
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
      if (!isPlainNumber(value)) return { error: `${JSON.stringify(value)} is not a number` }
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
      if (h.kind === 'side' ? !toggleSide(value) : !choices.includes(value)) return { error: `${value} is not one of ${h.kind === 'side' ? 'F, B' : choices.join(', ')}` }
      return whole(value)
    }
    case 'pinRef': {
      const ref = h.context.ref ?? ''
      // a reference of the pad, `U2/IN`, names its pad after the part
      const slash = value.lastIndexOf('/')
      if (slash >= 0 && value.slice(0, slash) !== ref) return { error: `${value} is a pad of ${value.slice(0, slash)}, not of ${ref}` }
      const pad = value.slice(slash + 1)
      const pads = ctx.pads?.(ref)
      const hit = pads?.find(p => p.num === pad || p.name === pad)
      if (pads && !hit) return { error: `${ref} has no pad ${pad}` }
      const num = hit?.num ?? pad
      if (h.context.quote === 'number' && !/^\d+$/.test(num)) return { error: `${ref}[...] takes a pad number` }
      const r = whole(num)
      return 'error' in r ? r : { ...r, label: `${ref}/${num}` }
    }
    case 'pathCommand': {
      if (h.kind === 'chainCommand') {
        const t = chainText(h, value)
        return typeof t === 'string' ? { edit: { start: h.start, end: h.end, newText: t }, newText: t, label: t } : t
      }
      const { rows } = parsePath(h.value)
      const e = spliceRow(h, rows, seg.constraints.index ?? 0, value)
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

/** `pcbjs/segments`: the one segment at a position with `value` typed into it, else the innermost at a position, else every one in a range or the document. */
export function segmentsFor(doc: DocModel, ctx: SegmentContext, p: Pick<SegmentsParams, 'position' | 'range' | 'value'>): Segment[] {
  const toSeg = (s: RawSegment): Segment => ({
    range: doc.range(s),
    kind: s.kind,
    value: s.value,
    label: s.label,
    constraints: s.constraints,
    widget: widgetOf(s.kind, s.constraints),
    presentations: s.presentations.map(x => ({ label: x.label, ...(x.detail ? { detail: x.detail } : {}), edit: doc.edit(x.edit) })),
    ...(s.error ? { error: s.error } : {}),
  })
  if (p.position && typeof p.value === 'string') {
    const s = typedSegment(doc.sf(), ctx, doc.offset(p.position), p.value)
    return s ? [toSeg(s)] : []
  }
  let segs = segmentsOf(doc.sf(), ctx)
  if (p.position) {
    const one = innermost(segs, doc.offset(p.position))
    segs = one ? [one] : []
  } else if (p.range) {
    const a = doc.offset(p.range.start),
      b = doc.offset(p.range.end)
    segs = segs.filter(s => s.end >= a && s.start <= b)
  }
  return segs.map(toSeg)
}
