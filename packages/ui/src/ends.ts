// The route end assist, free of Vue and the DOM: while the editor cursor waits for a route end, the open ends the language server
// named from the ratsnest and the routed copper, the marks and labels the 2D and 3D views draw for them, the isolation that fades the
// rest, the ratsnest lines that stay lit, and the pick that fills the slot; board mm. See docs/editing.md, Route ends.
import type { SiteData } from '@pcbjs/core/site-data'
import type { Ratsnest } from '@pcbjs/core/model'
import type { AssistContext, EditResult, EndCandidate, EndSlot } from '@pcbjs/core/protocol'
import type { EditClient } from './edit-client'
import { applyMat, invertMat, type Isolation, type IsolationView } from './selection'
import { frameOf, mulMat } from '@pcbjs/core/internal/instances'

type Pt = [number, number]

export type EndsCtx = AssistContext & { ends: EndSlot }

interface Tools {
  assist: AssistContext | null
  assistOff: boolean
  mode: { mode: string } | null
  endFocus?: { board: string; handle: string } | null
}
/** The context while the editor waits for a route end on this board and this viewer may write, else null; inside an isolation, in its instance. */
export function endsOf(t: Tools, site: SiteData, iso: Isolation | null = null): EndsCtx | null {
  const a = t.assist
  const ctx = a?.ends && !t.assistOff && a.board === site.name && !!site.dev && t.mode?.mode === 'rw' && !(site.variant && site.variant!.index !== 0) ? (a as EndsCtx) : null
  return ctx && iso ? endsIn(ctx, site, iso) : ctx
}

/** A slot in a definition the language server read through another instance of it, carried into the isolated one: its refs, nets and points. */
export function endsIn(ctx: EndsCtx, site: Pick<SiteData, 'schematic' | 'edit'>, iso: Isolation): EndsCtx {
  const parts = site.schematic.parts
  const pathOf = new Map(parts.map(p => [p.ref, [...p.path, p.local].join('/')]))
  const refAt = new Map(parts.map(p => [[...p.path, p.local].join('/'), p.ref]))
  const under = (ref: string | null) => (ref ? (pathOf.get(ref.split('/')[0]) ?? ref) : '')
  const seen = [ctx.pad, ...ctx.ends.candidates.map(c => c.ref)].map(under)
  const from = iso.instances.find(i => i !== iso.ref && seen.some(p => p.startsWith(i + '/')))
  const frame = (ref: string) => frameOf(site.edit?.find(e => e.ref === ref)?.frames, ref)
  const a = from ? frame(from) : null,
    b = frame(iso.ref)
  if (!from || !a || !b) return ctx
  const m = mulMat(b, invertMat(a))
  const move = (s: string) => (s.startsWith(from + '/') ? iso.ref + s.slice(from.length) : s)
  const net = (n: string | null) => (n ? move(n) : n)
  const ref = (r: string) => {
    const [head, ...rest] = r.split('/')
    const p = pathOf.get(head)
    return p ? [refAt.get(move(p)) ?? head, ...rest].join('/') : move(r)
  }
  const candidates = ctx.ends.candidates.map(c => ({
    ...c,
    ref: ref(c.ref),
    net: net(c.net),
    label: c.net ? c.label.replace(c.net, net(c.net)!) : c.label,
    at: applyMat(m, c.at),
  }))
  return { ...ctx, pad: ctx.pad ? ref(ctx.pad) : null, net: net(ctx.net), ends: { ...ctx.ends, net: net(ctx.ends.net), candidates } }
}

const pads = new WeakMap<object, Map<string, number[]>>()
/** The copper item ids of each pad, `J1/2`. */
export function padIds(site: Pick<SiteData, 'items'>): Map<string, number[]> {
  const items = site.items ?? []
  let out = pads.get(items)
  if (out) return out
  out = new Map()
  for (const it of items) {
    if (!it.ref || it.pad === undefined || !it.layers.some(l => l.endsWith('.Cu'))) continue
    const k = `${it.ref}/${it.pad}`
    out.set(k, [...(out.get(k) ?? []), it.id])
  }
  pads.set(items, out)
  return out
}

/** The editor's completion focus after a `pcbjs:assist:focus`: the board's handle, or none once that board's is cleared. */
export function applyEndFocus(was: { board: string; handle: string } | null, m: { board: string; handle: string | null }): { board: string; handle: string } | null {
  if (m.handle) return { board: m.board, handle: m.handle }
  return was?.board === m.board ? null : was
}

/** The candidate lit as a hover: the one under the pointer, else the one the editor's completion list has in focus. */
export function litEnd(t: Tools, ctx: EndsCtx, pointer: EndCandidate | null): EndCandidate | null {
  if (pointer) return pointer
  const f = t.endFocus
  return f && f.board === ctx.board ? (ctx.ends.candidates.find(c => c.handle === f.handle) ?? null) : null
}

