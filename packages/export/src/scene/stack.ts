import type { SiteData, SiteFootprint } from '@pcbjs/core/site-data'
import { footprintMatrix, type Mat4 } from '@pcbjs/step/internal/place'
import { allRings, shapeOf } from '@pcbjs/core/site-shapes'
import { inside } from './shapes.js'

export interface Slice {
  z0: number
  z1: number
}
export const OUTER_COPPER = 0.035,
  INNER_COPPER = 0.015,
  MASK = 0.025,
  SILK = 0.012

export function copperIds(n: number): string[] {
  return ['F.Cu', ...Array.from({ length: Math.max(0, n - 2) }, (_, i) => `In${i + 1}.Cu`), 'B.Cu']
}

/** The z range of every copper layer, from the stackup's copper thicknesses and dielectric depths when present. */
export function copperSlices(b: SiteData): Map<string, Slice> {
  const ids = copperIds(b.copper)
  const layers = b.stackup?.layers ?? []
  const cu = new Map<string, number>()
  for (const l of layers) if (l.type === 'copper' && l.thickness > 0) cu.set(l.name, l.thickness)
  const t = (id: string) => cu.get(id) ?? (id === 'F.Cu' || id === 'B.Cu' ? OUTER_COPPER : INNER_COPPER)
  const out = new Map<string, Slice>()
  out.set('F.Cu', { z0: b.thickness, z1: b.thickness + t('F.Cu') })
  out.set('B.Cu', { z0: -t('B.Cu'), z1: 0 })
  // inner layers: the depth of each from the top of the stack, scaled so the whole stack is the board thickness
  const stack = layers.filter(l => l.type === 'copper' || l.type === 'core' || l.type === 'prepreg')
  const total = stack.reduce((s, l) => s + (l.thickness ?? 0), 0)
  const depth = new Map<string, number>()
  let d = 0
  for (const l of stack) {
    if (l.type === 'copper') depth.set(l.name, d)
    d += l.thickness ?? 0
  }
  const inner = ids.slice(1, -1)
  inner.forEach((id, i) => {
    const k = total > 0 && depth.has(id) ? depth.get(id)! / total : (i + 1) / (inner.length + 1)
    const top = b.thickness * (1 - k)
    out.set(id, { z0: top - t(id), z1: top })
  })
  return out
}

/** The z of the board face a part of `side` sits on: the outer face of its copper. */
export function bodyFace(slices: Map<string, Slice>, side: 'F' | 'B'): number {
  return side === 'B' ? slices.get('B.Cu')!.z0 : slices.get('F.Cu')!.z1
}

/** A generated body's placement: its model frame on the body centre and turn, a back part turned over about y. */
export const bodyMatrix = (fp: Pick<SiteFootprint, 'body' | 'side'>, face: number): Mat4 => footprintMatrix({ at: [fp.body.x, fp.body.y], rot: fp.body.rot, side: fp.side }, face)

/** The mask thickness of a side, from its stackup layer, else MASK. */
export function maskThickness(b: SiteData, side: 'F' | 'B'): number {
  const l = b.stackup?.layers.find(s => s.type === 'mask' && s.side === side) as { thickness?: number } | undefined
  return l?.thickness && l.thickness > 0 ? l.thickness : MASK
}

/** How far the mask over a copper feature spreads at its foot, mm. */
export const MASK_FLARE = 0.03

/** The z range of an item on one of its layers: copper from the stackup, silk above the mask on its side. */
// silk is printed on the mask: it starts on the mask over bare board and stands SILK above the mask over copper
export function sliceOf(layer: string, slices: Map<string, Slice>, mask: Record<'F' | 'B', number>): Slice | null {
  const cu = slices.get(layer)
  if (cu) return cu
  if (layer === 'F.SilkS') {
    const f = slices.get('F.Cu')!
    return { z0: f.z0 + mask.F, z1: f.z1 + mask.F + SILK }
  }
  if (layer === 'B.SilkS') {
    const b = slices.get('B.Cu')!
    return { z0: b.z0 - mask.B - SILK, z1: b.z1 - mask.B }
  }
  return null
}

/** The solder mask of both sides: its thickness and its openings, from the shapes facet. */
export interface MaskInfo {
  thickness: Record<'F' | 'B', number>
  openings: Record<'F' | 'B', { rings: [number, number][][] }>
}

export function maskInfo(b: SiteData, thickness: Record<'F' | 'B', number>): MaskInfo {
  const side = (s: 'F' | 'B') => {
    const o = b.shapes?.openings[s]
    return { rings: o ? allRings(o) : [] }
  }
  return { thickness, openings: { F: side('F'), B: side('B') } }
}

function npthHoles(b: SiteData): [number, number][][] {
  const out: [number, number][][] = []
  for (const it of b.items ?? []) if (it.kind === 'pad' && it.drill && !it.layers.some(l => l.endsWith('.Cu')) && shapeOf(b, it.id).length > 1) out.push(shapeOf(b, it.id)[1])
  return out
}

/** What the mask slab of a side leaves open: its openings, and the NPTH holes that no opening clears already. */
export function maskCuts(b: SiteData, side: 'F' | 'B', mask: MaskInfo): [number, number][][] {
  const open = mask.openings[side].rings
  const npth = npthHoles(b).filter(h => {
    const xs = h.map(p => p[0]),
      ys = h.map(p => p[1])
    const c: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    return !open.some(r => inside(c, r))
  })
  return [...open, ...npth]
}
