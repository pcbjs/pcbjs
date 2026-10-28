// The schematic as SVG: one markup in CSS variables for the viewer, and a standalone file per theme. Elements carry the PCB's
// keys, data-ref, data-pin, data-net and data-items with the pad ids, so the viewer can cross-probe.
import type { Board, Mat, Pt } from '@pcbjs/core/model'
import type { PinSide, SchDrawing, SchLabel, SchSymbol } from '@pcbjs/core/sch-model'
import { strokeText, type TextAnchor } from '@pcbjs/core/text'
import { PIN_TEXT } from '@pcbjs/core/sch-symbol'

const f = (v: number) => String(Math.round(v * 1000) / 1000)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const ID = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')

/** The colours of a theme, the values of the `--sch-*` variables. */
export const SCH_THEMES = {
  light: {
    paper: '#f5f4ef',
    frame: '#8b2c2c',
    body: '#840000',
    fill: '#ffffc2',
    pin: '#840000',
    name: '#006464',
    ref: '#006464',
    wire: '#008400',
    label: '#000084',
    power: '#840000',
    nc: '#0000c4',
    sheet: '#840084',
    text: '#333333',
  },
  dark: {
    paper: '#1b1f27',
    frame: '#6b7280',
    body: '#e0a05a',
    fill: '#262b35',
    pin: '#e0a05a',
    name: '#7dd3c0',
    ref: '#94a3b8',
    wire: '#4ade80',
    label: '#93c5fd',
    power: '#f87171',
    nc: '#60a5fa',
    sheet: '#c084fc',
    text: '#cbd5e1',
  },
} as const
export type SchTheme = keyof typeof SCH_THEMES

/** Stroked text as path data: `at` is the start of the baseline, `rot` -90 reads upward. */
function textPath(text: string, at: Pt, size: number, anchor: TextAnchor = 'start', rot = 0): string {
  if (!text) return ''
  const t = strokeText(text, { size, thickness: 0, anchor, font: 'newstroke' })
  const map = rot === -90 ? (p: Pt): Pt => [at[0] + p[1], at[1] - p[0]] : (p: Pt): Pt => [at[0] + p[0], at[1] + p[1]]
  return t.strokes
    .map(
      s =>
        'M' +
        s
          .map(p => {
            const q = map(p)
            return `${f(q[0])} ${f(q[1])}`
          })
          .join('L'),
    )
    .join('')
}
const width = (text: string, size: number) => strokeText(text, { size, thickness: 0, anchor: 'start', font: 'newstroke' }).width
const matrix = (m: Mat) => `matrix(${m.map(f).join(' ')})`
const V: Record<PinSide, Pt> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }

function symbolMarkup(s: SchSymbol, g: number): string {
  const out: string[] = []
  const scale = Math.hypot(s.m[0], s.m[1])
  for (const b of s.body)
    out.push(
      `<path class="sch-body${b.fill ? ' sch-solid' : s.kind === 'box' || s.kind === 'connector' ? ' sch-box' : ''}" transform="${matrix(s.m)}" stroke-width="${f(0.254 / scale)}" d="${b.d}"/>`,
    )
  const h = PIN_TEXT
  for (const p of s.pins) {
    const name = !s.names
      ? ''
      : p.side === 'left'
        ? textPath(p.name, [p.root[0] + 0.4 * g, p.root[1] + h / 2], h)
        : p.side === 'right'
          ? textPath(p.name, [p.root[0] - 0.4 * g, p.root[1] + h / 2], h, 'end')
          : p.side === 'top'
            ? textPath(p.name, [p.root[0] + h / 2, p.root[1] + 0.4 * g], h, 'end', -90)
            : textPath(p.name, [p.root[0] + h / 2, p.root[1] - 0.4 * g], h, 'start', -90)
    out.push(
      `<g class="sch-pin" data-kind="pin" data-ref="${esc(s.ref)}" data-pin="${esc(p.name)}"${p.net ? ` data-net="${esc(p.net)}"` : ''}${p.items.length ? ` data-items="${p.items.join(' ')}"` : ''}><path class="sch-pin-line" d="M${f(p.end[0])} ${f(p.end[1])}L${f(p.root[0])} ${f(p.root[1])}"/>${name ? `<path class="sch-name" d="${name}"/>` : ''}</g>`,
    )
  }
  out.push(`<path class="sch-ref" d="${textPath(s.ref, s.refAt, PIN_TEXT)}"/>`)
  if (s.value) out.push(`<path class="sch-value" d="${textPath(s.value, s.valueAt, PIN_TEXT)}"/>`)
  return `<g class="sch-sym" id="sch-sym-${ID(s.ref)}" data-kind="symbol" data-ref="${esc(s.ref)}"${s.items.length ? ` data-items="${s.items.join(' ')}"` : ''}>${out.join('')}</g>`
}

