// three.js geometry flattened into @pcbjs/step meshes, one per colour; nothing runs at module scope
import * as THREE from 'three'
import type { StepMesh } from '@pcbjs/step/internal/mesh'

export type Rgb = [number, number, number]

/** A colour as the key that merges its triangles. */
export const colorKey = (c: Rgb): string => c.map(v => v.toFixed(3)).join()

export class Sink {
  private by = new Map<string, { color: Rgb; pos: number[]; nor: number[] }>()
  /** `face` keeps only the triangles facing up or down, for copper and silk whose 35 µm walls a reference never shows */
  add(color: Rgb, pos: ArrayLike<number>, nor: ArrayLike<number>, m?: THREE.Matrix4, index?: ArrayLike<number> | null, face?: 1 | -1) {
    const key = colorKey(color)
    let g = this.by.get(key)
    if (!g) this.by.set(key, (g = { color, pos: [], nor: [] }))
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null
    const v = new THREE.Vector3(),
      n = new THREE.Vector3()
    const count = index ? index.length : pos.length / 3
    for (let k = 0; k < count; k++) {
      const i = index ? index[k] : k
      if (face && k % 3 === 0) {
        // a triangle's corners share its face normal in the extrusions: skip the three when it faces the wrong way
        if ((nor[i * 3 + 2] ?? 0) * face < 0.5) {
          k += 2
          continue
        }
      }
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      n.set(nor[i * 3] ?? 0, nor[i * 3 + 1] ?? 0, nor[i * 3 + 2] ?? 1)
      if (m) {
        v.applyMatrix4(m)
        n.applyMatrix3(nm!).normalize()
      }
      g.pos.push(v.x, v.y, v.z)
      g.nor.push(n.x, n.y, n.z)
    }
  }
  /** Every mesh under `root`, placed by its world matrix and coloured by its material. */
  addObject(root: THREE.Object3D) {
    root.updateMatrixWorld(true)
    root.traverse(o => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const geo = mesh.geometry as THREE.BufferGeometry
      const pos = geo.getAttribute('position'),
        nor = geo.getAttribute('normal')
      if (!pos) return
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
      const c = mat?.color ?? new THREE.Color('#888888')
      this.add([c.r, c.g, c.b], pos.array, nor ? nor.array : new Float32Array(pos.count * 3), mesh.matrixWorld, geo.getIndex()?.array ?? null)
    })
  }
  /** the meshes, one per colour, corners that share a position and a normal merged */
  meshes(): StepMesh[] {
    return [...this.by.values()]
      .filter(g => g.pos.length)
      .map(g => {
        const seen = new Map<string, number>(),
          pos: number[] = [],
          nor: number[] = [],
          idx: number[] = []
        for (let i = 0; i < g.pos.length; i += 3) {
          const key = `${Math.round(g.pos[i] * 1e4)},${Math.round(g.pos[i + 1] * 1e4)},${Math.round(g.pos[i + 2] * 1e4)},${Math.round(g.nor[i] * 50)},${Math.round(g.nor[i + 1] * 50)},${Math.round(g.nor[i + 2] * 50)}`
          let at = seen.get(key)
          if (at === undefined) {
            at = pos.length / 3
            seen.set(key, at)
            pos.push(g.pos[i], g.pos[i + 1], g.pos[i + 2])
            nor.push(g.nor[i], g.nor[i + 1], g.nor[i + 2])
          }
          idx.push(at)
        }
        return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), color: g.color }
      })
  }
}
