// The copper of one layer, the silk or the mask skins of one side as one draw: every piece, an item's own shape or a net's merged copper,
// laid end to end in one geometry with a triangle range each. A piece drawn in another state than the rest goes to a draw of that state
// through an index on the same buffers, so a fade costs one draw per state, never one per item.
import * as THREE from 'three'
import { concat, partOf } from '@pcbjs/export/internal/scene/geometry'
import { setState, type HlState, type Variants } from './highlight'

/** How a piece is drawn: in a state, at rest for null, or not at all. */
export type PieceState = HlState | null | 'gone'
/** Where a batch's unit geometry sits in its layer group: lifted to `z`, stretched `scale` in z. */
export interface Place {
  z: number
  scale: number
  order: number
}

const REST = 'rest'
type DrawKey = HlState | typeof REST

export class LayerBatch<U extends { id: number }> {
  /** the whole batch, never drawn: what a ray tests, its faceIndex a triangle of the concatenation */
  readonly pick: THREE.Mesh
  readonly group: THREE.Group
  readonly material: THREE.Material
  readonly place: Place
  private infos: U[] = []
  private geos: (THREE.BufferGeometry | null)[] = []
  private index = new Map<number, number>()
  private starts: Uint32Array = new Uint32Array(1)
  private states: PieceState[] = []
  private draws = new Map<DrawKey, THREE.Mesh>()
  private owned = new Map<number, THREE.Mesh>()
  private dirty = false

  constructor(group: THREE.Group, material: THREE.Material, place: Place) {
    this.group = group
    this.material = material
    this.place = place
    this.pick = this.placed(new THREE.Mesh(new THREE.BufferGeometry(), material))
    this.pick.visible = false
    this.pick.userData.batch = this
    group.add(this.pick)
    this.pick.updateWorldMatrix(true, false)
  }

  /** A piece, its geometry to come; returns its index. */
  add(info: U): number {
    const i = this.infos.length
    this.infos.push(info)
    this.geos.push(null)
    this.states.push(null)
    this.index.set(info.id, i)
    return i
  }
  /** A piece's geometry landed; `flush` draws it. */
  fill(i: number, geo: THREE.BufferGeometry) {
    this.geos[i] = geo
    this.dirty = true
  }
  /** The landed pieces laid end to end again, the draws following on their next paint; false when nothing landed since. */
  flush(): boolean {
    if (!this.dirty) return false
    this.dirty = false
    const attr = (g: THREE.BufferGeometry | null) => g && { position: g.attributes.position.array, normal: g.attributes.normal.array }
    const { position, normal, starts } = concat(this.geos.map(attr))
    this.starts = starts
    const old = this.pick.geometry
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
    geo.computeBoundingSphere()
    this.pick.geometry = geo
    for (const m of this.draws.values()) {
      const was = m.geometry
      m.geometry = this.drawGeometry()
      for (const c of m.children) if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry = m.geometry
      m.userData.drawn = ''
      m.userData.edges = geo
      // frees the old buffers the draws shared
      was.dispose()
    }
    old.dispose()
    return true
  }

  get size(): number {
    return this.infos.length
  }
  get pieces(): readonly U[] {
    return this.infos
  }
  has(id: number): boolean {
    return this.index.has(id)
  }
  info(id: number): U | undefined {
    const i = this.index.get(id)
    return i === undefined ? undefined : this.infos[i]
  }

  /** How a piece is drawn now. */
  stateOf(id: number): PieceState | undefined {
    const i = this.index.get(id)
    return i === undefined ? undefined : this.states[i]
  }

  /** The piece under a triangle of the pick mesh; null for one not drawn. */
  itemAt(faceIndex: number): U | null {
    const i = partOf(this.starts, faceIndex)
    return i < 0 || this.states[i] === 'gone' ? null : this.infos[i]
  }

