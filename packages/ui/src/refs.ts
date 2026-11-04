// references of docs/refs.md resolved against one board's site data; free of Vue and the DOM so Node imports it in the tests
import { defName, shownDef } from '@pcbjs/core/internal/instances'
import { RefError, resolveRef, siteIndex } from '@pcbjs/core/ref'
import type { SiteData, SiteItem, SiteFinding } from '@pcbjs/core/site-data'
import type { HoverWire } from '@pcbjs/core/protocol'
import type { HoverTarget } from './sync'
import { compassBox } from './ring'

type Box = [number, number, number, number]
type Site = Pick<SiteData, 'name' | 'footprints' | 'nets' | 'drc' | 'erc' | 'schematic'> & Partial<Pick<SiteData, 'items' | 'routes' | 'edit'>>
type Pt = [number, number]

/** What a reference names on a board, as the viewer selects it. */
export type SiteTarget =
  | { kind: 'part'; ref: string }
  | { kind: 'pad'; ref: string; num: string; id: number | null }
  | { kind: 'group'; key: string; refs: string[] }
  | { kind: 'net'; net: string }
  | { kind: 'route'; id: string; net: string; ids: number[] }
  | { kind: 'pt'; route: string; pt: number; at: [number, number]; net: string }
  | { kind: 'leg'; route: string; leg: number; net: string; ids: number[] }
  | { kind: 'pair'; pair: string; net: string }
  | { kind: 'finding'; marker: SiteFinding; check: 'drc' | 'erc' }
  | { kind: 'item'; id: number; net: string | null }
  | { kind: 'plane'; layer: string; net: string; ids: number[] }

/** A part's reference as findings and the chip print it: `CH2/R01` for a part of an instance, else its ref. */
export function partRef(site: Pick<Site, 'schematic'>, ref: string): string {
  const p = site.schematic?.parts.find(x => x.ref === ref)
  return p?.path?.length ? [...p.path, p.local ?? ref].join('/') : ref
}

function schematicRef(site: Site, ref: string): string | null {
  const p = site.schematic.parts.find(p => p.displayRef && (p.ref === ref || [...p.path, p.local].join('/') === ref))
  return p?.ref ?? null
}

/** The part a reference names, or holds a pad of, on this board; null for anything else. */
export function refPart(site: Site, text: string): string | null {
  const ref = schematicRef(site, text)
  if (ref) return ref
  try {
    const r = resolveRef(siteIndex(site), text)
    return r.kind === 'part' || r.kind === 'pad' ? r.ref : null
  } catch {
    return null
  }
}

/** What `text` names on the board as the viewer selects it, resolved by @pcbjs/core/ref over the site's index; throws a RefError saying what is missing or listing the matches. */
export function siteTarget(site: Site, text: string): SiteTarget {
  const ref = schematicRef(site, text)
  if (ref) return { kind: 'part', ref }
  const r = resolveRef(siteIndex(site), text)
  const items = site.items ?? []
  const miss = (why: string): never => {
    throw new RefError(`${text}: ${why}`)
  }
  switch (r.kind) {
    case 'part':
      return { kind: 'part', ref: r.ref }
    case 'pad': {
      const it = r.pad.uid ? items.find(x => x.uid === r.pad.uid) : undefined
      return { kind: 'pad', ref: r.ref, num: r.pad.num, id: it?.id ?? null }
    }
    case 'group':
      return { kind: 'group', key: r.path, refs: r.parts }
    case 'net':
      return { kind: 'net', net: r.net }
    case 'route':
      return { kind: 'route', id: r.route.id, net: r.route.net, ids: items.filter(x => x.route === r.route.id).map(x => x.id) }
    case 'leg': {
      const mine = items.filter(x => x.route === r.route.id && legAt(site, r.route.id, centreOf(cornersOf(x))) === r.leg)
      return mine.length ? { kind: 'leg', route: r.route.id, leg: r.leg, net: r.route.net, ids: mine.map(x => x.id) } : miss(`${r.route.id} has no copper on leg:${r.leg}`)
    }
    case 'pt':
      return { kind: 'pt', route: r.route.id, pt: r.pt, at: [r.at[0], r.at[1]], net: r.route.net }
    case 'pair':
      return { kind: 'pair', pair: r.pair.id, net: r.pair.net }
    case 'item':
      return { kind: 'item', id: r.item.id, net: r.item.net ?? null }
    case 'finding':
      return { kind: 'finding', marker: r.finding, check: r.check }
    case 'plane':
      return { kind: 'plane', layer: r.layer, net: r.net, ids: r.zones.map(z => z.item.id) }
  }
  return miss(`the viewer selects no ${r.kind}`)
}

