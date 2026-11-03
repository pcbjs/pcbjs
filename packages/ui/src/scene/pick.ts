// What a ray through the 3D view selects: of its hits within a hair of the nearest, the item of lowest rank, a merged net naming the item
// under the hit by the selection geometry, a body naming its part; and the same hit as the tools read a press.
import type * as THREE from 'three'
import { RANK, type ItemInfo } from './items'
import type { ItemPicker } from '@pcbjs/export/internal/scene/merge'
import type { ToolHit } from '../gesture'

export interface Picked {
  info: ItemInfo | null
  ref?: string
  rank: number
}

type HitInfo = Partial<ItemInfo> & { merged?: ItemPicker; items?: ItemInfo[] }
/** What a hit names: a batch's piece under its triangle, an instance's copy, else the mesh's own. */
export function hitInfo(h: THREE.Intersection): HitInfo | null {
  const u = h.object.userData
  if (u.batch) return u.batch.itemAt(h.faceIndex ?? -1)
  if (u.instances) return u.instances[h.instanceId ?? -1] ?? null
  return u.id !== undefined ? (u as HitInfo) : null
}

/** The best of a ray's hits, nearest first; `stale` drops what a live rebuild made stale. */
export function bestHit(hits: readonly THREE.Intersection[], stale: (i: ItemInfo) => boolean = () => false): Picked | null {
  if (!hits.length) return null
  const near = hits.filter(h => h.distance <= hits[0].distance + 0.02)
  let best: Picked | null = null
  for (const h of near) {
    let o: THREE.Object3D | null = h.object
    if (o.userData.pick === 'slab') {
      if (!best) best = { info: null, rank: 99 }
      continue
    }
    let cand: Picked | null = null
    const u = hitInfo(h)
    if (u?.merged) {
      const p = o.worldToLocal(h.point.clone())
      const info: ItemInfo | undefined = u.items![u.merged.at([p.x, -p.y])]
      if (info) cand = { info, ref: info.ref, rank: RANK[info.kind] ?? 9 }
    } else if (u?.id !== undefined) cand = { info: u as ItemInfo, ref: u.ref, rank: RANK[u.kind!] ?? 9 }
    else if (u?.ref) cand = { info: { id: -1, kind: 'body', ref: u.ref, layers: [], layer: '' }, ref: u.ref, rank: 0 }
    else {
      while (o && !o.userData.ref) o = o.parent
      if (o) cand = { info: { id: -1, kind: 'body', ref: o.userData.ref, layers: [], layer: '' }, ref: o.userData.ref, rank: 0 }
    }
    if (cand?.info && stale(cand.info)) cand = null
    if (cand && (!best || cand.rank < best.rank)) best = cand
  }
  return best
}

/** A picked item as the tools read a press: its copper id, none for a body, and its part. */
export const toolHitOf = (i: ItemInfo | null | undefined): ToolHit => ({ id: i && i.kind !== 'body' ? i.id : null, ref: i?.ref ?? null })
