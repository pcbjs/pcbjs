// the schematic view's geometry and its mapping to the board; free of Vue and the DOM, so Node imports it in the tests
import type { SchDrawing, SchSymbol } from '@pcbjs/core/sch-model'

type Pt = [number, number]
export type Box = [number, number, number, number]
export interface SchSrc { file: string; line: number; col: number; endLine?: number; endCol?: number }

/** The inline style that sets every `--sch-*` variable to a theme's values, as the site data carries them. */
export const schVars = (colors: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(colors ?? {}).map(([k, v]) => [`--sch-${k}`, v]))

/** The rail's rows: what each hides, by the markup's classes, and the colour of its swatch. */
export const SCH_LAYERS: { id: string; name: string; color: string | null }[] = [
  { id: 'symbols', name: 'Symbols', color: 'body' },
  { id: 'wires', name: 'Wires', color: 'wire' },
  { id: 'labels', name: 'Labels', color: 'label' },
  { id: 'power', name: 'Power', color: 'power' },
  { id: 'sheets', name: 'Sheets', color: 'sheet' },
  { id: 'texts', name: 'Texts', color: 'text' },
  { id: 'findings', name: 'Findings', color: null },
]

/** How many items each rail row has. */
export function layerCounts(d: SchDrawing, findings: number): Record<string, number> {
  const power = d.labels.filter(l => l.kind !== 'label').length
  return { symbols: d.symbols.length, wires: d.wires.length, labels: d.labels.length - power, power, sheets: d.sheets.length, texts: d.texts.length, findings }
}

/** The drawn part of the page, every symbol, pin, wire, label, sheet and text, grown by `margin` and kept on the page. */
export function drawnBox(d: SchDrawing, margin = 4 * d.grid): Box {
  const pts: Pt[] = [
    ...d.symbols.flatMap(s => [[s.box[0], s.box[1]], [s.box[2], s.box[3]], s.refAt, s.valueAt, ...s.pins.map(p => p.end)] as Pt[]),
    ...d.wires.flatMap(w => w.pts), ...d.labels.map(l => l.at), ...d.texts.map(t => t.at),
    ...d.sheets.flatMap(s => [[s.box[0], s.box[1]], [s.box[2], s.box[3]]] as Pt[]),
  ]
  const [px0, py0, px1, py1] = d.page
  if (!pts.length) return [px0, py0, px1 - px0, py1 - py0]
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x0 = Math.max(px0, Math.min(...xs) - margin), y0 = Math.max(py0, Math.min(...ys) - margin)
  const x1 = Math.min(px1, Math.max(...xs) + margin), y1 = Math.min(py1, Math.max(...ys) + margin)
  return [x0, y0, x1 - x0, y1 - y0]
}

/** The box that frames one symbol with room around it to read its wiring; null for a ref the sheet lacks. */
export function symbolFrame(d: SchDrawing, ref: string): Box | null {
  const s = d.symbols.find(x => x.ref === ref)
  if (!s) return null
  const [x0, y0, x1, y1] = s.box
  const m = Math.max(16 * d.grid, Math.max(x1 - x0, y1 - y0) * 2)
  return [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m]
}

/** What lies under the pointer. `key` names the drawn element: `sym:R1`, `pin:R1.2`, `wire:3`, `label:2`, `sheet:<path>`. */
export interface SchHit { kind: 'pin' | 'wire' | 'label' | 'symbol' | 'sheet'; key: string; ref?: string; pin?: string; net?: string; items: number[]; refs: string[]; src?: SchSrc }

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
const inBox = (p: Pt, b: Box | [number, number, number, number], grow: number) => p[0] >= b[0] - grow && p[0] <= b[2] + grow && p[1] >= b[1] - grow && p[1] <= b[3] + grow
const symbolHit = (s: SchSymbol): SchHit => ({ kind: 'symbol', key: `sym:${s.ref}`, ref: s.ref, items: s.items, refs: [s.ref], ...(s.src ? { src: s.src } : {}) })

/**
 * The element at `p`, sheet mm, within `tol`: a pin, a wire, a label, a symbol body, then a sheet's border. `labels` are the
 * drawn bounds of the labels by id, x0 y0 x1 y1, when the page measured them; else a label is a grid square at its point.
 */