function labelMarkup(l: SchLabel, g: number): string {
  const v = V[l.side],
    [x, y] = l.at
  const at = (k: number, n = 0): Pt => [x + v[0] * k * g - v[1] * n * g, y + v[1] * k * g + v[0] * n * g]
  const P = (p: Pt) => `${f(p[0])} ${f(p[1])}`
  const base = `data-kind="label" data-id="${l.id}" data-net="${esc(l.net)}"`
  const vertical = l.side === 'top' || l.side === 'bottom'
  if (l.kind === 'gnd') {
    const d = `M${P(at(0))}L${P(at(1))}M${P(at(1, -0.6))}L${P(at(1, 0.6))}M${P(at(1.25, -0.4))}L${P(at(1.25, 0.4))}M${P(at(1.5, -0.2))}L${P(at(1.5, 0.2))}`
    const name = /^GND$/i.test(l.net)
      ? ''
      : textPath(
          l.net,
          vertical
            ? [at(2.1)[0] - PIN_TEXT * 1.5, at(2.1)[1] + (l.side === 'bottom' ? PIN_TEXT : 0)]
            : [at(1.9)[0] - (l.side === 'left' ? width(l.net, PIN_TEXT) : 0), at(1.9)[1] + PIN_TEXT / 2],
          PIN_TEXT,
        )
    return `<g class="sch-label sch-power" ${base}><path class="sch-power-line" d="${d}"/>${name ? `<path class="sch-label-text" d="${name}"/>` : ''}</g>`
  }
  if (l.kind === 'vcc') {
    const d = `M${P(at(0))}L${P(at(1))}M${P(at(1, -0.5))}L${P(at(1, 0.5))}`
    const w = width(l.net, PIN_TEXT)
    const t = vertical
      ? ([at(1.3)[0] - w / 2, at(1.3)[1] + (l.side === 'bottom' ? PIN_TEXT : 0)] as Pt)
      : ([l.side === 'left' ? at(1.3)[0] - w : at(1.3)[0], at(1.3)[1] + PIN_TEXT / 2] as Pt)
    return `<g class="sch-label sch-power" ${base}><path class="sch-power-line" d="${d}"/><path class="sch-label-text" d="${textPath(l.net, t, PIN_TEXT)}"/></g>`
  }
  // a flag pointing at its pin, the name inside
  const w = width(l.net, PIN_TEXT) / g,
    half = 0.35
  const d = `M${P(at(0))}L${P(at(0.4, -half))}L${P(at(0.7 + w, -half))}L${P(at(0.7 + w, half))}L${P(at(0.4, half))}Z`
  const text = vertical
    ? textPath(l.net, [x + PIN_TEXT / 2, l.side === 'top' ? y - 0.5 * g : y + (0.5 + w) * g], PIN_TEXT, 'start', -90)
    : textPath(l.net, [l.side === 'right' ? x + 0.5 * g : x - (0.5 + w) * g, y + PIN_TEXT / 2], PIN_TEXT)
  return `<g class="sch-label" ${base}><path class="sch-flag" d="${d}"/><path class="sch-label-text" d="${text}"/></g>`
}

