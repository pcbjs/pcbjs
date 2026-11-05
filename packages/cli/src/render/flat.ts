// The 2D and schematic views as SVG from the exporter's markup, for sharp to rasterise: layers chosen and ordered by side, the
// rest faded behind a highlight drawn again on top with an outline, framed by a viewBox, mirrored, marks and labels over it.
import type { Board } from '@pcbjs/core/model'
import { flagLayer } from '@pcbjs/core/internal/layers'
import { holesMarkup, layerMarkup, ringPath } from '@pcbjs/export/internal/svg'
import { SCH_THEMES, schematicMarkup, schematicStyle } from '@pcbjs/export/internal/sch-svg'
import type { Box, Target } from './targets.js'
import { THEME_COLORS, type Mark, type RenderSpec, type Theme } from './spec.js'
import { LABEL_PX, labelPath } from './marks.js'

/** the board laminate, as the viewer's --substrate */
export const SUBSTRATE = '#1b2129'
/** the far side's copper and silk and the inner layers under the near side */
const FAR = 0.45
/** the rest's opacity at full dim */
const DIM_FLOOR = 0.2
/** the outline of a highlight, output px */
const OUTLINE_PX = 2

const f = (v: number) => String(Math.round(v * 1e4) / 1e4)

/** What a view draws in: the viewBox in its own mm and the mm per output px. */
export interface Frame {
  vb: Box
  mmPerPx: number
}

/** The box grown by `margin` on every side, then to the output's aspect around its centre. */
export function fitFrame(box: Box, margin: number, size: [number, number]): Frame {
  const [x0, y0, x1, y1] = [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin]
  const w = Math.max(x1 - x0, 1e-3),
    h = Math.max(y1 - y0, 1e-3)
  const s = Math.max(w / size[0], h / size[1])
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2
  const W = size[0] * s,
    H = size[1] * s
  return { vb: [cx - W / 2, cy - H / 2, cx + W / 2, cy + H / 2], mmPerPx: s }
}

/** The layers a 2D shot draws: those named, the outline always; copper, silk and the outline by default. */
export function layers2d(board: Board, named: string[] | undefined): string[] {
  const ids = board.layers.map(l => l.id)
  const kind = (k: string) => board.layers.filter(l => l.kind === k).map(l => l.id)
  const words: Record<string, string[]> = {
    copper: kind('copper'),
    silk: kind('silkscreen'),
    mask: kind('mask'),
    paste: kind('paste'),
    courtyard: kind('courtyard'),
    fab: kind('fab'),
  }
  if (!named?.length)
    return [...new Set([...kind('copper'), ...kind('silkscreen'), 'Edge.Cuts', ...(board.references ?? []).flatMap(r => (r.show.outline ? [r.show.outline] : []))])]
  const out = new Set<string>(['Edge.Cuts'])
  for (const n of named) {
    const id = words[n] ? null : flagLayer(n)
    const got = words[n] ?? (id && ids.includes(id) ? [id] : null)
    if (!got) throw new Error(`render: no layer ${n} on ${board.name}; layers ${ids.join(', ')}, or copper, silk, mask, paste, courtyard, fab`)
    for (const g of got) out.add(g)
  }
  return [...out]
}

const sideOf = (id: string): 'F' | 'B' | null => (id.startsWith('F.') ? 'F' : id.startsWith('B.') ? 'B' : null)

/** Back to front as drawn: side B turns the order so its layers are on top, the outline and drawings last either way. */
export function drawOrder(board: Board, shown: string[], side: 'F' | 'B'): Board['layers'] {
  const ls = board.layers.filter(l => shown.includes(l.id)).sort((a, b) => a.order - b.order)
  const sided = ls.filter(l => l.side !== 'both')
  return [...(side === 'B' ? sided.reverse() : sided), ...ls.filter(l => l.side === 'both')]
}

