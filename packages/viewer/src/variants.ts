// free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests
import type { SiteData } from '@pcbjs/core/site-data'

/** One board and its entries, one per fab target in the order of its variants list; a board without variants has one. */
export interface BoardGroup {
  name: string
  targets: SiteData[]
}
export type DrcState = 'ok' | 'warn' | 'err'
export interface DrcSummary {
  state: DrcState
  text: string
  errors: number
  warnings: number
  infos: number
}

/** The target name of an entry, null for a board without variants. */
export const targetName = (b: Pick<SiteData, 'variant'>): string | null => b.variant?.name ?? null

/** True when two entries are the same board and the same target. */
export const sameEntry = (a: Pick<SiteData, 'name' | 'variant'>, b: Pick<SiteData, 'name' | 'variant'>): boolean => a.name === b.name && targetName(a) === targetName(b)

/** The entries grouped by board name in order of first appearance, each group's targets ordered by `variant.index`. */
export function groupBoards<T extends Pick<SiteData, 'name' | 'variant'>>(boards: readonly T[]): { name: string; targets: T[] }[] {
  const byName = new Map<string, T[]>()
  for (const b of boards) {
    const list = byName.get(b.name)
    if (list) list.push(b)
    else byName.set(b.name, [b])
  }
  return [...byName].map(([name, targets]) => ({ name, targets: targets.length > 1 ? [...targets].sort((a, b) => (a.variant?.index ?? 0) - (b.variant?.index ?? 0)) : targets }))
}

/** The target with the wanted name, else the first one, which is the first in the board's variants list. */
export function pickTarget<T extends Pick<SiteData, 'variant'>>(targets: readonly T[], wanted: string | null | undefined): T | null {
  return (wanted != null ? targets.find(t => targetName(t) === wanted) : undefined) ?? targets[0] ?? null
}

/** Replace the entry with the same name and target in place, or add it after the board's other targets, or at the end. Returns the index. */
export function upsertEntry<T extends Pick<SiteData, 'name' | 'variant'>>(boards: T[], data: T): number {
  const i = boards.findIndex(b => sameEntry(b, data))
  if (i >= 0) {
    boards[i] = data
    return i
  }
  let last = -1
  boards.forEach((b, j) => {
    if (b.name === data.name) last = j
  })
  const at = last >= 0 ? last + 1 : boards.length
  boards.splice(at, 0, data)
  return at
}

export function drcSummary(b: Pick<SiteData, 'drc' | 'unconnected'>): DrcSummary {
  const c = count(b.drc)
  return { state: c.errors || b.unconnected ? 'err' : c.warnings ? 'warn' : 'ok', text: words(c, b.unconnected), ...c }
}

const rank: Record<DrcState, number> = { ok: 0, warn: 1, err: 2 }
/** The target that fares worst on DRC and ERC together: errors first, then warnings, then unconnected; the earliest on a tie. */
export function worstTarget<T extends Pick<SiteData, 'drc' | 'unconnected'> & { erc?: SiteData['erc'] }>(targets: readonly T[]): T | null {
  let best: T | null = null,
    key: number[] = []
  for (const t of targets) {
    const s = checkSummary(t)
    const k = [rank[s.state], s.errors, s.warnings, t.unconnected]
    const d = k.findIndex((v, i) => v !== key[i])
    if (!best || (d >= 0 && k[d] > key[d])) {
      best = t
      key = k
    }
  }
  return best
}

/** How many targets fail: DRC or ERC errors, or unconnected nets. */
export const failingCount = (targets: readonly (Pick<SiteData, 'drc' | 'unconnected'> & { erc?: SiteData['erc'] })[]): number =>
  targets.filter(t => checkSummary(t).state === 'err').length

