// geometries are unit-depth extrusions scaled in z per layer, cached by a hash of their rings and drawn as one batch per layer group
import * as THREE from 'three'
import type { SiteData, SiteItem } from '@pcbjs/core/site-data'
import { coveredOf, shapeOf } from '@pcbjs/core/site-shapes'
import { toGeometry } from './geometry'
import { flatten, hashRings, holeOf, runJob, type GeoJob, type GeoResult } from '@pcbjs/export/internal/scene/geometry'
import { MASK_FLARE, sliceOf, type MaskInfo, type Slice } from '@pcbjs/export/internal/scene/stack'
import { ringsArea } from './intensity'
import { ItemPicker } from '@pcbjs/export/internal/scene/merge'
import { LayerBatch, type Place } from './batch'
import { Instances } from './instances'

type Ring = [number, number][]
/** The pick rank of an item kind: a lower rank wins among hits within a hair, a pad over its pour. */
export const RANK: Record<string, number> = { body: 0, pad: 1, via: 2, track: 3, graphic: 4, text: 5, zone: 6 }

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

/** Points per batch of small items sent to the worker; a pour is a batch of its own. */
const BATCH_POINTS = 6000

/** A copper material drawn a hair nearer the camera, for an item's own copper over its merged net. */
const raised = new WeakMap<THREE.Material, THREE.Material>()
export function raisedOf(m: THREE.Material): THREE.Material {
  let r = raised.get(m)
  if (!r) {
    r = m.clone()
    r.polygonOffset = true
    r.polygonOffsetFactor = -1
    r.polygonOffsetUnits = -4
    raised.set(m, r)
  }
  return r
}

/** A piece of a batch: an item on one layer, or the copper of one net on one layer from two or more items, merged as the board is made. */
export type PieceInfo = ItemInfo & { items?: ItemInfo[]; merged?: ItemPicker }
/** An item drawn inside its net's merged copper: its own mesh made on first highlight, drawn over the merged copper while lit alone. */
export interface Member {
  info: ItemInfo & { under: ItemInfo }
  batch: LayerBatch<PieceInfo>
  rings: Ring[]
  mesh: THREE.Mesh | null
}

export interface BuiltItems {
  batches: LayerBatch<PieceInfo>[]
  /** the plating of round holes as one draw */
  barrels: Instances<ItemInfo> | null
  /** the batches drawing an item as a piece */
  pieces: Map<number, LayerBatch<PieceInfo>[]>
  /** an item inside merged copper, per layer */
  members: Map<number, Member[]>
  /** an item's copy among the barrels */
  barrelOf: Map<number, number>
  /** the merged copper of each net: its batch and piece id */
  nets: Map<string, [LayerBatch<PieceInfo>, number][]>
  /** the geometries not in the cache yet, by key, in the order to build them: small items first, then the pours */
  jobs: GeoJob[]
  /** fill the pieces whose geometry the results bring; returns how many landed */
  fill(results: GeoResult[]): number
}

/** The copper of one net on one layer from two or more items: one merged piece each for the copper and the mask over it. */
interface NetLayer {
  info: ItemInfo
  items: ItemInfo[]
  /** each item's rings and pick rank, in the order of `items` */
  pick: Ring[][]
  rank: number[]
  rings: Ring[]
  skins: Ring[]
  drills: Ring[]
  pour: boolean
}

