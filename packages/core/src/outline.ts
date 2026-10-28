// TrueType and OpenType text as filled polygons in mm: opentype.js reads the file, Clipper unions the contours.
import opentype from 'opentype.js'
import ClipperLib from 'clipper-lib'
import type { Poly, Ring } from './model.js'
import type { TextAnchor } from './text.js'
import type { FontSpec } from './types.js'

export type { FontSpec }

/** A font as `fonts` maps it: a file path, or a FontSpec. */
export type FontEntry = string | FontSpec

/** A parsed outline font, cached per file and weight. */
export interface OutlineFont {
  /** the absolute path */
  path: string
  family: string
  /** the style name of the instance, such as "Bold" */
  style: string
  weight?: number
  /** name table ID 13 */
  license?: string
  /** name table ID 0 */
  copyright?: string
  /** name table ID 14 */
  licenseURL?: string
  unitsPerEm: number
  /** cap height in font units: OS/2 sCapHeight, else the top of 'H' */
  capHeight: number
  /** @internal */ font: any
  /** @internal */ coords?: Record<string, number>
}

export interface OutlineTextOptions {
  /** cap height in mm, as for the stroke font */
  size: number
  /** glyph width in mm: advances and glyphs stretch by width / size across the baseline; default `size` */
  width?: number
  anchor: TextAnchor
  /** baseline to baseline in mm, 1.6 x size by default */
  lineHeight?: number
  /** extra space between glyphs in mm, 0 by default */
  letterSpacing?: number
}
export interface OutlineText {
  /** filled polygons in the local frame: baseline of the first line at y = 0, x right, y down */
  polys: Poly[]
  /** the advance width of the widest line, mm */
  width: number
  /** from the cap line of the first line to the baseline of the last, mm */
  height: number
  /** characters the font has no glyph for, each drawn with the font's .notdef glyph */
  missing: string[]
}

function nodeFs(): typeof import('node:fs') | null {
  const p = (globalThis as any).process
  if (!p || typeof p.getBuiltinModule !== 'function') return null
  try {
    return p.getBuiltinModule('node:fs')
  } catch {
    return null
  }
}

// parsed fonts by path, mtime and weight, shared by every copy of this module
const CACHE: Map<string, OutlineFont> = ((globalThis as any)[Symbol.for('pcbjs.fonts.cache')] ??= new Map())

/** Read and parse an outline font. Throws a plain Error naming the file when it is missing or not a font. */
export function loadOutlineFont(path: string, weight?: number): OutlineFont {
  const fs = nodeFs()
  if (!fs) throw new Error(`outline fonts are read in Node only, not ${path}`)
  let stat: import('node:fs').Stats
  try {
    stat = fs.statSync(path)
  } catch {
    throw new Error(`font file not found: ${path}`)
  }
  const key = `${path}\0${stat.mtimeMs}\0${weight ?? ''}`
  const hit = CACHE.get(key)
  if (hit) return hit
  const buf = fs.readFileSync(path)
  let font: any
  try {
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  } catch (e) {
    throw new Error(`${path} is not a TrueType or OpenType font: ${(e as Error).message}`)
  }
  const axes: any[] = font.tables.fvar?.axes ?? []
  let coords: Record<string, number> | undefined
  let style = name(font, 'fontSubfamily') ?? 'Regular'
  if (weight !== undefined) {
    const w = axes.find(a => a.tag === 'wght')
    if (!w) throw new Error(`${path} is not a variable font with a weight axis; weight ${weight} needs one, or name the file of that weight`)
    if (!(weight >= w.minValue && weight <= w.maxValue)) throw new Error(`${path}: weight ${weight} is outside the font's range ${w.minValue} to ${w.maxValue}`)
    coords = Object.fromEntries(axes.map(a => [a.tag, a.tag === 'wght' ? weight : a.defaultValue]))
    font.variation.set(coords)
    const inst = (font.tables.fvar.instances ?? []).find((i: any) => Object.entries(coords!).every(([t, v]) => i.coordinates?.[t] === v))
    style = inst?.name?.en ?? `wght ${weight}`
  } else if (axes.length) coords = Object.fromEntries(axes.map(a => [a.tag, a.defaultValue]))
  const H = font.charToGlyph('H')
  const capHeight = font.tables.os2?.sCapHeight || (H && H.index ? glyphPath(font, H, coords).bounds[3] : 0) || font.ascender * 0.7
  const out: OutlineFont = {
    path,
    family: name(font, 'preferredFamily') ?? name(font, 'fontFamily') ?? path,
    style,
    ...(weight !== undefined ? { weight } : {}),
    unitsPerEm: font.unitsPerEm,
    capHeight,
    font,
    ...(coords ? { coords } : {}),
  }
  const lic = name(font, 'license')
  if (lic) out.license = lic
  const copy = name(font, 'copyright'),
    url = name(font, 'licenseURL')
  if (copy) out.copyright = copy
  if (url) out.licenseURL = url
  CACHE.set(key, out)
  return out
}