/** The copper of the candidates, their pads or their bound routes' tracks, and of the first end's pad. */
export function endIds(site: Pick<SiteData, 'layers' | 'items'>, ctx: EndsCtx): number[] {
  const byPad = padIds(site)
  const byRoute = new Map<string, number[]>()
  for (const it of site.items ?? []) if (it.route) byRoute.set(it.route, [...(byRoute.get(it.route) ?? []), it.id])
  const out = new Set<number>(ctx.pad ? (byPad.get(ctx.pad) ?? []) : [])
  for (const c of ctx.ends.candidates) for (const id of (c.kind === 'pad' ? byPad.get(c.ref) : byRoute.get(c.ref.replace(/\/pt:\d+$/, ''))) ?? []) out.add(id)
  return [...out]
}

/** The isolation the candidates make: their copper stays, everything else fades as a single instance's isolation does. */
export function endIso(site: Pick<SiteData, 'layers' | 'items'>, ctx: EndsCtx): IsolationView {
  return { parts: new Set(), ids: new Set(endIds(site, ctx)), findings: new Set(), nets: new Set(), fade: true, frame: null, box: null, boardBox: null }
}

/** The ratsnest as the slot shows it: the lines of the first end's net lit, leading to the candidates, every other line dimmed; all lit in the first slot. */
export function endLines(site: Pick<SiteData, 'ratsnest'>, ctx: EndsCtx): (Ratsnest & { lit: boolean })[] {
  return site.ratsnest.map(r => ({ ...r, lit: !ctx.ends.net || r.net === ctx.ends.net }))
}

/** What the status chip says: `4 open ends on VCC`, then why any are left out, `CH3 is not in scope here`. */
export const endStatus = (ctx: EndsCtx) => {
  const n = ctx.ends.candidates.length
  return [`${n} open end${n === 1 ? '' : 's'}${ctx.ends.net ? ` on ${ctx.ends.net}` : ''}`, ...(ctx.ends.notes ?? [])].join(' · ')
}

/** One annotation as the 2D view draws it: the ring at the candidate, the label beside it, both sized in screen pixels. */
export interface EndMark2d {
  handle: string
  label: string
  at: Pt
  r: number
  /** the label's anchor and size, board mm */
  text: Pt
  size: number
  /** the label sits away from its part's centre: right, left, or centred above or below */
  anchor: 'start' | 'end' | 'middle'
  /** mirrors the label back so it reads in a mirrored view */
  transform?: string
}
/** The 2D annotations at `px` mm per screen pixel, each label on the side of its pad away from the part's origin. */
export function endMarks2d(ctx: EndsCtx, px: number, mirror = false, site?: Pick<SiteData, 'footprints'>): EndMark2d[] {
  const origin = new Map((site?.footprints ?? []).map(f => [f.ref, f.at]))
  return ctx.ends.candidates.map(c => {
    const size = px * 11.5
    const o = c.kind === 'pad' ? origin.get(c.ref.slice(0, c.ref.lastIndexOf('/'))) : undefined
    const dx = o ? c.at[0] - o[0] : 1,
      dy = o ? c.at[1] - o[1] : 0
    const side = Math.abs(dx) >= Math.abs(dy) - 1e-9
    const text: Pt = side ? [c.at[0] + Math.sign(dx || 1) * px * 8, c.at[1] + size * 0.35] : [c.at[0], dy > 0 ? c.at[1] + px * 9 + size * 0.7 : c.at[1] - px * 9]
    const right = (dx || 1) > 0 !== mirror
    return {
      handle: c.handle,
      label: c.label,
      at: c.at,
      r: px * 5.5,
      text,
      size,
      anchor: side ? (right ? 'start' : 'end') : 'middle',
      ...(mirror ? { transform: `matrix(-1 0 0 1 ${2 * text[0]} 0)` } : {}),
    }
  })
}

/** One annotation as the 3D view places it: a point on its side's copper in the board group's frame, x right, y up, z up. */
export interface EndMark3d {
  handle: string
  label: string
  side: 'F' | 'B'
  at: [number, number, number]
}
/** The 3D annotations, each on top of the front copper or under the back, `z` giving those two heights. */
export function endMarks3d(ctx: EndsCtx, z: { F: number; B: number }): EndMark3d[] {
  return ctx.ends.candidates.map(c => ({ handle: c.handle, label: c.label, side: c.side, at: [c.at[0], -c.at[1], c.side === 'B' ? z.B : z.F] }))
}

/** The candidate nearest a board point within `tol` mm. */
export function nearestEnd(ctx: EndsCtx, p: Pt, tol: number): EndCandidate | null {
  let best: EndCandidate | null = null,
    d = tol
  for (const c of ctx.ends.candidates) {
    const e = Math.hypot(c.at[0] - p[0], c.at[1] - p[1])
    if (e <= d) {
      d = e
      best = c
    }
  }
  return best
}

/** A click on a candidate: an assist transaction that writes its handle into the slot and moves the editor cursor on. */
export async function pickEnd(c: EditClient, board: string, run: number | null, handle: string, isolate: string | null = null): Promise<EditResult> {
  const t = await c.begin({ board, run, tool: 'assist', refs: [], anchor: 'assist', ...(isolate ? { isolate } : {}) })
  const plan = await c.update(t.txn, { end: handle })
  if (!plan.files.length) {
    await c.cancel(t.txn)
    return { written: [], error: plan.notes.join('; ') || `nothing to write for ${handle}` }
  }
  return c.commit(t.txn)
}