const toSegment = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy
  const s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(a[0] + s * dx - p[0], a[1] + s * dy - p[1])
}
const centreOf = (rings: Pt[][]): Pt | null => {
  const b = boxOf(rings)
  return b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : null
}

/** The automatic leg of a route a board point lies on, `k` of `leg:k`, by the nearest chain call between its points: an `X` call's span is a leg, a drawn call's is not; null for none. */
export function legAt(site: Site, route: string, at: Pt | null | undefined): number | null {
  const pts = site.routes?.find(r => r.id === route)?.pts
  const steps = site.edit?.find(e => e.ref === route)?.steps
  if (!at || !pts || !steps?.some(s => s.op === 'X')) return null
  let best = Infinity,
    leg: number | null = null,
    k = 0
  steps.forEach((s, j) => {
    if (s.op === 'X') k++
    if (!pts[j] || !pts[j + 1]) return
    const d = toSegment(at, pts[j], pts[j + 1])
    if (d < best) {
      best = d
      leg = s.op === 'X' ? k : null
    }
  })
  return leg
}

/** Two corners of an item's box, as rings boxOf reads; none for an item with no copper left. */
export const cornersOf = (it: SiteItem): [number, number][][] =>
  it.box
    ? [
        [
          [it.box[0], it.box[1]],
          [it.box[2], it.box[3]],
        ],
      ]
    : []

/** The bounding box of rings, x, y, width and height in board mm; null for none. */
export function boxOf(rings: readonly (readonly [number, number])[][]): Box | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const r of rings)
    for (const [x, y] of r) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  return x0 <= x1 ? [x0, y0, x1 - x0, y1 - y0] : null
}

const grow = (b: Box, m: number): Box => [b[0] - m, b[1] - m, b[2] + 2 * m, b[3] + 2 * m]

/** The 2D area a target frames, in board mm with a margin: a net's or item's copper, a group's parts, a finding's witness and position. */
export function targetBox(site: Site, t: SiteTarget): Box | null {
  const items = site.items ?? []
  const fps = (refs: string[]) =>
    site.footprints.filter(f => refs.includes(f.ref)).map(f => [[f.bbox.x, f.bbox.y] as [number, number], [f.bbox.x + f.bbox.w, f.bbox.y + f.bbox.h] as [number, number]])
  let b: Box | null = null
  if (t.kind === 'part' || t.kind === 'group') {
    b = boxOf(fps(t.kind === 'part' ? [t.ref] : t.refs))
    const n = t.kind === 'group' ? site.edit?.find(n => n.ref === t.key) : null
    if (b && n?.at) b = compassBox(n.pivot ?? [n.at[0], n.at[1]], b)
  } else if (t.kind === 'pad' || t.kind === 'item') b = boxOf(items.filter(x => x.id === t.id).flatMap(cornersOf))
  else if (t.kind === 'route' || t.kind === 'leg' || t.kind === 'plane') b = boxOf(items.filter(x => t.ids.includes(x.id)).flatMap(cornersOf))
  else if (t.kind === 'pt') b = [t.at[0], t.at[1], 0, 0]
  else if (t.kind === 'net' || t.kind === 'pair') b = boxOf(items.filter(x => x.net === t.net && x.kind !== 'zone').flatMap(cornersOf))
  else {
    const w = t.marker.witness
    const pts: [number, number][] = [...(t.marker.at ? [t.marker.at] : []), ...(w?.points ?? []), ...(w?.segments ?? []).flat(), ...(w?.rings ?? []).flat()]
    b = boxOf([pts])
    if (b) return grow(b, Math.max(2, Math.max(b[2], b[3]) / 3))
  }
  return b && grow(b, Math.max(1.5, Math.max(b[2], b[3]) / 6))
}