function name(font: any, key: string): string | undefined {
  const rec = font.names?.[key] ?? font.names?.windows?.[key] ?? font.names?.macintosh?.[key] ?? font.names?.unicode?.[key]
  if (!rec) return undefined
  return rec.en ?? (Object.values(rec)[0] as string | undefined)
}

interface GlyphShape {
  contours: [number, number][][]
  advance: number
  bounds: [number, number, number, number]
}
const SHAPES = new WeakMap<object, Map<number, GlyphShape>>()

/** A glyph's contours in font units, y up, curves flattened to within 1/2000 em, and its advance with the font's variation applied. */
function glyphPath(font: any, glyph: any, coords: Record<string, number> | undefined): GlyphShape {
  const tol = (font.unitsPerEm || 1000) / 2000
  let m = SHAPES.get(font)
  if (!m) {
    m = new Map()
    SHAPES.set(font, m)
  }
  const hit = m.get(glyph.index)
  if (hit) return hit
  const g = coords && font.variation ? font.variation.getTransform(glyph, coords) : glyph
  const cmds: any[] = g.path?.commands ?? []
  const contours: [number, number][][] = []
  let cur: [number, number][] = []
  let x = 0,
    y = 0
  const close = () => {
    if (cur.length >= 3) contours.push(cur)
    cur = []
  }
  for (const c of cmds) {
    if (c.type === 'M') {
      close()
      cur.push([c.x, c.y])
      x = c.x
      y = c.y
    } else if (c.type === 'L') {
      cur.push([c.x, c.y])
      x = c.x
      y = c.y
    } else if (c.type === 'Q') {
      const dx = x - 2 * c.x1 + c.x,
        dy = y - 2 * c.y1 + c.y
      const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(Math.hypot(dx, dy) / (4 * tol)))))
      for (let i = 1; i <= n; i++) {
        const t = i / n,
          u = 1 - t
        cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, u * u * y + 2 * u * t * c.y1 + t * t * c.y])
      }
      x = c.x
      y = c.y
    } else if (c.type === 'C') {
      const d = Math.max(Math.hypot(x - 2 * c.x1 + c.x2, y - 2 * c.y1 + c.y2), Math.hypot(c.x1 - 2 * c.x2 + c.x, c.y1 - 2 * c.y2 + c.y))
      const n = Math.min(64, Math.max(1, Math.ceil(Math.sqrt((6 * d) / (8 * tol)))))
      for (let i = 1; i <= n; i++) {
        const t = i / n,
          u = 1 - t
        cur.push([u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y])
      }
      x = c.x
      y = c.y
    } else if (c.type === 'Z') close()
  }
  close()
  for (const r of contours) {
    const a = r[0],
      b = r[r.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) r.pop()
  }
  const all = contours.flat()
  const bounds: [number, number, number, number] = all.length
    ? [Math.min(...all.map(p => p[0])), Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1]))]
    : [0, 0, 0, 0]
  const shape = { contours, advance: (glyph.advanceWidth ?? 0) + advanceDelta(font, glyph, coords), bounds }
  m.set(glyph.index, shape)
  return shape
}

