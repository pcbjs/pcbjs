/** Scalar PBR properties; omitted fields use glTF defaults. Textures are not represented. */
export interface MeshMaterial {
  metalness?: number
  roughness?: number
  opacity?: number
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'
  alphaCutoff?: number
  doubleSided?: boolean
  /** Linear RGB emission factors, each from 0 to 1. */
  emissive?: [number, number, number]
  name?: string
}

/** Validate and order material properties for deterministic serialization and merging. */
export function normalizeMaterial(value: unknown): MeshMaterial {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('model material must be an object')
  const v = value as Record<string, unknown>
  const out: MeshMaterial = {}
  for (const key of ['metalness', 'roughness', 'opacity', 'alphaCutoff'] as const) {
    const n = v[key]
    if (n === undefined) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (key !== 'alphaCutoff' && n > 1)) throw new Error(`model material ${key} is invalid`)
    out[key] = n
  }
  if (v.alphaMode !== undefined) {
    if (v.alphaMode !== 'OPAQUE' && v.alphaMode !== 'MASK' && v.alphaMode !== 'BLEND') throw new Error('model material alphaMode is invalid')
    out.alphaMode = v.alphaMode
  }
  if (v.doubleSided !== undefined) {
    if (typeof v.doubleSided !== 'boolean') throw new Error('model material doubleSided is invalid')
    out.doubleSided = v.doubleSided
  }
  if (v.emissive !== undefined) {
    const e = v.emissive
    if (!Array.isArray(e) || e.length !== 3 || [0, 1, 2].some(i => typeof e[i] !== 'number' || !Number.isFinite(e[i]) || e[i] < 0 || e[i] > 1))
      throw new Error('model material emissive is invalid')
    out.emissive = [...e] as [number, number, number]
  }
  if (v.name !== undefined) {
    if (typeof v.name !== 'string') throw new Error('model material name is invalid')
    out.name = v.name
  }
  return out
}

/** One triangulated mesh: `positions` and `normals` hold x, y, z per vertex, `indices` three per triangle, `color` linear RGB 0 to 1. */
export interface StepMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  color: [number, number, number]
  /** Absent for legacy colour-only models, whose material the renderer infers. */
  material?: MeshMaterial
}

/** A converted model: meshes in mm, in the frame the file was drawn in. */
export interface StepModel {
  meshes: StepMesh[]
}

/** The triangulation tolerances handed to OpenCascade. */
export interface StepOptions {
  /** the largest distance in mm between a curved surface and its triangles, default 0.02 */
  linearDeflection?: number
  /** the largest angle in radians between neighbouring triangles on a curved surface, default 0.3 */
  angularDeflection?: number
}

// a 2 mm pin gets at least 21 sides, round at any zoom, while a flat face stays two triangles
export const DEFAULT_OPTIONS: Required<StepOptions> = Object.freeze({ linearDeflection: 0.02, angularDeflection: 0.3 })

/** The grey a face without a colour gets, linear RGB. */
export const DEFAULT_COLOR: [number, number, number] = [0.5, 0.5, 0.52]

export function bounds(model: StepModel): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity],
    max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const m of model.meshes) {
    const p = m.positions
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k]
        if (p[i + k] > max[k]) max[k] = p[i + k]
      }
  }
  return { min, max }
}
