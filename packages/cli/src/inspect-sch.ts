import { relative } from 'node:path'
import type { Board, Pt } from '@pcbjs/core/model'
import { table } from './inspect.js'

const r3 = (v: number) => Math.round(v * 1000) / 1000
/** A sheet point in grid units, as a symbol placement and wire() take them. */
const g = (p: Pt, grid: number) => `${r3(p[0] / grid)} ${r3(p[1] / grid)}`

export function inspectSchematic(b: Board, root: string): { text: string[]; json: unknown; found: boolean } {
  const d = b.schematic.drawing
  if (!d) return { text: ['no schematic'], json: { schematic: null }, found: false }
  const src = (s?: { file: string; line: number; col: number }) => (s ? `${relative(root, s.file) || s.file}:${s.line}:${s.col}` : 'auto')
  const s = d.stats
  const wires = d.wires.map(w => ({
    id: w.id, net: w.net, length: r3(w.pts.reduce((t, q, i) => (i ? t + Math.abs(q[0] - w.pts[i - 1][0]) + Math.abs(q[1] - w.pts[i - 1][1]) : t), 0)),
    bends: w.pts.length - 2, from: g(w.pts[0], d.grid), to: g(w.pts.at(-1)!, d.grid), src: src(w.src),
  }))
  const text = [
    `schematic  ${d.paper ? `${d.paper.name} ${d.paper.w} x ${d.paper.h} mm` : `page ${r3(d.page[2] - d.page[0])} x ${r3(d.page[3] - d.page[1])} mm from ${g([d.page[0], d.page[1]], d.grid)}`}, grid ${d.grid} mm; positions in grid units, x right, y down`,
    `  ${s.symbols} symbols, ${s.wires} wires, ${s.segments} segments, ${s.bends} bends, ${s.crossings} crossings, ${s.junctions} junctions, ${s.labels} labels, ${s.power} power symbols, ${r3(s.length)} mm of wire`,
    `  nets ${s.wired} wired, ${s.labelled} labelled${s.rounds ? `, ${s.rounds} rounds of negotiation` : ''}`,
    ...table([['symbol', 'kind', 'at', 'rot', 'pins', 'path', 'src'], ...d.symbols.map(x => [x.ref, x.kind, g(x.at, d.grid), `${x.rot}${x.flip ? ' flip' : ''}`, String(x.pins.length), x.path.join('/') || '-', src(x.src)])]),
    ...(wires.length ? table([['wire', 'net', 'length', 'bends', 'from', 'to', 'src'], ...wires.map(w => [w.id, w.net || '-', r3(w.length).toFixed(2), String(w.bends), w.from, w.to, w.src])]) : []),
    ...(d.labels.length ? table([['label', 'net', 'kind', 'at', 'src'], ...d.labels.map(l => [l.id, l.net, l.kind, g(l.at, d.grid), src(l.src)])]) : []),
  ]
  return {
    text, found: true,
    json: { schematic: { page: d.page, ...(d.paper ? { paper: d.paper } : {}), grid: d.grid, stats: s, symbols: d.symbols.map(x => ({ ref: x.ref, kind: x.kind, at: x.at, rot: x.rot, flip: x.flip, pins: x.pins.map(p => ({ name: p.name, net: p.net, end: p.end })), auto: x.auto })), wires, labels: d.labels.map(l => ({ id: l.id, net: l.net, kind: l.kind, at: l.at, auto: l.auto })) } },
  }
}