/** A variable glyph's advance delta from gvar's phantom points, as FreeType, for fonts without HVAR; opentype.js does not vary advances. */
function advanceDelta(font: any, glyph: any, coords: Record<string, number> | undefined): number {
  if (!coords || font.tables.hvar) return 0
  const proc = font.variation?.process
  const gvar = proc?.gvar?.()
  const data = gvar?.glyphVariations?.[glyph.index]
  if (!data?.headers?.length) return 0
  const norm: number[] = proc.getNormalizedCoords(coords)
  const axisCount: number = font.tables.fvar.axes.length
  const n = glyph.isComposite ? glyph.components.length : (glyph.points?.length ?? 0)
  let d0 = 0,
    d1 = 0
  for (const h of data.headers) {
    const peak: number[] = h.peakTuple ?? gvar.sharedTuples[h.sharedTupleRecordsIndex]
    let f = 1
    for (let a = 0; a < axisCount; a++) {
      const p = peak[a],
        v = norm[a]
      if (p === 0) continue
      if (v === 0) {
        f = 0
        break
      }
      if (!h.intermediateStartTuple) {
        if (v < Math.min(0, p) || v > Math.max(0, p)) {
          f = 0
          break
        }
        f *= v / p
      } else {
        const s = h.intermediateStartTuple[a],
          e = h.intermediateEndTuple[a]
        if (v < s || v > e) {
          f = 0
          break
        }
        f *= v < p ? (v - s) / (p - s) : (e - v) / (e - p)
      }
    }
    if (!f) continue
    const pts: number[] = h.privatePoints?.length ? h.privatePoints : (data.sharedPoints ?? [])
    const at = (i: number) => (pts.length ? (k => (k < 0 ? 0 : h.deltas[k]))(pts.indexOf(i)) : (h.deltas[i] ?? 0))
    d0 += at(n) * f
    d1 += at(n + 1) * f
  }
  return Math.round(d1 - d0)
}

const S = 1e6
const toC = (r: Ring) => r.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }))
const fromC = (p: { X: number; Y: number }[]): Ring => p.map(({ X, Y }) => [X / S, Y / S])
function tree(t: any): Poly[] {
  return ClipperLib.JS.PolyTreeToExPolygons(t).map((e: any) => ({ outer: fromC(e.outer), holes: e.holes.map(fromC) }))
}

/** The union of closed rings under the nonzero rule, the fill rule of TrueType and CFF outlines. */
export function unionNonZero(rings: Ring[]): Poly[] {
  if (!rings.length) return []
  const c = new ClipperLib.Clipper()
  c.AddPaths(rings.map(toC), ClipperLib.PolyType.ptSubject, true)
  const t = new ClipperLib.PolyTree()
  c.Execute(ClipperLib.ClipType.ctUnion, t, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return tree(t)
}
const ringsOf = (ps: Poly[]): Ring[] => ps.flatMap(p => [p.outer, ...p.holes])

/** Polygons grown by `delta` mm, or shrunk when negative, with round joins. */
export function offsetPolys(ps: Poly[], delta: number): Poly[] {
  if (!ps.length || !delta) return ps
  const co = new ClipperLib.ClipperOffset(2, 0.001 * S)
  co.AddPaths(ringsOf(ps).map(toC), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const t = new ClipperLib.PolyTree()
  co.Execute(t, delta * S)
  return tree(t)
}
function ringArea(r: Ring): number {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1])
  return a / 2
}
const polyArea = (p: Poly) => Math.abs(ringArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0)

/** Ink an opening of radius w / 2 removes that matters: pieces larger than w by w whose longest side passes w, not corners or blunt tips. */
export function thinPieces(ps: Poly[], w: number): Poly[] {
  const opened = offsetPolys(offsetPolys(ps, -w / 2), w / 2)
  const c = new ClipperLib.Clipper()
  c.AddPaths(ringsOf(ps).map(toC), ClipperLib.PolyType.ptSubject, true)
  if (opened.length) c.AddPaths(ringsOf(opened).map(toC), ClipperLib.PolyType.ptClip, true)
  const t = new ClipperLib.PolyTree()
  c.Execute(ClipperLib.ClipType.ctDifference, t, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  return tree(t).filter(p => {
    if (polyArea(p) <= w * w) return false
    const xs = p.outer.map(q => q[0]),
      ys = p.outer.map(q => q[1])
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > w
  })
}

/** The thinnest width below `w` mm, to 1 um, and a point on it, or null. */
export function thinInk(ps: Poly[], w: number): { width: number; at: [number, number] } | null {
  const bad = thinPieces(ps, w)
  if (!bad.length) return null
  let lo = 0,
    hi = w
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2
    if (thinPieces(ps, mid).length) hi = mid
    else lo = mid
  }
  const at = (thinPieces(ps, hi)[0] ?? bad[0]).outer[0]
  return { width: Math.round(lo * 1000) / 1000, at: [at[0], at[1]] }
}

