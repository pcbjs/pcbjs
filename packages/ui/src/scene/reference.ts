// references.md; the cli runs referenceMesh in Node and caches it as .pcbjs/models/boards/<hash>.bin; nothing runs at module scope
import * as THREE from 'three'
import type { SiteData, SiteFootprint } from '@pcbjs/core/site-data'
import type { SiteReference } from '@pcbjs/core/internal/reference'
import { shapeOf } from '@pcbjs/core/site-shapes'
import { meshFromBinary } from '@pcbjs/step/binary'
import { stepMatrix } from '@pcbjs/step/internal/place'
import type { MeshMaterial, StepMesh } from '@pcbjs/step/internal/mesh'
import { flatten, packDrills, runJob, type GeoJob } from '@pcbjs/export/internal/scene/geometry'
import { bodyFace, bodyMatrix, copperSlices, maskThickness, SILK } from '@pcbjs/export/internal/scene/stack'
import { Sink, type Rgb } from '../models/sink'

/** One mesh of the binary: positions, normals and indices in mm, a linear colour. As @pcbjs/step's StepMesh. */
export type RefMesh = StepMesh

const linear = (hex: string): Rgb => {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}
const PALETTE = { slab: '#3d6e4a', copper: '#c9a64e', silk: '#f2f2f2' }

/** An extruded job's triangles from z0 to z1: the unit jobs span z 0 to 1. */
function addJob(sink: Sink, color: Rgb, job: GeoJob, z0: number, z1: number, face?: 1 | -1) {
  const r = runJob(job)
  if (!r.position) return
  const p = r.position.slice()
  for (let i = 2; i < p.length; i += 3) p[i] = z0 + p[i] * (z1 - z0)
  sink.add(color, p, r.normal!, undefined, null, face)
}

/** The whole board as meshes in its own frame: x board x, y board -y, z up from its bottom face. */
/** `mesh` reads a part's mesh by its hash, a model file's or a generated body's, as the cli caches them. */
export function referenceMesh(b: SiteData, mesh: (hash: string) => { meshes: RefMesh[] } | null): { meshes: RefMesh[]; board: number } {
  const sink = new Sink(),
    bodies = new Sink()
  const slices = copperSlices(b)
  const outline = flatten(b.outline.slice(0, 1).concat(b.outline.slice(1)))
  const drills = packDrills(b.drills)
  if (b.outline.length) addJob(sink, linear(PALETTE.slab), { kind: 'slab', key: 'slab', outline, drills, depth: b.thickness }, 0, b.thickness)
  const mask = { F: maskThickness(b, 'F'), B: maskThickness(b, 'B') }
  for (const it of b.items ?? [])
    for (const layer of it.layers) {
      let z: [number, number] | null = null,
        color = PALETTE.copper
      if (layer === 'F.Cu' || layer === 'B.Cu') {
        const s = slices.get(layer)!
        z = [s.z0, s.z1]
      } else if (layer === 'F.SilkS') {
        const s = slices.get('F.Cu')!
        z = [s.z1 + mask.F, s.z1 + mask.F + SILK]
        color = PALETTE.silk
      } else if (layer === 'B.SilkS') {
        const s = slices.get('B.Cu')!
        z = [s.z0 - mask.B - SILK, s.z0 - mask.B]
        color = PALETTE.silk
      }
      // only the face that looks away from the board: the outer side of the stack
      if (z) addJob(sink, linear(color), { kind: 'unit', key: '', rings: flatten(shapeOf(b, it.id)) }, z[0], z[1], layer[0] === 'F' ? 1 : -1)
    }
  for (const fp of b.footprints) addBody(bodies, fp, bodyFace(slices, fp.side), mesh)
  // the board's own meshes first, so the view can leave the bodies out
  const own = sink.meshes()
  return { meshes: [...own, ...bodies.meshes()], board: own.length }
}

/** A part's model file, else its generated body; a part without either draws nothing. */
function addBody(sink: Sink, fp: SiteFootprint, face: number, mesh: (hash: string) => { meshes: RefMesh[] } | null) {
  const file = fp.step?.mesh ? mesh(fp.step.mesh) : null
  const made = !file && fp.mesh ? mesh(fp.mesh) : null
  const model = file ?? made
  if (!model) return
  const m = new THREE.Matrix4().fromArray(file ? stepMatrix(fp, fp.step!.transform, face) : bodyMatrix(fp, face))
  for (const q of model.meshes) sink.add(q.color, q.positions, q.normals, m, q.indices, undefined, q.material)
}

/** Where a reference's mesh is: the dev endpoint, or models/boards/<hash>.bin beside the built site. */
export function referenceUrl(hash: string, dev: boolean, assetUrl: (p: string) => string): string {
  return dev ? `/__pcbjs/model/boards/${hash}` : assetUrl(`models/boards/${hash}.bin`)
}

interface LoadedMesh {
  geo: THREE.BufferGeometry
  color: THREE.Color
  material?: MeshMaterial
}

async function load(url: string): Promise<LoadedMesh[]> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status}`)
  return meshFromBinary(await r.arrayBuffer()).meshes.map(m => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
    geo.computeBoundingSphere()
    return { geo, color: new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]), material: m.material }
  })
}
const loads = new Map<string, Promise<LoadedMesh[]>>()

/** A reference as one translucent group placed by its transform; null with one warning when the mesh does not load. */
export async function referenceGroup(ref: SiteReference, url: string): Promise<THREE.Group | null> {
  let p = loads.get(url)
  if (!p) {
    p = load(url)
    loads.set(url, p)
    p.catch(() => loads.delete(url))
  }
  let parts: LoadedMesh[]
  try {
    parts = await p
  } catch (e) {
    console.warn(`3D view: reference ${ref.name} did not load: ${(e as Error).message}`)
    return null
  }
  const tint = new THREE.Color(ref.color)
  const g = new THREE.Group()
  g.name = `reference:${ref.name}`
  for (const [i, q] of parts.entries()) {
    if (!ref.bodies && ref.split !== undefined && i >= ref.split) break
    const mat = new THREE.MeshStandardMaterial({
      color: q.color.clone().lerp(tint, 0.5),
      roughness: q.material ? (q.material.roughness ?? 1) : 0.6,
      metalness: q.material ? (q.material.metalness ?? 1) : 0.1,
      emissive: new THREE.Color().setRGB(...(q.material?.emissive ?? [0, 0, 0])),
      side: q.material?.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: true,
      opacity: ref.opacity,
      depthWrite: false,
    })
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
