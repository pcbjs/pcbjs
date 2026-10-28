// KiCad's `(font (face "Roboto Slab") (bold yes))` found among the installed fonts, and its size as pcbjs's cap height.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { loadOutlineFont, kicadOutlineSize, type OutlineFont } from '@pcbjs/core/outline'

export interface FoundFont {
  path: string
  /** the `wght` value for a variable font, 700 for bold */
  weight?: number
  family: string
  style: string
  /** the licence description and URL of the name table, IDs 13 and 14, and the copyright, ID 0 */
  license?: string
  licenseUrl?: string
  copyright?: string
  /** true when KiCad asked for bold and only a regular file was found; pcbjs draws no synthetic bold */
  notBold?: boolean
  font: OutlineFont
}

export function fontDirs(): string[] {
  const home = homedir()
  return [
    join(home, 'Library/Fonts'),
    '/Library/Fonts',
    '/System/Library/Fonts',
    '/System/Library/Fonts/Supplemental',
    '/Applications/KiCad/KiCad.app/Contents/SharedSupport',
    '/Applications/KiCad/KiCad.app/Contents/Resources',
    join(home, '.local/share/fonts'),
    join(home, '.fonts'),
    '/usr/local/share/fonts',
    '/usr/share/fonts',
    ...(process.env.WINDIR ? [join(process.env.WINDIR, 'Fonts')] : []),
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Microsoft/Windows/Fonts')] : []),
  ]
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function fontFiles(dir: string, depth = 3, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const n of names) {
    const f = join(dir, n)
    if (/\.(ttf|otf)$/i.test(n)) out.push(f)
    else if (depth > 0 && !n.startsWith('.')) {
      try {
        if (statSync(f).isDirectory()) fontFiles(f, depth - 1, out)
      } catch {
        /* unreadable */
      }
    }
  }
  return out
}

function names(f: OutlineFont): { license?: string; licenseUrl?: string; copyright?: string } {
  const get = (k: string) => {
    const r = f.font.names?.[k] ?? f.font.names?.windows?.[k] ?? f.font.names?.macintosh?.[k]
    return r ? ((r.en ?? Object.values(r)[0]) as string) : undefined
  }
  const out: { license?: string; licenseUrl?: string; copyright?: string } = {}
  const l = get('license'),
    u = get('licenseURL'),
    c = get('copyright')
  if (l) out.license = l
  if (u) out.licenseUrl = u
  if (c) out.copyright = c
  return out
}

/** The installed file of a KiCad face; bold falls back to a variable font at 700, then to regular marked `notBold`. */
export function findFont(face: string, o: { bold?: boolean; italic?: boolean; dirs?: string[] } = {}): FoundFont | null {
  const want = squash(face)
  if (!want) return null
  const found: { path: string; f: OutlineFont; style: string; variable: boolean }[] = []
  for (const dir of o.dirs ?? fontDirs()) {
    if (!existsSync(dir)) continue
    for (const path of fontFiles(dir)) {
      if (!squash(basename(path)).startsWith(want)) continue
      let f: OutlineFont
      try {
        f = loadOutlineFont(path)
      } catch {
        continue
      }
      if (squash(f.family) !== want) continue
      const variable = !!f.font.tables.fvar?.axes?.some((a: any) => a.tag === 'wght')
      found.push({ path, f, style: f.style.toLowerCase(), variable })
    }
  }
  if (!found.length) return null
  const italic = (c: { style: string; path: string }) => /italic|oblique/.test(c.style) || /italic/i.test(basename(c.path))
  const pool = found.filter(c => italic(c) === !!o.italic).length ? found.filter(c => italic(c) === !!o.italic) : found
  const pick = (path: string, weight?: number, notBold = false): FoundFont => {
    const f = loadOutlineFont(path, weight)
    return { path, ...(weight !== undefined ? { weight } : {}), family: f.family, style: f.style, ...names(f), ...(notBold ? { notBold } : {}), font: f }
  }
  if (o.bold) {
    const bold = pool.find(c => !c.variable && /^bold( italic)?$/.test(c.style))
    if (bold) return pick(bold.path)
    const v = pool.find(c => c.variable)
    if (v) return pick(v.path, 700)
    return pick(pool[0].path, undefined, true)
  }
  const regular = pool.find(c => !c.variable && /^(regular|italic|book|normal)$/.test(c.style))
  if (regular) return pick(regular.path)
  const v = pool.find(c => c.variable)
  if (v) return pick(v.path, 400)
  return pick(pool[0].path)
}

/** Baseline of centred KiCad outline text below `at`, as a fraction of its size, measured from KiCad 9's render cache. */
export const KICAD_OUTLINE_BASELINE = 0.415

/** KiCad outline text as pcbjs cap heights, KiCad's em being 1.4 times its size; `dy` moves `at` to pcbjs's vertical centre. */
export function kicadOutlineText(font: Pick<OutlineFont, 'capHeight' | 'unitsPerEm'>, kicadSize: [number, number]): { size: number; width: number; dy: number } {
  const [h, w] = kicadSize
  const size = kicadOutlineSize(font, h),
    width = kicadOutlineSize(font, w)
  return { size, width, dy: Math.round((KICAD_OUTLINE_BASELINE * h - size / 2) * 1e6) / 1e6 }
}