const nm = (v: number) => Math.round(v * 1e6) / 1e6 || 0

/** The ratio of an outline font's em to the KiCad text size: KiCad draws its outline fonts at an em of 1.4 times the size. */
export const KICAD_OUTLINE_EM = 1.4

/** The pcbjs `size`, the cap height in mm, of KiCad outline text of `kicadSize` in this font: 1.4 x kicadSize x capHeight / unitsPerEm. */
export function kicadOutlineSize(font: Pick<OutlineFont, 'capHeight' | 'unitsPerEm'>, kicadSize: number): number {
  return nm((KICAD_OUTLINE_EM * kicadSize * font.capHeight) / font.unitsPerEm)
}

/** Lay out `text` in an outline font: filled polygons, kerned, with the font's advances. Lines split at `\n`, each anchored on its own. */
export function outlineText(text: string, f: OutlineFont, opts: OutlineTextOptions): OutlineText {
  const k = opts.size / f.capHeight
  const kx = (opts.width ?? opts.size) / f.capHeight
  const lineHeight = opts.lineHeight ?? 1.6 * opts.size
  const spacing = opts.letterSpacing ?? 0
  const lines = String(text).split(/\r?\n/)
  const rings: Ring[] = []
  const missing = new Set<string>()
  let width = 0
  const font = f.font
  lines.forEach((line, row) => {
    const glyphs = [...line].map(ch => {
      const g = font.charToGlyph(ch)
      if (!g || !g.index) {
        if (ch !== ' ' && ch !== '\t') missing.add(ch)
      }
      return g ?? font.glyphs.get(0)
    })
    const shapes = glyphs.map(g => glyphPath(font, g, f.coords))
    const kern = glyphs.map((g, i) => (i ? kerning(font, glyphs[i - 1], g) : 0))
    const advance = shapes.reduce((s, g, i) => s + (g.advance + kern[i]) * kx, 0) + Math.max(0, glyphs.length - 1) * spacing
    width = Math.max(width, advance)
    let x = opts.anchor === 'middle' ? -advance / 2 : opts.anchor === 'end' ? -advance : 0
    const y0 = row * lineHeight
    shapes.forEach((s, i) => {
      x += kern[i] * kx
      for (const c of s.contours) rings.push(c.map(([u, v]) => [x + u * kx, y0 - v * k]))
      x += s.advance * kx + spacing
    })
  })
  const polys = unionNonZero(rings).map(p => ({
    outer: p.outer.map(([a, b]) => [nm(a), nm(b)] as [number, number]),
    holes: p.holes.map(h => h.map(([a, b]) => [nm(a), nm(b)] as [number, number])),
  }))
  return { polys, width: nm(width), height: nm(opts.size + (lines.length - 1) * lineHeight), missing: [...missing] }
}

function kerning(font: any, a: any, b: any): number {
  try {
    return font.getKerningValue(a, b) || 0
  } catch {
    return 0
  }
}

const CONFIG = Symbol.for('pcbjs.fonts.config')
/** Register the `fonts` of pcb.config.ts, paths relative to `root`, the folder of the config. The cli calls it. */
export function setFontConfig(root: string, fonts: Record<string, FontEntry> | undefined): void {
  ;(globalThis as any)[CONFIG] = { root, fonts: fonts ?? {} }
}
/** The fonts of pcb.config.ts with the folder they are relative to. */
export function configFonts(): { root: string; fonts: Record<string, FontEntry> } {
  return (globalThis as any)[CONFIG] ?? { root: '', fonts: {} }
}
