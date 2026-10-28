import type { Board } from '@pcbjs/core/model'
import { copperLayers } from '@pcbjs/compile/layers'
import { strokeText } from '@pcbjs/core/text'
import type { DrillTable } from './excellon.js'

// stroked in Hershey, never an SVG font; the baseline starts at (x, y)
function label(t: string, x: number, y: number, size: number): string {
  const d = strokeText(t, { size, thickness: size / 8, anchor: 'start' })
    .strokes.map(r => `M${r.map(q => `${n3(x + q[0])} ${n3(y + q[1])}`).join(' L')}`)
    .join(' ')
  return `<path d="${d}" fill="none" stroke="#000" stroke-width="${n3(size / 8)}" stroke-linecap="round" stroke-linejoin="round"/>`
}

export interface DrillSet {
  name: string
  plated: boolean
  table: DrillTable
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
const n3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function drillReport(board: Board, sets: DrillSet[], date: string): string {
  const cu = copperLayers(board.copper)
  const lines = [
    `Drill report of ${board.name}${board.revision ? ` ${board.revision}` : ''} (pcbjs)`,
    `Generated ${date}`,
    `Units mm; the drill files are Excellon, metric, decimal, y up`,
    `Board ${board.thickness} mm, ${board.copper} copper layers, ${n2(board.bbox.w)} x ${n2(board.bbox.h)} mm`,
    '',
  ]
  if (!sets.length) lines.push('No holes.', '')
  for (const s of sets) {
    const holes = s.table.tools.reduce((a, t) => a + t.count, 0),
      slots = s.table.tools.reduce((a, t) => a + t.slots, 0)
    lines.push(
      `${s.name}: ${s.plated ? 'plated' : 'non-plated'} through holes, ${cu[0]} to ${cu[cu.length - 1]}, ${plural(holes, 'hole')}${slots ? `, ${plural(slots, 'slot')} among them` : ''}`,
    )
    lines.push(`  tool  diameter  count  vias  slots`)
    s.table.tools.forEach((t, i) =>
      lines.push(`  T${String(i + 1).padEnd(4)}${n3(t.d).padStart(8)}  ${String(t.count).padStart(5)}  ${String(t.vias).padStart(4)}  ${String(t.slots).padStart(5)}`),
    )
    lines.push(`  map ${mapName(board, s)}`, '')
  }
  return lines.join('\n')
}

export const mapName = (board: Board, s: Pick<DrillSet, 'plated'>) => `${board.name}-${s.plated ? 'PTH' : 'NPTH'}-drl_map.svg`

// tools are told apart by shape, not by colour
function symbol(i: number, x: number, y: number, r: number): string {
  const p = (pts: [number, number][]) => `M${pts.map(([a, b]) => `${n3(x + a * r)} ${n3(y + b * r)}`).join(' L')} Z`
  switch (i % 8) {
    case 0:
      return `M${n3(x - r)} ${n3(y)} H${n3(x + r)} M${n3(x)} ${n3(y - r)} V${n3(y + r)}`
    case 1:
      return `M${n3(x - r)} ${n3(y - r)} L${n3(x + r)} ${n3(y + r)} M${n3(x - r)} ${n3(y + r)} L${n3(x + r)} ${n3(y - r)}`
    case 2:
      return p([
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
    case 3:
      return p([
        [0, -1],
        [0.87, 0.5],
        [-0.87, 0.5],
      ])
    case 4:
      return p([
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ])
    case 5:
      return p([
        [-1, 0],
        [-0.5, -0.87],
        [0.5, -0.87],
        [1, 0],
        [0.5, 0.87],
        [-0.5, 0.87],
      ])
    case 6:
      return `${p([
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])} M${n3(x - r)} ${n3(y)} H${n3(x + r)} M${n3(x)} ${n3(y - r)} V${n3(y + r)}`
    default:
      return `${p([
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ])} M${n3(x - r)} ${n3(y)} H${n3(x + r)}`
  }
}

/** The drill map of one drill file as SVG in board mm, with a legend of each symbol, diameter and count. */
export function drillMapSvg(board: Board, s: DrillSet): string {
  const b = board.bbox,
    margin = 2,
    sym = Math.max(0.8, Math.min(2.5, Math.max(b.w, b.h) / 40))
  const row = Math.max(1.6, sym * 3),
    text = row * 0.6
  const legendH = (s.table.tools.length + 2) * row
  const title = `${board.name} ${s.plated ? 'plated' : 'non-plated'} holes, ${s.name}, mm`
  const rows = s.table.tools.map((t, i) => `T${i + 1}  ${n3(t.d)} mm  x${t.count}${t.slots ? `, ${plural(t.slots, 'slot')}` : ''}${t.vias ? `, ${plural(t.vias, 'via')}` : ''}`)
  const wide = Math.max(...[title, ...rows].map(t => strokeText(t, { size: text, thickness: 0, anchor: 'start' }).width)) + sym * 3 + 2 * margin
  const x0 = b.x - margin,
    y0 = b.y - margin,
    w = Math.max(b.w + 2 * margin, wide),
    h = b.h + 2 * margin + legendH
  const out: string[] = []
  const outline = board.items.flatMap(it =>
    it.kind === 'graphic' && it.layer === 'Edge.Cuts' ? it.paths.map((p, i) => `M${p.map(q => `${n3(q[0])} ${n3(q[1])}`).join(' L')}${it.closed[i] ? ' Z' : ''}`) : [],
  )
  out.push(`<path d="${outline.join(' ')}" fill="none" stroke="#000" stroke-width="0.1"/>`)
  s.table.tools.forEach((t, i) => {
    const holes: string[] = [],
      marks: string[] = []
    for (const hl of t.holes) {
      if (hl.end) holes.push(`<path d="M${n3(hl.x)} ${n3(hl.y)} L${n3(hl.end[0])} ${n3(hl.end[1])}" stroke="#ccc" stroke-width="${n3(t.d)}" stroke-linecap="round"/>`)
      else holes.push(`<circle cx="${n3(hl.x)}" cy="${n3(hl.y)}" r="${n3(t.d / 2)}"/>`)
      const cx = hl.end ? (hl.x + hl.end[0]) / 2 : hl.x,
        cy = hl.end ? (hl.y + hl.end[1]) / 2 : hl.y
      marks.push(symbol(i, cx, cy, sym / 2))
    }
    out.push(`<g data-tool="T${i + 1}" fill="#ccc">${holes.join('')}</g>`)
    out.push(`<path data-tool="T${i + 1}" d="${marks.join(' ')}" fill="none" stroke="#000" stroke-width="${n3(sym / 8)}"/>`)
  })
  const ly = b.y + b.h + margin + row
  out.push(label(title, x0 + margin, ly, text))
  s.table.tools.forEach((t, i) => {
    const y = ly + (i + 1) * row
    out.push(`<path d="${symbol(i, x0 + margin + sym, y - text / 3, sym / 2)}" fill="none" stroke="#000" stroke-width="${n3(sym / 8)}"/>`)
    out.push(label(rows[i], x0 + margin + sym * 3, y, text))
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n3(w)}mm" height="${n3(h)}mm" viewBox="${n3(x0)} ${n3(y0)} ${n3(w)} ${n3(h)}">\n<rect x="${n3(x0)}" y="${n3(y0)}" width="${n3(w)}" height="${n3(h)}" fill="#fff"/>\n${out.join('\n')}\n</svg>\n`
}
