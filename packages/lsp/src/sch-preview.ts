import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SchDrawing } from '@pcbjs/core/sch-model'
import type { SiteData } from '@pcbjs/core/site-data'
import { WIDTH, type Preview } from './preview.js'

type Box = [number, number, number, number]
interface Ranged {
  key: string
  what: string
  box: Box
  src: { line: number; col: number; endLine: number; endCol: number }
}

const ACCENT = '#6ea8ff'
/** The SVG text stays under this, so the markdown of a hover stays under VS Code's 100 000 characters. */
const BUDGET = 56000

const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
const around = (pts: [number, number][], r = 0): Box => pts.reduce<Box>((b, p) => union(b, [p[0] - r, p[1] - r, p[0] + r, p[1] + r]), [Infinity, Infinity, -Infinity, -Infinity])
const meets = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
const relKey = (root: string, file: string) => {
  const r = relative(root, file)
  return isAbsolute(r) ? file : r.split(sep).join('/')
}

/** The ends of a symbol's ref and value, words of 1.27 mm glyphs about as wide as high. */
const words = (s: SchDrawing['symbols'][number]): [number, number][] => [
  s.refAt,
  s.valueAt,
  [s.refAt[0] + 1.27 * s.ref.length, s.refAt[1]],
  [s.valueAt[0] + 1.27 * s.value.length, s.valueAt[1]],
]

/** Every element drawn from code with a range in `file`, with its bounds in sheet mm. */
function ranged(d: SchDrawing, root: string, file: string): Ranged[] {
  const out: Ranged[] = []
  const mine = (s?: { file: string; endLine?: number }) => !!s && s.endLine != null && (s.file === relKey(root, file) || resolve(root, s.file) === file)
  const add = (key: string, what: string, box: Box, s?: { file: string; line: number; col: number; endLine?: number; endCol?: number }) => {
    if (mine(s)) out.push({ key, what, box, src: { line: s!.line, col: s!.col, endLine: s!.endLine!, endCol: s!.endCol! } })
  }
  for (const s of d.symbols)
    add(`[data-kind="symbol"][data-ref="${s.ref}"]`, `symbol **${s.ref}** ${s.value}`, union(s.box, around([...s.pins.map(p => p.end), ...words(s)], d.grid / 2)), s.src)
  for (const w of d.wires) add(`[data-id="${w.id}"]`, `wire of net **${w.net}**`, around(w.pts, d.grid / 2), w.src)
  for (const l of d.labels) add(`[data-id="${l.id}"]`, `${l.kind === 'label' ? 'label' : 'power symbol'} **${l.net}**`, around([l.at], 2 * d.grid), l.src)
  for (const s of d.sheets) add(`[data-kind="sheet"][data-path="${s.path.join('/')}"]`, `sheet **${s.name}**`, s.box, s.src)
  return out
}

/** The innermost drawn element whose range holds a 1-based position, first, then those nested in it. */
function under(els: Ranged[], line: number, col: number): Ranged[] {
  const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1]
  const hits = els.filter(e => cmp([line, col], [e.src.line, e.src.col]) > 0 && cmp([line, col], [e.src.endLine, e.src.endCol]) <= 0)
  if (!hits.length) return []
  const span = (e: Ranged) => (e.src.endLine - e.src.line) * 1e6 + e.src.endCol - e.src.col
  const best = hits.reduce((a, b) => (span(b) < span(a) ? b : a))
  return [
    best,
    ...els.filter(
      e => e !== best && cmp([e.src.line, e.src.col], [best.src.line, best.src.col]) >= 0 && cmp([e.src.endLine, e.src.endCol], [best.src.endLine, best.src.endCol]) <= 0,
    ),
  ]
}

/** The crop: the elements with a margin, 1:2 to 1:1 high to wide, kept on the page. */
function crop(b: Box, d: SchDrawing): Box {
  const m = 3 * d.grid
  let [x0, y0, x1, y1] = [b[0] - m, b[1] - m, b[2] + m, b[3] + m]
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2
  let w = x1 - x0,
    h = y1 - y0
  if (h > w) w = h
  if (h < w / 2) h = w / 2
  const [px0, py0, px1, py1] = d.page
  x0 = Math.max(px0, cx - w / 2)
  y0 = Math.max(py0, cy - h / 2)
  return [x0, y0, Math.min(px1, x0 + w), Math.min(py1, y0 + h)]
}

/** The markup of the elements that meet the crop; the lines of the markup follow the drawing's lists, the frame first. */
function culled(site: SiteData, d: SchDrawing, c: Box): string {
  const lines = site.schematic.svg!.markup.split('\n')
  const boxes: (Box | null)[] = [
    null,
    ...d.sheets.map(s => s.box),
    ...d.symbols.map(s => union(s.box, around([...s.pins.map(p => p.end), ...words(s)], d.grid))),
    ...d.wires.map(w => around(w.pts, 1)),
    ...d.junctions.map(j => around([j.at], 1)),
    ...d.labels.map(l => around([l.at], 6 * d.grid)),
    ...d.noConnects.map(p => around([p], 1)),
    ...d.texts.map(t => around([t.at], 40 * d.grid)),
  ]
  if (boxes.length !== lines.length) return lines[0]
  return lines.filter((_, i) => !boxes[i] || meets(boxes[i]!, c)).join('')
}

/** The image of what the schematic code under a 1-based position drew, or undefined when it drew nothing there. */
export function schPreview(site: SiteData, root: string, file: string, line: number, col: number): { preview: Preview; lines: string[] } | undefined {
  const d = site.schematic.drawing,
    svg = site.schematic.svg
  if (!d || !svg?.themes) return undefined
  const els = under(ranged(d, root, file), line, col)
  if (!els.length) return undefined
  const c = crop(els.map(e => e.box).reduce(union), d)
  const mark = els.map(e => `${e.key},${e.key} *`).join(',')
  // the colours written out, for renderers without CSS variables
  const dark = svg.themes.dark
  const style = `${svg.style.replace(/var\(--sch-([a-z]+)\)/g, (v, k: string) => dark[k] ?? v)}${mark}{stroke:${ACCENT}!important}`
  const w = c[2] - c[0],
    h = c[3] - c[1]
  const height = Math.round((WIDTH * h) / w)
  const text = `<svg xmlns='http://www.w3.org/2000/svg' width='${WIDTH}' height='${height}' viewBox='${c[0]} ${c[1]} ${w} ${h}' data-box='${c.map(v => +v.toFixed(3)).join(' ')}'><style>${style}</style>${culled(site, d, c)}</svg>`
  if (text.length > BUDGET) return undefined
  const preview: Preview = {
    svg: text,
    uri: `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`,
    box: { x: c[0], y: c[1], w, h },
    width: WIDTH,
    height,
    scale: d.grid,
  }
  const named = els.slice(0, 3).map(e => e.what)
  return { preview, lines: [named.join(' · ') + (els.length > 3 ? ` and ${els.length - 3} more` : '')] }
}
