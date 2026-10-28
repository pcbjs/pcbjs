import type { SiteData } from '@pcbjs/core/site-data'

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

/** The mask thickness of a side, from its stackup layer, else MASK. */
export function maskThickness(b: SiteData, side: 'F' | 'B'): number {
  const l = b.stackup?.layers.find(s => s.type === 'mask' && s.side === side) as { thickness?: number } | undefined
  return l?.thickness && l.thickness > 0 ? l.thickness : MASK
}