/** Every item as pieces of one batch per layer group and material, with the jobs for the geometry not cached yet, which `fill` lands; copper of one net on a layer from two or more items is one merged piece, as the board is made, its items members whose own mesh is made only when one is lit alone. */
export function buildItems(b: SiteData, slices: Map<string, Slice>, mask: MaskInfo, mats: ItemMaterials, cache: GeometryCache, group: (id: string) => THREE.Group): BuiltItems {
  const all = new Map<string, LayerBatch<PieceInfo>>()
  const batchOf = (name: string, material: THREE.Material, place: Place) => {
    const k = `${name}\n${material.uuid}\n${place.z}\n${place.scale}`
    let bt = all.get(k)
    if (!bt) all.set(k, (bt = new LayerBatch<PieceInfo>(group(name), material, place)))
    return bt
  }
  const pieces = new Map<number, LayerBatch<PieceInfo>[]>(),
    members = new Map<number, Member[]>(),
    barrelOf = new Map<number, number>(),
    nets = new Map<string, [LayerBatch<PieceInfo>, number][]>()
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
    const l = m.get(k)
    if (l) l.push(v)
    else m.set(k, [v])
  }
  const waiting = new Map<string, ((geo: THREE.BufferGeometry) => void)[]>()
  const jobs = new Map<string, { job: GeoJob; rank: number }>()
  // small items first, then their skins, the pours and their skins
  const want = (key: string, job: () => GeoJob, rank: number, make: (geo: THREE.BufferGeometry) => void) => {
    const geo = cache.get(key)
    if (geo !== undefined) {
      if (geo) make(geo)
      return
    }
    push(waiting, key, make)
    const j = jobs.get(key)
    if (!j) jobs.set(key, { job: job(), rank })
    else j.rank = Math.min(j.rank, rank)
  }
  const piece = (bt: LayerBatch<PieceInfo>, info: PieceInfo, key: string, job: () => GeoJob, rank: number) => {
    const i = bt.add(info)
    if (info.id >= 0) push(pieces, info.id, bt)
    want(key, job, rank, geo => bt.fill(i, geo))
  }
  const copperOf = (layer: string, s: Slice) =>
    batchOf(layer, layer.endsWith('.SilkS') ? mats.silk(layer[0] as 'F' | 'B') : mats.copper(layer), { z: s.z0, scale: s.z1 - s.z0, order: 0 })
  const skinOf = (side: 'F' | 'B', s: Slice) => batchOf(`${side}.Mask`, mats.mask(side), { z: side === 'F' ? s.z1 : s.z0, scale: 1, order: 1 })
  const netKey = (layer: string, net: string) => `${layer}\n${net}`
  const count = new Map<string, number>()
  for (const it of b.items ?? []) if (it.net) for (const l of it.layers) if (slices.has(l)) count.set(netKey(l, it.net), (count.get(netKey(l, it.net)) ?? 0) + 1)
  const netLayers = new Map<string, NetLayer>()
  const netOf = (layer: string, net: string) => {
    const k = netKey(layer, net)
    let n = netLayers.get(k)
    if (!n) {
      // ids of their own, below every item's and part's
      const info: ItemInfo = { id: -1e6 - netLayers.size, kind: 'track', net, layers: [layer], layer }
      n = { info, items: [], pick: [], rank: [], rings: [], skins: [], drills: [], pour: false }
      netLayers.set(k, n)
    }
    return n
  }
  let barrels: Instances<ItemInfo> | null = null
  for (const it of b.items ?? []) {
    const rings = shapeOf(b, it.id)
    const shown = it.layers.filter(l => sliceOf(l, slices, mask.thickness))
    if (!shown.length && !it.drill) continue
    const info = {
      id: it.id,
      kind: it.kind,
      net: it.net,
      ref: it.ref,
      layers: it.layers,
      pad: it.pad,
      ...(it.pair ? { pair: it.pair, role: it.role } : {}),
      ...(it.width !== undefined ? { width: it.width } : {}),
      area: ringsArea(rings),
    }
    if (shown.length) {
      const flat = flatten(rings)
      const hash = hashRings(flat)
      const pour = it.kind === 'zone'
      const unitKey = `u:${hash}`
      for (const layer of shown) {
        const s = sliceOf(layer, slices, mask.thickness)!
        const net = it.net && (count.get(netKey(layer, it.net)) ?? 0) > 1 ? netOf(layer, it.net) : null
        const own = { ...info, layer }
        const bt = copperOf(layer, s)
        if (net) {
          net.items.push(own)
          net.pick.push(rings)
          net.rank.push(RANK[it.kind] ?? 9)
          net.rings.push(...rings)
          net.pour ||= pour
          if (it.drill && rings[1]) net.drills.push(rings[1])
          if (pour) net.info.kind = 'zone'
          push(members, it.id, { info: { ...own, under: net.info }, batch: bt, rings, mesh: null })
        } else piece(bt, own, unitKey, () => ({ kind: 'unit', key: unitKey, rings: flat }), pour ? 2 : 0)
        // the mask skin over outer copper covers the part the site data gives as `covered`
        const side = layer === 'F.Cu' ? 'F' : layer === 'B.Cu' ? 'B' : null
        const part = side ? coveredOf(b, it.id, side) : undefined
        if (!side || (part && !part.length)) continue
        if (net) {
          net.skins.push(...(part ?? rings))
          continue
        }
        const t = mask.thickness[side]
        const sflat = part ? flatten(part) : flat
        const key = `s:${t}:${part ? hashRings(sflat) : hash}`
        piece(skinOf(side, s), own, key, () => ({ kind: 'skin', key, rings: sflat, t, flare: MASK_FLARE }), pour ? 3 : 1)
      }
    }
    // the plating of a hole through the copper layers it joins; an NPTH hole has no copper and no barrel
    const cu = it.layers.filter(l => slices.has(l))
    const hole = it.drill && cu.length > 1 ? holeOf(rings, it.drill) : null
    if (!hole) continue
    const z0 = Math.min(...cu.map(l => slices.get(l)!.z0)),
      z1 = Math.max(...cu.map(l => slices.get(l)!.z1))
    const own = { ...info, layer: cu.join(' to ') }
    // a round hole is a copy of the shared cylinder scaled to the drill, a slot a tube along its own ring in a batch of the slots
    if (hole.slot) {
      const bt = batchOf('barrels', mats.barrel, { z: z0, scale: z1 - z0, order: 0 })
      bt.fill(bt.add(own), cache.tube(hole.ring))
      push(pieces, it.id, bt)
      continue
    }
    barrels ??= new Instances<ItemInfo>(group('barrels'), cache.barrelGeometry, mats.barrel)
    const at = new THREE.Matrix4().compose(new THREE.Vector3(hole.c[0], -hole.c[1], z0), new THREE.Quaternion(), new THREE.Vector3(it.drill! / 2, it.drill! / 2, z1 - z0))
    barrelOf.set(it.id, barrels.add(own, at))
  }
  for (const n of netLayers.values()) {
    const layer = n.info.layer,
      s = slices.get(layer)!
    const flat = flatten(n.rings),
      drills = flatten(n.drills)
    const cut = hashRings(drills)
    const info: PieceInfo = { ...n.info, items: n.items, merged: new ItemPicker(n.pick, n.rank) }
    const bt = copperOf(layer, s)
    push(nets, n.info.net!, [bt, info.id])
    const key = `u:m:${hashRings(flat)}:${cut}`
    piece(bt, info, key, () => ({ kind: 'unit', key, rings: flat, merge: drills }), n.pour ? 2 : 0)
    const side = layer === 'F.Cu' ? 'F' : layer === 'B.Cu' ? 'B' : null
    if (!side || !n.skins.length) continue
    const t = mask.thickness[side]
    const sflat = flatten(n.skins)
    const skey = `s:${t}:m:${hashRings(sflat)}:${cut}`
    const sk = skinOf(side, s)
    push(nets, n.info.net!, [sk, info.id])
    piece(sk, info, skey, () => ({ kind: 'skin', key: skey, rings: sflat, t, flare: MASK_FLARE, merge: drills }), n.pour ? 3 : 1)
  }
  const list = [...jobs.values()].sort((x, y) => x.rank - y.rank)
  const batches = [...all.values()]
  for (const bt of batches) bt.flush()
  return {
    batches,
    barrels,
    pieces,
    members,
    barrelOf,
    nets,
    jobs: list.map(j => j.job),
    fill(results: GeoResult[]) {
      let n = 0
      for (const r of results) {
        // a result another build asked for too may be in the cache already
        if (cache.get(r.key) === undefined) cache.put(r.key, toGeometry(r))
        const makes = waiting.get(r.key)
        if (!makes) continue
        waiting.delete(r.key)
        const g = cache.get(r.key)
        if (g)
          for (const make of makes) {
            make(g)
            n++
          }
      }
      return n
    },
  }
}

/** A member's own mesh where its batch draws, made once and never drawn: what an outline or a drag's ghost copies; null for an empty shape. */
export function memberMesh(m: Member, cache: GeometryCache): THREE.Mesh | null {
  if (m.mesh) return m.mesh
  const geo = memberGeometry(m, cache)
  if (!geo) return null
  const mesh = m.batch.placed(new THREE.Mesh(geo, raisedOf(m.batch.material)))
  mesh.visible = false
  mesh.userData = { ...m.info, base: mesh.material }
  m.batch.group.add(mesh)
  mesh.updateWorldMatrix(true, false)
  return (m.mesh = mesh)
}

/** A member's own geometry: from the cache, else its job run here; null for an empty shape. */
export function memberGeometry(m: Member, cache: GeometryCache): THREE.BufferGeometry | null {
  if (m.mesh) return m.mesh.geometry
  const flat = flatten(m.rings)
  const key = `u:${hashRings(flat)}`
  let geo = cache.get(key)
  if (geo === undefined) {
    geo = toGeometry(runJob({ kind: 'unit', key, rings: flat }))
    cache.put(key, geo)
  }
  return geo
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
