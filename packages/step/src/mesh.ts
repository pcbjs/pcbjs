/** One triangulated mesh: `positions` and `normals` hold x, y, z per vertex, `indices` three per triangle, `color` linear RGB 0 to 1. */
export interface StepMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  color: [number, number, number]
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
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const m of model.meshes) {
    const p = m.positions
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { if (p[i + k] < min[k]) min[k] = p[i + k]; if (p[i + k] > max[k]) max[k] = p[i + k] }
  }
  return { min, max }
}
