// geometries are unit-depth extrusions scaled in z per layer, cached by a hash of their rings
import * as THREE from 'three'
import type { SiteData, SiteItem } from '@pcbjs/core/site-data'
import { markupRings } from './shapes'
import { flatten, hashRings, toGeometry, type FlatRings, type GeoJob, type GeoResult } from './geometry'
import { SILK, type Slice } from './stack'
import { hlStrength, ringsArea } from './intensity'

export interface ItemInfo {
  id: number
  kind: SiteItem['kind'] | 'body'
  net?: string
  ref?: string
  layers: string[]
  layer: string
  pad?: string
  /** a track of a differential pair: the pair id, its role and its width */
  pair?: string
  role?: 'P' | 'N'
  width?: number
  /** the item's area in mm², for the strength of its highlight */
  area?: number
}

export interface ItemMaterials {
  copper(layer: string): THREE.Material
  silk(side: 'F' | 'B'): THREE.Material
  barrel: THREE.Material
  mask(side: 'F' | 'B'): THREE.Material
}
/** The solder mask of both sides: its thickness and its openings, from the mask layer markup. */
export interface MaskInfo {
  thickness: Record<'F' | 'B', number>
  openings: Record<'F' | 'B', { ids: Set<number>; rings: [number, number][][] }>
}
/** How far the mask over a copper feature spreads at its foot, mm. */
export const MASK_FLARE = 0.03

export function maskInfo(b: SiteData, thickness: Record<'F' | 'B', number>): MaskInfo {
  const side = (s: 'F' | 'B') => {
    const found = markupRings(b.layers.find(l => l.id === `${s}.Mask`)?.svg ?? '')
    return { ids: new Set(found.flatMap(f => (f.id === null ? [] : [f.id]))), rings: found.flatMap(f => f.rings) }
  }
  return { thickness, openings: { F: side('F'), B: side('B') } }
}

export interface BuiltItems {
  meshes: THREE.Mesh[]
  byId: Map<number, THREE.Mesh[]>
  /** the geometries not in the cache yet, by key, in the order to build them: small items first, then the pours */
  jobs: GeoJob[]
  /** make the meshes whose geometry the results bring; returns how many were added */
  fill(results: GeoResult[]): number
}

