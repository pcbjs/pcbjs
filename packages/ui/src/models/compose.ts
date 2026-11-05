import * as THREE from 'three'
import type { GeneratedSpec } from '@pcbjs/core'
import type { MeshMaterial, StepModel } from '@pcbjs/step'
import { normalizeMaterial } from '@pcbjs/step/internal/mesh'
import { box, chamferedBox, roundedBox } from './geom'
import { M, meshMaterial, stepMaterial } from './materials'
import { modelMeshes, type ModelCtx } from './index'
import { Sink } from './sink'

export type ModelMaterial = keyof typeof M | (MeshMaterial & { color: string })
type Vec3 = readonly [number, number, number]
type Quaternion = readonly [number, number, number, number]

/** Primitive dimensions and translations are millimetres in the right-handed model frame, Z up. */
export type ModelPart = (
  | { shape: 'box'; size: Vec3; radius?: number; chamfer?: number }
  | { shape: 'cylinder'; radius: number; height: number; segments?: number }
  | { shape: 'sphere'; radius: number; segments?: number }
  | { shape: 'generated'; spec: GeneratedSpec; context: ModelCtx }
) & { material?: ModelMaterial; translation?: Vec3; orientation?: Quaternion }

const positive = (n: number, name: string): number => {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive finite number`)
  return n
}

function vector(v: readonly number[], size: number, name: string): void {
  if (!Array.isArray(v) || v.length !== size || !Array.from(v).every(Number.isFinite)) throw new Error(`${name} must contain ${size} finite numbers`)
}

function transform(part: ModelPart): THREE.Matrix4 {
  const t = part.translation ?? [0, 0, 0],
    q = part.orientation ?? [0, 0, 0, 1]
  vector(t, 3, 'translation')
  vector(q, 4, 'orientation')
  const scale = Math.max(...q.map(Math.abs))
  if (scale === 0) throw new Error('orientation must be a nonzero quaternion [x, y, z, w]')
  const unit = new THREE.Quaternion(...(q.map(v => v / scale) as [number, number, number, number])).normalize()
  return new THREE.Matrix4().compose(new THREE.Vector3(...t), unit, new THREE.Vector3(1, 1, 1))
}

function material(value: ModelMaterial): THREE.MeshStandardMaterial {
  if (typeof value === 'string') {
    if (!Object.hasOwn(M, value)) throw new Error(`unknown model material ${value}`)
    return M[value]
  }
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.color)) throw new Error('model material color must be a #RGB or #RRGGBB hex colour')
  const c = new THREE.Color(value.color)
  return stepMaterial([c.r, c.g, c.b], normalizeMaterial({ metalness: 0, roughness: 0.6, ...value }))
}

function geometry(part: Exclude<ModelPart, { shape: 'generated' }>): THREE.BufferGeometry {
  if (part.shape === 'box') {
    vector(part.size, 3, 'box size')
    const [w, h, d] = part.size.map(n => positive(n, 'box size'))
    if (part.radius !== undefined && part.chamfer !== undefined) throw new Error('a box takes radius or chamfer, not both')
    if (part.radius !== undefined) return roundedBox(w, h, d, positive(part.radius, 'radius'))
    if (part.chamfer !== undefined) return chamferedBox(w, h, d, positive(part.chamfer, 'chamfer'))
    return box(w, h, d)
  }
  const r = positive(part.radius, 'radius'),
    segments = part.segments ?? 32
  if (!Number.isInteger(segments) || segments < 8 || segments > 256) throw new Error('segments must be an integer from 8 to 256')
  if (part.shape === 'sphere') return new THREE.SphereGeometry(r, segments, Math.max(8, Math.ceil(segments / 2)))
  if (part.shape !== 'cylinder') throw new Error('unknown model primitive shape')
  const h = positive(part.height, 'height')
  const g = new THREE.CylinderGeometry(r, r, h, segments)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, h / 2)
  return g
}

function generated(part: Extract<ModelPart, { shape: 'generated' }>): StepModel {
  positive(part.context.height, 'generated height')
  positive(part.context.thickness, 'board thickness')
  if (!['chip', 'led', 'header', 'sot23', 'ic'].includes(part.spec.kind)) throw new Error('unknown generated model kind')
  const required = { chip: ['cap', 'height'], led: ['height'], header: ['pins', 'rows', 'pitch'], sot23: ['pins'], ic: ['w', 'h', 'height'] }
  const spec = part.spec as unknown as Record<string, unknown>
  for (const key of required[part.spec.kind]) positive(spec[key] as number, key)
  if (part.spec.kind === 'sot23' && ![3, 5, 6].includes(part.spec.pins)) throw new Error('SOT-23 pins must be 3, 5 or 6')
  if (part.spec.kind === 'chip' || part.spec.kind === 'led') vector(part.spec.body, 2, 'body')
  if (part.spec.kind === 'led') {
    if ('cap' in part.spec) positive(part.spec.cap, 'cap')
    else {
      positive(part.spec.window, 'window')
      vector(part.spec.lead, 2, 'lead')
    }
  }
  for (const [key, value] of Object.entries(part.spec)) {
    if (typeof value === 'number') positive(value, key)
    if (Array.isArray(value)) {
      vector(value, 2, key)
      value.forEach(n => positive(n, key))
    }
    if ((key === 'pins' || key === 'rows') && !Number.isInteger(value)) throw new Error(`${key} must be an integer`)
  }
  return modelMeshes(part.spec, part.context)
}

/** Compose custom bodies with the stdlib palette. Boxes/cylinders start at Z=0; spheres are centred. Rotation precedes translation. */
export function composeModel(parts: readonly ModelPart[]): StepModel {
  const sink = new Sink()
  for (const part of parts) {
    const matrix = transform(part)
    const mat = part.material === undefined && part.shape === 'generated' ? undefined : material(part.material ?? 'mould')
    if (part.shape === 'generated') {
      for (const m of generated(part).meshes) {
        const color = mat ? (mat.color.toArray() as [number, number, number]) : m.color
        sink.add(color, m.positions, m.normals, matrix, m.indices, undefined, mat ? meshMaterial(mat) : m.material)
      }
    } else {
      const g = geometry(part)
      const p = g.getAttribute('position'),
        n = g.getAttribute('normal')
      sink.add(mat!.color.toArray() as [number, number, number], p.array, n.array, matrix, g.getIndex()?.array, undefined, meshMaterial(mat!))
      g.dispose()
    }
  }
  return { meshes: sink.meshes() }
}