/** A line of the exporter's markup is one element; it is lit when it carries a lit ref, net or item id. */
function litTest(targets: Target[]): (line: string) => boolean {
  const refs = new Set(targets.flatMap(t => t.parts))
  const nets = new Set(targets.flatMap(t => t.nets))
  const ids = new Set(targets.flatMap(t => t.items.map(i => String(i.id))))
  if (!refs.size && !nets.size && !ids.size) return () => false
  const attr = (line: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(line)?.[1]
  return line => {
    const r = attr(line, 'data-ref'),
      n = attr(line, 'data-net'),
      id = attr(line, 'data-id')
    return (
      (!!r && refs.has(r)) ||
      (!!n &&
        nets.has(
          n
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&amp;/g, '&'),
        )) ||
      (!!id && ids.has(id))
    )
  }
}

/** An element outlined: a stroked one widened under itself in the accent, a filled one stroked. */
function outlined(line: string, accent: string, w: number): string {
  const sw = /stroke-width="([\d.]+)"/.exec(line)
  if (sw && /fill="none"/.test(line)) return line.replace(/stroke="currentColor"/, `stroke="${accent}"`).replace(sw[0], `stroke-width="${f(Number(sw[1]) + 2 * w)}"`) + '\n' + line
  return line.replace(/^<(path|circle|rect)/, `<$1 fill="none" stroke="${accent}" stroke-width="${f(w)}"`)
}

/** Marks in a view's own mm, mirrored about the frame's centre when the view is; labels stay upright. */
function marksSvg(marks: Mark[], fr: Frame, mirror: boolean, theme: Theme): string {
  const c = THEME_COLORS[theme]
  const s = fr.mmPerPx
  const cx = (fr.vb[0] + fr.vb[2]) / 2
  const x = (v: number) => (mirror ? 2 * cx - v : v)
  return marks
    .map(m => {
      const col = m.color ?? c.accent
      const [px, py] = [x(m.at[0]), m.at[1]]
      if (m.type === 'line') return `<path d="M${f(px)} ${f(py)}L${f(x(m.to![0]))} ${f(m.to![1])}" stroke="${col}" stroke-width="${f(2 * s)}" stroke-linecap="round" fill="none"/>`
      if (m.type === 'marker') return `<circle cx="${f(px)}" cy="${f(py)}" r="${f((m.radius ?? 4) * s)}" fill="${col}"/>`
      if (m.type === 'ring') return `<circle cx="${f(px)}" cy="${f(py)}" r="${f((m.radius ?? 12) * s)}" fill="none" stroke="${col}" stroke-width="${f(2 * s)}"/>`
      const { d } = labelPath(m.text!, px + 10 * s, py - 10 * s, LABEL_PX * s)
      const stroke = (k: string, w: number) => `<path d="${d}" fill="none" stroke="${k}" stroke-width="${f(w * s)}" stroke-linecap="round" stroke-linejoin="round"/>`
      return stroke(c.canvas, 5) + stroke(col, 1.8)
    })
    .join('\n')
}

export const svgOpen = (fr: Frame, size: [number, number], canvas: string) => {
  const [x0, y0, x1, y1] = fr.vb
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}" width="${size[0]}" height="${size[1]}">\n` +
    `<rect x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" fill="${canvas}"/>`
  )
}

export const mirrored = (fr: Frame, on: boolean) => (on ? ` transform="matrix(-1 0 0 1 ${f(fr.vb[0] + fr.vb[2])} 0)"` : '')

export interface FlatInput {
  spec: RenderSpec
  board: Board
  frame: Target | null
  highlight: Target[]
  marks: Mark[]
  theme: Theme
  size: [number, number]
}