/** Geometries by job key; `sweep` disposes the ones not used since the last sweep. A null entry is rings without a shape. */
export class GeometryCache {
  private map = new Map<string, { geo: THREE.BufferGeometry | null; used: boolean }>()
  private barrel: THREE.BufferGeometry | null = null
  /** the geometry, null for an empty one, undefined when it is not built yet; marks it used */
  get(key: string): THREE.BufferGeometry | null | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    e.used = true
    return e.geo
  }
  put(key: string, geo: THREE.BufferGeometry | null) {
    const old = this.map.get(key)
    if (old) {
      if (old.geo !== geo) geo?.dispose()
      old.used = true
      return
    }
    this.map.set(key, { geo, used: true })
  }
  /** an open cylinder of radius 1 from z = 0 to z = 1 */
  get barrelGeometry(): THREE.BufferGeometry {
    if (!this.barrel) {
      this.barrel = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true)
      this.barrel.rotateX(Math.PI / 2)
      this.barrel.translate(0, 0, 0.5)
    }
    return this.barrel
  }
  /** an open tube along a hole ring in board mm, from z = 0 to z = 1, cached by the ring */
  tube(ring: [number, number][]): THREE.BufferGeometry {
    const key = `t:${hashRings(flatten([ring]))}`
    const hit = this.get(key)
    if (hit) return hit
    const n = ring.length,
      pos = new Float32Array(n * 6 * 3),
      nor = new Float32Array(n * 6 * 3)
    let cx = 0,
      cy = 0
    for (const [x, y] of ring) {
      cx += x / n
      cy += -y / n
    }
    let k = 0
    for (let i = 0; i < n; i++) {
      const a = ring[i],
        b = ring[(i + 1) % n]
      const ax = a[0],
        ay = -a[1],
        bx = b[0],
        by = -b[1]
      // the face looks into the hole, toward its centre
      let nx = -(by - ay),
        ny = bx - ax
      const l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      if (nx * (cx - (ax + bx) / 2) + ny * (cy - (ay + by) / 2) < 0) {
        nx = -nx
        ny = -ny
      }
      for (const [x, y, z] of [
        [ax, ay, 0],
        [bx, by, 0],
        [bx, by, 1],
        [ax, ay, 0],
        [bx, by, 1],
        [ax, ay, 1],
      ]) {
        pos[k] = x
        pos[k + 1] = y
        pos[k + 2] = z
        nor[k] = nx
        nor[k + 1] = ny
        nor[k + 2] = 0
        k += 3
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    g.computeBoundingSphere()
    this.put(key, g)
    return g
  }
  sweep() {
    for (const [k, e] of this.map) {
      if (!e.used) {
        e.geo?.dispose()
        this.map.delete(k)
      } else e.used = false
    }
  }
  dispose() {
    for (const e of this.map.values()) e.geo?.dispose()
    this.map.clear()
    this.barrel?.dispose()
    this.barrel = null
  }
  get size() {
    return this.map.size
  }
}

/** The pad number of every pad id, from the copper layer markup. */
function padNumbers(b: SiteData): Map<number, string> {
  const out = new Map<number, string>()
  for (const l of b.layers) {
    if (l.kind !== 'copper') continue
    for (const m of l.svg.matchAll(/<path\b[^>]*\bdata-id="(\d+)"[^>]*\bdata-pad="([^"]*)"/g)) out.set(+m[1], m[2])
  }
  return out
}

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

/** Points per batch of small items sent to the worker; a pour is a batch of its own. */
const BATCH_POINTS = 6000

/** The meshes of every cached item now, and the jobs for the rest, which `fill` adds as they come in. */
export function buildItems(b: SiteData, slices: Map<string, Slice>, mask: MaskInfo, mats: ItemMaterials, cache: GeometryCache, group: (id: string) => THREE.Group): BuiltItems {
  const meshes: THREE.Mesh[] = [],
    byId = new Map<number, THREE.Mesh[]>()
  const pads = padNumbers(b)
  const add = (m: THREE.Mesh, info: ItemInfo) => {
    m.userData = { ...info, base: m.material, strength: hlStrength(info.area) }
    m.matrixAutoUpdate = false
    m.updateMatrix()
    meshes.push(m)
    let l = byId.get(info.id)
    if (!l) byId.set(info.id, (l = []))
    l.push(m)
  }
  type Plan = { make: (geo: THREE.BufferGeometry) => void }
  const waiting = new Map<string, Plan[]>()
  const jobs = new Map<string, { job: GeoJob; size: number; pour: boolean; skin: boolean }>()
  const want = (key: string, job: () => GeoJob, size: number, pour: boolean, plan: Plan) => {
    const geo = cache.get(key)
    if (geo !== undefined) {
      if (geo) plan.make(geo)
      return
    }
    let l = waiting.get(key)
    if (!l) waiting.set(key, (l = []))
    l.push(plan)
    if (!jobs.has(key)) {
      const j = job()
      jobs.set(key, { job: j, size, pour, skin: j.kind === 'skin' })
    }
  }
  for (const it of b.items ?? []) {
    const shown = it.layers.filter(l => sliceOf(l, slices, mask.thickness))
    if (!shown.length && !it.drill) continue
    const info = {
      id: it.id,
      kind: it.kind,
      net: it.net,
      ref: it.ref,
      layers: it.layers,
      pad: pads.get(it.id),
      ...(it.pair ? { pair: it.pair, role: it.role } : {}),
      ...(it.width !== undefined ? { width: it.width } : {}),
      area: ringsArea(it.rings),
    }
    if (shown.length) {
      const flat = flatten(it.rings)
      const hash = hashRings(flat)
      const size = flat.xy.length / 2
      const pour = it.kind === 'zone'
      const unitKey = `u:${hash}`
      for (const layer of shown) {
        const s = sliceOf(layer, slices, mask.thickness)!
        const mat = layer.endsWith('.SilkS') ? mats.silk(layer[0] as 'F' | 'B') : mats.copper(layer)
        want(unitKey, () => ({ kind: 'unit', key: unitKey, rings: flat }), size, pour, {
          make: geo => {
            const m = new THREE.Mesh(geo, mat)
            m.position.z = s.z0
            m.scale.z = s.z1 - s.z0
            add(m, { ...info, layer })
            group(layer).add(m)
          },
        })
        // the mask skin over outer copper covers the part the site data gives as `covered`
        const side = layer === 'F.Cu' ? 'F' : layer === 'B.Cu' ? 'B' : null
        const part = side ? it.covered?.[side] : undefined
        if (side && (!part || part.length)) {
          const t = mask.thickness[side]
          const sflat = part ? flatten(part) : flat
          const shash = part ? hashRings(sflat) : hash
          const key = `s:${t}:${shash}`
          want(key, () => ({ kind: 'skin', key, rings: sflat, t, flare: MASK_FLARE }), sflat.xy.length / 2, pour, {
            make: geo => {
              const k = new THREE.Mesh(geo, mats.mask(side))
              k.position.z = side === 'F' ? s.z1 : s.z0
              k.renderOrder = 1
              add(k, { ...info, layer })
              group(`${side}.Mask`).add(k)
            },
          })
        }
      }
    }
    // the plating of a hole through the copper layers it joins; an NPTH hole has no copper and no barrel
    const cu = it.layers.filter(l => slices.has(l))
    const hole = it.drill && cu.length > 1 ? holeOf(it) : null
    if (hole) {
      const z0 = Math.min(...cu.map(l => slices.get(l)!.z0)),
        z1 = Math.max(...cu.map(l => slices.get(l)!.z1))
      // a round hole is the shared cylinder scaled to the drill, a slot a tube along its own ring
      const m = new THREE.Mesh(hole.slot ? cache.tube(hole.ring) : cache.barrelGeometry, mats.barrel)
      if (hole.slot) m.position.set(0, 0, z0)
      else m.position.set(hole.c[0], -hole.c[1], z0)
      if (hole.slot) m.scale.set(1, 1, z1 - z0)
      else m.scale.set(it.drill! / 2, it.drill! / 2, z1 - z0)
      add(m, { ...info, layer: cu.join(' to ') })
      group('barrels').add(m)
    }
  }
  const list = [...jobs.values()]
  const rank = (j: (typeof list)[number]) => (j.pour ? 2 : 0) + (j.skin ? 1 : 0)
  list.sort((x, y) => rank(x) - rank(y))
  return {
    meshes,
    byId,
    jobs: list.map(j => j.job),
    fill(results: GeoResult[]) {
      let n = 0
      for (const r of results) {
        // a result another build asked for too may be in the cache already
        if (cache.get(r.key) === undefined) cache.put(r.key, toGeometry(r))
        const plans = waiting.get(r.key)
        if (!plans) continue
        waiting.delete(r.key)
        const g = cache.get(r.key)
        if (g)
          for (const p of plans) {
            p.make(g)
            n++
          }
      }
      return n
    },
  }
}

/** Jobs in batches for the worker: small jobs together up to BATCH_POINTS points, a large one alone. */
export function batches(jobs: GeoJob[]): GeoJob[][] {
  const out: GeoJob[][] = []
  let cur: GeoJob[] = [],
    pts = 0,
    kind = ''
  const size = (j: GeoJob) => (j.kind === 'slab' ? j.outline.xy.length + j.drills.length : j.rings.xy.length + (j.kind === 'skin' && j.cutouts ? j.cutouts.xy.length : 0)) / 2
  for (const j of jobs) {
    const n = size(j)
    if (cur.length && (pts + n > BATCH_POINTS || j.kind !== kind)) {
      out.push(cur)
      cur = []
      pts = 0
    }
    cur.push(j)
    pts += n
    kind = j.kind
  }
  if (cur.length) out.push(cur)
  return out
}

/** An item's hole from its second ring: the ring, its centre and whether it is a slot. Null without one. */
function holeOf(it: SiteItem): { ring: [number, number][]; c: [number, number]; slot: boolean } | null {
  const r = it.rings[1]
  if (!r) return null
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of r) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  return { ring: r, c: [(x0 + x1) / 2, (y0 + y1) / 2], slot: Math.max(x1 - x0, y1 - y0) > (it.drill ?? 0) * 1.05 }
}
