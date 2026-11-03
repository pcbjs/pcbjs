// A reference of the grammar, a finding id or a box, as what a render frames and highlights: parts, copper items, nets,
// findings and a box in board mm. @pcbjs/core/ref does the resolving.
import type { Board } from '@pcbjs/core/model'
import type { SiteData, SiteItem } from '@pcbjs/core/site-data'
import type { Finding } from '@pcbjs/core/finding'
import { boardIndex, resolveRef, type Resolved } from '@pcbjs/core/ref'
import { parseBox } from './spec.js'

export type Box = [number, number, number, number]

export interface Target {
  text: string
  parts: string[]
  items: SiteItem[]
  nets: string[]
  findings: Finding[]
  /** schematic symbols are parts too; a net or a box frames by its own extent */
  box: Box | null
  layer?: string
}

const grow = (b: Box | null, x: number, y: number): Box => (b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y])

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return a ?? b
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

const itemBox = (it: SiteItem): Box | null => it.box ?? null

function findingBox(f: Finding): Box | null {
  let b: Box | null = f.at ? grow(null, f.at[0], f.at[1]) : null
  const w = f.witness
  for (const p of w?.points ?? []) b = grow(b, p[0], p[1])
  for (const s of w?.segments ?? []) for (const p of s) b = grow(b, p[0], p[1])
  for (const r of w?.rings ?? []) for (const p of r) b = grow(b, p[0], p[1])
  return b
}

/** The box of everything a target names, null when it names nothing with a position. */
export function targetBox(t: Omit<Target, 'box'>, site: SiteData): Box | null {
  let b: Box | null = null
  for (const ref of t.parts) {
    const fp = site.footprints.find(f => f.ref === ref)
    if (fp) b = unionBox(b, [fp.bbox.x, fp.bbox.y, fp.bbox.x + fp.bbox.w, fp.bbox.y + fp.bbox.h])
  }
  for (const it of t.items) b = unionBox(b, itemBox(it))
  for (const n of t.nets) for (const it of site.items ?? []) if (it.net === n) b = unionBox(b, itemBox(it))
  for (const f of t.findings) b = unionBox(b, findingBox(f))
  return b
}

const empty = (text: string): Omit<Target, 'box'> => ({ text, parts: [], items: [], nets: [], findings: [] })

function fromResolved(text: string, r: Resolved, board: Board, site: SiteData, findings: Finding[]): Omit<Target, 'box'> {
  const t = empty(text)
  const byId = (ids: number[]) => (site.items ?? []).filter(it => ids.includes(it.id))
  switch (r.kind) {
    case 'part':
      t.parts.push(r.ref)
      break
    case 'group':
      t.parts.push(...r.parts)
      break
    case 'pad':
      t.items.push(...byId([r.pad.id]))
      break
    case 'net':
      t.nets.push(r.net.name)
      break
    case 'item':
      t.items.push(...byId([r.item.id]))
      break
    case 'route':
    case 'leg':
    case 'pt':
      t.items.push(...byId(board.items.filter(it => (it.kind === 'track' || it.kind === 'via') && it.route === r.route.id).map(it => it.id)))
      break
    case 'pair':
      t.items.push(...(site.items ?? []).filter(it => it.pair === r.pair.id))
      break
    case 'span':
      t.items.push(...byId(r.vias.map(v => v.id)))
      break
    case 'plane':
    case 'region':
      t.items.push(...byId((r.kind === 'plane' ? r.zones : [r.zone]).map(z => z.id)))
      t.layer = r.layer
      break
    case 'finding': {
      const f = findings.find(x => x.id === r.finding.id)
      if (f) t.findings.push(f)
      t.items.push(...byId(r.finding.items ?? []))
      t.layer = r.finding.layer
      break
    }
  }
  return t
}

/** What `text` names on the board; a box `x0,y0,x1,y1` names only its area. Throws the resolver's error when it names nothing. */
export function resolveTarget(text: string, board: Board, site: SiteData, findings: Finding[]): Target {
  const box = parseBox(text)
  if (box) return { ...empty(text), box }
  const t = fromResolved(text, resolveRef(boardIndex(board), text), board, site, findings)
  return { ...t, box: targetBox(t, site) }
}
