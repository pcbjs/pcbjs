// Findings as marks, and labels drawn in Hershey Simplex: as an SVG path for 2D and the schematic, rasterised by sharp for 3D.
import type { Finding } from '@pcbjs/core/finding'
import { strokeText } from '@pcbjs/core/internal/text'
import type { Mark, Theme } from './spec.js'
import { THEME_COLORS } from './spec.js'

/** cap height of a label in output px */
export const LABEL_PX = 13
/** px between a mark and its label */
const LABEL_GAP = 10

const f = (v: number) => String(Math.round(v * 1000) / 1000)

/** The findings `which` names: `all`, finding ids or rule names; info only when named. */
export function pickFindings(all: Finding[], which: string[] | undefined): Finding[] {
  if (!which?.length) return []
  const every = which.includes('all')
  return all.filter(x => x.at && ((every && x.severity !== 'info') || which.includes(x.id) || which.includes(x.rule)))
}

/** A finding drawn as its mark says: one on a line as that line with its rule at the middle, any other as a ring with its witness as lines and points, and its rule as a label. */
export function findingMarks(list: Finding[], theme: Theme): Mark[] {
  const c = THEME_COLORS[theme]
  const out: Mark[] = []
  for (const x of list) {
    const color = x.severity === 'error' ? c.error : x.severity === 'warning' ? c.warning : c.info
    if (x.mark && 'line' in x.mark) {
      const [a, b] = x.mark.line
      out.push({ type: 'line', at: a, to: b, color, layer: x.mark.layer })
      out.push({ type: 'label', at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], text: x.rule, color, layer: x.mark.layer })
      continue
    }
    const layer = x.layer ?? x.witness?.layer
    const on = { color, ...(layer ? { layer } : {}) }
    for (const [a, b] of x.witness?.segments ?? []) out.push({ type: 'line', at: a, to: b, ...on })
    for (const p of x.witness?.points ?? []) out.push({ type: 'marker', at: p, radius: 3, ...on })
    out.push({ type: 'ring', at: x.at!, radius: 12, ...on })
    out.push({ type: 'label', at: x.at!, text: x.rule, ...on })
  }
  return out
}

/** A label's strokes as one path, its baseline start at x, y, cap height `size`. */
export function labelPath(text: string, x: number, y: number, size: number): { d: string; width: number } {
  const t = strokeText(text, { size, thickness: size / 7, anchor: 'start' })
  const d = t.strokes.map(s => 'M' + s.map(([px, py]) => `${f(x + px)} ${f(y + py)}`).join('L')).join('')
  return { d, width: t.width }
}

/** px a label sits right of and above its anchor */
export const LABEL_OFFSET: [number, number] = [LABEL_GAP, -LABEL_GAP - LABEL_PX]

/** A label as straight-alpha RGBA, as sharp gives raw pixels: the text in its colour over a halo of the canvas colour, for the renderer's label annotation. */
export async function labelImage(text: string, color: string, halo: string): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const pad = 4
  const { d, width } = labelPath(text, pad, pad + LABEL_PX, LABEL_PX)
  const w = Math.ceil(width + 2 * pad),
    h = Math.ceil(LABEL_PX * 1.4 + 2 * pad)
  const stroke = (c: string, sw: number) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${stroke(halo, 5)}${stroke(color, 1.8)}</svg>`
  const sharp = (await import('sharp')).default
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

/** `#rrggbb` as sRGB 0 to 1 with alpha. */
export function rgba(hex: string, alpha = 1): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha]
}
