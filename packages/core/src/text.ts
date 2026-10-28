import type { Ring } from './model.js'
import { SIMPLEX, SIMPLEX_ALIAS, SIMPLEX_CAP, SIMPLEX_EXTRA } from './fonts/hershey-simplex.js'
import { NEWSTROKE, NEWSTROKE_ALIAS, NEWSTROKE_CAP, NEWSTROKE_EXTRA } from './fonts/newstroke.js'

/** The stroke fonts: Hershey Simplex, the default, and NewStroke, KiCad's own. */
export type StrokeFontName = 'hershey' | 'newstroke'
interface StrokeFont {
  cap: number
  ascii: readonly (readonly number[])[]
  extra: Readonly<Record<string, readonly number[]>>
  alias: Readonly<Record<string, string>>
}
const FONTS: Record<StrokeFontName, StrokeFont> = {
  hershey: { cap: SIMPLEX_CAP, ascii: SIMPLEX, extra: SIMPLEX_EXTRA, alias: SIMPLEX_ALIAS },
  newstroke: { cap: NEWSTROKE_CAP, ascii: NEWSTROKE, extra: NEWSTROKE_EXTRA, alias: NEWSTROKE_ALIAS },
}

/** The stroke font a `font` prop names: "hershey" for undefined, "hershey" and "hershey-simplex", "newstroke"; null otherwise. */
export function strokeFontName(f: unknown): StrokeFontName | null {
  if (f === undefined || f === null || f === 'hershey' || f === 'hershey-simplex') return 'hershey'
  return f === 'newstroke' ? 'newstroke' : null
}

export type TextAnchor = 'start' | 'middle' | 'end'
export interface StrokeTextOptions {
  /** cap height in mm: the height of 'H' */
  size: number
  /** stroke width in mm, passed through for the caller */
  thickness: number
  /** glyph width in mm, KiCad's text width: glyphs stretch by width / size, the cap height stays; default `size` */
  width?: number
  anchor: TextAnchor
  /** baseline to baseline in mm, 1.6 x size by default */
  lineHeight?: number
  /** extra space between glyphs in mm, 0 by default */
  letterSpacing?: number
  /** the stroke font, Hershey Simplex by default */
  font?: StrokeFontName
}
export interface StrokeText {
  /** open polylines in the local frame: baseline of the first line at y = 0, x right, y down */
  strokes: Ring[]
  /** the advance width of the widest line, mm */
  width: number
  /** from the cap line of the first line to the baseline of the last, mm */
  height: number
  /** characters the font has no glyph for, each drawn as a box */
  missing: string[]
}

// the replacement glyph, a box the size of a capital
const BOX: readonly number[] = [16, 3, 0, 13, 0, 13, 21, 3, 21, 3, 0]

/** The glyph of a character, [advance, x1, y1, ...] in font units, or null when the font has none. */
export function glyphOf(ch: string, font: StrokeFontName = 'hershey'): readonly number[] | null {
  const f = FONTS[font]
  const c = f.alias[ch] ?? ch
  const code = c.codePointAt(0)!
  if (c.length === 1 && code >= 32 && code <= 126) return f.ascii[code - 32]
  return f.extra[c] ?? null
}

const nm = (v: number) => Math.round(v * 1e6) / 1e6 || 0

/** Lay out `text` in a stroke font, Hershey Simplex by default. Lines split at `\n`; each line is anchored on its own. */
export function strokeText(text: string, opts: StrokeTextOptions): StrokeText {
  const font = opts.font ?? 'hershey'
  const cap = FONTS[font].cap
  const scaleY = opts.size / cap
  const scaleX = (opts.width ?? opts.size) / cap
  const lineHeight = opts.lineHeight ?? 1.6 * opts.size
  const spacing = opts.letterSpacing ?? 0
  const lines = String(text).split(/\r?\n/)
  const strokes: Ring[] = []
  const missing = new Set<string>()
  let width = 0
  lines.forEach((line, row) => {
    const glyphs = [...line].map(ch => {
      const g = glyphOf(ch, font)
      if (!g) missing.add(ch)
      return g ?? BOX
    })
    const advance = glyphs.reduce((s, g) => s + g[0] * scaleX, 0) + Math.max(0, glyphs.length - 1) * spacing
    width = Math.max(width, advance)
    let x = opts.anchor === 'middle' ? -advance / 2 : opts.anchor === 'end' ? -advance : 0
    const y0 = row * lineHeight
    for (const g of glyphs) {
      let cur: Ring = []
      for (let i = 1; i + 1 < g.length; i += 2) {
        if (g[i] === -1 && g[i + 1] === -1) {
          if (cur.length) strokes.push(cur)
          cur = []
          continue
        }
        cur.push([nm(x + g[i] * scaleX), nm(y0 - g[i + 1] * scaleY)])
      }
      if (cur.length) strokes.push(cur)
      x += g[0] * scaleX + spacing
    }
  })
  return { strokes, width: nm(width), height: nm(opts.size + (lines.length - 1) * lineHeight), missing: [...missing] }
}
