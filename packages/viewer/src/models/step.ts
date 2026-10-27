// fetched once per hash and shared by every part using the file; nothing runs at module scope, so the prerender can import it
import * as THREE from 'three'
import { meshFromBinary } from '@pcbjs/step/binary'
import type { SiteStep } from '@pcbjs/core/site-data'
import { appBase, assetUrl } from '../variants'
import { stepMatrix, type StepPlacement } from '../scene/step-place'
import { issueOutline } from './outline'

const protos = new Map<string, Promise<THREE.Group>>()
const warned = new Set<string>()
const materials = new Map<string, THREE.MeshStandardMaterial>()

/** Where the mesh of a hash is: the dev endpoint, or models/<hash>.bin beside the built site. */
export function meshUrl(hash: string, dev: boolean): string {
  if (dev) return `/__pcbjs/model/${hash}`
  return assetUrl(`models/${hash}.bin`, appBase(import.meta.env?.BASE_URL ?? '/', typeof location !== 'undefined' ? location.pathname : '/'))
}

function material(c: [number, number, number]): THREE.MeshStandardMaterial {
  const key = c.map(v => v.toFixed(3)).join()
  let m = materials.get(key)
  if (!m) {
    // light greys and golds are the metal of pins and shells, the rest plastic
    const col = new THREE.Color().setRGB(c[0], c[1], c[2])
    const hsl = col.getHSL({ h: 0, s: 0, l: 0 })
    const metal = hsl.l > 0.25 && (hsl.s < 0.15 || (hsl.h > 0.08 && hsl.h < 0.17 && hsl.s > 0.3))
    m = new THREE.MeshStandardMaterial({ color: col, roughness: metal ? 0.35 : 0.6, metalness: metal ? 0.7 : 0.05 })
    materials.set(key, m)
  }
  return m
}

async function load(hash: string, dev: boolean): Promise<THREE.Group> {
  const r = await fetch(meshUrl(hash, dev))
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`.trim())
  const model = meshFromBinary(await r.arrayBuffer())
  const g = new THREE.Group()
  for (const m of model.meshes) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
    geo.computeBoundingSphere()
    g.add(new THREE.Mesh(geo, material(m.color)))
  }
  return g
}

/** Warn once per file that the 3D view draws the generated model for it. */
export function warnMissing(ref: string, step: SiteStep, why = 'not found') {
  if (warned.has(step.file)) return
  warned.add(step.file)
  console.warn(`3D view: model ${step.file} of ${ref} ${why}; drawing the generated model`)
}

/** The box of a group's meshes in the group's own frame. */
function localBox(g: THREE.Group): { min: [number, number, number]; max: [number, number, number] } {
  const box = new THREE.Box3()
  for (const m of g.children) if ((m as THREE.Mesh).isMesh) { const geo = (m as THREE.Mesh).geometry; geo.computeBoundingBox(); box.union(geo.boundingBox!) }
  return { min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] }
}

/** A clone of the cached meshes placed by footprint and model transform; null with one warning per file when it fails. */
export async function stepModel(ref: string, step: SiteStep, fp: StepPlacement, face: number, dev: boolean): Promise<THREE.Group | null> {
  if (!step.mesh) { warnMissing(ref, step); return null }
  let p = protos.get(step.mesh)
  if (!p) { p = load(step.mesh, dev); protos.set(step.mesh, p); p.catch(() => protos.delete(step.mesh!)) }
  let proto: THREE.Group
  try { proto = await p } catch (e) { warnMissing(ref, step, `did not load: ${(e as Error).message}`); return null }
  const g = proto.clone()
  if (step.issue) g.add(issueOutline(step.bounds ?? localBox(proto)))
  g.matrixAutoUpdate = false
  g.matrix.fromArray(stepMatrix(fp, step.transform, face))
  return g
}