export type CheckState = DrcState
/** `infos` never count against a board; they are shown apart from warnings */
export interface CheckCounts {
  errors: number
  warnings: number
  infos: number
}
/** The DRC and the ERC of one entry together: the pill's state and label, the tooltip, and the summed counts for ranking targets. */
export interface CheckSummary {
  state: CheckState
  /** the pill text: "DRC clean" style without ERC data, "DRC n · ERC m" with it */
  label: string
  /** the short text of a target chip or a card */
  text: string
  /** one line per check, for the tooltip */
  title: string
  errors: number
  warnings: number
  unconnected: number
  drc: CheckCounts
  erc: CheckCounts | null
}
const count = (ms: readonly Pick<SiteData['drc'][number], 'severity'>[]): CheckCounts => {
  const n = (s: string) => ms.filter(d => d.severity === s).length
  return { errors: n('error'), warnings: n('warning'), infos: n('info') }
}
const plural = (n: number, w: string) => `${n} ${n === 1 || w === 'unconnected' || w === 'info' ? w : w + 's'}`
const words = (c: CheckCounts, unconnected = 0, sep = ' · ') =>
  [
    [c.errors, 'error'],
    [c.warnings, 'warning'],
    [unconnected, 'unconnected'],
    [c.infos, 'info'],
  ]
    .filter(([n]) => n)
    .map(([n, w]) => plural(n as number, w as string))
    .join(sep) || 'clean'
const infoTail = (c: CheckCounts) => (c.infos ? `, ${plural(c.infos, 'info')}` : '')
const allClean = (...cs: CheckCounts[]) => cs.every(c => !c.infos)

/** The ERC counts, null when the entry has no ERC data. */
export const ercCounts = (b: { erc?: readonly Pick<SiteData['drc'][number], 'severity'>[] | null }): CheckCounts | null => (Array.isArray(b.erc) ? count(b.erc) : null)

/** The ERC alone in the shape of `drcSummary`, null when the entry has no ERC data. */
export function ercSummary(b: { erc?: readonly Pick<SiteData['drc'][number], 'severity'>[] | null }): DrcSummary | null {
  const c = ercCounts(b)
  return c ? { state: c.errors ? 'err' : c.warnings ? 'warn' : 'ok', text: words(c), ...c } : null
}

/** The combined status: red when either check has errors or a net is unconnected, amber for warnings only, green when both are clean. */
export function checkSummary(b: {
  drc?: readonly Pick<SiteData['drc'][number], 'severity'>[] | null
  erc?: readonly Pick<SiteData['drc'][number], 'severity'>[] | null
  unconnected?: number
}): CheckSummary {
  const drc = count(b.drc ?? []),
    erc = ercCounts(b),
    unconnected = b.unconnected ?? 0
  const errors = drc.errors + (erc?.errors ?? 0),
    warnings = drc.warnings + (erc?.warnings ?? 0)
  const state: CheckState = errors || unconnected ? 'err' : warnings ? 'warn' : 'ok'
  const drcText = words(drc, unconnected)
  // the DRC list holds an `unconnected` error per gap already: only gaps it does not list add to the count
  const listed = (b.drc ?? []).filter(d => (d as { rule?: string }).rule === 'unconnected').length
  const drcN = drc.errors + drc.warnings + Math.max(0, unconnected - listed)
  const drcTitle = `DRC: ${plural(drc.errors, 'error')}, ${plural(drc.warnings, 'warning')}, ${unconnected} unconnected${infoTail(drc)}`
  if (!erc) return { state, label: 'DRC ' + drcText, text: drcText, title: drcTitle, errors, warnings, unconnected, drc, erc }
  return {
    state,
    errors,
    warnings,
    unconnected,
    drc,
    erc,
    label: `DRC ${drcN} · ERC ${erc.errors + erc.warnings}`,
    text: state === 'ok' && allClean(drc, erc) ? 'clean' : `DRC ${words(drc, unconnected, ', ')} · ERC ${words(erc, 0, ', ')}`,
    title: `${drcTitle}\nERC: ${plural(erc.errors, 'error')}, ${plural(erc.warnings, 'warning')}${infoTail(erc)}`,
  }
}

