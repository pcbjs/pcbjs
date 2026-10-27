// references.md; the cli runs referenceMesh in Node and caches it as .pcbjs/models/boards/<hash>.bin; nothing runs at module scope
import * as THREE from 'three'
import type { SiteData, SiteFootprint } from '@pcbjs/core/site-data'
import type { SiteReference } from '@pcbjs/core/reference'
import { meshFromBinary } from '@pcbjs/step/binary'
import { stepMatrix } from '@pcbjs/step/place'
import { flatten, packDrills, runJob, type GeoJob } from './geometry'
import { copperSlices, maskThickness, SILK } from './stack'
import { getModel } from '../models'
import { modelChoice } from '../models/choice'

/** One mesh of the binary: positions, normals and indices in mm, a linear colour. As @pcbjs/step's StepMesh. */
export interface RefMesh { positions: Float32Array; normals: Float32Array; indices: Uint32Array; color: [number, number, number] }

const linear = (hex: string): [number, number, number] => { const c = new THREE.Color(hex); return [c.r, c.g, c.b] }
const PALETTE = { slab: '#3d6e4a', copper: '#c9a64e', silk: '#f2f2f2' }

class Sink {
  private by = new Map<string, { color: [number, number, number]; pos: number[]; nor: number[] }>()
  /** `face` keeps only the triangles facing up or down, for copper and silk whose 35 µm walls a reference never shows */
  add(color: [number, number, number], pos: ArrayLike<number>, nor: ArrayLike<number>, m?: THREE.Matrix4, index?: ArrayLike<number> | null, face?: 1 | -1) {
    const key = color.map(c => c.toFixed(3)).join()
    let g = this.by.get(key)
    if (!g) this.by.set(key, g = { color, pos: [], nor: [] })
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null
    const v = new THREE.Vector3(), n = new THREE.Vector3()
    const count = index ? index.length : pos.length / 3
    for (let k = 0; k < count; k++) {
      const i = index ? index[k] : k
      if (face && k % 3 === 0) {
        // a triangle's corners share its face normal in the extrusions: skip the three when it faces the wrong way
        if ((nor[i * 3 + 2] ?? 0) * face < 0.5) { k += 2; continue }
      }
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); n.set(nor[i * 3] ?? 0, nor[i * 3 + 1] ?? 0, nor[i * 3 + 2] ?? 1)
      if (m) { v.applyMatrix4(m); n.applyMatrix3(nm!).normalize() }
      g.pos.push(v.x, v.y, v.z); g.nor.push(n.x, n.y, n.z)
    }
  }
  /** the meshes, one per colour, corners that share a position and a normal merged */
  meshes(): RefMesh[] {
    return [...this.by.values()].filter(g => g.pos.length).map(g => {
      const seen = new Map<string, number>(), pos: number[] = [], nor: number[] = [], idx: number[] = []
      for (let i = 0; i < g.pos.length; i += 3) {
        const key = `${Math.round(g.pos[i] * 1e4)},${Math.round(g.pos[i + 1] * 1e4)},${Math.round(g.pos[i + 2] * 1e4)},${Math.round(g.nor[i] * 50)},${Math.round(g.nor[i + 1] * 50)},${Math.round(g.nor[i + 2] * 50)}`
        let at = seen.get(key)
        if (at === undefined) { at = pos.length / 3; seen.set(key, at); pos.push(g.pos[i], g.pos[i + 1], g.pos[i + 2]); nor.push(g.nor[i], g.nor[i + 1], g.nor[i + 2]) }
        idx.push(at)
      }
      return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), color: g.color }
    })
  }
}

/** An extruded job's triangles from z0 to z1: the unit jobs span z 0 to 1. */
function addJob(sink: Sink, color: [number, number, number], job: GeoJob, z0: number, z1: number, face?: 1 | -1) {
  const r = runJob(job)
  if (!r.position) return
  const p = r.position.slice()
  for (let i = 2; i < p.length; i += 3) p[i] = z0 + p[i] * (z1 - z0)
  sink.add(color, p, r.normal!, undefined, null, face)
}