/** The 2D view as SVG at the output size. */
export function boardView(o: FlatInput): string {
  const { spec, board, theme, size } = o
  const c = THEME_COLORS[theme]
  const side = spec.side ?? 'F'
  const box = o.frame?.box ?? [board.bbox.x, board.bbox.y, board.bbox.x + board.bbox.w, board.bbox.y + board.bbox.h]
  const fr = fitFrame(box, o.frame ? (spec.margin ?? 1) : 2, size)
  const shown = layers2d(board, spec.layers)
  const order = drawOrder(board, shown, side)
  const lit = litTest(o.highlight)
  const fade = o.highlight.length ? 1 - (1 - DIM_FLOOR) * (spec.dim ?? 0.6) : 1
  const both = shown.some(id => sideOf(id) === 'F') && shown.some(id => sideOf(id) === 'B')
  const groupOpacity = (id: string, kind: string) => {
    const far = both && (kind === 'copper' || kind === 'silkscreen') && sideOf(id) !== side
    const own = spec.opacity?.[id] ?? spec.opacity?.[kind === 'silkscreen' ? 'silk' : kind] ?? 1
    return (far ? FAR : 1) * own
  }
  const groups: string[] = []
  const top: string[] = []
  for (const l of order) {
    const lines = layerMarkup(board, l.id).split('\n').filter(Boolean)
    const o = groupOpacity(l.id, l.kind) * fade
    groups.push(`<g color="${l.color}" fill="currentColor" opacity="${f(o)}">\n${lines.join('\n')}\n</g>`)
    const hit = lines.filter(lit)
    if (hit.length) top.push(`<g color="${l.color}" fill="currentColor">\n${hit.map(h => outlined(h, c.accent, OUTLINE_PX * fr.mmPerPx)).join('\n')}\n</g>`)
  }
  const outline = board.outline.length ? `<path fill="${SUBSTRATE}" fill-rule="evenodd" d="${ringPath(board.outline)}"/>` : ''
  return [
    svgOpen(fr, size, c.canvas),
    `<g${mirrored(fr, !!spec.mirror)}>`,
    outline,
    ...groups,
    `<g fill="${c.canvas}">\n${holesMarkup(board)}\n</g>`,
    ...top,
    '</g>',
    marksSvg(o.marks, fr, !!spec.mirror, theme),
    '</svg>',
  ].join('\n')
}

/** The schematic as SVG at the output size, in the light colours or the dark ones for dark and hc; null for a board without one. */
export function schematicView(o: FlatInput): string | null {
  const d = o.board.schematic.drawing
  if (!d) return null
  const c = THEME_COLORS[o.theme]
  const vars = SCH_THEMES[o.theme === 'light' ? 'light' : 'dark'] as Record<string, string>
  // librsvg reads no CSS variables, so each is written in
  const style = schematicStyle()
    .replace(/var\(--sch-([a-z]+)\)/g, (_, k: string) => vars[k])
    .replace(/^\s*\n/, '')
  const sym = (ref: string): Box | null => d.symbols.find(s => s.ref === ref)?.box ?? null
  const wires = (net: string): Box | null =>
    d.wires
      .filter(w => w.net === net)
      .flatMap(w => w.pts)
      .reduce<Box | null>((b, [x, y]) => (b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y]), null)
  let box: Box | null = null
  for (const b of [...(o.frame?.parts ?? []).map(sym), ...(o.frame?.nets ?? []).map(wires)])
    if (b) box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b
  const fr = fitFrame(box ?? d.page, box ? (o.spec.margin ?? 5) : 0, o.size)
  const lit = litTest(o.highlight)
  const fade = o.highlight.length ? 1 - (1 - DIM_FLOOR) * (o.spec.dim ?? 0.6) : 1
  const lines = schematicMarkup(d, o.board).split('\n')
  const hit = lines.filter(lit)
  return [
    svgOpen(fr, o.size, c.canvas),
    `<style>${style}\n.lit .sch-body,.lit .sch-wire,.lit .sch-pin-line,.lit .sch-flag{stroke:${c.accent}}</style>`,
    `<g opacity="${f(fade)}">\n${lines.join('\n')}\n</g>`,
    hit.length ? `<g class="lit">\n${hit.join('\n')}\n</g>` : '',
    '</svg>',
  ].join('\n')
}