// routes: `<base>`, `<base>board/<name>` and `<base>board/<name>/<target slug>`

/** The URL and file name form of a target name, as the compiler makes it: lowercase, every run of other characters a single `-`, none at the ends. */
export const variantSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** The target whose name has this slug, null when none has. */
export function targetBySlug<T extends Pick<SiteData, 'variant'>>(targets: readonly T[], slug: string): T | null {
  return targets.find(t => t.variant && variantSlug(t.variant.name) === slug) ?? null
}

/** A route as the path gives it: the home page, which a single-entry site shows as its board, or a board with an optional target slug. */
export type PathRoute = { page: 'home' } | { page: 'board'; name: string; target: string | null }
const dec = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
const slash = (b: string) => (b.endsWith('/') ? b : b + '/')
/** The route of a URL path under an absolute base such as `/` or `/site/`; query and fragment are ignored, and so is a trailing `index.html`. */
export function routeFromPath(path: string, base: string): PathRoute {
  const b = slash(base)
  let p = path.replace(/[?#].*$/, '')
  if (p + '/' === b) p = b
  if (!p.startsWith(b)) return { page: 'home' }
  const m = /^board\/([^/]+)(?:\/([^/]+))?\/?(?:index\.html)?$/.exec(p.slice(b.length))
  return m ? { page: 'board', name: dec(m[1]), target: m[2] ? dec(m[2]) : null } : { page: 'home' }
}
/** True for a path the viewer routes itself: the base, its index.html, or a board under it. */
export function isAppPath(path: string, base: string): boolean {
  const b = slash(base),
    p = path.replace(/[?#].*$/, '')
  return p === b || p + '/' === b || p === b + 'index.html' || p.startsWith(b + 'board/')
}
/** The path of a board, with the target's slug when a target name is given. */
export const boardPath = (base: string, name: string, target?: string | null): string =>
  `${slash(base)}board/${encodeURIComponent(name)}${target != null ? `/${encodeURIComponent(variantSlug(target))}` : ''}`

/** An absolute BASE_URL as it is; a relative one is the page's directory, minus `board/...` on a board route. */
export function appBase(baseUrl: string, pathname: string): string {
  if (baseUrl.startsWith('/')) return slash(baseUrl)
  const i = pathname.lastIndexOf('/board/')
  return i >= 0 ? pathname.slice(0, i + 1) : pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/'
}
/** A URL from the site data resolved against the base: absolute ones as they are, relative ones, as a built site writes them, under the base. */
export const assetUrl = (url: string, base: string): string => (/^([a-z][a-z0-9+.-]*:|\/)/i.test(url) ? url : slash(base) + url)

/** The old hash routes, `#/` and `#/board/<name>` with an optional `?target=<name>`. */
export interface BoardRoute {
  name: string
  target: string | null
}
/** Parse an old `#/board/<name>` hash with an optional `?target=<name>`; null for any other hash. */
export function parseBoardHash(hash: string): BoardRoute | null {
  const m = /^#\/board\/([^?]+)(?:\?(.*))?$/.exec(hash)
  if (!m) return null
  let target: string | null = null
  for (const kv of (m[2] ?? '').split('&')) if (kv.startsWith('target=')) target = dec(kv.slice(7))
  return { name: dec(m[1]), target }
}
/** Where an old hash route goes now, null when the hash is not one. */
export function hashToPath(hash: string, base: string): string | null {
  const r = parseBoardHash(hash)
  if (r) return boardPath(base, r.name, r.target)
  return hash === '#/' || hash === '#' ? slash(base) : null
}

/** Layer ids kept from `prev` that the board does not have, plus `next`: a 2-layer target must not forget what a 4-layer one hid. */
export function withForeign(prev: Iterable<string>, layerIds: Iterable<string>, next: Iterable<string>): Set<string> {
  const own = new Set(layerIds)
  const out = new Set<string>()
  for (const id of prev) if (!own.has(id)) out.add(id)
  for (const id of next) out.add(id)
  return out
}