  /** Each piece in the state `stateOf` gives, which `keep` may hold at its last one while a ramp runs out: one draw per state in use. Returns the draws shown. */
  paint(stateOf: (u: U) => PieceState, keep: (was: PieceState, st: PieceState) => PieceState, v: Variants): THREE.Mesh[] {
    const n = this.infos.length
    const used = new Map<DrawKey, number>()
    for (let i = 0; i < n; i++) {
      const st = keep(this.states[i], stateOf(this.infos[i]))
      this.states[i] = st
      if (st === 'gone') continue
      const key = st ?? REST
      used.set(key, (used.get(key) ?? 0) + this.starts[i + 1] - this.starts[i])
    }
    const shown: THREE.Mesh[] = []
    // nothing landed yet: no draw
    if (!this.starts[n]) used.clear()
    for (const [key, m] of this.draws) if (!used.has(key)) m.visible = false
    const whole = used.size === 1 && !this.states.includes('gone')
    for (const [key, tris] of used) {
      const m = this.drawOf(key)
      this.indexFor(m, key, whole ? -1 : tris)
      m.visible = true
      setState(m, key === REST ? null : key, v)
      shown.push(m)
    }
    return shown
  }

  /** The draw of one state: the batch's buffers through its own index. */
  private drawOf(key: DrawKey): THREE.Mesh {
    let m = this.draws.get(key)
    if (!m) {
      m = this.placed(new THREE.Mesh(this.drawGeometry(), this.material))
      m.userData.edges = this.pick.geometry
      m.raycast = () => {}
      m.userData.pick = false
      this.draws.set(key, m)
      this.group.add(m)
    }
    return m
  }
  private drawGeometry(): THREE.BufferGeometry {
    const src = this.pick.geometry,
      g = new THREE.BufferGeometry()
    if (src.attributes.position) {
      g.setAttribute('position', src.attributes.position)
      g.setAttribute('normal', src.attributes.normal)
      g.boundingSphere = src.boundingSphere
    }
    return g
  }
  /** The draw's index: the triangles of the pieces in its state, none for every triangle; made again only when its pieces change. */
  private indexFor(m: THREE.Mesh, key: DrawKey, tris: number) {
    const sig = tris < 0 ? 'all' : this.states.map(s => (s === key || (s === null && key === REST) ? 1 : 0)).join('')
    if (m.userData.drawn === sig) return
    m.userData.drawn = sig
    if (tris < 0) {
      m.geometry.setIndex(null)
      return
    }
    const out = new Uint32Array(tris * 3)
    let k = 0
    for (let i = 0; i < this.infos.length; i++) {
      if ((this.states[i] ?? REST) !== key) continue
      for (let v = this.starts[i] * 3; v < this.starts[i + 1] * 3; v++) out[k++] = v
    }
    m.geometry.setIndex(new THREE.BufferAttribute(out, 1))
  }

  /** A piece's own mesh where the batch draws it, built on first use and never drawn: what an outline or a drag's ghost copies. */
  own(id: number): THREE.Mesh | null {
    let m = this.owned.get(id)
    if (m) return m
    const i = this.index.get(id)
    const geo = i === undefined ? null : this.geos[i]
    if (!geo) return null
    m = this.placed(new THREE.Mesh(geo, this.material))
    m.visible = false
    m.userData = { ...this.infos[i!], base: this.material }
    this.group.add(m)
    m.updateWorldMatrix(true, false)
    this.owned.set(id, m)
    return m
  }

  /** A mesh set where the batch draws: its height, stretch and render order. */
  placed<M extends THREE.Mesh>(m: M): M {
    m.position.z = this.place.z
    m.scale.z = this.place.scale
    m.renderOrder = this.place.order
    m.matrixAutoUpdate = false
    m.updateMatrix()
    return m
  }

  /** Its draws, own meshes and pick mesh out of the group, their buffers freed; the pieces' geometries are the caller's. */
  dispose() {
    for (const m of this.draws.values()) {
      m.geometry.dispose()
      m.removeFromParent()
    }
    for (const m of this.owned.values()) m.removeFromParent()
    this.pick.geometry.dispose()
    this.pick.removeFromParent()
  }
}