/** Item uids for snapshot-local ids, for a message that leaves the page; ids without a uid are dropped. */
export function uidsOf(site: Pick<SiteData, 'items'>, ids: readonly number[]): string[] {
  const by = new Map((site.items ?? []).map(x => [x.id, x.uid]))
  return ids.flatMap(id => by.get(id) ?? [])
}

/** The ids of this snapshot for item uids, as a message names them; a uid this board does not have is dropped. */
export function idsOf(site: Pick<SiteData, 'items'>, uids: readonly string[]): number[] {
  const by = new Map((site.items ?? []).flatMap(x => (x.uid ? [[x.uid, x.id] as const] : [])))
  return uids.flatMap(u => by.get(u) ?? [])
}

/** A finding held across compiles: its exact id, and the fingerprint and position that find it again once the id has changed. */
export interface FindingFocus {
  id: string
  fingerprint: string
  at: [number, number] | null
}

/** The marker a held finding is now: the same id, else the same fingerprint nearest its old position; null when it is gone. */
export function refocus<T extends Pick<SiteFinding, 'id' | 'fingerprint' | 'at'>>(f: FindingFocus, markers: readonly T[]): T | null {
  const same = markers.find(m => m.id === f.id)
  if (same) return same
  let best: T | null = null,
    d = Infinity
  for (const m of markers) {
    if (m.fingerprint !== f.fingerprint) continue
    const e = m.at && f.at ? Math.hypot(m.at[0] - f.at[0], m.at[1] - f.at[1]) : m.at || f.at ? Infinity : 0
    if (e < d) [best, d] = [m, e]
  }
  return best
}

/** A hover for a message, its items by uid. */
export const toWire = (site: Pick<SiteData, 'items'>, h: HoverTarget | null): HoverWire | null => (h ? { uids: uidsOf(site, h.ids), refs: [...h.refs], net: h.net } : null)
/** A hover from a message, its items by this snapshot's ids; null when it names nothing here. */
export function fromWire(site: Pick<SiteData, 'items'>, w: HoverWire | null): HoverTarget | null {
  if (!w) return null
  const ids = idsOf(site, w.uids)
  return ids.length || w.refs.length || w.net ? { ids, refs: [...w.refs], net: w.net } : null
}

/** Library numbering is local; canonical refs continue to identify source edits and selections. */
export function displayRef(site: Site, ref: string): string {
  if (!site.schematic.parts.some(p => p.displayRef) && !site.footprints.some(f => f.displayRef)) return ref
  try {
    const target = siteTarget(site, ref)
    if (target.kind === 'part' || target.kind === 'pad') {
      const label = site.schematic.parts.find(p => p.ref === target.ref)?.displayRef ?? site.footprints.find(f => f.ref === target.ref)?.displayRef ?? target.ref
      return target.kind === 'pad' ? `${label}/${target.num}` : label
    }
    if (target.kind === 'net') {
      const label = site.schematic.nets.find(n => n.name === target.net)?.displayName
      if (label) return `net:${label}`
    }
    if (target.kind === 'group') {
      const group = site.schematic.circuits.find(c => c.path.join('/') === target.key)
      if (group) return defName(shownDef(group))
    }
  } catch {}
  return ref
}
