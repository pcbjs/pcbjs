import type { StepModel } from './mesh.js'

export type MeshIssueCode = 'empty' | 'array-length' | 'nonfinite-position' | 'nonfinite-normal' | 'zero-normal' | 'index-range' | 'degenerate' | 'winding'

export interface MeshIssue {
  /** Zero-based mesh index, or -1 when the model has no meshes. */
  mesh: number
  code: MeshIssueCode
  count: number
}

export interface MeshValidation {
  triangles: number
  issues: MeshIssue[]
}

/** Checks triangle data and orientation consistency; does not repair geometry or prove closed solids. */
export function validateMesh(model: StepModel): MeshValidation {
  const issues: MeshIssue[] = []
  let triangles = 0
  if (!model.meshes.length) issues.push({ mesh: -1, code: 'empty', count: 1 })
  model.meshes.forEach((m, mesh) => {
    const counts = new Map<MeshIssueCode, number>()
    const add = (code: MeshIssueCode) => counts.set(code, (counts.get(code) ?? 0) + 1)
    const p = m.positions,
      n = m.normals,
      ix = m.indices
    const vertices = Math.floor(p.length / 3)
    if (!vertices || !ix.length) add('empty')
    if (p.length % 3 || n.length !== p.length || ix.length % 3) add('array-length')
    for (let v = 0; v < vertices; v++) {
      const o = v * 3
      if (![p[o], p[o + 1], p[o + 2]].every(Number.isFinite)) add('nonfinite-position')
      if (![n[o], n[o + 1], n[o + 2]].every(Number.isFinite)) add('nonfinite-normal')
      else if (Math.hypot(n[o], n[o + 1], n[o + 2]) < 1e-12) add('zero-normal')
    }
    for (let t = 0; t + 2 < ix.length; t += 3) {
      triangles++
      const ids = [ix[t], ix[t + 1], ix[t + 2]]
      if (ids.some(i => !Number.isInteger(i) || i < 0 || i >= vertices)) {
        add('index-range')
        continue
      }
      const [a, b, c] = ids.map(i => i * 3)
      const ux = p[b] - p[a],
        uy = p[b + 1] - p[a + 1],
        uz = p[b + 2] - p[a + 2]
      const vx = p[c] - p[a],
        vy = p[c + 1] - p[a + 1],
        vz = p[c + 2] - p[a + 2]
      const x = uy * vz - uz * vy,
        y = uz * vx - ux * vz,
        z = ux * vy - uy * vx
      const area = Math.hypot(x, y, z)
      if (!Number.isFinite(area)) continue
      if (area <= 1e-12 * Math.max(Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz), 1e-12)) {
        add('degenerate')
        continue
      }
      const nx = n[a] + n[b] + n[c],
        ny = n[a + 1] + n[b + 1] + n[c + 1],
        nz = n[a + 2] + n[b + 2] + n[c + 2]
      if (x * nx + y * ny + z * nz < -1e-4 * area * Math.hypot(nx, ny, nz)) add('winding')
    }
    for (const [code, count] of counts) issues.push({ mesh, code, count })
  })
  return { triangles, issues }
}