/** The drawing as SVG elements in `--sch-*` colours, without the <svg> around it; the viewBox is `d.page`. A paper adds its frame and title block. */
export function schematicMarkup(d: SchDrawing, board?: Pick<Board, 'name' | 'revision'>): string {
  const g = d.grid
  const [x0, y0, x1, y1] = d.page
  const out: string[] = []
  if (d.paper) {
    const { w, h } = d.paper
    const tb = { x: w - 110, y: h - 25, w: 100, h: 15 }
    out.push(
      `<g class="sch-frame"><rect class="sch-paper" x="0" y="0" width="${f(w)}" height="${f(h)}"/><rect class="sch-border" x="5" y="5" width="${f(w - 10)}" height="${f(h - 10)}"/>` +
        `<rect class="sch-border" x="${f(tb.x)}" y="${f(tb.y)}" width="${f(tb.w)}" height="${f(tb.h)}"/>` +
        `<path class="sch-title" d="${textPath(d.title, [tb.x + 3, tb.y + 6], 2.5)}${board ? textPath(`${board.name}  rev ${board.revision}  ${d.paper.name}`, [tb.x + 3, tb.y + 12], 1.5) : ''}"/></g>`,
    )
  } else out.push(`<rect class="sch-paper" x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}"/>`)
  for (const s of d.sheets) {
    const name = s.auto ? '' : `<path class="sch-sheet-name" d="${textPath(s.name, [s.box[0] + 0.8, s.box[1] + 2.2], PIN_TEXT)}"/>`
    out.push(
      `<g class="sch-sheet" data-kind="sheet" data-path="${esc(s.path.join('/'))}"><rect x="${f(s.box[0])}" y="${f(s.box[1])}" width="${f(s.box[2] - s.box[0])}" height="${f(s.box[3] - s.box[1])}"/>${name}</g>`,
    )
  }
  for (const s of d.symbols) out.push(symbolMarkup(s, g))
  for (const wr of d.wires)
    out.push(
      `<path class="sch-wire" id="sch-${wr.id.replace(':', '-')}" data-kind="wire" data-id="${wr.id}" data-net="${esc(wr.net)}" d="M${wr.pts.map(p => `${f(p[0])} ${f(p[1])}`).join('L')}"/>`,
    )
  for (const j of d.junctions) out.push(`<circle class="sch-junction" data-kind="junction" data-net="${esc(j.net)}" cx="${f(j.at[0])}" cy="${f(j.at[1])}" r="0.5"/>`)
  for (const l of d.labels) out.push(labelMarkup(l, g))
  for (const p of d.noConnects)
    out.push(`<path class="sch-nc" d="M${f(p[0] - 0.6)} ${f(p[1] - 0.6)}L${f(p[0] + 0.6)} ${f(p[1] + 0.6)}M${f(p[0] - 0.6)} ${f(p[1] + 0.6)}L${f(p[0] + 0.6)} ${f(p[1] - 0.6)}"/>`)
  for (const t of d.texts) out.push(`<path class="sch-text" d="${textPath(t.text, t.at, t.size)}"/>`)
  return out.join('\n')
}

/** The stylesheet of the markup: every colour a `--sch-*` variable, set to `theme`'s values when given. */
export function schematicStyle(theme?: SchTheme): string {
  const vars = theme
    ? `:root,svg{${Object.entries(SCH_THEMES[theme])
        .map(([k, v]) => `--sch-${k}:${v}`)
        .join(';')}}`
    : ''
  return `${vars}
.sch-paper{fill:var(--sch-paper)}.sch-border{fill:none;stroke:var(--sch-frame);stroke-width:0.3}.sch-title{fill:none;stroke:var(--sch-frame);stroke-width:0.25}
.sch-body{fill:none;stroke:var(--sch-body);stroke-linecap:round;stroke-linejoin:round}.sch-box{fill:var(--sch-fill)}.sch-solid{fill:var(--sch-body)}
.sch-pin-line{stroke:var(--sch-pin);stroke-width:0.254}.sch-name{fill:none;stroke:var(--sch-name);stroke-width:0.16;stroke-linecap:round;stroke-linejoin:round}
.sch-ref,.sch-value{fill:none;stroke:var(--sch-ref);stroke-width:0.16;stroke-linecap:round;stroke-linejoin:round}
.sch-wire{fill:none;stroke:var(--sch-wire);stroke-width:0.254;stroke-linecap:round;stroke-linejoin:round}.sch-junction{fill:var(--sch-wire)}
.sch-flag{fill:none;stroke:var(--sch-label);stroke-width:0.2}.sch-label-text{fill:none;stroke:var(--sch-label);stroke-width:0.16;stroke-linecap:round;stroke-linejoin:round}
.sch-power-line{fill:none;stroke:var(--sch-power);stroke-width:0.254;stroke-linecap:round}.sch-power .sch-label-text{stroke:var(--sch-power)}
.sch-nc{fill:none;stroke:var(--sch-nc);stroke-width:0.254}.sch-sheet rect{fill:none;stroke:var(--sch-sheet);stroke-width:0.2;stroke-dasharray:1 0.6}
.sch-sheet-name{fill:none;stroke:var(--sch-sheet);stroke-width:0.16}.sch-text{fill:none;stroke:var(--sch-text);stroke-width:0.2;stroke-linecap:round}`
}

/** A standalone `<board>.sch.svg` in one theme. */
export function schematicSvg(board: Board, theme: SchTheme = 'light'): string {
  const d = board.schematic.drawing
  if (!d) throw new Error(`${board.name} has no schematic drawing`)
  const [x0, y0, x1, y1] = d.page
  const w = x1 - x0,
    h = y1 - y0
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" width="${f(w)}mm" height="${f(h)}mm" data-board="${esc(board.name)}">
<style>${schematicStyle(theme)}</style>
${schematicMarkup(d, board)}
</svg>
`
}