export function schHit(d: SchDrawing, p: Pt, tol: number, labels?: ReadonlyMap<string, Box>): SchHit | null {
  for (const s of d.symbols) for (const q of s.pins) {
    if (segDist(p, q.end, q.root) > tol) continue
    return { kind: 'pin', key: `pin:${s.ref}.${q.name}`, ref: s.ref, pin: q.name, ...(q.net ? { net: q.net } : {}), items: q.items, refs: [s.ref], ...(s.src ? { src: s.src } : {}) }
  }
  for (const w of d.wires) for (let i = 1; i < w.pts.length; i++) {
    if (segDist(p, w.pts[i - 1], w.pts[i]) <= tol) return { kind: 'wire', key: w.id, net: w.net, items: [], refs: [], ...(w.src ? { src: w.src } : {}) }
  }
  for (const l of d.labels) {
    const b = labels?.get(l.id) ?? [l.at[0] - d.grid / 2, l.at[1] - d.grid / 2, l.at[0] + d.grid / 2, l.at[1] + d.grid / 2]
    if (inBox(p, b, tol)) return { kind: 'label', key: l.id, net: l.net, items: [], refs: [], ...(l.src ? { src: l.src } : {}) }
  }
  for (const s of d.symbols) if (inBox(p, s.box, tol)) return symbolHit(s)
  for (const s of d.sheets) {
    const [x0, y0, x1, y1] = s.box
    const border = Math.min(Math.abs(p[0] - x0), Math.abs(p[0] - x1), Math.abs(p[1] - y0), Math.abs(p[1] - y1)) <= tol
    const name = p[1] >= y0 && p[1] <= y0 + 3 && p[0] >= x0 && p[0] <= x0 + 1 + s.name.length * 1.27
    const edge = inBox(p, s.box, tol) && (border || name)
    if (!edge) continue
    const path = s.path.join('/')
    return { kind: 'sheet', key: `sheet:${path}`, items: [], refs: d.symbols.filter(x => x.path.join('/').startsWith(path) && x.path.length >= s.path.length).map(x => x.ref), ...(s.src ? { src: s.src } : {}) }
  }
  return null
}

/** What a board hover or selection stands for, as the board and the side panels know it. */
export interface Probe { ref?: string | null; net?: string | null; id?: number | null }
/** The schematic elements to mark for a probe: symbols by ref, nets, and pins as `REF.PIN`. */
export interface SchMarks { refs: string[]; nets: string[]; pins: string[] }

/** The symbols, nets and pins a board item stands for: a pad marks its pin, its net and its symbol. */
export function schMarks(d: SchDrawing, probe: Probe | null | undefined): SchMarks {
  const out: SchMarks = { refs: [], nets: [], pins: [] }
  if (!probe) return out
  if (probe.net) out.nets.push(probe.net)
  if (probe.ref && d.symbols.some(s => s.ref === probe.ref)) out.refs.push(probe.ref)
  if (probe.id != null) for (const s of d.symbols) for (const q of s.pins) if (q.items.includes(probe.id)) out.pins.push(`${s.ref}.${q.name}`)
  return out
}

/** The board side of a schematic hit: the parts it stands for, its net and the pad ids, the inverse of schMarks. */
export function boardProbe(h: SchHit | null): { refs: string[]; net: string | null; ids: number[] } {
  return h ? { refs: h.refs, net: h.net ?? null, ids: h.items } : { refs: [], net: null, ids: [] }
}

/** The point a schematic finding pans to, null for a finding on the board. */
export const schFindingAt = (f: { layer?: string; at: Pt }): Pt | null => (f.layer === 'sch' ? f.at : null)

// a cursor before the first character is outside, as in source.ts
const cmp = (a: Pt, b: Pt) => a[0] - b[0] || a[1] - b[1]
const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '')
const sameFile = (key: string, file: string) => { const k = norm(key), f = norm(file); return k === f || f.endsWith('/' + k) }

/** The drawn elements whose code range holds an editor cursor: the innermost one with all those nested in it, and their parts. */
export function schAtCursor(d: SchDrawing, file: string, line: number, col: number): { keys: string[]; refs: string[]; src: SchSrc } | null {
  const ranged: { key: string; ref?: string; src: Required<SchSrc> }[] = []
  const add = (key: string, src: SchSrc | undefined, ref?: string) => { if (src?.endLine != null && src.endCol != null && sameFile(src.file, file)) ranged.push({ key, ref, src: src as Required<SchSrc> }) }
  for (const s of d.symbols) if (!s.auto) add(`sym:${s.ref}`, s.src, s.ref)
  for (const w of d.wires) if (!w.auto) add(w.id, w.src)
  for (const l of d.labels) if (!l.auto) add(l.id, l.src)
  for (const s of d.sheets) if (!s.auto) add(`sheet:${s.path.join('/')}`, s.src)
  d.texts.forEach((t, i) => add(`text:${i}`, t.src))
  const start = (s: Required<SchSrc>): Pt => [s.line, s.col], end = (s: Required<SchSrc>): Pt => [s.endLine, s.endCol]
  const span = (s: Required<SchSrc>) => (s.endLine - s.line) * 1e6 + (s.endCol - s.col)
  const at: Pt = [line, col]
  const under = ranged.filter(r => cmp(at, start(r.src)) > 0 && cmp(at, end(r.src)) <= 0)
  if (!under.length) return null
  const best = under.reduce((a, b) => (span(b.src) < span(a.src) ? b : a))
  const nested = ranged.filter(x => cmp(start(x.src), start(best.src)) >= 0 && cmp(end(x.src), end(best.src)) <= 0)
  const keys = [...new Set(nested.map(x => x.key))]
  const refs = [...new Set(nested.flatMap(x => (x.ref ? [x.ref] : [])))]
  return { keys, refs, src: best.src }
}