/** The whole board as meshes in its own frame: x board x, y board -y, z up from its bottom face. */
export function referenceMesh(b: SiteData, stepMesh: (hash: string) => { meshes: RefMesh[] } | null): { meshes: RefMesh[]; board: number } {
  const sink = new Sink(), bodies = new Sink()
  const slices = copperSlices(b)
  const outline = flatten(b.outline.slice(0, 1).concat(b.outline.slice(1)))
  const drills = packDrills(b.drills)
  if (b.outline.length) addJob(sink, linear(PALETTE.slab), { kind: 'slab', key: 'slab', outline, drills, depth: b.thickness }, 0, b.thickness)
  const mask = { F: maskThickness(b, 'F'), B: maskThickness(b, 'B') }
  for (const it of b.items ?? []) for (const layer of it.layers) {
    let z: [number, number] | null = null, color = PALETTE.copper
    if (layer === 'F.Cu' || layer === 'B.Cu') { const s = slices.get(layer)!; z = [s.z0, s.z1] }
    else if (layer === 'F.SilkS') { const s = slices.get('F.Cu')!; z = [s.z1 + mask.F, s.z1 + mask.F + SILK]; color = PALETTE.silk }
    else if (layer === 'B.SilkS') { const s = slices.get('B.Cu')!; z = [s.z0 - mask.B - SILK, s.z0 - mask.B]; color = PALETTE.silk }
    // only the face that looks away from the board: the outer side of the stack
    if (z) addJob(sink, linear(color), { kind: 'unit', key: '', rings: flatten(it.rings) }, z[0], z[1], layer[0] === 'F' ? 1 : -1)
  }
  for (const fp of b.footprints) addBody(bodies, fp, b, slices, stepMesh)
  // the board's own meshes first, so the view can leave the bodies out
  const own = sink.meshes()
  return { meshes: [...own, ...bodies.meshes()], board: own.length }
}

function addBody(sink: Sink, fp: SiteFootprint, b: SiteData, slices: ReturnType<typeof copperSlices>, stepMesh: (hash: string) => { meshes: RefMesh[] } | null) {
  const back = fp.side === 'B'
  const face = back ? slices.get('B.Cu')!.z0 : slices.get('F.Cu')!.z1
  const file = fp.step?.mesh ? stepMesh(fp.step.mesh) : null
  if (file && fp.step) {
    const m = new THREE.Matrix4().fromArray(stepMatrix(fp, fp.step.transform, face))
    for (const q of file.meshes) sink.add(q.color, q.positions, q.normals, m, q.indices)
    return
  }
  const spec = modelChoice(fp)
  if (!spec) return
  // the printed code is a canvas texture, which Node has not: the reference draws the parts unmarked
  const model = getModel(spec, { value: '', fields: {}, body: fp.body, height: fp.height, thickness: b.thickness })
  const root = new THREE.Group()
  root.position.set(fp.body.x, -fp.body.y, face)
  root.rotation.z = (fp.body.rot * Math.PI) / 180
  if (back) { const flip = new THREE.Group(); flip.rotation.y = Math.PI; flip.add(model); root.add(flip) } else root.add(model)
  root.updateMatrixWorld(true)
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry as THREE.BufferGeometry
    const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal')
    if (!pos) return
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    if (mat?.transparent && mat.opacity < 0.2) return
    const c = mat?.color ?? new THREE.Color('#888888')
    sink.add([c.r, c.g, c.b], pos.array, nor ? nor.array : new Float32Array(pos.count * 3), mesh.matrixWorld, geo.getIndex()?.array ?? null)
  })
}

/** Where a reference's mesh is: the dev endpoint, or models/boards/<hash>.bin beside the built site. */
export function referenceUrl(hash: string, dev: boolean, assetUrl: (p: string) => string): string {
  return dev ? `/__pcbjs/model/boards/${hash}` : assetUrl(`models/boards/${hash}.bin`)
}

async function load(url: string): Promise<{ geo: THREE.BufferGeometry; color: THREE.Color }[]> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status}`)
  return meshFromBinary(await r.arrayBuffer()).meshes.map(m => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
    geo.computeBoundingSphere()
    return { geo, color: new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]) }
  })
}
const loads = new Map<string, Promise<{ geo: THREE.BufferGeometry; color: THREE.Color }[]>>()

/** A reference as one translucent group placed by its transform; null with one warning when the mesh does not load. */
export async function referenceGroup(ref: SiteReference, url: string): Promise<THREE.Group | null> {
  let p = loads.get(url)
  if (!p) { p = load(url); loads.set(url, p); p.catch(() => loads.delete(url)) }
  let parts: { geo: THREE.BufferGeometry; color: THREE.Color }[]
  try { parts = await p } catch (e) { console.warn(`3D view: reference ${ref.name} did not load: ${(e as Error).message}`); return null }
  const tint = new THREE.Color(ref.color)
  const g = new THREE.Group()
  g.name = `reference:${ref.name}`
  for (const [i, q] of parts.entries()) {
    if (!ref.bodies && ref.split !== undefined && i >= ref.split) break
    const mat = new THREE.MeshStandardMaterial({ color: q.color.clone().lerp(tint, 0.5), roughness: 0.6, metalness: 0.1, transparent: true, opacity: ref.opacity, depthWrite: false })
    const m = new THREE.Mesh(q.geo, mat)
    m.userData.pick = false
    m.raycast = () => {}
    g.add(m)
  }
  g.matrixAutoUpdate = false
  g.matrix.fromArray(ref.transform)
  g.userData.pick = false
  return g
}
