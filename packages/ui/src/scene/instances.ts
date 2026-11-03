// Copies of one geometry in one material as one draw, the plating of round holes or a sub-mesh of a part model: an InstancedMesh for
// each state the copies are drawn in, so a faded or selected copy moves to that state's twin and the rest stay one draw.
import * as THREE from 'three'
import { setState, type HlState, type Variants } from './highlight'
import type { PieceState } from './batch'

const REST = 'rest'
type TwinKey = HlState | typeof REST

export class Instances<U> {
  readonly group: THREE.Group
  readonly geometry: THREE.BufferGeometry
  readonly material: THREE.Material | THREE.Material[]
  private order: number
  private infos: U[] = []
  private matrices: THREE.Matrix4[] = []
  private states: PieceState[] = []
  private twins = new Map<TwinKey, THREE.InstancedMesh>()
  /** each copy's twin and its instance there */
  private at: ([THREE.InstancedMesh, number] | null)[] = []
  private owned = new Map<number, THREE.Mesh>()
  private moved = false

  constructor(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], order = 0) {
    this.group = group
    this.geometry = geometry
    this.material = material
    this.order = order
  }

  /** A copy at a matrix in the group's frame; returns its index. */
  add(info: U, matrix: THREE.Matrix4): number {
    this.infos.push(info)
    this.matrices.push(matrix.clone())
    this.states.push(null)
    this.at.push(null)
    this.moved = true
    return this.infos.length - 1
  }
  /** A copy moved, as a drag poses it. */
  move(i: number, matrix: THREE.Matrix4) {
    this.matrices[i].copy(matrix)
    this.owned.get(i)?.matrix.copy(matrix)
    const at = this.at[i]
    if (!at) return
    const [t, k] = at
    t.setMatrixAt(k, matrix)
    t.instanceMatrix.needsUpdate = true
    t.boundingSphere = null
    t.boundingBox = null
  }
  get size(): number {
    return this.infos.length
  }
  info(i: number): U {
    return this.infos[i]
  }

  /** Each copy in the state `stateOf` gives, held by `keep` while a ramp runs out: one draw per state in use. Returns the twins shown. */
  paint(stateOf: (u: U, i: number) => PieceState, keep: (was: PieceState, st: PieceState) => PieceState, v: Variants): THREE.InstancedMesh[] {
    let changed = this.moved
    for (let i = 0; i < this.infos.length; i++) {
      const st = keep(this.states[i], stateOf(this.infos[i], i))
      if (st !== this.states[i]) changed = true
      this.states[i] = st
    }
    this.moved = false
    if (changed) {
      this.at.fill(null)
      for (const st of new Set(this.states)) if (st !== 'gone') this.twinOf(st ?? REST)
      for (const [key, t] of this.twins) this.fill(t, key)
    }
    const shown: THREE.InstancedMesh[] = []
    for (const [key, t] of this.twins) {
      t.visible = t.count > 0
      if (!t.visible) continue
      setState(t, key === REST ? null : key, v)
      shown.push(t)
    }
    return shown
  }

  private twinOf(key: TwinKey): THREE.InstancedMesh {
    let t = this.twins.get(key)
    if (t) return t
    t = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, this.infos.length))
    t.renderOrder = this.order
    t.matrixAutoUpdate = false
    this.twins.set(key, t)
    this.group.add(t)
    return t
  }
  /** The copies in a twin's state packed at its start, each named by its instance. */
  private fill(t: THREE.InstancedMesh, key: TwinKey) {
    const infos: U[] = []
    for (let i = 0; i < this.infos.length; i++) {
      const st = this.states[i]
      if (st === 'gone' || (st ?? REST) !== key) continue
      this.at[i] = [t, infos.length]
      t.setMatrixAt(infos.length, this.matrices[i])
      infos.push(this.infos[i])
    }
    t.count = infos.length
    t.userData.instances = infos
    t.userData.ver = (t.userData.ver ?? 0) + 1
    t.instanceMatrix.needsUpdate = true
    t.boundingSphere = null
    t.boundingBox = null
  }

  /** A copy's own mesh at its matrix, never drawn: what an outline copies. */
  own(i: number): THREE.Mesh {
    let m = this.owned.get(i)
    if (m) return m
    m = new THREE.Mesh(this.geometry, this.material)
    m.matrixAutoUpdate = false
    m.matrix.copy(this.matrices[i])
    m.visible = false
    m.userData = { ...this.infos[i], base: this.material }
    this.group.add(m)
    m.updateWorldMatrix(true, false)
    this.owned.set(i, m)
    return m
  }

  dispose() {
    for (const t of this.twins.values()) {
      t.dispose()
      t.removeFromParent()
    }
    for (const m of this.owned.values()) m.removeFromParent()
  }
}
