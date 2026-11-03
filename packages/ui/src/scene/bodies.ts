// The part bodies as few draws: every model mesh of a side baked into one batch per material, a part a piece of it, and a textured mesh,
// a resistor's printed code or a missing model's tag, a copy among the instances of its geometry, so a code shared by parts is one draw.
// The parts' own meshes stay in the scene undrawn: an outline copies them, and a part a drag moves draws them while it moves.
import * as THREE from 'three'
import { concat } from '@pcbjs/export/internal/scene/geometry'
import { LayerBatch, type PieceState } from './batch'
import { Instances } from './instances'
import { setState, type HlState, type Variants } from './highlight'
import type { ItemInfo } from './items'

export type BodyInfo = ItemInfo & { ref: string }
/** A part's body: its root in its side's group and its model meshes. */
export interface Body {
  ref: string
  root: THREE.Object3D
  meshes: THREE.Mesh[]
}

/** A matrix in the frame of an ancestor: the chain of local matrices up to it. */
export function within(o: THREE.Object3D, top: THREE.Object3D): THREE.Matrix4 {
  const m = new THREE.Matrix4()
  for (let p: THREE.Object3D | null = o; p && p !== top; p = p.parent) m.premultiply(p.matrix)
  return m
}

/** Each triangle's second and third corner swapped, so a mirrored geometry still faces out. */
function flipWinding(g: THREE.BufferGeometry) {
  for (const a of [g.attributes.position, g.attributes.normal]) {
    const n = a.itemSize
    for (let t = 0; t < a.count; t += 3)
      for (let k = 0; k < n; k++) {
        const v = a.array[(t + 1) * n + k]
        a.array[(t + 1) * n + k] = a.array[(t + 2) * n + k]
        a.array[(t + 2) * n + k] = v
      }
  }
}

/** A part's meshes of one material in its side's frame as one non-indexed geometry. */
function bake(meshes: THREE.Mesh[], top: THREE.Object3D): THREE.BufferGeometry {
  const parts = meshes.map(m => {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
    if (!g.attributes.normal) g.computeVertexNormals()
    const at = within(m, top)
    g.applyMatrix4(at)
    if (at.determinant() < 0) flipWinding(g)
    return g
  })
  const { position, normal } = concat(parts.map(g => ({ position: g.attributes.position.array, normal: g.attributes.normal.array })))
  for (const g of parts) g.dispose()
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(position, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  return out
}

const textured = (m: THREE.Mesh) => Array.isArray(m.material) || !!(m.material as THREE.MeshBasicMaterial).map

export class Bodies {
  private batches: LayerBatch<BodyInfo>[] = []
  private inst: Instances<BodyInfo>[] = []
  /** each part's copies among the instances, with the mesh each copies */
  private copies = new Map<string, [Instances<BodyInfo>, number, THREE.Mesh][]>()
  /** each part's meshes a batch draws */
  private baked = new Map<string, THREE.Mesh[]>()
  private sides = new Map<string, string>()
  private posed = new Set<string>()

  /** Every body as pieces and copies, its own meshes undrawn from now on. */
  build(bodies: Body[]) {
    this.dispose()
    const batches = new Map<string, { bt: LayerBatch<BodyInfo>; parts: Map<number, THREE.Mesh[]> }>()
    const inst = new Map<string, Instances<BodyInfo>>()
    // ids of their own, below every item's and merged net's
    const infos = bodies.map((b, i): BodyInfo => ({ id: -2e6 - i, kind: 'body', ref: b.ref, layers: [], layer: '' }))
    bodies.forEach((b, i) => {
      const side = b.root.parent as THREE.Group
      const info = infos[i]
      const copies: [Instances<BodyInfo>, number, THREE.Mesh][] = []
      this.sides.set(b.ref, side.name)
      for (const m of b.meshes) {
        m.visible = false
        if (textured(m)) {
          const key = [side.name, m.geometry.uuid, m.renderOrder, ...[m.material].flat().map(x => x.uuid)].join()
          let set = inst.get(key)
          if (!set) inst.set(key, (set = new Instances<BodyInfo>(side, m.geometry, m.material, m.renderOrder)))
          copies.push([set, set.add(info, within(m, side)), m])
          continue
        }
        const mat = m.material as THREE.Material
        const key = [side.name, mat.uuid, m.renderOrder].join()
        let e = batches.get(key)
        if (!e) batches.set(key, (e = { bt: new LayerBatch<BodyInfo>(side, mat, { z: 0, scale: 1, order: m.renderOrder }), parts: new Map() }))
        const l = e.parts.get(i)
        if (l) l.push(m)
        else e.parts.set(i, [m])
        const own = this.baked.get(b.ref)
        if (own) own.push(m)
        else this.baked.set(b.ref, [m])
      }
      this.copies.set(b.ref, copies)
    })
    for (const { bt, parts } of batches.values()) {
      for (const [i, meshes] of parts) bt.fill(bt.add(infos[i]), bake(meshes, bt.group))
      bt.flush()
    }
    this.batches = [...batches.values()].map(e => e.bt)
    this.inst = [...inst.values()]
  }

  /** Each body in the state `stateOf` gives for its part and side group; a part a drag moves drawn by its own meshes. Returns the draws shown. */
  paint(stateOf: (ref: string, group: string) => PieceState, keep: (was: PieceState, st: PieceState) => PieceState, v: Variants): THREE.Mesh[] {
    const shown: THREE.Mesh[] = []
    for (const bt of this.batches) shown.push(...bt.paint(u => (this.posed.has(u.ref) ? 'gone' : stateOf(u.ref, bt.group.name)), keep, v))
    for (const set of this.inst) shown.push(...set.paint(u => stateOf(u.ref, set.group.name), keep, v))
    for (const [ref, meshes] of this.baked) {
      const st = this.posed.has(ref) ? stateOf(ref, this.sides.get(ref)!) : 'gone'
      for (const m of meshes) {
        m.visible = st !== 'gone'
        setState(m, st === 'gone' ? null : (st as HlState | null), v)
        if (m.visible) shown.push(m)
      }
    }
    return shown
  }

  /** The parts a drag moves; true when they changed, and the bodies want a paint. */
  setPosed(refs: ReadonlySet<string>): boolean {
    if (refs.size === this.posed.size && [...refs].every(r => this.posed.has(r))) return false
    this.posed = new Set(refs)
    return true
  }
  /** A posed part's copies follow its root. */
  move(ref: string) {
    for (const [set, i, m] of this.copies.get(ref) ?? []) set.move(i, within(m, set.group))
  }

  dispose() {
    for (const bt of this.batches) bt.dispose()
    for (const set of this.inst) set.dispose()
    this.batches = []
    this.inst = []
    this.copies = new Map()
    this.baked = new Map()
    this.sides = new Map()
  }
}
