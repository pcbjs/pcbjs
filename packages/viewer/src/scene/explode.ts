import type { SiteData } from '@pcbjs/core/site-data'
import { copperIds, type Slice } from './stack'

/** Group names bottom to top, a dielectric slice diel:N between copper layers, numbered from the top. */
export function stackOrder(b: SiteData): string[] {
  const cu = copperIds(b.copper)
  const mid: string[] = []
  for (let i = cu.length - 1; i >= 0; i--) {
    mid.push(cu[i])
    if (i > 0) mid.push(`diel:${i - 1}`)
  }
  return ['bodies:B', 'B.SilkS', 'B.Mask', ...mid, 'F.Mask', 'F.SilkS', 'bodies:F']
}

/** The z offset of each group: one separation per step away from the middle of the copper stack. */
export function offsets(order: string[], sep: number): Map<string, number> {
  const lo = order.indexOf('B.Cu'),
    hi = order.indexOf('F.Cu')
  const c = (lo + hi) / 2
  return new Map(order.map((name, i) => [name, (i - c) * sep]))
}

/** The dielectric slices between consecutive copper layers, top first, as z ranges. */
export function dielectrics(b: SiteData, slices: Map<string, Slice>): { name: string; z0: number; z1: number; kind: string; label: string }[] {
  const cu = copperIds(b.copper)
  const diel = (b.stackup?.layers ?? []).filter(l => l.type === 'core' || l.type === 'prepreg')
  return cu.slice(0, -1).map((id, i) => {
    const z1 = slices.get(id)!.z0,
      z0 = slices.get(cu[i + 1])!.z1
    const d = diel[i] as { type: string; material?: string; thickness: number } | undefined
    const known = d && diel.length === cu.length - 1
    const kind = known ? d.type : cu.length === 2 ? 'core' : 'dielectric'
    return { name: `diel:${i}`, z0, z1, kind, label: `${kind}${known && d.material ? ', ' + d.material : ''}, ${+(z1 - z0).toFixed(3)} mm` }
  })
}
