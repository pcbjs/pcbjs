// A ray test for a mesh of many triangles: its triangles bucketed on a grid over the mesh's own x and y, and a ray walked cell by cell
// through the box it crosses, so a pick tests the few triangles under the pointer instead of every one; a board's meshes are flat in z.
import * as THREE from 'three'

/** triangles a grid cell holds on average */
const PER_CELL = 8
/** cells per side at most */
const MAX_SIDE = 256

export interface RayIndex {
  geometry: THREE.BufferGeometry
  box: THREE.Box3
  nx: number
  ny: number
  cell: [number, number]
  /** each cell's first entry in `tris`, nx * ny + 1 of them */
  starts: Uint32Array
  tris: Uint32Array
}

const triOf = (g: THREE.BufferGeometry) => {
  const index = g.index
  const n = index ? index.count / 3 : g.attributes.position.count / 3
  return { n, at: (t: number, k: number) => (index ? index.getX(3 * t + k) : 3 * t + k) }
}

/** The grid of a geometry's triangles over its own x and y. */
export function buildIndex(geometry: THREE.BufferGeometry): RayIndex {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!.clone()
  const pos = geometry.attributes.position
  const { n, at } = triOf(geometry)
  const w = Math.max(box.max.x - box.min.x, 1e-6),
    h = Math.max(box.max.y - box.min.y, 1e-6)
  const cells = Math.max(1, n / PER_CELL)
  const nx = Math.max(1, Math.min(MAX_SIDE, Math.round(Math.sqrt((cells * w) / h)))),
    ny = Math.max(1, Math.min(MAX_SIDE, Math.round(cells / nx)))
  const cell: [number, number] = [w / nx, h / ny]
  const span = (t: number) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (let k = 0; k < 3; k++) {
      const v = at(t, k)
      const x = pos.getX(v),
        y = pos.getY(v)
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - box.min.x) / cell[0])))
    const cy = (y: number) => Math.min(ny - 1, Math.max(0, Math.floor((y - box.min.y) / cell[1])))
    return [cx(x0), cy(y0), cx(x1), cy(y1)]
  }
  const counts = new Uint32Array(nx * ny + 1)
  const spans = new Int32Array(n * 4)
  for (let t = 0; t < n; t++) {
    const s = span(t)
    spans.set(s, 4 * t)
    for (let j = s[1]; j <= s[3]; j++) for (let i = s[0]; i <= s[2]; i++) counts[j * nx + i + 1]++
  }
  for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1]
  const starts = counts.slice()
  const fill = counts.slice()
  const tris = new Uint32Array(starts[nx * ny])
  for (let t = 0; t < n; t++) for (let j = spans[4 * t + 1]; j <= spans[4 * t + 3]; j++) for (let i = spans[4 * t]; i <= spans[4 * t + 2]; i++) tris[fill[j * nx + i]++] = t
  return { geometry, box, nx, ny, cell, starts, tris }
}

/** Where a ray is inside a box, its parameters at entry and exit; null when it misses. */
export function boxSpan(o: THREE.Vector3, d: THREE.Vector3, box: THREE.Box3): [number, number] | null {
  let t0 = 0,
    t1 = Infinity
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < box.min[k] || o[k] > box.max[k]) return null
      continue
    }
    let a = (box.min[k] - o[k]) / d[k],
      b = (box.max[k] - o[k]) / d[k]
    if (a > b) [a, b] = [b, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
    if (t0 > t1) return null
  }
  return [t0, t1]
}

const inv = new THREE.Matrix4()
const local = new THREE.Ray()
const enter = new THREE.Vector3(),
  exit = new THREE.Vector3(),
  hit = new THREE.Vector3(),
  a = new THREE.Vector3(),
  b = new THREE.Vector3(),
  c = new THREE.Vector3()

