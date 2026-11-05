import type { MeshMaterial, StepModel } from '@pcbjs/step'
import { normalizeMaterial } from '@pcbjs/step/internal/mesh'
import { Gltf, type Material } from './gltf.js'

/** Explicit PBR when present; legacy colour-only models retain the metal/plastic heuristic. */
export function modelMaterial(color: [number, number, number], m?: MeshMaterial): Material {
  if (m) m = normalizeMaterial(m)
  if (m)
    return {
      name: m.name ?? 'model',
      color,
      metal: m.metalness ?? 1,
      rough: m.roughness ?? 1,
      alpha: m.opacity ?? 1,
      alphaMode: m.alphaMode ?? 'OPAQUE',
      alphaCutoff: m.alphaCutoff,
      doubleSided: m.doubleSided,
      emissive: m.emissive,
    }
  const [r, g, b] = color,
    max = Math.max(...color),
    min = Math.min(...color)
  const l = (max + min) / 2,
    d = max - min
  const s = d === 0 ? 0 : l <= 0.5 ? d / (max + min) : d / (2 - max - min)
  const h = d === 0 ? 0 : (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6
  const metal = l > 0.25 && (s < 0.15 || (h > 0.08 && h < 0.17 && s > 0.3))
  return { name: 'model', color, metal: metal ? 0.7 : 0.05, rough: metal ? 0.35 : 0.6 }
}

/** A model in right-handed mm, Z up, as a glTF 2.0 binary in metres, Y up. */
export function modelGlb(model: StepModel, name = 'model'): Uint8Array {
  const g = new Gltf()
  const mesh = g.mesh(
    name,
    model.meshes.map(m => ({
      positions: m.positions,
      normals: m.normals,
      indices: m.indices,
      material: g.material(modelMaterial(m.color, m.material)),
    })),
  )
  const root = g.node({ name, ...(mesh === null ? {} : { mesh }), matrix: [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1] })
  return g.glb([root])
}
