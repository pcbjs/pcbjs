// Which copper a highlight lights: a merged net's mesh only for its whole net, an item's own mesh for the item, its part or its net.
// Free of three.js so Node imports it in the tests.
import type { ItemInfo } from './items'

export interface Keep {
  ids: ReadonlySet<number>
  parts: ReadonlySet<string>
  nets: ReadonlySet<string>
}
export type LitInfo = Pick<ItemInfo, 'id' | 'ref' | 'net'> & { under?: ItemInfo; items?: ItemInfo[] }

/** Whether an item is lit by its own id or its part, not through its net. */
export const own = (u: LitInfo, k: Keep): boolean => !u.items && (k.ids.has(u.id) || (!!u.ref && k.parts.has(u.ref)))

/** Whether a mesh is lit: merged copper only while its whole net is, any other mesh by its id, part or net. */
export const lit = (u: LitInfo, k: Keep): boolean => own(u, k) || (!!u.net && k.nets.has(u.net))

/** Whether an item's own mesh under merged copper is lit in place of the merged net: lit by itself while the net is not. */
export const alone = (u: LitInfo, k: Keep): boolean => !!u.under && own(u, k) && !(!!u.net && k.nets.has(u.net))

/** The copper meshes a highlight lights: merged ones for whole nets, an item's own mesh in place of its merged net's otherwise. */
export function litMeshes<M extends { userData: unknown }>(meshes: Iterable<M>, k: Keep): M[] {
  const out: M[] = []
  for (const m of meshes) {
    const u = m.userData as LitInfo
    if (u.under ? alone(u, k) : lit(u, k)) out.push(m)
  }
  return out
}

export interface Iso {
  ids: ReadonlySet<number>
  parts: ReadonlySet<string>
  fade: boolean
}

/** Whether a mesh is out of an isolation: merged copper unless all its items are in, any other mesh unless its id or part is. */
export function isoOut(u: LitInfo, iso: Iso): boolean {
  const out = (i: Pick<ItemInfo, 'id' | 'ref'>) => !iso.ids.has(i.id) && !(i.ref && iso.parts.has(i.ref))
  return u.items ? u.items.some(out) : out(u)
}

/** The items' own meshes drawn over their merged copper: lit by themselves, or kept by an isolation that leaves the merged net out. */
export function overlaid<M extends { userData: unknown }>(meshes: readonly M[], k: Keep | null, iso: Iso | null): M[] {
  const outMerged = new Set<number>()
  if (iso)
    for (const m of meshes) {
      const u = m.userData as LitInfo
      if (u.items && isoOut(u, iso)) outMerged.add(u.id)
    }
  return meshes.filter(m => {
    const u = m.userData as LitInfo
    if (!u.under) return false
    const out = !!iso && isoOut(u, iso)
    if (out && !iso!.fade) return false
    return (!!k && own(u, k)) || (!out && outMerged.has(u.under.id))
  })
}
