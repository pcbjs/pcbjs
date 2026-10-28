import type { StepMesh } from './mesh.js'

/** Vertex normals averaged over the triangles that share each vertex. */
export function flatNormals(p: Float32Array, ix: Uint32Array): Float32Array {
  const n = new Float32Array(p.length)
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3,
      b = ix[t + 1] * 3,
      c = ix[t + 2] * 3
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx
    for (const i of [a, b, c]) {
      n[i] += nx
      n[i + 1] += ny
      n[i + 2] += nz
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1
    n[i] /= l
    n[i + 1] /= l
    n[i + 2] /= l
  }
  return n
}

/** Normals smoothed only across edges whose faces meet at less than `crease` radians, as VRML's creaseAngle. */
export function creaseMesh(p: ArrayLike<number>, ix: ArrayLike<number>, crease = 0.5): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const tris = ix.length / 3
  const face = new Float64Array(tris * 3),
    unit = new Float64Array(tris * 3)
  const byPos = new Map<string, number[]>()
  const key = (v: number) => `${Math.round(p[v * 3] * 1e4)},${Math.round(p[v * 3 + 1] * 1e4)},${Math.round(p[v * 3 + 2] * 1e4)}`
  for (let t = 0; t < tris; t++) {
    const a = ix[t * 3],
      b = ix[t * 3 + 1],
      c = ix[t * 3 + 2]
    const ux = p[b * 3] - p[a * 3],
      uy = p[b * 3 + 1] - p[a * 3 + 1],
      uz = p[b * 3 + 2] - p[a * 3 + 2]
    const vx = p[c * 3] - p[a * 3],
      vy = p[c * 3 + 1] - p[a * 3 + 1],
      vz = p[c * 3 + 2] - p[a * 3 + 2]
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      l = Math.hypot(nx, ny, nz) || 1
    face[t * 3] = nx
    face[t * 3 + 1] = ny
    face[t * 3 + 2] = nz
    unit[t * 3] = nx / l
    unit[t * 3 + 1] = ny / l
    unit[t * 3 + 2] = nz / l
    for (const v of [a, b, c]) {
      const k = key(v)
      let list = byPos.get(k)
      if (!list) byPos.set(k, (list = []))
      list.push(t)
    }
  }
  const cos = Math.cos(crease)
  const positions = new Float32Array(tris * 9),
    normals = new Float32Array(tris * 9),
    indices = new Uint32Array(tris * 3)
  for (let t = 0; t < tris; t++)
    for (let k = 0; k < 3; k++) {
      const v = ix[t * 3 + k],
        o = (t * 3 + k) * 3
      positions[o] = p[v * 3]
      positions[o + 1] = p[v * 3 + 1]
      positions[o + 2] = p[v * 3 + 2]
      let nx = 0,
        ny = 0,
        nz = 0
      for (const s of byPos.get(key(v))!) {
        if (unit[s * 3] * unit[t * 3] + unit[s * 3 + 1] * unit[t * 3 + 1] + unit[s * 3 + 2] * unit[t * 3 + 2] < cos) continue
        nx += face[s * 3]
        ny += face[s * 3 + 1]
        nz += face[s * 3 + 2]
      }
      const l = Math.hypot(nx, ny, nz) || 1
      normals[o] = nx / l
      normals[o + 1] = ny / l
      normals[o + 2] = nz / l
      indices[t * 3 + k] = t * 3 + k
    }
  return { positions, normals, indices }
}

/** The meshes merged per colour, in the order each colour first appears; empty meshes dropped. */
export function groupByColor(meshes: StepMesh[]): StepMesh[] {
  const groups = new Map<string, StepMesh[]>()
  for (const m of meshes) {
    if (!m.indices.length) continue
    const k = m.color.map(c => c.toFixed(4)).join()
    const g = groups.get(k)
    if (g) g.push(m)
    else groups.set(k, [m])
  }
  return [...groups.values()].map(g => {
    if (g.length === 1) return g[0]
    const nv = g.reduce((a, m) => a + m.positions.length, 0),
      ni = g.reduce((a, m) => a + m.indices.length, 0)
    const positions = new Float32Array(nv),
      normals = new Float32Array(nv),
      indices = new Uint32Array(ni)
    let pv = 0,
      pi = 0
    for (const m of g) {
      positions.set(m.positions, pv)
      normals.set(m.normals, pv)
      for (let i = 0; i < m.indices.length; i++) indices[pi + i] = m.indices[i] + pv / 3
      pv += m.positions.length
      pi += m.indices.length
    }
    return { positions, normals, indices, color: g[0].color }
  })
}

/** An sRGB colour component, as VRML and STEP files give them, in linear light. */
export const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