/** The cells a 2D segment crosses, in order, each once. */
export function cellsAlong(ix: RayIndex, x0: number, y0: number, x1: number, y1: number, visit: (cell: number) => void) {
  const { nx, ny, cell, box } = ix
  const gx = (x0 - box.min.x) / cell[0],
    gy = (y0 - box.min.y) / cell[1]
  const ex = (x1 - box.min.x) / cell[0],
    ey = (y1 - box.min.y) / cell[1]
  let i = Math.min(nx - 1, Math.max(0, Math.floor(gx))),
    j = Math.min(ny - 1, Math.max(0, Math.floor(gy)))
  const ie = Math.min(nx - 1, Math.max(0, Math.floor(ex))),
    je = Math.min(ny - 1, Math.max(0, Math.floor(ey)))
  const dx = ex - gx,
    dy = ey - gy
  const si = Math.sign(dx),
    sj = Math.sign(dy)
  const tdx = dx ? Math.abs(1 / dx) : Infinity,
    tdy = dy ? Math.abs(1 / dy) : Infinity
  let tx = dx ? (si > 0 ? i + 1 - gx : gx - i) * tdx : Infinity,
    ty = dy ? (sj > 0 ? j + 1 - gy : gy - j) * tdy : Infinity
  for (let guard = nx + ny + 2; guard > 0; guard--) {
    visit(j * nx + i)
    if (i === ie && j === je) return
    if (tx < ty) {
      i += si
      tx += tdx
    } else {
      j += sj
      ty += tdy
    }
    if (i < 0 || j < 0 || i >= nx || j >= ny) return
  }
}

/** Replace a mesh's ray test by one through its grid, built at the first test and again when its geometry changes. */
export function indexRaycast(mesh: THREE.Mesh) {
  let ix: RayIndex | null = null
  const seen = { stamp: 1, marks: new Uint32Array(0) }
  const ready = (g: THREE.BufferGeometry): RayIndex => {
    if (!ix || ix.geometry !== g) {
      ix = buildIndex(g)
      seen.marks = new Uint32Array(triOf(g).n)
    }
    return ix
  }
  // built ahead in idle time, so the first pick over the mesh does not pay for it
  mesh.userData.warmIndex = () => mesh.geometry.attributes.position && ready(mesh.geometry)
  mesh.raycast = function (raycaster: THREE.Raycaster, out: THREE.Intersection[]) {
    const g = this.geometry
    if (!g.attributes.position) return
    ready(g)
    inv.copy(this.matrixWorld).invert()
    local.copy(raycaster.ray).applyMatrix4(inv)
    if (!ix) return
    const span = boxSpan(local.origin, local.direction, ix.box)
    if (!span) return
    local.at(span[0], enter)
    local.at(span[1], exit)
    const pos = g.attributes.position
    const { at } = triOf(g)
    const stamp = ++seen.stamp
    const side = (Array.isArray(this.material) ? this.material[0] : this.material)?.side ?? THREE.FrontSide
    const cull = side !== THREE.DoubleSide
    cellsAlong(ix, enter.x, enter.y, exit.x, exit.y, cellId => {
      for (let k = ix!.starts[cellId]; k < ix!.starts[cellId + 1]; k++) {
        const t = ix!.tris[k]
        if (seen.marks[t] === stamp) continue
        seen.marks[t] = stamp
        a.fromBufferAttribute(pos, at(t, 0))
        b.fromBufferAttribute(pos, at(t, 1))
        c.fromBufferAttribute(pos, at(t, 2))
        const p = side === THREE.BackSide ? local.intersectTriangle(c, b, a, cull, hit) : local.intersectTriangle(a, b, c, cull, hit)
        if (!p) continue
        const world = p.clone().applyMatrix4(this.matrixWorld)
        const distance = raycaster.ray.origin.distanceTo(world)
        if (distance < raycaster.near || distance > raycaster.far) continue
        out.push({ distance, point: world, object: this, faceIndex: t } as THREE.Intersection)
      }
    })
  }
}
